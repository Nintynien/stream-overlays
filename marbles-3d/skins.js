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

  // Basic matte colors — backing skins for the friendly `!skin yellow` etc.
  // aliases, where no gem-toned equivalent exists.
  { id: 'yellow',    label: 'Yellow',    color: '#f5d742', roughness: 0.35, metalness: 0.0 },
  { id: 'orange',    label: 'Orange',    color: '#ff8530', roughness: 0.35, metalness: 0.0 },
  { id: 'pink',      label: 'Pink',      color: '#ff7fb0', roughness: 0.35, metalness: 0.0 },
  { id: 'cyan',      label: 'Cyan',      color: '#40c0d8', roughness: 0.35, metalness: 0.0 },

  // Glow / emissive — no texture, visible even in shadowed pen
  { id: 'neon-pink',  label: 'Neon Pink',  color: '#ff3bd1', emissive: '#ff3bd1', emissiveIntensity: 0.9, roughness: 0.4, metalness: 0.0 },
  { id: 'neon-green', label: 'Neon Green', color: '#3bff7a', emissive: '#3bff7a', emissiveIntensity: 0.9, roughness: 0.4, metalness: 0.0 },
  { id: 'neon-cyan',   label: 'Neon Cyan',   color: '#3bf0ff', emissive: '#3bf0ff', emissiveIntensity: 0.9, roughness: 0.4, metalness: 0.0 },
  { id: 'neon-yellow', label: 'Neon Yellow', color: '#f6ff3b', emissive: '#f6ff3b', emissiveIntensity: 0.9, roughness: 0.4, metalness: 0.0 },
  { id: 'neon-orange', label: 'Neon Orange', color: '#ff7a1f', emissive: '#ff7a1f', emissiveIntensity: 0.9, roughness: 0.4, metalness: 0.0 },
  { id: 'neon-purple', label: 'Neon Purple', color: '#b24bff', emissive: '#b24bff', emissiveIntensity: 0.9, roughness: 0.4, metalness: 0.0 },

  // Textured — procedural canvas textures so the overlay ships with visible
  // patterns out of the box. Descriptor supports `texture: <path>` for
  // swapping in hand-authored PNGs later without touching the loader.
  { id: 'soccer',          label: 'Soccer',          color: '#ffffff', procedural: 'soccer',    roughness: 0.55, metalness: 0.0 },
  { id: 'baseball',        label: 'Baseball',        color: '#f6f1e5', procedural: 'baseball',  roughness: 0.7,  metalness: 0.0 },
  { id: '8ball',           label: '8-Ball',          color: '#111111', procedural: '8ball',     roughness: 0.12, metalness: 0.15 },
  { id: 'earth',           label: 'Earth',           color: '#ffffff', procedural: 'earth',     roughness: 0.5,  metalness: 0.0 },
  { id: 'galaxy',          label: 'Galaxy',          color: '#ffffff', procedural: 'galaxy',    roughness: 0.4,  metalness: 0.1 },
  { id: 'wood',            label: 'Wood',            color: '#ffffff', procedural: 'wood',      roughness: 0.75, metalness: 0.0 },
  { id: 'rainbow-stripes', label: 'Rainbow Stripes', color: '#ffffff', procedural: 'rainbow',    roughness: 0.35, metalness: 0.1 },
  { id: 'cow',             label: 'Cow Print',       color: '#ffffff', procedural: 'cow',        roughness: 0.8,  metalness: 0.0 },
  { id: 'basketball',      label: 'Basketball',      color: '#ffffff', procedural: 'basketball', roughness: 0.85, metalness: 0.0 },
  { id: 'tennis',          label: 'Tennis Ball',     color: '#ffffff', procedural: 'tennis',     roughness: 0.9,  metalness: 0.0 },
  { id: 'volleyball',      label: 'Volleyball',      color: '#ffffff', procedural: 'volleyball', roughness: 0.55, metalness: 0.0 },
  { id: 'beachball',       label: 'Beach Ball',      color: '#ffffff', procedural: 'beachball',  roughness: 0.3,  metalness: 0.0 },
  { id: 'zebra',           label: 'Zebra',           color: '#ffffff', procedural: 'zebra',      roughness: 0.7,  metalness: 0.0 },
  { id: 'leopard',         label: 'Leopard',         color: '#ffffff', procedural: 'leopard',    roughness: 0.65, metalness: 0.0 },
  { id: 'moon',            label: 'Moon',            color: '#ffffff', procedural: 'moon',       roughness: 0.9,  metalness: 0.0 },
  { id: 'lava',            label: 'Lava',            color: '#ffffff', procedural: 'lava',       roughness: 0.55, metalness: 0.0 },
  { id: 'swirl',           label: 'Swirl',           color: '#ffffff', procedural: 'swirl',      roughness: 0.18, metalness: 0.15 },
  { id: 'watermelon',      label: 'Watermelon',      color: '#ffffff', procedural: 'watermelon', roughness: 0.55, metalness: 0.0 },
  { id: 'disco',           label: 'Disco Ball',      color: '#ffffff', procedural: 'disco',      roughness: 0.12, metalness: 0.9  },
  { id: 'eye',             label: 'Eyeball',         color: '#ffffff', procedural: 'eye',        roughness: 0.18, metalness: 0.0 }
];

