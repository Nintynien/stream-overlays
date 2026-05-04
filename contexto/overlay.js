import { BaseOverlay } from '../core/base-overlay.js';

const MAX_RANK = 30000;
const MIN_REQUEST_SPACING_MS = 500; // 2 requests/sec cap
const FEED_MAX = 20;
const GUESS_REGEX = /^[a-zA-Z'-]{2,20}$/;

export class ContextoOverlay extends BaseOverlay {
  constructor(config) {
    super(config);

    const s = config.settings || {};
    this.endpoint = (s.endpoint || 'https://api.contexto.me/machado/en').replace(/\/+$/, '');
    this.corsProxy = resolveCorsProxy(s.corsProxy);
    this.configuredGame = s.game ?? null;
    this.minGame = s.minGame ?? 1;
    this.maxGame = s.maxGame ?? 1300;
    this.maxVisible = s.maxVisible ?? 15;

    if (this.corsProxy && config.debug) {
      console.log('[contexto] CORS proxy enabled:', this.corsProxy);
    }

    this.gameState = 'idle'; // idle | playing | won | revealed
    this.gameId = null;
    this.guessCount = 0;
    this.bestRank = null;
    this.winner = null;
    this.targetLemma = null;

    // Per-lemma leaderboard rows: lemma -> { distance, originalWord, guessedBy:Set<username>, row:Element }
    this.rows = new Map();

    // word (input, lowercased) -> { distance, lemma } or 'invalid'
    this.cache = new Map();
    this.inflight = new Set();
    this.queue = [];
    this.workerRunning = false;
    this.apiCallCount = 0;

    this.ui = {};
  }

  onInit() {
    this.buildUI();
    this.setBanner('Waiting for !startgame', 'idle');
  }

  // ── UI Construction ──

  buildUI() {
    const root = document.createElement('div');
    root.className = 'contexto-root';

    const header = document.createElement('div');
    header.className = 'contexto-header';
    header.innerHTML = `
      <span class="contexto-title">CONTEXTO</span>
      <span class="contexto-gameid" id="contexto-gameid"></span>
    `;
    root.appendChild(header);

    const stats = document.createElement('div');
    stats.className = 'contexto-stats';
    stats.innerHTML = `
      <div class="stat"><span class="stat-label">Guesses</span><span class="stat-value" id="stat-guesses">0</span></div>
      <div class="stat"><span class="stat-label">Best rank</span><span class="stat-value" id="stat-best">—</span></div>
    `;
    root.appendChild(stats);

    const banner = document.createElement('div');
    banner.className = 'contexto-banner';
    banner.id = 'contexto-banner';
    root.appendChild(banner);

    const boardLabel = document.createElement('div');
    boardLabel.className = 'contexto-board-label';
    boardLabel.textContent = 'Closest Guesses';
    root.appendChild(boardLabel);

    const board = document.createElement('div');
    board.className = 'contexto-board';
    board.id = 'contexto-board';
    root.appendChild(board);

    const feedLabel = document.createElement('div');
    feedLabel.className = 'contexto-feed-label';
    feedLabel.textContent = 'Live Chat';
    root.appendChild(feedLabel);

    const feed = document.createElement('div');
    feed.className = 'contexto-feed';
    feed.id = 'contexto-feed';
    root.appendChild(feed);

    this.container.appendChild(root);

    this.ui.root = root;
    this.ui.gameId = header.querySelector('#contexto-gameid');
    this.ui.statGuesses = stats.querySelector('#stat-guesses');
    this.ui.statBest = stats.querySelector('#stat-best');
    this.ui.banner = banner;
    this.ui.board = board;
    this.ui.feed = feed;
    this.ui.boardLabel = boardLabel;
  }

  // ── Message Handling ──

  onMessage(message) {
    const raw = message.message.trim();
    if (!raw) return;

    // Mod commands
    if (message.moderator) {
      const lower = raw.toLowerCase();
      if (lower === '!startgame' || lower.startsWith('!startgame ')) {
        const parts = lower.split(/\s+/);
        const idArg = parts[1] ? parseInt(parts[1], 10) : null;
        this.startGame(Number.isFinite(idArg) ? idArg : null);
        return;
      }
      if (lower === '!giveup') {
        this.giveUp();
        return;
      }
      if (lower === '!endgame') {
        this.endGame();
        return;
      }
    }

    if (this.gameState !== 'playing') return;
    if (raw.startsWith('!')) return;

    // First token matching guess shape
    const match = raw.match(/[a-zA-Z'-]{2,20}/);
    if (!match) return;
    const word = match[0].toLowerCase();
    if (!GUESS_REGEX.test(word)) return;

    this.handleGuess(message.username || 'anon', word, message.color);
  }

  // ── Guess Flow ──

  handleGuess(username, word, userColor) {
    const cached = this.cache.get(word);
    if (cached === 'invalid') {
      this.addFeed(username, word, userColor, 'invalid');
      return;
    }
    if (cached) {
      this.recordGuess(username, word, userColor, cached);
      return;
    }

    this.addFeed(username, word, userColor, 'pending');

    if (this.inflight.has(word)) return;
    this.inflight.add(word);

    // Stash pending username/color so we can render when response arrives
    if (!this._pendingAttribution) this._pendingAttribution = new Map();
    if (!this._pendingAttribution.has(word)) {
      this._pendingAttribution.set(word, { username, color: userColor });
    }

    this.queue.push(word);
    this.updateDebug();
    this.drainQueue();
  }

  async drainQueue() {
    if (this.workerRunning) return;
    this.workerRunning = true;

    while (this.queue.length) {
      const word = this.queue.shift();
      const requestedGameId = this.gameId;
      this.updateDebug();

      const startedAt = Date.now();
      try {
        const result = await this.fetchGuess(requestedGameId, word);
        // Drop result if the game changed or ended while we were waiting
        if (this.gameId !== requestedGameId) {
          // no-op: caller has moved on
        } else if (result) {
          this.cache.set(word, result);
          this.cache.set(result.lemma, result);
          const attr = this._pendingAttribution?.get(word);
          this.recordGuess(attr?.username ?? 'anon', word, attr?.color, result, /*fromApi*/ true);
        } else {
          this.cache.set(word, 'invalid');
          this.markFeedInvalid(word);
        }
      } catch (err) {
        // Transient network/proxy error — don't poison the cache so a future guess can retry,
        // but mark the feed entry as failed so the streamer can see something went wrong.
        console.warn('[contexto] fetch failed for', word, err);
        this.markFeedFailed(word, err);
      } finally {
        this.inflight.delete(word);
        this._pendingAttribution?.delete(word);
      }

      // Only gate the NEXT request if more are pending
      if (this.queue.length) {
        const elapsed = Date.now() - startedAt;
        const wait = Math.max(0, MIN_REQUEST_SPACING_MS - elapsed);
        if (wait > 0) await sleep(wait);
      }
    }

    this.workerRunning = false;
    this.updateDebug();
  }

  async fetchGuess(gameId, word) {
    const targetUrl = `${this.endpoint}/game/${gameId}/${encodeURIComponent(word)}`;
    const url = this.wrapProxy(targetUrl);
    this.apiCallCount++;
    this.updateDebug();
    const resp = await fetch(url);
    if (resp.status === 404) return null;
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    if (typeof data.distance !== 'number' || !data.lemma) {
      throw new Error('Unexpected response shape');
    }
    return { distance: data.distance, lemma: data.lemma, word: data.word || word };
  }

  wrapProxy(targetUrl) {
    if (!this.corsProxy) return targetUrl;
    return `${this.corsProxy}${encodeURIComponent(targetUrl)}`;
  }

  // ── Leaderboard Rendering ──

  recordGuess(username, originalWord, userColor, result, fromApi = false) {
    if (this.gameState !== 'playing' && this.gameState !== 'won') return;
    const { distance, lemma } = result;
    this.guessCount++;
    this.ui.statGuesses.textContent = this.guessCount;

    if (this.bestRank === null || distance < this.bestRank) {
      this.bestRank = distance;
      this.ui.statBest.textContent = distance === 0 ? '🎯 0' : distance;
    }

    let row = this.rows.get(lemma);
    if (!row) {
      row = this.createRow(lemma, distance, originalWord);
      this.rows.set(lemma, row);
      this.ui.board.appendChild(row.el);
    }
    row.guessedBy.add(username);
    if (fromApi) row.el.classList.add('flash');
    // Trigger reflow + remove to restart animation on repeat guesses
    setTimeout(() => row.el.classList.remove('flash'), 900);

    this.updateFeedResolved(originalWord, distance);
    this.resortBoard();

    if (distance === 0 && this.gameState === 'playing') {
      this.onWin(username, lemma);
    }
  }

  createRow(lemma, distance, originalWord) {
    const el = document.createElement('div');
    el.className = 'contexto-row';
    el.dataset.lemma = lemma;

    const widthPct = Math.max(2, 100 * (1 - Math.log10(distance + 1) / Math.log10(MAX_RANK)));
    const tier = tierForRank(distance);

    el.innerHTML = `
      <div class="row-bar tier-${tier}" style="width: ${widthPct.toFixed(1)}%"></div>
      <div class="row-content">
        <span class="row-word">${escapeHtml(lemma)}</span>
        <span class="row-rank">${distance === 0 ? '🎯' : distance}</span>
      </div>
    `;

    return {
      el,
      lemma,
      distance,
      originalWord,
      guessedBy: new Set()
    };
  }

  resortBoard() {
    const sorted = [...this.rows.values()].sort((a, b) => a.distance - b.distance);
    const frag = document.createDocumentFragment();
    for (let i = 0; i < sorted.length && i < this.maxVisible; i++) {
      frag.appendChild(sorted[i].el);
    }
    // Detach any rows beyond the visible cap (keep them in this.rows for final reveal)
    for (let i = this.maxVisible; i < sorted.length; i++) {
      if (sorted[i].el.parentElement) sorted[i].el.remove();
    }
    this.ui.board.innerHTML = '';
    this.ui.board.appendChild(frag);
  }

  // ── Live Feed ──

  addFeed(username, word, userColor, state) {
    const entry = document.createElement('div');
    entry.className = `feed-entry feed-${state}`;
    entry.dataset.word = word;

    const nameSpan = document.createElement('span');
    nameSpan.className = 'feed-username';
    nameSpan.textContent = username;
    if (userColor) nameSpan.style.color = userColor;

    const wordSpan = document.createElement('span');
    wordSpan.className = 'feed-word';
    wordSpan.textContent = word;

    const rankSpan = document.createElement('span');
    rankSpan.className = 'feed-rank';
    rankSpan.textContent = state === 'pending' ? '…' : (state === 'invalid' ? '✗' : '');

    entry.appendChild(nameSpan);
    entry.appendChild(wordSpan);
    entry.appendChild(rankSpan);
    this.ui.feed.appendChild(entry);

    while (this.ui.feed.children.length > FEED_MAX) {
      this.ui.feed.removeChild(this.ui.feed.firstChild);
    }
    this.ui.feed.scrollTop = this.ui.feed.scrollHeight;
  }

  updateFeedResolved(word, distance) {
    // Resolve every pending entry for this word (same word may be typed by multiple users
    // before the API responds — all should light up together)
    const entries = this.ui.feed.querySelectorAll(`.feed-entry.feed-pending[data-word="${cssEscape(word)}"]`);
    const tier = tierForRank(distance);
    const label = distance === 0 ? '🎯' : distance;
    entries.forEach(entry => {
      entry.classList.remove('feed-pending');
      entry.classList.add('feed-resolved', `tier-${tier}`);
      const rankSpan = entry.querySelector('.feed-rank');
      if (rankSpan) rankSpan.textContent = label;
    });
  }

  markFeedInvalid(word) {
    const entries = this.ui.feed.querySelectorAll(`.feed-entry.feed-pending[data-word="${cssEscape(word)}"]`);
    entries.forEach(entry => {
      entry.classList.remove('feed-pending');
      entry.classList.add('feed-invalid');
      const rankSpan = entry.querySelector('.feed-rank');
      if (rankSpan) rankSpan.textContent = '✗';
    });
  }

  markFeedFailed(word, err) {
    const reason = err?.message ? String(err.message).slice(0, 80) : 'fetch failed';
    const entries = this.ui.feed.querySelectorAll(`.feed-entry.feed-pending[data-word="${cssEscape(word)}"]`);
    entries.forEach(entry => {
      entry.classList.remove('feed-pending');
      entry.classList.add('feed-failed');
      entry.title = reason;
      const rankSpan = entry.querySelector('.feed-rank');
      if (rankSpan) rankSpan.textContent = '⚠';
    });
  }

  clearFeed() {
    this.ui.feed.innerHTML = '';
  }

  // ── Game Flow ──

  startGame(requestedId = null) {
    const id = requestedId
      ?? this.configuredGame
      ?? randomInt(this.minGame, this.maxGame);

    this.gameState = 'playing';
    this.gameId = id;
    this.guessCount = 0;
    this.bestRank = null;
    this.winner = null;
    this.targetLemma = null;

    this.rows.clear();
    this.cache.clear();
    this.inflight.clear();
    this.queue.length = 0;
    this._pendingAttribution = new Map();

    this.ui.gameId.textContent = `#${id}`;
    this.ui.statGuesses.textContent = '0';
    this.ui.statBest.textContent = '—';
    this.ui.board.innerHTML = '';
    this.clearFeed();
    this.ui.root.classList.remove('state-won', 'state-revealed', 'state-idle');
    this.ui.root.classList.add('state-playing');
    this.setBanner(`Game #${id} — type words to guess!`, 'playing');

    if (this.config.debug) console.log('[contexto] startGame', id);
  }

  onWin(username, lemma) {
    this.gameState = 'won';
    this.winner = username;
    this.targetLemma = lemma;
    this.ui.root.classList.remove('state-playing');
    this.ui.root.classList.add('state-won');
    this.setBanner(`🎉 ${username} got it! The word was ${lemma.toUpperCase()}`, 'won');
  }

  async giveUp() {
    if (this.gameState === 'idle') return;
    try {
      const targetUrl = `${this.endpoint}/giveup/${this.gameId}`;
      const url = this.wrapProxy(targetUrl);
      this.apiCallCount++;
      this.updateDebug();
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const answer = data.lemma || data.word;
      this.targetLemma = answer;

      // Drop the answer into the board as the rank-0 row (if not already there)
      if (!this.rows.has(answer)) {
        const result = { distance: 0, lemma: answer, word: answer };
        this.cache.set(answer, result);
        const row = this.createRow(answer, 0, answer);
        this.rows.set(answer, row);
        this.ui.board.appendChild(row.el);
        this.resortBoard();
      }

      this.gameState = 'revealed';
      this.ui.root.classList.remove('state-playing');
      this.ui.root.classList.add('state-revealed');
      this.setBanner(`The word was ${answer.toUpperCase()}`, 'revealed');
    } catch (err) {
      if (this.config.debug) console.warn('[contexto] giveUp failed', err);
      this.setBanner('Failed to reveal answer', 'revealed');
    }
  }

  endGame() {
    this.gameState = 'idle';
    this.gameId = null;
    this.queue.length = 0;
    this.inflight.clear();
    this.ui.root.classList.remove('state-playing', 'state-won', 'state-revealed');
    this.ui.root.classList.add('state-idle');
    this.ui.gameId.textContent = '';
    this.setBanner('Waiting for !startgame', 'idle');
  }

  // ── Utilities ──

  setBanner(text, state) {
    this.ui.banner.textContent = text;
    this.ui.banner.dataset.state = state;
  }

  updateDebug() {
    if (!this.config.debug) return;
    const queueEl = document.getElementById('queue-size');
    const apiEl = document.getElementById('api-count');
    if (queueEl) queueEl.textContent = this.queue.length + (this.workerRunning ? ' (active)' : '');
    if (apiEl) apiEl.textContent = this.apiCallCount;
  }
}

// ── Pure helpers ──

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function randomInt(lo, hi) {
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

function tierForRank(rank) {
  if (rank === 0) return 'win';
  if (rank <= 300) return 'hot';
  if (rank <= 1500) return 'warm';
  if (rank <= 5000) return 'cool';
  return 'cold';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function cssEscape(s) {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(s);
  return String(s).replace(/["\\]/g, '\\$&');
}

function resolveCorsProxy(value) {
  if (!value) return null;
  const v = String(value).trim();
  // Shorthands
  if (/^(on|1|true|corsproxy|corsproxy\.io)$/i.test(v)) return 'https://corsproxy.io/?url=';
  if (/^allorigins$/i.test(v)) return 'https://api.allorigins.win/raw?url=';
  // Full custom prefix — expected to end in something that accepts an encoded URL
  if (/^https?:\/\//i.test(v)) return v;
  return null;
}
