import { StudioError } from '../errors';
import { newId } from '../ids';
import { DEFAULT_LEVEL_HEIGHT, DEFAULT_SLAB_THICKNESS, LAYER_NAMES, defaultLayers } from './defaults';
import { deriveLevels, elevationChange } from './derive';
import type { Op } from './ops';
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
}

export function updateLevelOps(doc: ProjectDoc, levelId: string, input: UpdateLevelInput): Op[] {
  const level = requireLevel(doc, levelId);
  const ops: Op[] = [];
  const set: Record<string, unknown> = {};
  if (input.name !== undefined) set['name'] = input.name;
  if (input.slabThickness !== undefined) set['slabThickness'] = input.slabThickness;
  if (input.height !== undefined) set['place'] = { ...level.place, height: input.height };
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
 * become single-level. If it was the ground level, the next level up becomes ground at its own elevation.
 */
export function removeLevelOps(doc: ProjectDoc, levelId: string): Op[] {
  const level = requireLevel(doc, levelId);
  const { stack, groundLevelId } = doc.building;
  const hosted = Object.values(doc.levels).filter((l) => l.place.k === 'offset' && l.place.hostLevelId === levelId);
  if (hosted.length) fail('CONFLICT', `Remove or re-host ${hosted.map((l) => `"${l.name}"`).join(', ')} first: ${hosted.length === 1 ? 'it is' : 'they are'} placed from this level.`);
  if (stack.length === 1 && stack[0] === levelId) fail('CONFLICT', 'A building needs at least one level.');
  const ops: Op[] = [];
  for (const e of Object.values(doc.levelData[levelId]?.entities ?? {})) ops.push({ t: 'del', c: 'entity', id: e.id, lv: levelId });
  // Things on other levels that run up to this one stop at their own level.
  for (const [lv, data] of Object.entries(doc.levelData)) {
    if (lv === levelId) continue;
    for (const e of Object.values(data.entities)) if ('span' in e && e.span?.topLevelId === levelId) ops.push({ t: 'upd', c: 'entity', id: e.id, lv, unset: ['span'] });
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
      const derived = deriveLevels(doc);
      const replacement = stack[index + 1] ?? stack[index - 1];
      set['groundLevelId'] = replacement;
      set['datum'] = derived.find((l) => l.id === replacement)!.elevation - (index + 1 < stack.length ? level.place.height : 0);
    }
    ops.push({ t: 'upd', c: 'building', id: 'building', set });
  }
  ops.push({ t: 'del', c: 'level', id: levelId });
  return ops;
}

/**
 * Copies a level (its layers and entities, with new ids) and stacks the copy right above it.
 * References inside the copy point at the copies; references outside stay. Spanning entities become
 * single-level copies; connectors are not copied.
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
    delete copy.span;
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

/** Deletes entities; openings in a deleted wall go with it. */
export function deleteEntitiesOps(doc: ProjectDoc, ids: readonly string[]): Op[] {
  const doomed = new Set<string>();
  for (const id of ids) {
    const entity = requireEntity(doc, id);
    doomed.add(entity.id);
    if (entity.type === 'wall') for (const e of Object.values(doc.levelData[entity.levelId].entities)) if (e.type === 'opening' && e.wallId === entity.id) doomed.add(e.id);
  }
  return [...doomed].map((id) => ({ t: 'del', c: 'entity', id, lv: findEntity(doc, id)!.levelId }) as Op);
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
