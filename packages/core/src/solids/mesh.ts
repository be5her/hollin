import { triangulatePolygons } from '../geometry/clip';
import { polygonArea, type Polygon } from '../geometry/polygon';

/** A point in the building, mm: x and y as on the plan, z up from the datum. */
export type Vec3 = readonly [number, number, number];

/**
 * Triangles in mm, z up: three vertices (x, y, z) per triangle, each counter-clockwise seen from
 * outside, so a closed solid's normals point outwards. Not indexed: every triangle is flat-shaded.
 * `uvs` (two per vertex) are texture coordinates in mm: a face turned up or down is mapped by its
 * plan position (x, y), any other by its distance along the face and its height (z), so a pattern
 * keeps its scale and lines up across faces.
 */
export interface Mesh {
  positions: Float32Array;
  uvs?: Float32Array;
}

/** The texture coordinates of a triangle's corners, in mm (see `Mesh`). */
export function triangleUvs(a: Vec3, b: Vec3, c: Vec3): [number, number, number, number, number, number] {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const plan = Math.hypot(nx, ny);
  if (Math.abs(nz) >= plan) return [a[0], a[1], b[0], b[1], c[0], c[1]];
  // Along the face, seen from outside: left to right.
  const tx = -ny / plan;
  const ty = nx / plan;
  return [a[0] * tx + a[1] * ty, a[2], b[0] * tx + b[1] * ty, b[2], c[0] * tx + c[1] * ty, c[2]];
}

/** Below this area (mm²) a cap left over by a boolean is a sliver and is dropped. */
const SLIVER = 1;

/** Collects triangles. Polygons follow the boolean convention: outlines counter-clockwise, holes clockwise. */
export class MeshBuilder {
  private readonly p: number[] = [];
  private readonly uv: number[] = [];

  get empty(): boolean {
    return this.p.length === 0;
  }

  triangle(a: Vec3, b: Vec3, c: Vec3): this {
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.uv.push(...triangleUvs(a, b, c));
    return this;
  }

  /** Two triangles; a, b, c, d counter-clockwise seen from the front. */
  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3): this {
    return this.triangle(a, b, c).triangle(a, c, d);
  }

  /** The vertical faces of polygons between z0 and z1, facing away from the area they enclose. */
  sides(polys: readonly Polygon[], z0: number, z1: number): this {
    if (z1 <= z0) return this;
    for (const poly of polys) {
      for (let i = 0; i < poly.length; i++) {
        const [px, py] = poly[i];
        const [qx, qy] = poly[(i + 1) % poly.length];
        if (px === qx && py === qy) continue;
        this.quad([px, py, z0], [qx, qy, z0], [qx, qy, z1], [px, py, z1]);
      }
    }
    return this;
  }

  /** A horizontal face over polygons at z, facing up or down. */
  cap(polys: readonly Polygon[], z: number, up: boolean): this {
    const kept = polys.filter((p) => Math.abs(polygonArea(p)) >= SLIVER);
    if (!kept.length) return this;
    for (const t of triangulatePolygons(kept)) {
      const [a, b, c] = t;
      if (up) this.triangle([a[0], a[1], z], [b[0], b[1], z], [c[0], c[1], z]);
      else this.triangle([a[0], a[1], z], [c[0], c[1], z], [b[0], b[1], z]);
    }
    return this;
  }

  /** A closed solid: polygons extruded from z0 to z1. */
  prism(polys: readonly Polygon[], z0: number, z1: number): this {
    if (z1 <= z0) return this;
    return this.sides(polys, z0, z1).cap(polys, z1, true).cap(polys, z0, false);
  }

  /** A closed box between two corners, its vertical edges rounded by `r` (0: square). */
  roundedBox(min: Vec3, max: Vec3, r = 0): this {
    return this.prism([roundedRect(min[0], min[1], max[0], max[1], r)], min[2], max[2]);
  }

  /** A closed cylinder or cone about a vertical axis: radius r0 at z0, r1 at z1 (either may be 0, not both), `n` sides. */
  cylinder(c: readonly [number, number], z0: number, z1: number, r0: number, r1: number, n = 20): this {
    if (z1 <= z0 || (r0 <= 0 && r1 <= 0)) return this;
    const ring = (r: number, z: number): Vec3[] => Array.from({ length: n }, (_, i) => [c[0] + r * Math.cos((2 * Math.PI * i) / n), c[1] + r * Math.sin((2 * Math.PI * i) / n), z]);
    const lo = ring(r0, z0);
    const hi = ring(r1, z1);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (r0 <= 0) this.triangle(lo[i], hi[j], hi[i]);
      else if (r1 <= 0) this.triangle(lo[i], lo[j], hi[i]);
      else this.quad(lo[i], lo[j], hi[j], hi[i]);
    }
    if (r0 > 0) this.cap([circlePolygon(c, r0, n)], z0, false);
    if (r1 > 0) this.cap([circlePolygon(c, r1, n)], z1, true);
    return this;
  }

  /**
   * A straight bar from a to b at any slope (a handrail, a ladder's rail or rung): its cross-section
   * spans `width` along `side` and `depth` along `up`, both perpendicular to the bar or close to it.
   */
  bar(a: Vec3, b: Vec3, side: Vec3, up: Vec3, width: number, depth: number): this {
    const at = (p: Vec3, s: number, u: number): Vec3 => [p[0] + side[0] * s * (width / 2) + up[0] * u * (depth / 2), p[1] + side[1] * s * (width / 2) + up[1] * u * (depth / 2), p[2] + side[2] * s * (width / 2) + up[2] * u * (depth / 2)];
    const [a00, a10, a11, a01] = [at(a, -1, -1), at(a, 1, -1), at(a, 1, 1), at(a, -1, 1)];
    const [b00, b10, b11, b01] = [at(b, -1, -1), at(b, 1, -1), at(b, 1, 1), at(b, -1, 1)];
    const faces: Vec3[][] = [
      [a00, a01, a11, a10],
      [b00, b10, b11, b01],
      [a00, a10, b10, b00],
      [a01, b01, b11, a11],
      [a00, b00, b01, a01],
      [a10, a11, b11, b10],
    ];
    // Which way round the faces go depends on the handedness of (b − a, side, up): wound one way, and flipped when that encloses a negative volume.
    const probe = new MeshBuilder();
    for (const [p, q, r, s] of faces) probe.quad(p, q, r, s);
    const flip = meshVolume(probe.build(), a) < 0;
    for (const [p, q, r, s] of faces) {
      if (flip) this.quad(s, r, q, p);
      else this.quad(p, q, r, s);
    }
    return this;
  }

  /** Adds another builder's triangles. */
  append(other: MeshBuilder): this {
    for (const v of other.p) this.p.push(v);
    for (const v of other.uv) this.uv.push(v);
    return this;
  }

  build(): Mesh {
    return { positions: new Float32Array(this.p), uvs: new Float32Array(this.uv) };
  }
}

