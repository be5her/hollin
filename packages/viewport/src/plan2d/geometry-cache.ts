import { connectorCuts, cutSlabs, deriveRooms, deriveWalls, wallBody, type Entity, type LevelGeometry, type LevelWalls, type Opening, type Polygon, type ProjectDoc, type RuleLimits, type Wall, type WallBody } from '@studio/core';

const NO_CUTS: readonly Polygon[] = Object.freeze([]);

/**
 * Derived geometry memoised by object identity. Valid in the renderer only: the mirror builds a
 * fresh draft per patch and never mutates a published state, so an entity object or a level's
 * entity record changes identity exactly when its contents change. (Main derives afresh instead:
 * a transaction mutates a level's record in place while a batch runs.)
 */
export class LevelGeometryCache {
  private readonly bodies = new WeakMap<Wall, WallBody>();
  private readonly levels = new WeakMap<Record<string, Entity>, Map<string, LevelWalls>>();
  private readonly whole = new WeakMap<Record<string, Entity>, LevelGeometry>();
  private readonly cut = new WeakMap<LevelGeometry, { cuts: readonly Polygon[]; geometry: LevelGeometry }>();
  private readonly openings = new WeakMap<ProjectDoc['connectors'], { key: unknown[]; byLevel: Map<string, readonly Polygon[]> }>();

  readonly bodyOf = (wall: Wall): WallBody => {
    let body = this.bodies.get(wall);
    if (!body) {
      body = wallBody(wall);
      this.bodies.set(wall, body);
    }
    return body;
  };

  /**
   * Everything a level's entities derive to (all walls, hidden or not: hiding is a view choice and
   * rooms stay enclosed), with `cuts` (from `cuts()`, so the same array while nothing changed) taken
   * out of its slabs.
   */
  level(entities: Record<string, Entity>, cuts: readonly Polygon[] = NO_CUTS): LevelGeometry {
    let g = this.whole.get(entities);
    if (!g) {
      const walls = this.walls(entities);
      g = { walls, ...deriveRooms(entities, walls) };
      this.whole.set(entities, g);
    }
    if (!cuts.length) return g;
    const known = this.cut.get(g);
    if (known?.cuts === cuts) return known.geometry;
    const geometry = cutSlabs(g, cuts);
    this.cut.set(g, { cuts, geometry });
    return geometry;
  }

  /** The connector openings in a level's slabs, the same array until the connectors, the levels or the limits change. */
  cuts(doc: Pick<ProjectDoc, 'building' | 'levels' | 'connectors'>, levelId: string, limits: RuleLimits): readonly Polygon[] {
    if (!Object.keys(doc.connectors).length) return NO_CUTS;
    const key = [doc.building, doc.levels, limits];
    let entry = this.openings.get(doc.connectors);
    if (!entry || entry.key.some((k, i) => k !== key[i])) {
      entry = { key, byLevel: new Map() };
      this.openings.set(doc.connectors, entry);
    }
    let cuts = entry.byLevel.get(levelId);
    if (!cuts) {
      const found = connectorCuts(doc, levelId, limits);
      cuts = found.length ? found : NO_CUTS;
      entry.byLevel.set(levelId, cuts);
    }
    return cuts;
  }

  /** The joined walls of a level's entities, leaving out `exclude` (hidden layers, a drag preview's walls). */
  walls(entities: Record<string, Entity>, exclude?: ReadonlySet<string>): LevelWalls {
    const key = exclude && exclude.size ? [...exclude].sort().join(',') : '';
    let byKey = this.levels.get(entities);
    if (!byKey) {
      byKey = new Map();
      this.levels.set(entities, byKey);
    }
    let walls = byKey.get(key);
    if (!walls) {
      const list: Wall[] = [];
      const openings: Opening[] = [];
      for (const id in entities) {
        const e = entities[id];
        if (e.type === 'wall') list.push(e);
        else if (e.type === 'opening') openings.push(e);
      }
      walls = deriveWalls(list, { exclude, openings, bodyOf: this.bodyOf });
      byKey.set(key, walls);
    }
    return walls;
  }
}
