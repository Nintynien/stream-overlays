import { BaseOverlay } from '../core/base-overlay.js';

// ========== PRNG (mulberry32) ==========
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRng(seed) {
  const next = mulberry32(seed);
  return {
    next,
    range: (lo, hi) => lo + next() * (hi - lo),
    rangeInt: (lo, hi) => Math.floor(lo + next() * (hi - lo + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p
  };
}

// ========== Color from username ==========
function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function colorFromUsername(u) {
  const h = hashString((u || '').toLowerCase()) % 360;
  return `hsl(${h}, 70%, 55%)`;
}

// ========== Course feature palette ==========
function featFlat(rng, x, y) {
  const len = rng.range(400, 900);
  return {
    segments: [{ x1: x, y1: y, x2: x + len, y2: y }],
    endX: x + len, endY: y, kind: 'flat'
  };
}

function featRampDown(rng, x, y) {
  const len = rng.range(300, 600);
  const drop = rng.range(80, 220);
  return {
    segments: [{ x1: x, y1: y, x2: x + len, y2: y + drop }],
    endX: x + len, endY: y + drop, kind: 'rampDown'
  };
}

function featRampUp(rng, x, y) {
  const len = rng.range(450, 700);
  const rise = rng.range(30, 80);
  return {
    segments: [{ x1: x, y1: y, x2: x + len, y2: y - rise }],
    endX: x + len, endY: y - rise, kind: 'rampUp'
  };
}

function featBump(rng, x, y) {
  const w = rng.range(100, 180);
  const h = rng.range(30, 70);
  return {
    segments: [
      { x1: x, y1: y, x2: x + w / 2, y2: y - h },
      { x1: x + w / 2, y1: y - h, x2: x + w, y2: y }
    ],
    endX: x + w, endY: y, kind: 'bump'
  };
}

function featValley(rng, x, y) {
  const w = rng.range(240, 480);
  const d = rng.range(60, 180);
  return {
    segments: [
      { x1: x, y1: y, x2: x + w / 2, y2: y + d },
      { x1: x + w / 2, y1: y + d, x2: x + w, y2: y }
    ],
    endX: x + w, endY: y, kind: 'valley'
  };
}

function featStairsDown(rng, x, y) {
  const count = rng.rangeInt(3, 5);
  const stepW = rng.range(60, 110);
  const stepH = rng.range(25, 55);
  const segments = [];
  let cx = x, cy = y;
  for (let i = 0; i < count; i++) {
    segments.push({ x1: cx, y1: cy, x2: cx + stepW, y2: cy });
    segments.push({ x1: cx + stepW, y1: cy, x2: cx + stepW, y2: cy + stepH });
    cx += stepW;
    cy += stepH;
  }
  segments.push({ x1: cx, y1: cy, x2: cx + stepW, y2: cy });
  cx += stepW;
  return { segments, endX: cx, endY: cy, kind: 'stairsDown' };
}

const FEATURE_POOL = [
  { fn: featFlat, weight: 3 },
  { fn: featRampDown, weight: 3 },
  { fn: featRampUp, weight: 1.5 },
  { fn: featBump, weight: 1.5 },
  { fn: featValley, weight: 2.5 },
  { fn: featStairsDown, weight: 1 }
];

function pickWeighted(rng, pool) {
  const total = pool.reduce((s, f) => s + f.weight, 0);
  let r = rng.next() * total;
  for (const f of pool) {
    if (r < f.weight) return f;
    r -= f.weight;
  }
  return pool[pool.length - 1];
}

function generateCourse(rng, settings) {
  const courseHeight = settings.courseHeight;
  const minY = courseHeight * 0.2;
  const maxY = courseHeight * 0.75;
  const startPlatformLen = 300;
  const finishPlatformLen = 400;
  const targetLen = rng.range(settings.courseMinLength, settings.courseMaxLength);

  const segments = [];
  segments.push({ x1: 0, y1: 0, x2: 0, y2: courseHeight }); // left wall
  const startY = courseHeight * 0.45;
  segments.push({ x1: 0, y1: startY, x2: startPlatformLen, y2: startY });

  let x = startPlatformLen;
  let y = startY;

  // Always open with a rampDown so marbles build momentum before any uphill.
  const opener = featRampDown(rng, x, y);
  for (const s of opener.segments) segments.push(s);
  x = opener.endX;
  y = opener.endY;
  let lastKind = 'rampDown';

  let safety = 0;
  while (x < targetLen - finishPlatformLen && safety < 200) {
    let chosen = null;
    for (let attempt = 0; attempt < 20; attempt++) {
      const candidate = pickWeighted(rng, FEATURE_POOL);
      const trial = candidate.fn(rng, x, y);
      if (trial.endY < minY || trial.endY > maxY) continue;
      // rampUp only after a downhill feature, so marbles arrive with momentum
      if (trial.kind === 'rampUp' && lastKind !== 'rampDown' && lastKind !== 'stairsDown') continue;
      if (trial.kind === 'rampUp' && y < minY + 80) continue;
      if ((trial.kind === 'rampDown' || trial.kind === 'stairsDown') && y > maxY - 80) continue;
      chosen = trial;
      break;
    }
    if (!chosen) chosen = featFlat(rng, x, y);
    for (const s of chosen.segments) segments.push(s);
    x = chosen.endX;
    y = chosen.endY;
    lastKind = chosen.kind;
    safety++;
  }

  // Finish platform
  segments.push({ x1: x, y1: y, x2: x + finishPlatformLen, y2: y });
  const finishX = x + finishPlatformLen * 0.3;
  const courseWidth = x + finishPlatformLen;

  // Right wall (prevents runaway marbles)
  segments.push({ x1: courseWidth, y1: 0, x2: courseWidth, y2: courseHeight });

  // Bottom catch spanning entire course
  segments.push({ x1: 0, y1: courseHeight - 30, x2: courseWidth, y2: courseHeight - 30 });

  return {
    segments,
    finishX,
    spawnX: 40,
    spawnY: startY - 40,
    courseWidth,
    courseHeight
  };
}

// ========== Physics ==========
function closestPointOnSegment(px, py, seg) {
  const dx = seg.x2 - seg.x1;
  const dy = seg.y2 - seg.y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-6) return { x: seg.x1, y: seg.y1 };
  let t = ((px - seg.x1) * dx + (py - seg.y1) * dy) / lenSq;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  return { x: seg.x1 + t * dx, y: seg.y1 + t * dy };
}

function resolveSegmentCollision(m, seg, restitution) {
  const p = closestPointOnSegment(m.x, m.y, seg);
  const dx = m.x - p.x;
  const dy = m.y - p.y;
  const distSq = dx * dx + dy * dy;
  const rSq = m.radius * m.radius;
  if (distSq >= rSq) return;
  const dist = Math.sqrt(distSq);
  let nx, ny;
  if (dist < 1e-6) {
    nx = 0;
    ny = -1;
  } else {
    nx = dx / dist;
    ny = dy / dist;
  }
  const penetration = m.radius - dist;
  m.x += nx * penetration;
  m.y += ny * penetration;
  const vdotn = m.vx * nx + m.vy * ny;
  if (vdotn < 0) {
    m.vx -= (1 + restitution) * vdotn * nx;
    m.vy -= (1 + restitution) * vdotn * ny;
  }
}

function resolveMarbleCollision(a, b, restitution) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distSq = dx * dx + dy * dy;
  const rSum = a.radius + b.radius;
  if (distSq >= rSum * rSum) return;
  const dist = Math.sqrt(distSq);
  let nx, ny;
  if (dist < 1e-6) {
    nx = 1;
    ny = 0;
  } else {
    nx = dx / dist;
    ny = dy / dist;
  }
  const overlap = rSum - dist;
  a.x -= nx * overlap * 0.5;
  a.y -= ny * overlap * 0.5;
  b.x += nx * overlap * 0.5;
  b.y += ny * overlap * 0.5;
  const va = a.vx * nx + a.vy * ny;
  const vb = b.vx * nx + b.vy * ny;
  if (va - vb <= 0) return; // already separating
  // Equal-mass swap with restitution
  const dvA = (vb - va) * (1 + restitution) * 0.5;
  const dvB = (va - vb) * (1 + restitution) * 0.5;
  a.vx += dvA * nx; a.vy += dvA * ny;
  b.vx += dvB * nx; b.vy += dvB * ny;
}

