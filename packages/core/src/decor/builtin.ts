import type { Vec3 } from '../solids/mesh';

/**
 * What ships with the app: furniture recipes, materials and door and window styles, as data. Ids
 * are stable (projects store them as `builtin:<id>`): rename the `name`, never the `id`.
 *
 * A recipe is a model made of simple parts in its own coordinates: mm, z up, its bottom centre at
 * the origin and its front facing −y (south on the plan, the way an imported model's front faces).
 */

export const ITEM_CATEGORIES = ['living', 'dining', 'bedroom', 'kitchen', 'bathroom', 'office', 'lighting', 'outdoor'] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

/** A box between two corners, its vertical edges rounded by `r`; a cylinder or a cone (r0 at z0, r1 at z1). */
export type Part =
  | { k: 'box'; slot: string; min: Vec3; max: Vec3; r?: number }
  | { k: 'cyl'; slot: string; c: readonly [number, number]; z0: number; z1: number; r0: number; r1: number };

export interface Recipe {
  id: string;
  name: string;
  category: ItemCategory;
  tags: string[];
  /** Width (x), depth (y), height (z), mm: the parts stay inside it. */
  size: Vec3;
  /** The material of each slot unless the item overrides it. */
  slots: Record<string, string>;
  parts: Part[];
  /** Where a lamp's bulb sits, for "with its light". */
  bulb?: Vec3;
  /** The light a lamp gives, lumens. */
  lumens?: number;
  /** A sensible height above the floor to place it at (a wall cabinet, a pendant), mm. */
  elevation?: number;
}

const box = (slot: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, r = 0): Part => ({ k: 'box', slot, min: [x0, y0, z0], max: [x1, y1, z1], ...(r ? { r } : {}) });
const cyl = (slot: string, x: number, y: number, z0: number, z1: number, r0: number, r1 = r0): Part => ({ k: 'cyl', slot, c: [x, y], z0, z1, r0, r1 });
/** Four square legs inset from the corners of a w × d footprint centred `dy` from the origin. */
const legs = (slot: string, w: number, d: number, h: number, side = 50, inset = 30, dy = 0): Part[] =>
  [-1, 1].flatMap((sx) =>
    [-1, 1].map((sy) => {
      const x = sx < 0 ? -w / 2 + inset : w / 2 - inset - side;
      const y = dy + (sy < 0 ? -d / 2 + inset : d / 2 - inset - side);
      return box(slot, x, y, 0, x + side, y + side, h);
    }),
  );
/** Four round legs. */
const roundLegs = (slot: string, w: number, d: number, h: number, r = 22, inset = 50): Part[] => [-1, 1].flatMap((sx) => [-1, 1].map((sy) => cyl(slot, sx * (w / 2 - inset), sy * (d / 2 - inset), 0, h, r)));

function sofa(id: string, name: string, w: number, seats: number, tags: string[]): Recipe {
  const d = 900;
  const arm = 150;
  const inner = w - 2 * arm;
  const cushions = Array.from({ length: seats }, (_, i) => box('fabric', -inner / 2 + (inner / seats) * i + 5, -d / 2 + 20, 420, -inner / 2 + (inner / seats) * (i + 1) - 5, d / 2 - 200, 530, 30));
  return {
    id,
    name,
    category: 'living',
    tags: ['sofa', 'couch', 'seat', ...tags],
    size: [w, d, 800],
    slots: { fabric: 'builtin:fabric-charcoal', legs: 'builtin:black-metal' },
    parts: [
      box('fabric', -w / 2, -d / 2, 120, w / 2, d / 2, 420, 40),
      box('fabric', -w / 2, d / 2 - 200, 420, w / 2, d / 2, 800, 60),
      box('fabric', -w / 2, -d / 2, 420, -w / 2 + arm, d / 2 - 200, 640, 50),
      box('fabric', w / 2 - arm, -d / 2, 420, w / 2, d / 2 - 200, 640, 50),
      ...cushions,
      ...roundLegs('legs', w, d, 120, 25, 60),
    ],
  };
}

