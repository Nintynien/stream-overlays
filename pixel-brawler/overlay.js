import { BaseOverlay } from '../core/base-overlay.js';
import {
  CLASSES, SPRITE_FRAMES, HATS,
  buildSpriteShadow, gridOriginColor, classPalette, resolvePrimary,
  randomPlayableClass, CELL_SIZE, SPRITE_W,
} from './classes.js';
import {
  resolveProfile, setViewerClass, setViewerColor, setViewerHat,
} from './profiles.js';

const KNIGHT_BLOCK_CHANCE = 0.30;
const FIGHTER_SCALE = 1.5;
const FIGHTER_HALF_WIDTH = (SPRITE_W * CELL_SIZE * FIGHTER_SCALE) / 2; // ~45px
const FIGHTER_OFFSET_PX = 100;     // distance from screen center to each fighter center
const FIGHT_ZONE_BUFFER_PX = 60;   // extra space crowd avoids beyond outer fighter edges

export class PixelBrawlerOverlay extends BaseOverlay {
  constructor(config) {
    super(config);
    this.settings = {
      animationDurationMs: config.settings?.animationDurationMs ?? 1800,
      victoryDurationMs: config.settings?.victoryDurationMs ?? 5000,
      turnGapMs: config.settings?.turnGapMs ?? 1200,
      introDurationMs: config.settings?.introDurationMs ?? 1500,
      tickMs: config.settings?.tickMs ?? 100,
      maxCrowd: config.settings?.maxCrowd ?? 12,
      crowdTrickleMs: config.settings?.crowdTrickleMs ?? 4500,
      specialMeterMax: 3,
    };

    this.gameState = 'idle';
    this.players = [null, null];
    this.fighterEls = [null, null];
    this.activePlayerIdx = 0;
    this.fightZone = null; // { left, right } px range that walking crowd avoids
    this.intervalId = null;
    this.turnTimerId = null;

    this.crowd = [];
    this.recentChatters = new Map();
    this.lastTrickleAt = 0;

    this.ui = {};
  }

  onInit() {
    this.buildUI();
    this.generateGrass();
    this.setState('idle');
    this.intervalId = setInterval(() => this.tick(), this.settings.tickMs);
  }

