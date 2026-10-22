import { itemFootprint, itemModel, type Vec2 } from '@studio/core';
import { tracePolygon } from '../draw';
import { drawScreenText, type RenderFrame } from '../render';
import { withAlpha } from '../theme';
import type { Tool, ToolHost, ToolPointer } from './tool';

/** How far R, Shift+R and Shift+wheel turn the item being placed, degrees. */
export const ITEM_TURN_STEP = 15;

/**
 * Places furniture: the model armed in the options (from the Catalog panel) follows the cursor as a
 * ghost, snapped like any point; R turns it 15° (Shift+R back, or Shift with the wheel), a click
 * places it with `decor.item.place`, and the tool stays for the next one until Escape.
 */
export class ItemTool implements Tool {
  readonly id = 'item' as const;
  private cursor: Vec2 | null = null;
  private turn: number | null = null;

  constructor(private readonly host: ToolHost) {}

  get busy(): boolean {
    return false;
  }

  /** The turn the next item gets: what R and the wheel made of the armed rotation. */
  get rotation(): number {
    return this.turn ?? this.host.options().item.rotation;
  }

  pointerDown(e: ToolPointer): void {
    if (e.button !== 0) return;
    const levelId = this.host.levelId();
    const o = this.host.options().item;
    if (!levelId || !o.ref) return;
    const at = this.snapped(e);
    void this.host.invoke('decor.item.place', { levelId, ref: o.ref, at, rotation: this.rotation, ...(o.withLight ? { withLight: true } : {}) });
  }

  pointerMove(e: ToolPointer): void {
    this.cursor = this.snapped(e);
    this.host.invalidate();
  }

  key(e: KeyboardEvent): boolean {
    if (e.ctrlKey || e.metaKey || e.altKey || e.key.toLowerCase() !== 'r') return false;
    this.rotateBy(e.shiftKey ? -ITEM_TURN_STEP : ITEM_TURN_STEP);
    return true;
  }

  wheel(e: WheelEvent): boolean {
    if (!e.shiftKey) return false;
    // Shift turns some mice's wheel into a horizontal one.
    const delta = e.deltaY || e.deltaX;
    if (!delta) return false;
    this.rotateBy(delta < 0 ? ITEM_TURN_STEP : -ITEM_TURN_STEP);
    return true;
  }

  cancel(): void {
    this.cursor = null;
    this.turn = null;
    this.host.invalidate();
  }

  hint(): string {
    const o = this.host.options().item;
    if (!o.ref) return 'Pick a model in the Catalog panel to place it · V: select';
    return `Click to place ${o.name || 'the model'} (turned ${this.rotation}°) · R: turn 15° (Shift+R back, Shift+wheel) · Escape: done`;
  }

  draw(ctx: CanvasRenderingContext2D, frame: RenderFrame): void {
    const o = this.host.options().item;
    if (!this.cursor || !o.ref) return;
    const model = itemModel(o.ref, this.host.assets(), o.size ? { name: o.name, size: o.size, ...(o.min ? { min: o.min } : {}) } : undefined);
    const polys = itemFootprint({ at: [this.cursor[0], this.cursor[1], 0], rotation: [0, 0, this.rotation], scale: [1, 1, 1] }, model);
    ctx.fillStyle = withAlpha(frame.theme.selection, 0.15);
    ctx.strokeStyle = frame.theme.selection;
    ctx.lineWidth = 1.5 / frame.camera.scale;
    ctx.setLineDash([6 / frame.camera.scale, 4 / frame.camera.scale]);
    ctx.beginPath();
    for (const poly of polys) tracePolygon(ctx, poly);
    ctx.fill('nonzero');
    ctx.stroke();
    ctx.setLineDash([]);
    drawScreenText(ctx, frame, { text: `${o.name || model.name} · ${this.rotation}°`, at: this.cursor, screenPx: 11, color: frame.theme.selection, align: 'center', baseline: 'top', dy: 14, mono: true });
  }

  private rotateBy(degrees: number): void {
    let next = this.rotation + degrees;
    next = ((((next + 180) % 360) + 360) % 360) - 180;
    this.turn = next === -180 ? 180 : next;
    this.host.invalidate();
  }

  private snapped(e: ToolPointer): Vec2 {
    if (e.alt) return e.world;
    return this.host.snap(e.world)?.point ?? e.world;
  }
}
