import { BaseOverlay } from '../core/base-overlay.js';
import {
  CLASSES, SPRITE_FRAMES, HATS,
  buildSpriteShadow, gridOriginColor, classPalette, resolvePrimary,
  randomPlayableClass, CELL_SIZE,
} from './classes.js';
import {
  resolveProfile, setViewerClass, setViewerColor, setViewerHat,
} from './profiles.js';

const KNIGHT_BLOCK_CHANCE = 0.30; // overrides knight's listed eva when defending

export class PixelBrawlerOverlay extends BaseOverlay {
  constructor(config) {
    super(config);
    this.settings = {
      turnDurationMs: config.settings?.turnDurationMs ?? 25000,
      victoryDurationMs: config.settings?.victoryDurationMs ?? 10000,
      animationDurationMs: config.settings?.animationDurationMs ?? 2500,
      tickMs: config.settings?.tickMs ?? 100,
      maxCrowd: config.settings?.maxCrowd ?? 12,
      crowdTrickleMs: config.settings?.crowdTrickleMs ?? 4500,
      specialMeterMax: 3,
    };

    this.gameState = 'idle';
    this.players = [null, null];
    this.activePlayerIdx = 0;
    this.turnEndsAt = 0;
    this.intervalId = null;

    this.crowd = [];
    this.recentChatters = new Map(); // usernameLower -> { username, color, lastSeenAt }
    this.lastTrickleAt = 0;

    this.ui = {};
  }

  onInit() {
    this.buildUI();
    this.generateGrass();
    this.setState('idle');
    this.intervalId = setInterval(() => this.tick(), this.settings.tickMs);
  }

  // Spawn random grass blades along the dirt strip. Generated once at startup
  // so positions are stable. Z-ordered above .crowd-char (via .grass-layer's
  // z-index) so character lower legs are partially obscured — creates the
  // "walking through grass" effect for front-lane chars whose feet land at
  // the grass-tip level.
  generateGrass() {
    const layer = document.createElement('div');
    layer.className = 'grass-layer';

    const w = window.innerWidth;
    const spacing = 14; // average px between blades
    const numBlades = Math.floor(w / spacing);

    for (let i = 0; i < numBlades; i++) {
      const blade = document.createElement('div');
      blade.className = 'grass-blade';
      blade.style.left = `${i * spacing + Math.random() * (spacing - 2)}px`;
      blade.style.height = `${5 + Math.floor(Math.random() * 7)}px`; // 5–11px
      blade.style.width = `${1 + Math.floor(Math.random() * 2)}px`;  // 1–2px
      // Slight green-shade variation per blade
      const tint = Math.floor(Math.random() * 35);
      blade.style.background = `rgb(${52 + tint}, ${112 + tint}, ${42 + tint})`;
      layer.appendChild(blade);
    }

    this.ui.crowdLayer.appendChild(layer);
  }

  // ───────────────────────────── chat / commands ────────────────────────────

