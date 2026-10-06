import type { z } from 'zod';
import { StudioError } from '../errors';
import { deriveLevels } from './derive';
import { refsOf, type Coll } from './refs';
import { BuildingSchema, ConnectorSchema, ENTITY_LAYER, EntitySchema, LayerSchema, LevelSchema, ProjectMetaSchema, type Entity, type ProjectDoc } from './schema';

export type { Coll } from './refs';

/**
 * One change to one record. Entity ops carry the level the entity lives on (`lv`). `upd` replaces the
 * listed top-level fields (`set`) and removes others (`unset`); nested values are replaced whole.
 * Clients never send ops: commands build them from the current document inside main.
 */
export type Op =
  | { t: 'ins'; c: Coll; id: string; lv?: string; v: unknown }
  | { t: 'upd'; c: Coll; id: string; lv?: string; set?: Record<string, unknown>; unset?: string[] }
  | { t: 'del'; c: Coll; id: string; lv?: string };

/** The value of each record a change touched, before or after it. `undefined` means absent. */
export type RecordMap = Map<string, { c: Coll; id: string; lv?: string; value: unknown }>;

const keyOf = (c: Coll, id: string) => `${c}:${id}`;

const SCHEMAS: Record<Coll, z.ZodType> = {
  meta: ProjectMetaSchema,
  building: BuildingSchema,
  level: LevelSchema,
  layer: LayerSchema,
  connector: ConnectorSchema,
  entity: EntitySchema,
};

const COLLECTION = { level: 'levels', layer: 'layers', connector: 'connectors' } as const;

/** A document under change: containers are copied the first time they are written, records are replaced, never mutated. */
class Draft {
  readonly doc: ProjectDoc;
  private readonly copied = new Set<string>();

  constructor(base: ProjectDoc) {
    this.doc = { ...base };
  }

  get(c: Coll, id: string, lv?: string): unknown {
    switch (c) {
      case 'meta':
        return this.doc.meta;
      case 'building':
        return this.doc.building;
      case 'entity':
        return lv ? this.doc.levelData[lv]?.entities[id] : undefined;
      default:
        return this.doc[COLLECTION[c]][id];
    }
  }

  set(c: Coll, id: string, value: unknown, lv?: string): void {
    const doc = this.doc as Record<string, unknown>;
    if (c === 'meta' || c === 'building') {
      doc[c] = value;
      return;
    }
    if (c === 'entity') {
      if (!lv) throw new StudioError('INVALID_INPUT', `Entity ${id} has no level`);
      if (!this.copied.has('levelData')) {
        this.doc.levelData = { ...this.doc.levelData };
        this.copied.add('levelData');
      }
      const level = this.doc.levelData[lv];
      if (!level) throw new StudioError('NOT_FOUND', `No level ${lv}`);
      if (!this.copied.has(`levelData:${lv}`)) {
        this.doc.levelData[lv] = { entities: { ...level.entities } };
        this.copied.add(`levelData:${lv}`);
      }
      const entities = this.doc.levelData[lv].entities;
      if (value === undefined) delete entities[id];
      else entities[id] = value as Entity;
      return;
    }
    const name = COLLECTION[c];
    if (!this.copied.has(name)) {
      doc[name] = { ...(doc[name] as Record<string, unknown>) };
      this.copied.add(name);
    }
    const records = doc[name] as Record<string, unknown>;
    if (value === undefined) delete records[id];
    else records[id] = value;
  }

  /** Levels own an entity container; it comes and goes with them. */
  levelContainer(id: string, present: boolean): void {
    if (!this.copied.has('levelData')) {
      this.doc.levelData = { ...this.doc.levelData };
      this.copied.add('levelData');
    }
    if (present) this.doc.levelData[id] ??= { entities: {} };
    else delete this.doc.levelData[id];
  }
}

function describe(c: Coll, id: string): string {
  return c === 'meta' || c === 'building' ? c : `${c} ${id}`;
}

