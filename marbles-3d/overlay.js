import * as THREE from 'three';
import { BaseOverlay } from '../core/base-overlay.js';
import { Physics } from './physics.js';
import { Renderer } from './renderer.js';
import { generateTrack, nearestArclength } from './track.js';

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
    }
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

    const spawn = this.track.spawnPose.position;
    const cam = this.renderer.camera;
    cam.position.set(spawn.x - 5, spawn.y + 3, 8);
    cam.lookAt(spawn.x, spawn.y, spawn.z);
    this._camLookAt = new THREE.Vector3(spawn.x, spawn.y, spawn.z);

    this.state = 'lobby';
  }

  teardownRace() {
    if (this.physics) {
      for (const m of this.marbles.values()) {
        this.physics.removeMarble(m.id);
      }
      this.physics.clearTrack();
    }
    if (this.renderer) {
      for (const m of this.marbles.values()) {
        this.renderer.removeMarbleMesh(m.id);
      }
      this.renderer.clearTrackMesh();
    }
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
    this.renderer.addMarbleMesh(id, radius, color);

    this.marbles.set(username, {
      id,
      username,
      body,
      color,
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
      heldActive: false,
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
    console.log(`[marbles-3d] race ended: ${reason}`);
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
        this.updateMarble(m, nowMs);
      }
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

  updateMarble(m, nowMs) {
    const t = m.body.translation();
    const s = this.sampleAtArclength(m.arclength);

    // Rescue penalty: once teleported, pin the marble in place for 1s before
    // physics takes over again. Gives other racers a tangible advantage when
    // someone falls off the track. The collider is flipped to a sensor for
    // the hold so other racers pass through the pinned marble instead of
    // piling up behind it.
    if (m.heldActive) {
      if (nowMs < m.heldUntilMs) {
        m.body.setTranslation(m.heldPosition, true);
        m.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        m.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        // Collapse prev=curr so the renderer shows the marble pinned, not
        // lerping in from wherever it was before the rescue teleport.
        this.physics.syncMarbleTransform(m.id);
        return;
      }
      m.body.collider(0).setSensor(false);
      m.heldActive = false;
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
      m.body.collider(0).setSensor(true);
      m.heldActive = true;
      m.heldUntilMs = nowMs + 1000;
      m.heldPosition = { x: recover.x, y: recover.y, z: recover.z };
      m.stuckCheckMs = nowMs + 1000;
      m.stuckCheckArclength = m.arclength;
      return;
    }

    const worldPos = new THREE.Vector3(t.x, t.y, t.z);
    m.arclength = nearestArclength(this.track, worldPos, m.arclength);

    if (!m.finished && this.state === 'racing' &&
        (m.arclength >= this.track.finishArclength || this.isInCatchBox(t))) {
      m.finished = true;
      m.finishTime = performance.now() - this.raceStartMs;
      this.finishOrder.push(m.username);
      // Slow the marble so it doesn't barrel off the end of the finish platform.
      const v = m.body.linvel();
      m.body.setLinvel({ x: v.x * 0.3, y: v.y, z: v.z * 0.3 }, true);
      console.log(`[marbles-3d] ${m.username} finished in ${(m.finishTime / 1000).toFixed(2)}s`);
      return;
    }

    if (m.finished || this.state !== 'racing') return;

    // Stuck-detection nudge: every 2s, if the marble hasn't advanced at least
    // 0.8m of arclength, kick it along the track tangent. Escalating speed
    // + small hop on 2nd+ failure clears valleys and ramp crests.
    if (nowMs - m.stuckCheckMs >= 2000) {
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
    }
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
