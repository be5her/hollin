import { StudioError } from '../errors';
import { newId } from '../ids';
import { DEFAULT_LEVEL_HEIGHT, DEFAULT_SLAB_THICKNESS, LAYER_NAMES, defaultLayers } from './defaults';
import { deriveLevels, elevationChange } from './derive';
import type { Op } from './ops';
import { pruneAnchors, resolveDimension, untiedFields } from '../geometry/dimensions';
import { remapRefs } from './refs';
import { CONNECTOR_PREFIX, ENTITY_LAYER, ENTITY_PREFIX, LAYER_KINDS, type Connector, type Entity, type Layer, type LayerKind, type Level, type ProjectDoc } from './schema';

const fail = (code: 'NOT_FOUND' | 'CONFLICT' | 'INVALID_INPUT', message: string): never => {
  throw new StudioError(code, message);
};

export function requireLevel(doc: ProjectDoc, id: string): Level {
  return doc.levels[id] ?? fail('NOT_FOUND', `No level ${id}`);
}

export function findEntity(doc: ProjectDoc, id: string): Entity | undefined {
  for (const data of Object.values(doc.levelData)) if (data.entities[id]) return data.entities[id];
  return undefined;
}

export function requireEntity(doc: ProjectDoc, id: string): Entity {
  return findEntity(doc, id) ?? fail('NOT_FOUND', `No entity ${id}`);
}

const layersOf = (doc: ProjectDoc, levelId: string) => Object.values(doc.layers).filter((l) => l.levelId === levelId).sort((a, b) => a.order - b.order);

// ---------- levels ----------

export type LevelPosition = { above: string } | { below: string } | 'top' | 'bottom';

export interface AddLevelInput {
  name?: string;
  height?: number;
  slabThickness?: number;
  /** Where in the stack; default the top. */
  position?: LevelPosition;
  /** Place it at an offset from a stacked level instead (a mezzanine or split level). */
  offsetFrom?: { levelId: string; offset: number };
}

function defaultLevelName(doc: ProjectDoc, basement: boolean): string {
  const names = new Set(Object.values(doc.levels).map((l) => l.name.toLowerCase()));
  for (let n = 1; ; n++) {
    const name = basement ? `Basement ${n}` : `Level ${n}`;
    if (!names.has(name.toLowerCase())) return name;
  }
}

function stackIndexFor(doc: ProjectDoc, position: LevelPosition = 'top'): number {
  const { stack } = doc.building;
  if (position === 'top') return stack.length;
  if (position === 'bottom') return 0;
  if ('above' in position) {
    const i = stack.indexOf(position.above);
    if (i < 0) fail('NOT_FOUND', `No stacked level ${position.above}`);
    return i + 1;
  }
  const i = stack.indexOf(position.below);
  if (i < 0) fail('NOT_FOUND', `No stacked level ${position.below}`);
  return i;
}

/** A new level with its three layers, stacked at `position` (levels above it move up) or offset from a host. */
export function addLevelOps(doc: ProjectDoc, input: AddLevelInput = {}): { ops: Op[]; levelId: string } {
  const id = newId('lvl');
  const height = input.height ?? DEFAULT_LEVEL_HEIGHT;
  const slabThickness = input.slabThickness ?? DEFAULT_SLAB_THICKNESS;
  const ops: Op[] = [];
  if (input.offsetFrom) {
    requireLevel(doc, input.offsetFrom.levelId);
    if (!doc.building.stack.includes(input.offsetFrom.levelId)) fail('INVALID_INPUT', 'A mezzanine must be placed from a stacked level');
    const name = input.name ?? 'Mezzanine';
    ops.push({ t: 'ins', c: 'level', id, v: { id, name, slabThickness, place: { k: 'offset', hostLevelId: input.offsetFrom.levelId, offset: input.offsetFrom.offset, height } } });
  } else {
    const index = stackIndexFor(doc, input.position);
    const basement = index <= doc.building.stack.indexOf(doc.building.groundLevelId);
    const name = input.name ?? defaultLevelName(doc, basement);
    const stack = [...doc.building.stack];
    stack.splice(index, 0, id);
    ops.push({ t: 'ins', c: 'level', id, v: { id, name, slabThickness, place: { k: 'stack', height } } });
    ops.push({ t: 'upd', c: 'building', id: 'building', set: { stack } });
  }
  for (const layer of defaultLayers(id)) ops.push({ t: 'ins', c: 'layer', id: layer.id, v: layer });
  return { ops, levelId: id };
}