// ========== MarblesOverlay ==========
export class MarblesOverlay extends BaseOverlay {
  constructor(config, canvas) {
    super(config);
    this.settings = {
      seed: config.settings?.seed,
      courseMinLength: config.settings?.courseMinLength ?? 8000,
      courseMaxLength: config.settings?.courseMaxLength ?? 14000,
      courseHeight: config.settings?.courseHeight ?? 1080,
      gravity: config.settings?.gravity ?? 900,
      startImpulse: config.settings?.startImpulse ?? 250,
      boostImpulse: config.settings?.boostImpulse ?? 180,
      boostCooldownMs: config.settings?.boostCooldownMs ?? 3000,
      jumpImpulse: config.settings?.jumpImpulse ?? 350,
      jumpCooldownMs: config.settings?.jumpCooldownMs ?? 4000,
      marbleRadius: config.settings?.marbleRadius ?? 12,
      restitution: config.settings?.restitution ?? 0.35,
      maxVx: config.settings?.maxVx ?? 500,
      cameraLeadFraction: config.settings?.cameraLeadFraction ?? 0.4,
      cameraLerp: config.settings?.cameraLerp ?? 0.12,
      raceTimeoutMs: config.settings?.raceTimeoutMs ?? 180000,
      resultsDurationMs: config.settings?.resultsDurationMs ?? 15000,
      countdownMs: config.settings?.countdownMs ?? 3000,
      showNames: config.settings?.showNames !== false
    };

    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = window.devicePixelRatio || 1;

    this.state = 'idle';
    this.marbles = new Map();
    this.course = null;
    this.camera = { x: 0 };
    this.currentSeed = null;

    this.countdownStartMs = 0;
    this.raceStartMs = 0;
    this.raceEndMs = 0;
    this.finishOrder = [];

    this.lastFrameMs = 0;
    this.animationFrame = null;
  }

