import * as THREE from 'three';

// ========== Skin catalog ==========
// Each skin is a full material descriptor: color tint, optional texture
// (either a file path or a procedural generator), PBR finish, and optional
// emissive glow. Geometry stays a plain sphere — collider identity is
// preserved across skin changes.
export const SKINS = [
  // Solid PBR — no texture, varying color + finish
  { id: 'ruby',      label: 'Ruby',      color: '#c41e3a', roughness: 0.15, metalness: 0.2 },
  { id: 'sapphire',  label: 'Sapphire',  color: '#1a4fc4', roughness: 0.15, metalness: 0.2 },
  { id: 'emerald',   label: 'Emerald',   color: '#2ea55b', roughness: 0.15, metalness: 0.2 },
  { id: 'amethyst',  label: 'Amethyst',  color: '#8a5cd6', roughness: 0.2,  metalness: 0.2 },
  { id: 'jade',      label: 'Jade',      color: '#5fbf8a', roughness: 0.35, metalness: 0.0 },
  { id: 'pearl',     label: 'Pearl',     color: '#f2ead3', roughness: 0.25, metalness: 0.1 },
  { id: 'obsidian',  label: 'Obsidian',  color: '#141418', roughness: 0.08, metalness: 0.35 },
  { id: 'gold',      label: 'Gold',      color: '#e5b53b', roughness: 0.2,  metalness: 0.95 },
  { id: 'silver',    label: 'Silver',    color: '#cfd3d6', roughness: 0.15, metalness: 0.95 },
  { id: 'copper',    label: 'Copper',    color: '#c87533', roughness: 0.25, metalness: 0.9 },

  // Glow / emissive — no texture, visible even in shadowed pen
  { id: 'neon-pink',  label: 'Neon Pink',  color: '#ff3bd1', emissive: '#ff3bd1', emissiveIntensity: 0.9, roughness: 0.4, metalness: 0.0 },
  { id: 'neon-green', label: 'Neon Green', color: '#3bff7a', emissive: '#3bff7a', emissiveIntensity: 0.9, roughness: 0.4, metalness: 0.0 },
  { id: 'neon-cyan',  label: 'Neon Cyan',  color: '#3bf0ff', emissive: '#3bf0ff', emissiveIntensity: 0.9, roughness: 0.4, metalness: 0.0 },

  // Textured — procedural canvas textures so the overlay ships with visible
  // patterns out of the box. Descriptor supports `texture: <path>` for
  // swapping in hand-authored PNGs later without touching the loader.
  { id: 'soccer',          label: 'Soccer',          color: '#ffffff', procedural: 'soccer',    roughness: 0.55, metalness: 0.0 },
  { id: 'baseball',        label: 'Baseball',        color: '#f6f1e5', procedural: 'baseball',  roughness: 0.7,  metalness: 0.0 },
  { id: '8ball',           label: '8-Ball',          color: '#111111', procedural: '8ball',     roughness: 0.12, metalness: 0.15 },
  { id: 'earth',           label: 'Earth',           color: '#ffffff', procedural: 'earth',     roughness: 0.5,  metalness: 0.0 },
  { id: 'galaxy',          label: 'Galaxy',          color: '#ffffff', procedural: 'galaxy',    roughness: 0.4,  metalness: 0.1 },
  { id: 'wood',            label: 'Wood',            color: '#ffffff', procedural: 'wood',      roughness: 0.75, metalness: 0.0 },
  { id: 'rainbow-stripes', label: 'Rainbow Stripes', color: '#ffffff', procedural: 'rainbow',   roughness: 0.35, metalness: 0.1 },
  { id: 'cow',             label: 'Cow Print',       color: '#ffffff', procedural: 'cow',       roughness: 0.8,  metalness: 0.0 }
];

export const SKIN_BY_ID = new Map(SKINS.map(s => [s.id, s]));

// ========== Per-viewer persistence ==========
const STORAGE_KEY = 'marbles-3d:viewer-skins';

function readStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return (obj && typeof obj === 'object') ? obj : {};
  } catch {
    return {};
  }
}

function writeStore(obj) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {
    // Storage full / private mode / disabled — silently no-op. Viewers
    // keep their in-session skin via the marble record until the race ends.
  }
}

export function resolveSkin(username) {
  if (!username) return null;
  const store = readStore();
  const skinId = store[username.toLowerCase()];
  if (!skinId) return null;
  return SKIN_BY_ID.get(skinId) || null;
}

export function setViewerSkin(username, skinId) {
  if (!username) return false;
  if (!SKIN_BY_ID.has(skinId)) return false;
  const store = readStore();
  store[username.toLowerCase()] = skinId;
  writeStore(store);
  return true;
}

// Defending-champion persistence. Stored as a single lowercase username
// string under its own key rather than a sentinel inside the skin map so
// resolveSkin stays a plain dictionary lookup.
const LAST_WINNER_KEY = 'marbles-3d:last-winner';

export function getLastWinner() {
  try {
    const raw = localStorage.getItem(LAST_WINNER_KEY);
    return (typeof raw === 'string' && raw) ? raw : null;
  } catch {
    return null;
  }
}