export interface UpdateLevelInput {
  name?: string;
  height?: number;
  slabThickness?: number;
  /** Puts the level at this elevation (see `elevationChange` for which value changes). */
  elevation?: number;
  /** Makes this stacked level the ground level, keeping every elevation. */
  ground?: boolean;
  /** Places a mezzanine from another stacked level, keeping its elevation when that lies within the new host (otherwise on the host's floor). */
  hostLevelId?: string;
}

export function updateLevelOps(doc: ProjectDoc, levelId: string, input: UpdateLevelInput): Op[] {
  const level = requireLevel(doc, levelId);
  const ops: Op[] = [];
  const set: Record<string, unknown> = {};
  if (input.name !== undefined) set['name'] = input.name;
  if (input.slabThickness !== undefined) set['slabThickness'] = input.slabThickness;
  if (input.height !== undefined) set['place'] = { ...level.place, height: input.height };
  if (input.hostLevelId !== undefined && !(level.place.k === 'offset' && level.place.hostLevelId === input.hostLevelId)) {
    if (level.place.k !== 'offset') fail('INVALID_INPUT', 'Only a mezzanine can change its host; reorder stacked levels instead');
    requireLevel(doc, input.hostLevelId);
    if (!doc.building.stack.includes(input.hostLevelId)) fail('INVALID_INPUT', 'A mezzanine must be placed from a stacked level');
    const derived = deriveLevels(doc);
    const elevation = derived.find((l) => l.id === levelId)!.elevation;
    const host = derived.find((l) => l.id === input.hostLevelId)!;
    const offset = elevation >= host.elevation && elevation < host.top ? elevation - host.elevation : 0;
    const place = (set['place'] as Level['place'] | undefined) ?? level.place;
    set['place'] = { ...place, hostLevelId: input.hostLevelId, offset };
  }
  if (Object.keys(set).length) ops.push({ t: 'upd', c: 'level', id: levelId, set });
  if (input.ground) {
    if (!doc.building.stack.includes(levelId)) fail('INVALID_INPUT', 'Only a stacked level can be the ground level');
    const elevation = deriveLevels(doc).find((l) => l.id === levelId)!.elevation;
    ops.push({ t: 'upd', c: 'building', id: 'building', set: { groundLevelId: levelId, datum: elevation } });
  }
  if (input.elevation !== undefined) {
    // Elevation is worked out against the document with the other changes applied.
    const after: ProjectDoc = {
      ...doc,
      levels: { ...doc.levels, [levelId]: { ...level, ...(set as Partial<Level>) } },
      building: input.ground ? { ...doc.building, groundLevelId: levelId, datum: deriveLevels(doc).find((l) => l.id === levelId)!.elevation } : doc.building,
    };
    const change = elevationChange(after, levelId, input.elevation);
    if (change.kind === 'datum') ops.push({ t: 'upd', c: 'building', id: 'building', set: { datum: change.datum } });
    else {
      const target = after.levels[change.levelId];
      const place = change.kind === 'height' ? { ...target.place, height: change.height } : { ...target.place, offset: change.offset };
      ops.push({ t: 'upd', c: 'level', id: change.levelId, set: { place } });
    }
  }
  return ops;
}

/** Moves a stacked level to another place in the stack; elevations follow. */
export function moveLevelOps(doc: ProjectDoc, levelId: string, toIndex: number): Op[] {
  requireLevel(doc, levelId);
  const stack = doc.building.stack.filter((id) => id !== levelId);
  if (stack.length === doc.building.stack.length) fail('INVALID_INPUT', 'Only stacked levels can be reordered; move a mezzanine by changing its host or offset');
  stack.splice(Math.max(0, Math.min(toIndex, stack.length)), 0, levelId);
  return [{ t: 'upd', c: 'building', id: 'building', set: { stack } }];
}

