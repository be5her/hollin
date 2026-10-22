import { assetFileOf } from '../decor/refs';
import type { Building, Connector, Entity, Layer, Level } from './schema';

/** The kinds of record a document holds; `meta` and `building` are single records. */
export type Coll = 'meta' | 'building' | 'level' | 'layer' | 'connector' | 'asset' | 'entity';

export interface Ref {
  /** Where the reference sits, e.g. `span.topLevelId` or `stops.1.levelId`. */
  path: string;
  target: 'level' | 'layer' | 'entity' | 'asset';
  /** The record's id; for an asset, its file name (the reference itself is `asset:<file>`). */
  id: string;
}

/**
 * Every reference a record holds to another record. This is the single list of references in the
 * model: integrity checks and id remapping (duplicating a level) both read it, and a test checks that
 * no id-valued field is missing from it.
 */
export function refsOf(coll: Coll, value: unknown): Ref[] {
  const refs: Ref[] = [];
  const push = (path: string, target: Ref['target'], id: unknown) => {
    if (typeof id === 'string') refs.push({ path, target, id });
  };
  switch (coll) {
    case 'building': {
      const b = value as Building;
      push('groundLevelId', 'level', b.groundLevelId);
      b.stack.forEach((id, i) => push(`stack.${i}`, 'level', id));
      break;
    }
    case 'level': {
      const l = value as Level;
      if (l.place.k === 'offset') push('place.hostLevelId', 'level', l.place.hostLevelId);
      break;
    }
    case 'layer':
      push('levelId', 'level', (value as Layer).levelId);
      break;
    case 'entity': {
      const e = value as Entity;
      push('levelId', 'level', e.levelId);
      push('layerId', 'layer', e.layerId);
      if ('span' in e && e.span) push('span.topLevelId', 'level', e.span.topLevelId);
      if (e.type === 'opening') push('wallId', 'entity', e.wallId);
      if (e.type === 'item') {
        const file = assetFileOf(e.asset);
        if (file) refs.push({ path: 'asset', target: 'asset', id: file });
      }
      if (e.type === 'dimension' && e.anchors) {
        if (e.anchors.from) push('anchors.from.entityId', 'entity', e.anchors.from.entityId);
        if (e.anchors.to) push('anchors.to.entityId', 'entity', e.anchors.to.entityId);
      }
      break;
    }
    case 'connector': {
      const c = value as Connector;
      if ('bottom' in c) push('bottom.levelId', 'level', c.bottom.levelId);
      if ('top' in c) push('top.levelId', 'level', c.top.levelId);
      if (c.kind === 'elevator') c.stops.forEach((s, i) => push(`stops.${i}.levelId`, 'level', s.levelId));
      break;
    }
    case 'meta':
    case 'asset':
      break;
  }
  return refs;
}

/** A copy of the record with every reference found in `map` replaced; other references stay. */
export function remapRefs<T>(coll: Coll, value: T, map: ReadonlyMap<string, string>): T {
  const copy = structuredClone(value) as Record<string, unknown>;
  for (const ref of refsOf(coll, value)) {
    // Asset files are named by their content; they never change id.
    if (ref.target === 'asset') continue;
    const next = map.get(ref.id);
    if (!next) continue;
    const keys = ref.path.split('.');
    let target: Record<string, unknown> = copy;
    for (const key of keys.slice(0, -1)) target = target[key] as Record<string, unknown>;
    target[keys[keys.length - 1]] = next;
  }
  return copy as T;
}
