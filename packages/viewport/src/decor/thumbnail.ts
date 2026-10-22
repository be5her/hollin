import { builtinMaterial, parseRef, recipeMeshes, type Recipe } from '@studio/core';

/** Triangles to draw (mm, z up, flat) in one colour (`#rrggbb`). */
export interface ThumbPart {
  positions: Float32Array;
  color: string;
}

/** The colour a material reference shows as: a built-in's base colour, a paint, or grey. */
export function materialColor(ref: string | undefined): string {
  const parsed = ref ? parseRef(ref) : null;
  if (parsed?.k === 'paint') return parsed.color;
  if (parsed?.k === 'builtin') return builtinMaterial(parsed.id)?.color ?? '#b0b0b0';
  return '#b0b0b0';
}

/** A recipe's slot meshes in their materials (the item's overrides first). */
export function recipeThumbParts(recipe: Recipe, overrides: Readonly<Record<string, string>> = {}): ThumbPart[] {
  return recipeMeshes(recipe).map(({ slot, mesh }) => ({ positions: mesh.positions, color: materialColor(overrides[slot] ?? recipe.slots[slot]) }));
}

const rgbOf = (c: string): [number, number, number] => {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Linear RGB (0–1) as `#rrggbb`, sRGB-encoded, for a glTF base colour. */
export function linearToHex([r, g, b]: readonly [number, number, number]): string {
  const enc = (v: number) => {
    const c = Math.max(0, Math.min(1, v));
    const s = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
    return Math.round(s * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${enc(r)}${enc(g)}${enc(b)}`;
}

/**
 * A model drawn from the south-west and above (its front, −y, towards the viewer) onto a 2D canvas
 * of `size` × `size` pixels: triangles sorted back to front, faces turned away left out, each shaded
 * by a light from the upper left. No 3D engine, so any number of thumbnails is cheap.
 */
export function drawThumbnail(ctx: CanvasRenderingContext2D, parts: readonly ThumbPart[], size: number, options: { azimuth?: number; elevation?: number; margin?: number } = {}): void {
  const az = ((options.azimuth ?? 235) * Math.PI) / 180;
  const el = ((options.elevation ?? 28) * Math.PI) / 180;
  // The direction looked from, and the screen axes.
  const view = [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)];
  const right = [-Math.sin(az), Math.cos(az), 0];
  const up = [view[1] * right[2] - view[2] * right[1], view[2] * right[0] - view[0] * right[2], view[0] * right[1] - view[1] * right[0]];
  const light = [view[0] * 0.5 - right[0] * 0.6 + 0.4 * up[0], view[1] * 0.5 - right[1] * 0.6 + 0.4 * up[1], view[2] * 0.5 + 0.6];
  const ll = Math.hypot(light[0], light[1], light[2]);
  const tris: { pts: [number, number][]; depth: number; color: string }[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const part of parts) {
    const rgb = rgbOf(part.color);
    const p = part.positions;
    for (let i = 0; i + 8 < p.length; i += 9) {
      const a = [p[i], p[i + 1], p[i + 2]];
      const b = [p[i + 3], p[i + 4], p[i + 5]];
      const c = [p[i + 6], p[i + 7], p[i + 8]];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const nl = Math.hypot(n[0], n[1], n[2]);
      if (nl < 1e-9) continue;
      if (n[0] * view[0] + n[1] * view[1] + n[2] * view[2] <= 0) continue;
      const shade = 0.45 + 0.55 * Math.max(0, (n[0] * light[0] + n[1] * light[1] + n[2] * light[2]) / (nl * ll));
      const pts = [a, b, c].map((q): [number, number] => [q[0] * right[0] + q[1] * right[1] + q[2] * right[2], q[0] * up[0] + q[1] * up[1] + q[2] * up[2]]);
      for (const [x, y] of pts) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
      const depth = (a[0] + b[0] + c[0]) * view[0] + (a[1] + b[1] + c[1]) * view[1] + (a[2] + b[2] + c[2]) * view[2];
      tris.push({ pts, depth, color: `rgb(${Math.round(rgb[0] * shade)}, ${Math.round(rgb[1] * shade)}, ${Math.round(rgb[2] * shade)})` });
    }
  }
  if (!tris.length) return;
  const margin = options.margin ?? 0.08;
  const k = (size * (1 - 2 * margin)) / Math.max(maxX - minX, maxY - minY, 1e-6);
  const ox = size / 2 - ((minX + maxX) / 2) * k;
  const oy = size / 2 + ((minY + maxY) / 2) * k;
  tris.sort((s, t) => s.depth - t.depth);
  ctx.lineJoin = 'round';
  ctx.lineWidth = 0.6;
  for (const t of tris) {
    ctx.fillStyle = t.color;
    ctx.strokeStyle = t.color;
    ctx.beginPath();
    ctx.moveTo(ox + t.pts[0][0] * k, oy - t.pts[0][1] * k);
    ctx.lineTo(ox + t.pts[1][0] * k, oy - t.pts[1][1] * k);
    ctx.lineTo(ox + t.pts[2][0] * k, oy - t.pts[2][1] * k);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}
