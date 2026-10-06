import type { Vec2 } from '@studio/core';
import type { RenderFrame } from '../render';
import type { Tool, ToolHost, ToolPointer } from './tool';

/** Places labels: click where the text goes, type it in the input that opens there, Enter places it. */
export class LabelTool implements Tool {
  readonly id = 'label';
  readonly busy = false;
  private pending: Vec2 | null = null;

  constructor(private readonly host: ToolHost) {}

  pointerDown(e: ToolPointer): void {
    if (e.button !== 0) return;
    const levelId = this.host.levelId();
    if (!levelId) return;
    const at = e.alt ? e.world : (this.host.snap(e.world)?.point ?? e.world);
    this.host.select([]);
    this.pending = at;
    this.host.invalidate();
    this.host.requestText({
      screen: e.screen,
      placeholder: 'Label text',
      commit: (text) => {
        this.pending = null;
        const trimmed = text.trim();
        if (trimmed) void this.host.invoke('plan.entity.add', { levelId, entity: { type: 'label', text: trimmed, at, size: this.host.options().label.size } });
        this.host.invalidate();
      },
    });
  }

  cancel(): void {
    this.pending = null;
    this.host.invalidate();
  }

  hint(): string {
    return this.pending ? 'Type the label text · Enter: place it · Escape: cancel' : 'Click where the label goes · V: select';
  }

  draw(ctx: CanvasRenderingContext2D, frame: RenderFrame): void {
    if (!this.pending) return;
    const r = 4 / frame.camera.scale;
    ctx.strokeStyle = frame.theme.selection;
    ctx.lineWidth = 1 / frame.camera.scale;
    ctx.beginPath();
    ctx.moveTo(this.pending[0] - r, this.pending[1]);
    ctx.lineTo(this.pending[0] + r, this.pending[1]);
    ctx.moveTo(this.pending[0], this.pending[1] - r);
    ctx.lineTo(this.pending[0], this.pending[1] + r);
    ctx.stroke();
  }
}
