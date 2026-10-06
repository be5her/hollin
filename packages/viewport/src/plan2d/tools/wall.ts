import { DEG, bulgeThrough, distance, formatAngle, formatLength, resolveCoordinate, sub, wallBody, type Coordinate, type Path, type Vec2, type Vertex } from '@studio/core';
import { tracePolygon } from '../draw';
import { drawScreenText, type RenderFrame } from '../render';
import { withAlpha } from '../theme';
import type { Tool, ToolHost, ToolPointer } from './tool';

interface ChainPoint {
  p: Vec2;
  /** The arc from this point to the next, when it is not straight. */
  bulge?: number;
}

/**
 * Draws walls: click the points of a run; each click adds one wall from the last point (or, with
 * the "single wall" option, the whole run becomes one entity on Enter). `A` makes the next segment
 * an arc: click its end, then a point it passes through. Clicking the first point closes the run;
 * Enter ends it; Escape drops what is unfinished.
 */
export class WallTool implements Tool {
  readonly id = 'wall';
  private chain: ChainPoint[] = [];
  private cursor: Vec2 | null = null;
  private arcNext = false;
  private arcEnd: Vec2 | null = null;

  constructor(private readonly host: ToolHost) {}

  get busy(): boolean {
    return this.chain.length > 0;
  }

  pointerDown(e: ToolPointer): void {
    if (e.button !== 0) return;
    const p = this.snapped(e);
    if (!this.chain.length) {
      this.host.select([]);
      this.chain = [{ p }];
      this.host.invalidate();
      return;
    }
    const last = this.chain[this.chain.length - 1];
    if (this.arcNext) {
      if (!this.arcEnd) {
        if (distance(p, last.p) < 1e-6) return;
        this.arcEnd = p;
      } else {
        last.bulge = bulgeThrough(last.p, p, this.arcEnd) ?? 0;
        const end = this.arcEnd;
        this.arcEnd = null;
        this.arcNext = false;
        this.addPoint(end);
      }
      this.host.invalidate();
      return;
    }
    if (this.chain.length >= 2 && distance(p, this.chain[0].p) <= this.closeTolerance()) {
      this.close();
      return;
    }
    if (distance(p, last.p) < 1e-6) return;
    this.addPoint(p);
  }

  pointerMove(e: ToolPointer): void {
    this.cursor = this.snapped(e);
    this.host.invalidate();
  }

  /** The cursor snapped: to anything near; while drawing, also perpendicular, tangent and angle steps from the last point. Alt suspends it. */
  private snapped(e: ToolPointer): Vec2 {
    if (e.alt) return e.world;
    const last = this.chain.length ? this.chain[this.chain.length - 1].p : undefined;
    const from = this.arcNext && this.arcEnd ? undefined : last;
    return this.host.snap(e.world, { from, ortho: e.shift && Boolean(from) })?.point ?? e.world;
  }

  key(e: KeyboardEvent): boolean {
    if (e.key === 'a' || e.key === 'A') {
      if (!this.chain.length) return false;
      this.arcNext = !this.arcNext;
      this.arcEnd = null;
      this.host.invalidate();
      return true;
    }
    if (e.key === 'Enter') {
      this.finishRun(false);
      return true;
    }
    return false;
  }

  acceptsTyped(): boolean {
    return true;
  }

  /** A typed length runs from the last point towards the cursor; polar, relative and absolute forms as written. Without a start, only an absolute position starts the run. */
  typed(_text: string, coord: Coordinate | null, cursor: Vec2 | null): boolean {
    if (!coord) return false;
    const last = this.chain.length ? this.chain[this.chain.length - 1].p : undefined;
    const direction = last && cursor ? sub(cursor, last) : undefined;
    const point = resolveCoordinate(coord, { from: last, direction });
    if (!point) return false;
    this.pointerDown({ world: point, screen: [0, 0], button: 0, shift: false, ctrl: false, alt: true, clicks: 1 });
    return true;
  }

  cancel(): void {
    if (this.chain.length > 1 && this.host.options().wall.single) {
      this.finishRun(false);
      return;
    }
    this.reset();
  }

