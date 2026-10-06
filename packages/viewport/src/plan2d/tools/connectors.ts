import { DEG, bulgeThrough, distance, formatAngle, formatLength, resolveCoordinate, stairAxisFrom, sub, type Connector, type ConnectorRecord, type Coordinate, type DerivedLevel, type Path, type Vec2 } from '@studio/core';
import type { PlanConnector } from '../connectors';
import { drawConnectorPreview, drawScreenText, type RenderFrame } from '../render';
import { referenceFrom, type SnapResult, type TrackReference } from '../snap';
import type { Tool, ToolHost, ToolId, ToolPointer } from './tool';

type Stair = Extract<Connector, { kind: 'stair' }>;
type StairShape = Stair['shape'];

/** Preview ids: never stored, only derived for the active level. */
const PREVIEW: Record<string, string> = { stair: 'str_0000000000000000', ramp: 'rmp_0000000000000000', ladder: 'lad_0000000000000000', elevator: 'elv_0000000000000000' };

/** The bottom and top levels a new connector gets: the options, or the active level and the stacked level above it. Null when there is no level above. */
export function connectorLevels(host: ToolHost): { bottom: DerivedLevel; top: DerivedLevel } | null {
  const levels = host.levels();
  const o = host.options().connector;
  const bottom = levels.find((l) => l.id === (o.bottomLevelId ?? host.levelId()));
  if (!bottom) return null;
  const top = o.topLevelId ? levels.find((l) => l.id === o.topLevelId) : levels.filter((l) => l.placement === 'stack' && l.elevation > bottom.elevation).sort((a, b) => a.elevation - b.elevation)[0];
  return top ? { bottom, top } : null;
}

const polyline = (points: readonly Vec2[]): Path => ({ closed: false, v: points.map((p) => ({ p })) });
const draws = (ctx: CanvasRenderingContext2D, frame: RenderFrame, points: readonly Vec2[]) => {
  if (points.length < 2) return;
  ctx.strokeStyle = frame.theme.selection;
  ctx.lineWidth = 1 / frame.camera.scale;
  ctx.setLineDash([6 / frame.camera.scale, 4 / frame.camera.scale]);
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
  ctx.stroke();
  ctx.setLineDash([]);
};
const dots = (ctx: CanvasRenderingContext2D, frame: RenderFrame, points: readonly Vec2[]) => {
  ctx.fillStyle = frame.theme.selection;
  for (const p of points) {
    ctx.beginPath();
    ctx.arc(p[0], p[1], 3 / frame.camera.scale, 0, Math.PI * 2);
    ctx.fill();
  }
};

/**
 * A tool that clicks the points of a walk line: snapping and angle tracking from the last point,
 * a typed length along the tracked direction, Escape dropping what is unfinished. Subclasses say
 * when the points are enough, what connector they make and how the preview reads.
 */
abstract class AxisTool implements Tool {
  abstract readonly id: ToolId;
  protected points: Vec2[] = [];
  protected cursor: Vec2 | null = null;
  private previous: Vec2 | null = null;
  private startRef: TrackReference | null = null;

  constructor(protected readonly host: ToolHost) {}

  get busy(): boolean {
    return this.points.length > 0;
  }

  /** How many clicks finish the connector (null: Enter or a double click does). */
  protected abstract needed(): number | null;
  /** The connector the points make with the cursor standing in for the next one (null: not enough yet). */
  protected abstract record(points: readonly Vec2[]): ConnectorRecord | null;
  protected abstract hintFor(points: readonly Vec2[], preview: PlanConnector | null): string;
  protected abstract readonly noun: string;

  pointerDown(e: ToolPointer): void {
    if (e.button !== 0) return;
    const snap = this.snapped(e);
    const p = snap.point;
    if (!this.points.length) {
      this.host.select([]);
      this.startRef = referenceFrom(snap, this.host.entities());
      this.points = [p];
      this.host.invalidate();
      return;
    }
    const needed = this.needed();
    if (needed === null && e.clicks >= 2 && this.points.length >= 2) {
      this.finish();
      return;
    }
    const last = this.points[this.points.length - 1];
    if (distance(p, last) < 1e-6) return;
    this.previous = normalizeDir(sub(p, last));
    this.points.push(p);
    if (needed !== null && this.points.length >= needed) this.finish();
    this.host.invalidate();
  }

