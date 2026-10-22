import { faceOffset, flatten, offsetPath, roomAt, sideOfWall, type Entity, type Vec2, type WallSide } from '@studio/core';
import { tracePolygon } from '../draw';
import { drawScreenText, type RenderFrame } from '../render';
import { withAlpha } from '../theme';
import type { Tool, ToolHost, ToolPointer } from './tool';

type Target = { k: 'wall'; wall: Extract<Entity, { type: 'wall' }>; side: WallSide } | { k: 'room'; id: string };

/**
 * Paints with the material armed in the Catalog panel: the wall face under the cursor (the side of the
 * wall it is on) or the room's floor lights up, and a click gives it the material through
 * `decor.material.set`. The tool stays for the next surface until Escape.
 */
export class PaintTool implements Tool {
  readonly id = 'paint' as const;
  private hover: Target | null = null;
  private cursor: Vec2 | null = null;

  constructor(private readonly host: ToolHost) {}

  get busy(): boolean {
    return false;
  }

  pointerDown(e: ToolPointer): void {
    if (e.button !== 0) return;
    const ref = this.host.options().paint.ref;
    const target = this.targetAt(e.world);
    if (!ref || !target) return;
    void this.host.invoke('decor.material.set', { target: target.k === 'wall' ? { wallId: target.wall.id, side: target.side } : { roomId: target.id, surface: 'floor' }, material: ref });
  }

  pointerMove(e: ToolPointer): void {
    this.cursor = e.world;
    this.hover = this.targetAt(e.world);
    this.host.invalidate();
  }

  cancel(): void {
    this.hover = null;
    this.host.invalidate();
  }

  hint(): string {
    const o = this.host.options().paint;
    if (!o.ref) return 'Pick a material in the Catalog panel to paint with it · V: select';
    return `Click a wall face or a room's floor to give it ${o.name || o.ref} · Escape: done`;
  }

  draw(ctx: CanvasRenderingContext2D, frame: RenderFrame): void {
    const t = this.hover;
    if (!t || !this.cursor) return;
    ctx.strokeStyle = frame.theme.selection;
    ctx.fillStyle = withAlpha(frame.theme.selection, 0.12);
    if (t.k === 'wall') {
      const face = offsetPath(t.wall.path, faceOffset(t.wall, t.side));
      if (!face) return;
      const pts = flatten(face, 1);
      ctx.lineWidth = 4 / frame.camera.scale;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
      if (face.closed) ctx.closePath();
      ctx.stroke();
    } else {
      const room = this.host.geometry()?.rooms.get(t.id);
      if (!room?.polygon) return;
      ctx.lineWidth = 2 / frame.camera.scale;
      ctx.beginPath();
      tracePolygon(ctx, room.polygon);
      for (const h of room.holes) tracePolygon(ctx, h);
      ctx.fill('evenodd');
      ctx.stroke();
    }
    drawScreenText(ctx, frame, { text: t.k === 'wall' ? `${t.side} face` : 'floor', at: this.cursor, screenPx: 11, color: frame.theme.selection, align: 'left', baseline: 'top', dx: 14, dy: 12, mono: true });
  }

  /** The wall face under a point, else the floor of the room whose space it is in (anywhere in it, not only near its seed). */
  private targetAt(p: Vec2): Target | null {
    const hit = this.host.hit(p);
    const e = hit ? this.host.entities()[hit.id] : undefined;
    if (e?.type === 'wall') return { k: 'wall', wall: e, side: sideOfWall(e, p) };
    // Anything else (a room's badge, furniture standing on it): the floor of the room there.
    const room = roomAt(this.host.geometry()?.rooms.values() ?? [], p);
    return room ? { k: 'room', id: room.id } : null;
  }
}
