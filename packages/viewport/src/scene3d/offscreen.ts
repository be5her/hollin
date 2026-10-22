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
}

/**
 * The whole building drawn in 3D into a canvas the caller makes, fitted from a direction, and
 * returned as PNG bytes (base64): `view.snapshot` with `view: '3d'`. The same view as the 3D tab (a
 * `Scene3dView` drawn once, then freed), after the imported models it shows have loaded. Null when
 * there is nothing to draw; throws when the canvas gives no WebGL context.
 */
export async function renderBuildingToPng(doc: ProjectDoc, options: BuildingSnapshotOptions): Promise<string | null> {
  const canvas = options.createCanvas(options.width, options.height);
  const view = new Scene3dView(canvas, {}, options.theme ?? LIGHT_SCENE_THEME, { preserveDrawingBuffer: true });
  try {
    view.setSize(options.width, options.height, 1);
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