function bed(id: string, name: string, w: number, tags: string[]): Recipe {
  const d = 2100;
  const pillows = w > 1200 ? [box('linen', -w / 2 + 80, d / 2 - 460, 550, -40, d / 2 - 120, 650, 60), box('linen', 40, d / 2 - 460, 550, w / 2 - 80, d / 2 - 120, 650, 60)] : [box('linen', -w / 2 + 80, d / 2 - 460, 550, w / 2 - 80, d / 2 - 120, 650, 60)];
  return {
    id,
    name,
    category: 'bedroom',
    tags: ['bed', 'sleep', ...tags],
    size: [w, d, 1000],
    slots: { frame: 'builtin:oak', mattress: 'builtin:fabric-linen', linen: 'builtin:paint-white', legs: 'builtin:oak' },
    parts: [
      box('frame', -w / 2, -d / 2, 150, w / 2, d / 2 - 60, 330),
      box('frame', -w / 2, d / 2 - 60, 0, w / 2, d / 2, 1000),
      box('mattress', -w / 2 + 20, -d / 2 + 20, 330, w / 2 - 20, d / 2 - 80, 550, 50),
      box('linen', -w / 2 + 10, -d / 2 + 10, 450, w / 2 - 10, d / 2 - 600, 570, 40),
      ...pillows,
      ...legs('legs', w, d - 60, 150, 60, 40, -30),
    ],
  };
}

function table(id: string, name: string, w: number, d: number, tags: string[]): Recipe {
  return {
    id,
    name,
    category: 'dining',
    tags: ['table', 'dining', ...tags],
    size: [w, d, 750],
    slots: { top: 'builtin:oak', legs: 'builtin:oak' },
    parts: [box('top', -w / 2, -d / 2, 720, w / 2, d / 2, 750, 10), ...legs('legs', w, d, 720, 60, 50)],
  };
}

/** A kitchen base run: plinth, carcass, door fronts and a worktop. */
function counter(id: string, name: string, w: number, tags: string[], extra: Part[] = [], slots: Record<string, string> = {}): Recipe {
  const doors = Math.max(1, Math.round(w / 600));
  const top = Math.max(900, ...extra.map((p) => (p.k === 'box' ? p.max[2] : p.z1)));
  return {
    id,
    name,
    category: 'kitchen',
    tags: ['kitchen', 'cabinet', 'counter', ...tags],
    size: [w, 600, top],
    slots: { body: 'builtin:paint-white', fronts: 'builtin:paint-sage', top: 'builtin:granite-black', plinth: 'builtin:black-metal', ...slots },
    parts: [
      box('plinth', -w / 2 + 10, -300 + 60, 0, w / 2 - 10, 300 - 10, 100),
      box('body', -w / 2, -300 + 20, 100, w / 2, 300, 870),
      ...Array.from({ length: doors }, (_, i) => box('fronts', -w / 2 + (w / doors) * i + 3, -300, 105, -w / 2 + (w / doors) * (i + 1) - 3, -300 + 20, 865)),
      box('top', -w / 2, -300, 870, w / 2, 300, 900),
      ...extra,
    ],
  };
}

const LAMP_SLOTS: Record<string, string> = { shade: 'builtin:lampshade', metal: 'builtin:brass', base: 'builtin:ceramic-white' };

function lamp(id: string, name: string, size: Vec3, parts: Part[], bulb: Vec3, lumens: number, tags: string[], elevation?: number): Recipe {
  const used = new Set(parts.map((p) => p.slot));
  return {
    id,
    name,
    category: 'lighting',
    tags: ['lamp', 'light', ...tags],
    size,
    slots: Object.fromEntries(Object.entries(LAMP_SLOTS).filter(([slot]) => used.has(slot))),
    parts,
    bulb,
    lumens,
    ...(elevation ? { elevation } : {}),
  };
}