/**
 * Removes a level with its layers and entities. Levels above drop by its height (or basements below
 * rise). Connectors that end on it are removed; elevators lose that stop; things spanning up to it
 * become single-level (a shaft, whose span is required, ends at its own level's ceiling). If it was the ground level, the next level up becomes ground at its own elevation.
 */
export function removeLevelOps(doc: ProjectDoc, levelId: string): Op[] {
  const level = requireLevel(doc, levelId);
  const { stack, groundLevelId } = doc.building;
  const hosted = Object.values(doc.levels).filter((l) => l.place.k === 'offset' && l.place.hostLevelId === levelId);
  if (hosted.length) fail('CONFLICT', `Remove or re-host ${hosted.map((l) => `"${l.name}"`).join(', ')} first: ${hosted.length === 1 ? 'it is' : 'they are'} placed from this level.`);
  if (stack.length === 1 && stack[0] === levelId) fail('CONFLICT', 'A building needs at least one level.');
  const ops: Op[] = [];
  for (const e of Object.values(doc.levelData[levelId]?.entities ?? {})) ops.push({ t: 'del', c: 'entity', id: e.id, lv: levelId });
  // Things on other levels that run up to this one stop at their own level (a shaft, whose span is required, at its own ceiling).
  const derived = deriveLevels(doc);
  for (const [lv, data] of Object.entries(doc.levelData)) {
    if (lv === levelId) continue;
    for (const e of Object.values(data.entities)) {
      if (!('span' in e) || e.span?.topLevelId !== levelId) continue;
      if (e.type === 'shaft') ops.push({ t: 'upd', c: 'entity', id: e.id, lv, set: { span: ownLevelSpan(e.span, lv, derived.find((l) => l.id === lv)?.height ?? 0) } });
      else ops.push({ t: 'upd', c: 'entity', id: e.id, lv, unset: ['span'] });
    }
  }
  for (const c of Object.values(doc.connectors)) {
    if (c.kind === 'elevator') {
      const stops = c.stops.filter((s) => s.levelId !== levelId);
      if (stops.length === c.stops.length) continue;
      ops.push(stops.length >= 2 ? { t: 'upd', c: 'connector', id: c.id, set: { stops } } : { t: 'del', c: 'connector', id: c.id });
    } else if (c.bottom.levelId === levelId || c.top.levelId === levelId) ops.push({ t: 'del', c: 'connector', id: c.id });
  }
  for (const layer of layersOf(doc, levelId)) ops.push({ t: 'del', c: 'layer', id: layer.id });
  if (level.place.k === 'stack') {
    const index = stack.indexOf(levelId);
    const nextStack = stack.filter((id) => id !== levelId);
    const set: Record<string, unknown> = { stack: nextStack };
    if (groundLevelId === levelId) {
      const replacement = stack[index + 1] ?? stack[index - 1];
      set['groundLevelId'] = replacement;
      set['datum'] = derived.find((l) => l.id === replacement)!.elevation - (index + 1 < stack.length ? level.place.height : 0);
    }
    ops.push({ t: 'upd', c: 'building', id: 'building', set });
  }
  ops.push({ t: 'del', c: 'level', id: levelId });
  return ops;
}

/** A span that ends at the ceiling of the entity's own level: what single-level means for a shaft, whose span is required. */
const ownLevelSpan = (span: { baseOffset: number }, levelId: string, height: number) => ({ topLevelId: levelId, baseOffset: span.baseOffset, topOffset: height });

/** What removing a level would do, for a confirmation: the same rules as `removeLevelOps`, grouped. */
export interface LevelRemovalImpact {
  /** Mezzanines placed from it; while there are any, it cannot be removed. */
  blockedBy: { id: string; name: string }[];
  /** Entities on the level, by type. */
  entities: Partial<Record<Entity['type'], number>>;
  /** Entities on other levels that reach up to it and become single-level. */
  spansCut: number;
  /** Connectors removed with it (they start or end on it, or an elevator left with one stop). */
  connectorsRemoved: { id: string; kind: Connector['kind']; name: string | null }[];
  /** Elevators that keep running but no longer stop there. */
  stopsDropped: { id: string; name: string | null }[];
  /** True when it is the only level. */
  last: boolean;
}

