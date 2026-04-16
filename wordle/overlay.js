import { BaseOverlay } from '../core/base-overlay.js';
import { SOLUTIONS } from './words-solutions.js';
import { VALID_GUESSES } from './words-valid.js';

export class WordleOverlay extends BaseOverlay {
  constructor(config) {
    super(config);
    this.solutionList = SOLUTIONS;
    this.validWords = new Set([...SOLUTIONS, ...VALID_GUESSES]);

    // Game state
    this.gameState = 'idle'; // idle | voting | revealing | won | lost
    this.targetWord = '';
    this.guesses = [];       // [{ word, result[] }] where result is 'correct'|'present'|'absent'
    this.currentRound = 0;
    this.votes = new Map();  // username -> word
    this.letterStates = new Map(); // letter -> best state

    // UI references
    this.ui = {};
  }

  onInit() {
    this.buildUI();
    this.updateStatus('Waiting for !startgame');
  }

  // ── UI Construction ──

  buildUI() {
    const root = document.createElement('div');
    root.className = 'wordle-root';

    // Header
    const header = document.createElement('div');
    header.className = 'wordle-header';
    header.innerHTML = `
      <span class="wordle-title">WORDLE</span>
      <span class="wordle-round" id="round-indicator"></span>
    `;
    root.appendChild(header);

    // Status
    const status = document.createElement('div');
    status.className = 'wordle-status';
    status.id = 'wordle-status';
    root.appendChild(status);

    // Grid
    const grid = document.createElement('div');
    grid.className = 'wordle-grid';
    this.ui.rows = [];
    for (let r = 0; r < 6; r++) {
      const row = document.createElement('div');
      row.className = 'wordle-row';
      for (let c = 0; c < 5; c++) {
        const tile = document.createElement('div');
        tile.className = 'wordle-tile';
        tile.dataset.state = 'empty';
        tile.innerHTML = `
          <div class="wordle-tile-inner">
            <div class="wordle-tile-front"></div>
            <div class="wordle-tile-back"></div>
          </div>
        `;
        row.appendChild(tile);
      }
      grid.appendChild(row);
      this.ui.rows.push(row);
    }
    root.appendChild(grid);

    // Top votes bar
    const topVotes = document.createElement('div');
    topVotes.className = 'wordle-top-votes';
    topVotes.id = 'wordle-top-votes';
    root.appendChild(topVotes);

    // Vote feed
    const feedContainer = document.createElement('div');
    feedContainer.className = 'wordle-feed-container';
    const feedLabel = document.createElement('div');
    feedLabel.className = 'wordle-feed-label';
    feedLabel.textContent = 'Live Votes';
    feedContainer.appendChild(feedLabel);
    const feed = document.createElement('div');
    feed.className = 'wordle-feed';
    feed.id = 'wordle-feed';
    feedContainer.appendChild(feed);
    root.appendChild(feedContainer);

    this.container.appendChild(root);

    this.ui.root = root;
    this.ui.status = status;
    this.ui.roundIndicator = header.querySelector('.wordle-round');
    this.ui.topVotes = topVotes;
    this.ui.feed = feed;
    this.ui.feedContainer = feedContainer;
  }

  // ── Message Handling ──

  onMessage(message) {
    const text = message.message.trim().toLowerCase();

    // Mod commands — always processed
    if (message.moderator) {
      if (text === '!startgame') {
        this.startGame();
        return;
      }
      if (text === '!guess') {
        this.resolveVote();
        return;
      }
      if (text === '!endgame') {
        this.endGame();
        return;
      }
    }

    // Votes — only during voting state
    if (this.gameState !== 'voting') return;
    if (!/^[a-z]{5}$/.test(text)) return;
    if (!this.validWords.has(text)) return;

    this.votes.set(message.username, text);
    this.addFeedEntry(message.username, text, message.color);
    this.updateTopVotes();
    this.updatePreviewRow();
  }

  // ── Game Flow ──

