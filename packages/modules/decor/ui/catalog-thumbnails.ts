import { DOCUMENT, Service, inject } from '@angular/core';
import { builtinMaterial, builtinRecipe, inspectGlb, parseRef, readGlbTriangles, type CatalogEntry } from '@studio/core';
import { HostBridge } from '@studio/ui';
import { drawMaterialTile, drawThumbnail, linearToHex, patternTile, recipeThumbParts } from '@studio/viewport';

/** Thumbnails are drawn at this many CSS pixels a side, at twice the resolution. */
const SIZE = 112;
/** A material swatch shows this many millimetres across. */
const SWATCH_MM = 1200;

/**
 * Pictures for the Catalog panel. Built-in furniture and materials are drawn on demand in the
 * window (a 2D projection of the recipe, a tile of the pattern) and kept in memory. Imported models
 * are drawn once after import from their GLB and stored with the library (`catalog.thumbnail.set`),
 * so the panel shows them over `library://`.
 */
@Service()
export class CatalogThumbnails {
  private readonly document = inject(DOCUMENT);
  private readonly host = inject(HostBridge);
  private readonly cache = new Map<string, string>();
  private readonly drawing = new Set<string>();

  start(): void {
    this.host.on('catalog.changed', (e) => {
      if (e.reason === 'imported' && e.file) void this.storeModelThumbnail(e.file);
    });
  }

  /** The picture of an entry: a data URL for built-ins, a `library://` URL for imported models with a stored thumbnail, else null. */
  url(entry: CatalogEntry): string | null {
    const parsed = parseRef(entry.ref);
    if (parsed?.k === 'asset') {
      if (entry.source === 'library' && entry.thumbnail) return `library://catalog/furniture/${parsed.file.replace(/\.glb$/, '.png')}?v=${encodeURIComponent(entry.thumbnail)}`;
      if (entry.source === 'library' && !this.drawing.has(parsed.file)) void this.storeModelThumbnail(parsed.file);
      return null;
    }
    const cached = this.cache.get(entry.ref);
    if (cached) return cached;
    const drawn = parsed?.k === 'builtin' ? (entry.kind === 'material' ? this.swatch(parsed.id) : entry.kind === 'item' ? this.item(parsed.id) : null) : null;
    if (drawn) this.cache.set(entry.ref, drawn);
    return drawn;
  }

  private canvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
    const canvas = this.document.createElement('canvas');
    canvas.width = SIZE * 2;
    canvas.height = SIZE * 2;
    const ctx = canvas.getContext('2d');
    return ctx ? { canvas, ctx } : null;
  }

  private item(id: string): string | null {
    const recipe = builtinRecipe(id);
    const c = recipe ? this.canvas() : null;
    if (!recipe || !c) return null;
    drawThumbnail(c.ctx, recipeThumbParts(recipe), SIZE * 2);
    return c.canvas.toDataURL('image/png');
  }

  private swatch(id: string): string | null {
    const material = builtinMaterial(id);
    const c = material ? this.canvas() : null;
    if (!material || !c) return null;
    const px = (SIZE * 2) / SWATCH_MM;
    if (material.pattern) {
      const [tw, th] = patternTile(material.pattern);
      const tile = this.document.createElement('canvas');
      tile.width = Math.max(2, Math.round(tw * px));
      tile.height = Math.max(2, Math.round(th * px));
      const tctx = tile.getContext('2d');
      if (tctx) {
        drawMaterialTile(tctx, material, tile.width, tile.height);
        const pattern = c.ctx.createPattern(tile, 'repeat');
        if (pattern) {
          c.ctx.fillStyle = pattern;
          c.ctx.fillRect(0, 0, SIZE * 2, SIZE * 2);
        }
      }
    } else {
      c.ctx.fillStyle = material.color;
      c.ctx.fillRect(0, 0, SIZE * 2, SIZE * 2);
    }
    if (material.opacity !== undefined || material.metalness > 0.5) {
      // A sheen across glass and metal, so they read as such.
      const g = c.ctx.createLinearGradient(0, 0, SIZE * 2, SIZE * 2);
      g.addColorStop(0, 'rgba(255,255,255,0.45)');
      g.addColorStop(0.5, 'rgba(255,255,255,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.2)');
      c.ctx.fillStyle = g;
      c.ctx.fillRect(0, 0, SIZE * 2, SIZE * 2);
    }
    return c.canvas.toDataURL('image/png');
  }

  /** Draws an imported model from its GLB and stores the picture with the library. */
  private async storeModelThumbnail(file: string): Promise<void> {
    if (this.drawing.has(file)) return;
    this.drawing.add(file);
    try {
      const response = await fetch(`library://catalog/furniture/${file}`);
      if (!response.ok) return;
      const bytes = new Uint8Array(await response.arrayBuffer());
      inspectGlb(bytes);
      const c = this.canvas();
      if (!c) return;
      drawThumbnail(c.ctx, readGlbTriangles(bytes).map((t) => ({ positions: t.positions, color: linearToHex(t.color) })), SIZE * 2);
      const png = c.canvas.toDataURL('image/png').slice('data:image/png;base64,'.length);
      await this.host.invoke('catalog.thumbnail.set', { ref: `asset:${file}`, png }, null);
    } catch (err) {
      console.warn(`[catalog] no thumbnail for ${file}: ${(err as Error).message}`);
    }
  }
}
