// Pixel Brawler — class stats, palettes, sprite grids, hats.
//
// Sprite grids are arrays of fixed-width strings. Each character maps to a
// palette key (resolved per-class via PALETTE_ROLES + the class palette).
// `.` = empty (no shadow). Grids are 12 cols wide × 16 rows tall.
//
// buildSpriteShadow(grid, palette, cellSize) returns a CSS box-shadow string
// that paints the grid as pixel art on a single 0-sized element. The element
// has its own width/height of `cellSize` so each shadow draws one square.

export const SPRITE_W = 12;
export const SPRITE_H = 16;
export const CELL_SIZE = 5; // px per "pixel" — 60×80 on screen at 1x scale

// ─── Palette role keys used inside sprite grids ─────────────────────────────
// P = primary (CSS variable, swappable via !color)
// D = primary-darker (auto-derived if not provided per class — same as P)
// A = accent 1 (per-class; e.g., gold trim, leather, gold sash, dagger blade)
// B = accent 2 (per-class; e.g., red cape, bowstring, cyan orb, blood-red dagger)
// M = metal/steel
// S = skin
// H = hair
// K = outline / black
// V = void — eye slit / mouth gap
// W = white / highlight
// Hat-only roles: T = hat primary, U = hat accent

// ─── Class definitions ─────────────────────────────────────────────────────
export const CLASSES = {
  knight: {
    id: 'knight',
    label: 'Knight',
    hp: 130,
    atk: { min: 10, max: 18 },
    acc: 0.75,
    eva: 0.05,
    crit: 0.05,
    special: {
      name: 'Holy Strike',
      dmg: { min: 25, max: 35 },
      accBonus: 0.20,
      bypassEvasion: false,
      autoCrit: false,
      hits: 1,
    },
    palette: {
      A: '#ffd86b', // gold trim
      B: '#a02028', // red cape
      M: '#7d8090', // sword steel / helm
      S: '#e8c8a8',
      K: '#1a1a22',
      V: '#0a0a14',
      D: '#5a5a6a',
    },
    defaultPrimary: '#c0c0d0', // silver — used when no !color set
  },
  ranger: {
    id: 'ranger',
    label: 'Ranger',
    hp: 100,
    atk: { min: 8, max: 14 },
    acc: 0.90,
    eva: 0.15,
    crit: 0.10,
    special: {
      name: 'Rain of Arrows',
      dmg: { min: 6, max: 10 },
      accBonus: 0,
      bypassEvasion: false,
      autoCrit: false,
      hits: 3,
    },
    palette: {
      A: '#7a4a2a', // brown leather
      B: '#e8d8a8', // bowstring / arrow shaft
      M: '#5a3a20', // bow wood
      S: '#e8c8a8',
      K: '#1a1a22',
      V: '#0a0a14',
      D: '#2a5530',
    },
    defaultPrimary: '#3a7d44',
  },
  mage: {
    id: 'mage',
    label: 'Mage',
    hp: 80,
    atk: { min: 6, max: 22 },
    acc: 0.70,
    eva: 0.10,
    crit: 0.15,
    special: {
      name: 'Arcane Blast',
      dmg: { min: 30, max: 50 },
      accBonus: 0,
      bypassEvasion: true,
      autoCrit: false,
      hits: 1,
    },
    palette: {
      A: '#ffd86b', // gold sash / star
      B: '#5cc8ff', // cyan orb
      M: '#8a6a3a', // staff wood
      S: '#e8c8a8',
      K: '#1a1a22',
      V: '#0a0a14',
      D: '#3a2058',
    },
    defaultPrimary: '#5a3a8c',
  },
  rogue: {
    id: 'rogue',
    label: 'Rogue',
    hp: 75,
    atk: { min: 9, max: 15 },
    acc: 0.85,
    eva: 0.30,
    crit: 0.25,
    special: {
      name: 'Backstab',
      dmg: { min: 18, max: 28 },
      accBonus: 0,
      bypassEvasion: false,
      autoCrit: true,
      hits: 1,
    },
    palette: {
      A: '#a02028', // blood-red dagger edge
      B: '#c0c0d0', // dagger steel
      M: '#3a3a48',
      S: '#e8c8a8',
      K: '#1a1a22',
      V: '#0a0a14',
      D: '#0a0a12',
    },
    defaultPrimary: '#2a2a35',
  },
  villager: {
    // No stats — used for idle-crowd chatters who haven't set a class.
    id: 'villager',
    label: 'Villager',
    palette: {
      A: '#5a3a20', // belt / shoes
      B: '#c8a878', // hat strap (none used in villager sprite)
      M: '#7a5a3a',
      S: '#e8c8a8',
      K: '#1a1a22',
      V: '#0a0a14',
      D: '#5a3a25',
    },
    defaultPrimary: '#8b6f47',
    villagerColors: ['#8b6f47', '#9b8559', '#7a5a3a', '#a08060', '#6f5535'],
  },
};

