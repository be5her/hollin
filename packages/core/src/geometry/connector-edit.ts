import { CONNECTOR_PREFIX, type Connector } from '../doc/schema';
import type { Path } from './path';
import { transformer, transformPathBy, type Transform } from './transform';

const PREFIXES = new Set(Object.values(CONNECTOR_PREFIX).map((p) => `${p}_`));

/** Whether an id names a connector (a stair, ladder, ramp, elevator or escalator) rather than an entity: by its prefix. */
export const isConnectorId = (id: string): boolean => PREFIXES.has(id.slice(0, 4));

/** The path a connector is drawn along and edited by: a stair's or ramp's axis. Null for the others (they are placed by a point). */
export function connectorPath(connector: Connector): Path | null {
  return connector.kind === 'stair' || connector.kind === 'ramp' ? connector.axis : null;
}

/** The same connector with a new axis. */
export function withConnectorPath<C extends Connector>(connector: C, path: Path): C {
  if (connector.kind !== 'stair' && connector.kind !== 'ramp') throw new Error(`A ${connector.kind} has no axis to edit`);
  return { ...connector, axis: path };
}

/**
 * The connector moved, rotated or mirrored on the plan. Heights and levels are untouched. A mirror
 * keeps a stair's handrails where they were drawn (left and right swap), keeps an elevator's doors
 * on the mirrored sides of its shaft, and flips arcs.
 */
export function transformConnector<C extends Connector>(connector: C, xf: Transform): C {
  const m = transformer(xf);
  const c = connector as Connector;
  switch (c.kind) {
    case 'stair':
      return { ...c, axis: transformPathBy(c.axis, m), handrails: m.flips ? { left: c.handrails.right, right: c.handrails.left } : c.handrails } as C;
    case 'ramp':
      return { ...c, axis: transformPathBy(c.axis, m) } as C;
    case 'ladder':
    case 'escalator':
      return { ...c, at: m.point(c.at), direction: m.angle(c.direction) } as C;
    case 'elevator': {
      // The rotation follows the mirrored x axis, so the mirrored y axis points the other way: a door that faced front now faces back.
      const swap = { left: 'left', right: 'right', front: 'back', back: 'front' } as const;
      const stops = m.flips ? c.stops.map((s) => ({ ...s, door: swap[s.door] })) : c.stops;
      return { ...c, at: m.point(c.at), rotation: m.angle(c.rotation), stops } as C;
    }
  }
}