  startGame() {
    this.targetWord = this.solutionList[Math.floor(Math.random() * this.solutionList.length)];
    this.guesses = [];
    this.currentRound = 0;
    this.votes.clear();
    this.letterStates.clear();
    this.gameState = 'voting';

    // Reset UI
    this.resetGrid();
    this.clearFeed();
    this.ui.topVotes.innerHTML = '';
    this.ui.root.classList.remove('game-won', 'game-lost');
    this.updateRound();
    this.updateStatus('Type a 5-letter word to vote!');
    this.ui.feedContainer.style.display = '';

    if (this.config.debug) {
      console.log('Target word:', this.targetWord);
    }
  }

  resolveVote() {
    if (this.gameState !== 'voting') return;

    if (this.votes.size === 0) {
      this.updateStatus('No votes yet!');
      return;
    }

    // Tally votes
    const counts = new Map();
    for (const word of this.votes.values()) {
      counts.set(word, (counts.get(word) || 0) + 1);
    }

    // Find winner (random tiebreak)
    let maxCount = 0;
    for (const count of counts.values()) {
      if (count > maxCount) maxCount = count;
    }
    const tied = [];
    for (const [word, count] of counts) {
      if (count === maxCount) tied.push(word);
    }
    const winner = tied[Math.floor(Math.random() * tied.length)];

    // Evaluate guess
    const result = this.evaluateGuess(winner, this.targetWord);
    this.guesses.push({ word: winner, result });

    // Update letter states for future reference
    for (let i = 0; i < 5; i++) {
      const letter = winner[i];
      const state = result[i];
      const current = this.letterStates.get(letter);
      if (!current || this.statePriority(state) > this.statePriority(current)) {
        this.letterStates.set(letter, state);
      }
    }

    this.gameState = 'revealing';
    this.updateStatus(`Chat guessed: ${winner.toUpperCase()} (${maxCount} vote${maxCount !== 1 ? 's' : ''})`);
    this.revealGuess(this.currentRound);
  }

  endGame() {
    this.gameState = 'idle';
    if (this.targetWord) {
      this.updateStatus(`Game ended. The word was: ${this.targetWord.toUpperCase()}`);
    } else {
      this.updateStatus('Game ended.');
    }
    this.ui.feedContainer.style.display = 'none';
  }

  // ── Wordle Evaluation ──

  evaluateGuess(guess, target) {
    const result = Array(5).fill('absent');
    const targetChars = [...target];
    const guessChars = [...guess];

    // First pass: exact matches (green)
    for (let i = 0; i < 5; i++) {
      if (guessChars[i] === targetChars[i]) {
        result[i] = 'correct';
        targetChars[i] = null;
        guessChars[i] = null;
      }
    }

    // Second pass: present but wrong position (yellow)
    for (let i = 0; i < 5; i++) {
      if (guessChars[i] === null) continue;
      const idx = targetChars.indexOf(guessChars[i]);
      if (idx !== -1) {
        result[i] = 'present';
        targetChars[idx] = null;
      }
    }

    return result;
  }

  statePriority(state) {
    if (state === 'correct') return 3;
    if (state === 'present') return 2;
    if (state === 'absent') return 1;
    return 0;
  }

  // ── Reveal Animation ──

  revealGuess(rowIndex) {
    const row = this.ui.rows[rowIndex];
    const tiles = row.querySelectorAll('.wordle-tile');
    const guess = this.guesses[rowIndex];

    // Set front face letters (visible before flip)
    tiles.forEach((tile, i) => {
      tile.querySelector('.wordle-tile-front').textContent = guess.word[i].toUpperCase();
    });

    // Staggered flip
    tiles.forEach((tile, i) => {
      setTimeout(() => {
        tile.dataset.state = guess.result[i];
        tile.querySelector('.wordle-tile-back').textContent = guess.word[i].toUpperCase();
        tile.classList.add('reveal');
      }, i * 300);
    });

    // After all tiles revealed
    setTimeout(() => this.onRevealComplete(), 5 * 300 + 600);
  }