  onInit() {
    console.log('Marbles overlay initialized');
    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
    this.startLoop();
  }

  resizeCanvas() {
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(window.innerWidth * this.dpr);
    this.canvas.height = Math.floor(window.innerHeight * this.dpr);
    this.canvas.style.width = `${window.innerWidth}px`;
    this.canvas.style.height = `${window.innerHeight}px`;
  }

  onMessage(message) {
    const text = (message.message || '').trim().toLowerCase();
    const isMod = !!message.moderator;
    const username = message.username;
    const now = performance.now();

    if (text === '!lobby' && isMod && this.state === 'idle') {
      this.openLobby();
    } else if (text === '!start' && isMod && this.state === 'lobby') {
      this.startCountdown();
    } else if (text === '!join' && this.state === 'lobby') {
      this.addMarble(username);
    } else if (text === '!boost' && this.state === 'racing') {
      this.tryBoost(username, now);
    } else if (text === '!jump' && this.state === 'racing') {
      this.tryJump(username, now);
    } else if (text === '!endrace' && isMod && (this.state === 'racing' || this.state === 'countdown')) {
      this.endRace('mod');
    }
  }

  openLobby() {
    this.state = 'lobby';
    this.marbles.clear();
    this.finishOrder = [];
    this.camera.x = 0;
    const seed = (this.settings.seed ?? ((Date.now() & 0xffffffff) | 0)) >>> 0;
    this.currentSeed = seed;
    const rng = makeRng(seed);
    this.course = generateCourse(rng, this.settings);
    console.log(`[marbles] lobby opened seed=${seed} courseWidth=${Math.round(this.course.courseWidth)} finishX=${Math.round(this.course.finishX)}`);
  }