export function levelRemovalImpact(doc: ProjectDoc, levelId: string): LevelRemovalImpact {
  requireLevel(doc, levelId);
  const impact: LevelRemovalImpact = { blockedBy: [], entities: {}, spansCut: 0, connectorsRemoved: [], stopsDropped: [], last: doc.building.stack.length === 1 && doc.building.stack[0] === levelId };
  for (const l of Object.values(doc.levels)) if (l.place.k === 'offset' && l.place.hostLevelId === levelId) impact.blockedBy.push({ id: l.id, name: l.name });
  for (const e of Object.values(doc.levelData[levelId]?.entities ?? {})) impact.entities[e.type] = (impact.entities[e.type] ?? 0) + 1;
  for (const [lv, data] of Object.entries(doc.levelData)) {
    if (lv === levelId) continue;
    for (const e of Object.values(data.entities)) if ('span' in e && e.span?.topLevelId === levelId) impact.spansCut++;
  }
  for (const c of Object.values(doc.connectors)) {
    const name = c.name ?? null;
    if (c.kind === 'elevator') {
      const stops = c.stops.filter((s) => s.levelId !== levelId);
      if (stops.length === c.stops.length) continue;
      if (stops.length >= 2) impact.stopsDropped.push({ id: c.id, name });
      else impact.connectorsRemoved.push({ id: c.id, kind: c.kind, name });
    } else if (c.bottom.levelId === levelId || c.top.levelId === levelId) impact.connectorsRemoved.push({ id: c.id, kind: c.kind, name });
  }
  return impact;
}

/**
 * Copies a level (its layers and entities, with new ids) and stacks the copy right above it.
 * References inside the copy point at the copies; references outside stay. Spanning entities become
 * single-level copies (a shaft, whose span is required, reaches the copy's ceiling); connectors are not copied.
 */
export function duplicateLevelOps(doc: ProjectDoc, levelId: string, input: { name?: string } = {}): { ops: Op[]; levelId: string } {
  const source = requireLevel(doc, levelId);
  if (source.place.k !== 'stack') fail('INVALID_INPUT', 'Mezzanines cannot be duplicated yet; add a new one instead');
  const id = newId('lvl');
  const map = new Map<string, string>([[levelId, id]]);
  const layers = layersOf(doc, levelId);
  for (const l of layers) map.set(l.id, newId('lay'));
  const entities = Object.values(doc.levelData[levelId]?.entities ?? {});
  for (const e of entities) map.set(e.id, newId(ENTITY_PREFIX[e.type]));
  const stack = [...doc.building.stack];
  stack.splice(stack.indexOf(levelId) + 1, 0, id);
  const ops: Op[] = [
    { t: 'ins', c: 'level', id, v: { ...source, id, name: input.name ?? `${source.name} copy` } },
    { t: 'upd', c: 'building', id: 'building', set: { stack } },
  ];
  for (const l of layers) {
    const copy = remapRefs('layer', l, map);
    ops.push({ t: 'ins', c: 'layer', id: map.get(l.id)!, v: { ...copy, id: map.get(l.id)! } });
  }
  for (const e of entities) {
    const copy = remapRefs('entity', e, map) as Entity & { span?: unknown };
    if (e.type === 'shaft') copy.span = ownLevelSpan(e.span, id, source.place.height);
    else delete copy.span;
    ops.push({ t: 'ins', c: 'entity', id: map.get(e.id)!, lv: id, v: { ...copy, id: map.get(e.id)! } });
  }
  return { ops, levelId: id };
}

// ---------- layers ----------

export function addLayerOps(doc: ProjectDoc, input: { levelId: string; kind: LayerKind; name?: string }): { ops: Op[]; layerId: string } {
  requireLevel(doc, input.levelId);
  const existing = layersOf(doc, input.levelId);
  const id = newId('lay');
  const sameKind = existing.filter((l) => l.kind === input.kind).length;
  const layer: Layer = {
    id,
    levelId: input.levelId,
    kind: input.kind,
    name: input.name ?? (sameKind ? `${LAYER_NAMES[input.kind]} ${sameKind + 1}` : LAYER_NAMES[input.kind]),
    order: (existing[existing.length - 1]?.order ?? -1) + 1,
    visible: true,
    locked: false,
    opacity: 1,
  };
  return { ops: [{ t: 'ins', c: 'layer', id, v: layer }], layerId: id };
}

