import RAPIER from '@dimforge/rapier3d-compat';

const FIXED_DT = 1 / 60;
const MAX_SUBSTEPS = 5;

export class Physics {
  constructor(settings) {
    this.settings = settings;
    this.ready = false;
    this.world = null;
    this.eventQueue = null;

    this.marbleBodies = new Map();
    // Per-marble prev/curr transforms for render-side interpolation. Physics
    // runs at FIXED_DT while the renderer can run faster (e.g. 144 Hz); without
    // interpolation the mesh holds the same pose for multiple render frames
    // then snaps. prev = state before the last sub-step; curr = state after;
    // render lerps by alpha = accumulator / FIXED_DT.
    this.marbleStates = new Map();
    this.alpha = 0;
    this.trackBodies = [];
    this.accumulator = 0;

    // Power-up sensor bookkeeping. The handle map lets the event drain resolve
    // numeric collider handles back to gameplay identifiers (marble username or
    // box id). Marble colliders and box sensors both register here.
    this.colliderHandleToOwner = new Map();
    this.powerUpSensorBodies = [];
    this.onPowerUpIntersection = null;

    // Generic dynamic projectiles spawned by power-ups (banana, bomb, green
    // shell). Tracked so teardown can dispose them without iterating the world.
    this.projectileBodies = new Map();

    this.stepCountWindow = 0;
    this.stepWindowStartMs = 0;
    this.stepsPerSecond = 0;
  }

  async init() {
    await RAPIER.init();
    const gravityY = this.settings.gravity ?? -9.81;
    this.world = new RAPIER.World({ x: 0, y: gravityY, z: 0 });
    this.eventQueue = new RAPIER.EventQueue(true);
    this.stepWindowStartMs = performance.now();
    this.ready = true;
  }