export function setLastWinner(username) {
  if (!username) return;
  try {
    localStorage.setItem(LAST_WINNER_KEY, username.toLowerCase());
  } catch {
    // Same quota/private-mode policy as writeStore.
  }
}

// ========== Texture loading / cache ==========
const textureCache = new Map();
const fileLoader = new THREE.TextureLoader();

export function loadSkinTexture(skin) {
  if (!skin) return Promise.resolve(null);
  const key = skin.texture || (skin.procedural ? `proc:${skin.procedural}` : null);
  if (!key) return Promise.resolve(null);

  const cached = textureCache.get(key);
  if (cached) return cached;

  let promise;
  if (skin.procedural) {
    const canvas = generateProceduralCanvas(skin.procedural);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    promise = Promise.resolve(tex);
  } else {
    promise = new Promise((resolve) => {
      fileLoader.load(
        skin.texture,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = 8;
          resolve(tex);
        },
        undefined,
        () => {
          console.warn(`[marbles-3d] skin texture failed to load: ${skin.texture}`);
          resolve(null);
        }
      );
    });
  }

  textureCache.set(key, promise);
  return promise;
}

// ========== Procedural texture generators ==========
// All generate 512x512 canvases. Patterns are tuned for a sphere UV wrap
// (SphereGeometry maps u: 0..1 around equator, v: 0..1 pole to pole).

const TEX_SIZE = 512;

function makeCanvas() {
  const c = document.createElement('canvas');
  c.width = TEX_SIZE;
  c.height = TEX_SIZE;
  return c;
}

function generateProceduralCanvas(kind) {
  switch (kind) {
    case 'soccer':   return genSoccer();
    case 'baseball': return genBaseball();
    case '8ball':    return gen8Ball();
    case 'earth':    return genEarth();
    case 'galaxy':   return genGalaxy();
    case 'wood':     return genWood();
    case 'rainbow':  return genRainbow();
    case 'cow':      return genCow();
    default: {
      const c = makeCanvas();
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#888';
      ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
      return c;
    }
  }
}

// Seeded RNG so procedural skins are visually stable across reloads.
function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function genSoccer() {
  // Classic truncated-icosahedron look: white ball with black pentagons on a
  // hex grid. Approximated in 2D — exact icosahedron UV projection is
  // overkill for a marble.
  const c = makeCanvas();
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  const cellW = 96;
  const cellH = 84;
  ctx.fillStyle = '#111111';
  for (let row = -1; row * cellH < TEX_SIZE + cellH; row++) {
    for (let col = -1; col * cellW < TEX_SIZE + cellW; col++) {
      const cx = col * cellW + (row & 1 ? cellW / 2 : 0);
      const cy = row * cellH;
      drawPentagon(ctx, cx, cy, 22);
    }
  }
  return c;
}

