import { BaseOverlay } from '../core/base-overlay.js';

/**
 * Tip the Scales overlay
 * Chat commands push a seesaw left/right within a 90s match.
 */
export class ScalesOverlay extends BaseOverlay {
  constructor(config) {
    super(config);
    this.settings = {
      ...config.settings,
      durationMs: config.settings?.durationMs ?? 90000,
      maxTilt: config.settings?.maxTilt ?? 100,
      gravityPerSecond: config.settings?.gravityPerSecond ?? 0.25,
      voteWeight: config.settings?.voteWeight ?? 1,
      bigJumpWeight: config.settings?.bigJumpWeight ?? 50,
      bigJumpMinMs: config.settings?.bigJumpMinMs ?? 15000,
      bigJumpMaxMs: config.settings?.bigJumpMaxMs ?? 20000,
      tickMs: config.settings?.tickMs ?? 100,
      maxWinnerNames: config.settings?.maxWinnerNames ?? 30,
    };

    this.balance = 0;
    this.startTime = 0;
    this.lastTick = 0;
    this.intervalId = null;
    this.gameState = 'idle';

    this.nextBigJumpAt = 0;
    this.activeBigJumpCommand = null;
    this.lastBigJumpBy = null;

    this.leftTriggers = new Set(['LEFT', 'L', '1']);
    this.rightTriggers = new Set(['RIGHT', 'R', '2']);
    this.bigJumpCommands = ['!SLAM', '!JUMP', '!SMASH', '!CRASH', '!THUMP', '!BOOM'];
    this.lastSideByUser = new Map();

    this.ui = {};
  }

  onInit() {
    console.log('Scales overlay initialized');
    this.buildUI();
    this.startGame();
  }

  onMessage(message) {
    if (this.gameState !== 'running') return;

    const tokens = this.tokenize(message.message);
    if (tokens.length === 0) return;

    const leftCount = tokens.filter(token => this.leftTriggers.has(token)).length;
    const rightCount = tokens.filter(token => this.rightTriggers.has(token)).length;

    if (leftCount > 0 || rightCount > 0) {
      const delta = (rightCount - leftCount) * this.settings.voteWeight;
      this.adjustBalance(delta);

      if (rightCount > leftCount) {
        this.lastSideByUser.set(message.username, 'right');
      } else if (leftCount > rightCount) {
        this.lastSideByUser.set(message.username, 'left');
      }
    }

    if (this.activeBigJumpCommand && tokens.includes(this.activeBigJumpCommand)) {
      const jumpSide = this.resolveJumpSide(message.username, leftCount, rightCount);
      if (jumpSide) {
        const jumpDelta = jumpSide === 'right'
          ? this.settings.bigJumpWeight
          : -this.settings.bigJumpWeight;
        this.adjustBalance(jumpDelta);
        this.lastBigJumpBy = message.username;
        this.consumeBigJump();
      }
    }
  }

  tokenize(text) {
    const matches = text.toUpperCase().match(/[A-Z0-9!]+/g);
    return matches || [];
  }

  resolveJumpSide(username, leftCount, rightCount) {
    if (rightCount > leftCount) return 'right';
    if (leftCount > rightCount) return 'left';
    return this.lastSideByUser.get(username) || null;
  }

  buildUI() {
    const root = document.createElement('div');
    root.className = 'scales-root';

    root.innerHTML = `
      <div class="scales-header">
        <div class="scales-title">Tip the Scales</div>
        <div class="scales-timer" id="scales-timer">01:30</div>
      </div>
      <div class="scales-status" id="scales-status">Waiting for chat...</div>
      <div class="scales-meter">
        <div class="scales-meter-track"></div>
        <div class="scales-meter-center"></div>
        <div class="scales-meter-indicator" id="scales-meter-indicator"></div>
        <div class="scales-meter-labels">
          <span>Left</span>
          <span>Right</span>
        </div>
      </div>
      <div class="scales-seesaw">
        <div class="scales-ground left"></div>
        <div class="scales-ground right"></div>
        <div class="scales-pivot"></div>
        <div class="scales-beam" id="scales-beam"></div>
      </div>
      <div class="scales-big-jump" id="scales-big-jump"></div>
      <div class="scales-score" id="scales-score">Balance: 0</div>
      <div class="scales-celebration" id="scales-celebration"></div>
    `;

    this.container.appendChild(root);

    this.ui = {
      root,
      timer: root.querySelector('#scales-timer'),
      status: root.querySelector('#scales-status'),
      meterIndicator: root.querySelector('#scales-meter-indicator'),
      beam: root.querySelector('#scales-beam'),
      bigJump: root.querySelector('#scales-big-jump'),
      score: root.querySelector('#scales-score'),
      celebration: root.querySelector('#scales-celebration')
    };
  }

  startGame() {
    this.balance = 0;
    this.startTime = performance.now();
    this.lastTick = this.startTime;
    this.gameState = 'running';
    this.lastBigJumpBy = null;

    this.scheduleNextBigJump();
    this.updateBigJumpPrompt();
    this.updateUI();

    this.intervalId = setInterval(() => this.tick(), this.settings.tickMs);
    this.ui.status.textContent = 'Type L / R to tip the scales!';
  }

  tick() {
    if (this.gameState !== 'running') return;

    const now = performance.now();
    const deltaMs = now - this.lastTick;
    this.lastTick = now;

    this.applyGravity(deltaMs / 1000);
    this.updateBigJump(now);
    this.checkEndConditions(now);
    this.updateUI();
  }