/** Applies one op. Strict mode refuses ops that do not fit the current state (used for edits); the mirror is lenient. */
function applyOp(draft: Draft, op: Op, strict: boolean): void {
  const current = draft.get(op.c, op.id, op.lv);
  if ((op.c === 'meta' || op.c === 'building') && op.t !== 'upd') throw new StudioError('INVALID_INPUT', `${op.c} can only be updated`);
  if (op.t === 'ins') {
    if (strict && current !== undefined) throw new StudioError('CONFLICT', `${describe(op.c, op.id)} already exists`);
    if (op.c === 'entity' && strict && (op.v as Entity)?.levelId !== op.lv) throw new StudioError('INVALID_INPUT', `Entity ${op.id} must be added to its own level`);
    if (op.c === 'level') draft.levelContainer(op.id, true);
    draft.set(op.c, op.id, { ...(op.v as object), id: op.id }, op.lv);
    if (op.c === 'meta' || op.c === 'building') return;
    return;
  }
  if (current === undefined) {
    if (strict) throw new StudioError('NOT_FOUND', `No ${describe(op.c, op.id)}`);
    return;
  }
  if (op.t === 'upd') {
    const next: Record<string, unknown> = { ...(current as object), ...(op.set ?? {}) };
    for (const key of op.unset ?? []) delete next[key];
    if (strict && op.c !== 'meta' && op.c !== 'building' && next['id'] !== op.id) throw new StudioError('INVALID_INPUT', `The id of ${describe(op.c, op.id)} cannot change`);
    if (strict && op.c === 'entity' && next['levelId'] !== op.lv) throw new StudioError('INVALID_INPUT', `Move entity ${op.id} to another level by removing and re-adding it`);
    draft.set(op.c, op.id, next, op.lv);
    return;
  }
  if (op.c === 'level') {
    const entities = draft.doc.levelData[op.id]?.entities ?? {};
    if (strict && Object.keys(entities).length) throw new StudioError('CONFLICT', `Level ${op.id} still has entities; remove them first`);
    draft.levelContainer(op.id, false);
  }
  draft.set(op.c, op.id, undefined, op.lv);
}

/** Applies a patch without checks: the renderer's mirror, which trusts what main already validated. */
export function applyPatch(doc: ProjectDoc, ops: readonly Op[]): ProjectDoc {
  const draft = new Draft(doc);
  for (const op of ops) applyOp(draft, op, false);
  return draft.doc;
}

const ORDER_INSERT: Coll[] = ['meta', 'level', 'layer', 'building', 'connector', 'entity'];
const ORDER_DELETE: Coll[] = ['entity', 'connector', 'layer', 'level'];

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The ops that turn the `from` values of some records into their `to` values, in an order that applies cleanly. */
export function patchOps(from: RecordMap, to: RecordMap): Op[] {
  const dels: Op[] = [];
  const rest: Op[] = [];
  for (const [key, target] of to) {
    const source = from.get(key);
    const before = source?.value;
    const after = target.value;
    const lv = (target.lv ?? source?.lv) as string | undefined;
    const where = lv ? { lv } : {};
    if (before === undefined && after === undefined) continue;
    if (after === undefined) dels.push({ t: 'del', c: target.c, id: target.id, ...where });
    else if (before === undefined) rest.push({ t: 'ins', c: target.c, id: target.id, ...where, v: after });
    else {
      const b = before as Record<string, unknown>;
      const a = after as Record<string, unknown>;
      const set: Record<string, unknown> = {};
      for (const k of Object.keys(a)) if (!sameJson(a[k], b[k])) set[k] = a[k];
      const unset = Object.keys(b).filter((k) => !(k in a));
      if (Object.keys(set).length || unset.length) rest.push({ t: 'upd', c: target.c, id: target.id, ...where, ...(Object.keys(set).length ? { set } : {}), ...(unset.length ? { unset } : {}) });
    }
  }
  dels.sort((x, y) => ORDER_DELETE.indexOf(x.c) - ORDER_DELETE.indexOf(y.c));
  rest.sort((x, y) => ORDER_INSERT.indexOf(x.c) - ORDER_INSERT.indexOf(y.c));
  return [...dels, ...rest];
}

