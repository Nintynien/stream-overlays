// Power-up registry. Each entry's `apply(ctx, m, now)` mutates state and
// returns an array of effect descriptors (or undefined for purely instant
// effects). The overlay's applyPowerUp pushes each descriptor onto the right
// marble's activeEffects, attaches the kind's halo, and tracks it for
// tick/expiry.
//
// EffectDescriptor:
//   { kind: string,
//     target?: marble (default = activator),
//     expiresAt: number (ms timestamp),
//     restore?(ctx, target),                  // run on expiry/clear
//     tickFn?(ctx, target, dt, now) }         // run each frame while active
//
// `ctx` is the Marbles3DOverlay instance — exposes:
//   sampleAtArclength, findMarbleAhead, findLeader, findRandomOther,
//   absorbHit, applyFreeze, spawnHazard, addEffect, settings, marbles, track,
//   physics, renderer.

export const POWERUPS = [
  // ─── Self — Instant ──────────────────────────────────────────────────
  {
    id: 'boost',
    name: 'Speed Boost',
    emoji: '💨',
    color: '#10b981',
    category: 'self-instant',
    apply(ctx, m, now) {
      const s = ctx.sampleAtArclength(m.arclength);
      const v = m.body.linvel();
      const dv = 12;
      m.body.setLinvel({
        x: v.x + s.tangent.x * dv,
        y: v.y + 0.5,
        z: v.z + s.tangent.z * dv
      }, true);
      return [{ kind: 'boost', expiresAt: now + 1200 }];
    }
  },
  {
    id: 'teleport',
    name: 'Teleport',
    emoji: '✨',
    color: '#a855f7',
    category: 'self-instant',
    apply(ctx, m, now) {
      const newArc = Math.min(m.arclength + 8, ctx.track.finishArclength - 0.5);
      const s = ctx.sampleAtArclength(newArc);
      const lift = ctx.settings.marbleRadius + 0.1;
      m.body.setTranslation({
        x: s.position.x + s.up.x * lift,
        y: s.position.y + s.up.y * lift,
        z: s.position.z + s.up.z * lift
      }, true);
      const speed = 5;
      m.body.setLinvel({ x: s.tangent.x * speed, y: 0, z: s.tangent.z * speed }, true);
      m.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      m.arclength = newArc;
      m.stuckCheckArclength = newArc;
      ctx.physics.syncMarbleTransform(m.id);
      return [{ kind: 'boost', expiresAt: now + 800 }];
    }
  },
  {
    id: 'swap',
    name: 'Swap Places',
    emoji: '🔄',
    color: '#ec4899',
    category: 'self-instant',
    apply(ctx, m, now) {
      const target = ctx.findMarbleAhead(m);
      if (!target) return;
      const mt = m.body.translation();
      const mv = m.body.linvel();
      const mw = m.body.angvel();
      const tt = target.body.translation();
      const tv = target.body.linvel();
      const tw = target.body.angvel();
      m.body.setTranslation({ x: tt.x, y: tt.y, z: tt.z }, true);
      m.body.setLinvel({ x: tv.x, y: tv.y, z: tv.z }, true);
      m.body.setAngvel({ x: tw.x, y: tw.y, z: tw.z }, true);
      target.body.setTranslation({ x: mt.x, y: mt.y, z: mt.z }, true);
      target.body.setLinvel({ x: mv.x, y: mv.y, z: mv.z }, true);
      target.body.setAngvel({ x: mw.x, y: mw.y, z: mw.z }, true);
      // Swap arclength so targeting helpers see the new ordering this frame
      // — nearestArclength's hint window otherwise lags by one frame.
      const tmpArc = m.arclength;
      m.arclength = target.arclength;
      target.arclength = tmpArc;
      ctx.physics.syncMarbleTransform(m.id);
      ctx.physics.syncMarbleTransform(target.id);
      return [{ kind: 'boost', expiresAt: now + 600 }];
    }
  },

  // ─── Self — Timed Buffs ──────────────────────────────────────────────
  {
    id: 'star',
    name: 'Star',
    emoji: '⭐',
    color: '#fbbf24',
    category: 'self-timed',
    apply(ctx, m, now) {
      const s = ctx.sampleAtArclength(m.arclength);
      const v = m.body.linvel();
      m.body.setLinvel({
        x: v.x + s.tangent.x * 6,
        y: v.y + 0.5,
        z: v.z + s.tangent.z * 6
      }, true);
      return [{
        kind: 'star',
        expiresAt: now + 5000,
        tickFn(ctx, marble, dt) {
          // Mild continuous tangent assist so the speed buff doesn't bleed
          // out over 5s of friction. Capped so star doesn't accelerate
          // indefinitely on a downhill.
          const s = ctx.sampleAtArclength(marble.arclength);
          const v = marble.body.linvel();
          const horiz = Math.sqrt(v.x * v.x + v.z * v.z);
          if (horiz < 9) {
            const k = 12 * dt;
            marble.body.setLinvel({
              x: v.x + s.tangent.x * k,
              y: v.y,
              z: v.z + s.tangent.z * k
            }, true);
          }
        }
      }];
    }
  },
  {
    id: 'shield',
    name: 'Shield',
    emoji: '🛡️',
    color: '#60a5fa',
    category: 'self-timed',
    apply(ctx, m, now) {
      // Marker effect — absorbHit looks for kind==='shield' and consumes it.
      return [{ kind: 'shield', expiresAt: now + 15000 }];
    }
  },
  {
    id: 'mini',
    name: 'Mini Mushroom',
    emoji: '🍄',
    color: '#22d3ee',
    category: 'self-timed',
    apply(ctx, m, now) {
      const baseR = ctx.settings.marbleRadius;
      const newR = baseR * 0.6;
      ctx.physics.setMarbleRadius(m.id, newR);
      return [{
        kind: 'mini',
        expiresAt: now + 6000,
        restore(ctx, marble) {
          // Lift y by Δr to avoid floor embed when growing back.
          const t = marble.body.translation();
          const dr = baseR - newR;
          marble.body.setTranslation({ x: t.x, y: t.y + dr + 0.02, z: t.z }, true);
          ctx.physics.setMarbleRadius(marble.id, baseR);
          ctx.physics.syncMarbleTransform(marble.id);
        }
      }];
    }
  },
  {
    id: 'mega',
    name: 'Mega Mushroom',
    emoji: '🍄',
    color: '#ef4444',
    category: 'self-timed',
    apply(ctx, m, now) {
      const baseR = ctx.settings.marbleRadius;
      const newR = baseR * 1.6;
      const t = m.body.translation();
      // Lift up first so the grown collider doesn't intersect the floor.
      m.body.setTranslation({ x: t.x, y: t.y + (newR - baseR) + 0.02, z: t.z }, true);
      ctx.physics.setMarbleRadius(m.id, newR);
      ctx.physics.syncMarbleTransform(m.id);
      return [{
        kind: 'mega',
        expiresAt: now + 6000,
        restore(ctx, marble) {
          ctx.physics.setMarbleRadius(marble.id, baseR);
        }
      }];
    }
  },
  {
    id: 'antigrav',
    name: 'Anti-Gravity',
    emoji: '🌙',
    color: '#a855f7',
    category: 'self-timed',
    apply(ctx, m, now) {
      m.body.setGravityScale(0.3, true);
      return [{
        kind: 'antigrav',
        expiresAt: now + 4000,
        restore(ctx, marble) {
          marble.body.setGravityScale(1.0, true);
        }
      }];
    }
  },
  {
    id: 'magnet',
    name: 'Magnet',
    emoji: '🧲',
    color: '#fb923c',
    category: 'self-timed',
    apply(ctx, m, now) {
      return [{
        kind: 'magnet',
        expiresAt: now + 5000,
        tickFn(ctx, marble, dt) {
          // Pull lateral velocity component toward the track centerline at
          // this arclength. Doesn't fight the marble's tangential motion —
          // just damps the lateral drift that would carry it into a wall.
          const s = ctx.sampleAtArclength(marble.arclength);
          const t = marble.body.translation();
          const dx = s.position.x - t.x;
          const dz = s.position.z - t.z;
          const k = 8 * dt;
          const v = marble.body.linvel();
          marble.body.setLinvel({
            x: v.x + dx * k,
            y: v.y,
            z: v.z + dz * k
          }, true);
        }
      }];
    }
  },
  {
    id: 'rocket',
    name: 'Rocket Boots',
    emoji: '🚀',
    color: '#fbbf24',
    category: 'self-timed',
    apply(ctx, m, now) {
      return [{
        kind: 'rocket',
        expiresAt: now + 4000,
        tickFn(ctx, marble, dt) {
          const s = ctx.sampleAtArclength(marble.arclength);
          const v = marble.body.linvel();
          const kT = 6 * dt;
          const kY = 4 * dt;
          marble.body.setLinvel({
            x: v.x + s.tangent.x * kT,
            y: v.y + kY,
            z: v.z + s.tangent.z * kT
          }, true);
        }
      }];
    }
  },

  // ─── Targeted Attacks (auto-rule) ────────────────────────────────────
  {
    id: 'redshell',
    name: 'Red Shell',
    emoji: '🐢',
    color: '#ef4444',
    category: 'attack',
    apply(ctx, m, now) {
      const target = ctx.findMarbleAhead(m);
      if (!target) return;
      if (ctx.absorbHit(target, now)) return;
      const s = ctx.sampleAtArclength(target.arclength);
      const v = target.body.linvel();
      const dv = 9;
      target.body.setLinvel({
        x: v.x - s.tangent.x * dv,
        y: v.y + 1.8,
        z: v.z - s.tangent.z * dv
      }, true);
      return [{ kind: 'staggered', target, expiresAt: now + 600 }];
    }
  },
  {
    id: 'blueshell',
    name: 'Blue Shell',
    emoji: '🔵',
    color: '#3b82f6',
    category: 'attack',
    apply(ctx, m, now) {
      const target = ctx.findLeader(m.id);
      if (!target) return;
      if (ctx.absorbHit(target, now)) return;
      const s = ctx.sampleAtArclength(target.arclength);
      const v = target.body.linvel();
      const dv = 13;
      target.body.setLinvel({
        x: v.x - s.tangent.x * dv,
        y: v.y + 3,
        z: v.z - s.tangent.z * dv
      }, true);
      // Brief freeze on top of knockback. applyFreeze pushes its own
      // descriptor onto target.activeEffects.
      ctx.applyFreeze(target, now, 500);
      return [{ kind: 'staggered', target, expiresAt: now + 800 }];
    }
  },
  {
    id: 'freeze',
    name: 'Freeze Ray',
    emoji: '❄️',
    color: '#bae6fd',
    category: 'attack',
    apply(ctx, m, now) {
      const target = ctx.findMarbleAhead(m);
      if (!target) return;
      if (ctx.absorbHit(target, now)) return;
      ctx.applyFreeze(target, now, 1500);
    }
  },
  {
    id: 'pullback',
    name: 'Pull-Back Beam',
    emoji: '⏪',
    color: '#a855f7',
    category: 'attack',
    apply(ctx, m, now) {
      const target = ctx.findMarbleAhead(m);
      if (!target) return;
      if (ctx.absorbHit(target, now)) return;
      const newArc = Math.max(0, target.arclength - 5);
      const s = ctx.sampleAtArclength(newArc);
      const lift = ctx.settings.marbleRadius + 0.1;
      target.body.setTranslation({
        x: s.position.x + s.up.x * lift,
        y: s.position.y + s.up.y * lift,
        z: s.position.z + s.up.z * lift
      }, true);
      target.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      target.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      target.arclength = newArc;
      target.stuckCheckArclength = newArc;
      ctx.physics.syncMarbleTransform(target.id);
      return [{ kind: 'staggered', target, expiresAt: now + 800 }];
    }
  },

  // ─── Track-Spawned Hazards ───────────────────────────────────────────
  {
    id: 'banana',
    name: 'Banana Peel',
    emoji: '🍌',
    color: '#fde047',
    category: 'hazard',
    apply(ctx, m, now) {
      // Drop slightly behind the marble along -tangent so the marble that
      // dropped it doesn't immediately self-trigger.
      const dropArc = Math.max(0, m.arclength - 0.6);
      const s = ctx.sampleAtArclength(dropArc);
      const lift = 0.2;
      const pos = {
        x: s.position.x + s.up.x * lift,
        y: s.position.y + s.up.y * lift,
        z: s.position.z + s.up.z * lift
      };
      ctx.spawnHazard('banana', pos, {
        radius: 0.22,
        owner: m.id,
        spawnedAt: now,
        maxAgeMs: 30000,
        ownerImmunityMs: 800,
        onHit(ctx, target, hazard, now) {
          if (target.id === hazard.owner &&
              (now - hazard.spawnedAt) < hazard.ownerImmunityMs) return false;
          if (ctx.absorbHit(target, now)) return true; // consume even if absorbed
          const v = target.body.linvel();
          target.body.setLinvel({ x: v.x * 0.35, y: v.y, z: v.z * 0.35 }, true);
          target.body.setAngvel({ x: 8, y: 12, z: 4 }, true);
          ctx.addEffect(target, { kind: 'staggered', expiresAt: now + 1000 });
          return true;
        }
      });
    }
  },
  {
    id: 'bomb',
    name: 'Bomb',
    emoji: '💣',
    color: '#1f2937',
    category: 'hazard',
    apply(ctx, m, now) {
      const s = ctx.sampleAtArclength(m.arclength);
      const lift = 0.25;
      const pos = {
        x: s.position.x + s.up.x * lift,
        y: s.position.y + s.up.y * lift,
        z: s.position.z + s.up.z * lift
      };
      const fuseMs = 1200;
      ctx.spawnHazard('bomb', pos, {
        radius: 0.3,
        owner: m.id,
        spawnedAt: now,
        maxAgeMs: fuseMs + 100,
        explodesAt: now + fuseMs,
        explosionRadius: 4,
        onExplode(ctx, hazard, now) {
          for (const other of ctx.marbles.values()) {
            if (other.finished) continue;
            const t = other.body.translation();
            const dx = t.x - hazard.position.x;
            const dy = t.y - hazard.position.y;
            const dz = t.z - hazard.position.z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (dist > hazard.explosionRadius) continue;
            if (ctx.absorbHit(other, now)) continue;
            const falloff = 1 - dist / hazard.explosionRadius;
            const k = 12 * falloff;
            const inv = dist > 1e-3 ? 1 / dist : 0;
            const v = other.body.linvel();
            other.body.setLinvel({
              x: v.x + dx * inv * k,
              y: v.y + 4 * falloff,
              z: v.z + dz * inv * k
            }, true);
            ctx.addEffect(other, { kind: 'staggered', expiresAt: now + 800 });
          }
        }
      });
    }
  },

  // ─── AOE / Global ────────────────────────────────────────────────────
  {
    id: 'lightning',
    name: 'Lightning',
    emoji: '⚡',
    color: '#facc15',
    category: 'aoe',
    apply(ctx, m, now) {
      const baseR = ctx.settings.marbleRadius;
      const newR = baseR * 0.7;
      const descriptors = [];
      for (const other of ctx.marbles.values()) {
        if (other === m) continue;
        if (other.finished) continue;
        if (ctx.absorbHit(other, now)) continue;
        ctx.physics.setMarbleRadius(other.id, newR);
        const v = other.body.linvel();
        other.body.setLinvel({ x: v.x * 0.6, y: v.y, z: v.z * 0.6 }, true);
        descriptors.push({
          kind: 'mini',
          target: other,
          expiresAt: now + 3000,
          restore(ctx, marble) {
            ctx.physics.setMarbleRadius(marble.id, baseR);
          }
        });
      }
      return descriptors;
    }
  }
];

export const POWERUP_BY_ID = new Map(POWERUPS.map(p => [p.id, p]));

// Random pickup pool. Lightning is excluded — too disruptive when popping
// from every box. Admins can still spawn it via !powerup lightning.
export const RANDOM_POWERUP_POOL = POWERUPS.filter(p => p.id !== 'lightning');

// Pool used by !chaos. Drops Lightning AND attacks (auto-targeted attacks
// during !chaos make things confusing fast). Self-only effects only.
export const CHAOS_POWERUP_POOL = POWERUPS.filter(p =>
  p.category === 'self-instant' || p.category === 'self-timed'
);

export function pickRandomPowerUp(rng) {
  const r = (typeof rng === 'function' ? rng() : Math.random());
  return RANDOM_POWERUP_POOL[Math.floor(r * RANDOM_POWERUP_POOL.length)];
}

export function pickRandomChaosPowerUp(rng) {
  const r = (typeof rng === 'function' ? rng() : Math.random());
  return CHAOS_POWERUP_POOL[Math.floor(r * CHAOS_POWERUP_POOL.length)];
}