  pointerMove(e: ToolPointer): void {
    this.cursor = this.snapped(e).point;
    this.host.invalidate();
  }

  key(e: KeyboardEvent): boolean {
    if (e.key === 'Enter' && this.points.length >= 2) {
      this.finish();
      return true;
    }
    return false;
  }

  acceptsTyped(): boolean {
    return this.points.length > 0;
  }

  /** A typed length runs from the last point along the cursor's (tracked) direction; polar, relative and absolute forms as written. */
  typed(_text: string, coord: Coordinate | null, cursor: Vec2 | null): boolean {
    if (!coord || !this.points.length) return false;
    const last = this.points[this.points.length - 1];
    const point = resolveCoordinate(coord, { from: last, direction: cursor ? sub(cursor, last) : undefined });
    if (!point) return false;
    this.pointerDown({ world: point, screen: [0, 0], button: 0, shift: false, ctrl: false, alt: true, clicks: 1 });
    return true;
  }

  cancel(): void {
    this.reset();
  }

  hint(): string {
    return this.hintFor(this.points, this.preview());
  }

  draw(ctx: CanvasRenderingContext2D, frame: RenderFrame): void {
    if (!this.points.length) return;
    const pc = this.preview();
    if (pc) {
      ctx.globalAlpha = 0.8;
      drawConnectorPreview(ctx, pc, frame);
      ctx.globalAlpha = 1;
    }
    const points = this.cursor ? [...this.points, this.cursor] : this.points;
    draws(ctx, frame, points);
    dots(ctx, frame, this.points);
    const a = points[points.length - 2];
    const b = points[points.length - 1];
    if (a && b && distance(a, b) > 0) {
      const angle = Math.atan2(b[1] - a[1], b[0] - a[0]) / DEG;
      drawScreenText(ctx, frame, { text: `${formatLength(distance(a, b), frame.units)} · ${formatAngle(((angle % 360) + 360) % 360, { precision: 1 })}`, at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], screenPx: 11, color: frame.theme.selection, align: 'center', baseline: 'bottom', dy: -6, mono: true });
    }
  }

  // ---------- internals ----------

  /** The connector as the points and the cursor make it, derived for the active level. */
  protected preview(): PlanConnector | null {
    if (!this.points.length) return null;
    const points = this.cursor && distance(this.cursor, this.points[this.points.length - 1]) > 1e-6 ? [...this.points, this.cursor] : this.points;
    const record = this.record(points);
    return record ? this.host.previewConnector({ ...record, id: PREVIEW[record.kind] } as Connector) : null;
  }

  private snapped(e: ToolPointer): Pick<SnapResult, 'point' | 'tangent'> {
    if (e.alt) return { point: e.world };
    const last = this.points.length ? this.points[this.points.length - 1] : undefined;
    const relativeTo: TrackReference[] = [...(this.previous ? [{ direction: this.previous, name: 'previous' }] : []), ...(this.startRef ? [this.startRef] : [])];
    return this.host.snap(e.world, { from: last, ortho: e.shift && Boolean(last), relativeTo }) ?? { point: e.world };
  }

  private finish(): void {
    const record = this.record(this.points);
    if (record) addAndSelect(this.host, record);
    this.reset();
  }

  private reset(): void {
    this.points = [];
    this.cursor = null;
    this.previous = null;
    this.startRef = null;
    this.host.invalidate();
  }
}

/** Adds the connector and selects it, so its derived numbers show at once. */
function addAndSelect(host: ToolHost, record: ConnectorRecord): void {
  void host.invoke('building.connector.add', { connector: record }).then((result) => {
    const id = (result as { id?: string } | undefined)?.id;
    if (id) host.select([id]);
  });
}

const normalizeDir = (d: Vec2): Vec2 => {
  const len = Math.hypot(d[0], d[1]);
  return len > 0 ? [d[0] / len, d[1] / len] : [1, 0];
};

const risersOf = (pc: PlanConnector | null): string => (pc && 'risers' in pc.geometry ? ` · ${pc.geometry.risers} risers` : '');

/**
 * Draws a stair along its walk line: a straight stair from two clicks; an L or a winder from the
 * start, the corner and the end; a curve from the start, the end and a point the arc passes
 * through; a U or a spiral from two clicks (the start and the direction, or the centre and the
 * first step), laid out from the rise and the rule limits. The options give the shape, the width,
 * the levels and the turn.
 */