  generateGrass() {
    const layer = document.createElement('div');
    layer.className = 'grass-layer';

    const w = window.innerWidth;
    const spacing = 14;
    const numBlades = Math.floor(w / spacing);

    for (let i = 0; i < numBlades; i++) {
      const blade = document.createElement('div');
      blade.className = 'grass-blade';
      blade.style.left = `${i * spacing + Math.random() * (spacing - 2)}px`;
      blade.style.height = `${5 + Math.floor(Math.random() * 7)}px`;
      blade.style.width = `${1 + Math.floor(Math.random() * 2)}px`;
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
    if (this.recentChatters.size > 100) {
      const oldestKey = this.recentChatters.keys().next().value;
      this.recentChatters.delete(oldestKey);
    }

    const tokens = message.message.trim().split(/\s+/);
    let cmdIdx = -1;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].startsWith('!')) { cmdIdx = i; break; }
    }
    if (cmdIdx !== -1) {
      const cmd = tokens[cmdIdx].toLowerCase();
      const args = tokens.slice(cmdIdx + 1);
      this.handleCommand(cmd, args, message);
    }

    // Crowd reaction: only spawn/animate fresh chatters during idle. During
    // a battle the crowd keeps walking but we don't introduce new chatting
    // bubbles — the focus stays on the fight.
    if (this.gameState === 'idle') {
      const existing = this.crowd.find(c => c.usernameLower === usernameLower);
      if (existing) {
        this.enterChattingState(existing);
      } else if (this.crowd.length < this.settings.maxCrowd) {
        this.spawnCrowdChar(message.username, message.color, true);
      }
    }
  }

  handleCommand(cmd, args, message) {
    const arg = args[0] || null;
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
      case '!battle':
        if (this.isModOrBroadcaster(message)) {
          const a = stripAtSign(args[0] || '');
          const b = stripAtSign(args[1] || '');
          if (a && b && a.toLowerCase() !== b.toLowerCase()) {
            this.startBattle(a, b);
          }
        }
        break;
      case '!resetbrawl':
        if (this.isModOrBroadcaster(message)) {
          this.forceResetToIdle();
        }
        break;
    }
  }

  refreshCrowdAppearance(usernameLower) {
    const char = this.crowd.find(c => c.usernameLower === usernameLower);
    if (!char) return;

    const profile = resolveProfile(usernameLower);
    const newClassId = profile?.class || 'villager';
    const colorId = profile?.color;
    const hatId = profile?.hat;

    char.classId = newClassId;
    char.sprite.style.setProperty('--armor-primary', resolvePrimary(newClassId, colorId));

    const frameKey = char.behaviorState === 'sitting'
      ? 'sit'
      : (char.walkFrameAlt ? 'walk2' : 'walk1');
    this.applySpriteFrame(char.sprite, newClassId, frameKey);

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

  // ───────────────────────────── battle setup ───────────────────────────────

  startBattle(usernameA, usernameB) {
    if (this.gameState !== 'idle') return;

    const playerA = this.makePlayerFromName(usernameA);
    const playerB = this.makePlayerFromName(usernameB);
    this.players = [playerA, playerB];

    this.computeFightZone();
    this.evictCrowdFromZone();
    this.spawnFighter(0);
    this.spawnFighter(1);

    this.setState('battle_intro');
    this.setStatus(
      `<b style="color:${esc(playerA.chatColor)}">${esc(playerA.username)}</b> ` +
      `(${CLASSES[playerA.classId].label}) ` +
      `vs <b style="color:${esc(playerB.chatColor)}">${esc(playerB.username)}</b> ` +
      `(${CLASSES[playerB.classId].label})!`
    );

    this.activePlayerIdx = Math.random() < 0.5 ? 0 : 1;
    this.updateActiveHighlight();

    this.scheduleNextTurn(this.settings.introDurationMs);
  }

  // Build a player object from a raw username typed into !battle.
  // If the user has chatted recently we reuse their display-cased name and
  // chat color; otherwise fall back to the typed name and white.
  makePlayerFromName(rawUsername) {
    const lower = rawUsername.toLowerCase();
    const profile = resolveProfile(rawUsername);
    let classId = profile?.class;
    if (!classId || classId === 'villager') classId = randomPlayableClass();

    const known = this.recentChatters.get(lower);
    const username = known?.username || rawUsername;
    const chatColor = known?.color || '#ffffff';

    const cls = CLASSES[classId];
    return {
      username,
      usernameLower: lower,
      chatColor,
      classId,
      colorId: profile?.color || null,
      hatId: profile?.hat || null,
      hp: cls.hp,
      maxHp: cls.hp,
      special: 0,
    };
  }

  computeFightZone() {
    const cx = window.innerWidth / 2;
    const left = cx - FIGHTER_OFFSET_PX - FIGHTER_HALF_WIDTH - FIGHT_ZONE_BUFFER_PX;
    const right = cx + FIGHTER_OFFSET_PX + FIGHTER_HALF_WIDTH + FIGHT_ZONE_BUFFER_PX;
    this.fightZone = { left, right };
  }

  // Any crowd char already inside the zone gets pushed out the nearest edge.
  evictCrowdFromZone() {
    if (!this.fightZone) return;
    const { left, right } = this.fightZone;
    const now = performance.now();
    for (const c of this.crowd) {
      if (c.x >= left && c.x <= right) {
        const distLeft = c.x - left;
        const distRight = right - c.x;
        c.dir = distLeft < distRight ? -1 : 1;
        c.behaviorState = 'walking';
        c.speed = Math.max(c.speed, 90);
        c.el.style.setProperty('--face-x', c.dir > 0 ? '1' : '-1');
        if (c.bubbleEl) this.detachSpeechBubble(c);
        c.nextDecisionAt = now + 6000;
        c.lastFrameSwapAt = now;
      }
    }
  }

  spawnFighter(idx) {
    const player = this.players[idx];
    const cls = CLASSES[player.classId];
    const faceX = idx === 0 ? 1 : -1; // side 0 faces right; side 1 faces left

    const wrap = document.createElement('div');
    wrap.className = 'fighter';
    wrap.dataset.side = String(idx);

    const hud = document.createElement('div');
    hud.className = 'fighter-hud';
    hud.innerHTML = `
      <div class="fighter-name" style="color: ${esc(player.chatColor)}">${esc(player.username)}</div>
      <div class="fighter-hp-track">
        <div class="fighter-hp-fill"></div>
        <div class="fighter-hp-text"></div>
      </div>
      <div class="fighter-meta">
        <div class="fighter-class">${esc(cls.label)}</div>
        <div class="fighter-pips"></div>
      </div>
    `;
    wrap.appendChild(hud);

    const stage = document.createElement('div');
    stage.className = 'fighter-stage';
    wrap.appendChild(stage);

    const mirror = document.createElement('div');
    mirror.className = 'fighter-mirror';
    mirror.style.setProperty('--face-x', String(faceX));
    stage.appendChild(mirror);

    const holder = document.createElement('div');
    holder.className = 'sprite-holder sprite-holder-fighter';
    mirror.appendChild(holder);

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

    this.ui.crowdLayer.appendChild(wrap);
    this.fighterEls[idx] = { wrap, hud, stage, mirror, holder, sprite };

    this.renderFighterHp(idx);
    this.renderFighterPips(idx);
  }

  // ───────────────────────────── battle loop ────────────────────────────────

  scheduleNextTurn(delayMs) {
    if (this.turnTimerId) clearTimeout(this.turnTimerId);
    this.turnTimerId = setTimeout(() => {
      this.turnTimerId = null;
      this.executeAutoTurn();
    }, delayMs);
  }

  executeAutoTurn() {
    if (this.gameState !== 'battle_intro' && this.gameState !== 'battle_turn') return;

    const attackerIdx = this.activePlayerIdx;
    const defenderIdx = 1 - attackerIdx;
    const attacker = this.players[attackerIdx];
    const defender = this.players[defenderIdx];
    if (!attacker || !defender) return;

    const cls = CLASSES[attacker.classId];
    const isSpecial = attacker.special >= this.settings.specialMeterMax;

    this.setState('battle_animating');

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
      if (this.gameState !== 'battle_animating') return;
      this.renderFighterHp(attackerIdx);
      this.renderFighterHp(defenderIdx);
      this.renderFighterPips(attackerIdx);
      this.renderFighterPips(defenderIdx);

      if (isKill) {
        this.endBattle(attackerIdx);
      } else {
        this.activePlayerIdx = defenderIdx;
        this.updateActiveHighlight();
        this.setState('battle_turn');
        this.scheduleNextTurn(this.settings.turnGapMs);
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

  endBattle(winnerIdx) {
    this.setState('battle_victory');
    const loserIdx = 1 - winnerIdx;
    const winnerEl = this.fighterEls[winnerIdx];
    const loserEl = this.fighterEls[loserIdx];

    if (winnerEl) {
      winnerEl.wrap.classList.remove('active-turn');
      winnerEl.wrap.classList.add('victory');
    }
    if (loserEl) {
      loserEl.wrap.classList.remove('active-turn');
      loserEl.wrap.classList.add('dying');
    }

    this.showVictory(winnerIdx);

    setTimeout(() => {
      for (let i = 0; i < 2; i++) {
        if (this.fighterEls[i]) {
          this.fighterEls[i].wrap.remove();
          this.fighterEls[i] = null;
        }
      }
      this.players = [null, null];
      this.fightZone = null;
      this.ui.victory.classList.remove('visible');
      this.setStatus('');
      this.setState('idle');
    }, this.settings.victoryDurationMs);
  }

  forceResetToIdle() {
    if (this.turnTimerId) { clearTimeout(this.turnTimerId); this.turnTimerId = null; }
    for (let i = 0; i < 2; i++) {
      if (this.fighterEls[i]) {
        this.fighterEls[i].wrap.remove();
        this.fighterEls[i] = null;
      }
    }
    this.players = [null, null];
    this.fightZone = null;
    this.ui.victory.classList.remove('visible');
    this.setStatus('');
    this.setState('idle');
  }

  // ───────────────────────────── tick ───────────────────────────────────────

  tick() {
    this.tickCrowd();
  }

  tickCrowd() {
    const now = performance.now();

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
          // Avoid the fight zone: when about to step into it, reverse.
          if (this.fightZone) {
            const { left, right } = this.fightZone;
            const nextX = char.x + char.dir * char.speed * dt;
            if (char.dir > 0 && char.x < left && nextX >= left) {
              char.dir = -1;
              char.el.style.setProperty('--face-x', '-1');
            } else if (char.dir < 0 && char.x > right && nextX <= right) {
              char.dir = 1;
              char.el.style.setProperty('--face-x', '1');
            }
          }

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
    // While a battle is going, lean walking-only — sitting near the fight
    // zone reads as awkward and we want crowd to keep flowing past.
    const inFightMode = this.fightZone !== null;
    if (r < (inFightMode ? 0.95 : 0.7)) {
      char.nextDecisionAt = now + 3000 + Math.random() * 5000;
    } else if (r < (inFightMode ? 0.99 : 0.9)) {
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
    const yJitterPx = Math.round((Math.random() - 0.5) * 8);
    const startX = dir > 0 ? -80 : window.innerWidth + 80;

    const wrap = document.createElement('div');
    wrap.className = 'crowd-char';
    wrap.style.left = `${startX}px`;
    // Bottom-anchored so crowd feet land on the grass on any screen height.
    wrap.style.bottom = `${14 + yJitterPx}px`;
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

  // ───────────────────────────── sprite rendering ───────────────────────────

  applySpriteFrame(spriteEl, classId, frameKey) {
    const frames = SPRITE_FRAMES[classId];
    if (!frames) return;
    const grid = frames[frameKey] || frames.walk1;
    const palette = classPalette(classId);
    spriteEl.style.boxShadow = buildSpriteShadow(grid, palette);
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
      <div class="crowd-layer" id="crowd-layer">
        <div class="ground-strip"></div>
      </div>
      <div class="battle-status" id="battle-status"></div>
      <div class="brawler-victory" id="brawler-victory"></div>
    `;

    this.container.appendChild(root);

    this.ui = {
      root,
      crowdLayer: root.querySelector('#crowd-layer'),
      status: root.querySelector('#battle-status'),
      victory: root.querySelector('#brawler-victory'),
    };
  }

  setState(state) {
    this.gameState = state;
    this.ui.root.dataset.state = state;
  }

  setStatus(html) {
    this.ui.status.innerHTML = html || '';
  }

  renderFighterHp(idx) {
    const player = this.players[idx];
    const el = this.fighterEls[idx];
    if (!player || !el) return;
    const fill = el.hud.querySelector('.fighter-hp-fill');
    const text = el.hud.querySelector('.fighter-hp-text');
    const pct = (player.hp / player.maxHp) * 100;
    fill.style.width = `${pct}%`;
    text.textContent = `${player.hp}/${player.maxHp}`;
  }

  renderFighterPips(idx) {
    const player = this.players[idx];
    const el = this.fighterEls[idx];
    if (!player || !el) return;
    const pipsEl = el.hud.querySelector('.fighter-pips');
    pipsEl.innerHTML = '';
    for (let p = 0; p < this.settings.specialMeterMax; p++) {
      const pip = document.createElement('span');
      pip.className = 'pip' + (p < player.special ? ' on' : '');
      pipsEl.appendChild(pip);
    }
  }

  updateActiveHighlight() {
    for (let i = 0; i < 2; i++) {
      if (!this.fighterEls[i]) continue;
      this.fighterEls[i].wrap.classList.toggle('active-turn', this.activePlayerIdx === i);
    }
  }

  animateAttack(attackerIdx, defenderIdx, events, totalDmg, isSpecial, isKillingSpecial) {
    const attackerWrap = this.fighterEls[attackerIdx]?.wrap;
    const defenderWrap = this.fighterEls[defenderIdx]?.wrap;
    const attacker = this.players[attackerIdx];
    const defender = this.players[defenderIdx];
    const cls = CLASSES[attacker.classId];

    attackerWrap?.classList.add('attacking');
    const anyHit = events.some(e => e.hit);
    defenderWrap?.classList.add(anyHit ? 'hit' : 'evading');

    const animDuration = isKillingSpecial
      ? this.settings.animationDurationMs * 1.6
      : this.settings.animationDurationMs;

    setTimeout(() => {
      attackerWrap?.classList.remove('attacking');
      defenderWrap?.classList.remove('hit', 'evading');
    }, Math.min(animDuration, 700));

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
    this.setStatus(esc(statusText));

    if (isKillingSpecial) {
      this.ui.crowdLayer.classList.add('shake', 'slow-mo');
      setTimeout(() => {
        this.ui.crowdLayer.classList.remove('shake', 'slow-mo');
      }, animDuration);
    }
  }

  spawnDamageNumber(sideIdx, value, isCrit, isMiss = false) {
    // Append to .fighter (not .fighter-stage) so the death-rotation on stage
    // doesn't rotate damage numbers along with the corpse.
    const wrap = this.fighterEls[sideIdx]?.wrap;
    if (!wrap) return;
    const num = document.createElement('div');
    num.className = 'damage-number';
    if (isCrit) num.classList.add('crit');
    if (isMiss) num.classList.add('miss');
    num.textContent = typeof value === 'number' ? `−${value}` : value;
    num.style.left = `${30 + Math.random() * 40}%`;
    wrap.appendChild(num);
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

function stripAtSign(s) {
  return s.startsWith('@') ? s.slice(1) : s;
}

function esc(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