  onRevealComplete() {
    const lastGuess = this.guesses[this.guesses.length - 1];
    const isCorrect = lastGuess.result.every(r => r === 'correct');

    if (isCorrect) {
      this.gameState = 'won';
      this.updateStatus(`Chat wins! The word was ${this.targetWord.toUpperCase()}!`);
      this.ui.root.classList.add('game-won');
      this.showWinAnimation();
    } else if (this.guesses.length >= 6) {
      this.gameState = 'lost';
      this.updateStatus(`Game over! The word was ${this.targetWord.toUpperCase()}`);
      this.ui.root.classList.add('game-lost');
      this.showLossAnimation();
    } else {
      // Next round
      this.currentRound++;
      this.votes.clear();
      this.clearFeed();
      this.ui.topVotes.innerHTML = '';
      this.gameState = 'voting';
      this.updateRound();
      this.updateStatus('Type a 5-letter word to vote!');
    }
  }

  showWinAnimation() {
    const winRow = this.ui.rows[this.guesses.length - 1];
    const tiles = winRow.querySelectorAll('.wordle-tile');
    tiles.forEach((tile, i) => {
      setTimeout(() => {
        tile.classList.add('bounce');
      }, i * 100);
    });
    this.ui.feedContainer.style.display = 'none';
  }

  showLossAnimation() {
    const grid = this.container.querySelector('.wordle-grid');
    grid.classList.add('shake');
    setTimeout(() => grid.classList.remove('shake'), 600);
    this.ui.feedContainer.style.display = 'none';
  }

  // ── UI Updates ──

  updateStatus(text) {
    this.ui.status.textContent = text;
  }

  updateRound() {
    this.ui.roundIndicator.textContent = `Round ${this.currentRound + 1}/6`;
  }

  updateTopVotes() {
    const counts = new Map();
    for (const word of this.votes.values()) {
      counts.set(word, (counts.get(word) || 0) + 1);
    }

    // Sort by count descending
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);

    this.ui.topVotes.innerHTML = sorted.map(([word, count]) =>
      `<span class="vote-candidate">${word.toUpperCase()} <span class="vote-count">(${count})</span></span>`
    ).join('');
  }

  updatePreviewRow() {
    if (this.gameState !== 'voting') return;

    // Show leading word in current row (dimmed)
    const counts = new Map();
    for (const word of this.votes.values()) {
      counts.set(word, (counts.get(word) || 0) + 1);
    }

    let leader = '';
    let maxCount = 0;
    for (const [word, count] of counts) {
      if (count > maxCount) {
        maxCount = count;
        leader = word;
      }
    }

    if (!leader) return;

    const row = this.ui.rows[this.currentRound];
    const tiles = row.querySelectorAll('.wordle-tile');
    tiles.forEach((tile, i) => {
      const front = tile.querySelector('.wordle-tile-front');
      front.textContent = leader[i].toUpperCase();
      tile.classList.add('preview');
    });
  }

  addFeedEntry(username, word, color) {
    const entry = document.createElement('div');
    entry.className = 'feed-entry';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'feed-username';
    nameSpan.textContent = username;
    if (color) nameSpan.style.color = color;

    const wordSpan = document.createElement('span');
    wordSpan.className = 'feed-word';
    wordSpan.textContent = word.toUpperCase();

    entry.appendChild(nameSpan);
    entry.appendChild(wordSpan);
    this.ui.feed.appendChild(entry);

    // Cap at 20 entries
    while (this.ui.feed.children.length > 20) {
      this.ui.feed.removeChild(this.ui.feed.firstChild);
    }

    // Auto-scroll to bottom
    this.ui.feed.scrollTop = this.ui.feed.scrollHeight;
  }

  clearFeed() {
    this.ui.feed.innerHTML = '';
  }

  resetGrid() {
    for (const row of this.ui.rows) {
      const tiles = row.querySelectorAll('.wordle-tile');
      tiles.forEach(tile => {
        tile.dataset.state = 'empty';
        tile.classList.remove('reveal', 'preview', 'bounce');
        tile.querySelector('.wordle-tile-front').textContent = '';
        tile.querySelector('.wordle-tile-back').textContent = '';
      });
    }
  }
}
