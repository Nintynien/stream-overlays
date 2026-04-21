import * as THREE from 'three';

// Phase 3: 3D procedural track with turns (XZ-plane yaw) and banking (roll around
// tangent), sampled from a Catmull-Rom spline for smooth interpolation.
//
// Feature emitters return { kind, keypoints: [{ pos: Vec3, bank: radians }, ...] }.
// The generator concatenates keypoints, builds a centripetal Catmull-Rom curve,
// and samples at fixed arclength. Frames are computed via parallel transport
// (starting with world-up), then banking is applied per-sample as roll around
// the tangent. Banking between keypoints is cosine-eased for smooth transitions.
//
// Export:
//   generateTrack(rng, settings) → same shape as before + now handles 3D curves
//   nearestArclength(track, worldPos, hintArclength) → arclength lookup for a marble

// ========== Feature helpers ==========

function horizontalTangent(tangent) {
  const h = new THREE.Vector3(tangent.x, 0, tangent.z);
  if (h.lengthSq() < 1e-6) return new THREE.Vector3(1, 0, 0);
  return h.normalize();
}

function featFlat(rng, state) {
  const len = rng.range(5, 9);
  const end = state.pos.clone().addScaledVector(horizontalTangent(state.tangent), len);
  return { kind: 'flat', keypoints: [{ pos: end, bank: 0 }] };
}

function featRampDown(rng, state) {
  const len = rng.range(4, 8);
  const drop = rng.range(1.5, 4.0);
  const end = state.pos.clone().addScaledVector(horizontalTangent(state.tangent), len);
  end.y -= drop;
  return { kind: 'rampDown', keypoints: [{ pos: end, bank: 0 }] };
}

function featRampUp(rng, state) {
  const len = rng.range(5, 8);
  const rise = rng.range(0.3, 0.9);
  const end = state.pos.clone().addScaledVector(horizontalTangent(state.tangent), len);
  end.y += rise;
  return { kind: 'rampUp', keypoints: [{ pos: end, bank: 0 }] };
}

function featBump(rng, state) {
  const w = rng.range(1.2, 2.0);
  const h = rng.range(0.25, 0.55);
  const horiz = horizontalTangent(state.tangent);
  const peak = state.pos.clone().addScaledVector(horiz, w * 0.5);
  peak.y += h;
  const end = state.pos.clone().addScaledVector(horiz, w);
  return { kind: 'bump', keypoints: [{ pos: peak, bank: 0 }, { pos: end, bank: 0 }] };
}

function featValley(rng, state) {
  const w = rng.range(3.0, 5.0);
  const d = rng.range(0.25, 0.6); // shallow — deep valleys trap the marble
  const horiz = horizontalTangent(state.tangent);
  const low = state.pos.clone().addScaledVector(horiz, w * 0.5);
  low.y -= d;
  const end = state.pos.clone().addScaledVector(horiz, w);
  return { kind: 'valley', keypoints: [{ pos: low, bank: 0 }, { pos: end, bank: 0 }] };
}

function featSpeedBumps(rng, state) {
  const count = rng.rangeInt(3, 5);
  const spacing = rng.range(0.7, 1.1);
  const height = rng.range(0.12, 0.22);
  const horiz = horizontalTangent(state.tangent);
  const keypoints = [];
  for (let i = 0; i < count; i++) {
    const peak = state.pos.clone().addScaledVector(horiz, (i + 0.5) * spacing);
    peak.y += height;
    const end = state.pos.clone().addScaledVector(horiz, (i + 1) * spacing);
    keypoints.push({ pos: peak, bank: 0 }, { pos: end, bank: 0 });
  }
  return { kind: 'speedBumps', keypoints };
}