export const CLASS_ALIASES = {
  knight: 'knight', paladin: 'knight', pally: 'knight', k: 'knight',
  ranger: 'ranger', huntress: 'ranger', hunter: 'ranger',
  mage: 'mage', enchantress: 'mage', wizard: 'mage', m: 'mage',
  rogue: 'rogue', assassin: 'rogue', thief: 'rogue',
};

export function resolveClassId(name) {
  if (!name) return null;
  return CLASS_ALIASES[name.toLowerCase()] || null;
}

// ─── Color palette for !color command ──────────────────────────────────────
export const COLORS = {
  red:    '#c4382e',
  blue:   '#3a6cc4',
  green:  '#3a8c4d',
  purple: '#7a3ac4',
  gold:   '#e5b53b',
  silver: '#c0c0d0',
  black:  '#1a1a22',
  white:  '#e8e8f0',
  pink:   '#e87aa8',
  cyan:   '#3acac4',
};

export function resolveColorId(name) {
  if (!name) return null;
  const lower = name.toLowerCase();
  return COLORS[lower] ? lower : null;
}

// ─── Sprite grids ──────────────────────────────────────────────────────────
// 12 cols × 16 rows. Read top-to-bottom, left-to-right.
// Each character is a palette role key; '.' is transparent.
//
// Three frames per class: walk1 (legs neutral), walk2 (legs stepped), sit
// (compressed/seated pose with class-specific flair).

const KNIGHT = {
  walk1: [
    '....KKKK....',
    '...KAAAAK...',
    '..KMMMMMMK..',
    '..KMVV.VVK..',
    '..KMMMMMMK..',
    '..KKMMMMKK..',
    '...AAPPAA...',
    '..APPPPPPA..',
    '.BPPPPPPMM..',
    '.BPPPPPPMM..',
    '.BPPPPPPMM..',
    '.BBPPPPPMM..',
    '..PPP.PPP...',
    '..PPP.PPP...',
    '..DDD.DDD...',
    '..DD...DD...',
  ],
  walk2: [
    '....KKKK....',
    '...KAAAAK...',
    '..KMMMMMMK..',
    '..KMVV.VVK..',
    '..KMMMMMMK..',
    '..KKMMMMKK..',
    '...AAPPAA...',
    '..APPPPPPA..',
    '.BPPPPPPMM..',
    '.BPPPPPPMM..',
    '.BPPPPPPMM..',
    '.BBPPPPPMM..',
    '..PP..PPP...',
    '...PP.PPP...',
    '...DD.DDD...',
    '...DD..DD...',
  ],
  sit: [
    '............',
    '....KKKK....',
    '...KAAAAK...',
    '..KMMMMMMK..',
    '..KMVV.VVK..',
    '..KMMMMMMK..',
    '..KKMMMMKK..',
    '...AAPPAA...',
    '..APPPPPPA..',
    '.BPPPPPPMM..',
    '.BPPPPPP.M..',
    '.BPPPPPP.M..',
    '..PPDPDPP...',
    '..DDDDDDD...',
    '............',
    '............',
  ],
};

