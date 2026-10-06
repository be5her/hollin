import { distance, type Coordinate, type Vec2, resolveCoordinate, sub } from '@studio/core';
import type { RenderFrame } from '../render';
import type { Tool, ToolHost, ToolPointer } from './tool';

/**
 * Draws room dividers: lines where there is no wall that split the space on either side into two
 * rooms. Click the points; Enter (or a double click) ends the line, Escape drops it.
 */
export class SeparatorTool implements Tool {
  readonly id = 'separator';
  private points: Vec2[] = [];
  private cursor: Vec2 | null = null;

  constructor(private readonly host: ToolHost) {}

  get busy(): boolean {
    return this.points.length > 0;
  }

  pointerDown(e: ToolPointer): void {
    if (e.button !== 0) return;
    const p = this.snapped(e);
    if (e.clicks >= 2 && this.points.length >= 2) {
      this.finish();
      return;
    }
    if (!this.points.length) this.host.select([]);
    else if (distance(p, this.points[this.points.length - 1]) < 1e-6) return;
    this.points.push(p);
    this.host.invalidate();
  }

  pointerMove(e: ToolPointer): void {
    this.cursor = this.snapped(e);
    this.host.invalidate();
  }

  key(e: KeyboardEvent): boolean {
    if (e.key === 'Enter') {
      this.finish();
      return true;
    }
    return false;
  }

  acceptsTyped(): boolean {
    return this.points.length > 0;
  }

  typed(_text: string, coord: Coordinate | null, cursor: Vec2 | null): boolean {
    if (!coord || !this.points.length) return false;
    const last = this.points[this.points.length - 1];
    const point = resolveCoordinate(coord, { from: last, direction: cursor ? sub(cursor, last) : undefined });
    if (!point) return false;
    this.points.push(point);
    this.host.invalidate();
    return true;
  }

  cancel(): void {
    this.points = [];
    this.host.invalidate();
  }

  hint(): string {
    if (!this.points.length) return 'Click the start of a room divider · V: select';
    return 'Click the next point · Enter or double-click: end · Escape: cancel';
  }

  draw(ctx: CanvasRenderingContext2D, frame: RenderFrame): void {
    if (!this.points.length) return;
    const pts = this.cursor ? [...this.points, this.cursor] : this.points;
    ctx.strokeStyle = frame.theme.selection;
    ctx.lineWidth = 1.5 / frame.camera.scale;
    ctx.setLineDash([8 / frame.camera.scale, 4 / frame.camera.scale]);
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private snapped(e: ToolPointer): Vec2 {
    if (e.alt) return e.world;
    const last = this.points.length ? this.points[this.points.length - 1] : undefined;
    return this.host.snap(e.world, { from: last, ortho: e.shift && Boolean(last) })?.point ?? e.world;
  }

  private finish(): void {
    const levelId = this.host.levelId();
    if (levelId && this.points.length >= 2) void this.host.invoke('plan.entity.add', { levelId, entity: { type: 'separator', path: { closed: false, v: this.points.map((p) => ({ p })) } } });
    this.points = [];
    this.host.invalidate();
  }
}
