import { add, arrowHeadLines, breakLinePoints, connectorRole, deriveConnector, deriveLevels, normalize, perp, polygonBox, polygonContains, polygonEdgeDistance, resolvePath, scale, sub, walkPoints, walkTangent, type Box, type Connector, type ConnectorGeometry, type ConnectorRole, type DerivedLevel, type Path, type Polygon, type ProjectDoc, type RuleLimits, type Seg, type Vec2 } from '@studio/core';
import { tracePolygon, traceSegments } from './draw';
import type { RenderFrame, TextOp } from './render';
import { withAlpha } from './theme';

/** A connector as one level shows it: how it reaches the level, and its geometry against the current elevations. */
export interface PlanConnector {
  id: string;
  /** The level it is shown on. */
  levelId: string;
  connector: Connector;
  role: ConnectorRole;
  geometry: ConnectorGeometry;
  box: Box;
}

/** The connectors a level shows, derived by the renderer's cache (see `LevelGeometryCache.connectorsOn`). */
export function planConnectors(doc: Pick<ProjectDoc, 'building' | 'levels' | 'connectors'>, levelId: string, limits: RuleLimits, geometryOf: (c: Connector, levels: readonly DerivedLevel[]) => ConnectorGeometry = (c, levels) => deriveConnector(c, levels, limits)): PlanConnector[] {
  const levels = deriveLevels(doc);
  const level = levels.find((l) => l.id === levelId);
  if (!level) return [];
  const out: PlanConnector[] = [];
  for (const connector of Object.values(doc.connectors)) {
    const role = connectorRole(connector, level, levels);
    if (!role) continue;
    const geometry = geometryOf(connector, levels);
    out.push({ id: connector.id, levelId, connector, role, geometry, box: footprintBox(geometry.footprint) });
  }
  return out;
}

export function footprintBox(polys: readonly Polygon[]): Box {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const poly of polys) {
    const b = polygonBox(poly);
    box.minX = Math.min(box.minX, b.minX);
    box.minY = Math.min(box.minY, b.minY);
    box.maxX = Math.max(box.maxX, b.maxX);
    box.maxY = Math.max(box.maxY, b.maxY);
  }
  return box;
}

/** How far a point is from a connector's footprint (0 inside), or null beyond `tolerance`. */
export function connectorDistance(pc: PlanConnector, p: Vec2, tolerance: number): number | null {
  const polys = pc.geometry.footprint;
  if (polys.filter((poly) => polygonContains(poly, p)).length % 2 === 1) return 0;
  const d = Math.min(...polys.map((poly) => polygonEdgeDistance(poly, p)));
  return d <= tolerance ? d : null;
}

// ---------- drawing ----------

const px = (frame: RenderFrame, n: number) => n / frame.camera.scale;

function polyline(ctx: CanvasRenderingContext2D, pts: readonly Vec2[]): void {
  if (!pts.length) return;
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
}

function line(ctx: CanvasRenderingContext2D, a: Vec2, b: Vec2): void {
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
}

/** An open arrowhead at `tip`, pointing along `dir`, sized in screen pixels. */
function arrowHead(ctx: CanvasRenderingContext2D, frame: RenderFrame, tip: Vec2, dir: Vec2): void {
  for (const [a, b] of arrowHeadLines(tip, dir, px(frame, 10))) line(ctx, a, b);
}

export interface ConnectorDrawOptions {
  /** Drawn faintly: a level it only passes, or a preview. */
  faint?: boolean;
}

/**
 * One connector's symbol on a level. Stairs: their outline, treads and handrails; on the level
 * they start from, the treads above the plan cut dashed beyond a break line and an arrow with "UP";
 * on the level they arrive at, the whole stair with "DN". Ramps: the outline, an arrow and the slope.
 * Elevators: the shaft, the car crossed, and a door mark on the side it opens at this level.
 * Ladders: rails and rungs. Escalators: the outline, step lines and an arrow. A connector that
 * breaks a limit is drawn in the warning colour; on a level it only passes it is faint.
 */