export class StairTool extends AxisTool {
  readonly id = 'stair' as const;
  protected readonly noun = 'stair';

  protected needed(): number | null {
    const shape = this.host.options().stair.shape;
    return shape === 'straight' || shape === 'u' || shape === 'spiral' ? 2 : 3;
  }

  protected record(points: readonly Vec2[]): ConnectorRecord | null {
    const levels = connectorLevels(this.host);
    if (!levels || points.length < 2) return null;
    const { shape, width, turn } = this.host.options().stair;
    const axis = this.axisFor(shape, points, width, turn, levels.top.elevation - levels.bottom.elevation);
    if (!axis) return null;
    return { kind: 'stair', shape, bottom: { levelId: levels.bottom.id, offset: 0 }, top: { levelId: levels.top.id, offset: 0 }, axis, width, riser: {}, tread: {}, handrails: { left: true, right: true } };
  }

  private axisFor(shape: StairShape, points: readonly Vec2[], width: number, turn: 'left' | 'right', rise: number): Path | null {
    if (shape === 'u' || shape === 'spiral') return stairAxisFrom({ shape, from: points[0], to: points[1], width, turn }, rise, this.host.limits());
    if (shape === 'curved' && points.length >= 3) {
      const bulge = bulgeThrough(points[0], points[2], points[1]);
      return bulge === null ? polyline([points[0], points[1]]) : { closed: false, v: [{ p: points[0], s: { k: 'arc', bulge } }, { p: points[1] }] };
    }
    return polyline(points.slice(0, shape === 'straight' || shape === 'curved' ? 2 : 3));
  }

  protected hintFor(points: readonly Vec2[], preview: PlanConnector | null): string {
    if (!connectorLevels(this.host)) return 'The stair needs a level above this one: add one in the Levels panel, or choose the levels in the options';
    const shape = this.host.options().stair.shape;
    if (!points.length) return shape === 'spiral' ? 'Click the centre of the spiral · V: select' : 'Click the start of the stair · V: select';
    const risers = risersOf(preview);
    if (shape === 'u') return `Click the direction of the first flight${risers} · Escape: cancel`;
    if (shape === 'spiral') return `Click the first step${risers} · Escape: cancel`;
    if (shape === 'straight') return `Click the top of the stair${risers} · Escape: cancel`;
    if (shape === 'curved') return points.length < 2 ? 'Click the top of the stair · Escape: cancel' : `Click a point the arc passes through${risers} · Escape: cancel`;
    return points.length < 2 ? 'Click the corner · Escape: cancel' : `Click the top of the stair${risers} · Enter: end here · Escape: cancel`;
  }
}

/** Draws a ramp along its axis: click the points, Enter or a double click ends it. */
export class RampTool extends AxisTool {
  readonly id = 'ramp' as const;
  protected readonly noun = 'ramp';

  protected needed(): number | null {
    return null;
  }

  protected record(points: readonly Vec2[]): ConnectorRecord | null {
    const levels = connectorLevels(this.host);
    if (!levels || points.length < 2) return null;
    return { kind: 'ramp', bottom: { levelId: levels.bottom.id, offset: 0 }, top: { levelId: levels.top.id, offset: 0 }, axis: polyline(points), width: this.host.options().ramp.width, maxSlope: this.host.limits().maxRampSlope };
  }

  protected hintFor(points: readonly Vec2[], preview: PlanConnector | null): string {
    if (!connectorLevels(this.host)) return 'The ramp needs a level above this one: add one in the Levels panel, or choose the levels in the options';
    if (!points.length) return 'Click the bottom of the ramp · V: select';
    const slope = preview && 'slope' in preview.geometry ? ` · ${(preview.geometry as { slope: number }).slope.toFixed(1)} %` : '';
    return `Click the next point${slope} · Enter or double-click: end · Escape: cancel`;
  }
}

/** Places a ladder: click its foot, then the direction it leans towards. */
export class LadderTool implements Tool {
  readonly id = 'ladder' as const;
  private at: Vec2 | null = null;
  private cursor: Vec2 | null = null;

  constructor(private readonly host: ToolHost) {}

  get busy(): boolean {
    return this.at !== null;
  }

  pointerDown(e: ToolPointer): void {
    if (e.button !== 0) return;
    const p = this.snapped(e);
    if (!this.at) {
      this.host.select([]);
      this.at = p;
      this.host.invalidate();
      return;
    }
    const record = this.record(p);
    if (record) addAndSelect(this.host, record);
    this.cancel();
  }