/** Removes a layer; its entities go with it when `withEntities`, otherwise a layer that holds anything is refused. */
export function removeLayerOps(doc: ProjectDoc, layerId: string, withEntities = false): Op[] {
  const layer = doc.layers[layerId] ?? fail('NOT_FOUND', `No layer ${layerId}`);
  const held = Object.values(doc.levelData[layer.levelId]?.entities ?? {}).filter((e) => e.layerId === layerId);
  if (held.length && !withEntities) fail('CONFLICT', `Layer "${layer.name}" holds ${held.length} item${held.length === 1 ? '' : 's'}; move them or remove them with the layer.`);
  return [...deleteEntitiesOps(doc, held.map((e) => e.id)), { t: 'del', c: 'layer', id: layerId }];
}

/** Reorders a level's layers: the layer ends up at `toIndex`. */
export function moveLayerOps(doc: ProjectDoc, layerId: string, toIndex: number): Op[] {
  const layer = doc.layers[layerId] ?? fail('NOT_FOUND', `No layer ${layerId}`);
  const ordered = layersOf(doc, layer.levelId).filter((l) => l.id !== layerId);
  ordered.splice(Math.max(0, Math.min(toIndex, ordered.length)), 0, layer);
  return ordered.flatMap((l, order) => (l.order === order ? [] : [{ t: 'upd', c: 'layer', id: l.id, set: { order } } as Op]));
}

/**
 * Keeps the dimensions tied to changed walls and shapes in step: each tied end's stored point becomes
 * the point the tie resolves to now, so that the dimension stays where it was shown if the tie ever
 * stops resolving (a face that gains vertices at a bevelled corner). Run on every edit before it commits.
 */
export function followTiesOps(doc: ProjectDoc, changed: readonly { id: string; lv: string }[]): Op[] {
  const byLevel = new Map<string, Set<string>>();
  for (const { id, lv } of changed) {
    const e = doc.levelData[lv]?.entities[id];
    if (e?.type !== 'wall' && e?.type !== 'shape') continue;
    const ids = byLevel.get(lv) ?? new Set<string>();
    ids.add(id);
    byLevel.set(lv, ids);
  }
  const ops: Op[] = [];
  for (const [lv, ids] of byLevel) {
    const entities = doc.levelData[lv].entities;
    for (const e of Object.values(entities)) {
      if (e.type !== 'dimension' || !e.anchors) continue;
      const ends = (['from', 'to'] as const).filter((end) => e.anchors?.[end] && ids.has(e.anchors[end]!.entityId));
      if (!ends.length) continue;
      const points = resolveDimension(e, entities);
      const set: Record<string, unknown> = {};
      for (const end of ends) if (Math.abs(points[end][0] - e[end][0]) > 1e-6 || Math.abs(points[end][1] - e[end][1]) > 1e-6) set[end] = points[end];
      if (Object.keys(set).length) ops.push({ t: 'upd', c: 'entity', id: e.id, lv, set });
    }
  }
  return ops;
}

// ---------- entities ----------

/** The first layer of the right kind on a level, for an entity that does not name one. */
export function defaultLayerFor(doc: ProjectDoc, levelId: string, type: Entity['type']): string {
  const kind = ENTITY_LAYER[type];
  const layers = layersOf(doc, levelId);
  const layer = kind === 'any' ? (layers.find((l) => l.kind === 'interior') ?? layers[0]) : layers.find((l) => l.kind === kind);
  return layer?.id ?? fail('CONFLICT', `Level ${levelId} has no ${kind === 'any' ? '' : `${kind} `}layer`);
}

export type NewEntity = { type: Entity['type'] } & Record<string, unknown>;

