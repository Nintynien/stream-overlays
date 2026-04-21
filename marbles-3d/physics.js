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
    this.trackBodies = [];
    this.accumulator = 0;

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
  }

  clearTrack() {
    for (const body of this.trackBodies) {
      this.world.removeRigidBody(body);
    }
    this.trackBodies = [];
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
    this.world.createCollider(colliderDesc, body);
    this.marbleBodies.set(id, body);
    return body;
  }

  removeMarble(id) {
    const body = this.marbleBodies.get(id);
    if (!body) return;
    this.world.removeRigidBody(body);
    this.marbleBodies.delete(id);
  }

  clearMarbles() {
    for (const body of this.marbleBodies.values()) {
      this.world.removeRigidBody(body);
    }
    this.marbleBodies.clear();
  }

  step(realDtSeconds) {
    if (!this.ready) return 0;
    // Cap the TOTAL accumulator, not just this frame's addition. Prevents a
    // death spiral if physics ever falls behind realtime.
    this.accumulator = Math.min(this.accumulator + realDtSeconds, FIXED_DT * MAX_SUBSTEPS);
    let stepsThisFrame = 0;
    while (this.accumulator >= FIXED_DT && stepsThisFrame < MAX_SUBSTEPS) {
      this.world.step(this.eventQueue);
      this.accumulator -= FIXED_DT;
      stepsThisFrame++;
      this.stepCountWindow++;
    }
    // Drain events each frame. We don't consume them (no collider has
    // ActiveEvents set), but draining defends against any future addition
    // that would otherwise accumulate events forever.
    this.eventQueue.drainCollisionEvents(() => {});
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