export const SKIN_BY_ID = new Map(SKINS.map(s => [s.id, s]));

// Friendly aliases for viewers who type basic color names. Resolves to the
// closest existing skin; `handleSkinCommand` canonicalizes to `skin.id`
// before persisting so storage never contains alias keys.
const SKIN_ALIASES = {
  red:    'ruby',
  blue:   'sapphire',
  green:  'emerald',
  purple: 'amethyst',
  white:  'pearl',
  black:  'obsidian',
  gray:   'silver',
  grey:   'silver'
};
for (const [alias, id] of Object.entries(SKIN_ALIASES)) {
  const skin = SKIN_BY_ID.get(id);
  if (skin) SKIN_BY_ID.set(alias, skin);
}

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
    case 'wood':       return genWood();
    case 'rainbow':    return genRainbow();
    case 'cow':        return genCow();
    case 'basketball': return genBasketball();
    case 'tennis':     return genTennis();
    case 'volleyball': return genVolleyball();
    case 'beachball':  return genBeachball();
    case 'zebra':      return genZebra();
    case 'leopard':    return genLeopard();
    case 'moon':       return genMoon();
    case 'lava':       return genLava();
    case 'swirl':      return genSwirl();
    case 'watermelon': return genWatermelon();
    case 'disco':      return genDisco();
    case 'eye':        return genEye();
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

function genBasketball() {
  // Orange ball with the classic 8-panel seam layout: one equatorial seam,
  // one pole-to-pole meridian, and two curved side seams that arc around
  // the sides. Lines drawn at texture edges wrap seamlessly around the sphere.
  const c = makeCanvas();
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#d47a2a';
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  ctx.strokeStyle = '#1a0e04';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';

  // Equatorial seam
  ctx.beginPath();
  ctx.moveTo(0, TEX_SIZE / 2);
  ctx.lineTo(TEX_SIZE, TEX_SIZE / 2);
  ctx.stroke();

  // Pole-to-pole meridian (at u=0 so it lines up with the sphere seam)
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, TEX_SIZE);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(TEX_SIZE, 0);
  ctx.lineTo(TEX_SIZE, TEX_SIZE);
  ctx.stroke();

  // Two curved side seams, bowing inward toward the equator
  for (const xc of [TEX_SIZE * 0.33, TEX_SIZE * 0.67]) {
    ctx.beginPath();
    for (let i = 0; i <= 120; i++) {
      const y = (i / 120) * TEX_SIZE;
      const bow = Math.sin((i / 120) * Math.PI) * 55;
      const x = xc + (xc < TEX_SIZE / 2 ? bow : -bow);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  return c;
}

function genTennis() {
  // Fuzzy yellow-green with a single wavy white seam at the equator.
  const c = makeCanvas();
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ccdd33';
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  // Speckled fuzz
  const rand = mulberry32(0x7E441);
  for (let i = 0; i < 2000; i++) {
    const x = rand() * TEX_SIZE;
    const y = rand() * TEX_SIZE;
    const shade = rand() < 0.5 ? 'rgba(180,200,60,0.35)' : 'rgba(230,240,140,0.3)';
    ctx.fillStyle = shade;
    ctx.fillRect(x, y, 1, 1);
  }

  ctx.strokeStyle = '#f7f3e6';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  drawSeam(ctx, 0.5);
  return c;
}

function genVolleyball() {
  // Off-white with thin dark lines dividing it into the classic 18-panel
  // layout (three vertical panels per hemisphere, offset between halves).
  const c = makeCanvas();
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f2ede1';
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  ctx.strokeStyle = '#1c1c1c';
  ctx.lineWidth = 3;

  // Equator
  ctx.beginPath();
  ctx.moveTo(0, TEX_SIZE / 2);
  ctx.lineTo(TEX_SIZE, TEX_SIZE / 2);
  ctx.stroke();

  // Vertical panel dividers (top hemisphere)
  for (let i = 0; i < 3; i++) {
    const x = (i / 3) * TEX_SIZE;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, TEX_SIZE / 2);
    ctx.stroke();
  }
  // Vertical panel dividers (bottom hemisphere, offset by half a panel)
  for (let i = 0; i < 3; i++) {
    const x = (i / 3) * TEX_SIZE + TEX_SIZE / 6;
    ctx.beginPath();
    ctx.moveTo(x, TEX_SIZE / 2);
    ctx.lineTo(x, TEX_SIZE);
    ctx.stroke();
  }
  return c;
}

