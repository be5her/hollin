import type { Smoke } from './harness';
import { tab } from './plan-canvas';

/** The visible project tab's 3D canvas. */
export const sceneCanvas = `${tab} [data-testid=scene-canvas]`;

export type Vec3 = readonly [number, number, number];
type Rect = { x: number; y: number; width: number; height: number };

/** A canvas data attribute of the 3D view (`camera3d`, `orbit`, `meshes`, `levels`, `frameMs`). */
export const sceneAttr = (smoke: Smoke, name: string) => smoke.js<string | undefined>(`document.querySelector('${sceneCanvas}')?.dataset.${name}`);

/** The orbit the last frame was drawn with: target (mm), distance (mm), azimuth and elevation (degrees). */
export async function readOrbit(smoke: Smoke): Promise<{ target: Vec3; distance: number; azimuth: number; elevation: number } | null> {
  const attr = await sceneAttr(smoke, 'orbit');
  if (!attr) return null;
  const [x, y, z, distance, azimuth, elevation] = attr.split(',').map(Number);
  return { target: [x, y, z], distance, azimuth, elevation };
}

/**
 * The 3D canvas as it was last drawn: its rect, and `at` turning a building point (mm, z up) into
 * window pixels through the view-projection matrix it mirrors in `data-camera3d`. Measure again after
 * anything that moves the camera or resizes the canvas.
 */
export async function sceneView(smoke: Smoke): Promise<{ rect: Rect; at: (p: Vec3) => { x: number; y: number }; pixel: (p: Vec3) => Promise<string | null> }> {
  const rect = (await smoke.rect(sceneCanvas))!;
  const m = ((await sceneAttr(smoke, 'camera3d')) ?? '').split(',').map(Number);
  const at = (p: Vec3) => {
    const [x, y, z] = p;
    const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
    const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    return { x: rect.x + ((cx / cw + 1) / 2) * rect.width, y: rect.y + ((1 - cy / cw) / 2) * rect.height };
  };
  return { rect, at, pixel: (p) => smoke.screenPixel(at(p).x, at(p).y) };
}

/** How far apart two `r,g,b` colours are (the largest channel difference); Infinity when either is missing. */
export function colorDistance(a: string | null, b: string | null): number {
  if (!a || !b) return Infinity;
  const p = a.split(',').map(Number);
  const q = b.split(',').map(Number);
  return Math.max(...p.map((v, i) => Math.abs(v - q[i])));
}

/** A `#rrggbb` colour as `r,g,b`. */
export const rgbOf = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
};