const RANGER = {
  walk1: [
    '....AAAA....',
    '...AAAAAA...',
    '..AAASSSAA..', // hood with skin face
    '..AASSSSAA..',
    '..ASVS.VSA..',
    '..ASSSSSSA..',
    '...SSSSSS...',
    '..PPPPPPPP..',
    '..PMBPPPPP..', // bow on left side: M=wood, B=string
    '..MPBPPPPM..',
    '..MPBPPPPM..',
    '..MMBPPPPP..', // M lower bow
    '..PPP.PPP...',
    '..PPP.PPP...',
    '..DDD.DDD...',
    '..DD...DD...',
  ],
  walk2: [
    '....AAAA....',
    '...AAAAAA...',
    '..AAASSSAA..',
    '..AASSSSAA..',
    '..ASVS.VSA..',
    '..ASSSSSSA..',
    '...SSSSSS...',
    '..PPPPPPPP..',
    '..PMBPPPPP..',
    '..MPBPPPPM..',
    '..MPBPPPPM..',
    '..MMBPPPPP..',
    '..PP..PPP...',
    '...PP.PPP...',
    '...DD.DDD...',
    '...DD..DD...',
  ],
  sit: [
    '............',
    '....AAAA....',
    '...AAAAAA...',
    '..AAASSSAA..',
    '..AASSSSAA..',
    '..ASVS.VSA..',
    '..ASSSSSSA..',
    '...SSSSSS...',
    '..PPPPPPPP..',
    '..MPPBPPPM..', // bow held across knees
    '..MMBBBBMM..',
    '..MPPPPPPM..',
    '..PPDDDDPP..',
    '..DDDDDDDD..',
    '............',
    '............',
  ],
};

const MAGE = {
  walk1: [
    '......TT....', // pointed hat tip (T = mage hat = primary tone too)
    '.....TPP....',
    '....TPPP....',
    '...TPPPP....',
    '..TPPPAPP...', // gold band
    '..AAAAAAA...',
    '...SSVSV....',
    '...SSSSS....',
    '..PPPPPPP.M.',
    '.PPAPPPAPP M', // staff on right (M)
    '.PPAAAAPPPB.', // orb (B = cyan)
    '.PPPPPPPPBB.',
    '.PPPPPPPPPB.',
    '.PPPPPPPPPM.',
    '..DDDDDDD.M.',
    '..DD...DDDM.',
  ],
  walk2: [
    '......TT....',
    '.....TPP....',
    '....TPPP....',
    '...TPPPP....',
    '..TPPPAPP...',
    '..AAAAAAA...',
    '...SSVSV....',
    '...SSSSS....',
    '..PPPPPPP.M.',
    '.PPAPPPAPP M',
    '.PPAAAAPPPB.',
    '.PPPPPPPPBB.',
    '.PPPPPPPPPB.',
    '.PPPPPPPPPM.',
    '..DDDDDDD.M.',
    '...DDDD.DDM.',
  ],
  sit: [
    '......TT....',
    '.....TPP....',
    '....TPPP....',
    '...TPPPP....',
    '..TPPPAPP...',
    '..AAAAAAA...',
    '...SSVSV....',
    '...SSSSS....',
    '..PPPPPPP...',
    '.PPAPPPAPP..',
    '.PPAAAAPPPB.', // orb floats beside (B)
    '.PPPPPPPPBB.',
    '.PPPPPPPPPB.',
    '.PPDDDDDPP..',
    '..DDDDDDD...',
    '............',
  ],
};

const ROGUE = {
  walk1: [
    '....PPPP....',
    '...PPPPPP...', // hood
    '..PPSSSSPP..',
    '..PSVS.VSP..',
    '..PSSSSSSP..',
    '..PPSSSSPP..',
    '..PPPPPPPP..',
    '.APPPPPPPPA.', // dagger handles A on each side
    '.BPPPPPPPPB.', // dagger blade B
    '.BPPPPPPPPB.',
    '..PPPPPPPP..',
    '..PPPPPPPP..',
    '..PP...PP...',
    '..PP...PP...',
    '..DD...DD...',
    '..DD...DD...',
  ],
  walk2: [
    '....PPPP....',
    '...PPPPPP...',
    '..PPSSSSPP..',
    '..PSVS.VSP..',
    '..PSSSSSSP..',
    '..PPSSSSPP..',
    '..PPPPPPPP..',
    '.APPPPPPPPA.',
    '.BPPPPPPPPB.',
    '.BPPPPPPPPB.',
    '..PPPPPPPP..',
    '..PPPPPPPP..',
    '..P.....PP..',
    '..PP...PPP..',
    '..DD....DD..',
    '..DDD..DDD..',
  ],
  sit: [
    '............',
    '....PPPP....',
    '...PPPPPP...',
    '..PPSSSSPP..',
    '..PSVS.VSP..',
    '..PSSSSSSP..',
    '..PPSSSSPP..',
    '..PPPPPPPP..',
    '.APPPPPPPPA.',
    '.BPPPPPBPPB.', // sharpening: blade across lap
    '..PPBBBBPP..',
    '..PPPPPPPP..',
    '..DDPPPPDD..',
    '..DDDDDDDD..',
    '............',
    '............',
  ],
};

