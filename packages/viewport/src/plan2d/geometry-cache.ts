import { deriveRooms, deriveWalls, wallBody, type Entity, type LevelGeometry, type LevelWalls, type Opening, type Wall, type WallBody } from '@studio/core';

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

  readonly bodyOf = (wall: Wall): WallBody => {
    let body = this.bodies.get(wall);
    if (!body) {
      body = wallBody(wall);
      this.bodies.set(wall, body);
    }
    return body;
  };

  /** Everything a level's entities derive to (all walls, hidden or not: hiding is a view choice and rooms stay enclosed). */
  level(entities: Record<string, Entity>): LevelGeometry {
    let g = this.whole.get(entities);
    if (!g) {
      const walls = this.walls(entities);
      g = { walls, ...deriveRooms(entities, walls) };
      this.whole.set(entities, g);
    }
    return g;
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
