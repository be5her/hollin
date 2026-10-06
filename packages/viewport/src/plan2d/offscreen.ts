import { defaultConfig, type ProjectDoc, type UnitSettings } from '@studio/core';
import { fitBox } from './camera';
import { LevelGeometryCache } from './geometry-cache';
import { renderPlan, type RenderFrame } from './render';
import { createLevelScene, sceneBox, syncLevelScene } from './scene';
import { LIGHT_THEME, type PlanTheme } from './theme';

/** Entity types with a footprint of their own. */
const DRAWN = new Set<string>(['wall', 'column', 'slab', 'void', 'shaft', 'shape', 'separator', 'opening']);

export interface SnapshotOptions {
  width: number;
  height: number;
  /** Makes the canvas drawn into; the plan view passes `document.createElement('canvas')`. */
  createCanvas: (width: number, height: number) => HTMLCanvasElement;
  theme?: PlanTheme;
  units?: UnitSettings;
  /** Shared with the plan view, so nothing is derived twice. */
  cache?: LevelGeometryCache;
  showGrid?: boolean;
  /** World mm of padding around the level; default 24 px worth. */
  paddingPx?: number;
}

/**
 * Draws one level of a document fitted into a canvas and returns it as a PNG (base64, without the
 * `data:` prefix): the project thumbnail, and later `view.snapshot`. Null when the level has nothing
 * to draw (the Home card keeps its placeholder) or the canvas gives no 2D context.
 */
export function renderLevelToPng(doc: ProjectDoc, levelId: string, options: SnapshotOptions): string | null {
  const entities = doc.levelData[levelId]?.entities;
  if (!entities) return null;
  // Text and seeds alone make no plan worth a thumbnail.
  if (!Object.values(entities).some((e) => DRAWN.has(e.type) || (e.type === 'room' && e.boundary.k === 'region'))) return null;
  const scene = createLevelScene(levelId);
  syncLevelScene(scene, entities);
  const box = sceneBox(scene);
  if (!Number.isFinite(box.minX)) return null;
  const size = { width: options.width, height: options.height };
  const cache = options.cache ?? new LevelGeometryCache();
  const hidden = new Set<string>();
  for (const id in entities) {
    const e = entities[id];
    if (e.type === 'wall' && doc.layers[e.layerId]?.visible === false) hidden.add(id);
  }
  const frame: RenderFrame = {
    size,
    dpr: 1,
    camera: fitBox(box, size, options.paddingPx ?? 24),
    theme: options.theme ?? LIGHT_THEME,
    units: options.units ?? defaultConfig().units,
    layers: doc.layers,
    scene,
    walls: cache.walls(entities, hidden),
    geometry: cache.level(entities),
    underlay: null,
    showGrid: options.showGrid ?? false,
  };
  const canvas = options.createCanvas(size.width, size.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  renderPlan(ctx, frame);
  const url = canvas.toDataURL('image/png');
  const comma = url.indexOf(',');
  return comma >= 0 ? url.slice(comma + 1) : null;
}