export const RECIPES: readonly Recipe[] = [
  // ---------- living ----------
  sofa('sofa-2', 'Sofa, 2 seats', 1600, 2, ['two seater', 'loveseat']),
  sofa('sofa-3', 'Sofa, 3 seats', 2200, 3, ['three seater']),
  {
    id: 'armchair',
    name: 'Armchair',
    category: 'living',
    tags: ['chair', 'seat', 'lounge'],
    size: [850, 850, 800],
    slots: { fabric: 'builtin:fabric-velvet-green', legs: 'builtin:walnut' },
    parts: [box('fabric', -425, -425, 120, 425, 425, 420, 40), box('fabric', -425, 225, 420, 425, 425, 800, 60), box('fabric', -425, -425, 420, -275, 225, 640, 50), box('fabric', 275, -425, 420, 425, 225, 640, 50), box('fabric', -270, -405, 420, 270, 220, 530, 30), ...roundLegs('legs', 850, 850, 120, 22, 60)],
  },
  {
    id: 'coffee-table',
    name: 'Coffee table',
    category: 'living',
    tags: ['table', 'low table'],
    size: [1100, 600, 420],
    slots: { top: 'builtin:walnut', legs: 'builtin:black-metal' },
    parts: [box('top', -550, -300, 380, 550, 300, 420, 20), ...legs('legs', 1100, 600, 380, 40, 40)],
  },
  {
    id: 'tv-unit',
    name: 'TV unit',
    category: 'living',
    tags: ['media', 'sideboard', 'television', 'cabinet'],
    size: [1800, 450, 500],
    slots: { body: 'builtin:oak', fronts: 'builtin:paint-white', legs: 'builtin:black-metal' },
    parts: [box('body', -900, -205, 100, 900, 225, 500), box('fronts', -890, -225, 110, -2, -205, 490), box('fronts', 2, -225, 110, 890, -205, 490), ...legs('legs', 1800, 450, 100, 40, 40)],
  },
  {
    id: 'bookshelf',
    name: 'Bookshelf',
    category: 'living',
    tags: ['shelves', 'books', 'storage', 'shelving'],
    size: [900, 350, 2000],
    slots: { body: 'builtin:oak', back: 'builtin:paint-white' },
    parts: [
      box('body', -450, -175, 0, -430, 175, 2000),
      box('body', 430, -175, 0, 450, 175, 2000),
      box('back', -430, 160, 0, 430, 175, 2000),
      ...[0, 380, 760, 1140, 1520, 1980].map((z) => box('body', -430, -175, z, 430, 160, z + 20)),
    ],
  },

  // ---------- dining ----------
  table('dining-table-4', 'Dining table, 4 seats', 1200, 800, ['four']),
  table('dining-table-6', 'Dining table, 6 seats', 1800, 900, ['six']),
  {
    id: 'dining-chair',
    name: 'Dining chair',
    category: 'dining',
    tags: ['chair', 'seat'],
    size: [450, 520, 900],
    slots: { seat: 'builtin:fabric-linen', frame: 'builtin:oak' },
    parts: [box('seat', -225, -260, 430, 225, 220, 480, 20), box('frame', -225, 220, 0, 225, 260, 900), ...legs('frame', 450, 480, 430, 40, 10, -20)],
  },

  // ---------- bedroom ----------
  bed('bed-single', 'Single bed', 1000, ['single', 'twin']),
  bed('bed-double', 'Double bed', 1600, ['double', 'queen']),
  {
    id: 'nightstand',
    name: 'Nightstand',
    category: 'bedroom',
    tags: ['bedside table', 'drawer'],
    size: [500, 400, 550],
    slots: { body: 'builtin:oak', fronts: 'builtin:paint-white', handles: 'builtin:brass' },
    parts: [box('body', -250, -180, 100, 250, 200, 550), box('fronts', -240, -195, 330, 240, -180, 540), box('fronts', -240, -195, 110, 240, -180, 320), box('handles', -50, -200, 430, 50, -195, 445), box('handles', -50, -200, 210, 50, -195, 225), ...legs('body', 500, 400, 100, 35, 20)],
  },
  {
    id: 'wardrobe',
    name: 'Wardrobe',
    category: 'bedroom',
    tags: ['closet', 'storage', 'cupboard'],
    size: [1200, 600, 2100],
    slots: { body: 'builtin:paint-white', fronts: 'builtin:oak', handles: 'builtin:black-metal' },
    parts: [box('body', -600, -280, 0, 600, 300, 2100), box('fronts', -597, -295, 60, -3, -280, 2090), box('fronts', 3, -295, 60, 597, -280, 2090), box('handles', -60, -300, 950, -35, -295, 1250), box('handles', 35, -300, 950, 60, -295, 1250)],
  },
  {
    id: 'dresser',
    name: 'Dresser',
    category: 'bedroom',
    tags: ['chest of drawers', 'drawers', 'storage'],
    size: [1200, 500, 800],
    slots: { body: 'builtin:walnut', fronts: 'builtin:walnut', legs: 'builtin:black-metal' },
    parts: [box('body', -600, -230, 120, 600, 250, 800), ...[0, 1, 2].map((i) => box('fronts', -590, -250, 130 + i * 222, 590, -230, 130 + (i + 1) * 222 - 6)), ...legs('legs', 1200, 500, 120, 35, 30)],
  },

  // ---------- kitchen ----------
  counter('base-cabinet', 'Base cabinet', 600, ['base unit', 'cupboard']),
  {
    id: 'wall-cabinet',
    name: 'Wall cabinet',
    category: 'kitchen',
    tags: ['kitchen', 'cabinet', 'upper cabinet', 'cupboard'],
    size: [600, 350, 700],
    slots: { body: 'builtin:paint-white', fronts: 'builtin:paint-sage' },
    parts: [box('body', -300, -155, 0, 300, 175, 700), box('fronts', -297, -175, 3, 297, -155, 697)],
    elevation: 1450,
  },
  counter('counter-run', 'Kitchen counter, 2.4 m', 2400, ['run', 'worktop']),
  {
    id: 'fridge',
    name: 'Fridge freezer',
    category: 'kitchen',
    tags: ['refrigerator', 'freezer', 'appliance'],
    size: [700, 700, 1850],
    slots: { body: 'builtin:steel', handles: 'builtin:black-metal' },
    parts: [box('body', -350, -330, 0, 350, 350, 1850, 20), box('body', -347, -345, 10, 347, -330, 1150), box('body', -347, -345, 1160, 347, -330, 1840), box('handles', 290, -350, 1200, 310, -345, 1500), box('handles', 290, -350, 700, 310, -345, 1100)],
  },
  counter('cooker', 'Cooker', 600, ['stove', 'oven', 'hob', 'range', 'appliance'], [box('hob', -280, -270, 900, 280, 270, 906), box('hob', -260, -300, 500, 260, -290, 800)], { fronts: 'builtin:steel', top: 'builtin:steel', hob: 'builtin:glass-black' }),
  counter('sink-unit', 'Sink unit', 1200, ['sink', 'basin', 'tap'], [box('sink', -500, -230, 900, -20, 230, 905, 40), cyl('sink', -260, 260, 900, 1150, 15)], { sink: 'builtin:steel' }),

  // ---------- bathroom ----------
  {
    id: 'toilet',
    name: 'Toilet',
    category: 'bathroom',
    tags: ['wc', 'lavatory', 'sanitary'],
    size: [380, 700, 800],
    slots: { ceramic: 'builtin:ceramic-white' },
    parts: [box('ceramic', -130, -200, 0, 130, 160, 300, 80), box('ceramic', -190, -350, 300, 190, 180, 400, 170), box('ceramic', -190, 170, 0, 190, 350, 800, 30)],
  },
  {
    id: 'washbasin',
    name: 'Washbasin',
    category: 'bathroom',
    tags: ['sink', 'basin', 'lavatory', 'sanitary'],
    size: [600, 450, 1000],
    slots: { ceramic: 'builtin:ceramic-white', tap: 'builtin:steel' },
    parts: [cyl('ceramic', 0, 50, 0, 750, 90, 110), box('ceramic', -300, -225, 750, 300, 225, 850, 80), cyl('tap', 0, 170, 850, 1000, 12)],
  },
  {
    id: 'bathtub',
    name: 'Bathtub',
    category: 'bathroom',
    tags: ['bath', 'tub', 'sanitary'],
    size: [1700, 750, 560],
    slots: { ceramic: 'builtin:ceramic-white' },
    parts: [box('ceramic', -850, -375, 0, 850, 375, 560, 120)],
  },
  {
    id: 'shower',
    name: 'Shower',
    category: 'bathroom',
    tags: ['shower tray', 'screen', 'sanitary'],
    size: [900, 900, 2000],
    slots: { ceramic: 'builtin:ceramic-white', glass: 'builtin:glass', metal: 'builtin:steel' },
    parts: [box('ceramic', -450, -450, 0, 450, 450, 80, 20), box('glass', -450, -450, 80, 0, -440, 2000), box('glass', -450, -440, 80, -440, 450, 2000), cyl('metal', 300, 400, 80, 1950, 12)],
  },

  // ---------- office ----------
  {
    id: 'desk',
    name: 'Desk',
    category: 'office',
    tags: ['table', 'workstation', 'study'],
    size: [1400, 700, 750],
    slots: { top: 'builtin:oak', frame: 'builtin:black-metal' },
    parts: [box('top', -700, -350, 720, 700, 350, 750, 10), box('frame', -690, -330, 0, -650, 330, 720), box('frame', 650, -330, 0, 690, 330, 720), box('frame', -650, 300, 400, 650, 320, 700)],
  },
  {
    id: 'office-chair',
    name: 'Office chair',
    category: 'office',
    tags: ['chair', 'seat', 'swivel', 'task chair'],
    size: [600, 600, 1050],
    slots: { fabric: 'builtin:fabric-charcoal', frame: 'builtin:black-metal' },
    parts: [cyl('frame', 0, 0, 0, 40, 300), cyl('frame', 0, 0, 40, 420, 30), box('fabric', -240, -250, 420, 240, 230, 490, 60), box('fabric', -220, 200, 520, 220, 250, 1050, 60), box('frame', -20, 210, 420, 20, 240, 520)],
  },

  // ---------- lighting ----------
  lamp('pendant', 'Pendant lamp', [400, 400, 700], [cyl('shade', 0, 0, 100, 300, 200, 70), cyl('metal', 0, 0, 300, 700, 5)], [0, 0, 150], 800, ['ceiling', 'hanging'], 2200),
  lamp('floor-lamp', 'Floor lamp', [400, 400, 1600], [cyl('base', 0, 0, 0, 30, 180), cyl('metal', 0, 0, 30, 1360, 12), cyl('shade', 0, 0, 1350, 1600, 200, 150)], [0, 0, 1450], 1200, ['standing']),
  lamp('table-lamp', 'Table lamp', [300, 300, 500], [cyl('base', 0, 0, 0, 250, 80, 60), cyl('shade', 0, 0, 250, 500, 150, 110)], [0, 0, 350], 450, ['desk lamp', 'bedside']),

  // ---------- outdoor and plants ----------
  {
    id: 'planter',
    name: 'Potted plant',
    category: 'outdoor',
    tags: ['plant', 'pot', 'green', 'indoor plant'],
    size: [500, 500, 1000],
    slots: { pot: 'builtin:terracotta', leaves: 'builtin:leaves' },
    parts: [cyl('pot', 0, 0, 0, 400, 180, 230), cyl('leaves', 0, 0, 400, 600, 150, 250), cyl('leaves', 0, 0, 600, 850, 250, 200), cyl('leaves', 0, 0, 850, 1000, 200, 60)],
  },
  {
    id: 'tree',
    name: 'Tree',
    category: 'outdoor',
    tags: ['garden', 'plant', 'green', 'landscape'],
    size: [3000, 3000, 5000],
    slots: { bark: 'builtin:bark', leaves: 'builtin:leaves' },
    parts: [cyl('bark', 0, 0, 0, 2400, 160, 110), cyl('leaves', 0, 0, 2000, 3000, 600, 1500), cyl('leaves', 0, 0, 3000, 4200, 1500, 1200), cyl('leaves', 0, 0, 4200, 5000, 1200, 200)],
  },
];

