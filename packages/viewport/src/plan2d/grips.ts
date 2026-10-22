import { DEG, add, connectorPath, itemModel, itemSize, type Asset, cornerFrame, cornerGripPoint, dimensionGeometry, distance, openingFrame, pathOfEntity, rawSegments, resolveDimension, scale, segmentPoint, type Connector, type Entity, type Path, type Vec2, type WhichPath } from '@studio/core';

/** A handle on a selected entity: a vertex of its path, the middle of a segment, a corner's size, a door's hinge or swing side, an item's turn. */
export interface Grip {
  kind: 'vertex' | 'mid' | 'corner' | 'hinge' | 'side' | 'rotate';
  which: WhichPath;
  index: number;
  at: Vec2;
}

/** How far in front of an item its turning grip sits, mm. */
export const ROTATE_GRIP_MM = 250;

/** A vertex of an entity's path, as the inspector edits it. */
export interface VertexRef {
  id: string;
  which: WhichPath;
  index: number;
}

/** The grips of an entity: every vertex and segment middle of its outline (and of a region's holes), a grip on each rounded or chamfered corner; a door's hinge and swing side; a dimension's points (0: from, 1: to, 2: an angle's corner) and its line. */
export function gripsOf(entity: Entity, entities?: Record<string, Entity>, assets: Readonly<Record<string, Asset>> = {}): Grip[] {
  const grips: Grip[] = [];
  if (entity.type === 'item') {
    // One grip in front of the item (its model's −y side): drag it round to turn the item.
    const d = itemSize(entity, itemModel(entity.asset, assets))[1];
    const r = entity.rotation[2] * DEG;
    const reach = d / 2 + ROTATE_GRIP_MM;
    return [{ kind: 'rotate', which: 'outer', index: 0, at: [entity.at[0] + Math.sin(r) * reach, entity.at[1] - Math.cos(r) * reach] }];
  }
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
  if (entity.type === 'dimension') {
    const points = resolveDimension(entity, entities ?? {});
    grips.push({ kind: 'vertex', which: 'outer', index: 0, at: points.from }, { kind: 'vertex', which: 'outer', index: 1, at: points.to });
    if (entity.kind === 'angular' && points.vertex) grips.push({ kind: 'vertex', which: 'outer', index: 2, at: points.vertex });
    if (entity.kind !== 'radius') grips.push({ kind: 'mid', which: 'outer', index: 0, at: dimensionGeometry(entity, points, null).textAt });
    return grips;
  }
  const paths: WhichPath[] = ['outer'];
  if (entity.type !== 'wall') {
    const region = entity.type === 'column' ? (entity.shape.k === 'region' ? entity.shape.region : null) : entity.type === 'slab' ? (entity.source.k === 'region' ? entity.source.region : null) : entity.type === 'void' || entity.type === 'shaft' ? entity.region : entity.type === 'room' && entity.boundary.k === 'region' ? entity.boundary.region : null;
    region?.holes.forEach((_, i) => paths.push({ hole: i }));
  }
  for (const which of paths) {
    const path = pathOfEntity(entity, which);
    if (path) pathGrips(path, which, grips);
  }
  return grips;
}

/** The grips of a connector: the vertices, segment middles and sized corners of a stair's or ramp's axis. Elevators, ladders and escalators have none: they are moved whole. */
export function gripsOfConnector(connector: Connector): Grip[] {
  const path = connectorPath(connector);
  return path ? pathGrips(path, 'outer', []) : [];
}

function pathGrips(path: Path, which: WhichPath, grips: Grip[]): Grip[] {
  path.v.forEach((v, index) => grips.push({ kind: 'vertex', which, index, at: v.p }));
  rawSegments(path).forEach((s, index) => grips.push({ kind: 'mid', which, index, at: segmentPoint(s, 0.5) }));
  path.v.forEach((v, index) => {
    if (!v.c) return;
    const frame = cornerFrame(path, index);
    if (frame) grips.push({ kind: 'corner', which, index, at: cornerGripPoint(frame, v.c) });
  });
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