export function addEntityOps(doc: ProjectDoc, input: { levelId: string; layerId?: string; entity: NewEntity }): { ops: Op[]; id: string } {
  requireLevel(doc, input.levelId);
  const type = input.entity.type;
  if (!(type in ENTITY_PREFIX)) fail('INVALID_INPUT', `Unknown entity type "${type}"`);
  const id = newId(ENTITY_PREFIX[type]);
  const layerId = input.layerId ?? defaultLayerFor(doc, input.levelId, type);
  const { id: _ignored, levelId: _lv, layerId: _layer, ...fields } = input.entity as Record<string, unknown>;
  return { ops: [{ t: 'ins', c: 'entity', id, lv: input.levelId, v: { ...fields, type, id, levelId: input.levelId, layerId } }], id };
}

/** Sets fields of an entity. Its id, type and level cannot change; its layer can, within its level. */
export function updateEntityOps(doc: ProjectDoc, id: string, set: Record<string, unknown>, unset: string[] = []): Op[] {
  const entity = requireEntity(doc, id);
  for (const key of ['id', 'type', 'levelId']) {
    if (key in set && set[key] !== (entity as Record<string, unknown>)[key]) fail('INVALID_INPUT', `${key} cannot change; remove the entity and add a new one instead`);
  }
  if (unset.some((k) => ['id', 'type', 'levelId', 'layerId'].includes(k))) fail('INVALID_INPUT', 'id, type, levelId and layerId cannot be removed');
  return [{ t: 'upd', c: 'entity', id, lv: entity.levelId, set, ...(unset.length ? { unset } : {}) }];
}

/** Deletes entities; openings in a deleted wall go with it, and dimensions tied to a deleted wall or shape are untied (they keep their points). */
export function deleteEntitiesOps(doc: ProjectDoc, ids: readonly string[]): Op[] {
  const doomed = new Set<string>();
  const levels = new Set<string>();
  for (const id of ids) {
    const entity = requireEntity(doc, id);
    doomed.add(entity.id);
    levels.add(entity.levelId);
    if (entity.type === 'wall') for (const e of Object.values(doc.levelData[entity.levelId].entities)) if (e.type === 'opening' && e.wallId === entity.id) doomed.add(e.id);
  }
  const ops: Op[] = [];
  for (const lv of levels) {
    for (const e of Object.values(doc.levelData[lv].entities)) {
      if (e.type !== 'dimension' || doomed.has(e.id)) continue;
      const anchors = pruneAnchors(e, (target) => !doomed.has(target));
      if (anchors === undefined) continue;
      const { set, unset } = untiedFields(e, resolveDimension(e, doc.levelData[lv].entities), anchors);
      ops.push(...updateEntityOps(doc, e.id, set, unset));
    }
  }
  for (const id of doomed) ops.push({ t: 'del', c: 'entity', id, lv: findEntity(doc, id)!.levelId });
  return ops;
}

// ---------- connectors ----------

export type NewConnector = { kind: Connector['kind'] } & Record<string, unknown>;

export function addConnectorOps(input: NewConnector): { ops: Op[]; id: string } {
  if (!(input.kind in CONNECTOR_PREFIX)) fail('INVALID_INPUT', `Unknown connector kind "${input.kind}"`);
  const id = newId(CONNECTOR_PREFIX[input.kind]);
  const { id: _ignored, ...fields } = input;
  return { ops: [{ t: 'ins', c: 'connector', id, v: { ...fields, id } }], id };
}

export function updateConnectorOps(doc: ProjectDoc, id: string, set: Record<string, unknown>): Op[] {
  const connector = doc.connectors[id] ?? fail('NOT_FOUND', `No connector ${id}`);
  if ('kind' in set && set['kind'] !== connector.kind) fail('INVALID_INPUT', 'The kind of a connector cannot change; remove it and add a new one');
  if ('id' in set && set['id'] !== id) fail('INVALID_INPUT', 'The id cannot change');
  return [{ t: 'upd', c: 'connector', id, set }];
}

export function removeConnectorOps(doc: ProjectDoc, id: string): Op[] {
  if (!doc.connectors[id]) fail('NOT_FOUND', `No connector ${id}`);
  return [{ t: 'del', c: 'connector', id }];
}

/** Every layer kind present on a level, for checks. */
export function layerKindsOf(doc: ProjectDoc, levelId: string): Set<LayerKind> {
  return new Set(layersOf(doc, levelId).map((l) => l.kind).filter((k): k is LayerKind => (LAYER_KINDS as readonly string[]).includes(k)));
}
