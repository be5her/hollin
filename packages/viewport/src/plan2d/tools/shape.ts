import { DEG, bulgeThrough, circlePath, distance, formatAngle, formatLength, normalize, rectPath, resolveCoordinate, reversePath, segmentTangent, signedArea, sub, type Coordinate, type Path, type Vec2, type Vertex } from '@studio/core';
import { tracePath } from '../draw';
import { drawScreenText, type RenderFrame } from '../render';
import { referenceFrom, type SnapResult, type TrackReference } from '../snap';
import { withAlpha } from '../theme';
import type { Tool, ToolHost, ToolId, ToolPointer } from './tool';

export type ShapeMode = 'polyline' | 'rectangle' | 'circle';

interface ChainPoint {
  p: Vec2;
  /** The arc from this point to the next, when it is not straight. */
  bulge?: number;
}

/**
 * Draws outlines: a polyline (click the points; `A` makes the next segment an arc through a point;
 * clicking the first point or `C` closes it; Enter ends it open; Escape drops it), a rectangle (two
 * opposite corners) or a circle (the centre, then a point on it). What the outline becomes is the
 * "make" option: a free shape (filled or not), a room, a slab or a void; rooms, slabs and voids are
 * regions and always closed.
 */
export class ShapeTool implements Tool {
  readonly id: ToolId;
  private points: ChainPoint[] = [];
  private cursor: Vec2 | null = null;
  private arcNext = false;
  private arcEnd: Vec2 | null = null;
  /** The direction of the segment before the one being drawn, and the wall or line the outline started on: tracked parallel and perpendicular. */
  private previous: Vec2 | null = null;
  private startRef: TrackReference | null = null;

  constructor(
    private readonly host: ToolHost,
    readonly mode: ShapeMode,
  ) {
    this.id = mode === 'polyline' ? 'shape' : mode;
  }

  get busy(): boolean {
    return this.points.length > 0;
  }

  pointerDown(e: ToolPointer): void {
    if (e.button !== 0) return;
    const snap = this.snapped(e);
    const p = snap.point;
    if (!this.points.length) {
      this.host.select([]);
      this.startRef = referenceFrom(snap, this.host.entities());
      this.points = [{ p }];
      this.host.invalidate();
      return;
    }
    const first = this.points[0].p;
    if (this.mode === 'rectangle') {
      if (Math.abs(p[0] - first[0]) >= 1 && Math.abs(p[1] - first[1]) >= 1) this.commit(rectBetween(first, p));
      return;
    }
    if (this.mode === 'circle') {
      const r = distance(first, p);
      if (r >= 1) this.commit(circlePath(first, r));
      return;
    }
    const last = this.points[this.points.length - 1];
    if (this.arcNext) {
      if (!this.arcEnd) {
        if (distance(p, last.p) < 1e-6) return;
        this.arcEnd = p;
      } else {
        last.bulge = bulgeThrough(last.p, p, this.arcEnd) ?? 0;
        this.previous = segmentTangent(last.bulge ? { k: 'arc', a: last.p, b: this.arcEnd, bulge: last.bulge } : { k: 'line', a: last.p, b: this.arcEnd }, 1);
        this.points.push({ p: this.arcEnd });
        this.arcEnd = null;
        this.arcNext = false;
      }
      this.host.invalidate();
      return;
    }
    if (e.clicks >= 2 && this.points.length >= 2) {
      this.finish(false);
      return;
    }
    if (this.points.length >= 3 && distance(p, first) <= this.closeTolerance()) {
      this.finish(true);
      return;
    }
    if (distance(p, last.p) < 1e-6) return;
    this.previous = normalize(sub(p, last.p));
    this.points.push({ p });
    this.host.invalidate();
  }

  pointerMove(e: ToolPointer): void {
    this.cursor = this.snapped(e).point;
    this.host.invalidate();
  }