  onMessage(message) {
    const usernameLower = message.username.toLowerCase();
    this.recentChatters.set(usernameLower, {
      username: message.username,
      color: message.color,
      lastSeenAt: performance.now(),
    });
    if (this.recentChatters.size > 50) {
      // LRU evict
      const oldestKey = this.recentChatters.keys().next().value;
      this.recentChatters.delete(oldestKey);
    }

    // First !-prefixed token wins
    const tokens = message.message.trim().split(/\s+/);
    let cmdIdx = -1;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].startsWith('!')) { cmdIdx = i; break; }
    }
    if (cmdIdx !== -1) {
      const cmd = tokens[cmdIdx].toLowerCase();
      const arg = tokens[cmdIdx + 1] || null;
      this.handleCommand(cmd, arg, message);
    }

    // Crowd reaction: any chat from a chatter who's on screen → chatting state
    if (this.gameState === 'idle') {
      const existing = this.crowd.find(c => c.usernameLower === usernameLower);
      if (existing) {
        this.enterChattingState(existing);
      } else if (this.crowd.length < this.settings.maxCrowd) {
        this.spawnCrowdChar(message.username, message.color, true);
      }
    }
  }

  handleCommand(cmd, arg, message) {
    switch (cmd) {
      case '!class':
        if (arg && setViewerClass(message.username, arg)) {
          this.refreshCrowdAppearance(message.username.toLowerCase());
        }
        break;
      case '!color':
        if (arg && setViewerColor(message.username, arg)) {
          this.refreshCrowdAppearance(message.username.toLowerCase());
        }
        break;
      case '!hat':
        if (arg && setViewerHat(message.username, arg)) {
          this.refreshCrowdAppearance(message.username.toLowerCase());
        }
        break;
      case '!join':
        this.handleJoin(message);
        break;
      case '!attack':
        this.handlePlayerAttack(message, false);
        break;
      case '!special':
        this.handlePlayerAttack(message, true);
        break;
      case '!resetbrawl':
        if (this.isModOrBroadcaster(message)) {
          this.forceResetToIdle();
        }
        break;
    }
  }

  // Re-render an existing crowd character's sprite to reflect a fresh profile.
  // Called from !class/!color/!hat handlers so changes are visible immediately
  // instead of waiting for the next spawn. Mid-brawl player sprites are
  // intentionally NOT touched — those are locked at standoff per the design.
  refreshCrowdAppearance(usernameLower) {
    const char = this.crowd.find(c => c.usernameLower === usernameLower);
    if (!char) return;

    const profile = resolveProfile(usernameLower);
    const newClassId = profile?.class || 'villager';
    const colorId = profile?.color;
    const hatId = profile?.hat;

    char.classId = newClassId;
    char.sprite.style.setProperty('--armor-primary', resolvePrimary(newClassId, colorId));

    // Pick the right frame for the current behavior state.
    const frameKey = char.behaviorState === 'sitting'
      ? 'sit'
      : (char.walkFrameAlt ? 'walk2' : 'walk1');
    this.applySpriteFrame(char.sprite, newClassId, frameKey);

    // Hat lives in the same sprite-holder as the sprite. Find and replace.
    const holder = char.sprite.parentElement;
    if (holder) {
      const oldHat = holder.querySelector('.hat-sprite');
      if (oldHat) oldHat.remove();
      if (hatId && hatId !== 'none') {
        const hat = document.createElement('div');
        hat.className = 'hat-sprite';
        this.applyHatFrame(hat, hatId);
        holder.appendChild(hat);
      }
    }
  }

  isModOrBroadcaster(message) {
    if (message.moderator) return true;
    const channel = this.config.twitch?.channel || this.config.kick?.channel || '';
    return message.username.toLowerCase() === channel.toLowerCase();
  }

  // ───────────────────────────── join / setup ───────────────────────────────

  handleJoin(message) {
    if (this.gameState !== 'idle') return;
    const usernameLower = message.username.toLowerCase();
    if (this.players[0] && this.players[0].usernameLower === usernameLower) return;

    const profile = resolveProfile(message.username);
    let classId = profile?.class;
    if (!classId || classId === 'villager') classId = randomPlayableClass();

    const player = this.makePlayer(message.username, classId, profile?.color, profile?.hat, message.color);

    if (!this.players[0]) {
      this.players[0] = player;
      this.updateIdleHint();
    } else if (!this.players[1]) {
      this.players[1] = player;
      this.startBrawl();
    }
  }

  makePlayer(username, classId, colorId, hatId, chatColor) {
    const cls = CLASSES[classId];
    return {
      username,
      usernameLower: username.toLowerCase(),
      chatColor: chatColor || '#ffffff',
      classId,
      colorId,
      hatId,
      hp: cls.hp,
      maxHp: cls.hp,
      special: 0,
    };
  }

  // ───────────────────────────── brawl flow ─────────────────────────────────

  startBrawl() {
    this.setState('standoff');
    this.fadeOutCrowd();
    this.renderBrawlers();
    this.ui.status.innerHTML =
      `<b>${esc(this.players[0].username)}</b> (${CLASSES[this.players[0].classId].label})` +
      ` vs <b>${esc(this.players[1].username)}</b> (${CLASSES[this.players[1].classId].label})!`;

    setTimeout(() => {
      if (this.gameState !== 'standoff') return;
      this.activePlayerIdx = Math.random() < 0.5 ? 0 : 1;
      this.beginTurn();
    }, 1500);
  }

  beginTurn() {
    this.setState('active_turn');
    this.turnEndsAt = performance.now() + this.settings.turnDurationMs;
    this.updateTurnIndicator();
  }

  handlePlayerAttack(message, isSpecial) {
    if (this.gameState !== 'active_turn') return;
    const attacker = this.players[this.activePlayerIdx];
    if (!attacker || attacker.usernameLower !== message.username.toLowerCase()) return;
    if (isSpecial && attacker.special < this.settings.specialMeterMax) return;

    this.executeAttack(isSpecial);
  }

  executeAttack(isSpecial) {
    const attackerIdx = this.activePlayerIdx;
    const defenderIdx = 1 - attackerIdx;
    const attacker = this.players[attackerIdx];
    const defender = this.players[defenderIdx];
    const cls = CLASSES[attacker.classId];

    this.setState('animating_attack');

    const spec = isSpecial ? cls.special : null;
    const hits = spec?.hits || 1;
    const dmgRange = spec ? spec.dmg : cls.atk;
    const accBonus = spec?.accBonus || 0;
    const bypassEvasion = spec?.bypassEvasion || false;
    const autoCrit = spec?.autoCrit || false;

    const events = [];
    let totalDmg = 0;
    for (let i = 0; i < hits; i++) {
      const result = this.resolveAttack(attacker, defender, accBonus, bypassEvasion, autoCrit, dmgRange);
      events.push(result);
      totalDmg += result.damage;
    }

    defender.hp = Math.max(0, defender.hp - totalDmg);

    if (isSpecial) {
      attacker.special = 0;
    } else {
      attacker.special = Math.min(this.settings.specialMeterMax, attacker.special + 1);
    }

    const isKill = defender.hp <= 0;
    const isKillingSpecial = isKill && isSpecial;

    this.animateAttack(attackerIdx, defenderIdx, events, totalDmg, isSpecial, isKillingSpecial);

    const animDuration = isKillingSpecial
      ? this.settings.animationDurationMs * 1.6
      : this.settings.animationDurationMs;

    setTimeout(() => {
      if (this.gameState !== 'animating_attack') return;
      this.updateBrawlerUI();
      if (isKill) {
        this.endBrawl(attackerIdx);
      } else {
        this.activePlayerIdx = defenderIdx;
        this.beginTurn();
      }
    }, animDuration);
  }

  resolveAttack(attacker, defender, accBonus, bypassEvasion, autoCrit, dmgRange) {
    const cls = CLASSES[attacker.classId];
    const defCls = CLASSES[defender.classId];

    const d20 = Math.floor(Math.random() * 20) + 1;

    let hit = false;
    let crit = false;
    let evaded = false;
    let blocked = false;

    if (d20 === 1) {
      hit = false;
    } else if (d20 === 20) {
      hit = true;
      crit = true;
    } else {
      const accuracy = Math.min(0.99, cls.acc + accBonus);
      hit = (d20 / 20) <= accuracy;

      if (hit && !bypassEvasion) {
        const evaChance = defender.classId === 'knight' ? KNIGHT_BLOCK_CHANCE : defCls.eva;
        if (Math.random() < evaChance) {
          hit = false;
          evaded = true;
          if (defender.classId === 'knight') blocked = true;
        }
      }

      if (hit) {
        if (autoCrit) crit = true;
        else if (Math.random() < cls.crit) crit = true;
      }
    }

    let damage = 0;
    if (hit) {
      damage = randInt(dmgRange.min, dmgRange.max);
      if (crit) damage *= 2;
    }

    return { hit, crit, evaded, blocked, damage, d20 };
  }

  endBrawl(winnerIdx) {
    this.setState('victory');
    if (winnerIdx !== null && this.players[winnerIdx]) {
      this.showVictory(winnerIdx);
    } else {
      this.ui.victory.innerHTML = '';
      this.ui.victory.classList.remove('visible');
    }

    setTimeout(() => {
      this.players = [null, null];
      this.ui.victory.classList.remove('visible');
      this.setState('idle');
      this.updateIdleHint();
    }, this.settings.victoryDurationMs);
  }

  forceResetToIdle() {
    this.players = [null, null];
    this.ui.victory.classList.remove('visible');
    this.setState('idle');
    this.updateIdleHint();
  }

  // ───────────────────────────── tick ───────────────────────────────────────

  tick() {
    if (this.gameState === 'active_turn') this.tickTurnTimer();
    if (this.gameState === 'idle') this.tickCrowd();
  }

  tickTurnTimer() {
    const now = performance.now();
    const remaining = Math.max(0, this.turnEndsAt - now);
    this.ui.turnTimer.textContent = `${Math.ceil(remaining / 1000)}s`;
    if (remaining > 0) return;

    // Timeout — scratch damage on the active player
    const attacker = this.players[this.activePlayerIdx];
    if (!attacker) return;
    attacker.hp = Math.max(0, attacker.hp - 5);

    this.setState('animating_attack');
    this.ui.status.innerHTML = `${esc(attacker.username)} stalls and stumbles! −5 HP`;
    this.spawnDamageNumber(this.activePlayerIdx, 5, false);
    this.updateBrawlerUI();

    const isKill = attacker.hp <= 0;
    setTimeout(() => {
      if (this.gameState !== 'animating_attack') return;
      if (isKill) {
        this.endBrawl(1 - this.activePlayerIdx);
      } else {
        this.activePlayerIdx = 1 - this.activePlayerIdx;
        this.beginTurn();
      }
    }, this.settings.animationDurationMs);
  }

  // ───────────────────────────── crowd ──────────────────────────────────────

  tickCrowd() {
    const now = performance.now();

    // Trickle in a recent chatter when the crowd looks thin
    if (this.crowd.length < 3 &&
        this.recentChatters.size > 0 &&
        now - this.lastTrickleAt > this.settings.crowdTrickleMs) {
      this.lastTrickleAt = now;
      this.spawnTrickleChar();
    }

    const dt = this.settings.tickMs / 1000;

    for (let i = this.crowd.length - 1; i >= 0; i--) {
      const char = this.crowd[i];

      if (now > char.expiresAt) {
        char.el.remove();
        this.crowd.splice(i, 1);
        continue;
      }

      switch (char.behaviorState) {
        case 'walking': {
          char.x += char.dir * char.speed * dt;
          if (now - char.lastFrameSwapAt > 250) {
            char.walkFrameAlt = !char.walkFrameAlt;
            this.applySpriteFrame(char.sprite, char.classId, char.walkFrameAlt ? 'walk2' : 'walk1');
            char.lastFrameSwapAt = now;
          }
          char.el.style.left = `${char.x}px`;
          if (char.x < -120 || char.x > window.innerWidth + 120) {
            char.el.remove();
            this.crowd.splice(i, 1);
            continue;
          }
          if (now > char.nextDecisionAt) {
            this.makeBehaviorDecision(char);
          }
          break;
        }
        case 'pausing':
          if (now > char.stateExpiresAt) {
            char.behaviorState = 'walking';
            char.nextDecisionAt = now + 3000 + Math.random() * 5000;
          }
          break;
        case 'sitting':
          if (now > char.stateExpiresAt) {
            char.behaviorState = 'walking';
            char.nextDecisionAt = now + 3000 + Math.random() * 5000;
            this.applySpriteFrame(char.sprite, char.classId, 'walk1');
            char.lastFrameSwapAt = now;
          }
          break;
        case 'chatting':
          if (now > char.stateExpiresAt) {
            char.behaviorState = char.previousState || 'walking';
            this.detachSpeechBubble(char);
            char.nextDecisionAt = now + 3000 + Math.random() * 5000;
          }
          break;
      }
    }
  }

  makeBehaviorDecision(char) {
    const r = Math.random();
    const now = performance.now();
    if (r < 0.7) {
      char.nextDecisionAt = now + 3000 + Math.random() * 5000;
    } else if (r < 0.9) {
      char.behaviorState = 'pausing';
      char.stateExpiresAt = now + 1500 + Math.random() * 2500;
    } else {
      char.behaviorState = 'sitting';
      char.stateExpiresAt = now + 3000 + Math.random() * 3000;
      this.applySpriteFrame(char.sprite, char.classId, 'sit');
    }
  }

  spawnTrickleChar() {
    const usernames = [...this.recentChatters.keys()];
    if (usernames.length === 0) return;
    const lower = usernames[Math.floor(Math.random() * usernames.length)];
    if (this.crowd.find(c => c.usernameLower === lower)) return;
    const data = this.recentChatters.get(lower);
    this.spawnCrowdChar(data.username, data.color, false);
  }

  spawnCrowdChar(username, chatColor, startChatting = false) {
    if (this.crowd.length >= this.settings.maxCrowd) {
      const oldest = this.crowd.shift();
      oldest.el.remove();
    }

    const profile = resolveProfile(username);
    const classId = profile?.class || 'villager';
    const colorId = profile?.color;
    const hatId = profile?.hat;

    const dir = Math.random() < 0.5 ? -1 : 1;
    const speed = 60 + Math.random() * 70;
    // Single front lane — feet land at the grass tips so characters appear to
    // walk through the grass. ±4px jitter keeps passing sprites from perfectly
    // overlapping pixel-for-pixel (which reads as a render glitch).
    const yJitterPx = Math.round((Math.random() - 0.5) * 8);

    const startX = dir > 0 ? -80 : window.innerWidth + 80;

    const wrap = document.createElement('div');
    wrap.className = 'crowd-char';
    wrap.style.left = `${startX}px`;
    wrap.style.top = `calc(90% + ${yJitterPx}px)`;
    wrap.style.setProperty('--face-x', dir > 0 ? '1' : '-1');

    const nameLabel = document.createElement('div');
    nameLabel.className = 'crowd-name';
    nameLabel.textContent = username;
    nameLabel.style.color = chatColor || '#fff';
    wrap.appendChild(nameLabel);

    const spriteHolder = document.createElement('div');
    spriteHolder.className = 'sprite-holder';
    wrap.appendChild(spriteHolder);

    const sprite = document.createElement('div');
    sprite.className = 'sprite';
    sprite.style.setProperty('--armor-primary', resolvePrimary(classId, colorId));
    this.applySpriteFrame(sprite, classId, 'walk1');
    spriteHolder.appendChild(sprite);

    if (hatId && hatId !== 'none') {
      const hat = document.createElement('div');
      hat.className = 'hat-sprite';
      this.applyHatFrame(hat, hatId);
      spriteHolder.appendChild(hat);
    }

    this.ui.crowdLayer.appendChild(wrap);

    const now = performance.now();
    const char = {
      el: wrap,
      sprite,
      username,
      usernameLower: username.toLowerCase(),
      classId,
      x: startX,
      dir,
      speed,
      behaviorState: startChatting ? 'chatting' : 'walking',
      previousState: 'walking',
      stateExpiresAt: startChatting ? now + 4000 : now + 60000,
      nextDecisionAt: now + 3000 + Math.random() * 5000,
      expiresAt: now + 60000,
      walkFrameAlt: false,
      lastFrameSwapAt: now,
      bubbleEl: null,
    };

    if (startChatting) this.attachSpeechBubble(char);

    this.crowd.push(char);
  }

  enterChattingState(char) {
    if (char.behaviorState !== 'chatting') {
      char.previousState = char.behaviorState;
    }
    char.behaviorState = 'chatting';
    char.stateExpiresAt = performance.now() + 4000;
    this.applySpriteFrame(char.sprite, char.classId, 'walk1');
    this.attachSpeechBubble(char);
  }

  attachSpeechBubble(char) {
    if (char.bubbleEl) return;
    const bubble = document.createElement('div');
    bubble.className = 'speech-bubble';
    bubble.innerHTML =
      '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
    char.el.appendChild(bubble);
    char.bubbleEl = bubble;
  }

  detachSpeechBubble(char) {
    if (char.bubbleEl) {
      char.bubbleEl.remove();
      char.bubbleEl = null;
    }
  }

  fadeOutCrowd() {
    this.crowd.forEach(c => c.el.classList.add('fading-out'));
    setTimeout(() => {
      this.crowd.forEach(c => c.el.remove());
      this.crowd = [];
    }, 400);
  }

  // ───────────────────────────── sprite rendering ───────────────────────────

  applySpriteFrame(spriteEl, classId, frameKey) {
    const frames = SPRITE_FRAMES[classId];
    if (!frames) return;
    const grid = frames[frameKey] || frames.walk1;
    const palette = classPalette(classId);
    spriteEl.style.boxShadow = buildSpriteShadow(grid, palette);
    // Also paint the (0,0) cell as background — see gridOriginColor docs.
    spriteEl.style.background = gridOriginColor(grid, palette) || 'transparent';
  }

  applyHatFrame(hatEl, hatId) {
    const hat = HATS[hatId];
    if (!hat) return;
    hatEl.style.boxShadow = buildSpriteShadow(hat.grid, hat.palette);
    hatEl.style.background = gridOriginColor(hat.grid, hat.palette) || 'transparent';
    hatEl.style.top = `${hat.offsetRow * CELL_SIZE}px`;
  }

  // ───────────────────────────── UI scaffolding ─────────────────────────────

  buildUI() {
    const root = document.createElement('div');
    root.className = 'brawler-root';
    root.dataset.state = 'idle';

    root.innerHTML = `
      <div class="brawler-stage" id="brawler-stage">
        <div class="brawler-header">
          <div class="brawler-title">PIXEL BRAWLER</div>
          <div class="brawler-turn-indicator" id="brawler-turn"></div>
        </div>
        <div class="brawler-fight">
          <div class="brawler-side" data-side="left" id="brawler-side-0">
            <div class="brawler-info">
              <div class="brawler-name" id="brawler-name-0"></div>
              <div class="brawler-class" id="brawler-class-0"></div>
              <div class="brawler-pips" id="brawler-pips-0"></div>
              <div class="brawler-hp-track">
                <div class="brawler-hp-fill" id="brawler-hp-0"></div>
                <div class="brawler-hp-text" id="brawler-hp-text-0"></div>
              </div>
            </div>
            <div class="brawler-arena" id="brawler-arena-0"></div>
          </div>
          <div class="brawler-vs">VS</div>
          <div class="brawler-side" data-side="right" id="brawler-side-1">
            <div class="brawler-info">
              <div class="brawler-name" id="brawler-name-1"></div>
              <div class="brawler-class" id="brawler-class-1"></div>
              <div class="brawler-pips" id="brawler-pips-1"></div>
              <div class="brawler-hp-track">
                <div class="brawler-hp-fill" id="brawler-hp-1"></div>
                <div class="brawler-hp-text" id="brawler-hp-text-1"></div>
              </div>
            </div>
            <div class="brawler-arena" id="brawler-arena-1"></div>
          </div>
        </div>
        <div class="brawler-status" id="brawler-status"></div>
      </div>

      <div class="brawler-idle-hint" id="brawler-idle-hint"></div>
      <div class="crowd-layer" id="crowd-layer">
        <div class="ground-strip"></div>
      </div>
      <div class="brawler-victory" id="brawler-victory"></div>
    `;

    this.container.appendChild(root);

    this.ui = {
      root,
      stage: root.querySelector('#brawler-stage'),
      turnTimer: root.querySelector('#brawler-turn'),
      sides: [
        root.querySelector('#brawler-side-0'),
        root.querySelector('#brawler-side-1'),
      ],
      names: [
        root.querySelector('#brawler-name-0'),
        root.querySelector('#brawler-name-1'),
      ],
      classes: [
        root.querySelector('#brawler-class-0'),
        root.querySelector('#brawler-class-1'),
      ],
      pips: [
        root.querySelector('#brawler-pips-0'),
        root.querySelector('#brawler-pips-1'),
      ],
      hpFills: [
        root.querySelector('#brawler-hp-0'),
        root.querySelector('#brawler-hp-1'),
      ],
      hpTexts: [
        root.querySelector('#brawler-hp-text-0'),
        root.querySelector('#brawler-hp-text-1'),
      ],
      arenas: [
        root.querySelector('#brawler-arena-0'),
        root.querySelector('#brawler-arena-1'),
      ],
      status: root.querySelector('#brawler-status'),
      idleHint: root.querySelector('#brawler-idle-hint'),
      crowdLayer: root.querySelector('#crowd-layer'),
      victory: root.querySelector('#brawler-victory'),
    };

    this.updateIdleHint();
  }

  setState(state) {
    this.gameState = state;
    this.ui.root.dataset.state = state;
  }

  updateIdleHint() {
    if (this.players[0] && !this.players[1]) {
      this.ui.idleHint.innerHTML =
        `<b>${esc(this.players[0].username)}</b> ` +
        `(${CLASSES[this.players[0].classId].label}) is waiting — ` +
        `type <b>!join</b> to challenge!`;
    } else {
      this.ui.idleHint.innerHTML =
        `Type <b>!class &lt;name&gt;</b> to pick a class, then <b>!join</b> to brawl. ` +
        `Customize with <b>!color</b> and <b>!hat</b>.`;
    }
  }

  renderBrawlers() {
    for (let i = 0; i < 2; i++) {
      const player = this.players[i];
      const cls = CLASSES[player.classId];
      this.ui.names[i].textContent = player.username;
      this.ui.names[i].style.color = player.chatColor;
      this.ui.classes[i].textContent = cls.label;
      this.renderPips(i);
      this.renderHp(i);
      this.renderBrawlerSprite(i);
    }
  }

  renderBrawlerSprite(i) {
    const player = this.players[i];
    const arena = this.ui.arenas[i];
    arena.innerHTML = '';

    const holder = document.createElement('div');
    holder.className = 'sprite-holder sprite-holder-large';
    if (i === 1) holder.classList.add('mirror-x');
    arena.appendChild(holder);

    const sprite = document.createElement('div');
    sprite.className = 'sprite';
    sprite.style.setProperty('--armor-primary', resolvePrimary(player.classId, player.colorId));
    this.applySpriteFrame(sprite, player.classId, 'walk1');
    holder.appendChild(sprite);

    if (player.hatId && player.hatId !== 'none') {
      const hat = document.createElement('div');
      hat.className = 'hat-sprite';
      this.applyHatFrame(hat, player.hatId);
      holder.appendChild(hat);
    }
  }

  renderPips(i) {
    const player = this.players[i];
    const pipsEl = this.ui.pips[i];
    pipsEl.innerHTML = '';
    for (let p = 0; p < this.settings.specialMeterMax; p++) {
      const pip = document.createElement('span');
      pip.className = 'pip' + (p < player.special ? ' on' : '');
      pipsEl.appendChild(pip);
    }
  }

  renderHp(i) {
    const player = this.players[i];
    const fill = this.ui.hpFills[i];
    const text = this.ui.hpTexts[i];
    const pct = (player.hp / player.maxHp) * 100;
    fill.style.width = `${pct}%`;
    text.textContent = `${player.hp} / ${player.maxHp}`;
  }

  updateBrawlerUI() {
    for (let i = 0; i < 2; i++) {
      if (this.players[i]) {
        this.renderHp(i);
        this.renderPips(i);
      }
    }
  }

  updateTurnIndicator() {
    const active = this.players[this.activePlayerIdx];
    if (!active) return;
    this.ui.turnTimer.textContent = `${Math.ceil(this.settings.turnDurationMs / 1000)}s`;
    const specReady = active.special >= this.settings.specialMeterMax;
    this.ui.status.innerHTML =
      `<b style="color: ${active.chatColor}">${esc(active.username)}</b>'s turn — ` +
      `type <b>!attack</b>${specReady ? ' or <b>!special</b>' : ''}`;
    this.ui.sides[0].classList.toggle('active', this.activePlayerIdx === 0);
    this.ui.sides[1].classList.toggle('active', this.activePlayerIdx === 1);
  }

  animateAttack(attackerIdx, defenderIdx, events, totalDmg, isSpecial, isKillingSpecial) {
    const attackerSide = this.ui.sides[attackerIdx];
    const defenderSide = this.ui.sides[defenderIdx];
    const attacker = this.players[attackerIdx];
    const defender = this.players[defenderIdx];
    const cls = CLASSES[attacker.classId];

    attackerSide.classList.add('attacking');
    const anyHit = events.some(e => e.hit);
    defenderSide.classList.add(anyHit ? 'hit' : 'evading');

    const animDuration = isKillingSpecial
      ? this.settings.animationDurationMs * 1.6
      : this.settings.animationDurationMs;

    setTimeout(() => {
      attackerSide.classList.remove('attacking');
      defenderSide.classList.remove('hit', 'evading');
    }, animDuration);

    events.forEach((evt, i) => {
      setTimeout(() => {
        if (evt.hit) {
          this.spawnDamageNumber(defenderIdx, evt.damage, evt.crit);
        } else {
          const label = evt.blocked ? 'BLOCK' : (evt.evaded ? 'EVADE' : 'MISS');
          this.spawnDamageNumber(defenderIdx, label, false, true);
        }
      }, i * 250);
    });

    const attackName = isSpecial ? cls.special.name : 'Attack';
    const hitCount = events.filter(e => e.hit).length;
    const critCount = events.filter(e => e.crit).length;

    let statusText;
    if (totalDmg === 0) {
      const wholeMiss = events.every(e => !e.hit);
      const allBlocked = events.every(e => e.blocked);
      const allEvaded = events.every(e => e.evaded);
      let verb = 'misses';
      if (wholeMiss && allBlocked) verb = `${defender.username} blocks`;
      else if (wholeMiss && allEvaded) verb = `${defender.username} evades`;
      statusText = `${attacker.username}'s ${attackName} — ${verb.toUpperCase()}!`;
    } else if (critCount > 0 && hitCount === 1) {
      statusText = `${attacker.username} CRITS ${defender.username} for ${totalDmg} with ${attackName}!`;
    } else if (events.length > 1) {
      statusText = `${attacker.username} lands ${hitCount}/${events.length} ${attackName} for ${totalDmg}!`;
    } else {
      statusText = `${attacker.username} hits ${defender.username} for ${totalDmg} with ${attackName}`;
    }
    this.ui.status.innerHTML = esc(statusText);

    if (isKillingSpecial) {
      this.ui.stage.classList.add('shake', 'slow-mo');
      setTimeout(() => {
        this.ui.stage.classList.remove('shake', 'slow-mo');
      }, animDuration);
    }
  }

  spawnDamageNumber(sideIdx, value, isCrit, isMiss = false) {
    const arena = this.ui.arenas[sideIdx];
    const num = document.createElement('div');
    num.className = 'damage-number';
    if (isCrit) num.classList.add('crit');
    if (isMiss) num.classList.add('miss');
    num.textContent = typeof value === 'number' ? `−${value}` : value;
    num.style.left = `${30 + Math.random() * 40}%`;
    arena.appendChild(num);
    setTimeout(() => num.remove(), 1500);
  }

  showVictory(winnerIdx) {
    const winner = this.players[winnerIdx];
    const cls = CLASSES[winner.classId];
    this.ui.victory.innerHTML = `
      <div class="victory-banner">
        <div class="victory-title">VICTORY!</div>
        <div class="victory-name" style="color: ${winner.chatColor}">${esc(winner.username)}</div>
        <div class="victory-class">${cls.label}</div>
      </div>
    `;
    this.ui.victory.classList.add('visible');
  }
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function esc(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