function arcTurn(rng, state, radius, totalAngle, dir, peakBankRad) {
  // Horizontal arc rotated around world-up, centered `dir * radius` to the side.
  // Descends gently across the arc so the marble keeps momentum through curves
  // (horizontal turns otherwise bleed energy to rolling friction without any
  // gravity assist, and the marble stalls).
  const up = new THREE.Vector3(0, 1, 0);
  const horiz = horizontalTangent(state.tangent);
  const leftDir = new THREE.Vector3().crossVectors(up, horiz).normalize();
  const center = state.pos.clone().addScaledVector(leftDir, dir * radius);
  const arcLen = radius * totalAngle;
  const totalDescent = Math.max(0.4, Math.min(3.0, arcLen * 0.10)); // ~10% grade
  const numWaypoints = Math.max(6, Math.round(totalAngle * radius / 1.1));
  const keypoints = [];
  for (let i = 1; i <= numWaypoints; i++) {
    const fraction = i / numWaypoints;
    const angle = fraction * totalAngle * dir;
    const offset = state.pos.clone().sub(center).applyAxisAngle(up, angle);
    const wp = center.clone().add(offset);
    wp.y -= totalDescent * fraction;
    const bank = dir * peakBankRad * Math.sin(Math.PI * fraction);
    keypoints.push({ pos: wp, bank });
  }
  return { kind: dir > 0 ? 'turnLeft' : 'turnRight', keypoints };
}

function featTurnLeft(rng, state) {
  const minR = Math.max(state.trackHalfWidth * 5, 6);
  const radius = rng.range(minR, minR * 1.8);
  const angle = rng.range(Math.PI / 5, Math.PI / 2);
  return arcTurn(rng, state, radius, angle, +1, Math.PI / 14); // ~13° bank
}

function featTurnRight(rng, state) {
  const minR = Math.max(state.trackHalfWidth * 5, 6);
  const radius = rng.range(minR, minR * 1.8);
  const angle = rng.range(Math.PI / 5, Math.PI / 2);
  return arcTurn(rng, state, radius, angle, -1, Math.PI / 14);
}

function featBankedTurn(rng, state) {
  const dir = rng.chance(0.5) ? +1 : -1;
  const minR = Math.max(state.trackHalfWidth * 4, 5);
  const radius = rng.range(minR, minR * 1.4);
  const angle = rng.range(Math.PI / 3, Math.PI * 0.6);
  const arc = arcTurn(rng, state, radius, angle, dir, Math.PI / 6); // ~30° bank
  arc.kind = 'bankedTurn';
  return arc;
}