// ---------- materials ----------

export const MATERIAL_CATEGORIES = ['paint', 'wood', 'tile', 'stone', 'concrete', 'carpet', 'brick', 'fabric', 'metal', 'glass', 'ceramic', 'nature'] as const;
export type MaterialCategory = (typeof MATERIAL_CATEGORIES)[number];

/** A pattern drawn into a texture: its repeat (`size`, mm along u and v), its second colour, and joint width. */
export interface MaterialPattern {
  k: 'planks' | 'tiles' | 'brick' | 'herringbone' | 'noise';
  size: readonly [number, number];
  color2: string;
  joint?: number;
}

export interface BuiltinMaterial {
  id: string;
  name: string;
  category: MaterialCategory;
  tags: string[];
  /** Base colour, sRGB. */
  color: string;
  roughness: number;
  metalness: number;
  /** Below 1 for glass. */
  opacity?: number;
  pattern?: MaterialPattern;
}

const mat = (id: string, name: string, category: MaterialCategory, color: string, roughness: number, tags: string[] = [], rest: Partial<BuiltinMaterial> = {}): BuiltinMaterial => ({ id, name, category, tags, color, roughness, metalness: 0, ...rest });

export const MATERIALS: readonly BuiltinMaterial[] = [
  mat('paint-white', 'White paint', 'paint', '#f2f0eb', 0.9, ['wall', 'matt']),
  mat('paint-warm-grey', 'Warm grey paint', 'paint', '#c9c3b8', 0.9, ['wall', 'greige']),
  mat('paint-sage', 'Sage paint', 'paint', '#a7b39a', 0.9, ['wall', 'green']),
  mat('paint-navy', 'Navy paint', 'paint', '#2f3e56', 0.85, ['wall', 'blue', 'dark']),
  mat('paint-terracotta', 'Terracotta paint', 'paint', '#c07050', 0.9, ['wall', 'orange', 'warm']),
  mat('oak', 'Oak', 'wood', '#b8865a', 0.6, ['timber', 'furniture'], { pattern: { k: 'noise', size: [400, 400], color2: '#a5754d' } }),
  mat('walnut', 'Walnut', 'wood', '#6b4a33', 0.55, ['timber', 'dark', 'furniture'], { pattern: { k: 'noise', size: [400, 400], color2: '#5a3d2a' } }),
  mat('oak-floor', 'Oak floorboards', 'wood', '#b98a5e', 0.55, ['floor', 'timber', 'planks', 'parquet'], { pattern: { k: 'planks', size: [1200, 180], color2: '#9f7249', joint: 2 } }),
  mat('herringbone-oak', 'Herringbone oak', 'wood', '#c09468', 0.5, ['floor', 'parquet', 'timber'], { pattern: { k: 'herringbone', size: [600, 100], color2: '#a67c52', joint: 2 } }),
  mat('pine-floor', 'Pine floorboards', 'wood', '#d8b98a', 0.6, ['floor', 'timber', 'planks', 'light'], { pattern: { k: 'planks', size: [1500, 150], color2: '#c4a272', joint: 2 } }),
  mat('tile-white', 'White tiles', 'tile', '#f1f1ee', 0.3, ['bathroom', 'kitchen', 'square'], { pattern: { k: 'tiles', size: [300, 300], color2: '#c9c9c4', joint: 3 } }),
  mat('tile-grey-large', 'Large grey tiles', 'tile', '#9a9a96', 0.4, ['floor', 'porcelain'], { pattern: { k: 'tiles', size: [600, 600], color2: '#7d7d79', joint: 3 } }),
  mat('tile-terracotta', 'Terracotta tiles', 'tile', '#b8664a', 0.7, ['floor', 'quarry', 'warm'], { pattern: { k: 'tiles', size: [200, 200], color2: '#d9c6b5', joint: 6 } }),
  mat('tile-subway', 'Subway tiles', 'tile', '#f4f3ef', 0.25, ['kitchen', 'bathroom', 'metro', 'splashback'], { pattern: { k: 'brick', size: [150, 75], color2: '#cfcfca', joint: 3 } }),
  mat('marble', 'Marble', 'stone', '#e8e6e1', 0.2, ['white', 'polished'], { pattern: { k: 'noise', size: [800, 800], color2: '#cfccc6' } }),
  mat('granite-black', 'Black granite', 'stone', '#2b2b2c', 0.3, ['worktop', 'dark'], { pattern: { k: 'noise', size: [300, 300], color2: '#3d3d40' } }),
  mat('slate', 'Slate', 'stone', '#4a4f55', 0.7, ['floor', 'dark'], { pattern: { k: 'tiles', size: [400, 400], color2: '#3a3e43', joint: 4 } }),
  mat('concrete', 'Concrete', 'concrete', '#a5a39f', 0.85, ['raw', 'grey'], { pattern: { k: 'noise', size: [1000, 1000], color2: '#92908c' } }),
  mat('polished-concrete', 'Polished concrete', 'concrete', '#b4b2ad', 0.35, ['floor', 'grey'], { pattern: { k: 'noise', size: [1500, 1500], color2: '#a3a19c' } }),
  mat('carpet-grey', 'Grey carpet', 'carpet', '#8a8a8c', 1, ['floor', 'soft'], { pattern: { k: 'noise', size: [100, 100], color2: '#7c7c7e' } }),
  mat('carpet-beige', 'Beige carpet', 'carpet', '#cbbba0', 1, ['floor', 'soft', 'warm'], { pattern: { k: 'noise', size: [100, 100], color2: '#bcab90' } }),
  mat('brick-red', 'Red brick', 'brick', '#9c4a36', 0.9, ['wall', 'facade', 'exposed'], { pattern: { k: 'brick', size: [225, 75], color2: '#cfc6b8', joint: 10 } }),
  mat('brick-white', 'White brick', 'brick', '#e9e5dc', 0.9, ['wall', 'painted'], { pattern: { k: 'brick', size: [225, 75], color2: '#cdc8bd', joint: 10 } }),
  mat('fabric-linen', 'Linen', 'fabric', '#d8cfc0', 1, ['upholstery', 'natural']),
  mat('fabric-charcoal', 'Charcoal fabric', 'fabric', '#4a4a4e', 1, ['upholstery', 'dark']),
  mat('fabric-velvet-green', 'Green velvet', 'fabric', '#3f5f4f', 0.8, ['upholstery']),
  mat('leather-brown', 'Brown leather', 'fabric', '#7a4a2e', 0.5, ['upholstery', 'leather']),
  mat('steel', 'Brushed steel', 'metal', '#a8acb0', 0.35, ['stainless', 'appliance'], { metalness: 0.9 }),
  mat('black-metal', 'Black metal', 'metal', '#2a2a2c', 0.45, ['powder coated', 'steel'], { metalness: 0.6 }),
  mat('brass', 'Brass', 'metal', '#c4a35a', 0.3, ['gold', 'fittings'], { metalness: 0.9 }),
  mat('glass', 'Clear glass', 'glass', '#cfe6ee', 0.05, ['transparent', 'window'], { opacity: 0.3 }),
  mat('glass-black', 'Black glass', 'glass', '#151517', 0.1, ['hob', 'glossy']),
  mat('ceramic-white', 'White ceramic', 'ceramic', '#f4f4f2', 0.2, ['porcelain', 'sanitary', 'glossy']),
  mat('lampshade', 'Lampshade fabric', 'fabric', '#f3ead8', 0.9, ['shade', 'light']),
  mat('terracotta', 'Terracotta', 'ceramic', '#b5653f', 0.85, ['pot', 'clay']),
  mat('leaves', 'Leaves', 'nature', '#4f7a3a', 0.9, ['plant', 'green', 'foliage'], { pattern: { k: 'noise', size: [200, 200], color2: '#3e6530' } }),
  mat('bark', 'Bark', 'nature', '#5a4632', 1, ['tree', 'wood'], { pattern: { k: 'noise', size: [150, 150], color2: '#4a3828' } }),
  mat('grass', 'Grass', 'nature', '#6b8f45', 1, ['lawn', 'garden', 'green'], { pattern: { k: 'noise', size: [150, 150], color2: '#5c7d3a' } }),
];

