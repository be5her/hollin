import type { RuleLimits } from '../config';
import { deriveLevels, type DerivedLevel } from '../doc/derive';
import type { Connector, Entity, ProjectDoc } from '../doc/schema';
import { intersectPolygons } from '../geometry/clip';
import { connectorCutsLevel, deriveConnector, segmentsSelfIntersect } from '../geometry/connectors';
import { deriveLevelGeometry } from '../geometry/level-geometry';
import { openingMisfits } from '../geometry/openings';
import { resolvePath, type Path } from '../geometry/path';
import { polygonArea } from '../geometry/polygon';

export type RuleId = 'stair-limits' | 'ramp-slope' | 'elevator-stops' | 'connector-inverted' | 'connector-shape' | 'opening-misfit' | 'room-open' | 'opening-uncovered' | 'self-intersecting';

/** Something the design does that its rules say it should not: what, where, and which entity or connector it is about. */
export interface Warning {
  /** Stable while the problem persists: the target and the rule. */
  id: string;
  rule: RuleId;
  severity: 'warning' | 'error';
  message: string;
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
const KIND_NAMES: Record<Connector['kind'], string> = { stair: 'Stair', ladder: 'Ladder', ramp: 'Ramp', elevator: 'Elevator', escalator: 'Escalator' };
const TYPE_NAMES: Partial<Record<Entity['type'], string>> = { wall: 'Wall', shape: 'Shape', separator: 'Room divider', slab: 'Slab', room: 'Room', void: 'Void', shaft: 'Shaft' };

const connectorName = (c: Connector): string => c.name || KIND_NAMES[c.kind];
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
      out.push({ id: `${c.id}:${brk.rule}`, rule, severity: SEVERITY[rule], message: `${connectorName(c)}: ${brk.message}`, target: { kind: 'connector', id: c.id }, levelId });
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
  const warn = (rule: RuleId, message: string, target: Warning['target']) => out.push({ id: `${target.id}:${rule}`, rule, severity: SEVERITY[rule], message, target, levelId });
  const openings = Object.values(entities).filter((e): e is Extract<Entity, { type: 'opening' }> => e.type === 'opening');
  for (const e of Object.values(entities)) {
    if (e.type === 'opening') {
      const wall = entities[e.wallId];
      if (wall?.type === 'wall' && openingMisfits(wall, e, openings.filter((o) => o.wallId === e.wallId && o.id !== e.id))) warn('opening-misfit', `${e.kind === 'door' ? 'Door' : e.kind === 'window' ? 'Window' : 'Opening'} does not fit its wall on ${level.name}`, { kind: 'entity', id: e.id });
      continue;
    }
    for (const path of pathsOf(e)) {
      if (segmentsSelfIntersect(resolvePath(path).segs, path.closed)) {
        warn('self-intersecting', `${TYPE_NAMES[e.type] ?? 'Outline'}${'name' in e && e.name ? ` "${e.name}"` : ''} crosses itself on ${level.name}`, { kind: 'entity', id: e.id });
        break;
      }
    }
  }
  // Rooms and the whole slabs come from the level's geometry without the connector openings.
  const geometry = deriveLevelGeometry(entities);
  for (const [id, room] of geometry.rooms) {
    const e = entities[id];
    if (e?.type === 'room' && e.boundary.k === 'detect' && !room.enclosed) warn('room-open', `Room "${e.name}" on ${level.name} is not enclosed`, { kind: 'entity', id });
  }
  const slabs = [...geometry.slab, ...[...geometry.slabRegions.values()].flat()];
  for (const c of Object.values(doc.connectors)) {
    if (!connectorCutsLevel(c, level, levels)) continue;
    const footprint = deriveConnector(c, levels, limits).footprint;
    const area = footprint.reduce((sum, p) => sum + Math.abs(polygonArea(p)), 0);
    if (area <= 0) continue;
    const covered = slabs.length ? intersectPolygons(footprint, slabs).reduce((sum, p) => sum + Math.abs(polygonArea(p)), 0) : 0;
    if (covered < 0.99 * area) warn('opening-uncovered', slabs.length ? `${connectorName(c)} passes through ${level.name} outside its slab` : `${connectorName(c)} passes through ${level.name}, which has no slab`, { kind: 'connector', id: c.id });
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