  addMarble(username) {
    if (!username) return;
    if (this.marbles.has(username)) return;
    if (!this.course) return;
    const idx = this.marbles.size;
    const marble = {
      username,
      x: this.course.spawnX + (idx % 6) * (this.settings.marbleRadius * 2.5),
      y: this.course.spawnY - Math.floor(idx / 6) * (this.settings.marbleRadius * 2.5),
      vx: 0,
      vy: 0,
      radius: this.settings.marbleRadius,
      color: colorFromUsername(username),
      finished: false,
      finishTime: 0,
      lastBoostTs: -Infinity,
      lastJumpTs: -Infinity,
      stuckCheckX: 0,
      stuckCheckMs: 0,
      stuckStreak: 0
    };
    this.marbles.set(username, marble);
  }

  startCountdown() {
    this.state = 'countdown';
    this.countdownStartMs = performance.now();
  }

  startRacing() {
    this.state = 'racing';
    this.raceStartMs = performance.now();
    for (const m of this.marbles.values()) {
      m.vx = this.settings.startImpulse;
      m.stuckCheckX = m.x;
      m.stuckCheckMs = this.raceStartMs;
      m.stuckStreak = 0;
    }
  }

  tryBoost(username, now) {
    const m = this.marbles.get(username);
    if (!m || m.finished) return;
    if (now - m.lastBoostTs < this.settings.boostCooldownMs) return;
    m.vx = Math.min(m.vx + this.settings.boostImpulse, this.settings.maxVx);
    m.lastBoostTs = now;
  }

  tryJump(username, now) {
    const m = this.marbles.get(username);
    if (!m || m.finished) return;
    if (now - m.lastJumpTs < this.settings.jumpCooldownMs) return;
    m.vy = Math.min(m.vy, 0) - this.settings.jumpImpulse;
    m.lastJumpTs = now;
  }

  startLoop() {
    this.lastFrameMs = performance.now();
    const loop = (nowMs) => {
      const dt = Math.min((nowMs - this.lastFrameMs) / 1000, 1 / 30);
      this.lastFrameMs = nowMs;
      this.tick(nowMs, dt);
      this.render(nowMs);
      this.animationFrame = requestAnimationFrame(loop);
    };
    this.animationFrame = requestAnimationFrame(loop);
  }

  tick(nowMs, dt) {
    if (this.state === 'countdown') {
      if (nowMs - this.countdownStartMs >= this.settings.countdownMs) {
        this.startRacing();
      }
      this.updateCamera(dt);
    } else if (this.state === 'racing') {
      this.physicsStep(dt);
      this.updateCamera(dt);
      if (this.marbles.size > 0 && this.finishOrder.length >= this.marbles.size) {
        this.endRace('all-finished');
      } else if (nowMs - this.raceStartMs >= this.settings.raceTimeoutMs) {
        this.endRace('timeout');
      }
    } else if (this.state === 'finished') {
      if (nowMs - this.raceEndMs >= this.settings.resultsDurationMs) {
        this.state = 'idle';
      }
    }
  }

