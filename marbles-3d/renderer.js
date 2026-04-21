import * as THREE from 'three';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
    this.camera.position.set(6, 4, 8);
    this.camera.lookAt(0, 0, 0);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x303030, 0.9);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 0.6);
    dir.position.set(5, 10, 4);
    this.scene.add(dir);

    this.marbleMeshes = new Map();
    this.trackMesh = null;
    this.finishMesh = null;

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
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
    const indices = [];

    const tmp = new THREE.Vector3();
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      for (let j = 0; j < csCount; j++) {
        const [lat, vert] = crossSectionPoints[j];
        tmp.copy(s.position).addScaledVector(s.right, lat).addScaledVector(s.up, vert);
        const base = (i * csCount + j) * 3;
        verts[base + 0] = tmp.x;
        verts[base + 1] = tmp.y;
        verts[base + 2] = tmp.z;
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
    geom.setIndex(indices);
    geom.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      color: 0x6a6a7a,
      roughness: 0.75,
      metalness: 0.05,
      side: THREE.DoubleSide
    });
    this.trackMesh = new THREE.Mesh(geom, mat);
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
  }

  addMarbleMesh(id, radius, colorCss) {
    const geom = new THREE.SphereGeometry(radius, 24, 16);
    const color = new THREE.Color(colorCss);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.1 });
    const mesh = new THREE.Mesh(geom, mat);
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
    this.renderer.render(this.scene, this.camera);
  }
}
