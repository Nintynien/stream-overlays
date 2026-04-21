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
    const { samples, crossSectionPoints, finishMarker } = track;

    // Extrude the full U-profile cross-section along each sample's local frame.
    // crossSectionPoints = [[lateral, vertical], ...] describing the inside
    // surface including the fillet curves and wall tops.
    const csCount = crossSectionPoints.length;
    const verts = new Float32Array(samples.length * csCount * 3);
    const colors = new Float32Array(samples.length * csCount * 3);
    const indices = [];

    // Alternating bands along arclength so bumps/ramps/turns visibly warp the
    // stripes. Walls get a cooler/lighter tint so the U-profile reads as 3D
    // instead of a flat ribbon.
    const floorA = new THREE.Color(0x6a6a7a);
    const floorB = new THREE.Color(0x3e3e48);
    const wallC = new THREE.Color(0x8a94a6);
    const stripePeriod = 1.5; // meters per stripe
    const filletR = track.filletRadius ?? 0.5;
    const wallThreshold = filletR + 0.01;

    const tmp = new THREE.Vector3();
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const stripe = Math.floor(s.arclength / stripePeriod) & 1;
      const floorC = stripe === 0 ? floorA : floorB;
      for (let j = 0; j < csCount; j++) {
        const [lat, vert] = crossSectionPoints[j];
        tmp.copy(s.position).addScaledVector(s.right, lat).addScaledVector(s.up, vert);
        const base = (i * csCount + j) * 3;
        verts[base + 0] = tmp.x;
        verts[base + 1] = tmp.y;
        verts[base + 2] = tmp.z;
        const c = vert > wallThreshold ? wallC : floorC;
        colors[base + 0] = c.r;
        colors[base + 1] = c.g;
        colors[base + 2] = c.b;
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
    geom.setIndex(indices);
    geom.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.75,
      metalness: 0.05,
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

  syncMarble(id, body) {
    const mesh = this.marbleMeshes.get(id);
    if (!mesh) return;
    const t = body.translation();
    const r = body.rotation();
    mesh.position.set(t.x, t.y, t.z);
    mesh.quaternion.set(r.x, r.y, r.z, r.w);
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
