import type { Vec3 } from '@studio/core';

/**
 * The orbit camera, in the building's own terms: the point it looks at (mm, z up), how far away it
 * is (mm), and the direction it looks from, as degrees counter-clockwise from +x on the plan
 * (azimuth) and above the horizon (elevation). Pure, so the gestures are tested in node.
 */
export interface Orbit {
  target: Vec3;
  distance: number;
  azimuth: number;
  elevation: number;
}

/** The views the toolbar offers: from the south-west and above, from straight above (north up), from the south, from the east. */
export const ORBIT_PRESETS = {
  iso: { azimuth: 225, elevation: 30 },
  top: { azimuth: 270, elevation: 89 },
  front: { azimuth: 270, elevation: 8 },
  side: { azimuth: 0, elevation: 8 },
} as const;
export type OrbitPreset = keyof typeof ORBIT_PRESETS;

/** The vertical field of view, degrees. */
export const FOV = 40;
const MIN_DISTANCE = 300;
const MAX_DISTANCE = 2_000_000;
const MAX_ELEVATION = 89;

const DEG = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const wrap = (deg: number) => ((deg % 360) + 360) % 360;

/** Where the camera is. */
export function orbitEye(o: Orbit): Vec3 {
  const ce = Math.cos(o.elevation * DEG);
  return [o.target[0] + o.distance * ce * Math.cos(o.azimuth * DEG), o.target[1] + o.distance * ce * Math.sin(o.azimuth * DEG), o.target[2] + o.distance * Math.sin(o.elevation * DEG)];
}

/** The camera's right and up directions on screen, in the world. */
export function orbitAxes(o: Orbit): { right: Vec3; up: Vec3; forward: Vec3 } {
  const ca = Math.cos(o.azimuth * DEG);
  const sa = Math.sin(o.azimuth * DEG);
  const ce = Math.cos(o.elevation * DEG);
  const se = Math.sin(o.elevation * DEG);
  const forward: Vec3 = [-ce * ca, -ce * sa, -se];
  const right: Vec3 = [-sa, ca, 0];
  // up = right × forward
  const up: Vec3 = [right[1] * forward[2] - right[2] * forward[1], right[2] * forward[0] - right[0] * forward[2], right[0] * forward[1] - right[1] * forward[0]];
  return { right, up, forward };
}

/** Turned by a drag: degrees around the target and up or down, kept off the poles. */
export function orbitBy(o: Orbit, dAzimuth: number, dElevation: number): Orbit {
  return { ...o, azimuth: wrap(o.azimuth + dAzimuth), elevation: clamp(o.elevation + dElevation, -MAX_ELEVATION, MAX_ELEVATION) };
}

/** World mm per screen pixel at the target's depth, for a viewport `height` pixels tall. */
export const mmPerPixel = (o: Orbit, height: number): number => (2 * o.distance * Math.tan((FOV * DEG) / 2)) / Math.max(1, height);

/** Moved by a drag of (dx, dy) pixels so the scene follows the pointer. */
export function orbitPan(o: Orbit, dx: number, dy: number, height: number): Orbit {
  const k = mmPerPixel(o, height);
  const { right, up } = orbitAxes(o);
  return { ...o, target: [o.target[0] - right[0] * dx * k + up[0] * dy * k, o.target[1] - right[1] * dx * k + up[1] * dy * k, o.target[2] - right[2] * dx * k + up[2] * dy * k] };
}

/**
 * Zoomed by `factor` (below 1 comes closer) towards the point under the cursor, given as pixels
 * from the viewport's centre (x right, y down): that point stays where it is on screen.
 */
export function orbitZoomAt(o: Orbit, factor: number, offset: { x: number; y: number }, height: number): Orbit {
  const distance = clamp(o.distance * factor, MIN_DISTANCE, MAX_DISTANCE);
  const applied = distance / o.distance;
  const k = mmPerPixel(o, height);
  const { right, up } = orbitAxes(o);
  const p: Vec3 = [o.target[0] + right[0] * offset.x * k - up[0] * offset.y * k, o.target[1] + right[1] * offset.x * k - up[1] * offset.y * k, o.target[2] + right[2] * offset.x * k - up[2] * offset.y * k];
  const t = 1 - applied;
  return { ...o, distance, target: [o.target[0] + (p[0] - o.target[0]) * t, o.target[1] + (p[1] - o.target[1]) * t, o.target[2] + (p[2] - o.target[2]) * t] };
}

/** The orbit that shows a box (mm) whole from a direction, in a viewport of the given aspect (width / height). */
export function fitOrbit(box: { min: Vec3; max: Vec3 }, aspect: number, direction: { azimuth: number; elevation: number } = ORBIT_PRESETS.iso, margin = 1.1): Orbit {
  const target: Vec3 = [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2];
  const radius = Math.max(500, Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]) / 2);
  const half = (FOV * DEG) / 2;
  // The sphere around the box fits the narrower of the two fields of view.
  const narrow = aspect < 1 ? Math.atan(Math.tan(half) * aspect) : half;
  return { target, distance: clamp((radius * margin) / Math.sin(narrow), MIN_DISTANCE, MAX_DISTANCE), azimuth: direction.azimuth, elevation: direction.elevation };
}

/** An orbit read back from storage, or null when it is not one. */
export function parseOrbit(value: unknown): Orbit | null {
  if (!value || typeof value !== 'object') return null;
  const o = value as Record<string, unknown>;
  const t = o['target'];
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if (!Array.isArray(t) || t.length !== 3 || !t.every(finite) || !finite(o['distance']) || !finite(o['azimuth']) || !finite(o['elevation'])) return null;
  return { target: [t[0], t[1], t[2]], distance: clamp(o['distance'], MIN_DISTANCE, MAX_DISTANCE), azimuth: wrap(o['azimuth']), elevation: clamp(o['elevation'], -MAX_ELEVATION, MAX_ELEVATION) };
}
