import type { BuiltinMaterial, MaterialPattern } from '@studio/core';

/** A small deterministic random sequence, so a pattern looks the same every time it is drawn. */
function random(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `#rrggbb` lightened (k > 0) or darkened (k < 0) by a fraction. */
export function shadeHex(color: string, k: number): string {
  const n = parseInt(color.slice(1), 16);
  const f = (v: number) => Math.round(Math.max(0, Math.min(255, k >= 0 ? v + (255 - v) * k : v * (1 + k))));
  return `rgb(${f((n >> 16) & 255)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
}

/**
 * The size of one seamless tile of a pattern, mm (along u, along v): planks repeat every four rows,
 * bricks every two, a chevron of parquet every two blocks; tiles and noise every repeat.
 */
export function patternTile(p: MaterialPattern): [number, number] {
  const [a, b] = p.size;
  switch (p.k) {
    case 'planks':
      return [a, b * 4];
    case 'brick':
      return [a, b * 2];
    case 'herringbone':
      return [b * 2 * Math.SQRT2, a * Math.SQRT2];
    default:
      return [a, b];
  }
}

/**
 * Draws one seamless tile of a material into `w` × `h` pixels (the tile's `patternTile` mm): its base
 * colour, and its pattern (plank and brick joints, tile grout, a chevron parquet, mottled noise) in
 * its second colour. A material without a pattern is its colour alone.
 */
export function drawMaterialTile(ctx: CanvasRenderingContext2D, m: Pick<BuiltinMaterial, 'id' | 'color' | 'pattern'>, w: number, h: number): void {
  ctx.fillStyle = m.color;
  ctx.fillRect(0, 0, w, h);
  const p = m.pattern;
  if (!p) return;
  const [tw, th] = patternTile(p);
  const sx = w / tw;
  const sy = h / th;
  const rand = random(m.id);
  const joint = Math.max(1, (p.joint ?? 2) * Math.min(sx, sy));
  ctx.strokeStyle = p.color2;
  ctx.fillStyle = p.color2;
  ctx.lineWidth = joint;
  switch (p.k) {
    case 'tiles': {
      ctx.strokeRect(joint / 2, joint / 2, w - joint, h - joint);
      return;
    }
    case 'planks':
    case 'brick': {
      const rows = p.k === 'planks' ? 4 : 2;
      const rowH = h / rows;
      for (let r = 0; r < rows; r++) {
        const y = r * rowH;
        const offset = p.k === 'brick' ? (r % 2) * (w / 2) : Math.floor(rand() * 8) * (w / 8);
        // A plank's own tone, so boards read apart.
        if (p.k === 'planks') {
          ctx.fillStyle = shadeHex(m.color, (rand() - 0.5) * 0.12);
          ctx.fillRect(0, y, w, rowH);
          ctx.fillStyle = p.color2;
        }
        ctx.beginPath();
        ctx.moveTo(0, y + joint / 2);
        ctx.lineTo(w, y + joint / 2);
        for (const x of [offset, offset - w]) {
          ctx.moveTo(x + joint / 2, y);
          ctx.lineTo(x + joint / 2, y + rowH);
        }
        ctx.stroke();
      }
      return;
    }
    case 'herringbone': {
      // Blocks at 45° in two columns, leaning opposite ways: a chevron parquet.
      const half = w / 2;
      for (let col = 0; col < 2; col++) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(col * half, 0, half, h);
        ctx.clip();
        const dir = col === 0 ? 1 : -1;
        const step = h / 2;
        for (let k = -2; k <= 3; k++) {
          ctx.fillStyle = shadeHex(m.color, (rand() - 0.5) * 0.14);
          const y0 = k * step;
          ctx.beginPath();
          ctx.moveTo(col * half, y0 + (dir > 0 ? half : 0));
          ctx.lineTo((col + 1) * half, y0 + (dir > 0 ? 0 : half));
          ctx.lineTo((col + 1) * half, y0 + step + (dir > 0 ? 0 : half));
          ctx.lineTo(col * half, y0 + step + (dir > 0 ? half : 0));
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
        ctx.restore();
      }
      return;
    }
    case 'noise': {
      const spots = Math.round(40 + rand() * 30);
      for (let i = 0; i < spots; i++) {
        ctx.globalAlpha = 0.25 + rand() * 0.35;
        const r = (0.02 + rand() * 0.06) * Math.min(w, h);
        const x = rand() * w;
        const y = rand() * h;
        // Drawn wrapped, so the tile repeats without a seam.
        for (const dx of [-w, 0, w]) {
          for (const dy of [-h, 0, h]) {
            ctx.beginPath();
            ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      ctx.globalAlpha = 1;
      return;
    }
  }
}