  hint(): string {
    if (!this.chain.length) return 'Click the start of a wall · V: select';
    if (this.arcNext) return this.arcEnd ? 'Click a point the arc passes through' : 'Click the end of the arc · A: straight';
    return 'Click the next point · A: arc · click the first point to close · Enter: end · Escape: cancel';
  }

  draw(ctx: CanvasRenderingContext2D, frame: RenderFrame): void {
    if (!this.chain.length) return;
    const { theme } = frame;
    const options = this.host.options().wall;
    const preview: ChainPoint[] = [...this.chain.map((c) => ({ ...c }))];
    const cursor = this.cursor;
    if (cursor) {
      const last = preview[preview.length - 1];
      if (this.arcNext && this.arcEnd) {
        last.bulge = bulgeThrough(last.p, cursor, this.arcEnd) ?? 0;
        preview.push({ p: this.arcEnd });
      } else if (distance(cursor, last.p) > 1e-6) preview.push({ p: cursor });
    }
    if (preview.length < 2) return;
    const path = chainPath(preview, false);
    const body = wallBody({ path, thickness: options.thickness, alignment: options.alignment });
    ctx.fillStyle = withAlpha(theme.wall, 0.45);
    ctx.strokeStyle = theme.wallLine;
    ctx.lineWidth = 1 / frame.camera.scale;
    ctx.beginPath();
    for (const poly of body.polygons) tracePolygon(ctx, poly);
    ctx.fill('nonzero');
    ctx.stroke();
    // The reference line, dashed.
    ctx.strokeStyle = theme.selection;
    ctx.setLineDash([6 / frame.camera.scale, 4 / frame.camera.scale]);
    ctx.beginPath();
    ctx.moveTo(preview[0].p[0], preview[0].p[1]);
    for (let i = 1; i < preview.length; i++) ctx.lineTo(preview[i].p[0], preview[i].p[1]);
    ctx.stroke();
    ctx.setLineDash([]);
    // The length of the segment being drawn.
    const a = preview[preview.length - 2].p;
    const b = preview[preview.length - 1].p;
    const d = distance(a, b);
    if (d > 0) {
      const angle = Math.atan2(b[1] - a[1], b[0] - a[0]) / DEG;
      drawScreenText(ctx, frame, { text: `${formatLength(d, frame.units)} · ${formatAngle(((angle % 360) + 360) % 360, { precision: 1 })}`, at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], screenPx: 11, color: theme.selection, align: 'center', baseline: 'bottom', dy: -6, mono: true });
    }
  }

  // ---------- internals ----------

  private closeTolerance(): number {
    return 8 / this.host.scale();
  }

  private addPoint(p: Vec2): void {
    const last = this.chain[this.chain.length - 1];
    if (this.host.options().wall.single) {
      this.chain.push({ p });
    } else {
      void this.commit([{ ...last }, { p }], false);
      this.chain = [this.chain[0], { p }];
      if (this.chain[0].p === p) this.chain = [{ p }];
    }
    this.host.invalidate();
  }

  private close(): void {
    const last = this.chain[this.chain.length - 1];
    if (this.host.options().wall.single) {
      this.finishRun(true);
      return;
    }
    void this.commit([{ ...last }, { p: this.chain[0].p }], false);
    this.reset();
  }

  private finishRun(closed: boolean): void {
    if (this.host.options().wall.single && this.chain.length >= 2) void this.commit(this.chain, closed);
    this.reset();
  }

  private reset(): void {
    this.chain = [];
    this.arcNext = false;
    this.arcEnd = null;
    this.host.invalidate();
  }

  private commit(points: ChainPoint[], closed: boolean): Promise<unknown> {
    const levelId = this.host.levelId();
    if (!levelId) return Promise.resolve();
    const { thickness, height, alignment, single } = this.host.options().wall;
    return this.host.invoke('plan.wall.add', { levelId, points: points.map((c) => (c.bulge ? { p: c.p, bulge: c.bulge } : { p: c.p })), closed, thickness, height, alignment, single });
  }
}

/** The run as a path. */
export function chainPath(points: readonly ChainPoint[], closed: boolean): Path {
  const v: Vertex[] = points.map((c) => (c.bulge ? { p: c.p, s: { k: 'arc', bulge: c.bulge } } : { p: c.p }));
  return { closed, v };
}