  key(e: KeyboardEvent): boolean {
    if (this.mode !== 'polyline' || !this.points.length) return false;
    const key = e.key.toLowerCase();
    if (key === 'a') {
      this.arcNext = !this.arcNext;
      this.arcEnd = null;
      this.host.invalidate();
      return true;
    }
    if (key === 'c' && !e.ctrlKey && !e.metaKey) {
      if (this.points.length >= 3) this.finish(true);
      return true;
    }
    if (e.key === 'Enter') {
      this.finish(false);
      return true;
    }
    return false;
  }

  acceptsTyped(): boolean {
    return true;
  }

  /** A typed point: a length runs from the last point towards the cursor (for a circle, the radius); polar, relative and absolute forms as written. */
  typed(_text: string, coord: Coordinate | null, cursor: Vec2 | null): boolean {
    if (!coord) return false;
    const last = this.points.length ? this.points[this.points.length - 1].p : undefined;
    const direction = last && cursor ? sub(cursor, last) : undefined;
    const point = resolveCoordinate(coord, { from: last, direction });
    if (!point) return false;
    this.pointerDown({ world: point, screen: [0, 0], button: 0, shift: false, ctrl: false, alt: true, clicks: 1 });
    return true;
  }

  cancel(): void {
    this.reset();
  }

  hint(): string {
    const what = this.host.options().shape.kind;
    const noun = what === 'shape' ? 'shape' : what;
    if (this.mode === 'rectangle') return this.points.length ? `Click the opposite corner of the ${noun} (or type @width,height) · Escape: cancel` : `Click the first corner of a ${noun} · V: select`;
    if (this.mode === 'circle') return this.points.length ? `Click a point on the ${noun}'s circle (or type the radius) · Escape: cancel` : `Click the centre of a round ${noun} · V: select`;
    if (!this.points.length) return `Click the first point of a ${noun} · V: select`;
    if (this.arcNext) return this.arcEnd ? 'Click a point the arc passes through' : 'Click the end of the arc · A: straight';
    const close = what === 'shape' ? 'click the first point or C: close · Enter: end open' : 'click the first point, C or Enter: close';
    return `Click the next point · A: arc · ${close} · Escape: cancel`;
  }

