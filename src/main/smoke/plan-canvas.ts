import type { Smoke } from './harness';

/** The visible project tab and its plan canvas. */
export const tab = '[data-tab-type="project.editor"]:not(.hidden)';
export const canvas = `${tab} [data-testid=plan-canvas]`;

export type Camera = { x: number; y: number; scale: number };
export type Rect = { x: number; y: number; width: number; height: number };

/** The plan view's camera, mirrored on the canvas as `data-camera="x,y,scale"`. */
export async function readCamera(smoke: Smoke): Promise<Camera | null> {
  const attr = await smoke.js<string>(`document.querySelector('${canvas}')?.dataset.camera ?? ''`);
  if (!attr) return null;
  const [x, y, scale] = attr.split(',').map(Number);
  return { x, y, scale };
}

/** World mm to window pixels, the same mapping the renderer uses (y up in the world, down on screen). */
export const toScreen = (rect: Rect, cam: Camera, p: readonly [number, number]) => ({ x: rect.x + (p[0] - cam.x) * cam.scale + rect.width / 2, y: rect.y + (cam.y - p[1]) * cam.scale + rect.height / 2 });

/** A canvas data attribute (`level`, `frameLevel` (the level the last frame drew), `entities`, `tool`, `selection` …). */
export const canvasAttr = (smoke: Smoke, name: string) => smoke.js<string | undefined>(`document.querySelector('${canvas}')?.dataset.${name}`);

/** The canvas rect and camera as they are now: measure again after anything that changes the canvas size (a tool's options bar) or the view. */
export async function view(smoke: Smoke): Promise<{ rect: Rect; cam: Camera; at: (p: readonly [number, number]) => { x: number; y: number }; pixel: (p: readonly [number, number]) => Promise<string | null> }> {
  const rect = (await smoke.rect(canvas))!;
  const cam = (await readCamera(smoke))!;
  const at = (p: readonly [number, number]) => toScreen(rect, cam, p);
  return { rect, cam, at, pixel: (p) => smoke.canvasPixel(canvas, at(p).x, at(p).y) };
}
