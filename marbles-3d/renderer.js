import * as THREE from 'three';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
    this.camera.position.set(6, 4, 8);
    this.camera.lookAt(0, 0, 0);

    // Low ambient + strong directional so surface normals (and therefore
    // small bumps) actually shade differently instead of being washed out.
    const hemi = new THREE.HemisphereLight(0xffffff, 0x202028, 0.4);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 1.1);
    // Keep the offset as a direction vector; render() repositions the light
    // to follow the camera focus so shadows stay crisp over the long track.
    this._sunOffset = new THREE.Vector3(6, 10, 3);
    dir.position.copy(this._sunOffset);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    const sh = dir.shadow.camera;
    sh.left = -16; sh.right = 16; sh.top = 16; sh.bottom = -16;
    sh.near = 0.5; sh.far = 50;
    dir.shadow.bias = -0.0005;
    dir.shadow.normalBias = 0.02;
    this.scene.add(dir);
    this.scene.add(dir.target);
    this.sunLight = dir;

    this.marbleMeshes = new Map();
    this.trackMesh = null;
    this.finishMesh = null;
    this.catchBoxMeshes = [];
    this.startPenMeshes = [];
    this.obstacleMeshes = [];

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    // Cap pixel ratio so high-DPI monitors (laptops often 2.0, 4K sometimes
    // more) don't quadruple our pixel-shading cost for marginal sharpness gain.
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _getTrackTexture() {
    if (this._trackTexture) return this._trackTexture;
    const size = 512;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');

    // Base concrete gray with per-pixel speckle. Per-pixel random noise tiles
    // seamlessly — there's no low-frequency structure to reveal tile seams.
    const img = g.createImageData(size, size);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = 118 + (Math.random() - 0.5) * 36;
      d[i] = n;
      d[i + 1] = n;
      d[i + 2] = n + 4; // faint cool tint
      d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);

    // Darker aggregate specks. Draw each in a 3×3 wrap pattern so specks
    // straddling an edge continue seamlessly into the neighboring tile.
    g.fillStyle = 'rgba(30,30,40,0.55)';
    for (let i = 0; i < 500; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const r = 0.6 + Math.random() * 1.8;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          g.beginPath();
          g.arc(x + dx * size, y + dy * size, r, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
    // A few brighter flecks so the surface isn't pure noise.
    g.fillStyle = 'rgba(210,210,220,0.35)';
    for (let i = 0; i < 120; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const r = 0.4 + Math.random() * 1.2;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          g.beginPath();
          g.arc(x + dx * size, y + dy * size, r, 0, Math.PI * 2);
          g.fill();
        }
      }
    }

    // Cross-wise expansion joints perpendicular to travel. Drawn at interior
    // y positions so they don't clip at tile edges. TEX_REPEAT is 1m, so
    // joints at 0.25 and 0.75 land every 0.5m in world space.
    g.strokeStyle = 'rgba(18,18,26,0.9)';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(0, size * 0.25); g.lineTo(size, size * 0.25);
    g.moveTo(0, size * 0.75); g.lineTo(size, size * 0.75);
    g.stroke();
    // Soft highlight just above each joint — mimics a bevel, helps the joint
    // read as a groove rather than a painted line.
    g.strokeStyle = 'rgba(200,200,215,0.18)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, size * 0.25 - 4); g.lineTo(size, size * 0.25 - 4);
    g.moveTo(0, size * 0.75 - 4); g.lineTo(size, size * 0.75 - 4);
    g.stroke();

    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this._trackTexture = tex;
    return tex;
  }

  addGroundMesh(halfSize = 50, color = 0x3a3a44) {
    const geom = new THREE.PlaneGeometry(halfSize * 2, halfSize * 2);
    geom.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0.05 });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.y = 0;
    mesh.receiveShadow = true;
    this.scene.add(mesh);

    const grid = new THREE.GridHelper(halfSize * 2, 20, 0x555566, 0x33333a);
    grid.position.y = 0.01;
    this.scene.add(grid);
    return mesh;
  }

  buildTrackMesh(track) {
    this.clearTrackMesh();
    const { samples, perSampleCrossSection, crossSectionPoints, finishMarker } = track;

    // Extrude the full U-profile cross-section along each sample's local frame.
    // Each sample carries its own cross-section (point count is constant so
    // adjacent rings still connect as quads through widen/narrow tapers — only
    // the flat floor span scales; fillets and wall tops keep fixed shape).
    const perSampleCs = perSampleCrossSection ?? samples.map(() => crossSectionPoints);
    const csCount = perSampleCs[0].length;
    const verts = new Float32Array(samples.length * csCount * 3);
    const colors = new Float32Array(samples.length * csCount * 3);
    const uvs = new Float32Array(samples.length * csCount * 2);
    const indices = [];

    // Texture repeat period along the track (meters). Joints drawn at 0.25 and
    // 0.75 of the texture give cross-joints every 0.5m of arclength — fine
    // enough for 1m-wide bumps to visibly warp them.
    const TEX_REPEAT = 1.0;
    const filletR = track.filletRadius ?? 0.5;
    const wallThreshold = filletR + 0.01;
    // Walls multiply the texture by a cool shadow tint; the floor leaves the
    // texture untouched so aggregate/joints read at full contrast.
    const floorTint = new THREE.Color(0xffffff);
    const wallTint = new THREE.Color(0xaab4c4);

    const tmp = new THREE.Vector3();
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const cs = perSampleCs[i];
      const vCoord = s.arclength / TEX_REPEAT;
      // Per-sample developed arclength across the cross-section so the texture
      // stretches evenly along a tapering width.
      let uAccum = 0;
      let prevLat = cs[0][0], prevVert = cs[0][1];
      for (let j = 0; j < csCount; j++) {
        const [lat, vert] = cs[j];
        if (j > 0) uAccum += Math.hypot(lat - prevLat, vert - prevVert);
        prevLat = lat; prevVert = vert;
        tmp.copy(s.position).addScaledVector(s.right, lat).addScaledVector(s.up, vert);
        const base3 = (i * csCount + j) * 3;
        verts[base3 + 0] = tmp.x;
        verts[base3 + 1] = tmp.y;
        verts[base3 + 2] = tmp.z;
        const c = vert > wallThreshold ? wallTint : floorTint;
        colors[base3 + 0] = c.r;
        colors[base3 + 1] = c.g;
        colors[base3 + 2] = c.b;
        const base2 = (i * csCount + j) * 2;
        uvs[base2 + 0] = uAccum / TEX_REPEAT;
        uvs[base2 + 1] = vCoord;
      }
    }

    // Connect adjacent samples' cross-sections into quads. Winding matches
    // the physics trimesh so normals point into the track interior.
    for (let i = 0; i < samples.length - 1; i++) {
      for (let j = 0; j < csCount - 1; j++) {
        const A_j = i * csCount + j;
        const A_j1 = i * csCount + j + 1;
        const B_j = (i + 1) * csCount + j;
        const B_j1 = (i + 1) * csCount + j + 1;
        indices.push(A_j, A_j1, B_j1, A_j, B_j1, B_j);
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geom.setIndex(indices);
    geom.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      map: this._getTrackTexture(),
      vertexColors: true,
      roughness: 0.78,
      metalness: 0.04,
      side: THREE.DoubleSide
    });
    this.trackMesh = new THREE.Mesh(geom, mat);
    this.trackMesh.castShadow = true;
    this.trackMesh.receiveShadow = true;
    this.scene.add(this.trackMesh);

    if (finishMarker) {
      const fGeom = new THREE.PlaneGeometry(finishMarker.width, finishMarker.height);
      const fMat = new THREE.MeshBasicMaterial({
        color: 0x4ade80,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide
      });
      const fMesh = new THREE.Mesh(fGeom, fMat);
      fMesh.position.copy(finishMarker.position);
      fMesh.quaternion.copy(finishMarker.rotation);
      this.scene.add(fMesh);
      this.finishMesh = fMesh;
    }

    if (track.catchBox) {
      const boxMat = new THREE.MeshStandardMaterial({
        color: 0x5a5a64,
        roughness: 0.8,
        metalness: 0.05
      });
      for (const c of track.catchBox.cuboids) {
        const geom = new THREE.BoxGeometry(
          c.halfExtents.x * 2,
          c.halfExtents.y * 2,
          c.halfExtents.z * 2
        );
        const mesh = new THREE.Mesh(geom, boxMat);
        mesh.position.set(c.position.x, c.position.y, c.position.z);
        mesh.quaternion.set(c.rotation.x, c.rotation.y, c.rotation.z, c.rotation.w);
        mesh.receiveShadow = true;
        this.scene.add(mesh);
        this.catchBoxMeshes.push(mesh);
      }
    }

    if (track.startPen) {
      const penMat = new THREE.MeshStandardMaterial({
        color: 0x4a5260,
        roughness: 0.75,
        metalness: 0.05
      });
      for (const c of track.startPen.cuboids) {
        const geom = new THREE.BoxGeometry(
          c.halfExtents.x * 2,
          c.halfExtents.y * 2,
          c.halfExtents.z * 2
        );
        const mesh = new THREE.Mesh(geom, penMat);
        mesh.position.set(c.position.x, c.position.y, c.position.z);
        mesh.quaternion.set(c.rotation.x, c.rotation.y, c.rotation.z, c.rotation.w);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.scene.add(mesh);
        this.startPenMeshes.push(mesh);
      }
    }

    if (track.obstaclePlacements && track.obstaclePlacements.length > 0) {
      const obsMat = new THREE.MeshStandardMaterial({
        color: 0xfacc15,
        roughness: 0.45,
        metalness: 0.15
      });
      for (const o of track.obstaclePlacements) {
        const geom = new THREE.CylinderGeometry(o.radius, o.radius, o.halfHeight * 2, 16);
        const mesh = new THREE.Mesh(geom, obsMat);
        mesh.position.set(o.position.x, o.position.y, o.position.z);
        mesh.quaternion.set(o.rotation.x, o.rotation.y, o.rotation.z, o.rotation.w);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.scene.add(mesh);
        this.obstacleMeshes.push(mesh);
      }
    }
  }

  clearTrackMesh() {
    if (this.trackMesh) {
      this.scene.remove(this.trackMesh);
      this.trackMesh.geometry.dispose();
      this.trackMesh.material.dispose();
      this.trackMesh = null;
    }
    if (this.finishMesh) {
      this.scene.remove(this.finishMesh);
      this.finishMesh.geometry.dispose();
      this.finishMesh.material.dispose();
      this.finishMesh = null;
    }
    if (this.catchBoxMeshes.length > 0) {
      const material = this.catchBoxMeshes[0].material; // shared across cuboids
      for (const mesh of this.catchBoxMeshes) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
      }
      material.dispose();
      this.catchBoxMeshes = [];
    }
    if (this.startPenMeshes.length > 0) {
      const material = this.startPenMeshes[0].material;
      for (const mesh of this.startPenMeshes) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
      }
      material.dispose();
      this.startPenMeshes = [];
    }
    if (this.obstacleMeshes.length > 0) {
      const material = this.obstacleMeshes[0].material;
      for (const mesh of this.obstacleMeshes) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
      }
      material.dispose();
      this.obstacleMeshes = [];
    }
  }

  addMarbleMesh(id, radius, colorCss) {
    const geom = new THREE.SphereGeometry(radius, 24, 16);
    const color = new THREE.Color(colorCss);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.1 });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.marbleMeshes.set(id, mesh);
    return mesh;
  }

  removeMarbleMesh(id) {
    const mesh = this.marbleMeshes.get(id);
    if (!mesh) return;
    this.scene.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
    this.marbleMeshes.delete(id);
  }

  clearMarbleMeshes() {
    for (const id of Array.from(this.marbleMeshes.keys())) {
      this.removeMarbleMesh(id);
    }
  }

  syncMarble(id, pos, quat) {
    const mesh = this.marbleMeshes.get(id);
    if (!mesh) return;
    mesh.position.set(pos.x, pos.y, pos.z);
    mesh.quaternion.set(quat.x, quat.y, quat.z, quat.w);
  }

  render() {
    // Track is long (100m+); a fixed shadow camera either covers everything
    // at low resolution or misses most of it. Keep the shadow frustum parked
    // ~10m ahead of the camera so shadows stay crisp in the viewable area.
    if (this.sunLight) {
      const fwd = this.camera.getWorldDirection(new THREE.Vector3());
      const focus = this.camera.position.clone().addScaledVector(fwd, 10);
      this.sunLight.position.copy(focus).add(this._sunOffset);
      this.sunLight.target.position.copy(focus);
      this.sunLight.target.updateMatrixWorld();
    }
    this.renderer.render(this.scene, this.camera);
  }
}