  applyGravity(deltaSeconds) {
    if (this.balance === 0) return;

    const drift = this.settings.gravityPerSecond * deltaSeconds;
    if (this.balance > 0) {
      this.balance = Math.max(0, this.balance - drift);
    } else {
      this.balance = Math.min(0, this.balance + drift);
    }
  }

  adjustBalance(delta) {
    this.balance += delta;
    this.balance = Math.max(-this.settings.maxTilt, Math.min(this.settings.maxTilt, this.balance));
    this.checkImmediateEnd();
  }

  checkImmediateEnd() {
    if (this.balance <= -this.settings.maxTilt) {
      this.endGame('left');
    } else if (this.balance >= this.settings.maxTilt) {
      this.endGame('right');
    }
  }

  checkEndConditions(now) {
    if (this.gameState !== 'running') return;

    if (this.balance <= -this.settings.maxTilt) {
      this.endGame('left');
      return;
    }

    if (this.balance >= this.settings.maxTilt) {
      this.endGame('right');
      return;
    }

    if (now - this.startTime >= this.settings.durationMs) {
      this.endGame('time');
    }
  }

  endGame(reason) {
    if (this.gameState === 'ended') return;

    this.gameState = 'ended';
    clearInterval(this.intervalId);
    this.intervalId = null;

    let statusMessage = 'Game over!';
    if (reason === 'left') {
      statusMessage = 'Left side wins! Ground touched.';
      this.celebrateWinners('left');
    } else if (reason === 'right') {
      statusMessage = 'Right side wins! Ground touched.';
      this.celebrateWinners('right');
    } else if (reason === 'time') {
      if (this.balance > 0) {
        statusMessage = 'Time! Right side wins on advantage.';
        this.celebrateWinners('right');
      } else if (this.balance < 0) {
        statusMessage = 'Time! Left side wins on advantage.';
        this.celebrateWinners('left');
      } else {
        statusMessage = 'Time! It is a draw.';
      }
    }

    this.ui.status.textContent = statusMessage;
    this.ui.bigJump.textContent = '';
    this.updateUI();
  }

  updateBigJump(now) {
    if (this.activeBigJumpCommand) return;
    if (now < this.nextBigJumpAt) return;

    const command = this.bigJumpCommands[Math.floor(Math.random() * this.bigJumpCommands.length)];
    this.activeBigJumpCommand = command;
    this.ui.bigJump.textContent = `BIG JUMP! Type ${command} to slam it.`;
  }

  consumeBigJump() {
    this.activeBigJumpCommand = null;
    this.updateBigJumpPrompt();
    this.scheduleNextBigJump();
  }

  scheduleNextBigJump() {
    const now = performance.now();
    const spread = this.settings.bigJumpMaxMs - this.settings.bigJumpMinMs;
    const delay = this.settings.bigJumpMinMs + Math.random() * Math.max(0, spread);
    this.nextBigJumpAt = now + delay;
  }

  updateBigJumpPrompt() {
    if (this.activeBigJumpCommand) return;
    this.ui.bigJump.textContent = 'Push the scales: type LEFT or RIGHT (L / R)';
  }

  celebrateWinners(side) {
    if (!this.ui.celebration) return;

    const winners = [];
    for (const [username, userSide] of this.lastSideByUser.entries()) {
      if (userSide === side) winners.push(username);
    }

    if (winners.length === 0) {
      this.ui.celebration.textContent = 'No winners recorded.';
      this.ui.celebration.classList.add('visible');
      return;
    }

    const uniqueWinners = Array.from(new Set(winners));
    const shuffled = uniqueWinners.sort(() => Math.random() - 0.5);
    const limited = shuffled.slice(0, this.settings.maxWinnerNames);

    this.ui.celebration.innerHTML = '';
    this.ui.celebration.classList.add('visible');

    limited.forEach(name => {
      const burst = document.createElement('div');
      burst.className = 'scales-winner';
      burst.textContent = name;
      burst.style.left = `${10 + Math.random() * 80}%`;
      burst.style.top = `${10 + Math.random() * 70}%`;
      burst.style.animationDelay = `${Math.random() * 3}s`;
      this.ui.celebration.appendChild(burst);
    });
  }

  updateUI() {
    const elapsed = Math.min(performance.now() - this.startTime, this.settings.durationMs);
    const remainingMs = Math.max(0, this.settings.durationMs - elapsed);
    this.ui.timer.textContent = this.formatTime(remainingMs);

    const percent = (this.balance + this.settings.maxTilt) / (this.settings.maxTilt * 2);
    const clampedPercent = Math.max(0, Math.min(1, percent));
    this.ui.meterIndicator.style.left = `${clampedPercent * 100}%`;

    const maxAngle = 12;
    const angle = (this.balance / this.settings.maxTilt) * maxAngle;
    this.ui.beam.style.transform = `translateX(-50%) rotate(${angle}deg)`;

    const status = this.balance === 0
      ? 'Centered'
      : this.balance > 0
        ? `Tipping Right (${Math.round(this.balance)})`
        : `Tipping Left (${Math.round(this.balance)})`;
    if (this.gameState === 'running') {
      this.ui.status.textContent = status;
    }

    this.ui.score.textContent = `Balance: ${Math.round(this.balance)}`;
  }

  formatTime(ms) {
    const totalSeconds = Math.ceil(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
}
