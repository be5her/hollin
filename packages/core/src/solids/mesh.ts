import { triangulatePolygons } from '../geometry/clip';
import { polygonArea, type Polygon } from '../geometry/polygon';

/** A point in the building, mm: x and y as on the plan, z up from the datum. */
export type Vec3 = readonly [number, number, number];

/**
 * Triangles in mm, z up: three vertices (x, y, z) per triangle, each counter-clockwise seen from
 * outside, so a closed solid's normals point outwards. Not indexed: every triangle is flat-shaded.
 */
export interface Mesh {
  positions: Float32Array;
}

/** Below this area (mm²) a cap left over by a boolean is a sliver and is dropped. */
const SLIVER = 1;

/** Collects triangles. Polygons follow the boolean convention: outlines counter-clockwise, holes clockwise. */
export class MeshBuilder {
  private readonly p: number[] = [];

  get empty(): boolean {
    return this.p.length === 0;
  }

  triangle(a: Vec3, b: Vec3, c: Vec3): this {
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
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

  build(): Mesh {
    return { positions: new Float32Array(this.p) };
  }
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
