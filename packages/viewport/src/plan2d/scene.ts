import RBush from 'rbush';
import { emptyBox, extendBox, itemFootprint, itemModel, pathBox, pointAt, resolveDimension, type Asset, type Box, type Entity, type EntityType, type Polygon, type Vec2 } from '@studio/core';

/** One entity in the spatial index, with its world box and a cache slot for its drawn outline. */
export interface SceneItem {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  readonly id: string;
  readonly type: EntityType;
  readonly layerId: string;
  readonly entity: Entity;
  /** Filled in lazily by the renderer; dropped with the item. */
  path2d: Path2D | null;
  /** A furniture item's footprint on the plan (its model's outline placed), worked out with its box. */
  footprint?: Polygon[];
}

/** A level's entities as an R-tree, kept in step with the document by diffing object identity. */
export interface LevelScene {
  readonly levelId: string;
  readonly items: Map<string, SceneItem>;
  readonly index: RBush<SceneItem>;
  /** Bumped on every change, so caches keyed on the scene know when to refresh. */
  version: number;
  /** The project's asset registry the items' footprints were worked out with. */
  assets: Readonly<Record<string, Asset>>;
}

export function createLevelScene(levelId: string): LevelScene {
  return { levelId, items: new Map(), index: new RBush<SceneItem>(), version: 0, assets: {} };
}

/** A furniture item's footprint with the project's assets: its model's outline, scaled, turned and placed. */
export function footprintOf(entity: Extract<Entity, { type: 'item' }>, assets: Readonly<Record<string, Asset>>): Polygon[] {
  return itemFootprint(entity, itemModel(entity.asset, assets));
}

const GLYPH = 250;

const boxOf = (points: readonly Vec2[]): Box => points.reduce(extendBox, emptyBox());

const grow = (box: Box, by: number): Box => ({ minX: box.minX - by, minY: box.minY - by, maxX: box.maxX + by, maxY: box.maxY + by });

const around = (p: Vec2, half: number): Box => ({ minX: p[0] - half, minY: p[1] - half, maxX: p[0] + half, maxY: p[1] + half });

/** The world box an entity occupies on the plan (generous, for culling and hit-testing candidates). */
export function entityBox(entity: Entity, entities: Record<string, Entity>, assets: Readonly<Record<string, Asset>> = {}): Box {
  switch (entity.type) {
    case 'wall':
      return grow(pathBox(entity.path), entity.thickness);
    case 'opening': {
      const wall = entities[entity.wallId];
      if (!wall || wall.type !== 'wall') return around([0, 0], 0);
      const { point } = pointAt(wall.path, entity.along);
      return around(point, entity.width / 2 + wall.thickness);
    }
    case 'column': {
      const s = entity.shape;
      if (s.k === 'rect') return around(entity.at, Math.hypot(s.w, s.d) / 2);
      if (s.k === 'circle') return around(entity.at, s.r);
      return pathBox(s.region.outer);
    }
    case 'slab':
      return entity.source.k === 'region' ? pathBox(entity.source.region.outer) : emptyBox();
    case 'void':
    case 'shaft':
      return pathBox(entity.region.outer);
    case 'room':
      return entity.boundary.k === 'detect' ? around(entity.boundary.seed, GLYPH * 2) : pathBox(entity.boundary.region.outer);
    case 'separator':
      return grow(pathBox(entity.path), 50);
    case 'shape':
      return grow(pathBox(entity.path), 1);
    case 'fixture':
      return around(entity.at, entity.size ? Math.hypot(entity.size[0], entity.size[1]) / 2 : GLYPH);
    case 'point':
      return around(entity.at, GLYPH / 2);
    case 'dimension': {
      const points = resolveDimension(entity, entities);
      return grow(boxOf([points.from, points.to, ...(points.vertex ? [points.vertex] : [])]), Math.abs(entity.offset) + GLYPH * 2);
    }
    case 'label':
      return grow(boxOf([entity.at]), Math.max(entity.size, entity.text.length * entity.size * 0.6));
    case 'item':
      return grow(boxOf(footprintOf(entity, assets).flat()), 1);
    case 'light':
      return around([entity.at[0], entity.at[1]], GLYPH * 2);
  }
}

/**
 * Brings the scene in step with a level's entities. The mirror keeps untouched entities' object
 * identity through patches, so an item is rebuilt only when its entity object changed. Returns
 * whether anything changed.
 */
export function syncLevelScene(scene: LevelScene, entities: Record<string, Entity>, assets: Readonly<Record<string, Asset>> = scene.assets): boolean {
  let changed = false;
  // Items are measured with the registry: when it changed (a model registered or let go), measure them again.
  const remeasure = assets !== scene.assets;
  scene.assets = assets;
  for (const [id, item] of scene.items) {
    const current = entities[id];
    if (current === item.entity && !(remeasure && item.type === 'item')) continue;
    scene.index.remove(item);
    scene.items.delete(id);
    changed = true;
  }
  for (const id in entities) {
    if (scene.items.has(id)) continue;
    const entity = entities[id];
    const box = entityBox(entity, entities, assets);
    if (!Number.isFinite(box.minX)) continue;
    const item: SceneItem = { ...box, id, type: entity.type, layerId: entity.layerId, entity, path2d: null, ...(entity.type === 'item' ? { footprint: footprintOf(entity, assets) } : {}) };
    scene.items.set(id, item);
    scene.index.insert(item);
    changed = true;
  }
  // An opening follows its wall, a tied dimension its wall or shape: rebuild them when that changed, even though their own object did not.
  for (const [id, item] of scene.items) {
    const follows = item.type === 'opening' || (item.type === 'dimension' && Boolean((item.entity as { anchors?: unknown }).anchors));
    if (!follows) continue;
    const box = entityBox(item.entity, entities);
    if (item.minX === box.minX && item.minY === box.minY && item.maxX === box.maxX && item.maxY === box.maxY) continue;
    scene.index.remove(item);
    const fresh: SceneItem = { ...box, id, type: item.type, layerId: item.layerId, entity: item.entity, path2d: null };
    scene.items.set(id, fresh);
    scene.index.insert(fresh);
    changed = true;
  }
  if (changed) scene.version++;
  return changed;
}

/** Items whose box meets `box`. */
export function searchScene(scene: LevelScene, box: Box): SceneItem[] {
  return scene.index.search(box);
}

/** The box around every item, empty when there is nothing. */
export function sceneBox(scene: LevelScene): Box {
  let box = emptyBox();
  for (const item of scene.items.values()) {
    if (item.type === 'opening') continue; // inside its wall's box anyway
    box = { minX: Math.min(box.minX, item.minX), minY: Math.min(box.minY, item.minY), maxX: Math.max(box.maxX, item.maxX), maxY: Math.max(box.maxY, item.maxY) };
  }
  return box;
}