  addGround(halfExtents = { x: 50, y: 0.5, z: 50 }, center = { x: 0, y: -0.5, z: 0 }) {
    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z);
    const body = this.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
      .setFriction(0.6)
      .setRestitution(0.2);
    this.world.createCollider(colliderDesc, body);
    return body;
  }

  buildTrack(track) {
    this.clearTrack();
    // One trimesh for the whole U-profile including walls. FIX_INTERNAL_EDGES
    // suppresses ghost contacts at shared triangle edges — without it, each
    // slice boundary on the fillet feels like a tiny wall. Zero restitution
    // keeps the piecewise-flat surface from producing micro-bounces at triangle
    // boundaries. Friction is a compromise: walls want lower friction than the
    // floor to let the marble slip sideways in turns, but one trimesh can only
    // carry one value.
    const trackBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const trackDesc = RAPIER.ColliderDesc.trimesh(
      track.floorVertices,
      track.floorIndices,
      RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES | RAPIER.TriMeshFlags.MERGE_DUPLICATE_VERTICES
    )
      .setFriction(0.45)
      .setRestitution(0.0);
    this.world.createCollider(trackDesc, trackBody);
    this.trackBodies.push(trackBody);

    // Catch basin past the finish — corrals marbles that roll off the end.
    if (track.catchBox) {
      for (const c of track.catchBox.cuboids) {
        const bodyDesc = RAPIER.RigidBodyDesc.fixed()
          .setTranslation(c.position.x, c.position.y, c.position.z)
          .setRotation(c.rotation);
        const body = this.world.createRigidBody(bodyDesc);
        const collDesc = RAPIER.ColliderDesc.cuboid(c.halfExtents.x, c.halfExtents.y, c.halfExtents.z)
          .setFriction(0.5)
          .setRestitution(0.1);
        this.world.createCollider(collDesc, body);
        this.trackBodies.push(body);
      }
    }

    // Start pen: wide staging area that funnels into the track entrance.
    if (track.startPen) {
      for (const c of track.startPen.cuboids) {
        const bodyDesc = RAPIER.RigidBodyDesc.fixed()
          .setTranslation(c.position.x, c.position.y, c.position.z)
          .setRotation(c.rotation);
        const body = this.world.createRigidBody(bodyDesc);
        const collDesc = RAPIER.ColliderDesc.cuboid(c.halfExtents.x, c.halfExtents.y, c.halfExtents.z)
          .setFriction(0.45)
          .setRestitution(0.05);
        this.world.createCollider(collDesc, body);
        this.trackBodies.push(body);
      }
    }

    // Plinko obstacles in widened sections — cylinders aligned to sample.up,
    // bouncier than walls so marbles visibly ping off them and lower friction
    // for sharp deflection. Round profile avoids the directional bias that
    // cuboid flat faces would introduce.
    if (track.obstaclePlacements) {
      for (const o of track.obstaclePlacements) {
        const bodyDesc = RAPIER.RigidBodyDesc.fixed()
          .setTranslation(o.position.x, o.position.y, o.position.z)
          .setRotation(o.rotation);
        const body = this.world.createRigidBody(bodyDesc);
        const collDesc = RAPIER.ColliderDesc.cylinder(o.halfHeight, o.radius)
          .setFriction(0.3)
          .setRestitution(0.35);
        this.world.createCollider(collDesc, body);
        this.trackBodies.push(body);
      }
    }
  }

  clearTrack() {
    for (const body of this.trackBodies) {
      this.world.removeRigidBody(body);
    }
    this.trackBodies = [];
    this.removePowerUpSensors();
    this.removeAllProjectiles();
  }

  // Sensor cuboid for a power-up box. Marble↔box overlaps emit intersection
  // events through the same drain as contact events; the handle map routes them
  // to onPowerUpIntersection in step().
  addPowerUpSensor(boxId, position, halfExtents, rotation) {
    const bodyDesc = RAPIER.RigidBodyDesc.fixed()
      .setTranslation(position.x, position.y, position.z);
    if (rotation) bodyDesc.setRotation(rotation);
    const body = this.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
      .setSensor(true)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    const collider = this.world.createCollider(colliderDesc, body);
    this.colliderHandleToOwner.set(collider.handle, { kind: 'box', id: boxId });
    this.powerUpSensorBodies.push(body);
    return collider.handle;
  }

  buildPowerUpSensors(track, onIntersection) {
    this.removePowerUpSensors();
    this.onPowerUpIntersection = onIntersection;
    if (!track?.powerUpPlacements) return;
    for (const p of track.powerUpPlacements) {
      this.addPowerUpSensor(p.id, p.position, p.halfExtents, p.rotation);
    }
  }

  removePowerUpSensors() {
    for (const body of this.powerUpSensorBodies) {
      if (body.numColliders() > 0) {
        const collider = body.collider(0);
        this.colliderHandleToOwner.delete(collider.handle);
      }
      this.world.removeRigidBody(body);
    }
    this.powerUpSensorBodies = [];
    this.onPowerUpIntersection = null;
  }

  // Spawn a dynamic ball-shaped projectile (e.g. banana sensor, bomb body).
  // Returned id is the caller's choice; physics just bookkeeps and routes
  // intersection events the same way as box sensors.
  addProjectile(id, kind, position, radius, opts = {}) {
    const isStatic = opts.isStatic ?? false;
    const isSensor = opts.isSensor ?? false;
    const bodyDesc = isStatic
      ? RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z)
      : RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(position.x, position.y, position.z)
          .setLinearDamping(opts.linearDamping ?? 0.2)
          .setAngularDamping(0.5);
    const body = this.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.ball(radius)
      .setFriction(0.4)
      .setRestitution(opts.restitution ?? 0.3)
      .setDensity(opts.density ?? 1.0)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    if (isSensor) colliderDesc.setSensor(true);
    const collider = this.world.createCollider(colliderDesc, body);
    this.colliderHandleToOwner.set(collider.handle, { kind: 'projectile', id, projectileKind: kind });
    this.projectileBodies.set(id, body);
    return body;
  }

  removeProjectile(id) {
    const body = this.projectileBodies.get(id);
    if (!body) return;
    if (body.numColliders() > 0) {
      this.colliderHandleToOwner.delete(body.collider(0).handle);
    }
    this.world.removeRigidBody(body);
    this.projectileBodies.delete(id);
  }

  removeAllProjectiles() {
    for (const id of Array.from(this.projectileBodies.keys())) {
      this.removeProjectile(id);
    }
  }

  addMarble(id, position, radius) {
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setCcdEnabled(true)
      .setAngularDamping(0.05)
      .setLinearDamping(0.01);
    const body = this.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.ball(radius)
      .setFriction(0.4)
      .setRestitution(0.1)
      .setDensity(1.0);
    const collider = this.world.createCollider(colliderDesc, body);
    this.colliderHandleToOwner.set(collider.handle, { kind: 'marble', id });
    this.marbleBodies.set(id, body);
    const r = body.rotation();
    this.marbleStates.set(id, {
      prevPos: { x: position.x, y: position.y, z: position.z },
      currPos: { x: position.x, y: position.y, z: position.z },
      prevRot: { x: r.x, y: r.y, z: r.z, w: r.w },
      currRot: { x: r.x, y: r.y, z: r.z, w: r.w }
    });
    return body;
  }

  removeMarble(id) {
    const body = this.marbleBodies.get(id);
    if (!body) return;
    if (body.numColliders() > 0) {
      this.colliderHandleToOwner.delete(body.collider(0).handle);
    }
    this.world.removeRigidBody(body);
    this.marbleBodies.delete(id);
    this.marbleStates.delete(id);
  }

  clearMarbles() {
    for (const id of Array.from(this.marbleBodies.keys())) {
      this.removeMarble(id);
    }
  }

  // Toggle marble collider sensor state. Caller (overlay) tracks layered
  // reasons (rescue + frozen + ...) and only flips this when the count goes
  // 0↔1 — replaces the older boolean heldActive that would clobber other
  // sensor reasons on rescue restore.
  setMarbleSensor(id, isSensor) {
    const body = this.marbleBodies.get(id);
    if (!body) return;
    if (body.numColliders() === 0) return;
    body.collider(0).setSensor(isSensor);
  }

  // Live radius change for grow/shrink power-ups. Rapier 0.14 supports
  // setRadius on ball colliders. Mass scales by density-volume so we leave
  // density alone and let Rapier recompute mass from the new radius.
  setMarbleRadius(id, radius) {
    const body = this.marbleBodies.get(id);
    if (!body) return;
    if (body.numColliders() === 0) return;
    body.collider(0).setRadius(radius);
  }

  // Snap both prev and curr to the body's current transform. Call after any
  // setTranslation (teleport/rescue) so the render doesn't interpolate from
  // the old position — the marble should appear at the new spot instantly.
  syncMarbleTransform(id) {
    const body = this.marbleBodies.get(id);
    const st = this.marbleStates.get(id);
    if (!body || !st) return;
    const t = body.translation();
    const r = body.rotation();
    st.prevPos.x = st.currPos.x = t.x;
    st.prevPos.y = st.currPos.y = t.y;
    st.prevPos.z = st.currPos.z = t.z;
    st.prevRot.x = st.currRot.x = r.x;
    st.prevRot.y = st.currRot.y = r.y;
    st.prevRot.z = st.currRot.z = r.z;
    st.prevRot.w = st.currRot.w = r.w;
  }

  step(realDtSeconds) {
    if (!this.ready) return 0;
    // Cap the TOTAL accumulator, not just this frame's addition. Prevents a
    // death spiral if physics ever falls behind realtime.
    this.accumulator = Math.min(this.accumulator + realDtSeconds, FIXED_DT * MAX_SUBSTEPS);
    let stepsThisFrame = 0;
    while (this.accumulator >= FIXED_DT && stepsThisFrame < MAX_SUBSTEPS) {
      // Snapshot curr → prev before stepping; after stepping, read the new
      // body state into curr. Renderer interpolates between the two.
      for (const st of this.marbleStates.values()) {
        st.prevPos.x = st.currPos.x; st.prevPos.y = st.currPos.y; st.prevPos.z = st.currPos.z;
        st.prevRot.x = st.currRot.x; st.prevRot.y = st.currRot.y; st.prevRot.z = st.currRot.z; st.prevRot.w = st.currRot.w;
      }
      this.world.step(this.eventQueue);
      for (const [id, body] of this.marbleBodies) {
        const st = this.marbleStates.get(id);
        if (!st) continue;
        const t = body.translation();
        const r = body.rotation();
        st.currPos.x = t.x; st.currPos.y = t.y; st.currPos.z = t.z;
        st.currRot.x = r.x; st.currRot.y = r.y; st.currRot.z = r.z; st.currRot.w = r.w;
      }
      this.accumulator -= FIXED_DT;
      stepsThisFrame++;
      this.stepCountWindow++;
    }
    this.alpha = this.accumulator / FIXED_DT;
    // Drain events. Sensor↔marble pairs route to the power-up callback;
    // other pairs (e.g. projectile↔marble) route to projectile handlers.
    this.eventQueue.drainCollisionEvents((h1, h2, started) => {
      const o1 = this.colliderHandleToOwner.get(h1);
      const o2 = this.colliderHandleToOwner.get(h2);
      if (!o1 || !o2) return;
      // Marble↔box: power-up pickup.
      if (o1.kind === 'marble' && o2.kind === 'box') {
        this.onPowerUpIntersection?.(o1.id, o2.id, started);
        return;
      }
      if (o1.kind === 'box' && o2.kind === 'marble') {
        this.onPowerUpIntersection?.(o2.id, o1.id, started);
        return;
      }
      // Marble↔projectile: dispatched the same way; the overlay decides what
      // each projectile kind does on hit. Only fire on start to avoid
      // double-applying when the projectile despawns.
      if (started && o1.kind === 'marble' && o2.kind === 'projectile') {
        this.onProjectileHit?.(o1.id, o2.id, o2.projectileKind);
        return;
      }
      if (started && o1.kind === 'projectile' && o2.kind === 'marble') {
        this.onProjectileHit?.(o2.id, o1.id, o1.projectileKind);
        return;
      }
    });
    this.eventQueue.drainContactForceEvents(() => {});
    const nowMs = performance.now();
    const elapsedMs = nowMs - this.stepWindowStartMs;
    if (elapsedMs >= 1000) {
      this.stepsPerSecond = (this.stepCountWindow * 1000) / elapsedMs;
      this.stepCountWindow = 0;
      this.stepWindowStartMs = nowMs;
    }
    return stepsThisFrame;
  }
}
