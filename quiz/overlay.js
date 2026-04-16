import { BaseOverlay } from '../core/base-overlay.js';
import { fetchSessionToken, resetSessionToken, fetchQuestions } from './questions.js';

const LETTERS = ['A', 'B', 'C', 'D'];
const DIFFICULTY_STARS = { easy: '\u2605', medium: '\u2605\u2605', hard: '\u2605\u2605\u2605' };

export class QuizOverlay extends BaseOverlay {
  constructor(config) {
    super(config);
    this.settings = {
      questionCount: config.settings?.questionCount ?? 10,
      timePerQuestion: config.settings?.timePerQuestion ?? 20000,
      pauseBetween: config.settings?.pauseBetween ?? 2000,
      category: config.settings?.category ?? null,
      difficulty: config.settings?.difficulty ?? null,
      tickMs: 100,
    };

    this.gameState = 'idle';
    this.questions = [];
    this.currentQuestionIndex = 0;
    this.questionStartTime = 0;
    this.scores = new Map();
    this.answeredThisRound = new Map(); // username -> letter chosen
    this.intervalId = null;
    this.sessionToken = null;
    this.abortController = null;
    this.ui = {};
  }

  onInit() {
    this.buildUI();
    this.setState('idle');
  }

  onMessage(message) {
    const text = message.message.trim().toUpperCase();

    if (text === '!STARTGAME') {
      if (this.isModOrBroadcaster(message)) {
        this.startGame();
      }
      return;
    }
    if (text === '!ENDGAME') {
      if (this.isModOrBroadcaster(message)) {
        this.endGame();
      }
      return;
    }

    if (this.gameState !== 'question') return;

    const firstChar = text.charAt(0);
    if (!LETTERS.includes(firstChar)) return;
    if (this.answeredThisRound.has(message.username)) return;

    this.answeredThisRound.set(message.username, firstChar);
    this.recordAnswer(message.username, firstChar);
  }

  isModOrBroadcaster(message) {
    if (message.moderator) return true;
    const channel = this.config.twitch?.channel || this.config.kick?.channel || '';
    return message.username.toLowerCase() === channel.toLowerCase();
  }

  recordAnswer(username, letter) {
    const question = this.questions[this.currentQuestionIndex];
    if (letter === question.correctLetter) {
      const current = this.scores.get(username) || 0;
      this.scores.set(username, current + question.points);
    }
    this.updateAnswerCount();
  }

  updateAnswerCount() {
    const total = this.answeredThisRound.size;
    let correct = 0;
    const question = this.questions[this.currentQuestionIndex];
    for (const letter of this.answeredThisRound.values()) {
      if (letter === question.correctLetter) correct++;
    }
    this.ui.answerCount.textContent = `${total} answered`;
  }

  // --- State management ---

  setState(state) {
    this.gameState = state;
    this.ui.root.dataset.state = state;
  }

  async startGame() {
    if (this.gameState !== 'idle') return;

    this.setState('loading');
    this.ui.loadingText.textContent = 'Loading questions...';
    this.scores.clear();
    this.currentQuestionIndex = 0;

    try {
      if (!this.sessionToken) {
        this.sessionToken = await fetchSessionToken();
      }

      this.abortController = new AbortController();
      this.questions = await this.fetchWithRetry();
      this.abortController = null;

      this.showQuestion(0);
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('Failed to fetch questions:', err);
      this.ui.loadingText.textContent = 'Failed to load questions. Try again.';
      setTimeout(() => this.setState('idle'), 3000);
    }
  }

  async fetchWithRetry() {
    try {
      return await fetchQuestions({
        amount: this.settings.questionCount,
        token: this.sessionToken,
        category: this.settings.category,
        difficulty: this.settings.difficulty,
        signal: this.abortController?.signal,
      });
    } catch (err) {
      if (err.message === 'TOKEN_EXHAUSTED') {
        this.ui.loadingText.textContent = 'Refreshing question pool...';
        await resetSessionToken(this.sessionToken);
        return await fetchQuestions({
          amount: this.settings.questionCount,
          token: this.sessionToken,
          category: this.settings.category,
          difficulty: this.settings.difficulty,
          signal: this.abortController?.signal,
        });
      }
      if (err.message === 'TOKEN_NOT_FOUND') {
        this.sessionToken = await fetchSessionToken();
        return await fetchQuestions({
          amount: this.settings.questionCount,
          token: this.sessionToken,
          category: this.settings.category,
          difficulty: this.settings.difficulty,
          signal: this.abortController?.signal,
        });
      }
      throw err;
    }
  }

  showQuestion(index) {
    this.currentQuestionIndex = index;
    this.answeredThisRound.clear();
    this.setState('question');

    const question = this.questions[index];

    this.ui.questionCounter.textContent = `Q ${index + 1}/${this.questions.length}`;
    this.ui.difficulty.textContent = `${DIFFICULTY_STARS[question.difficulty]} ${question.difficulty} - ${question.points} pt${question.points > 1 ? 's' : ''}`;
    this.ui.category.textContent = question.category;
    this.ui.questionText.textContent = question.text;
    this.ui.answerCount.textContent = '';

    // Render answer options
    this.ui.answersContainer.innerHTML = '';
    question.answers.forEach((answer, i) => {
      const row = document.createElement('div');
      row.className = 'quiz-answer';
      row.dataset.letter = LETTERS[i];
      row.innerHTML = `<span class="quiz-answer-letter">${LETTERS[i]}</span><span class="quiz-answer-text">${answer}</span>`;
      this.ui.answersContainer.appendChild(row);
    });

    // Reset and start timer
    this.ui.timerBar.style.transition = 'none';
    this.ui.timerBar.style.width = '100%';
    this.ui.timerBar.classList.remove('urgent');
    // Force reflow before starting transition
    this.ui.timerBar.offsetWidth;
    this.ui.timerBar.style.transition = `width ${this.settings.timePerQuestion}ms linear`;
    this.ui.timerBar.style.width = '0%';

    this.questionStartTime = performance.now();
    this.ui.timerText.textContent = Math.ceil(this.settings.timePerQuestion / 1000);

    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = setInterval(() => this.tick(), this.settings.tickMs);
  }

