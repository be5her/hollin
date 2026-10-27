import type { ProjectDoc, RuleLimits } from '@studio/core';
import type { SceneMode } from './scene';
import { LIGHT_SCENE_THEME, type SceneTheme } from './theme';
import { Scene3dView, type SceneLighting } from './view';

export interface BuildingSnapshotOptions {
  width: number;
  height: number;
  /** Makes the canvas drawn into; the window passes `document.createElement('canvas')`. */
  createCanvas: (width: number, height: number) => HTMLCanvasElement;
  limits: RuleLimits;
  theme?: SceneTheme;
  /** The direction the building is seen from, degrees (see `Orbit`). */
  azimuth: number;
  elevation: number;
  mode: SceneMode;
  /** The level isolate and cutaway work on. */
  levelId: string;
  explode: number;
  /** Day (the default) or night, with the design's lights. */
  lighting?: SceneLighting;
  /** No background: the canvas is cleared to alpha 0 and only the building is drawn. */
  transparent?: boolean;
}

/**
 * Thrown when WebGL cannot draw at the size asked for (past the GPU's largest drawing buffer, often
 * 4096 or 8192 px a side on software GL): the caller says so instead of handing back a smaller image.
 */
export class SnapshotSizeError extends Error {
  constructor(
    readonly asked: { width: number; height: number },
    readonly given: { width: number; height: number },
  ) {
    super(`WebGL could draw at most ${given.width} × ${given.height} px here, not the ${asked.width} × ${asked.height} asked for; ask for a smaller image.`);
    this.name = 'SnapshotSizeError';
  }
}

/**
 * The whole building drawn in 3D into a canvas the caller makes, fitted from a direction, and
 * returned as PNG bytes (base64): `view.snapshot` with `view: '3d'` and `export.image`. The same view as the 3D tab (a
 * `Scene3dView` drawn once, then freed), after the imported models it shows have loaded. Null when
 * there is nothing to draw; throws when the canvas gives no WebGL context, and a `SnapshotSizeError`
 * when WebGL gives a smaller drawing buffer than the size asked for.
 */
export async function renderBuildingToPng(doc: ProjectDoc, options: BuildingSnapshotOptions): Promise<string | null> {
  const canvas = options.createCanvas(options.width, options.height);
  const view = new Scene3dView(canvas, {}, options.theme ?? LIGHT_SCENE_THEME, { preserveDrawingBuffer: true, transparent: options.transparent ?? false });
  try {
    view.setSize(options.width, options.height, 1);
    const given = view.drawingBufferSize();
    if (given.width < options.width || given.height < options.height) throw new SnapshotSizeError({ width: options.width, height: options.height }, given);
    view.setDisplay({ mode: options.mode, levelId: options.levelId, explode: options.explode, cutHeight: options.limits.stairCutHeight });
    view.setLighting(options.lighting ?? 'day');
    view.setDocument(doc, options.limits);
    await view.modelsReady();
    if (!view.building.box()) return null;
    view.fitFrom({ azimuth: options.azimuth, elevation: options.elevation }, false);
    view.renderNow();
    const url = canvas.toDataURL('image/png');
    const comma = url.indexOf(',');
    return comma >= 0 ? url.slice(comma + 1) : null;
  } finally {
    view.dispose();
  }
}
