import * as THREE from 'three';
import { BaseOverlay } from '../core/base-overlay.js';
import { Physics } from './physics.js';
import { Renderer } from './renderer.js';
import { generateTrack, nearestArclength } from './track.js';
import { resolveSkin, setViewerSkin, SKIN_BY_ID, getLastWinner, setLastWinner } from './skins.js';
import {
  POWERUPS, POWERUP_BY_ID,
  pickRandomPowerUp, pickRandomChaosPowerUp
} from './powerups.js';

// Emoji shown next to a marble's name on the leaderboard for each active
// effect. Kept here (not in powerups.js) because effect kinds and power-up
// ids don't always match — e.g. red shell knockback uses kind 'staggered'.
const EFFECT_KIND_EMOJI = {
  star: '⭐', shield: '🛡️', mini: '🍄', mega: '🟥',
  antigrav: '🌙', magnet: '🧲', rocket: '🚀',
  boost: '💨', frozen: '❄️', staggered: '💫'
};

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

// Deterministic permutation of [0..n-1] from a 32-bit seed. Used to shuffle
// pen column assignments per race so the same join index doesn't always land
// in the center-front slot (otherwise idx 5/6 always win — the center
// columns of the front row have a straight shot through the funnel).
function seededPermutation(n, seed) {
  let s = (seed >>> 0) || 1;
  const rand = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const arr = new Array(n);
  for (let i = 0; i < n; i++) arr[i] = i;
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
  return arr;
}

function colorFromUsername(u) {
  const h = hashString((u || '').toLowerCase()) % 360;
  return `hsl(${h}, 70%, 55%)`;
}

// ========== Marbles3DOverlay ==========
export class Marbles3DOverlay extends BaseOverlay {
  constructor(config, canvas3d, canvasHud) {
    super(config);
    this.settings = {
      seed: config.settings?.seed,
      gravity: config.settings?.gravity ?? -9.81,
      startSpeed: config.settings?.startSpeed ?? 3.0,
      boostDeltaV: config.settings?.boostDeltaV ?? 3.0,
      boostCooldownMs: config.settings?.boostCooldownMs ?? 3000,
      jumpDeltaV: config.settings?.jumpDeltaV ?? 4.5,
      jumpCooldownMs: config.settings?.jumpCooldownMs ?? 4000,
      marbleRadius: config.settings?.marbleRadius ?? 0.3,
      raceTimeoutMs: config.settings?.raceTimeoutMs ?? 180000,
      resultsDurationMs: config.settings?.resultsDurationMs ?? 15000,
      countdownMs: config.settings?.countdownMs ?? 3000,
      showNames: config.settings?.showNames !== false
    };

    this.canvas3d = canvas3d;
    this.canvasHud = canvasHud;
    this.hudCtx = canvasHud.getContext('2d');
    this.dpr = window.devicePixelRatio || 1;

    this.state = 'idle';
    this.marbles = new Map();
    this.currentSeed = null;

    this.physics = null;
    this.renderer = null;
    this.track = null;

    // Track-spawned hazards (banana, bomb). Keyed by hazard id; physics
    // owns the corresponding sensor body and routes hit events back to
    // onProjectileHit. updateHazards ticks fuses and max-age expiry.
    this.hazards = new Map();
    this._nextHazardId = 0;
    // Per-box pickup cooldowns. After a marble triggers a power-up, that
    // specific box is hidden + ignored for 2s before it can be re-collected.
    // Keyed by box id, value is the wall-clock ms when the box reactivates.
    this.boxCooldowns = new Map();
    this.boxCooldownMs = 2000;
    // Pickup popup state. Most recent acquisition is drawn at the bottom of
    // the HUD until expiresAt. New pickups overwrite — keeps it simple.
    this.lastPickupPopup = null;

    this.countdownStartMs = 0;
    this.raceStartMs = 0;
    this.raceEndMs = 0;
    this.finishOrder = [];

    this.lastFrameMs = 0;
    this.animationFrame = null;

    this.fps = 0;
    this.frameCountWindow = 0;
    this.frameWindowStartMs = 0;

    // Camera control state. Mods can override the default leader-follow
    // behavior with chat commands; updateCamera() resolves mode each frame.
    this.cameraMode = 'auto';              // 'auto' | 'user' | 'all'
    this.cameraTargetUser = null;          // Map key in this.marbles when mode==='user'
    this.cameraFinishedLingerUntilMs = 0;  // linger on a finished target until this time, then fall back to 'auto'
  }

  async onInit() {
    console.log('[marbles-3d] bootstrapping...');
    this.resizeHudCanvas();
    window.addEventListener('resize', () => this.resizeHudCanvas());

    this.physics = new Physics(this.settings);
    await this.physics.init();
    console.log('[marbles-3d] rapier init ok');

    this.renderer = new Renderer(this.canvas3d);

    if (this.config.demo) {
      this.startPhase1Demo();
    }

    this.startLoop();
    console.log('[marbles-3d] loop started');
  }

  // Demo mode runs the normal chat flow end-to-end with a handful of bot racers.
  // Random suffix on each name so their hashed colors differ run-to-run.
  startPhase1Demo() {
    this.openLobby();
    for (let i = 1; i <= 20; i++) {
      this.addMarble(`demo_${i}_${Math.random().toString(36).slice(2, 8)}`);
    }
    this.startCountdown();
  }

  resizeHudCanvas() {
    this.dpr = window.devicePixelRatio || 1;
    this.canvasHud.width = Math.floor(window.innerWidth * this.dpr);
    this.canvasHud.height = Math.floor(window.innerHeight * this.dpr);
    this.canvasHud.style.width = `${window.innerWidth}px`;
    this.canvasHud.style.height = `${window.innerHeight}px`;
  }