  tick() {
    if (this.gameState !== 'question') return;

    const elapsed = performance.now() - this.questionStartTime;
    const remaining = Math.max(0, this.settings.timePerQuestion - elapsed);
    const seconds = Math.ceil(remaining / 1000);

    this.ui.timerText.textContent = seconds;

    if (remaining <= 5000) {
      this.ui.timerBar.classList.add('urgent');
    }

    if (remaining <= 0) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.revealAnswer();
    }
  }

  revealAnswer() {
    this.setState('reveal');

    const question = this.questions[this.currentQuestionIndex];

    // Highlight correct/incorrect answers
    const answerEls = this.ui.answersContainer.querySelectorAll('.quiz-answer');
    answerEls.forEach((el, i) => {
      if (i === question.correctIndex) {
        el.classList.add('correct');
      } else {
        el.classList.add('incorrect');
      }
    });

    // Show result stats
    const total = this.answeredThisRound.size;
    let correct = 0;
    for (const letter of this.answeredThisRound.values()) {
      if (letter === question.correctLetter) correct++;
    }
    this.ui.answerCount.textContent = total > 0
      ? `${correct}/${total} correct!`
      : 'No answers';

    // Show correct answer text
    this.ui.timerText.textContent = question.correctLetter;

    // Advance after pause
    setTimeout(() => this.advanceQuestion(), this.settings.pauseBetween);
  }

  advanceQuestion() {
    const nextIndex = this.currentQuestionIndex + 1;
    if (nextIndex < this.questions.length) {
      this.showQuestion(nextIndex);
    } else {
      this.showLeaderboard();
    }
  }

  endGame() {
    if (this.gameState === 'idle') return;

    // Abort any pending fetch
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    if (this.scores.size > 0) {
      this.showLeaderboard();
    } else {
      this.setState('idle');
    }
  }

  showLeaderboard() {
    this.setState('leaderboard');

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    const sorted = [...this.scores.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 5);
    const medals = ['\uD83E\uDD47', '\uD83E\uDD48', '\uD83E\uDD49']; // gold, silver, bronze

    this.ui.leaderboardList.innerHTML = '';
    top.forEach(([username, score], i) => {
      const row = document.createElement('div');
      row.className = 'quiz-leaderboard-row';
      row.style.animationDelay = `${i * 0.15}s`;

      const rank = i < 3 ? medals[i] : `${i + 1}.`;
      row.innerHTML = `
        <span class="quiz-lb-rank">${rank}</span>
        <span class="quiz-lb-name">${username}</span>
        <span class="quiz-lb-score">${score} pt${score !== 1 ? 's' : ''}</span>
      `;
      this.ui.leaderboardList.appendChild(row);
    });

    this.ui.leaderboardTotal.textContent = `${this.scores.size} participant${this.scores.size !== 1 ? 's' : ''}`;

    // Return to idle after display
    setTimeout(() => this.setState('idle'), 12000);
  }

  // --- UI Building ---

  buildUI() {
    const root = document.createElement('div');
    root.className = 'quiz-root';
    root.dataset.state = 'idle';

    root.innerHTML = `
      <div class="quiz-card">
        <div class="quiz-header">
          <div class="quiz-title">Quiz Time</div>
          <div class="quiz-question-counter" id="quiz-question-counter"></div>
          <div class="quiz-timer">
            <span class="quiz-timer-text" id="quiz-timer-text"></span>
          </div>
        </div>

        <div class="quiz-body">
          <div class="quiz-meta">
            <span class="quiz-difficulty" id="quiz-difficulty"></span>
            <span class="quiz-category" id="quiz-category"></span>
          </div>
          <div class="quiz-question-text" id="quiz-question-text"></div>
          <div class="quiz-answers" id="quiz-answers"></div>
          <div class="quiz-timer-bar-track">
            <div class="quiz-timer-bar" id="quiz-timer-bar"></div>
          </div>
          <div class="quiz-footer">
            <span class="quiz-instruction">Type A, B, C, or D in chat!</span>
            <span class="quiz-answer-count" id="quiz-answer-count"></span>
          </div>
        </div>
      </div>

      <div class="quiz-loading">
        <div class="quiz-loading-text" id="quiz-loading-text">Loading questions...</div>
      </div>

      <div class="quiz-leaderboard">
        <div class="quiz-lb-title">Leaderboard</div>
        <div class="quiz-lb-list" id="quiz-lb-list"></div>
        <div class="quiz-lb-total" id="quiz-lb-total"></div>
      </div>
    `;

    this.container.appendChild(root);

    this.ui = {
      root,
      questionCounter: root.querySelector('#quiz-question-counter'),
      timerText: root.querySelector('#quiz-timer-text'),
      difficulty: root.querySelector('#quiz-difficulty'),
      category: root.querySelector('#quiz-category'),
      questionText: root.querySelector('#quiz-question-text'),
      answersContainer: root.querySelector('#quiz-answers'),
      timerBar: root.querySelector('#quiz-timer-bar'),
      answerCount: root.querySelector('#quiz-answer-count'),
      loadingText: root.querySelector('#quiz-loading-text'),
      leaderboardList: root.querySelector('#quiz-lb-list'),
      leaderboardTotal: root.querySelector('#quiz-lb-total'),
    };
  }
}