const VILLAGER = {
  walk1: [
    '............',
    '....SSSS....',
    '...SHHHHS...', // hair line on top of head
    '..SSSSSSSS..',
    '..SVSS.SVS..',
    '..SSSSSSSS..',
    '...SSSSSS...',
    '..PPPPPPPP..',
    '..PPPPPPPP..',
    '..PPPPPPPP..',
    '..PPAAAAPP..', // belt
    '..AADAAAAD..',
    '..DDD.DDD...',
    '..DDD.DDD...',
    '..KKK.KKK...',
    '..KK...KK...',
  ],
  walk2: [
    '............',
    '....SSSS....',
    '...SHHHHS...',
    '..SSSSSSSS..',
    '..SVSS.SVS..',
    '..SSSSSSSS..',
    '...SSSSSS...',
    '..PPPPPPPP..',
    '..PPPPPPPP..',
    '..PPPPPPPP..',
    '..PPAAAAPP..',
    '..AADAAAAD..',
    '..DD..DDD...',
    '...DD.DDD...',
    '...KK.KKK...',
    '...KK..KK...',
  ],
  sit: [
    '............',
    '............',
    '....SSSS....',
    '...SHHHHS...',
    '..SSSSSSSS..',
    '..SVSS.SVS..',
    '..SSSSSSSS..',
    '...SSSSSS...',
    '..PPPPPPPP..',
    '..PPPPPPPP..',
    '..PPAAAAPP..',
    '..PPDDDDPP..',
    '..DDDDDDDD..',
    '..DDDDDDDD..',
    '............',
    '............',
  ],
};

// Villager has hair role 'H' — add it to the palette here so we don't fork the structure.
CLASSES.villager.palette.H = '#3a2818';

export const SPRITE_FRAMES = {
  knight: KNIGHT,
  ranger: RANGER,
  mage: MAGE,
  rogue: ROGUE,
  villager: VILLAGER,
};

// ─── Hats ──────────────────────────────────────────────────────────────────
// Small overlays positioned above the sprite head (top of the 16-row grid).
// Each hat is rendered as its own sprite element with its own grid.
// Grids are 12 cols × 4 rows. They sit just above the sprite (negative offsetY).

export const HAT_W = 12;
export const HAT_H = 4;

export const HATS = {
  none: null,
  crown: {
    grid: [
      'T...T..T...T',
      'TTTTTTTTTTTT',
      'TUTUTUTUTUTU',
      'TTTTTTTTTTTT',
    ],
    palette: { T: '#ffd86b', U: '#a02028' }, // gold + red gem
    offsetRow: -1,
  },
  halo: {
    grid: [
      '..WWWWWWWW..',
      '.W........W.',
      '.W........W.',
      '..WWWWWWWW..',
    ],
    palette: { W: '#fff7c0' },
    offsetRow: -3,
  },
  party: {
    grid: [
      '.....TT.....',
      '....TUUT....',
      '...TUUUUT...',
      '..TUUUUUUT..',
    ],
    palette: { T: '#3a8c4d', U: '#e87aa8' }, // green cone, pink stripes
    offsetRow: -2,
  },
  headband: {
    grid: [
      '............',
      '............',
      '..TTTTTTTT..',
      '..TUTTUTTU..',
    ],
    palette: { T: '#a02028', U: '#ffd86b' },
    offsetRow: 1, // sits on top of head, overlapping
  },
  horns: {
    grid: [
      'TT........TT',
      'TT........TT',
      '.TT......TT.',
      '..T......T..',
    ],
    palette: { T: '#1a1a22' }, // black devil horns
    offsetRow: -2,
  },
  hood: {
    grid: [
      '.TTTTTTTTTT.',
      'TTTTTTTTTTTT',
      'TTTTTTTTTTTT',
      'TT........TT',
    ],
    palette: { T: '#3a3a48' }, // dark gray hood that frames head
    offsetRow: 0,
  },
};