/**
 * A set of changes to a document, applied to a draft and committed all at once or not at all.
 * Commit validates every touched record against its schema (storing the parsed, rounded value) and
 * checks the references between records.
 */
export class Transaction {
  private readonly draft: Draft;
  private readonly touched = new Map<string, { c: Coll; id: string; lv?: string }>();
  private readonly before: RecordMap = new Map();

  constructor(readonly base: ProjectDoc) {
    this.draft = new Draft(base);
  }

  /** The document as changed so far. Read it; never mutate it. */
  get doc(): ProjectDoc {
    return this.draft.doc;
  }

  get changed(): boolean {
    return this.touched.size > 0;
  }

  apply(ops: readonly Op[]): void {
    for (const op of ops) {
      const lv = op.c === 'entity' ? (op.lv ?? (op.t === 'ins' ? (op.v as Entity | undefined)?.levelId : undefined)) : undefined;
      const resolved = lv && op.c === 'entity' ? { ...op, lv } : op;
      const key = keyOf(op.c, op.id);
      if (!this.before.has(key)) this.before.set(key, { c: op.c, id: op.id, lv, value: this.draft.get(op.c, op.id, lv) });
      applyOp(this.draft, resolved, true);
      this.touched.set(key, { c: op.c, id: op.id, lv });
    }
  }

