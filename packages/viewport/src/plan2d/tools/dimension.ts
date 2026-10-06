import { dimensionGeometry, distance, offsetTowards, resolveCoordinate, sub, type Coordinate, type Dimension, type DimensionKind, type DimensionPoints, type Vec2 } from '@studio/core';
import { drawDimensionGeometry, type RenderFrame } from '../render';
import type { SnapAnchor } from '../snap';
import type { Tool, ToolHost, ToolPointer } from './tool';

interface Picked {
  p: Vec2;
  /** The wall or shape vertex the point snapped to: the dimension's end follows it. */
  anchor?: SnapAnchor;
}

/**
 * Draws dimensions of the kind in the options. Aligned, horizontal and vertical: click the two
 * points, then where the dimension line goes (or type the distance). Angular: the corner, a point
 * on each side, then the arc's radius. Radius: the centre, then a point on the arc. A point that
 * snaps to a wall or shape corner ties the dimension to it.
 */
export class DimensionTool implements Tool {
  readonly id = 'dimension';
  private picked: Picked[] = [];
  private cursor: Vec2 | null = null;

  constructor(private readonly host: ToolHost) {}

  get busy(): boolean {
    return this.picked.length > 0;
  }

  private get kind(): DimensionKind {
    return this.host.options().dimension.kind;
  }

  /** How many points are clicked before the line is placed: an angle has its corner first; a radius needs no line. */
  private pointsNeeded(): number {
    return this.kind === 'angular' ? 3 : 2;
  }

  pointerDown(e: ToolPointer): void {
    if (e.button !== 0) return;
    const pick = this.snapped(e);
    if (this.picked.length < this.pointsNeeded()) {
      if (!this.picked.length) this.host.select([]);
      const last = this.picked[this.picked.length - 1];
      if (last && distance(last.p, pick.p) < 1e-6) return;
      this.picked.push(pick);
      if (this.kind === 'radius' && this.picked.length === 2) this.commit(0);
      this.host.invalidate();
      return;
    }
    this.commit(this.offsetAt(pick.p));
  }

  pointerMove(e: ToolPointer): void {
    this.cursor = this.snapped(e).p;
    this.host.invalidate();
  }

  key(e: KeyboardEvent): boolean {
    if (e.key === 'Enter' && this.picked.length >= this.pointsNeeded() && this.cursor) {
      this.commit(this.offsetAt(this.cursor));
      return true;
    }
    return false;
  }

  acceptsTyped(): boolean {
    return true;
  }

  /** Points as typed (a length runs from the last point towards the cursor); once the points are there, a length is the line's distance, on the cursor's side. */
  typed(_text: string, coord: Coordinate | null, cursor: Vec2 | null): boolean {
    if (!coord) return false;
    if (this.picked.length >= this.pointsNeeded()) {
      if (coord.k !== 'length') return false;
      const side = cursor ? Math.sign(this.offsetAt(cursor)) || 1 : 1;
      this.commit(coord.mm * side);
      return true;
    }
    const last = this.picked[this.picked.length - 1]?.p;
    const point = resolveCoordinate(coord, { from: last, direction: last && cursor ? sub(cursor, last) : undefined });
    if (!point) return false;
    this.pointerDown({ world: point, screen: [0, 0], button: 0, shift: false, ctrl: false, alt: true, clicks: 1 });
    return true;
  }

  cancel(): void {
    this.picked = [];
    this.host.invalidate();
  }

  hint(): string {
    const n = this.picked.length;
    const kind = this.kind;
    if (kind === 'angular') {
      if (n === 0) return 'Click the corner of the angle · V: select';
      if (n === 1) return 'Click a point on the first side';
      if (n === 2) return 'Click a point on the second side';
      return 'Click where the arc goes (or type its radius) · Enter: here · Escape: cancel';
    }
    if (kind === 'radius') return n === 0 ? 'Click the centre of the arc or circle · V: select' : 'Click a point on the arc (or type the radius)';
    if (n === 0) return `Click the first point of the ${kind} dimension · V: select`;
    if (n === 1) return 'Click the second point (a wall or shape corner ties the dimension to it)';
    return 'Click where the dimension line goes (or type the distance) · Enter: here · Escape: cancel';
  }

  draw(ctx: CanvasRenderingContext2D, frame: RenderFrame): void {
    if (!this.picked.length) return;
    const preview = this.preview(this.cursor);
    if (!preview) {
      ctx.fillStyle = frame.theme.selection;
      for (const pick of this.picked) {
        ctx.beginPath();
        ctx.arc(pick.p[0], pick.p[1], 3 / frame.camera.scale, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }
    drawDimensionGeometry(ctx, frame, dimensionGeometry(preview.e, preview.points, frame.units, 6 / frame.camera.scale), frame.theme.selection, null);
  }

  // ---------- internals ----------

  private snapped(e: ToolPointer): Picked {
    if (e.alt) return { p: e.world };
    const from = this.picked[this.picked.length - 1]?.p;
    const r = this.host.snap(e.world, { from, ortho: e.shift && Boolean(from) });
    return r ? { p: r.point, ...(r.anchor ? { anchor: r.anchor } : {}) } : { p: e.world };
  }

  /** The points so far, the cursor standing in for the next one. */
  private points(cursor: Vec2 | null): DimensionPoints | null {
    const picked = this.picked;
    if (this.kind === 'angular') {
      const vertex = picked[0]?.p;
      const from = picked[1]?.p ?? cursor;
      const to = picked[2]?.p ?? (picked[1] ? cursor : null);
      return vertex && from && to ? { vertex, from, to } : null;
    }
    const from = picked[0]?.p;
    const to = picked[1]?.p ?? cursor;
    return from && to ? { from, to } : null;
  }

  private offsetAt(cursor: Vec2): number {
    const points = this.points(null);
    return points ? offsetTowards(this.kind, points, cursor) : 0;
  }

  private preview(cursor: Vec2 | null): { e: Pick<Dimension, 'kind' | 'offset'>; points: DimensionPoints } | null {
    const complete = this.picked.length >= this.pointsNeeded();
    const points = this.points(complete ? null : cursor);
    if (!points) return null;
    const offset = complete && cursor ? this.offsetAt(cursor) : this.kind === 'angular' ? 500 : 0;
    return { e: { kind: this.kind, offset }, points };
  }

  private commit(offset: number): void {
    const levelId = this.host.levelId();
    const kind = this.kind;
    const points = this.points(null);
    const picked = this.picked;
    this.picked = [];
    this.host.invalidate();
    if (!levelId || !points) return;
    if (kind !== 'angular' && distance(points.from, points.to) < 1) return;
    const fromPick = kind === 'angular' ? picked[1] : picked[0];
    const toPick = kind === 'angular' ? picked[2] : picked[1];
    const anchors = kind === 'radius' ? {} : { ...(fromPick?.anchor ? { from: fromPick.anchor } : {}), ...(toPick?.anchor ? { to: toPick.anchor } : {}) };
    void this.host.invoke('plan.dimension.add', { levelId, kind, from: points.from, to: points.to, offset, ...(points.vertex ? { vertex: points.vertex } : {}), ...(Object.keys(anchors).length ? { anchors } : {}) });
  }
}
