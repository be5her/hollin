import { cavityAt, formatArea, labelPoint, type Cavity, type Vec2 } from '@studio/core';
import { tracePolygon } from '../draw';
import { drawScreenText, type RenderFrame } from '../render';
import { withAlpha } from '../theme';
import type { Tool, ToolHost, ToolPointer } from './tool';

/** Makes rooms: hover an enclosed space and it lights up with its area; click to make it a room. */
export class RoomTool implements Tool {
  readonly id = 'room';
  readonly busy = false;
  private hover: Cavity | null = null;

  constructor(private readonly host: ToolHost) {}

  pointerMove(e: ToolPointer): void {
    const cavities = this.host.geometry()?.cavities ?? [];
    this.hover = cavityAt(cavities, e.world);
    this.host.invalidate();
  }

  pointerDown(e: ToolPointer): void {
    if (e.button !== 0) return;
    const levelId = this.host.levelId();
    const cavity = cavityAt(this.host.geometry()?.cavities ?? [], e.world);
    if (!levelId || !cavity) return;
    void this.host.invoke('plan.room.add', { levelId, seed: e.world });
  }

  cancel(): void {
    this.hover = null;
    this.host.invalidate();
  }

  hint(): string {
    return this.hover ? 'Click to make this space a room · V: select' : 'Move into a space enclosed by walls (or dividers) · V: select';
  }

  draw(ctx: CanvasRenderingContext2D, frame: RenderFrame): void {
    const c = this.hover;
    if (!c) return;
    ctx.fillStyle = withAlpha(frame.theme.room, 0.18);
    ctx.strokeStyle = frame.theme.room;
    ctx.lineWidth = 2 / frame.camera.scale;
    ctx.beginPath();
    tracePolygon(ctx, c.polygon);
    for (const island of c.islands) tracePolygon(ctx, island);
    ctx.fill('evenodd');
    ctx.stroke();
    const at: Vec2 = labelPoint(c.polygon, c.islands);
    drawScreenText(ctx, frame, { text: formatArea(c.area, frame.units), at, screenPx: 12, color: frame.theme.room, align: 'center', baseline: 'middle', mono: true });
  }
}
