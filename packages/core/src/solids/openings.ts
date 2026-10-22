import { DEFAULT_STYLE, builtinStyle, type OpeningStyle } from '../decor/builtin';
import { parseRef } from '../decor/refs';
import type { EntityOf } from '../doc/schema';
import { openingFrame } from '../geometry/openings';
import { polygonArea, type Polygon } from '../geometry/polygon';
import { add, scale } from '../geometry/vec';
import type { WallLike } from '../geometry/walls';
import { MeshBuilder } from './mesh';

/** A door leaf's thickness, mm. */
export const LEAF_THICKNESS = 40;
/** A window casement's frame: its face width and depth, mm. */
const SASH = 50;
const SASH_DEPTH = 60;
const MULLION = 40;

/** The parts an opening's style adds, by what they are made of: frames and leaves, each in its slot's material. */
export interface OpeningParts {
  /** Boxes lining the opening (jambs, head, a window's sill board), casements and mullions. */
  frame: MeshBuilder;
  /** A door's leaf, open at 90° on its swing side. */
  leaf: MeshBuilder;
  /** Glass in a glazed door's leaf. */
  glass: MeshBuilder;
  style: OpeningStyle;
}

/** The style an opening is drawn with: its own, else a flush door or a fixed window; null for a plain opening. */
export function openingStyleOf(opening: Pick<EntityOf<'opening'>, 'kind' | 'style'>): OpeningStyle | null {
  if (opening.kind === 'opening') return null;
  const parsed = opening.style ? parseRef(opening.style) : null;
  const own = parsed?.k === 'builtin' ? builtinStyle(parsed.id) : undefined;
  return own && own.kind === opening.kind ? own : (builtinStyle(DEFAULT_STYLE[opening.kind]) ?? null);
}

const ccw = (poly: Polygon): Polygon => (polygonArea(poly) < 0 ? [...poly].reverse() : poly);

/**
 * The frame and leaf of a door or window, in the building's coordinates (mm, z up), between `z0`
 * (its sill) and `z1` (its head) as built, and `top`, where the solids stop drawing (the cutaway's
 * cut; Infinity otherwise): parts above it are left out and parts across it are cut there.
 *
 * Positions are taken across the opening in its own frame: `u` along the wall from the opening's
 * centre, `v` across it (left positive, from the wall's reference line).
 */
export function openingParts(wall: WallLike, opening: EntityOf<'opening'>, z0: number, z1: number, top = Infinity): OpeningParts | null {
  const style = openingStyleOf(opening);
  if (!style) return null;
  const f = openingFrame(wall, opening);
  const at = (u: number, v: number) => add(add(f.center, scale(f.tangent, u)), scale(f.normal, v));
  const rect = (u0: number, u1: number, v0: number, v1: number): Polygon => ccw([at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)]);
  const box = (b: MeshBuilder, u0: number, u1: number, v0: number, v1: number, h0: number, h1: number) => {
    const hi = Math.min(h1, top);
    if (hi > h0 + 1e-6 && u1 > u0 && v1 > v0) b.prism([rect(u0, u1, v0, v1)], h0, hi);
  };
  const parts: OpeningParts = { frame: new MeshBuilder(), leaf: new MeshBuilder(), glass: new MeshBuilder(), style };
  const half = opening.width / 2;
  const fw = Math.min(style.frame.width, half / 2, (z1 - z0) / 3);
  const v0 = f.across.right - style.frame.proud;
  const v1 = f.across.left + style.frame.proud;

  // The lining: both jambs, the head, and under a window its sill board.
  box(parts.frame, -half, -half + fw, v0, v1, z0, z1);
  box(parts.frame, half - fw, half, v0, v1, z0, z1);
  if (z1 <= top) box(parts.frame, -half + fw, half - fw, v0, v1, z1 - fw, z1);
  if (opening.kind === 'window') box(parts.frame, -half + fw, half - fw, v0, v1, z0, z0 + fw);

  if (opening.kind === 'door') {
    // The leaf hangs on the hinge jamb's inner edge at the face of its swing side, turned 90° into that side.
    const hingeAtEnd = opening.swing?.hinge === 'end';
    const side = opening.swing?.side === 'right' ? -1 : 1;
    const clear = opening.width - 2 * fw;
    const uHinge = hingeAtEnd ? half - fw : -half + fw;
    const inward = hingeAtEnd ? -1 : 1;
    const face = side > 0 ? f.across.left : f.across.right;
    const leafTop = z1 - fw;
    const uA = Math.min(uHinge, uHinge + inward * LEAF_THICKNESS);
    const uB = Math.max(uHinge, uHinge + inward * LEAF_THICKNESS);
    const vA = Math.min(face, face + side * clear);
    const vB = Math.max(face, face + side * clear);
    if (style.leaf === 'glazed') {
      // Stiles and rails round a pane.
      const rail = Math.min(120, clear / 5);
      box(parts.leaf, uA, uB, vA, vA + rail, z0, leafTop);
      box(parts.leaf, uA, uB, vB - rail, vB, z0, leafTop);
      box(parts.leaf, uA, uB, vA + rail, vB - rail, z0, z0 + 3 * rail);
      box(parts.leaf, uA, uB, vA + rail, vB - rail, leafTop - rail, leafTop);
      const mid = (uA + uB) / 2;
      box(parts.glass, mid - 4, mid + 4, vA + rail, vB - rail, z0 + 3 * rail, leafTop - rail);
    } else {
      box(parts.leaf, uA, uB, vA, vB, z0, leafTop);
      if (style.leaf === 'panel') {
        // Four raised panels on each face of the leaf.
        const margin = Math.min(110, clear / 6);
        const w = (vB - vA - 3 * margin) / 2;
        const h = (leafTop - z0 - 3 * margin) / 2;
        for (const [pu0, pu1] of [
          [uA - 6, uA],
          [uB, uB + 6],
        ]) {
          for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) box(parts.leaf, pu0, pu1, vA + margin + i * (w + margin), vA + margin + i * (w + margin) + w, z0 + margin + j * (h + margin), z0 + margin + j * (h + margin) + h);
        }
      }
    }
  } else {
    // Casements: a sash round each pane in the middle of the wall; mullions between fixed panes.
    const mid = (f.across.left + f.across.right) / 2;
    const s0 = mid - SASH_DEPTH / 2;
    const s1 = mid + SASH_DEPTH / 2;
    const inner = { u0: -half + fw, u1: half - fw, z0: z0 + fw, z1: z1 - fw };
    const n = style.casements ?? 0;
    for (let i = 0; i < n; i++) {
      const a = inner.u0 + ((inner.u1 - inner.u0) * i) / n;
      const b = inner.u0 + ((inner.u1 - inner.u0) * (i + 1)) / n;
      box(parts.frame, a, a + SASH, s0, s1, inner.z0, inner.z1);
      box(parts.frame, b - SASH, b, s0, s1, inner.z0, inner.z1);
      box(parts.frame, a + SASH, b - SASH, s0, s1, inner.z0, inner.z0 + SASH);
      box(parts.frame, a + SASH, b - SASH, s0, s1, inner.z1 - SASH, inner.z1);
    }
    const m = style.mullions ?? 0;
    for (let i = 1; i <= m; i++) {
      const u = inner.u0 + ((inner.u1 - inner.u0) * i) / (m + 1);
      box(parts.frame, u - MULLION / 2, u + MULLION / 2, s0, s1, inner.z0, inner.z1);
    }
  }
  return parts;
}