function genBeachball() {
  // Vertical colored wedges that wrap the equator, with white caps at the
  // poles — reads as a classic inflatable beachball.
  const c = makeCanvas();
  const ctx = c.getContext('2d');
  const colors = ['#e63946', '#ffd43b', '#2a9d8f', '#1d6fbf', '#f78fb3', '#ffffff'];
  const w = TEX_SIZE / colors.length;
  for (let i = 0; i < colors.length; i++) {
    ctx.fillStyle = colors[i];
    ctx.fillRect(i * w, 0, w + 1, TEX_SIZE);
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, TEX_SIZE, 34);
  ctx.fillRect(0, TEX_SIZE - 34, TEX_SIZE, 34);
  return c;
}

function genZebra() {
  // Wavy black stripes on cream. Each stripe is a closed path defined by
  // parallel left/right curves around a jittered center meridian.
  const c = makeCanvas();
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f0ead5';
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  const rand = mulberry32(0x2EB8A);
  ctx.fillStyle = '#141414';

  const stripeCount = 14;
  for (let i = 0; i < stripeCount; i++) {
    const baseX = (i / stripeCount) * TEX_SIZE + (rand() - 0.5) * 14;
    const baseWidth = 10 + rand() * 18;
    const phase = rand() * Math.PI * 2;
    const amp = 5 + rand() * 10;

    const pts = [];
    for (let y = -10; y <= TEX_SIZE + 10; y += 10) {
      const wobble = Math.sin(y * 0.018 + phase) * amp;
      const widthJit = 0.75 + 0.25 * Math.sin(y * 0.03 + phase + 1);
      const halfW = baseWidth * widthJit * 0.5;
      pts.push([baseX + wobble - halfW, baseX + wobble + halfW, y]);
    }

    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][2]);
    for (let j = 1; j < pts.length; j++) ctx.lineTo(pts[j][0], pts[j][2]);
    for (let j = pts.length - 1; j >= 0; j--) ctx.lineTo(pts[j][1], pts[j][2]);
    ctx.closePath();
    ctx.fill();
  }
  return c;
}