  /** Validates and returns the new document and the before/after values of what changed, or null when nothing did. */
  commit(): { doc: ProjectDoc; before: RecordMap; after: RecordMap } | null {
    const after: RecordMap = new Map();
    for (const [key, t] of this.touched) {
      const value = this.draft.get(t.c, t.id, t.lv);
      if (value === undefined) {
        after.set(key, { ...t, value: undefined });
        continue;
      }
      const parsed = SCHEMAS[t.c].safeParse(value);
      if (!parsed.success) {
        const issues = parsed.error.issues.slice(0, 4).map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`);
        throw new StudioError('INVALID_INPUT', `${describe(t.c, t.id)} is not valid: ${issues.join('; ')}`, issues);
      }
      this.draft.set(t.c, t.id, parsed.data, t.lv);
      after.set(key, { ...t, value: parsed.data });
    }
    checkIntegrity(this.draft.doc, this.touched);
    // Drop records that ended where they started.
    for (const [key, a] of after) {
      if (sameJson(a.value, this.before.get(key)?.value)) {
        after.delete(key);
      }
    }
    if (!after.size) return null;
    const before: RecordMap = new Map([...after.keys()].map((k) => [k, this.before.get(k)!]));
    return { doc: this.draft.doc, before, after };
  }
}

function entityById(doc: ProjectDoc, id: string): Entity | undefined {
  for (const level of Object.values(doc.levelData)) if (level.entities[id]) return level.entities[id];
  return undefined;
}

/** Hard rules between records. Broken ones reject the whole change. */
function checkIntegrity(doc: ProjectDoc, touched: Map<string, { c: Coll; id: string; lv?: string }>): void {
  const fail = (message: string) => {
    throw new StudioError('CONFLICT', message);
  };
  const exists = (target: 'level' | 'layer' | 'entity', id: string) => (target === 'level' ? Boolean(doc.levels[id]) : target === 'layer' ? Boolean(doc.layers[id]) : Boolean(entityById(doc, id)));
  let structural = false;
  let deleted = false;

  for (const t of touched.values()) {
    const draftValue = t.c === 'entity' ? doc.levelData[t.lv!]?.entities[t.id] : t.c === 'meta' ? doc.meta : t.c === 'building' ? doc.building : doc[COLLECTION[t.c]][t.id];
    if (t.c === 'level' || t.c === 'building') structural = true;
    if (draftValue === undefined) {
      deleted = true;
      continue;
    }
    for (const ref of refsOf(t.c, draftValue)) {
      if (!exists(ref.target, ref.id)) fail(`${describe(t.c, t.id)} refers to a ${ref.target} that does not exist (${ref.path}: ${ref.id})`);
    }
    if (t.c === 'entity') {
      const e = draftValue as Entity;
      const layer = doc.layers[e.layerId];
      if (layer.levelId !== e.levelId) fail(`Entity ${e.id} is on level ${e.levelId} but its layer belongs to another level`);
      const kind = ENTITY_LAYER[e.type];
      if (kind !== 'any' && layer.kind !== kind) fail(`A ${e.type} belongs on a ${kind} layer, not on "${layer.name}" (${layer.kind})`);
      if (e.type === 'opening') {
        const wall = entityById(doc, e.wallId);
        if (wall?.type !== 'wall' || wall.levelId !== e.levelId) fail(`Opening ${e.id} must sit in a wall on its own level`);
      }
      if (e.type === 'dimension' && e.anchors) {
        for (const [end, anchor] of Object.entries(e.anchors)) {
          if (!anchor) continue;
          const target = entityById(doc, anchor.entityId);
          if (!target || (target.type !== 'wall' && target.type !== 'shape') || target.levelId !== e.levelId) fail(`Dimension ${e.id} is tied (${end}) to something that is not a wall or shape on its own level`);
          if (anchor.side !== 'axis' && target?.type !== 'wall') fail(`Dimension ${e.id} is tied (${end}) to a face, which only walls have`);
        }
      }
    }
    if (t.c === 'connector') {
      const c = doc.connectors[t.id];
      const levels = deriveLevels(doc);
      const elevationOf = (id: string) => levels.find((l) => l.id === id)?.elevation ?? 0;
      if ('bottom' in c && 'top' in c && elevationOf(c.top.levelId) + c.top.offset <= elevationOf(c.bottom.levelId) + c.bottom.offset) {
        fail(`The top of ${c.kind} ${c.id} must be above its bottom`);
      }
      if (c.kind === 'elevator' && new Set(c.stops.map((s) => s.levelId)).size !== c.stops.length) fail(`Elevator ${c.id} stops at a level twice`);
    }
    if (t.c === 'layer') {
      const layer = doc.layers[t.id];
      for (const e of Object.values(doc.levelData[layer.levelId]?.entities ?? {})) {
        if (e.layerId === layer.id && ENTITY_LAYER[e.type] !== 'any' && ENTITY_LAYER[e.type] !== layer.kind) fail(`Layer "${layer.name}" holds a ${e.type}, which needs a ${ENTITY_LAYER[e.type]} layer`);
      }
    }
  }

  if (structural) {
    const { stack, groundLevelId } = doc.building;
    if (new Set(stack).size !== stack.length) fail('A level appears twice in the stack');
    if (!stack.includes(groundLevelId)) fail('The ground level must be a stacked level');
    for (const level of Object.values(doc.levels)) {
      const inStack = stack.includes(level.id);
      if (level.place.k === 'stack' && !inStack) fail(`Level "${level.name}" is stacked but not in the stack`);
      if (level.place.k === 'offset') {
        if (inStack) fail(`Level "${level.name}" is placed at an offset and cannot also be in the stack`);
        if (!stack.includes(level.place.hostLevelId)) fail(`Level "${level.name}" must be offset from a stacked level`);
      }
    }
    for (const id of Object.keys(doc.levelData)) if (!doc.levels[id]) fail(`Entities remain on a removed level (${id})`);
  }

  if (deleted) {
    // Nothing may keep pointing at a record that is gone.
    const check = (c: Coll, value: unknown, id: string) => {
      for (const ref of refsOf(c, value)) if (!exists(ref.target, ref.id)) fail(`${describe(c, id)} still refers to ${ref.target} ${ref.id}, which was removed`);
    };
    check('building', doc.building, 'building');
    for (const l of Object.values(doc.levels)) check('level', l, l.id);
    for (const l of Object.values(doc.layers)) check('layer', l, l.id);
    for (const c of Object.values(doc.connectors)) check('connector', c, c.id);
    for (const level of Object.values(doc.levelData)) for (const e of Object.values(level.entities)) check('entity', e, e.id);
  }
}
