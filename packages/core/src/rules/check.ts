import type { RuleLimits } from '../config';
import { deriveLevels, type DerivedLevel } from '../doc/derive';
import type { Connector, Entity, ProjectDoc } from '../doc/schema';
import { intersectPolygons } from '../geometry/clip';
import { connectorCutsLevel, deriveConnector, segmentsSelfIntersect } from '../geometry/connectors';
import { deriveLevelGeometry } from '../geometry/level-geometry';
import { openingMisfits } from '../geometry/openings';
import { resolvePath, type Path } from '../geometry/path';
import { polygonArea } from '../geometry/polygon';
import { ENGLISH_PHRASE, phraseText, type Phrase } from '../i18n';

export type RuleId = 'stair-limits' | 'ramp-slope' | 'elevator-stops' | 'connector-inverted' | 'connector-shape' | 'opening-misfit' | 'room-open' | 'opening-uncovered' | 'self-intersecting';

/** Something the design does that its rules say it should not: what, where, and which entity or connector it is about. */
export interface Warning {
  /** Stable while the problem persists: the target and the rule. */
  id: string;
  rule: RuleId;
  severity: 'warning' | 'error';
  /** In English, for agents and tests: `text` as English writes it. */
  message: string;
  /** The message as its catalog key and parameters (`rules.*`): what the Warnings panel shows, in the user's language and units. */
  text: Phrase;
  target: { kind: 'entity' | 'connector'; id: string };
  /** The level to show it on (a connector: where it starts). */
  levelId: string | null;
}

const CONNECTOR_RULE: Record<string, RuleId> = {
  'riser-high': 'stair-limits',
  'riser-low': 'stair-limits',
  'tread-short': 'stair-limits',
  comfort: 'stair-limits',
  'too-narrow': 'stair-limits',
  'too-few-risers': 'stair-limits',
  'shape-mismatch': 'connector-shape',
  'self-intersecting': 'self-intersecting',
  'too-steep': 'ramp-slope',
  inverted: 'connector-inverted',
  'stop-off-stack': 'elevator-stops',
  'stops-same-elevation': 'elevator-stops',
  'car-too-big': 'elevator-stops',
};
const SEVERITY: Record<RuleId, Warning['severity']> = { 'stair-limits': 'warning', 'ramp-slope': 'warning', 'elevator-stops': 'error', 'connector-inverted': 'error', 'connector-shape': 'warning', 'opening-misfit': 'warning', 'room-open': 'warning', 'opening-uncovered': 'warning', 'self-intersecting': 'error' };
const TYPE_NAMES = new Set<Entity['type']>(['wall', 'shape', 'separator', 'slab', 'room', 'void', 'shaft']);

/** A connector's own name, or its kind for one without (translated where it is shown). */
const connectorName = (c: Connector): string | Phrase => c.name || { key: `rules.kind.${c.kind}` };
/** What crosses itself, by type. */
const typeName = (type: Entity['type']): Phrase => ({ key: TYPE_NAMES.has(type) ? (`rules.type.${type}` as 'rules.type.wall') : 'rules.type.outline' });
/** A warning from its text: the English message agents read is made from it. */
function warning(id: string, rule: RuleId, text: Phrase, target: Warning['target'], levelId: string | null): Warning {
  return { id, rule, severity: SEVERITY[rule], message: phraseText(text, ENGLISH_PHRASE), text, target, levelId };
}
/** The level a connector is shown on: where it starts (an elevator: its lowest stop). */
function connectorLevel(c: Connector, levels: readonly DerivedLevel[]): string | null {
  if (c.kind !== 'elevator') return c.bottom.levelId;
  const stops = c.stops.map((s) => levels.find((l) => l.id === s.levelId)).filter((l): l is DerivedLevel => Boolean(l));
  return stops.length ? stops.reduce((low, l) => (l.elevation < low.elevation ? l : low)).id : (c.stops[0]?.levelId ?? null);
}

/** The limits every connector breaks: riser and tread limits, ramp slopes, elevator stops, a top below its bottom, a walk line that crosses itself. */
export function checkConnectorRules(doc: Pick<ProjectDoc, 'building' | 'levels' | 'connectors'>, limits: RuleLimits, levels: readonly DerivedLevel[] = deriveLevels(doc)): Warning[] {
  const out: Warning[] = [];
  for (const c of Object.values(doc.connectors)) {
    const levelId = connectorLevel(c, levels);
    for (const brk of deriveConnector(c, levels, limits).broken) {
      const rule = CONNECTOR_RULE[brk.rule] ?? 'stair-limits';
      out.push(warning(`${c.id}:${brk.rule}`, rule, { key: 'rules.connector', params: { name: connectorName(c), detail: brk.text } }, { kind: 'connector', id: c.id }, levelId));
    }
  }
  return out;
}