  physicsStep(dt) {
    if (!this.course) return;
    const segments = this.course.segments;
    const restitution = this.settings.restitution;
    const gravity = this.settings.gravity;
    const finishX = this.course.finishX;
    const courseHeight = this.course.courseHeight;
    const maxVx = this.settings.maxVx;

    for (const m of this.marbles.values()) {
      if (m.finished) continue;
      m.vy += gravity * dt;
      if (m.vy > 1800) m.vy = 1800;
      if (m.vx > maxVx) m.vx = maxVx;
      if (m.vx < -maxVx) m.vx = -maxVx;
      m.x += m.vx * dt;
      m.y += m.vy * dt;

      for (const seg of segments) {
        resolveSegmentCollision(m, seg, restitution);
      }

      if (m.x - m.radius < 0) {
        m.x = m.radius;
        if (m.vx < 0) m.vx = -m.vx * restitution;
      }
      if (m.y > courseHeight) {
        m.y = courseHeight - 60;
        m.vy = 0;
      }

      if (!m.finished && m.x >= finishX) {
        m.finished = true;
        m.finishTime = performance.now() - this.raceStartMs;
        this.finishOrder.push(m.username);
        m.vx *= 0.3;
      }

      // Stuck-detection safety net: check every 2 s. If the marble hasn't
      // made 20 px of forward progress, nudge it — escalating with each
      // consecutive failure so even the steepest allowed upslope is cleared
      // within a few checks. A hop kicks in on the 2nd failure.
      const nowMs = performance.now();
      if (!m.finished && nowMs - m.stuckCheckMs >= 2000) {
        if (m.x - m.stuckCheckX < 20) {
          m.stuckStreak += 1;
          const kick = 120 + m.stuckStreak * 100; // 220, 320, 420, ... capped at maxVx
          m.vx = Math.min(m.vx + kick, this.settings.maxVx);
          if (m.stuckStreak >= 2) {
            m.vy = Math.min(m.vy, 0) - 180; // small hop to clear a crest
          }
        } else {
          m.stuckStreak = 0;
        }
        m.stuckCheckX = m.x;
        m.stuckCheckMs = nowMs;
      }
    }

    const marbles = Array.from(this.marbles.values());
    for (let i = 0; i < marbles.length; i++) {
      for (let j = i + 1; j < marbles.length; j++) {
        if (marbles[i].finished && marbles[j].finished) continue;
        resolveMarbleCollision(marbles[i], marbles[j], restitution);
      }
    }
  }

  updateCamera(dt) {
    if (!this.course) return;
    let leaderX = -Infinity;
    let hasUnfinished = false;
    for (const m of this.marbles.values()) {
      if (m.finished) continue;
      hasUnfinished = true;
      if (m.x > leaderX) leaderX = m.x;
    }
    if (!hasUnfinished) leaderX = this.course.finishX;
    const scale = window.innerHeight / this.course.courseHeight;
    const viewWorldW = window.innerWidth / scale;
    const targetCameraX = Math.max(0, Math.min(
      Math.max(0, this.course.courseWidth - viewWorldW),
      leaderX - viewWorldW * this.settings.cameraLeadFraction
    ));
    const t = 1 - Math.pow(1 - this.settings.cameraLerp, Math.max(1, dt * 60));
    this.camera.x += (targetCameraX - this.camera.x) * t;
  }

  endRace(reason) {
    if (this.state === 'finished') return;
    this.state = 'finished';
    this.raceEndMs = performance.now();
    console.log(`[marbles] race ended: ${reason}`);
  }

  // ========== Rendering ==========
  render(nowMs) {
    const ctx = this.ctx;
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, cw, ch);

    if (this.course) {
      const scale = ch / this.course.courseHeight;
      ctx.setTransform(scale, 0, 0, scale, -this.camera.x * scale, 0);
      this.drawCourse(ctx, scale);
      this.drawMarbles(ctx);
    }

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawHud(ctx, nowMs);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  drawCourse(ctx, scale) {
    if (!this.course) return;
    const viewWorldW = this.canvas.width / scale;
    const leftX = this.camera.x - 50;
    const rightX = this.camera.x + viewWorldW + 50;

    ctx.strokeStyle = '#888';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const seg of this.course.segments) {
      const minSegX = Math.min(seg.x1, seg.x2);
      const maxSegX = Math.max(seg.x1, seg.x2);
      if (maxSegX < leftX || minSegX > rightX) continue;
      ctx.moveTo(seg.x1, seg.y1);
      ctx.lineTo(seg.x2, seg.y2);
    }
    ctx.stroke();

