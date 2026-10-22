import type { Vec2 } from '@studio/core';
import { drawLightSymbol, drawScreenText, type RenderFrame } from '../render';
import type { Tool, ToolHost, ToolPointer } from './tool';

/**
 * Places lights: a point light, a spot (aimed straight down) or an area panel, from the options,
 * at the snapped click and the height the options give; the tool stays for the next one until Escape.
 */
export class LightTool implements Tool {
  readonly id = 'light' as const;
  private cursor: Vec2 | null = null;

  constructor(private readonly host: ToolHost) {}

  get busy(): boolean {
    return false;
  }

  pointerDown(e: ToolPointer): void {
    if (e.button !== 0) return;
    const levelId = this.host.levelId();
    if (!levelId) return;
    const o = this.host.options().light;
    const at = this.snapped(e);
    void this.host.invoke('decor.light.add', { levelId, kind: o.kind, at: [at[0], at[1], o.height], intensity: o.intensity });
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
    const o = this.host.options().light;
    return `Click where the ${o.kind === 'area' ? 'area light' : o.kind === 'spot' ? 'spot' : 'light'} goes (${o.intensity} lm, ${o.height} mm above the floor; the options set them) · Escape: done`;
  }

  draw(ctx: CanvasRenderingContext2D, frame: RenderFrame): void {
    if (!this.cursor) return;
    const o = this.host.options().light;
    ctx.globalAlpha = 0.8;
    drawLightSymbol(ctx, frame, { at: [this.cursor[0], this.cursor[1], o.height], kind: o.kind }, frame.theme.selection);
    ctx.globalAlpha = 1;
    drawScreenText(ctx, frame, { text: `${o.intensity} lm`, at: this.cursor, screenPx: 11, color: frame.theme.selection, align: 'center', baseline: 'top', dy: 16, mono: true });
  }

  private snapped(e: ToolPointer): Vec2 {
    if (e.alt) return e.world;
    return this.host.snap(e.world)?.point ?? e.world;
  }
}