  onMessage(message) {
    const raw = (message.message || '').trim();
    const text = raw.toLowerCase();
    const parts = raw.split(/\s+/);
    const cmd = (parts[0] || '').toLowerCase();
    const arg = parts.slice(1).join(' ').trim(); // original case preserved for username lookup
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
    } else if ((cmd === '!camera' || cmd === '!cam' || cmd === '!spectate') && isMod &&
               (this.state === 'countdown' || this.state === 'racing' || this.state === 'finished')) {
      this.handleCameraCommand(cmd, arg);
    } else if (cmd === '!skin') {
      this.handleSkinCommand(username, arg);
    } else if (cmd === '!powerup' && isMod && this.state === 'racing') {
      this.handlePowerupCommand(parts[1], parts.slice(2).join(' '), now);
    } else if (cmd === '!chaos' && isMod && this.state === 'racing') {
      this.handleChaosCommand(now);
    }
  }

  handlePowerupCommand(idArg, userArg, now) {
    const id = (idArg || '').toLowerCase();
    const powerup = POWERUP_BY_ID.get(id);
    if (!powerup) {
      console.log('[marbles-3d] !powerup unknown id:', idArg,
        '— valid:', POWERUPS.map(p => p.id).join(', '));
      return;
    }
    let target;
    if (userArg) {
      const lower = userArg.toLowerCase();
      for (const key of this.marbles.keys()) {
        if (key.toLowerCase() === lower) { target = this.marbles.get(key); break; }
      }
      if (!target || target.finished) {
        console.log('[marbles-3d] !powerup target not found or finished:', userArg);
        return;
      }
    } else {
      const candidates = Array.from(this.marbles.values()).filter(m => !m.finished);
      if (candidates.length === 0) return;
      target = candidates[Math.floor(Math.random() * candidates.length)];
    }
    console.log(`[marbles-3d] !powerup ${id} → ${target.username}`);
    this.applyPowerUp(target, powerup, now);
  }

  handleChaosCommand(now) {
    let count = 0;
    for (const m of this.marbles.values()) {
      if (m.finished) continue;
      const p = pickRandomChaosPowerUp();
      this.applyPowerUp(m, p, now);
      count++;
    }
    console.log(`[marbles-3d] !chaos applied to ${count} marbles`);
  }

  handleSkinCommand(username, arg) {
    if (!username || !arg) return;
    const skinId = arg.toLowerCase();
    const skin = SKIN_BY_ID.get(skinId);
    if (!skin) return; // silent on unknown skin name

    setViewerSkin(username, skin.id);

    const m = this.marbles.get(username);
    if (!m) {
      // Viewer hasn't joined yet — preference is saved for their next !join.
      console.log(`[marbles-3d] skin saved: ${username} → ${skinId} (not joined)`);
      return;
    }

    m.skin = skin;
    this.renderer.updateMarbleSkin(m.id, skin, m.color);

    // Snap camera to this viewer so they can see the new skin. Overrides
    // any active spectate target — the last person to show off holds the
    // camera until the next !skin/!camera or lobby end.
    this.cameraMode = 'user';
    this.cameraTargetUser = m.username;
    this.cameraFinishedLingerUntilMs = 0;
    console.log(`[marbles-3d] skin applied: ${username} → ${skinId}`);
  }

  resetCameraMode() {
    this.cameraMode = 'auto';
    this.cameraTargetUser = null;
    this.cameraFinishedLingerUntilMs = 0;
  }

  openLobby() {
    this.teardownRace();
    this.resetCameraMode();
    const seed = (this.settings.seed ?? ((Date.now() & 0xffffffff) | 0)) >>> 0;
    this.currentSeed = seed;
    const rng = makeRng(seed);
    this.track = generateTrack(rng, this.settings);
    console.log(`[marbles-3d] lobby opened seed=${seed} length=${this.track.totalLength.toFixed(1)}m finishAt=${this.track.finishArclength.toFixed(1)}m`);

    this.physics.buildTrack(this.track);
    this.renderer.buildTrackMesh(this.track);

    // Power-up boxes: sensor cuboids (physics) + visible rotating cubes
    // (renderer). The intersection callback fires every time a marble enters
    // or leaves a sensor — overlay routes "enter" events to a fresh pickup
    // and "exit" events to clearing the overlap set so re-entry retriggers.
    this.physics.buildPowerUpSensors(this.track,
      (mId, bId, started) => this.onBoxIntersection(mId, bId, started));
    this.physics.onProjectileHit =
      (mId, pId, kind) => this.onProjectileHit(mId, pId, kind);
    if (this.track.powerUpPlacements) {
      for (const p of this.track.powerUpPlacements) {
        this.renderer.addPowerUpBoxMesh(p);
      }
    }

    const spawn = this.track.spawnPose.position;
    const cam = this.renderer.camera;
    cam.position.set(spawn.x - 5, spawn.y + 3, 8);
    cam.lookAt(spawn.x, spawn.y, spawn.z);
    this._camLookAt = new THREE.Vector3(spawn.x, spawn.y, spawn.z);

    this.state = 'lobby';
  }

  teardownRace() {
    // Clear effects (and their halos/restores) first so removing the marble
    // mesh doesn't leave dangling halo refs and restore handlers don't run
    // against a removed body.
    for (const m of this.marbles.values()) {
      this.clearMarbleEffects(m);
    }
    if (this.physics) {
      for (const m of this.marbles.values()) {
        this.physics.removeMarble(m.id);
      }
      this.physics.clearTrack(); // also drops power-up sensors and projectiles
    }
    if (this.renderer) {
      for (const m of this.marbles.values()) {
        this.renderer.removeMarbleMesh(m.id);
      }
      this.renderer.clearTrackMesh(); // also drops box meshes and projectiles
    }
    this.hazards.clear();
    this._nextHazardId = 0;
    this.boxCooldowns.clear();
    this.lastPickupPopup = null;
    this.marbles.clear();
    this.finishOrder = [];
    this.track = null;
    this.resetCameraMode();
  }

  addMarble(username) {
    if (!username) return;
    if (this.marbles.has(username)) return;
    if (!this.track) return;

    const idx = this.marbles.size;
    const radius = this.settings.marbleRadius;
    const spawnPose = this.track.spawnPose;

    // Staging grid inside the start pen. Scale cols with pen width so 100+
    // marbles fit without toppling off the sides. Extra rows queue backward
    // along -tangent (into the pen) so later joiners don't overlap earlier.
    const spacing = radius * 2.5;
    const penWidth = this.track.startPen?.width ?? 3;
    const colsPerRow = Math.max(4, Math.floor((penWidth - radius * 2) / spacing));
    const row = Math.floor(idx / colsPerRow);
    const rowSlot = idx % colsPerRow;
    // Per-race, per-row column permutation: the n-th joiner into a row lands
    // in a shuffled column instead of column n. Without this, the center
    // columns of row 0 (e.g. idx 5/6 with 12 cols) always get the straight
    // shot through the funnel and win every race. Seeding with
    // (currentSeed ^ row) keeps rows independent but race-stable, so
    // gameplay is deterministic within a race but varies across races.
    const raceSeed = (this.currentSeed ?? 1) >>> 0;
    const rowSeed = (raceSeed ^ Math.imul(row + 1, 0x9E3779B9)) >>> 0;
    const colPerm = seededPermutation(colsPerRow, rowSeed);
    const shuffledCol = colPerm[rowSlot];
    const col = shuffledCol - (colsPerRow - 1) / 2;
    // Per-marble jitter within the grid cell, seeded off the username. The
    // column permutation handles the dominant problem (same idx always in
    // the hotspot); jitter on top prevents any marble from landing exactly
    // on the centerline and keeps the pack from looking rigidly gridded.
    const h = hashString(username);
    const jitterAmount = radius * 0.4;
    const jitterLat = (((h & 0xFFFF) / 0xFFFF) - 0.5) * 2 * jitterAmount;
    const jitterBack = ((((h >>> 16) & 0xFFFF) / 0xFFFF) - 0.5) * 2 * jitterAmount;
    const lateral = col * spacing + jitterLat;
    const backward = row * spacing + jitterBack;

    // Lateral axis in the horizontal plane (stable regardless of pitch).
    const right = new THREE.Vector3().crossVectors(spawnPose.tangent, new THREE.Vector3(0, 1, 0));
    if (right.lengthSq() < 1e-6) right.set(0, 0, 1);
    right.normalize();

    // Pen floor slopes forward toward the funnel; raise back rows by the same
    // rise so every row spawns at a consistent height above the tilted floor.
    const slopeRise = this.track.startPen?.slopeRisePerMeter ?? 0;
    const pos = {
      x: spawnPose.position.x + right.x * lateral - spawnPose.tangent.x * backward,
      y: spawnPose.position.y + slopeRise * backward,
      z: spawnPose.position.z + right.z * lateral - spawnPose.tangent.z * backward
    };

    const id = username;
    const body = this.physics.addMarble(id, pos, radius);
    const color = colorFromUsername(username);
    const skin = resolveSkin(username);
    const isWinner = getLastWinner() === username.toLowerCase();
    this.renderer.addMarbleMesh(id, radius, skin, color, isWinner);

    this.marbles.set(username, {
      id,
      username,
      body,
      color,
      skin,
      isWinner,
      spawnPos: { x: pos.x, y: pos.y, z: pos.z },
      arclength: 0,
      finished: false,
      finishTime: 0,
      lastBoostTs: -Infinity,
      lastJumpTs: -Infinity,
      stuckCheckMs: 0,
      stuckCheckArclength: 0,
      stuckStreak: 0,
      heldUntilMs: 0,
      heldPosition: null,
      // Layered sensor reasons. The marble's collider becomes a sensor when
      // any reason is present (rescue teleport, freeze ray, etc). Replaces
      // the older heldActive boolean which clobbered other reasons on rescue
      // restore.
      sensorReasons: new Set(),
      // Active effect descriptors. Each entry: { kind, expiresAt, restore?,
      // tickFn? }. updateActiveEffects ticks them each frame and runs
      // restore on expiry. Halos are managed in parallel via renderer.
      activeEffects: [],
      // Set<boxId> of currently-overlapping power-up boxes. Pickup fires on
      // intersection start; entries are added then; intersection end clears
      // them so the marble can re-pickup after exiting and re-entering.
      activeBoxOverlaps: new Set(),
      lastPickupAtMs: 0,
      // Interpolated transform — computed each render frame from the physics
      // prev/curr snapshots so the marble moves smoothly between fixed-timestep
      // physics sub-steps. Camera target and HUD labels also read from these.
      interpPos: new THREE.Vector3(pos.x, pos.y, pos.z),
      interpQuat: new THREE.Quaternion()
    });
  }

  startCountdown() {
    this.state = 'countdown';
    this.countdownStartMs = performance.now();
    // Reset every marble to its assigned pen slot — during lobby, physics is
    // live and marbles drift forward down the sloped pen floor, which would
    // give whoever joined earliest a free head start at race time.
    for (const m of this.marbles.values()) {
      m.body.setTranslation(m.spawnPos, true);
      m.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      m.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      this.physics.syncMarbleTransform(m.id);
      m.arclength = 0;
      m.interpPos.set(m.spawnPos.x, m.spawnPos.y, m.spawnPos.z);
      m.interpQuat.identity();
    }
  }

  startRacing() {
    this.state = 'racing';
    this.raceStartMs = performance.now();
    const speed = this.settings.startSpeed;
    const tangent = this.track.spawnPose.tangent;
    for (const m of this.marbles.values()) {
      m.body.setLinvel({ x: tangent.x * speed, y: 0, z: tangent.z * speed }, true);
      m.stuckCheckMs = this.raceStartMs;
      m.stuckCheckArclength = m.arclength;
      m.stuckStreak = 0;
    }
  }

  tryBoost(username, now) {
    const m = this.marbles.get(username);
    if (!m || m.finished) return;
    if (now - m.lastBoostTs < this.settings.boostCooldownMs) return;
    m.lastBoostTs = now;
    const s = this.sampleAtArclength(m.arclength);
    const v = m.body.linvel();
    const dv = this.settings.boostDeltaV;
    m.body.setLinvel({
      x: v.x + s.tangent.x * dv,
      y: v.y,
      z: v.z + s.tangent.z * dv
    }, true);
  }

  tryJump(username, now) {
    const m = this.marbles.get(username);
    if (!m || m.finished) return;
    if (now - m.lastJumpTs < this.settings.jumpCooldownMs) return;
    m.lastJumpTs = now;
    const v = m.body.linvel();
    const dv = this.settings.jumpDeltaV;
    m.body.setLinvel({ x: v.x, y: Math.max(v.y, 0) + dv, z: v.z }, true);
  }

  endRace(reason) {
    if (this.state === 'finished') return;
    this.state = 'finished';
    this.raceEndMs = performance.now();
    this.resetCameraMode();
    // Clear all in-flight effects (timed buffs, debuffs) so they don't keep
    // ticking through the results screen, and despawn hazards so leftover
    // bananas/bombs don't visibly hang around.
    for (const m of this.marbles.values()) {
      this.clearMarbleEffects(m);
    }
    for (const id of Array.from(this.hazards.keys())) {
      this.removeHazard(id);
    }
    // Restore visibility for any gems still in cooldown so the results
    // screen doesn't have invisible holes wherever the camera lingers.
    for (const boxId of this.boxCooldowns.keys()) {
      this.renderer.setPowerUpBoxVisible(boxId, true);
    }
    this.boxCooldowns.clear();
    this.lastPickupPopup = null;
    console.log(`[marbles-3d] race ended: ${reason}`);
  }

  // ========== Power-up framework ==========

  // Layered sensor toggling — many effects (rescue, freeze, future ghost
  // states) want the marble's collider in sensor mode. Tracking reasons in a
  // Set means they don't clobber each other on restore.
  addSensorReason(m, reason) {
    if (m.sensorReasons.has(reason)) return;
    m.sensorReasons.add(reason);
    if (m.sensorReasons.size === 1) {
      this.physics.setMarbleSensor(m.id, true);
    }
  }

  removeSensorReason(m, reason) {
    if (!m.sensorReasons.has(reason)) return;
    m.sensorReasons.delete(reason);
    if (m.sensorReasons.size === 0) {
      this.physics.setMarbleSensor(m.id, false);
    }
  }

  hasEffect(m, kind) {
    return m.activeEffects?.some(e => e.kind === kind) ?? false;
  }

  // Targeting helpers. All filter !finished and !frozen so attacks can't
  // chain on the same already-disabled marble. nearestArclength's hint window
  // can lag a frame after a teleport, so callers that snap a marble's
  // position should also set m.arclength manually before relying on these.

  findMarbleAhead(m) {
    let best = null;
    let bestArc = Infinity;
    for (const other of this.marbles.values()) {
      if (other === m) continue;
      if (other.finished) continue;
      if (other.sensorReasons.has('frozen')) continue;
      if (other.arclength <= m.arclength) continue;
      if (other.arclength < bestArc) {
        bestArc = other.arclength;
        best = other;
      }
    }
    return best;
  }

  findLeader(excludeId = null) {
    let best = null;
    let bestArc = -Infinity;
    for (const other of this.marbles.values()) {
      if (other.finished) continue;
      if (excludeId && other.id === excludeId) continue;
      if (other.sensorReasons.has('frozen')) continue;
      if (other.arclength > bestArc) {
        bestArc = other.arclength;
        best = other;
      }
    }
    return best;
  }

  findRandomOther(m) {
    const candidates = [];
    for (const other of this.marbles.values()) {
      if (other === m) continue;
      if (other.finished) continue;
      if (other.sensorReasons.has('frozen')) continue;
      candidates.push(other);
    }
    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  // Star: total damage immunity. Shield: absorb one and consume.
  // Returns true if the hit was absorbed (caller should skip applying the
  // damage payload). Banana/bomb still consume themselves on a Star marble —
  // makes Star feel rewarding and prevents bananas from "guarding" themselves.
  absorbHit(target, now) {
    if (!target?.activeEffects) return false;
    if (this.hasEffect(target, 'star')) return true;
    const idx = target.activeEffects.findIndex(e => e.kind === 'shield');
    if (idx !== -1) {
      target.activeEffects.splice(idx, 1);
      this.renderer.setMarbleEffectVisual(target.id, 'shield', false);
      return true;
    }
    return false;
  }

  // Used by freeze ray and blue shell. Pins the target via sensor + per-tick
  // zero-velocity, identical pattern to rescue but with its own reason key
  // so rescue restoring doesn't end an active freeze.
  applyFreeze(target, now, durationMs) {
    const t = target.body.translation();
    const heldPos = { x: t.x, y: t.y + 0.05, z: t.z };
    this.addSensorReason(target, 'frozen');
    target.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    target.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.addEffect(target, {
      kind: 'frozen',
      expiresAt: now + durationMs,
      tickFn: (ctx, marble) => {
        marble.body.setTranslation(heldPos, true);
        marble.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        marble.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      },
      restore: (ctx, marble) => {
        ctx.removeSensorReason(marble, 'frozen');
      }
    });
  }

  // Push an effect descriptor onto a marble. Refresh-by-replace: same kind
  // already present is dropped without running its restore (the new apply
  // already re-asserted the state, so re-running the old restore would undo
  // it — e.g. mini's restore would set radius back to base while we still
  // want it shrunk).
  addEffect(marble, descriptor) {
    if (!marble) return;
    const existingIdx = marble.activeEffects.findIndex(e => e.kind === descriptor.kind);
    if (existingIdx !== -1) {
      marble.activeEffects.splice(existingIdx, 1);
    }
    marble.activeEffects.push(descriptor);
    if (descriptor.kind) {
      this.renderer.setMarbleEffectVisual(marble.id, descriptor.kind, true);
    }
  }

  applyPowerUp(activator, powerup, now) {
    if (!activator || !powerup) return;
    if (activator.finished) return;
    let descriptors;
    try {
      descriptors = powerup.apply(this, activator, now);
    } catch (err) {
      console.error('[marbles-3d] power-up apply failed:', powerup.id, err);
      return;
    }
    if (descriptors) {
      for (const d of descriptors) {
        const target = d.target ?? activator;
        delete d.target;
        this.addEffect(target, d);
      }
    }
    this.lastPickupPopup = {
      username: activator.username,
      userColor: activator.color,
      name: powerup.name,
      emoji: powerup.emoji,
      color: powerup.color,
      expiresAt: now + 1500
    };
  }

  onBoxIntersection(marbleId, boxId, started) {
    const m = this.marbles.get(marbleId);
    if (!m) return;
    if (started) {
      // Already overlapping — don't double-fire if Rapier emits a second
      // start without an intervening stop (shouldn't happen, but cheap to guard).
      if (m.activeBoxOverlaps.has(boxId)) return;
      m.activeBoxOverlaps.add(boxId);
      // Pickup gating: state must be racing, marble not finished, and a tiny
      // safety net cooldown to handle event jitter.
      if (this.state !== 'racing') return;
      if (m.finished) return;
      const now = performance.now();
      // Per-box cooldown: a recently-collected box stays hidden+inert for 2s.
      // Other marbles still get intersection events (so they're tracked for
      // overlap state), but no power-up fires.
      const cooldownExpires = this.boxCooldowns.get(boxId);
      if (cooldownExpires !== undefined && now < cooldownExpires) return;
      if (now - m.lastPickupAtMs < 250) return;
      m.lastPickupAtMs = now;
      const powerup = pickRandomPowerUp();
      this.applyPowerUp(m, powerup, now);
      // Hide the gem and start the cooldown timer. updateBoxCooldowns will
      // reveal and clear the entry once the timer expires.
      this.boxCooldowns.set(boxId, now + this.boxCooldownMs);
      this.renderer.setPowerUpBoxVisible(boxId, false);
    } else {
      m.activeBoxOverlaps.delete(boxId);
    }
  }

  updateBoxCooldowns(now) {
    if (this.boxCooldowns.size === 0) return;
    for (const [boxId, expiresAt] of this.boxCooldowns) {
      if (now >= expiresAt) {
        this.boxCooldowns.delete(boxId);
        this.renderer.setPowerUpBoxVisible(boxId, true);
      }
    }
  }

  onProjectileHit(marbleId, projectileId, kind) {
    if (this.state !== 'racing') return;
    const m = this.marbles.get(marbleId);
    const hazard = this.hazards.get(projectileId);
    if (!m || !hazard) return;
    if (m.finished) return;
    if (typeof hazard.onHit !== 'function') return;
    const now = performance.now();
    const consumed = hazard.onHit(this, m, hazard, now);
    if (consumed) this.removeHazard(projectileId);
  }

  spawnHazard(kind, position, opts = {}) {
    const id = `${kind}_${this._nextHazardId++}`;
    const radius = opts.radius ?? 0.22;
    this.physics.addProjectile(id, kind, position, radius,
      { isStatic: true, isSensor: true });
    this.renderer.spawnProjectile(id, kind, position, { radius });
    const hazard = {
      id, kind,
      position: { x: position.x, y: position.y, z: position.z },
      radius,
      owner: opts.owner,
      spawnedAt: opts.spawnedAt ?? performance.now(),
      maxAgeMs: opts.maxAgeMs ?? 30000,
      ownerImmunityMs: opts.ownerImmunityMs ?? 0,
      explodesAt: opts.explodesAt,
      explosionRadius: opts.explosionRadius,
      onHit: opts.onHit,
      onExplode: opts.onExplode
    };
    this.hazards.set(id, hazard);
    return hazard;
  }

  removeHazard(id) {
    if (!this.hazards.has(id)) return;
    this.physics.removeProjectile(id);
    this.renderer.removeProjectile(id);
    this.hazards.delete(id);
  }

  updateHazards(now) {
    if (this.hazards.size === 0) return;
    const expired = [];
    for (const h of this.hazards.values()) {
      if (h.explodesAt !== undefined && now >= h.explodesAt) {
        try { h.onExplode?.(this, h, now); }
        catch (err) { console.error('[marbles-3d] hazard explode failed:', err); }
        expired.push(h.id);
        continue;
      }
      if (now - h.spawnedAt > h.maxAgeMs) {
        expired.push(h.id);
      }
    }
    for (const id of expired) this.removeHazard(id);
  }

  updateActiveEffects(m, nowMs, dt) {
    // Iterate by index so we can splice expired without breaking iteration.
    for (let i = m.activeEffects.length - 1; i >= 0; i--) {
      const e = m.activeEffects[i];
      if (nowMs >= e.expiresAt) {
        try { e.restore?.(this, m); }
        catch (err) { console.error('[marbles-3d] effect restore failed:', e.kind, err); }
        m.activeEffects.splice(i, 1);
        if (e.kind) this.renderer.setMarbleEffectVisual(m.id, e.kind, false);
        continue;
      }
      if (e.tickFn) {
        try { e.tickFn(this, m, dt, nowMs); }
        catch (err) { console.error('[marbles-3d] effect tick failed:', e.kind, err); }
      }
    }
  }

  clearMarbleEffects(m) {
    if (!m.activeEffects?.length) {
      // Still clear non-rescue sensor reasons in case any leaked.
      if (m.sensorReasons) {
        for (const r of Array.from(m.sensorReasons)) {
          if (r !== 'rescue') this.removeSensorReason(m, r);
        }
      }
      return;
    }
    for (const e of m.activeEffects) {
      try { e.restore?.(this, m); }
      catch (err) { console.error('[marbles-3d] effect restore failed:', e.kind, err); }
      if (e.kind && this.renderer) this.renderer.setMarbleEffectVisual(m.id, e.kind, false);
    }
    m.activeEffects = [];
    // Drop all non-rescue sensor reasons (rescue manages its own lifecycle in
    // updateMarble; effects own their own reasons via restore handlers).
    if (m.sensorReasons) {
      for (const r of Array.from(m.sensorReasons)) {
        if (r !== 'rescue') this.removeSensorReason(m, r);
      }
    }
  }

  sampleAtArclength(arclength) {
    // Interpolates frame (position/tangent/up/right) between adjacent samples
    // rather than snapping to a discrete sample. The camera depends on this
    // and snapped frames make orientation step-lurch on turns.
    const samples = this.track.samples;
    const spacing = this.track.sampleSpacing;
    const f = Math.max(0, Math.min(samples.length - 1.0001, arclength / spacing));
    const i0 = Math.floor(f);
    const i1 = Math.min(samples.length - 1, i0 + 1);
    const t = f - i0;
    const s0 = samples[i0];
    const s1 = samples[i1];
    if (t < 1e-4 || i0 === i1) return s0;
    return {
      position: new THREE.Vector3().lerpVectors(s0.position, s1.position, t),
      tangent: new THREE.Vector3().lerpVectors(s0.tangent, s1.tangent, t).normalize(),
      up: new THREE.Vector3().lerpVectors(s0.up, s1.up, t).normalize(),
      right: new THREE.Vector3().lerpVectors(s0.right, s1.right, t).normalize(),
      arclength
    };
  }

  isInCatchBox(t) {
    // Fallback finish trigger: a marble that flies over a wall and lands in
    // the basin wouldn't necessarily advance its arclength to finishArclength
    // (nearestArclength only searches a small window around the previous
    // arclength, so an airborne marble can keep a stale progress metric).
    const b = this.track?.catchBox?.bounds;
    if (!b) return false;
    const dx = t.x - b.center.x;
    const dy = t.y - b.center.y;
    const dz = t.z - b.center.z;
    const lx = dx * b.side.x + dy * b.side.y + dz * b.side.z;
    const ly = dx * b.up.x + dy * b.up.y + dz * b.up.z;
    const lz = dx * b.forward.x + dy * b.forward.y + dz * b.forward.z;
    const h = b.halfExtents;
    return Math.abs(lx) <= h.x && Math.abs(ly) <= h.y && Math.abs(lz) <= h.z;
  }

  handleCameraCommand(cmd, arg) {
    // !spectate without an arg is a no-op — spectate only targets a user.
    if (cmd === '!spectate' && !arg) return;

    const lowerArg = arg.toLowerCase();
    if (!arg || lowerArg === 'auto' || lowerArg === 'leader') {
      this.cameraMode = 'auto';
      this.cameraTargetUser = null;
      this.cameraFinishedLingerUntilMs = 0;
      console.log('[marbles-3d] camera mode → auto');
      return;
    }
    if (lowerArg === 'all') {
      this.cameraMode = 'all';
      this.cameraTargetUser = null;
      this.cameraFinishedLingerUntilMs = 0;
      console.log('[marbles-3d] camera mode → all');
      return;
    }

    // Resolve username case-insensitively against the marbles Map. The Map
    // key preserves the original username case (used for HUD display), so we
    // walk keys to find a match rather than storing a lowercase alias table.
    let resolved = null;
    for (const key of this.marbles.keys()) {
      if (key.toLowerCase() === lowerArg) { resolved = key; break; }
    }
    if (!resolved) return; // silent ignore on unknown target

    this.cameraMode = 'user';
    this.cameraTargetUser = resolved;
    this.cameraFinishedLingerUntilMs = 0;
    console.log(`[marbles-3d] camera mode → user (${resolved})`);
  }

  pickAutoLeader() {
    // Unfinished marble with greatest arclength; fallback to any marble by
    // arclength so we still have something to look at in the finish state.
    let leader = null;
    let leaderArc = -Infinity;
    for (const m of this.marbles.values()) {
      if (m.finished) continue;
      if (m.arclength > leaderArc) {
        leaderArc = m.arclength;
        leader = m;
      }
    }
    if (!leader) {
      for (const m of this.marbles.values()) {
        if (m.arclength > leaderArc) {
          leaderArc = m.arclength;
          leader = m;
        }
      }
    }
    return leader;
  }

  computeChaseFrame(marble) {
    // Use the interpolated position so the camera target is smooth between
    // physics ticks — otherwise the target steps at 60 Hz and the camera's
    // position lerp inherits that judder.
    const t = marble.interpPos;
    const s = this.sampleAtArclength(marble.arclength);
    const horizTan = new THREE.Vector3(s.tangent.x, 0, s.tangent.z);
    if (horizTan.lengthSq() < 1e-6) horizTan.set(1, 0, 0);
    else horizTan.normalize();
    const camTarget = new THREE.Vector3(t.x, t.y, t.z)
      .addScaledVector(horizTan, -5)
      .add(new THREE.Vector3(0, 2.5, 0));
    const lookAt = new THREE.Vector3(t.x, t.y + 0.3, t.z)
      .addScaledVector(horizTan, 2);
    return { camTarget, lookAt };
  }

  computeAllViewFrame() {
    // Dynamic iso-ish framing: frame the active marble pack, oriented behind
    // the leader's direction of travel so the camera isn't pointed at a wall
    // when the track curves. Height/distance ≈ 0.4 gives a ~25° down-pitch.
    const active = [];
    for (const m of this.marbles.values()) if (!m.finished) active.push(m);
    const marbles = active.length > 0 ? active : Array.from(this.marbles.values());

    if (marbles.length === 0) {
      const spawn = this.track.spawnPose.position;
      return {
        camTarget: new THREE.Vector3(spawn.x - 5, spawn.y + 3, 8),
        lookAt: new THREE.Vector3(spawn.x, spawn.y, spawn.z)
      };
    }

    const C = new THREE.Vector3();
    for (const m of marbles) C.add(m.interpPos);
    C.multiplyScalar(1 / marbles.length);

    // Horizontal spread only — vertical spread is dominated by the track's
    // descent and would make the camera lurch up/down as the pack crests bumps.
    let R = 0;
    for (const m of marbles) {
      const dx = m.interpPos.x - C.x;
      const dz = m.interpPos.z - C.z;
      const r = Math.sqrt(dx * dx + dz * dz);
      if (r > R) R = r;
    }

    const leader = this.pickAutoLeader();
    const horizTan = new THREE.Vector3(1, 0, 0);
    if (leader) {
      const s = this.sampleAtArclength(leader.arclength);
      horizTan.set(s.tangent.x, 0, s.tangent.z);
      if (horizTan.lengthSq() < 1e-6) horizTan.set(1, 0, 0);
      else horizTan.normalize();
    }

    const distance = Math.max(12, Math.min(60, R * 2.5 + 8));
    const height = Math.max(7, Math.min(30, R * 1.0 + 6));
    const camTarget = C.clone()
      .addScaledVector(horizTan, -distance)
      .add(new THREE.Vector3(0, height, 0));
    const lookAt = C.clone().add(new THREE.Vector3(0, 0.5, 0));
    return { camTarget, lookAt };
  }

  updateCamera() {
    if (!this.track || !this.renderer) return;
    const nowMs = performance.now();

    let marbleToFollow = null;
    let useAllView = false;

    if (this.cameraMode === 'user') {
      const m = this.marbles.get(this.cameraTargetUser);
      if (!m) {
        // Target left the race (e.g. teardown) — fall back to auto.
        this.cameraMode = 'auto';
        this.cameraTargetUser = null;
        this.cameraFinishedLingerUntilMs = 0;
      } else if (m.finished) {
        if (this.cameraFinishedLingerUntilMs === 0) {
          this.cameraFinishedLingerUntilMs = nowMs + 3000;
        }
        if (nowMs < this.cameraFinishedLingerUntilMs) {
          marbleToFollow = m; // linger on the finish moment
        } else {
          this.cameraMode = 'auto';
          this.cameraTargetUser = null;
          this.cameraFinishedLingerUntilMs = 0;
        }
      } else {
        marbleToFollow = m;
      }
    } else if (this.cameraMode === 'all') {
      useAllView = true;
    }

    if (!marbleToFollow && !useAllView) marbleToFollow = this.pickAutoLeader();

    const cam = this.renderer.camera;
    let camTarget, lookAt;
    if (useAllView) {
      ({ camTarget, lookAt } = this.computeAllViewFrame());
    } else if (marbleToFollow) {
      ({ camTarget, lookAt } = this.computeChaseFrame(marbleToFollow));
    } else {
      const spawn = this.track.spawnPose.position;
      camTarget = new THREE.Vector3(spawn.x - 5, spawn.y + 3, 8);
      lookAt = new THREE.Vector3(spawn.x, spawn.y, spawn.z);
    }

    // Lerp BOTH position and lookAt target. Without lerping the lookAt, the
    // camera orientation snaps to every frame's target even when its position
    // is smoothed, so a jittery target makes the view yaw-jerk on turns.
    // The same lerp handles mode transitions — switching cameraMode only
    // changes the target each frame, so the camera glides between modes
    // instead of cutting.
    cam.position.lerp(camTarget, 0.08);
    if (!this._camLookAt) this._camLookAt = lookAt.clone();
    else this._camLookAt.lerp(lookAt, 0.1);
    cam.up.set(0, 1, 0); // world-up: keeps view level even through banked curves
    cam.lookAt(this._camLookAt);
  }

  startLoop() {
    this.lastFrameMs = performance.now();
    this.frameWindowStartMs = this.lastFrameMs;
    const loop = (nowMs) => {
      const realDt = Math.min((nowMs - this.lastFrameMs) / 1000, 0.1);
      this.lastFrameMs = nowMs;
      this.tick(nowMs, realDt);
      this.render(nowMs);
      this.frameCountWindow++;
      const elapsedMs = nowMs - this.frameWindowStartMs;
      if (elapsedMs >= 1000) {
        this.fps = (this.frameCountWindow * 1000) / elapsedMs;
        this.frameCountWindow = 0;
        this.frameWindowStartMs = nowMs;
      }
      this.animationFrame = requestAnimationFrame(loop);
    };
    this.animationFrame = requestAnimationFrame(loop);
  }

  tick(nowMs, realDt) {
    if (this.physics) this.physics.step(realDt);

    // Freeze marbles in place during countdown so a small slope or collision
    // nudge doesn't drift them off the start platform before the race begins.
    // We allow downward vy (so they still settle onto the floor) but pin x/z
    // motion and angular velocity.
    if (this.state === 'countdown') {
      for (const m of this.marbles.values()) {
        const v = m.body.linvel();
        m.body.setLinvel({ x: 0, y: Math.min(v.y, 0), z: 0 }, true);
        m.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    }

    if (this.track && (this.state === 'countdown' || this.state === 'racing' || this.state === 'finished')) {
      for (const m of this.marbles.values()) {
        this.updateMarble(m, nowMs, realDt);
      }
    }

    // Tick track-spawned hazards (banana max-age, bomb fuse).
    if (this.state === 'racing' && this.hazards.size > 0) {
      this.updateHazards(nowMs);
    }

    // Re-show power-up gems whose 2s cooldowns have elapsed.
    if (this.state === 'racing' && this.boxCooldowns.size > 0) {
      this.updateBoxCooldowns(nowMs);
    }

    if (this.state === 'countdown') {
      if (nowMs - this.countdownStartMs >= this.settings.countdownMs) {
        this.startRacing();
      }
    } else if (this.state === 'racing') {
      if (this.marbles.size > 0 && this.finishOrder.length >= this.marbles.size) {
        this.endRace('all-finished');
      } else if (nowMs - this.raceStartMs >= this.settings.raceTimeoutMs) {
        this.endRace('timeout');
      }
    } else if (this.state === 'finished') {
      if (nowMs - this.raceEndMs >= this.settings.resultsDurationMs) {
        this.teardownRace();
        this.state = 'idle';
      }
    }
  }

  updateMarble(m, nowMs, dt) {
    const t = m.body.translation();
    const s = this.sampleAtArclength(m.arclength);

    // Rescue penalty: once teleported, pin the marble in place for 1s before
    // physics takes over again. Gives other racers a tangible advantage when
    // someone falls off the track. The collider is flipped to a sensor for
    // the hold so other racers pass through the pinned marble instead of
    // piling up behind it. Sensor state is layered via sensorReasons so a
    // concurrent freeze ray or other sensor-based effect doesn't get clobbered
    // when rescue restores.
    if (m.sensorReasons.has('rescue')) {
      if (nowMs < m.heldUntilMs) {
        m.body.setTranslation(m.heldPosition, true);
        m.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        m.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        // Collapse prev=curr so the renderer shows the marble pinned, not
        // lerping in from wherever it was before the rescue teleport.
        this.physics.syncMarbleTransform(m.id);
        return;
      }
      this.removeSensorReason(m, 'rescue');
    }

    // Kill-plane recovery: teleport back to the nearest spline point if the
    // marble has fallen well below the TRACK at its current arclength. An
    // absolute y threshold doesn't work because the track itself descends
    // tens of meters over a long course — a marble rolling normally at the
    // bottom of the course would otherwise keep tripping the kill-plane.
    if (t.y < s.position.y - 5) {
      const recover = s.position.clone().addScaledVector(s.up, 0.6);
      m.body.setTranslation({ x: recover.x, y: recover.y, z: recover.z }, true);
      m.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      m.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      // Snap interpolation state to the rescue point so the marble doesn't
      // streak across the scene from its fallen position.
      this.physics.syncMarbleTransform(m.id);
      this.addSensorReason(m, 'rescue');
      m.heldUntilMs = nowMs + 1000;
      m.heldPosition = { x: recover.x, y: recover.y, z: recover.z };
      m.stuckCheckMs = nowMs + 1000;
      m.stuckCheckArclength = m.arclength;
      return;
    }

    const worldPos = new THREE.Vector3(t.x, t.y, t.z);
    m.arclength = nearestArclength(this.track, worldPos, m.arclength);

    // Tick active power-up effects between arclength update and finish
    // detection. Effects need fresh arclength for targeting/centerline lookups
    // (magnet, rocket); but expiring effects shouldn't run after a marble is
    // declared finished, which clears effects below.
    if (m.activeEffects.length > 0) {
      this.updateActiveEffects(m, nowMs, dt);
    }

    if (!m.finished && this.state === 'racing' &&
        (m.arclength >= this.track.finishArclength || this.isInCatchBox(t))) {
      m.finished = true;
      m.finishTime = performance.now() - this.raceStartMs;
      this.finishOrder.push(m.username);
      if (this.finishOrder.length === 1) setLastWinner(m.username);
      // Slow the marble so it doesn't barrel off the end of the finish platform.
      const v = m.body.linvel();
      m.body.setLinvel({ x: v.x * 0.3, y: v.y, z: v.z * 0.3 }, true);
      // Clear effects on finish so a Star marble doesn't keep buffing itself
      // through the results screen and so finished marbles can't be targeted.
      this.clearMarbleEffects(m);
      console.log(`[marbles-3d] ${m.username} finished in ${(m.finishTime / 1000).toFixed(2)}s`);
      return;
    }

    if (m.finished || this.state !== 'racing') return;

    // Stuck-detection nudge: every 2s, if the marble hasn't advanced at least
    // 0.8m of arclength, kick it along the track tangent. Escalating speed
    // + small hop on 2nd+ failure clears valleys and ramp crests. Skip when
    // an effect is intentionally violating progress (Star can tunnel; freeze
    // pins in place by design).
    if (this.hasEffect(m, 'star') || this.hasEffect(m, 'frozen')) {
      m.stuckCheckMs = nowMs;
      m.stuckCheckArclength = m.arclength;
    } else if (nowMs - m.stuckCheckMs >= 2000) {
      const progress = m.arclength - m.stuckCheckArclength;
      if (progress < 0.8) {
        m.stuckStreak += 1;
        const s = this.sampleAtArclength(m.arclength);
        const v = m.body.linvel();
        const kick = 2 + m.stuckStreak * 1.5;
        const hop = m.stuckStreak >= 2 ? 2.5 : 0;
        m.body.setLinvel({
          x: v.x + s.tangent.x * kick,
          y: (hop > 0 ? Math.max(0, v.y) : v.y) + hop,
          z: v.z + s.tangent.z * kick
        }, true);
      } else {
        m.stuckStreak = 0;
      }
      m.stuckCheckMs = nowMs;
      m.stuckCheckArclength = m.arclength;
    }
  }

  // Lerp position and slerp rotation from each marble's physics prev/curr
  // snapshot by the current accumulator alpha. Writes into m.interpPos /
  // m.interpQuat so downstream consumers (renderer, camera, labels) share one
  // smooth source of truth per render frame.
  updateInterpolatedTransforms() {
    const states = this.physics?.marbleStates;
    if (!states) return;
    const alpha = this.physics.alpha;
    const scratch = this._scratchQuat ?? (this._scratchQuat = new THREE.Quaternion());
    for (const m of this.marbles.values()) {
      const st = states.get(m.id);
      if (!st) continue;
      m.interpPos.set(
        st.prevPos.x + (st.currPos.x - st.prevPos.x) * alpha,
        st.prevPos.y + (st.currPos.y - st.prevPos.y) * alpha,
        st.prevPos.z + (st.currPos.z - st.prevPos.z) * alpha
      );
      m.interpQuat.set(st.prevRot.x, st.prevRot.y, st.prevRot.z, st.prevRot.w);
      scratch.set(st.currRot.x, st.currRot.y, st.currRot.z, st.currRot.w);
      m.interpQuat.slerp(scratch, alpha);
    }
  }

  render(nowMs) {
    // Sync 3D meshes from physics bodies.
    if (this.physics && this.renderer) {
      this.updateInterpolatedTransforms();
      for (const m of this.marbles.values()) {
        this.renderer.syncMarble(m.id, m.interpPos, m.interpQuat);
      }
      this.updateCamera();
      this.renderer.render();
    }

    // HUD pass (2D canvas overlay).
    const ctx = this.hudCtx;
    const cw = this.canvasHud.width;
    const ch = this.canvasHud.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawHud(ctx, nowMs);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // ========== HUD (ported verbatim from 2D overlay; reused unchanged in Phase 2) ==========

  drawPanel(ctx, x, y, w, h, alpha = 0.72) {
    ctx.fillStyle = `rgba(0,0,0,${alpha})`;
    const r = 16;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
  }

  drawHud(ctx, nowMs) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    if (this.state === 'idle') {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 28px system-ui, sans-serif';
      const label = 'Mods: type !lobby to start a marble race';
      const tw = ctx.measureText(label).width;
      const panelW = tw + 40;
      const panelH = 48;
      this.drawPanel(ctx, vw / 2 - panelW / 2, vh / 2 - panelH / 2, panelW, panelH);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, vw / 2, vh / 2);
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
    const names = Array.from(this.marbles.keys());
    const colW = 220;
    const rowH = 28;
    const padX = 80;
    const startY = vh * 0.44;
    const cols = Math.max(1, Math.floor((vw - padX * 2) / colW));
    const maxRows = Math.max(1, Math.floor((vh - startY - 80) / rowH));
    const maxShown = cols * maxRows;
    const shown = Math.min(names.length, maxShown);
    const usedCols = shown > 0 ? Math.min(cols, Math.ceil(shown / maxRows)) : 0;
    const usedRows = shown > 0 ? Math.min(maxRows, shown) : 0;

    const panelX = padX - 40;
    const panelY = vh * 0.10;
    const listBottom = usedRows > 0 ? startY + usedRows * rowH : startY;
    const overflowBottom = names.length > maxShown ? vh - 40 : listBottom;
    const footerBottom = vh - 14;
    const panelBottom = Math.max(listBottom + 20, overflowBottom, footerBottom);
    const panelH = panelBottom - panelY;
    const contentW = usedCols > 0 ? usedCols * colW : 0;
    const panelW = Math.max(vw * 0.5, contentW + 80, 720);
    const clampedW = Math.min(panelW, vw - (padX - 40) * 2);
    const panelXCentered = vw / 2 - clampedW / 2;
    this.drawPanel(ctx, panelXCentered, panelY, clampedW, panelH);

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

    ctx.font = '20px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const listLeft = vw / 2 - (usedCols * colW) / 2;
    for (let i = 0; i < shown; i++) {
      const col = Math.floor(i / maxRows);
      const row = i % maxRows;
      const x = (usedCols > 0 ? listLeft : padX) + col * colW;
      const y = startY + row * rowH;
      ctx.fillStyle = colorFromUsername(names[i]);
      ctx.fillText('● ' + names[i], x, y);
    }
    if (names.length > maxShown) {
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.textAlign = 'center';
      ctx.fillText(`…and ${names.length - maxShown} more`, vw / 2, vh - 56);
    }

    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = '20px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Mods: type !start to begin', vw / 2, vh - 30);
  }

  drawCountdownHud(ctx, vw, vh, nowMs) {
    this.drawMarbleLabels(ctx, vw, vh);

    const elapsed = nowMs - this.countdownStartMs;
    const remaining = Math.max(0, this.settings.countdownMs - elapsed);
    const secsLeft = Math.ceil(remaining / 1000);
    const label = secsLeft > 0 ? String(secsLeft) : 'GO!';

    const panelW = 420;
    const panelH = 320;
    this.drawPanel(ctx, vw / 2 - panelW / 2, vh / 2 - panelH / 2, panelW, panelH);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 240px system-ui, sans-serif';
    ctx.fillText(label, vw / 2, vh / 2);
  }

  // Project each marble's world position to screen space and draw its name
  // above it. Runs in both countdown (to identify balls at the line) and
  // racing states.
  drawMarbleLabels(ctx, vw, vh) {
    if (!this.settings.showNames) return;
    if (!this.renderer || !this.renderer.camera) return;
    const camera = this.renderer.camera;
    const radius = this.settings.marbleRadius;
    const tmp = new THREE.Vector3();
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    for (const m of this.marbles.values()) {
      // Interpolated position keeps the label glued to the mesh; reading the
      // raw body position makes labels snap at 60 Hz while the mesh is smooth.
      const t = m.interpPos;
      tmp.set(t.x, t.y + radius + 0.25, t.z);
      tmp.project(camera);
      if (tmp.z <= -1 || tmp.z >= 1) continue;
      if (tmp.x < -1.1 || tmp.x > 1.1) continue;
      const sx = (tmp.x * 0.5 + 0.5) * vw;
      const sy = (1 - (tmp.y * 0.5 + 0.5)) * vh;
      const name = m.username.length > 16 ? m.username.slice(0, 15) + '…' : m.username;
      const tw = ctx.measureText(name).width;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(sx - tw / 2 - 5, sy - 15, tw + 10, 18);
      ctx.fillStyle = m.color;
      ctx.fillText(name, sx, sy - 2);
      if (m.isWinner) {
        ctx.font = '16px system-ui, sans-serif';
        ctx.fillText('👑', sx, sy - 20);
        ctx.font = 'bold 13px system-ui, sans-serif';
      }
    }
  }

  drawRacingHud(ctx, vw, vh, nowMs) {
    this.drawMarbleLabels(ctx, vw, vh);

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

    // Leaderboard (sort by arclength once Phase 2 tracks it; for now by name)
    const list = Array.from(this.marbles.values()).slice();
    list.sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return (b.arclength ?? 0) - (a.arclength ?? 0);
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
      // Active effect badges to the right of the name. Cap at 3 to keep the
      // row compact even when a marble has stacked self-buffs.
      if (m.activeEffects?.length) {
        const badges = [];
        for (const e of m.activeEffects) {
          const emoji = EFFECT_KIND_EMOJI[e.kind];
          if (emoji) badges.push(emoji);
          if (badges.length >= 3) break;
        }
        if (badges.length) {
          ctx.font = '15px system-ui, sans-serif';
          ctx.fillText(badges.join(' '), lbX + lbW - 12 - badges.length * 18, y + 1);
          ctx.font = 'bold 18px system-ui, sans-serif';
        }
      }
    }

    this.drawPickupPopup(ctx, vw, vh, nowMs);
  }

  drawPickupPopup(ctx, vw, vh, nowMs) {
    const p = this.lastPickupPopup;
    if (!p || nowMs > p.expiresAt) return;
    const remaining = p.expiresAt - nowMs;
    // Quick fade in (first 100ms) and lingering fade out over the last 600ms.
    const lifetime = 1500;
    const elapsed = lifetime - remaining;
    let alpha = 1;
    if (elapsed < 100) alpha = elapsed / 100;
    else if (remaining < 600) alpha = remaining / 600;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.textBaseline = 'middle';

    // Segmented draw — username uses the player's marble color, the arrow
    // is neutral, and the emoji + power-up name use the power-up's color.
    // Measuring each segment separately and drawing left-aligned avoids the
    // canvas API's lack of mid-string color changes.
    const segments = [
      { text: p.username,      color: p.userColor },
      { text: '  →  ',         color: 'rgba(255,255,255,0.75)' },
      { text: `${p.emoji}  `,  color: '#ffffff' },
      { text: p.name,          color: p.color }
    ];
    let totalWidth = 0;
    for (const seg of segments) {
      seg.width = ctx.measureText(seg.text).width;
      totalWidth += seg.width;
    }

    const panelW = totalWidth + 50;
    const panelH = 50;
    this.drawPanel(ctx, vw / 2 - panelW / 2, vh - 130, panelW, panelH, 0.78);

    ctx.textAlign = 'left';
    let x = vw / 2 - totalWidth / 2;
    const y = vh - 105;
    for (const seg of segments) {
      ctx.fillStyle = seg.color;
      ctx.fillText(seg.text, x, y);
      x += seg.width;
    }
    ctx.restore();
  }

  drawFinishedHud(ctx, vw, vh) {
    const panelW = 720;
    const panelH = 520;
    this.drawPanel(ctx, vw / 2 - panelW / 2, vh * 0.10, panelW, panelH);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 72px system-ui, sans-serif';
    ctx.fillText('RESULTS', vw / 2, vh * 0.16);

    const order = this.finishOrder.slice(0, 3);
    if (order.length < 3) {
      const unfinished = Array.from(this.marbles.values())
        .filter(m => !m.finished)
        .sort((a, b) => (b.arclength ?? 0) - (a.arclength ?? 0));
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