  draw(ctx: CanvasRenderingContext2D, frame: RenderFrame): void {
    if (!this.points.length) return;
    const { theme } = frame;
    const first = this.points[0].p;
    const cursor = this.cursor;
    let path: Path | null = null;
    let label: string | null = null;
    let at: Vec2 | null = null;
    if (this.mode === 'rectangle') {
      if (!cursor) return;
      path = rectBetween(first, cursor);
      label = `${formatLength(Math.abs(cursor[0] - first[0]), frame.units)} × ${formatLength(Math.abs(cursor[1] - first[1]), frame.units)}`;
      at = cursor;
    } else if (this.mode === 'circle') {
      if (!cursor) return;
      const r = distance(first, cursor);
      if (r < 1e-6) return;
      path = circlePath(first, r);
      label = `r ${formatLength(r, frame.units)}`;
      at = cursor;
    } else {
      const preview: ChainPoint[] = this.points.map((c) => ({ ...c }));
      if (cursor) {
        const last = preview[preview.length - 1];
        if (this.arcNext && this.arcEnd) {
          last.bulge = bulgeThrough(last.p, cursor, this.arcEnd) ?? 0;
          preview.push({ p: this.arcEnd });
        } else if (distance(cursor, last.p) > 1e-6) preview.push({ p: cursor });
      }
      if (preview.length < 2) {
        this.drawDot(ctx, frame, first);
        return;
      }
      path = chainPath(preview, false);
      const a = preview[preview.length - 2].p;
      const b = preview[preview.length - 1].p;
      const d = distance(a, b);
      if (d > 0) {
        const angle = Math.atan2(b[1] - a[1], b[0] - a[0]) / DEG;
        label = `${formatLength(d, frame.units)} · ${formatAngle(((angle % 360) + 360) % 360, { precision: 1 })}`;
        at = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      }
    }
    ctx.strokeStyle = theme.selection;
    ctx.fillStyle = withAlpha(theme.selection, 0.1);
    ctx.lineWidth = 1.5 / frame.camera.scale;
    ctx.beginPath();
    tracePath(ctx, path);
    if (path.closed || path.v.length >= 3) ctx.fill('evenodd');
    ctx.stroke();
    if (!path.closed && path.v.length >= 3) {
      // The edge that would close it.
      ctx.setLineDash([4 / frame.camera.scale, 4 / frame.camera.scale]);
      ctx.beginPath();
      const last = path.v[path.v.length - 1].p;
      ctx.moveTo(last[0], last[1]);
      ctx.lineTo(first[0], first[1]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (label && at) drawScreenText(ctx, frame, { text: label, at, screenPx: 11, color: theme.selection, align: 'center', baseline: 'bottom', dy: -6, mono: true });
  }

  // ---------- internals ----------

  private drawDot(ctx: CanvasRenderingContext2D, frame: RenderFrame, p: Vec2): void {
    ctx.fillStyle = frame.theme.selection;
    ctx.beginPath();
    ctx.arc(p[0], p[1], 3 / frame.camera.scale, 0, Math.PI * 2);
    ctx.fill();
  }

  private closeTolerance(): number {
    return 8 / this.host.scale();
  }

  /** The cursor snapped; while drawing, the direction from the last point is tracked (Alt suspends it, Shift locks it to 45°). */
  private snapped(e: ToolPointer): Pick<SnapResult, 'point' | 'tangent'> {
    if (e.alt) return { point: e.world };
    const last = this.points.length ? this.points[this.points.length - 1].p : undefined;
    const from = this.arcNext && this.arcEnd ? undefined : last;
    const relativeTo: TrackReference[] = [...(this.previous ? [{ direction: this.previous, name: 'previous' }] : []), ...(this.startRef ? [this.startRef] : [])];
    return this.host.snap(e.world, { from, ortho: e.shift && Boolean(from), relativeTo }) ?? { point: e.world };
  }

  /** Ends a polyline: closed when asked (or when the outline must be a region); an open shape needs two points, a closed one three. */
  private finish(close: boolean): void {
    const region = this.host.options().shape.kind !== 'shape';
    const closed = close || region;
    if (this.points.length >= (closed ? 3 : 2)) this.commit(chainPath(this.points, closed));
    else this.reset();
  }

  private reset(): void {
    this.points = [];
    this.arcNext = false;
    this.arcEnd = null;
    this.previous = null;
    this.startRef = null;
    this.host.invalidate();
  }

  /** Makes what the options say from the outline: a shape, or a room, slab or void region (outlines counter-clockwise). */
  private commit(drawn: Path): void {
    const levelId = this.host.levelId();
    const { kind, filled } = this.host.options().shape;
    this.reset();
    if (!levelId) return;
    if (kind === 'shape') {
      void this.host.invoke('plan.shape.add', { levelId, path: drawn, filled });
      return;
    }
    if (!drawn.closed) return;
    const outer = signedArea(drawn) < 0 ? reversePath(drawn) : drawn;
    const region = { outer, holes: [] };
    if (kind === 'room') void this.host.invoke('plan.room.add', { levelId, region });
    else if (kind === 'slab') void this.host.invoke('plan.entity.add', { levelId, entity: { type: 'slab', source: { k: 'region', region } } });
    else void this.host.invoke('plan.entity.add', { levelId, entity: { type: 'void', region } });
  }
}

/** The axis-aligned rectangle between two opposite corners, counter-clockwise. */
export function rectBetween(a: Vec2, b: Vec2): Path {
  return rectPath(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
}

function chainPath(points: readonly ChainPoint[], closed: boolean): Path {
  const v: Vertex[] = points.map((c) => (c.bulge ? { p: c.p, s: { k: 'arc', bulge: c.bulge } } : { p: c.p }));
  return { closed, v };
}
