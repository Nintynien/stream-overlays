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
    // Floor: one trimesh collider from U-profile bottom strip.
    const floorBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    // Zero restitution on the floor: the trimesh is piecewise-flat, so every
    // triangle boundary is a tiny crease. With any restitution the marble
    // micro-bounces at each boundary and you see it as jitter.
    const floorDesc = RAPIER.ColliderDesc.trimesh(track.floorVertices, track.floorIndices)
      .setFriction(0.55)
      .setRestitution(0.0);
    this.world.createCollider(floorDesc, floorBody);
    this.trackBodies.push(floorBody);

    // Walls: chain of overlapping cuboids (safer for fast spheres than trimesh).
    for (const p of track.wallPlacements) {
      const bodyDesc = RAPIER.RigidBodyDesc.fixed()
        .setTranslation(p.position.x, p.position.y, p.position.z)
        .setRotation(p.rotation);
      const body = this.world.createRigidBody(bodyDesc);
      const collDesc = RAPIER.ColliderDesc.cuboid(p.halfExtents.x, p.halfExtents.y, p.halfExtents.z)
        .setFriction(0.35)
        .setRestitution(0.05);
      this.world.createCollider(collDesc, body);
      this.trackBodies.push(body);
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
    this.accumulator += Math.min(realDtSeconds, FIXED_DT * MAX_SUBSTEPS);
    let stepsThisFrame = 0;
    while (this.accumulator >= FIXED_DT && stepsThisFrame < MAX_SUBSTEPS) {
      this.world.step(this.eventQueue);
      this.accumulator -= FIXED_DT;
      stepsThisFrame++;
      this.stepCountWindow++;
    }
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