const FEATURE_POOL = [
  { fn: featFlat, weight: 0.7 },
  { fn: featRampDown, weight: 3.2 },  // dominant: keep track trending down
  { fn: featRampUp, weight: 0.35 },   // rare, gated to below startY in generator
  { fn: featBump, weight: 0.8 },
  { fn: featValley, weight: 0.6 },    // rare + shallow (see featValley)
  { fn: featSpeedBumps, weight: 1.0 },
  { fn: featTurnLeft, weight: 1.8 },
  { fn: featTurnRight, weight: 1.8 },
  { fn: featBankedTurn, weight: 1.4 }
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

function horizontalYawDelta(tangentA, tangentB) {
  const a = new THREE.Vector3(tangentA.x, 0, tangentA.z);
  const b = new THREE.Vector3(tangentB.x, 0, tangentB.z);
  if (a.lengthSq() < 1e-8 || b.lengthSq() < 1e-8) return 0;
  a.normalize(); b.normalize();
  const dot = Math.max(-1, Math.min(1, a.dot(b)));
  let theta = Math.acos(dot);
  // Sign from cross's Y component
  const crossY = a.x * b.z - a.z * b.x;
  if (crossY > 0) theta = -theta;
  return theta;
}

// ========== Frames ==========

function computeFramesParallelTransport(samples) {
  // Initial up = world-up projected onto the plane perpendicular to first tangent.
  const firstTan = samples[0].tangent;
  let up = new THREE.Vector3(0, 1, 0);
  up.addScaledVector(firstTan, -up.dot(firstTan));
  if (up.lengthSq() < 1e-6) {
    up.set(0, 0, 1);
    up.addScaledVector(firstTan, -up.dot(firstTan));
  }
  up.normalize();
  samples[0].up = up.clone();
  samples[0].right = new THREE.Vector3().crossVectors(samples[0].tangent, up).normalize();

  for (let i = 1; i < samples.length; i++) {
    const prevTan = samples[i - 1].tangent;
    const curTan = samples[i].tangent;
    const axis = new THREE.Vector3().crossVectors(prevTan, curTan);
    const sinLen = axis.length();
    if (sinLen > 1e-8) {
      axis.normalize();
      const cosAng = Math.max(-1, Math.min(1, prevTan.dot(curTan)));
      const angle = Math.atan2(sinLen, cosAng);
      up.applyAxisAngle(axis, angle);
      up.normalize();
    }
    samples[i].up = up.clone();
    samples[i].right = new THREE.Vector3().crossVectors(curTan, up).normalize();
  }
}

function interpolateBank(arclength, kpArclength, kpBank) {
  let idx = 0;
  while (idx < kpArclength.length - 1 && kpArclength[idx + 1] < arclength) idx++;
  if (idx >= kpArclength.length - 1) return kpBank[kpBank.length - 1];
  const a = kpArclength[idx];
  const b = kpArclength[idx + 1];
  if (b - a < 1e-6) return kpBank[idx];
  const t = (arclength - a) / (b - a);
  const ease = (1 - Math.cos(Math.PI * t)) / 2; // cosine in/out
  return kpBank[idx] * (1 - ease) + kpBank[idx + 1] * ease;
}

// ========== Geometry output for physics ==========

// Cross-section of the U-profile: left wall top, left fillet arc, flat floor,
// right fillet arc, right wall top. Returned as [lateral, vertical] pairs in
// the sample's local frame (lateral = along sample.right, vertical = along
// sample.up). The trimesh uses the subset without wall tops; the visual mesh
// uses the full profile.
function fullProfilePoints(halfWidth, wallHeight, filletRadius, filletSegments) {
  const pts = [];
  pts.push([-halfWidth, wallHeight]);
  // Left fillet arc: from (-hw, r) at angle π down to (-hw+r, 0) at angle 3π/2.
  for (let i = 0; i <= filletSegments; i++) {
    const t = i / filletSegments;
    const angle = Math.PI + t * (Math.PI / 2);
    pts.push([
      -halfWidth + filletRadius + filletRadius * Math.cos(angle),
      filletRadius + filletRadius * Math.sin(angle)
    ]);
  }
  // Right fillet arc: from (hw-r, 0) at -π/2 up to (hw, r) at 0.
  for (let i = 0; i <= filletSegments; i++) {
    const t = i / filletSegments;
    const angle = -Math.PI / 2 + t * (Math.PI / 2);
    pts.push([
      halfWidth - filletRadius + filletRadius * Math.cos(angle),
      filletRadius + filletRadius * Math.sin(angle)
    ]);
  }
  pts.push([halfWidth, wallHeight]);
  return pts; // length = 2*(filletSegments+1) + 2
}

function buildFloorTrimesh(samples, crossSectionPoints, insideStartIdx, insideEndIdx) {
  // crossSectionPoints is the full U-profile; insideStart/End are the slice
  // that excludes wall tops (the surface the marble actually contacts).
  const insideCount = insideEndIdx - insideStartIdx;
  const vertsPerSample = insideCount;
  const vertices = new Float32Array(samples.length * vertsPerSample * 3);
  const numQuads = (samples.length - 1) * (vertsPerSample - 1);
  const indices = new Uint32Array(numQuads * 2 * 3);

  const tmp = new THREE.Vector3();
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    for (let j = 0; j < vertsPerSample; j++) {
      const [lat, vert] = crossSectionPoints[insideStartIdx + j];
      tmp.copy(s.position).addScaledVector(s.right, lat).addScaledVector(s.up, vert);
      const base = (i * vertsPerSample + j) * 3;
      vertices[base + 0] = tmp.x;
      vertices[base + 1] = tmp.y;
      vertices[base + 2] = tmp.z;
    }
  }

  // Wind triangles so normals point into the track interior (away from the
  // outer wall/floor surface). For each quad between adjacent samples, two
  // triangles: (A_j, A_j1, B_j1) and (A_j, B_j1, B_j).
  let idx = 0;
  for (let i = 0; i < samples.length - 1; i++) {
    for (let j = 0; j < vertsPerSample - 1; j++) {
      const A_j = i * vertsPerSample + j;
      const A_j1 = i * vertsPerSample + j + 1;
      const B_j = (i + 1) * vertsPerSample + j;
      const B_j1 = (i + 1) * vertsPerSample + j + 1;
      indices[idx++] = A_j;
      indices[idx++] = A_j1;
      indices[idx++] = B_j1;
      indices[idx++] = A_j;
      indices[idx++] = B_j1;
      indices[idx++] = B_j;
    }
  }
  return { vertices, indices };
}