function genLeopard() {
  // Tan base with rosette clusters: a ring of dark spots around a lightly
  // shaded center. Rosettes near the horizontal edges are duplicated ±TEX_SIZE
  // so the pattern is seamless around the equator.
  const c = makeCanvas();
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#d4a15a';
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  const rand = mulberry32(0x1E0BA4);
  const rosetteCount = 45;

  for (let i = 0; i < rosetteCount; i++) {
    const cx = rand() * TEX_SIZE;
    const cy = 30 + rand() * (TEX_SIZE - 60);
    const r = 10 + rand() * 14;
    const spotCount = 4 + Math.floor(rand() * 3);
    // Freeze the spot layout so the three wrap copies match exactly.
    const spots = [];
    for (let s = 0; s < spotCount; s++) {
      const a = (s / spotCount) * Math.PI * 2 + rand() * 0.6;
      spots.push({ a, size: 4 + rand() * 4 });
    }

    for (const dx of [-TEX_SIZE, 0, TEX_SIZE]) {
      const bx = cx + dx;
      if (bx < -r * 2 || bx > TEX_SIZE + r * 2) continue;

      ctx.fillStyle = 'rgba(140, 80, 25, 0.45)';
      ctx.beginPath();
      ctx.arc(bx, cy, r * 0.55, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#2a1808';
      for (const s of spots) {
        const sx = bx + Math.cos(s.a) * r;
        const sy = cy + Math.sin(s.a) * r * 0.85;
        ctx.beginPath();
        ctx.arc(sx, sy, s.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  return c;
}

function genMoon() {
  // Gray regolith with darker "mare" patches and scattered craters. Craters
  // have a faint light rim and a dark bowl — enough to read as pocked terrain
  // at marble size.
  const c = makeCanvas();
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#b3afa6';
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  const rand = mulberry32(0x1009D);

  // Darker mare patches
  for (let i = 0; i < 12; i++) {
    const x = rand() * TEX_SIZE;
    const y = rand() * TEX_SIZE;
    const r = 40 + rand() * 70;
    ctx.fillStyle = 'rgba(100, 96, 88, 0.35)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Craters
  for (let i = 0; i < 40; i++) {
    const cx = rand() * TEX_SIZE;
    const cy = 25 + rand() * (TEX_SIZE - 50);
    const r = 4 + rand() * 18;
    ctx.fillStyle = 'rgba(225, 220, 210, 0.5)';
    ctx.beginPath();
    ctx.arc(cx, cy, r + 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(55, 50, 45, 0.85)';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

function genLava() {
  // Dark rock with a network of bright cracks. Each crack is stroked three
  // times — wide dim orange, narrower yellow, then a thin white-hot core —
  // so it reads as glowing even though the material is not actually emissive.
  const c = makeCanvas();
  const ctx = c.getContext('2d');

  const bg = ctx.createRadialGradient(TEX_SIZE / 2, TEX_SIZE / 2, 20, TEX_SIZE / 2, TEX_SIZE / 2, TEX_SIZE * 0.8);
  bg.addColorStop(0, '#3a0f08');
  bg.addColorStop(1, '#0a0402');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  const rand = mulberry32(0x1AB7A);

  const cracks = [];
  for (let i = 0; i < 16; i++) {
    const path = [[rand() * TEX_SIZE, rand() * TEX_SIZE]];
    const steps = 18 + Math.floor(rand() * 12);
    for (let s = 0; s < steps; s++) {
      const [x, y] = path[path.length - 1];
      path.push([x + (rand() - 0.5) * 38, y + (rand() - 0.5) * 38]);
    }
    cracks.push(path);
  }

  const strokePass = (width, style) => {
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    for (const path of cracks) {
      ctx.beginPath();
      ctx.moveTo(path[0][0], path[0][1]);
      for (let j = 1; j < path.length; j++) ctx.lineTo(path[j][0], path[j][1]);
      ctx.stroke();
    }
  };
  strokePass(11, 'rgba(255, 105, 25, 0.55)');
  strokePass(5,  'rgba(255, 195, 60, 0.8)');
  strokePass(1.5, '#fff5c0');
  return c;
}

function genSwirl() {
  // Classic cat's-eye marble: three wavy colored vanes embedded in a
  // translucent white base. Each vane is a closed ribbon that snakes across
  // the texture so it looks like a swirl from any viewing angle.
  const c = makeCanvas();
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#faf6ec';
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  const vanes = [
    { color: '#ff4b8b', yFrac: 0.22, amp: 38, phase: 0 },
    { color: '#3ba2ff', yFrac: 0.5,  amp: 55, phase: 1.3 },
    { color: '#ffcc3b', yFrac: 0.78, amp: 38, phase: 2.4 }
  ];

  for (const v of vanes) {
    const halfTh = 22;
    ctx.fillStyle = v.color;
    ctx.beginPath();
    for (let i = 0; i <= 240; i++) {
      const x = (i / 240) * TEX_SIZE;
      const y = v.yFrac * TEX_SIZE + Math.sin((i / 240) * Math.PI * 3 + v.phase) * v.amp - halfTh;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    for (let i = 240; i >= 0; i--) {
      const x = (i / 240) * TEX_SIZE;
      const y = v.yFrac * TEX_SIZE + Math.sin((i / 240) * Math.PI * 3 + v.phase) * v.amp + halfTh;
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  }
  return c;
}

function genWatermelon() {
  // Red flesh in the middle band, green rind at the poles, dark stripes on
  // the rind, scattered black seeds in the flesh. The sphere UV puts y=0/y=1
  // at the poles so "rind on top and bottom" reads correctly.
  const c = makeCanvas();
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e63c4a';
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  const rindH = 62;
  ctx.fillStyle = '#2d7d30';
  ctx.fillRect(0, 0, TEX_SIZE, rindH);
  ctx.fillRect(0, TEX_SIZE - rindH, TEX_SIZE, rindH);

  // Pale transition band
  ctx.fillStyle = '#f3d8d0';
  ctx.fillRect(0, rindH, TEX_SIZE, 8);
  ctx.fillRect(0, TEX_SIZE - rindH - 8, TEX_SIZE, 8);

  // Rind stripes
  ctx.fillStyle = '#19471c';
  for (let i = 0; i < 22; i++) {
    const x = (i / 22) * TEX_SIZE + Math.sin(i * 0.6) * 6;
    ctx.fillRect(x, 0, 5, rindH);
    ctx.fillRect(x + 3, TEX_SIZE - rindH, 5, rindH);
  }

  // Seeds
  const rand = mulberry32(0x4A7ED);
  ctx.fillStyle = '#1a0a08';
  for (let i = 0; i < 28; i++) {
    const x = rand() * TEX_SIZE;
    const y = rindH + 30 + rand() * (TEX_SIZE - rindH * 2 - 60);
    ctx.beginPath();
    ctx.ellipse(x, y, 4.5, 7.5, rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

function genDisco() {
  // Grid of small square facets with random shades — combined with the high
  // metalness/low roughness of the skin descriptor, reads as a mirror ball.
  const c = makeCanvas();
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#666';
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  const rand = mulberry32(0xD15C0);
  const cell = 24;
  for (let y = 0; y < TEX_SIZE; y += cell) {
    for (let x = 0; x < TEX_SIZE; x += cell) {
      const shade = 0.35 + rand() * 0.65;
      const v = Math.floor(230 * shade);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
    }
  }
  return c;
}

function genEye() {
  // White sclera with red veins, a blue iris with radial striations, black
  // pupil, and a specular highlight. Single centered feature — the back of
  // the eye (opposite side of the sphere) stays plain white, which is fine.
  const c = makeCanvas();
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f9f3e8';
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  // Veins
  const rand = mulberry32(0xEFE01);
  ctx.strokeStyle = 'rgba(190, 35, 35, 0.55)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 30; i++) {
    let x = rand() * TEX_SIZE;
    let y = rand() * TEX_SIZE;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 8; s++) {
      x += (rand() - 0.5) * 22;
      y += (rand() - 0.5) * 22;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  const cx = TEX_SIZE / 2;
  const cy = TEX_SIZE / 2;
  const irisR = 95;

  // Iris
  const irisGrad = ctx.createRadialGradient(cx, cy, 12, cx, cy, irisR);
  irisGrad.addColorStop(0, '#6bb0d6');
  irisGrad.addColorStop(0.7, '#2a6a9b');
  irisGrad.addColorStop(1, '#123c60');
  ctx.fillStyle = irisGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, irisR, 0, Math.PI * 2);
  ctx.fill();

  // Radial striations
  ctx.strokeStyle = 'rgba(20, 40, 70, 0.5)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * 24, cy + Math.sin(a) * 24);
    ctx.lineTo(cx + Math.cos(a) * irisR, cy + Math.sin(a) * irisR);
    ctx.stroke();
  }

  // Pupil
  ctx.fillStyle = '#080606';
  ctx.beginPath();
  ctx.arc(cx, cy, 36, 0, Math.PI * 2);
  ctx.fill();

  // Specular highlight
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.beginPath();
  ctx.arc(cx - 14, cy - 16, 9, 0, Math.PI * 2);
  ctx.fill();
  return c;
}