// ---------- door and window styles ----------

export interface OpeningStyle {
  id: string;
  name: string;
  kind: 'door' | 'window';
  tags: string[];
  /** The frame lining the opening: its face width and how far it stands out of the wall faces, mm. */
  frame: { width: number; proud: number };
  /** Doors: a flat leaf, one with raised panels, or one with a glazed panel. */
  leaf?: 'flush' | 'panel' | 'glazed';
  /** Windows: how many opening casements side by side (0: fixed glazing). */
  casements?: number;
  /** Windows: vertical bars between panes besides the casements' own frames. */
  mullions?: number;
  slots: { frame: string; leaf?: string };
}

export const OPENING_STYLES: readonly OpeningStyle[] = [
  { id: 'door-flush', name: 'Flush door', kind: 'door', tags: ['plain', 'interior'], frame: { width: 50, proud: 10 }, leaf: 'flush', slots: { frame: 'builtin:paint-white', leaf: 'builtin:oak' } },
  { id: 'door-panel', name: 'Panelled door', kind: 'door', tags: ['traditional', 'four panel'], frame: { width: 70, proud: 15 }, leaf: 'panel', slots: { frame: 'builtin:paint-white', leaf: 'builtin:paint-white' } },
  { id: 'door-glazed', name: 'Glazed door', kind: 'door', tags: ['glass', 'light'], frame: { width: 50, proud: 10 }, leaf: 'glazed', slots: { frame: 'builtin:black-metal', leaf: 'builtin:black-metal' } },
  { id: 'window-fixed', name: 'Fixed window', kind: 'window', tags: ['picture window', 'glazing'], frame: { width: 60, proud: 0 }, casements: 0, slots: { frame: 'builtin:paint-white' } },
  { id: 'window-casement', name: 'Casement window', kind: 'window', tags: ['single', 'opening'], frame: { width: 60, proud: 0 }, casements: 1, slots: { frame: 'builtin:paint-white' } },
  { id: 'window-double', name: 'Double casement window', kind: 'window', tags: ['french', 'two', 'opening'], frame: { width: 60, proud: 0 }, casements: 2, slots: { frame: 'builtin:paint-white' } },
  { id: 'window-grid', name: 'Window with mullions', kind: 'window', tags: ['industrial', 'bars', 'crittall'], frame: { width: 50, proud: 0 }, casements: 0, mullions: 3, slots: { frame: 'builtin:black-metal' } },
];

/** The style an opening gets when it names none. */
export const DEFAULT_STYLE: Record<'door' | 'window', string> = { door: 'door-flush', window: 'window-fixed' };

const byId = <T extends { id: string }>(list: readonly T[]) => new Map(list.map((x) => [x.id, x]));
const RECIPE_BY_ID = byId(RECIPES);
const MATERIAL_BY_ID = byId(MATERIALS);
const STYLE_BY_ID = byId(OPENING_STYLES);

export const builtinRecipe = (id: string): Recipe | undefined => RECIPE_BY_ID.get(id);
export const builtinMaterial = (id: string): BuiltinMaterial | undefined => MATERIAL_BY_ID.get(id);
export const builtinStyle = (id: string): OpeningStyle | undefined => STYLE_BY_ID.get(id);
