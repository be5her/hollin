import { add, distance, openingFrame, pathOfEntity, rawSegments, scale, segmentPoint, type Entity, type Vec2, type WhichPath } from '@studio/core';

/** A handle on a selected entity: a vertex of its path, or the middle of a segment. */
export interface Grip {
  kind: 'vertex' | 'mid' | 'hinge' | 'side';
  which: WhichPath;
  index: number;
  at: Vec2;
}

/** A vertex of an entity's path, as the inspector edits it. */
export interface VertexRef {
  id: string;
  which: WhichPath;
  index: number;
}

/** The grips of an entity: every vertex and segment middle of its outline (and of a region's holes); a door's hinge and swing side. */
export function gripsOf(entity: Entity, entities?: Record<string, Entity>): Grip[] {
  const grips: Grip[] = [];
  if (entity.type === 'opening') {
    const wall = entities?.[entity.wallId];
    if (entity.kind !== 'door' || !wall || wall.type !== 'wall') return grips;
    const f = openingFrame(wall, entity);
    const hinge = entity.swing?.hinge === 'end' ? f.jambs[1] : f.jambs[0];
    const side = entity.swing?.side === 'right' ? -1 : 1;
    grips.push({ kind: 'hinge', which: 'outer', index: 0, at: hinge });
    grips.push({ kind: 'side', which: 'outer', index: 1, at: add(hinge, scale(f.normal, side * entity.width * 0.6)) });
    return grips;
  }
  const paths: WhichPath[] = ['outer'];
  if (entity.type !== 'wall') {
    const region = entity.type === 'column' ? (entity.shape.k === 'region' ? entity.shape.region : null) : entity.type === 'slab' ? (entity.source.k === 'region' ? entity.source.region : null) : entity.type === 'void' || entity.type === 'shaft' ? entity.region : entity.type === 'room' && entity.boundary.k === 'region' ? entity.boundary.region : null;
    region?.holes.forEach((_, i) => paths.push({ hole: i }));
  }
  for (const which of paths) {
    const path = pathOfEntity(entity, which);
    if (!path) continue;
    path.v.forEach((v, index) => grips.push({ kind: 'vertex', which, index, at: v.p }));
    rawSegments(path).forEach((s, index) => grips.push({ kind: 'mid', which, index, at: segmentPoint(s, 0.5) }));
  }
  return grips;
}

/** The grip under a screen point, vertices before middles. */
export function gripAt(grips: readonly Grip[], screen: Vec2, toScreen: (p: Vec2) => Vec2, radiusPx = 7): Grip | null {
  let best: Grip | null = null;
  let bestD = Infinity;
  for (const g of grips) {
    const d = distance(toScreen(g.at), screen);
    if (d > radiusPx) continue;
    const rank = d + (g.kind === 'vertex' ? 0 : radiusPx);
    if (rank < bestD) {
      bestD = rank;
      best = g;
    }
  }
  return best;
}

export const sameVertex = (a: VertexRef | null, b: VertexRef | null): boolean => a === b || (a !== null && b !== null && a.id === b.id && a.index === b.index && JSON.stringify(a.which) === JSON.stringify(b.which));