function buildWallPlacements(samples, trackHalfWidth, wallHeight, wallThickness) {
  const placements = [];
  const tmpMat = new THREE.Matrix4();
  const tmpPos = new THREE.Vector3();
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i];
    const b = samples[i + 1];
    const segLen = b.arclength - a.arclength;
    const cuboidHalfLen = segLen * 0.55;
    tmpMat.makeBasis(a.right, a.up, a.tangent);
    const quat = new THREE.Quaternion().setFromRotationMatrix(tmpMat);
    for (const side of [-1, 1]) {
      tmpPos.copy(a.position)
        .addScaledVector(a.tangent, segLen * 0.5)
        .addScaledVector(a.right, side * (trackHalfWidth + wallThickness * 0.5))
        .addScaledVector(a.up, wallHeight * 0.5);
      placements.push({
        position: { x: tmpPos.x, y: tmpPos.y, z: tmpPos.z },
        rotation: { x: quat.x, y: quat.y, z: quat.z, w: quat.w },
        halfExtents: {
          x: wallThickness * 0.5,
          y: wallHeight * 0.5,
          z: cuboidHalfLen
        }
      });
    }
  }
  return placements;
}

// ========== Main entry ==========

export function generateTrack(rng, settings) {
  const startY = settings.trackStartY ?? 3.0;
  const targetLen = rng.range(settings.courseMinLength ?? 130, settings.courseMaxLength ?? 220);
  // Allow the track to descend well past the starting y so a long course with
  // turns (which now descend gently) doesn't flatline near minY. The track is
  // the only visible surface — there's no ground plane — so a deep-running
  // track just scrolls with the camera, which follows the marble.
  const minY = settings.courseMinY ?? -30;
  const maxY = settings.courseMaxY ?? 25;
  const trackHalfWidth = settings.trackHalfWidth ?? 1.5;
  const wallHeight = settings.wallHeight ?? 1.2;
  const wallThickness = settings.wallThickness ?? 0.2;
  const sampleSpacing = settings.sampleSpacing ?? 0.4;
  const filletRadius = settings.filletRadius ?? 0.5;
  const filletSegments = settings.filletSegments ?? 4;
  const yawClamp = (settings.yawClampDeg ?? 135) * Math.PI / 180;

  // Start platform: multiple colinear keypoints keep the Catmull-Rom dead flat
  // here. With only two keypoints the curve humps upward in anticipation of
  // the lower-Y rampDown that follows, and a marble spawned on that hump
  // rolls backward off the track under gravity during countdown.
  const keypoints = [];
  for (let i = 0; i <= 4; i++) {
    keypoints.push({ pos: new THREE.Vector3(i, startY, 0), bank: 0 });
  }

  const state = {
    pos: new THREE.Vector3(4, startY, 0),
    tangent: new THREE.Vector3(1, 0, 0),
    cumulativeYaw: 0,
    trackHalfWidth,
    startY
  };

  // Open with a rampDown so the marble gains speed before any feature.
  const opener = featRampDown(rng, state);
  appendFeature(keypoints, state, opener);
  let lastKind = 'rampDown';

  let safety = 0;
  while (distanceOf(keypoints) < targetLen - 6 && safety < 200) {
    let chosen = null;
    let chosenYawDelta = 0;
    for (let attempt = 0; attempt < 20; attempt++) {
      const candidate = pickWeighted(rng, FEATURE_POOL);
      const trial = candidate.fn(rng, state);
      const endPos = trial.keypoints[trial.keypoints.length - 1].pos;

      if (endPos.y < minY || endPos.y > maxY) continue;

      // No two turns of the same direction back-to-back (avoid spirals).
      if ((trial.kind === 'turnLeft' && lastKind === 'turnLeft') ||
          (trial.kind === 'turnRight' && lastKind === 'turnRight')) continue;
      if (trial.kind === 'bankedTurn' && (lastKind === 'turnLeft' || lastKind === 'turnRight' || lastKind === 'bankedTurn')) continue;

      // rampUp is a recovery feature: only allowed after we've descended a
      // meaningful amount below the start altitude, and only after a downhill
      // feature so the marble has momentum to climb.
      if (trial.kind === 'rampUp' && state.pos.y > state.startY - 5) continue;
      if (trial.kind === 'rampUp' && lastKind !== 'rampDown' && lastKind !== 'valley') continue;
      if (trial.kind === 'rampUp' && state.pos.y < minY + 2) continue;
      if (trial.kind === 'rampDown' && state.pos.y > maxY - 2) continue;

      // Approximate yaw change from entry tangent vs. last-segment tangent.
      const kpLast = trial.keypoints[trial.keypoints.length - 1].pos;
      const kpPenult = trial.keypoints.length >= 2
        ? trial.keypoints[trial.keypoints.length - 2].pos
        : state.pos;
      const newTan = new THREE.Vector3().subVectors(kpLast, kpPenult);
      if (newTan.lengthSq() < 1e-8) newTan.copy(state.tangent);
      else newTan.normalize();
      const yawDelta = horizontalYawDelta(state.tangent, newTan);
      if (Math.abs(state.cumulativeYaw + yawDelta) > yawClamp) continue;

      chosen = trial;
      chosenYawDelta = yawDelta;
      break;
    }
    if (!chosen) {
      chosen = featFlat(rng, state);
      chosenYawDelta = 0;
    }
    appendFeature(keypoints, state, chosen);
    state.cumulativeYaw += chosenYawDelta;
    lastKind = chosen.kind;
    safety++;
  }

  // Finish platform: multiple colinear keypoints so the spline stays flat
  // past the finish line (otherwise the curve bends downward anticipating
  // the end point, and the finish marker looks tilted).
  const finishHoriz = horizontalTangent(state.tangent);
  for (let i = 1; i <= 4; i++) {
    const pt = state.pos.clone().addScaledVector(finishHoriz, i);
    keypoints.push({ pos: pt, bank: 0 });
  }

  // Centripetal Catmull-Rom gives smooth curves without self-intersections.
  const controlPoints = keypoints.map(k => k.pos);
  const curve = new THREE.CatmullRomCurve3(controlPoints, false, 'centripetal');
  curve.arcLengthDivisions = Math.max(400, controlPoints.length * 30);

  const totalLength = curve.getLength();
  const numSamples = Math.max(2, Math.floor(totalLength / sampleSpacing) + 1);
  const actualSpacing = totalLength / (numSamples - 1);

  const samples = [];
  for (let i = 0; i < numSamples; i++) {
    const u = i / (numSamples - 1);
    const pos = curve.getPointAt(u);
    const tangent = curve.getTangentAt(u);
    samples.push({ position: pos, tangent, arclength: i * actualSpacing });
  }

  computeFramesParallelTransport(samples);

  // Map each keypoint to an approximate arclength for bank interpolation.
  const kpCumLen = [0];
  for (let i = 1; i < controlPoints.length; i++) {
    kpCumLen.push(kpCumLen[i - 1] + controlPoints[i - 1].distanceTo(controlPoints[i]));
  }
  const kpLenLast = kpCumLen[kpCumLen.length - 1] || 1;
  const kpArclength = kpCumLen.map(l => l / kpLenLast * totalLength);
  const kpBank = keypoints.map(k => k.bank);

  for (const sample of samples) {
    const bank = interpolateBank(sample.arclength, kpArclength, kpBank);
    if (Math.abs(bank) > 1e-6) {
      sample.up.applyAxisAngle(sample.tangent, bank);
      sample.right.crossVectors(sample.tangent, sample.up).normalize();
    }
  }

  // Full U-profile cross-section: wall top → fillet → floor → fillet → wall top.
  // The trimesh uses the inside slice (no wall tops); the visual mesh uses it all.
  const crossSectionPoints = fullProfilePoints(trackHalfWidth, wallHeight, filletRadius, filletSegments);
  const insideStartIdx = 1;
  const insideEndIdx = crossSectionPoints.length - 1;

  const floor = buildFloorTrimesh(samples, crossSectionPoints, insideStartIdx, insideEndIdx);
  const wallPlacements = buildWallPlacements(samples, trackHalfWidth, wallHeight, wallThickness);

  const finishArclength = Math.max(0, totalLength - 2);
  const finishIdx = Math.max(0, Math.min(samples.length - 1, Math.round(finishArclength / actualSpacing)));
  const finishSample = samples[finishIdx];
  const finishMatrix = new THREE.Matrix4().makeBasis(finishSample.right, finishSample.up, finishSample.tangent);
  const finishQuat = new THREE.Quaternion().setFromRotationMatrix(finishMatrix);
  const finishMarker = {
    position: finishSample.position.clone().addScaledVector(finishSample.up, wallHeight * 0.5),
    rotation: finishQuat,
    width: trackHalfWidth * 2,
    height: wallHeight
  };

  const spawnSample = samples[1] ?? samples[0];
  const spawnPose = {
    position: spawnSample.position.clone().addScaledVector(spawnSample.up, 0.5),
    tangent: spawnSample.tangent.clone()
  };

  return {
    samples,
    totalLength,
    finishArclength,
    spawnPose,
    trackHalfWidth,
    wallHeight,
    wallThickness,
    filletRadius,
    filletSegments,
    crossSectionPoints, // renderer uses this to extrude the visible U-profile
    floorVertices: floor.vertices,
    floorIndices: floor.indices,
    wallPlacements,
    finishMarker,
    sampleSpacing: actualSpacing
  };
}

