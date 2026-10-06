import { fitOpening, formatLength, nearestPoint, openingFrame, type Coordinate, type Entity, type Vec2 } from '@studio/core';
import { drawOpeningSymbol, drawScreenText, type RenderFrame } from '../render';
import type { Tool, ToolHost, ToolPointer } from './tool';

type Wall = Extract<Entity, { type: 'wall' }>;
type Opening = Extract<Entity, { type: 'opening' }>;

interface Hover {
  wall: Wall;
  /** Where the opening would go: the cursor projected on the wall, moved into the nearest free gap. */
  along: number;
  /** False when the wall has no room for it anywhere. */
  fits: boolean;
}

/**
 * Places doors and windows: hover a wall and the opening previews where the cursor projects on it,
 * moved into the nearest gap between the wall's ends and its other openings; click to place it.
 * A typed length places it that far from the wall's start (negative: from its end). For doors,
 * F flips the swing side and H the hinge while placing.
 */
export class OpeningTool implements Tool {
  private hover: Hover | null = null;
  private cursor: Vec2 | null = null;
  private hinge: 'start' | 'end' = 'start';
  private side: 'left' | 'right' = 'left';

  constructor(
    private readonly host: ToolHost,
    readonly id: 'door' | 'window',
  ) {}

  get busy(): boolean {
    return false;
  }

  pointerMove(e: ToolPointer): void {
    this.cursor = e.world;
    this.hover = this.target(e.world);
    this.host.invalidate();
  }

  pointerDown(e: ToolPointer): void {
    if (e.button !== 0) return;
    const hover = this.target(e.world);
    if (!hover || !hover.fits) return;
    void this.place(hover.wall, hover.along);
  }

  key(e: KeyboardEvent): boolean {
    if (this.id !== 'door') return false;
    const key = e.key.toLowerCase();
    if (key === 'f') {
      this.side = this.side === 'left' ? 'right' : 'left';
      this.host.invalidate();
      return true;
    }
    if (key === 'h') {
      this.hinge = this.hinge === 'start' ? 'end' : 'start';
      this.host.invalidate();
      return true;
    }
    return false;
  }

  acceptsTyped(): boolean {
    return this.hover !== null;
  }

  /** A typed length is the distance from the wall's start to the opening's centre (negative: from the end). */
  typed(_text: string, coord: Coordinate | null): boolean {
    if (!this.hover || !coord || coord.k !== 'length') return false;
    const wall = this.hover.wall;
    const fit = fitOpening(wall, this.others(wall), coord.mm < 0 ? fitOpening(wall, [], 0, 0).length + coord.mm : coord.mm, this.size().width);
    if (!fit.fits) return false;
    void this.place(wall, fit.along);
    return true;
  }

  cancel(): void {
    this.hover = null;
    this.host.invalidate();
  }

  hint(): string {
    const what = this.id === 'door' ? 'door' : 'window';
    if (!this.hover) return `Move over a wall to place a ${what} · V: select`;
    if (!this.hover.fits) return `No room for the ${what} on this wall`;
    return `Click to place the ${what} · type a distance from the wall's start${this.id === 'door' ? ' · F: flip side · H: flip hinge' : ''}`;
  }

  draw(ctx: CanvasRenderingContext2D, frame: RenderFrame): void {
    const hover = this.hover;
    if (!hover) return;
    const opening = this.preview(hover);
    const color = hover.fits ? frame.theme.selection : frame.theme.warning;
    drawOpeningSymbol(ctx, frame, hover.wall, opening, color, true);
    const f = openingFrame(hover.wall, opening);
    drawScreenText(ctx, frame, { text: `${formatLength(hover.along, frame.units)} from the start`, at: f.center, screenPx: 11, color, align: 'center', baseline: 'bottom', dy: -14, mono: true });
  }

  // ---------- internals ----------

  private size(): { width: number; height: number; sill: number } {
    const o = this.host.options();
    return this.id === 'door' ? { width: o.door.width, height: o.door.height, sill: 0 } : { width: o.window.width, height: o.window.height, sill: o.window.sill };
  }

  private others(wall: Wall): Opening[] {
    return Object.values(this.host.entities()).filter((e): e is Opening => e.type === 'opening' && e.wallId === wall.id);
  }

  /** The wall under the cursor (an opening counts as its wall) and where the opening would go on it. */
  private target(p: Vec2): Hover | null {
    const hit = this.host.hit(p);
    if (!hit) return null;
    const entities = this.host.entities();
    let wall = entities[hit.id];
    if (wall?.type === 'opening') wall = entities[wall.wallId];
    if (!wall || wall.type !== 'wall') return null;
    const along = nearestPoint(wall.path, p).along;
    const fit = fitOpening(wall, this.others(wall), along, this.size().width);
    return { wall, along: Number.isNaN(fit.along) ? along : fit.along, fits: !Number.isNaN(fit.along) };
  }

  private preview(hover: Hover): Opening {
    const size = this.size();
    return { id: 'preview', type: 'opening', levelId: hover.wall.levelId, layerId: hover.wall.layerId, kind: this.id, wallId: hover.wall.id, along: hover.along, width: size.width, height: size.height, sill: size.sill, ...(this.id === 'door' ? { swing: { hinge: this.hinge, side: this.side } } : {}) };
  }

  private place(wall: Wall, along: number): Promise<unknown> {
    const size = this.size();
    return this.host.invoke('plan.opening.add', { wallId: wall.id, kind: this.id, along, width: size.width, height: size.height, sill: size.sill, ...(this.id === 'door' ? { swing: { hinge: this.hinge, side: this.side } } : {}) });
  }
}