function drawPentagon(ctx, cx, cy, r) {
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

function genBaseball() {
  const c = makeCanvas();
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f6f1e5';
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  // Two curved red seam arcs, one mirrored. Keep them clear of the poles
  // (v near 0 or 1) where UV distortion gets ugly on a sphere.
  ctx.strokeStyle = '#b52a2a';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';

  drawSeam(ctx, 0.2);
  drawSeam(ctx, 0.8);

  // Small perpendicular stitch marks along each seam.
  ctx.lineWidth = 3;
  for (const yFrac of [0.2, 0.8]) {
    for (let i = 0; i < 40; i++) {
      const x = (i / 40) * TEX_SIZE;
      const baseY = yFrac * TEX_SIZE + Math.sin((i / 40) * Math.PI * 2) * 18;
      ctx.beginPath();
      ctx.moveTo(x, baseY - 6);
      ctx.lineTo(x + 6, baseY + 6);
      ctx.stroke();
    }
  }
  return c;
}

function drawSeam(ctx, yFrac) {
  ctx.beginPath();
  for (let i = 0; i <= 120; i++) {
    const x = (i / 120) * TEX_SIZE;
    const y = yFrac * TEX_SIZE + Math.sin((i / 120) * Math.PI * 2) * 18;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function gen8Ball() {
  const c = makeCanvas();
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0b0b0b';
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  // Single white disc with a black "8" centered on it — positioned near
  // the equator so it's visible from most camera angles.
  const cx = TEX_SIZE / 2;
  const cy = TEX_SIZE / 2;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx, cy, 100, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#0b0b0b';
  ctx.font = 'bold 140px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('8', cx, cy + 6);
  return c;
}

function genEarth() {
  const c = makeCanvas();
  const ctx = c.getContext('2d');
  // Ocean base.
  ctx.fillStyle = '#1a4fa6';
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  // Continent blobs — noise-driven islands. Not geographically real; just
  // reads as "planet with landmasses" at marble size.
  const rand = mulberry32(0xEA47 | 0);
  ctx.fillStyle = '#2e8c3a';
  for (let i = 0; i < 18; i++) {
    const cx = rand() * TEX_SIZE;
    const cy = 80 + rand() * (TEX_SIZE - 160);
    const blobs = 4 + Math.floor(rand() * 5);
    for (let b = 0; b < blobs; b++) {
      const ox = cx + (rand() - 0.5) * 80;
      const oy = cy + (rand() - 0.5) * 60;
      const r = 18 + rand() * 28;
      ctx.beginPath();
      ctx.arc(ox, oy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Polar caps.
  ctx.fillStyle = '#eaf3ff';
  ctx.fillRect(0, 0, TEX_SIZE, 42);
  ctx.fillRect(0, TEX_SIZE - 42, TEX_SIZE, 42);

  // Thin cloud wisps for depth.
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  for (let i = 0; i < 30; i++) {
    const x = rand() * TEX_SIZE;
    const y = 60 + rand() * (TEX_SIZE - 120);
    ctx.beginPath();
    ctx.ellipse(x, y, 40 + rand() * 40, 8 + rand() * 6, rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

function genGalaxy() {
  const c = makeCanvas();
  const ctx = c.getContext('2d');
  // Deep-space gradient.
  const g = ctx.createRadialGradient(TEX_SIZE / 2, TEX_SIZE / 2, 20, TEX_SIZE / 2, TEX_SIZE / 2, TEX_SIZE * 0.7);
  g.addColorStop(0, '#2a1a5c');
  g.addColorStop(0.6, '#110a2a');
  g.addColorStop(1, '#050211');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  // Star field — varied sizes and brightness.
  const rand = mulberry32(0xC051 | 0);
  for (let i = 0; i < 600; i++) {
    const x = rand() * TEX_SIZE;
    const y = rand() * TEX_SIZE;
    const r = rand() < 0.95 ? 0.6 + rand() * 0.8 : 1.5 + rand() * 1.5;
    const bright = 0.5 + rand() * 0.5;
    ctx.fillStyle = `rgba(255,255,255,${bright})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Purple / magenta nebula smears.
  for (let i = 0; i < 6; i++) {
    const x = rand() * TEX_SIZE;
    const y = rand() * TEX_SIZE;
    const grad = ctx.createRadialGradient(x, y, 5, x, y, 120);
    grad.addColorStop(0, `rgba(${180 + rand() * 60 | 0},${80 + rand() * 60 | 0},${200 + rand() * 55 | 0},0.35)`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, 120, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

function genWood() {
  const c = makeCanvas();
  const ctx = c.getContext('2d');
  // Base wood tone.
  ctx.fillStyle = '#8b5a2b';
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  // Vertical grain lines with per-line jitter — reads as wood at small sizes.
  const rand = mulberry32(0x1700D);
  for (let x = 0; x < TEX_SIZE; x += 2) {
    const noise = Math.sin(x * 0.04) * 8 + Math.sin(x * 0.11) * 4;
    const shade = 0.75 + 0.25 * Math.sin(x * 0.02 + noise * 0.1);
    ctx.fillStyle = `rgba(60,35,15,${0.15 + (1 - shade) * 0.35})`;
    ctx.fillRect(x, 0, 1, TEX_SIZE);
  }
  // Darker knot streaks.
  ctx.strokeStyle = 'rgba(40,22,10,0.5)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 8; i++) {
    const x0 = rand() * TEX_SIZE;
    ctx.beginPath();
    ctx.moveTo(x0, 0);
    for (let y = 0; y <= TEX_SIZE; y += 20) {
      const wobble = Math.sin(y * 0.02 + i) * 10;
      ctx.lineTo(x0 + wobble, y);
    }
    ctx.stroke();
  }
  return c;
}

function genCow() {
  // Holstein-style: irregular black blobs on a white ground. Blobs are
  // built from overlapping circles so edges are organic, not polygonal.
  // Any blob that straddles the left/right texture edge is also drawn
  // shifted by ±TEX_SIZE so the pattern is seamless around the sphere
  // equator (SphereGeometry wraps u: 0..1 → 0..2π).
  const c = makeCanvas();
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f5f1ea';
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  const rand = mulberry32(0xC0FFEE);
  ctx.fillStyle = '#1a1a1a';

  const blobCount = 10;
  for (let i = 0; i < blobCount; i++) {
    const cx = rand() * TEX_SIZE;
    const cy = 40 + rand() * (TEX_SIZE - 80);
    const clumps = 6 + Math.floor(rand() * 6);
    const spread = 40 + rand() * 35;

    for (const dx of [-TEX_SIZE, 0, TEX_SIZE]) {
      const bx = cx + dx;
      // Skip obviously-offscreen copies to save fill ops.
      if (bx < -spread * 2 || bx > TEX_SIZE + spread * 2) continue;
      for (let k = 0; k < clumps; k++) {
        const a = rand() * Math.PI * 2;
        const d = rand() * spread;
        const r = 18 + rand() * 30;
        ctx.beginPath();
        ctx.arc(bx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.75, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  return c;
}

function genRainbow() {
  const c = makeCanvas();
  const ctx = c.getContext('2d');
  const colors = ['#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#3498db', '#9b59b6'];
  const bandH = TEX_SIZE / colors.length;
  for (let i = 0; i < colors.length; i++) {
    ctx.fillStyle = colors[i];
    ctx.fillRect(0, i * bandH, TEX_SIZE, bandH + 1);
  }
  return c;
}
