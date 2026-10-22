import { describe, expect, it } from 'vitest';
import { polygonArea } from '../geometry/polygon';
import { meshBox, meshVolume } from '../solids/mesh';
import { ITEM_CATEGORIES, MATERIALS, OPENING_STYLES, RECIPES, builtinMaterial } from './builtin';
import { builtinEntries, searchCatalog } from './catalog';
import { recipeDetails, recipeMeshes, recipeOutline } from './recipes';
import { parseRef } from './refs';

describe('the built-in catalog', () => {
  it('has unique ids across furniture, materials and styles, and keeps them', () => {
    const ids = [...RECIPES, ...MATERIALS, ...OPENING_STYLES].map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(parseRef(`builtin:${id}`)).toEqual({ k: 'builtin', id });
    // Projects store these ids: changing one breaks every project that uses it.
    expect(RECIPES.map((r) => r.id)).toEqual([
      'sofa-2', 'sofa-3', 'armchair', 'coffee-table', 'tv-unit', 'bookshelf', 'dining-table-4', 'dining-table-6', 'dining-chair', 'bed-single', 'bed-double', 'nightstand', 'wardrobe', 'dresser',
      'base-cabinet', 'wall-cabinet', 'counter-run', 'fridge', 'cooker', 'sink-unit', 'toilet', 'washbasin', 'bathtub', 'shower', 'desk', 'office-chair', 'pendant', 'floor-lamp', 'table-lamp', 'planter', 'tree',
    ]);
    expect(MATERIALS.length).toBeGreaterThanOrEqual(30);
    expect(OPENING_STYLES.map((s) => s.id)).toEqual(['door-flush', 'door-panel', 'door-glazed', 'window-fixed', 'window-casement', 'window-double', 'window-grid']);
    expect(new Set(RECIPES.map((r) => r.category))).toEqual(new Set(ITEM_CATEGORIES));
  });

  it.each(RECIPES.map((r) => [r.id, r] as const))('%s builds closed meshes within its size, an outline within its footprint, and a material per slot', (_id, recipe) => {
    const [w, d, h] = recipe.size;
    const meshes = recipeMeshes(recipe);
    expect(meshes.map((m) => m.slot).sort()).toEqual(Object.keys(recipe.slots).sort());
    for (const { slot, mesh } of meshes) {
      // Closed and facing outwards: the same volume about two far-apart origins, and positive.
      const v = meshVolume(mesh);
      expect(v, slot).toBeGreaterThan(0);
      // (Float32 positions: a cylinder's facets are exact to about 1e-5.)
      expect(meshVolume(mesh, [5000, -7000, 3000]) / v, slot).toBeCloseTo(1, 4);
      const box = meshBox(mesh)!;
      expect(box.min[0], slot).toBeGreaterThanOrEqual(-w / 2 - 0.5);
      expect(box.max[0], slot).toBeLessThanOrEqual(w / 2 + 0.5);
      expect(box.min[1], slot).toBeGreaterThanOrEqual(-d / 2 - 0.5);
      expect(box.max[1], slot).toBeLessThanOrEqual(d / 2 + 0.5);
      expect(box.min[2], slot).toBeGreaterThanOrEqual(-0.5);
      expect(box.max[2], slot).toBeLessThanOrEqual(h + 0.5);
    }
    // The parts reach the stated height and width, so the size is what one sees.
    const all = meshes.map((m) => meshBox(m.mesh)!);
    expect(Math.max(...all.map((b) => b.max[2]))).toBeCloseTo(h, 0);
    expect(Math.max(...all.map((b) => b.max[0])) - Math.min(...all.map((b) => b.min[0]))).toBeGreaterThan(w * 0.9);
    const area = recipeOutline(recipe).reduce((sum, p) => sum + polygonArea(p), 0);
    expect(area).toBeGreaterThan(0);
    expect(area).toBeLessThanOrEqual(w * d + 1);
    for (const ref of Object.values(recipe.slots)) expect(builtinMaterial(parseRef(ref)?.k === 'builtin' ? (parseRef(ref) as { id: string }).id : ''), ref).toBeDefined();
    if (recipe.bulb) expect(recipe.lumens).toBeGreaterThan(0);
  });

  it('shows the parts seen from above in the plan symbol, not what lies under them', () => {
    const recipe = (id: string) => RECIPES.find((r) => r.id === id)!;
    // A table's top hides its legs; a sofa shows its base, back, arms and three cushions, not its legs.
    expect(recipeDetails(recipe('dining-table-6'))).toHaveLength(1);
    expect(recipeDetails(recipe('sofa-3'))).toHaveLength(7);
  });

  it('gives every style and material what it needs', () => {
    for (const style of OPENING_STYLES) for (const ref of Object.values(style.slots)) expect(builtinMaterial(ref.replace('builtin:', '')), `${style.id} ${ref}`).toBeDefined();
    for (const m of MATERIALS) {
      expect(m.color).toMatch(/^#[0-9a-f]{6}$/);
      if (m.pattern) expect(m.pattern.color2).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('ranks a search by name, then category and tags', () => {
    const items = builtinEntries().filter((e) => e.kind === 'item');
    const names = (q: string) => searchCatalog(items, q).map((e) => e.name);
    expect(names('sofa').slice(0, 2)).toEqual(['Sofa, 2 seats', 'Sofa, 3 seats']);
    expect(names('bed').slice(0, 2)).toEqual(['Double bed', 'Single bed']);
    expect(names('couch')[0]).toMatch(/^Sofa/);
    expect(names('wc')[0]).toBe('Toilet');
    expect(names('dining table')[0]).toMatch(/^Dining table/);
    expect(names('piano')).toEqual([]);
    expect(searchCatalog(items, '')).toHaveLength(RECIPES.length);
    const materials = builtinEntries().filter((e) => e.kind === 'material');
    expect(searchCatalog(materials, 'oak').map((e) => e.ref).slice(0, 3)).toEqual(['builtin:oak', 'builtin:oak-floor', 'builtin:herringbone-oak']);
    expect(searchCatalog(materials, 'parquet').map((e) => e.ref).sort()).toEqual(['builtin:herringbone-oak', 'builtin:oak-floor']);
  });
});
