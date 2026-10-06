import type { Entity, Vec2 } from '@studio/core';
import { drawEntityPreview, drawScreenText, type RenderFrame } from '../render';
import type { Tool, ToolHost, ToolPointer } from './tool';

type Column = Extract<Entity, { type: 'column' }>;

/**
 * Places columns: the column previews at the cursor (snapped to wall faces, centres and
 * endpoints like any point); a click puts it there with the size, rotation and span from the
 * options. A typed length sets a square or round column's size before the click.
 */
export class ColumnTool implements Tool {
  readonly id = 'column' as const;
  private cursor: Vec2 | null = null;

  constructor(private readonly host: ToolHost) {}

  get busy(): boolean {
    return false;
  }

  pointerDown(e: ToolPointer): void {
    if (e.button !== 0) return;
    const levelId = this.host.levelId();
    if (!levelId) return;
    const column = this.column(this.snapped(e), levelId);
    const { id: _id, levelId: _lv, layerId: _layer, ...entity } = column;
    void this.host.invoke('plan.entity.add', { levelId, entity });
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
    const o = this.host.options().column;
    const size = o.shape === 'circle' ? `⌀ ${2 * o.r} mm` : `${o.w} × ${o.d} mm`;
    return `Click where the column goes (${size}; the options set it) · V: select`;
  }

  draw(ctx: CanvasRenderingContext2D, frame: RenderFrame): void {
    const levelId = this.host.levelId();
    if (!this.cursor || !levelId) return;
    const column = this.column(this.cursor, levelId);
    ctx.globalAlpha = 0.8;
    drawEntityPreview(ctx, column, frame);
    ctx.globalAlpha = 1;
    if (column.span) drawScreenText(ctx, frame, { text: `up to ${this.host.levels().find((l) => l.id === column.span!.topLevelId)?.name ?? 'the level'}`, at: column.at, screenPx: 11, color: frame.theme.selection, align: 'center', baseline: 'bottom', dy: -10, mono: true });
  }

  // ---------- internals ----------

  /** The column as the options make it at a point. */
  private column(at: Vec2, levelId: string): Column {
    const o = this.host.options().column;
    const shape: Column['shape'] = o.shape === 'circle' ? { k: 'circle', r: o.r } : { k: 'rect', w: o.w, d: o.d };
    return { id: 'col_0000000000000000', type: 'column', levelId, layerId: '', at, shape, rotation: o.rotation, ...(o.topLevelId ? { span: { topLevelId: o.topLevelId, baseOffset: 0, topOffset: 0 } } : {}) };
  }

  private snapped(e: ToolPointer): Vec2 {
    if (e.alt) return e.world;
    return this.host.snap(e.world)?.point ?? e.world;
  }
}