    // Finish line
    if (this.course.finishX >= leftX && this.course.finishX <= rightX) {
      ctx.strokeStyle = '#4ade80';
      ctx.lineWidth = 3;
      ctx.setLineDash([14, 10]);
      ctx.beginPath();
      ctx.moveTo(this.course.finishX, 0);
      ctx.lineTo(this.course.finishX, this.course.courseHeight);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#4ade80';
      ctx.font = 'bold 40px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText('FINISH', this.course.finishX, 40);
    }
  }

  drawMarbles(ctx) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.font = 'bold 18px system-ui, sans-serif';
    for (const m of this.marbles.values()) {
      ctx.fillStyle = m.color;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.beginPath();
      ctx.arc(m.x - m.radius * 0.35, m.y - m.radius * 0.35, m.radius * 0.3, 0, Math.PI * 2);
      ctx.fill();

      if (this.settings.showNames) {
        const label = m.username;
        const textY = m.y - m.radius - 6;
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(m.x - tw / 2 - 4, textY - 20, tw + 8, 22);
        ctx.fillStyle = m.finished ? '#fbbf24' : '#ffffff';
        ctx.fillText(label, m.x, textY);
      }
    }
  }

  drawHud(ctx, nowMs) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    if (this.state === 'idle') {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 28px system-ui, sans-serif';
      ctx.fillText('Mods: type !lobby to start a marble race', vw / 2, vh / 2);
    } else if (this.state === 'lobby') {
      this.drawLobbyHud(ctx, vw, vh);
    } else if (this.state === 'countdown') {
      this.drawCountdownHud(ctx, vw, vh, nowMs);
    } else if (this.state === 'racing') {
      this.drawRacingHud(ctx, vw, vh, nowMs);
    } else if (this.state === 'finished') {
      this.drawFinishedHud(ctx, vw, vh);
    }
  }

  drawLobbyHud(ctx, vw, vh) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, vw, vh);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 72px system-ui, sans-serif';
    ctx.fillText('MARBLE RACE', vw / 2, vh * 0.18);

    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 44px system-ui, sans-serif';
    ctx.fillText('Type !join to enter', vw / 2, vh * 0.28);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px system-ui, sans-serif';
    const n = this.marbles.size;
    ctx.fillText(`${n} player${n === 1 ? '' : 's'} joined`, vw / 2, vh * 0.36);

    const names = Array.from(this.marbles.keys());
    ctx.font = '20px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const colW = 220;
    const rowH = 28;
    const padX = 80;
    const startY = vh * 0.44;
    const cols = Math.max(1, Math.floor((vw - padX * 2) / colW));
    const maxRows = Math.max(1, Math.floor((vh - startY - 80) / rowH));
    const maxShown = cols * maxRows;
    const shown = Math.min(names.length, maxShown);
    for (let i = 0; i < shown; i++) {
      const col = Math.floor(i / maxRows);
      const row = i % maxRows;
      const x = padX + col * colW;
      const y = startY + row * rowH;
      ctx.fillStyle = colorFromUsername(names[i]);
      ctx.fillText('● ' + names[i], x, y);
    }
    if (names.length > maxShown) {
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.textAlign = 'center';
      ctx.fillText(`…and ${names.length - maxShown} more`, vw / 2, vh - 56);
    }

    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '20px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Mods: type !start to begin', vw / 2, vh - 30);
  }

  drawCountdownHud(ctx, vw, vh, nowMs) {
    const elapsed = nowMs - this.countdownStartMs;
    const remaining = Math.max(0, this.settings.countdownMs - elapsed);
    const secsLeft = Math.ceil(remaining / 1000);
    const label = secsLeft > 0 ? String(secsLeft) : 'GO!';

    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, vw, vh);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 240px system-ui, sans-serif';
    ctx.fillText(label, vw / 2, vh / 2);
  }

  drawRacingHud(ctx, vw, vh, nowMs) {
    const elapsed = nowMs - this.raceStartMs;
    const secs = Math.floor(elapsed / 1000);
    const mm = String(Math.floor(secs / 60)).padStart(2, '0');
    const ss = String(secs % 60).padStart(2, '0');
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(20, vh - 64, 150, 48);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${mm}:${ss}`, 95, vh - 40);

    // Leaderboard
    const list = Array.from(this.marbles.values()).slice();
    list.sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.x - a.x;
    });
    const top = list.slice(0, 5);

    const lbW = 260;
    const lbX = vw - lbW - 20;
    const lbY = 20;
    const rowH = 32;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(lbX, lbY, lbW, 14 + 24 + rowH * top.length);
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('LEADERBOARD', lbX + 12, lbY + 10);
    ctx.font = 'bold 18px system-ui, sans-serif';
    for (let i = 0; i < top.length; i++) {
      const m = top[i];
      const y = lbY + 34 + i * rowH;
      ctx.fillStyle = m.color;
      ctx.beginPath();
      ctx.arc(lbX + 22, y + 10, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      const name = m.username.length > 16 ? m.username.slice(0, 15) + '…' : m.username;
      ctx.fillText(`${i + 1}. ${name}${m.finished ? ' ✓' : ''}`, lbX + 38, y);
    }

    // Offscreen-behind indicator
    let behindCount = 0;
    for (const m of this.marbles.values()) {
      if (m.finished) continue;
      if (m.x < this.camera.x - 20) behindCount++;
    }
    if (behindCount > 0) {
      ctx.fillStyle = 'rgba(239,68,68,0.9)';
      ctx.beginPath();
      ctx.moveTo(20, vh / 2);
      ctx.lineTo(50, vh / 2 - 22);
      ctx.lineTo(50, vh / 2 + 22);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 18px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${behindCount} behind`, 60, vh / 2);
    }
  }

  drawFinishedHud(ctx, vw, vh) {
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(0, 0, vw, vh);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 72px system-ui, sans-serif';
    ctx.fillText('RESULTS', vw / 2, vh * 0.16);

    const order = this.finishOrder.slice(0, 3);
    if (order.length < 3) {
      const unfinished = Array.from(this.marbles.values())
        .filter(m => !m.finished)
        .sort((a, b) => b.x - a.x);
      while (order.length < 3 && unfinished.length) {
        order.push(unfinished.shift().username);
      }
    }

    const medalColors = ['#fbbf24', '#cbd5e1', '#d97706'];
    const medalLabels = ['1st', '2nd', '3rd'];

    for (let i = 0; i < order.length; i++) {
      const name = order[i];
      const m = this.marbles.get(name);
      const yBase = vh * 0.35 + i * 110;

      ctx.fillStyle = medalColors[i];
      ctx.font = 'bold 40px system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(medalLabels[i], vw / 2 - 220, yBase);

      if (m) {
        ctx.fillStyle = m.color;
        ctx.beginPath();
        ctx.arc(vw / 2 - 170, yBase, 22, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 36px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(name, vw / 2 - 130, yBase);

      if (m && m.finished) {
        const ts = `${(m.finishTime / 1000).toFixed(2)}s`;
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.font = '28px system-ui, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(ts, vw / 2 + 260, yBase);
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = 'italic 24px system-ui, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText('(did not finish)', vw / 2 + 260, yBase);
      }
    }

    if (order.length === 0) {
      ctx.fillStyle = '#ffffff';
      ctx.font = '32px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No racers this round.', vw / 2, vh / 2);
    }
  }

  disconnect() {
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
    super.disconnect();
  }
}