/** A rectangle with rounded corners (radius clamped to fit), counter-clockwise. */
export function roundedRect(x0: number, y0: number, x1: number, y1: number, r: number, steps = 4): Polygon {
  const k = Math.max(0, Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2));
  if (k <= 0.5)
    return [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ];
  const out: Polygon = [];
  const corners: [number, number, number][] = [
    [x1 - k, y0 + k, -Math.PI / 2],
    [x1 - k, y1 - k, 0],
    [x0 + k, y1 - k, Math.PI / 2],
    [x0 + k, y0 + k, Math.PI],
  ];
  for (const [cx, cy, start] of corners) for (let i = 0; i <= steps; i++) out.push([cx + k * Math.cos(start + (i / steps) * (Math.PI / 2)), cy + k * Math.sin(start + (i / steps) * (Math.PI / 2))]);
  return out;
}

/** A circle as a regular polygon, counter-clockwise. */
export function circlePolygon(c: readonly [number, number], r: number, n = 20): Polygon {
  return Array.from({ length: n }, (_, i) => [c[0] + r * Math.cos((2 * Math.PI * i) / n), c[1] + r * Math.sin((2 * Math.PI * i) / n)]);
}

/** The number of triangles in a mesh. */
export const triangleCount = (mesh: Mesh): number => mesh.positions.length / 9;

/**
 * The volume a mesh encloses, mm³, by the divergence theorem about `origin`: positive when the
 * triangles face outwards. For a closed surface it does not depend on the origin, so comparing two
 * origins tells a closed solid from one with a face missing.
 */
export function meshVolume(mesh: Mesh, origin: Vec3 = [0, 0, 0]): number {
  const p = mesh.positions;
  let v = 0;
  for (let i = 0; i < p.length; i += 9) {
    const ax = p[i] - origin[0], ay = p[i + 1] - origin[1], az = p[i + 2] - origin[2];
    const bx = p[i + 3] - origin[0], by = p[i + 4] - origin[1], bz = p[i + 5] - origin[2];
    const cx = p[i + 6] - origin[0], cy = p[i + 7] - origin[1], cz = p[i + 8] - origin[2];
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return v / 6;
}

/** The mesh's extent, mm; null when it has no triangles. */
export function meshBox(mesh: Mesh): { min: Vec3; max: Vec3 } | null {
  const p = mesh.positions;
  if (!p.length) return null;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (p[i + k] < min[k]) min[k] = p[i + k];
      if (p[i + k] > max[k]) max[k] = p[i + k];
    }
  }
  return { min: [min[0], min[1], min[2]], max: [max[0], max[1], max[2]] };
}