export function drawConnector(ctx: CanvasRenderingContext2D, pc: PlanConnector, frame: RenderFrame, texts: TextOp[], options: ConnectorDrawOptions = {}): void {
  const g = pc.geometry;
  const faint = options.faint || pc.role === 'crosses';
  const color = g.broken.length ? frame.theme.warning : frame.theme.connector;
  ctx.save();
  ctx.globalAlpha *= faint ? 0.4 : 1;
  ctx.strokeStyle = color;
  ctx.lineWidth = px(frame, 1);
  ctx.lineJoin = 'miter';
  ctx.lineCap = 'butt';
  // The outline.
  ctx.lineWidth = px(frame, 1.5);
  ctx.beginPath();
  for (const poly of g.footprint) tracePolygon(ctx, poly);
  ctx.stroke();
  ctx.lineWidth = px(frame, 1);
  const label = (text: string, at: Vec2) => texts.push({ text, at, screenPx: 11, color: faint ? withAlpha(color, 0.5) : color, align: 'center', baseline: 'middle', mono: true });

  switch (g.kind) {
    case 'stair': {
      const cut = pc.role === 'bottom' ? g.cutAlong : null;
      const below = g.treads.filter((t) => cut === null || t.along <= cut + 1e-6);
      const above = cut === null ? [] : g.treads.filter((t) => t.along > cut + 1e-6);
      ctx.beginPath();
      for (const t of below) line(ctx, t.a, t.b);
      for (const rail of g.handrails) traceSegments(ctx, railSegs(rail), false);
      ctx.stroke();
      if (above.length) {
        ctx.setLineDash([px(frame, 4), px(frame, 3)]);
        ctx.beginPath();
        for (const t of above) line(ctx, t.a, t.b);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (cut !== null) {
        const t = g.treads.find((x) => x.along >= cut - 1e-6);
        const centre = t ? scale(add(t.a, t.b), 0.5) : g.axis[0].a;
        ctx.lineWidth = px(frame, 1.5);
        ctx.beginPath();
        polyline(ctx, breakLinePoints(g.axis, cut, Math.max(1, t ? Math.hypot(t.a[0] - t.b[0], t.a[1] - t.b[1]) : 1000), centre));
        ctx.stroke();
        ctx.lineWidth = px(frame, 1);
      }
      if (!faint && g.axis.length) drawWalkArrow(ctx, frame, g.axis, g.walkLength, pc.role === 'top' ? 'down' : 'up', cut, label, `${g.risers} R`);
      break;
    }
    case 'ramp': {
      if (!faint && g.axis.length) {
        drawWalkArrow(ctx, frame, g.axis, g.walkLength, pc.role === 'top' ? 'down' : 'up', null, label, null);
        const mid = walkPoints(g.axis, g.walkLength / 2, g.walkLength / 2 + 1)[0];
        if (mid) {
          const n = perp(walkTangent(g.axis, g.walkLength / 2));
          label(`${(Math.round(g.slope * 10) / 10).toFixed(1)} %`, add(mid, scale(n, px(frame, 12))));
        }
      }
      break;
    }
    case 'ladder': {
      ctx.beginPath();
      for (const [a, b] of [...g.rails, ...g.rungs]) line(ctx, a, b);
      ctx.stroke();
      break;
    }
    case 'escalator': {
      ctx.beginPath();
      for (const [a, b] of g.steps) line(ctx, a, b);
      ctx.stroke();
      if (!faint) {
        const dir = normalize(sub(g.head, g.foot));
        const [from, to] = pc.role === 'top' ? [g.head, g.foot] : [g.foot, g.head];
        const start = add(from, scale(sub(to, from), 0.1));
        const end = add(from, scale(sub(to, from), 0.9));
        ctx.beginPath();
        line(ctx, start, end);
        arrowHead(ctx, frame, end, pc.role === 'top' ? scale(dir, -1) : dir);
        ctx.stroke();
        label(pc.role === 'top' ? 'DN' : 'UP', add(start, scale(perp(dir), px(frame, 12))));
      }
      break;
    }
    case 'elevator': {
      ctx.beginPath();
      tracePolygon(ctx, g.car);
      line(ctx, g.car[0], g.car[2]);
      line(ctx, g.car[1], g.car[3]);
      ctx.stroke();
      const stop = g.stops.find((s) => s.levelId === pc.levelId);
      if (stop && !faint) {
        ctx.lineWidth = px(frame, 4);
        ctx.lineCap = 'butt';
        ctx.beginPath();
        line(ctx, stop.door[0], stop.door[1]);
        ctx.stroke();
      }
      break;
    }
  }
  ctx.restore();
}

/** A handrail's segments, resolved once per derived rail. */
const railCache = new WeakMap<Path, Seg[]>();

function railSegs(path: Path): Seg[] {
  let segs = railCache.get(path);
  if (!segs) {
    segs = resolvePath(path).segs;
    railCache.set(path, segs);
  }
  return segs;
}

/** The walk line with an arrow: up from the start (to the cut, when there is one) or down from the top to the start; a dot at the start and a label. */
function drawWalkArrow(ctx: CanvasRenderingContext2D, frame: RenderFrame, segs: readonly Seg[], total: number, way: 'up' | 'down', cut: number | null, label: (text: string, at: Vec2) => void, extra: string | null): void {
  const end = way === 'up' ? (cut ?? total) : total;
  const pts = walkPoints(segs, 0, end);
  if (pts.length < 2) return;
  ctx.beginPath();
  polyline(ctx, pts);
  if (way === 'up') arrowHead(ctx, frame, pts[pts.length - 1], walkTangent(segs, end));
  else arrowHead(ctx, frame, pts[0], scale(walkTangent(segs, 0), -1));
  ctx.stroke();
  const startDot = way === 'up' ? pts[0] : pts[pts.length - 1];
  ctx.beginPath();
  ctx.arc(startDot[0], startDot[1], px(frame, 3), 0, Math.PI * 2);
  ctx.fillStyle = ctx.strokeStyle;
  ctx.fill();
  const n = perp(walkTangent(segs, way === 'up' ? 0 : total));
  label(way === 'up' ? 'UP' : 'DN', add(startDot, scale(n, px(frame, 14))));
  if (extra) label(extra, sub(startDot, scale(n, px(frame, 14))));
}

/** A connector's outline traced for the selection: its footprint. */
export function traceConnector(ctx: CanvasPath, pc: PlanConnector): void {
  for (const poly of pc.geometry.footprint) tracePolygon(ctx, poly);
}