export const HAT_ALIASES = {
  none: 'none', off: 'none', remove: 'none',
  crown: 'crown', king: 'crown',
  halo: 'halo', angel: 'halo',
  party: 'party', cone: 'party', birthday: 'party',
  headband: 'headband', band: 'headband',
  horns: 'horns', devil: 'horns', horn: 'horns',
  hood: 'hood',
};

export function resolveHatId(name) {
  if (!name) return null;
  const lower = name.toLowerCase();
  return HAT_ALIASES[lower] || null;
}

// ─── Sprite rendering ──────────────────────────────────────────────────────
//
// Each sprite is a single <div> sized cellSize × cellSize, painted with one
// box-shadow per non-empty cell in the grid. Total cells per sprite ≈ 60–90
// — well within browser limits for a handful of concurrent sprites.
//
// `palette` is a map { roleKey -> CSS color string }. The 'P' (primary) role
// must be a CSS variable reference like 'var(--armor-primary)' so that
// runtime !color swaps via inline style attribute don't require regeneration.

export function buildSpriteShadow(grid, palette, cellSize = CELL_SIZE) {
  const shadows = [];
  for (let row = 0; row < grid.length; row++) {
    const line = grid[row];
    for (let col = 0; col < line.length; col++) {
      const ch = line[col];
      if (ch === '.' || ch === ' ') continue;
      const color = palette[ch];
      if (!color) continue; // unknown role — silently skip
      shadows.push(`${col * cellSize}px ${row * cellSize}px 0 0 ${color}`);
    }
  }
  return shadows.join(', ');
}

// Returns the color at grid[0][0] (or null if empty). Used to paint the
// source element's background when col-0/row-0 has content — the shadow at
// offset (0,0) overlaps the source exactly, and some rendering paths drop
// it, leaving that one pixel missing. Painting it as background guarantees
// visibility.
export function gridOriginColor(grid, palette) {
  if (!grid || grid.length === 0 || !grid[0]) return null;
  const ch = grid[0][0];
  if (!ch || ch === '.' || ch === ' ') return null;
  return palette[ch] || null;
}

// Compose a class palette for sprite rendering.
// `primaryColor` overrides the class's defaultPrimary (from a !color choice).
// Returns a palette object suitable for passing to buildSpriteShadow().
//
// The 'P' role is set to `var(--armor-primary)` so live color swaps just need
// to update the CSS variable on the sprite root — no regeneration required.
export function classPalette(classId, primaryColor = null) {
  const cls = CLASSES[classId];
  if (!cls) return null;
  return {
    ...cls.palette,
    P: 'var(--armor-primary)',
  };
}

// Get the resolved primary color (hex) for setting as a CSS variable.
// Falls back to the class's defaultPrimary if no color override.
export function resolvePrimary(classId, colorId = null) {
  const cls = CLASSES[classId];
  if (!cls) return '#888';
  if (colorId && COLORS[colorId]) return COLORS[colorId];
  if (classId === 'villager') {
    // Random earth tone for villagers
    const palette = cls.villagerColors;
    return palette[Math.floor(Math.random() * palette.length)];
  }
  return cls.defaultPrimary;
}

// All playable class IDs (excludes villager — used for random fallback in !join).
export const PLAYABLE_CLASS_IDS = ['knight', 'ranger', 'mage', 'rogue'];

export function randomPlayableClass() {
  return PLAYABLE_CLASS_IDS[Math.floor(Math.random() * PLAYABLE_CLASS_IDS.length)];
}
