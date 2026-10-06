import type { Box, Vec2 } from '@studio/core';

/** Where the plan is looked at: the world point (mm) at the centre of the canvas and the zoom in CSS pixels per mm. */
export interface Camera {
  x: number;
  y: number;
  scale: number;
}

/** A canvas size in CSS pixels. */
export interface Size {
  width: number;
  height: number;
}

/** 200 m across a 1000 px canvas, down to 20 px per mm. */
export const MIN_SCALE = 0.005;
export const MAX_SCALE = 20;

/** Pixels per mm on a 96 dpi screen; `1:N` drawing scale = SCREEN_PX_PER_MM / scale. */
export const SCREEN_PX_PER_MM = 96 / 25.4;

export const clampScale = (scale: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

export const defaultCamera = (): Camera => ({ x: 0, y: 0, scale: 0.1 });

/** The world is y-up; the screen is y-down, so y flips around the canvas centre. */
export function worldToScreen(camera: Camera, size: Size, p: Vec2): Vec2 {
  return [(p[0] - camera.x) * camera.scale + size.width / 2, (camera.y - p[1]) * camera.scale + size.height / 2];
}

export function screenToWorld(camera: Camera, size: Size, s: Vec2): Vec2 {
  return [(s[0] - size.width / 2) / camera.scale + camera.x, camera.y - (s[1] - size.height / 2) / camera.scale];
}

/** Zooms by `factor` keeping the world point under the screen point `at` where it is. */
export function zoomAt(camera: Camera, size: Size, at: Vec2, factor: number): Camera {
  const scale = clampScale(camera.scale * factor);
  if (scale === camera.scale) return camera;
  const w = screenToWorld(camera, size, at);
  return { x: w[0] - (at[0] - size.width / 2) / scale, y: w[1] + (at[1] - size.height / 2) / scale, scale };
}

/** Moves the view by a screen offset: dragging right moves the world right, so the centre moves left. */
export function panBy(camera: Camera, dx: number, dy: number): Camera {
  return { x: camera.x - dx / camera.scale, y: camera.y + dy / camera.scale, scale: camera.scale };
}

/** A camera that shows the whole box with `padding` pixels around it. */
export function fitBox(box: Box, size: Size, padding = 48): Camera {
  const x = (box.minX + box.maxX) / 2;
  const y = (box.minY + box.maxY) / 2;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return defaultCamera();
  const w = Math.max(1, box.maxX - box.minX);
  const h = Math.max(1, box.maxY - box.minY);
  const availW = size.width - 2 * padding;
  const availH = size.height - 2 * padding;
  if (availW < 1 || availH < 1) return { x, y, scale: defaultCamera().scale };
  return { x, y, scale: clampScale(Math.min(availW / w, availH / h)) };
}

/** The world box the canvas shows. */
export function visibleBox(camera: Camera, size: Size): Box {
  const [minX, maxY] = screenToWorld(camera, size, [0, 0]);
  const [maxX, minY] = screenToWorld(camera, size, [size.width, size.height]);
  return { minX, minY, maxX, maxY };
}

export const sameCamera = (a: Camera | null, b: Camera | null): boolean => a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y && a.scale === b.scale);

/** The drawing scale as architects write it: 1:100 means 1 mm on a 96 dpi screen is 100 mm. */
export function drawingScale(camera: Camera): number {
  return Math.max(1, Math.round(SCREEN_PX_PER_MM / camera.scale));
}