const pathsOf = (e: Entity): Path[] => {
  switch (e.type) {
    case 'wall':
    case 'shape':
    case 'separator':
      return [e.path];
    case 'slab':
      return e.source.k === 'region' ? [e.source.region.outer, ...e.source.region.holes] : [];
    case 'room':
      return e.boundary.k === 'region' ? [e.boundary.region.outer, ...e.boundary.region.holes] : [];
    case 'void':
    case 'shaft':
      return [e.region.outer, ...e.region.holes];
    default:
      return [];
  }
};

/**
 * What one level does against the rules: doors and windows that do not fit their wall, detected
 * rooms that are not enclosed, walls, shapes and regions that cross themselves, and connector
 * openings through this floor that lie outside its slab (over 1 % of the footprint, or no slab).
 */
export function checkLevelRules(doc: ProjectDoc, levelId: string, limits: RuleLimits, levels: readonly DerivedLevel[] = deriveLevels(doc)): Warning[] {
  const entities = doc.levelData[levelId]?.entities;
  const level = levels.find((l) => l.id === levelId);
  if (!entities || !level) return [];
  const out: Warning[] = [];
  const warn = (rule: RuleId, text: Phrase, target: Warning['target']) => out.push(warning(`${target.id}:${rule}`, rule, text, target, levelId));
  const at = level.name;
  const openings = Object.values(entities).filter((e): e is Extract<Entity, { type: 'opening' }> => e.type === 'opening');
  for (const e of Object.values(entities)) {
    if (e.type === 'opening') {
      const wall = entities[e.wallId];
      if (wall?.type === 'wall' && openingMisfits(wall, e, openings.filter((o) => o.wallId === e.wallId && o.id !== e.id))) warn('opening-misfit', { key: e.kind === 'door' ? 'rules.misfit.door' : e.kind === 'window' ? 'rules.misfit.window' : 'rules.misfit.opening', params: { level: at } }, { kind: 'entity', id: e.id });
      continue;
    }
    for (const path of pathsOf(e)) {
      if (segmentsSelfIntersect(resolvePath(path).segs, path.closed)) {
        warn('self-intersecting', 'name' in e && e.name ? { key: 'rules.crossesNamed', params: { type: typeName(e.type), name: e.name, level: at } } : { key: 'rules.crosses', params: { type: typeName(e.type), level: at } }, { kind: 'entity', id: e.id });
        break;
      }
    }
  }
  // Rooms and the whole slabs come from the level's geometry without the connector openings.
  const geometry = deriveLevelGeometry(entities);
  for (const [id, room] of geometry.rooms) {
    const e = entities[id];
    if (e?.type === 'room' && e.boundary.k === 'detect' && !room.enclosed) warn('room-open', { key: 'rules.roomOpen', params: { name: e.name, level: at } }, { kind: 'entity', id });
  }
  const slabs = [...geometry.slab, ...[...geometry.slabRegions.values()].flat()];
  for (const c of Object.values(doc.connectors)) {
    if (!connectorCutsLevel(c, level, levels)) continue;
    const footprint = deriveConnector(c, levels, limits).footprint;
    const area = footprint.reduce((sum, p) => sum + Math.abs(polygonArea(p)), 0);
    if (area <= 0) continue;
    const covered = slabs.length ? intersectPolygons(footprint, slabs).reduce((sum, p) => sum + Math.abs(polygonArea(p)), 0) : 0;
    if (covered < 0.99 * area) warn('opening-uncovered', { key: slabs.length ? 'rules.uncovered' : 'rules.noSlab', params: { name: connectorName(c), level: at } }, { kind: 'connector', id: c.id });
  }
  return out;
}

/** Every warning the design raises: the connectors first, then each level bottom to top. */
export function checkRules(doc: ProjectDoc, limits: RuleLimits): Warning[] {
  const levels = deriveLevels(doc);
  const out = checkConnectorRules(doc, limits, levels);
  for (const level of levels) out.push(...checkLevelRules(doc, level.id, limits, levels));
  return out;
}