function appendFeature(keypoints, state, feature) {
  for (const k of feature.keypoints) keypoints.push(k);
  const lastPos = feature.keypoints[feature.keypoints.length - 1].pos;
  const prevPos = feature.keypoints.length >= 2
    ? feature.keypoints[feature.keypoints.length - 2].pos
    : state.pos;
  state.pos.copy(lastPos);
  const newTan = new THREE.Vector3().subVectors(lastPos, prevPos);
  if (newTan.lengthSq() > 1e-8) {
    newTan.normalize();
    state.tangent.copy(newTan);
  }
}

function distanceOf(keypoints) {
  let d = 0;
  for (let i = 1; i < keypoints.length; i++) {
    d += keypoints[i - 1].pos.distanceTo(keypoints[i].pos);
  }
  return d;
}

// ========== Arclength lookup for marble tracking ==========

export function nearestArclength(track, worldPos, hintArclength) {
  const samples = track.samples;
  if (!samples || samples.length === 0) return 0;
  const spacing = track.sampleSpacing ?? 0.5;
  const hintIdx = Math.max(0, Math.min(samples.length - 1, Math.floor((hintArclength ?? 0) / spacing)));
  const window = 32;
  const lo = Math.max(0, hintIdx - window);
  const hi = Math.min(samples.length, hintIdx + window);
  let bestIdx = hintIdx;
  let bestDistSq = Infinity;
  for (let i = lo; i < hi; i++) {
    const d = samples[i].position.distanceToSquared(worldPos);
    if (d < bestDistSq) {
      bestDistSq = d;
      bestIdx = i;
    }
  }
  return samples[bestIdx].arclength;
}