  pointerMove(e: ToolPointer): void {
    this.cursor = this.snapped(e);
    this.host.invalidate();
  }

  cancel(): void {
    this.at = null;
    this.cursor = null;
    this.host.invalidate();
  }

  hint(): string {
    if (!connectorLevels(this.host)) return 'The ladder needs a level above this one: add one in the Levels panel, or choose the levels in the options';
    return this.at ? 'Click the direction the ladder leans towards · Escape: cancel' : 'Click the foot of the ladder · V: select';
  }

  draw(ctx: CanvasRenderingContext2D, frame: RenderFrame): void {
    if (!this.at) return;
    const record = this.cursor ? this.record(this.cursor) : null;
    const pc = record ? this.host.previewConnector({ ...record, id: PREVIEW.ladder } as Connector) : null;
    if (pc) {
      ctx.globalAlpha = 0.8;
      drawConnectorPreview(ctx, pc, frame);
      ctx.globalAlpha = 1;
    }
    dots(ctx, frame, [this.at]);
    if (this.cursor) draws(ctx, frame, [this.at, this.cursor]);
  }

  private record(towards: Vec2): ConnectorRecord | null {
    const levels = connectorLevels(this.host);
    if (!levels || !this.at || distance(towards, this.at) < 1e-6) return null;
    const direction = Math.atan2(towards[1] - this.at[1], towards[0] - this.at[0]) / DEG;
    return { kind: 'ladder', bottom: { levelId: levels.bottom.id, offset: 0 }, top: { levelId: levels.top.id, offset: 0 }, at: this.at, direction: Math.round(direction * 1000) / 1000, width: 500, angle: 75 };
  }

  private snapped(e: ToolPointer): Vec2 {
    if (e.alt) return e.world;
    return this.host.snap(e.world, { from: this.at ?? undefined, ortho: e.shift && Boolean(this.at) })?.point ?? e.world;
  }
}

/** Places an elevator: the shaft previews at the cursor; a click puts it there, stopping at every stacked level from the lower to the upper level chosen. */
export class ElevatorTool implements Tool {
  readonly id = 'elevator' as const;
  private cursor: Vec2 | null = null;

  constructor(private readonly host: ToolHost) {}

  get busy(): boolean {
    return false;
  }

  pointerDown(e: ToolPointer): void {
    if (e.button !== 0) return;
    const record = this.record(this.snapped(e));
    if (record) addAndSelect(this.host, record);
  }

  pointerMove(e: ToolPointer): void {
    this.cursor = this.snapped(e);
    this.host.invalidate();
  }

  cancel(): void {
    this.cursor = null;
    this.host.invalidate();
  }

  hint(): string {
    if (!connectorLevels(this.host)) return 'The elevator needs a level above this one: add one in the Levels panel, or choose the levels in the options';
    return 'Click the centre of the shaft · V: select';
  }

  draw(ctx: CanvasRenderingContext2D, frame: RenderFrame): void {
    const record = this.cursor ? this.record(this.cursor) : null;
    const pc = record ? this.host.previewConnector({ ...record, id: PREVIEW.elevator } as Connector) : null;
    if (!pc) return;
    ctx.globalAlpha = 0.8;
    drawConnectorPreview(ctx, pc, frame);
    ctx.globalAlpha = 1;
  }

  /** The record with its stops at every stacked level between the two chosen (the intent form does the same in main; the preview needs them here). */
  private record(at: Vec2): ConnectorRecord | null {
    const levels = connectorLevels(this.host);
    if (!levels) return null;
    const { shaft, car } = this.host.options().elevator;
    const stops = this.host
      .levels()
      .filter((l) => l.placement === 'stack' && l.elevation >= levels.bottom.elevation && l.elevation <= levels.top.elevation)
      .sort((a, b) => a.elevation - b.elevation)
      .map((l) => ({ levelId: l.id, door: 'front' as const }));
    if (stops.length < 2) return null;
    return { kind: 'elevator', at, rotation: 0, shaft: { ...shaft }, car: { ...car }, stops };
  }

  private snapped(e: ToolPointer): Vec2 {
    if (e.alt) return e.world;
    return this.host.snap(e.world)?.point ?? e.world;
  }
}
