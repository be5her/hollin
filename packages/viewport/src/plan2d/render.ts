import { add, columnPolygon, inflatePolygons, type Polygon, DEG, dimensionGeometry, dimensionMarks, dimensionOutline, flatten, formatArea, formatLength, itemFootprint, itemModel, itemSize, openingFrame, openingMisfits, openingSymbol, perp, PLAN_GLYPHS, polygonCentroid, resolveDimension, resolvePath, scale as vscale, wallBody, type DimensionGeometry, type Entity, type EntityType, type Layer, type LevelGeometry, type LevelWalls, type Path, type Region, type UnitSettings, type Vec2 } from '@studio/core';
import { visibleBox, worldToScreen, type Camera, type Size } from './camera';
import { drawConnector, traceConnector, type PlanConnector } from './connectors';
import { tracePath, tracePolygon, traceRegion, traceSegments } from './draw';
import { entityBox, footprintOf, searchScene, type LevelScene, type SceneItem } from './scene';
import { highlightOpacity, highlightTag, type PlanHighlight } from './highlights';
import { withAlpha, type PlanTheme } from './theme';

/** Everything one frame needs. The renderer keeps no state of its own. */
export interface RenderFrame {
  size: Size;
  dpr: number;
  camera: Camera;
  theme: PlanTheme;
  units: UnitSettings;
  layers: Record<string, Layer>;
  scene: LevelScene | null;
  /** The level's walls joined (bodies, junction patches and their union), or null when there are none. */
  walls: LevelWalls | null;
  /** The whole level's geometry (rooms, cavities, the automatic slab), from every wall. */
  geometry: LevelGeometry | null;
  /** The reference level, drawn faintly under the plan. */
  underlay: LevelScene | null;
  showGrid: boolean;
  /** The stairs, ramps, elevators and other connectors this level shows. */
  connectors?: readonly PlanConnector[];
  /** Leave the background unpainted (cleared to transparent), for a render laid over something else. */
  transparent?: boolean;
  /**
   * What Otto changed in the last minute, oldest first: a halo under the walls, end nodes over them and
   * one tag for the newest (`03-otto.md` §c). Only the editor sets it: thumbnails, snapshots and exports
   * never carry Otto's marks.
   */
  highlights?: readonly PlanHighlight[];
  /** The time the highlights are drawn at (ms since the epoch); `Date.now()` when absent. */
  now?: number;
  /** `prefers-reduced-motion`: the highlights' fade and removal are cuts. */
  reducedMotion?: boolean;
}

/** The joined walls' outlines as a `Path2D`, kept per derived geometry. */
const joinedPaths = new WeakMap<LevelWalls, Path2D>();

function joinedPath(walls: LevelWalls): Path2D | null {
  if (typeof Path2D === 'undefined') return null;
  let p = joinedPaths.get(walls);
  if (!p) {
    p = new Path2D();
    for (const poly of walls.cut) tracePolygon(p, poly);
    joinedPaths.set(walls, p);
  }
  return p;
}

/** Walls are filled as one shape, so junctions show no seams; the opacity is the lowest of the layers that hold walls. */
function drawWalls(ctx: CanvasRenderingContext2D, frame: RenderFrame): void {
  const walls = frame.walls;
  if (!walls || !walls.joined.length) return;
  let alpha = 1;
  if (frame.scene) {
    for (const id of walls.bodies.keys()) {
      const layer = frame.layers[frame.scene.items.get(id)?.layerId ?? ''];
      if (layer) alpha = Math.min(alpha, layer.opacity);
    }
  }
  ctx.globalAlpha = alpha;
  ctx.fillStyle = frame.theme.wall;
  ctx.strokeStyle = frame.theme.wallLine;
  ctx.lineWidth = px(frame, 1.5);
  ctx.lineJoin = 'miter';
  const p = joinedPath(walls);
  if (p) {
    ctx.fill(p, 'nonzero');
    ctx.stroke(p);
  } else {
    ctx.beginPath();
    for (const poly of walls.cut) tracePolygon(ctx, poly);
    ctx.fill('nonzero');
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** The openings of a scene grouped by wall, kept per scene version. */
const openingGroups = new WeakMap<LevelScene, { version: number; byWall: Map<string, Extract<Entity, { type: 'opening' }>[]> }>();

function openingsByWall(scene: LevelScene): Map<string, Extract<Entity, { type: 'opening' }>[]> {
  const cached = openingGroups.get(scene);
  if (cached && cached.version === scene.version) return cached.byWall;
  const byWall = new Map<string, Extract<Entity, { type: 'opening' }>[]>();
  for (const item of scene.items.values()) {
    if (item.type !== 'opening') continue;
    const o = item.entity as Extract<Entity, { type: 'opening' }>;
    const list = byWall.get(o.wallId);
    if (list) list.push(o);
    else byWall.set(o.wallId, [o]);
  }
  openingGroups.set(scene, { version: scene.version, byWall });
  return byWall;
}

/**
 * An opening's symbol: the jamb lines, and a door's leaf with its swing or a window's glazing lines.
 * The cut itself is part of the drawn walls. With `outline`, the cut's outline is drawn too (previews).
 */
export function drawOpeningSymbol(ctx: CanvasRenderingContext2D, frame: RenderFrame, wall: Extract<Entity, { type: 'wall' }>, e: Pick<Extract<Entity, { type: 'opening' }>, 'kind' | 'along' | 'width' | 'swing'>, color: string, outline = false): void {
  const symbol = openingSymbol(wall, e);
  ctx.strokeStyle = color;
  ctx.lineWidth = px(frame, 1);
  if (outline) {
    ctx.fillStyle = withAlpha(color, 0.12);
    ctx.beginPath();
    tracePolygon(ctx, openingFrame(wall, e).cut);
    ctx.fill();
    ctx.stroke();
  }
  ctx.beginPath();
  for (const [a, b] of [...symbol.jambs, ...symbol.glazing, ...(symbol.leaf ? [symbol.leaf] : [])]) {
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
  }
  ctx.stroke();
  if (!symbol.swing) return;
  const { center, radius, start, sweep } = symbol.swing;
  ctx.beginPath();
  ctx.setLineDash([px(frame, 3), px(frame, 3)]);
  ctx.arc(center[0], center[1], radius, start, start + sweep, sweep < 0);
  ctx.stroke();
  ctx.setLineDash([]);
}

export interface RenderStats {
  /** Entities drawn this frame (the underlay not counted). */
  drawn: number;
  /** Connectors drawn this frame. */
  connectors: number;
  /** The level this frame drew (null without a scene), so a host can tell a frame of the new level from a stale one. */
  levelId: string | null;
  ms: number;
  /** Otto's highlights drawn this frame (edits with an opacity above 0). */
  highlights: number;
  /** The tag drawn for the newest of them, in CSS pixels on the canvas, or null. */
  aiTag: AiTag | null;
  /** The targets of a pending destructive call the editor outlined (set by the editor, not by `renderPlan`). */
  pending?: number;
}

/** Where the tag on Otto's newest edit was drawn, and what it says. */
export interface AiTag {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Back to front. */
const DRAW_ORDER: Record<EntityType, number> = { slab: 0, room: 1, void: 2, shaft: 2, separator: 2, shape: 2, wall: 3, column: 4, opening: 5, fixture: 6, point: 6, item: 6, light: 6, dimension: 7, label: 8 };

export interface TextOp {
  text: string;
  at: Vec2;
  /** Height in world mm (scaled with the zoom) or, when `screenPx` is set, a fixed size on screen. */
  mm?: number;
  screenPx?: number;
  color: string;
  align: CanvasTextAlign;
  baseline: CanvasTextBaseline;
  /** World rotation in degrees, counter-clockwise. */
  rotation?: number;
  mono?: boolean;
  /** Screen offset applied after rotation, in px. */
  dx?: number;
  dy?: number;
}

const METRIC_STEPS = [1, 10, 100, 1000, 10_000, 100_000];
const IMPERIAL_STEPS = [25.4, 304.8, 3048, 30_480, 304_800];

/** Minor and major grid spacing (mm) for a zoom: the smallest step that is at least 14 px apart. */
export function gridSpacing(scale: number, system: UnitSettings['system']): { minor: number; major: number } {
  const steps = system === 'imperial' ? IMPERIAL_STEPS : METRIC_STEPS;
  for (let i = 0; i < steps.length; i++) {
    if (steps[i] * scale >= 14 || i === steps.length - 1) return { minor: steps[i], major: steps[Math.min(i + 1, steps.length - 1)] };
  }
  return { minor: steps[0], major: steps[1] };
}

/** Draws one frame of the plan. */
export function renderPlan(ctx: CanvasRenderingContext2D, frame: RenderFrame): RenderStats {
  const started = performance.now();
  const { size, dpr, camera, theme } = frame;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (frame.transparent) ctx.clearRect(0, 0, size.width, size.height);
  else {
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, size.width, size.height);
  }
  if (frame.showGrid) drawGrid(ctx, frame);

  const texts: TextOp[] = [];
  const visible = visibleBox(camera, size);
  worldSpace(ctx, frame);
  if (frame.underlay) drawUnderlay(ctx, frame, frame.underlay, visible);
  let drawn = 0;
  if (frame.geometry?.slab.length && frame.geometry.autoSlabs.some((s) => frame.layers[s.layerId]?.visible !== false)) {
    ctx.fillStyle = frame.theme.slab;
    ctx.beginPath();
    for (const poly of frame.geometry.slab) tracePolygon(ctx, poly);
    ctx.fill('nonzero');
  }
  if (frame.scene) {
    const items = searchScene(frame.scene, visible).sort((a, b) => DRAW_ORDER[a.type] - DRAW_ORDER[b.type] || (a.id < b.id ? -1 : 1));
    let wallsDrawn = false;
    for (const item of items) {
      const layer = frame.layers[item.layerId];
      if (layer && !layer.visible) continue;
      if (DRAW_ORDER[item.type] >= DRAW_ORDER.wall && !wallsDrawn) {
        // Otto's halo goes over the rooms and the slab and under the walls, so a wall sits on its own halo.
        drawAiHalos(ctx, frame);
        drawWalls(ctx, frame);
        wallsDrawn = true;
      }
      if (item.type === 'wall') {
        drawn++;
        continue;
      }
      ctx.globalAlpha = layer?.opacity ?? 1;
      drawEntity(ctx, item, frame, texts);
      drawn++;
    }
    if (!wallsDrawn) {
      drawAiHalos(ctx, frame);
      drawWalls(ctx, frame);
    }
    ctx.globalAlpha = 1;
  } else drawAiHalos(ctx, frame);
  let connectors = 0;
  for (const pc of frame.connectors ?? []) {
    if (pc.box.maxX < visible.minX || pc.box.minX > visible.maxX || pc.box.maxY < visible.minY || pc.box.minY > visible.maxY) continue;
    drawConnector(ctx, pc, frame, texts);
    connectors++;
  }
  drawTexts(ctx, frame, texts);
  const otto = drawAiMarks(ctx, frame);
  worldSpace(ctx, frame);
  return { drawn, connectors, levelId: frame.scene?.levelId ?? null, ms: performance.now() - started, ...otto };
}

/** Text at a world position, drawn in screen space; for tools and overlays. Restores the world transform afterwards. */
export function drawScreenText(ctx: CanvasRenderingContext2D, frame: RenderFrame, op: TextOp): void {
  drawTexts(ctx, frame, [op]);
  worldSpace(ctx, frame);
}

/** An entity that is not (yet) in the scene, e.g. a drag preview: drawn like the real thing, without caching. */
export function drawEntityPreview(ctx: CanvasRenderingContext2D, entity: Entity, frame: RenderFrame): void {
  const texts: TextOp[] = [];
  const assets = frame.scene?.assets ?? {};
  const box = entityBox(entity, frame.scene ? Object.fromEntries([...frame.scene.items].map(([id, item]) => [id, item.entity])) : {}, assets);
  const item: SceneItem = { ...box, id: entity.id, type: entity.type, layerId: entity.layerId, entity, path2d: null, ...(entity.type === 'item' ? { footprint: footprintOf(entity, assets) } : {}) };
  drawEntity(ctx, item, frame, texts);
  drawTexts(ctx, frame, texts);
  worldSpace(ctx, frame);
}

/** A connector as a gesture would leave it (a move, a reshaped axis), drawn over the plan. */
export function drawConnectorPreview(ctx: CanvasRenderingContext2D, pc: PlanConnector, frame: RenderFrame): void {
  const texts: TextOp[] = [];
  drawConnector(ctx, pc, frame, texts);
  drawTexts(ctx, frame, texts);
  worldSpace(ctx, frame);
}

/** The snap marker at the snapped point (a glyph per kind), its guide lines and a label. */
export function drawSnap(ctx: CanvasRenderingContext2D, frame: RenderFrame, snap: { point: Vec2; kind: string; label: string; guides: { from: Vec2; to: Vec2 }[]; length?: number }): void {
  const { theme } = frame;
  ctx.strokeStyle = theme.snap;
  ctx.lineWidth = px(frame, 1);
  if (snap.guides.length) {
    ctx.setLineDash([px(frame, 6), px(frame, 4)]);
    ctx.beginPath();
    for (const g of snap.guides) {
      ctx.moveTo(g.from[0], g.from[1]);
      ctx.lineTo(g.to[0], g.to[1]);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }
  screenSpace(ctx, frame);
  const [x, y] = worldToScreen(frame.camera, frame.size, snap.point);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = theme.snap;
  ctx.fillStyle = withAlpha(theme.snap, 0.15);
  ctx.beginPath();
  const r = 6;
  switch (snap.kind) {
    case 'endpoint':
      ctx.rect(x - r, y - r, 2 * r, 2 * r);
      break;
    case 'midpoint':
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y + r);
      ctx.lineTo(x - r, y + r);
      ctx.closePath();
      break;
    case 'center':
    case 'tangent':
      ctx.arc(x, y, r, 0, Math.PI * 2);
      break;
    case 'intersection':
    case 'extension':
      ctx.moveTo(x - r, y - r);
      ctx.lineTo(x + r, y + r);
      ctx.moveTo(x - r, y + r);
      ctx.lineTo(x + r, y - r);
      break;
    case 'perpendicular':
      ctx.moveTo(x - r, y - r);
      ctx.lineTo(x - r, y + r);
      ctx.lineTo(x + r, y + r);
      ctx.moveTo(x - r, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + r);
      break;
    case 'on':
      ctx.moveTo(x - r, y - r);
      ctx.lineTo(x + r, y - r);
      ctx.lineTo(x - r, y + r);
      ctx.lineTo(x + r, y + r);
      ctx.closePath();
      break;
    default:
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      break;
  }
  ctx.fill();
  ctx.stroke();
  const text = snap.length !== undefined ? `${snap.label} · ${formatLength(snap.length, frame.units)}` : snap.label;
  if (text) {
    ctx.font = `11px ${theme.fontSans}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const w = ctx.measureText(text).width + 8;
    ctx.fillStyle = withAlpha(theme.background, 0.9);
    ctx.fillRect(x + 12, y + 10, w, 16);
    ctx.fillStyle = theme.snap;
    ctx.fillText(text, x + 16, y + 12);
  }
  worldSpace(ctx, frame);
}

/** The grips of the selected entity: squares at vertices (the selected one filled), circles at segment middles. Drawn in screen space. */
export function drawGrips(ctx: CanvasRenderingContext2D, frame: RenderFrame, grips: readonly { kind: string; index: number; which: unknown; at: Vec2 }[], selected: { index: number; which: unknown } | null): void {
  if (!grips.length) return;
  screenSpace(ctx, frame);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = frame.theme.selection;
  for (const g of grips) {
    const [x, y] = worldToScreen(frame.camera, frame.size, g.at);
    const isSelected = selected !== null && g.kind === 'vertex' && g.index === selected.index && JSON.stringify(g.which) === JSON.stringify(selected.which);
    ctx.fillStyle = isSelected ? frame.theme.selection : frame.theme.background;
    ctx.beginPath();
    if (g.kind === 'vertex') ctx.rect(Math.round(x) - 4, Math.round(y) - 4, 8, 8);
    else if (g.kind === 'mid') ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    else if (g.kind === 'rotate') {
      ctx.fillStyle = frame.theme.selection;
      ctx.arc(x, y, 5, 0, Math.PI * 2);
    }
    else if (g.kind === 'corner') {
      ctx.fillStyle = frame.theme.selection;
      ctx.moveTo(x, y - 4);
      ctx.lineTo(x + 4, y);
      ctx.lineTo(x, y + 4);
      ctx.lineTo(x - 4, y);
      ctx.closePath();
    } else {
      ctx.moveTo(x, y - 5);
      ctx.lineTo(x + 5, y);
      ctx.lineTo(x, y + 5);
      ctx.lineTo(x - 5, y);
      ctx.closePath();
    }
    ctx.fill();
    ctx.stroke();
  }
  worldSpace(ctx, frame);
}

/** The outline of each selected entity in the selection colour. */
export function drawSelection(ctx: CanvasRenderingContext2D, frame: RenderFrame, selection: ReadonlySet<string>): void {
  if (!selection.size) return;
  ctx.strokeStyle = frame.theme.selection;
  ctx.fillStyle = withAlpha(frame.theme.selection, 0.12);
  ctx.lineWidth = px(frame, 2);
  ctx.lineJoin = 'round';
  for (const pc of frame.connectors ?? []) {
    if (!selection.has(pc.id)) continue;
    ctx.beginPath();
    traceConnector(ctx, pc);
    ctx.fill('nonzero');
    ctx.stroke();
  }
  if (!frame.scene) return;
  for (const id of selection) {
    const item = frame.scene.items.get(id);
    if (!item) continue;
    ctx.beginPath();
    const traced = traceOutline(ctx, item, frame);
    if (traced) {
      if (traced !== 'open') ctx.fill('nonzero');
      ctx.stroke();
    }
  }
}

// ---------- Otto's marks (03-otto.md §c): sizes in screen pixels, whatever the zoom ----------

/** The halo's alpha and width. */
const HALO_ALPHA = 0.22;
const HALO_PX = 34;

/** The highlights worth drawing now, each with its opacity. */
function liveHighlights(frame: RenderFrame): { h: PlanHighlight; opacity: number }[] {
  const now = frame.now ?? Date.now();
  const out: { h: PlanHighlight; opacity: number }[] = [];
  for (const h of frame.highlights ?? []) {
    const opacity = highlightOpacity(h, now, frame.reducedMotion);
    if (opacity > 0) out.push({ h, opacity });
  }
  return out;
}

const connectorOf = (frame: RenderFrame, id: string) => frame.connectors?.find((pc) => pc.id === id);

/** A shown entity of the frame's scene (its layer visible), or undefined. */
function shownItem(frame: RenderFrame, id: string): SceneItem | undefined {
  const item = frame.scene?.items.get(id);
  if (!item || frame.layers[item.layerId]?.visible === false) return undefined;
  return item;
}

/** Traces the line Otto's halo follows for one entity or connector; false when it is not on this plan. */
function traceHalo(ctx: CanvasRenderingContext2D, frame: RenderFrame, id: string): boolean {
  const item = shownItem(frame, id);
  if (item) {
    const e = item.entity;
    if (e.type === 'wall') {
      tracePath(ctx, e.path);
      return true;
    }
    if (e.type === 'opening') {
      const wall = frame.scene?.items.get(e.wallId)?.entity;
      if (!wall || wall.type !== 'wall') return false;
      const { jambs } = openingFrame(wall, e);
      ctx.moveTo(jambs[0][0], jambs[0][1]);
      ctx.lineTo(jambs[1][0], jambs[1][1]);
      return true;
    }
    if (!traceOutline(ctx, item, frame)) ctx.rect(item.minX, item.minY, item.maxX - item.minX, item.maxY - item.minY);
    return true;
  }
  const pc = connectorOf(frame, id);
  if (!pc) return false;
  traceConnector(ctx, pc);
  return true;
}

/** Each highlight's halo: one stroke per edit, so overlapping entities of one edit do not darken. */
function drawAiHalos(ctx: CanvasRenderingContext2D, frame: RenderFrame): void {
  const live = liveHighlights(frame);
  if (!live.length) return;
  ctx.save();
  ctx.strokeStyle = frame.theme.ai;
  ctx.lineWidth = px(frame, HALO_PX);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const { h, opacity } of live) {
    ctx.beginPath();
    let any = false;
    for (const id of h.ids) any = traceHalo(ctx, frame, id) || any;
    if (!any) continue;
    ctx.globalAlpha = HALO_ALPHA * opacity;
    ctx.stroke();
  }
  ctx.restore();
}

/** Where an entity's end nodes sit: a wall's or a line's two ends, an opening's jambs, a room's corners, an item's or a light's centre. */
function nodesOf(frame: RenderFrame, id: string): Vec2[] {
  const item = shownItem(frame, id);
  if (!item) return [];
  const e = item.entity;
  const ends = (path: Path): Vec2[] => (path.closed ? path.v.slice(0, 12).map((v) => v.p) : [path.v[0].p, path.v[path.v.length - 1].p]);
  switch (e.type) {
    case 'wall':
    case 'separator':
    case 'shape':
      return ends(e.path);
    case 'opening': {
      const wall = frame.scene?.items.get(e.wallId)?.entity;
      return wall?.type === 'wall' ? [...openingFrame(wall, e).jambs] : [];
    }
    case 'room':
    case 'slab':
    case 'void':
    case 'shaft': {
      const region = regionOf(e);
      return region ? region.outer.v.slice(0, 12).map((v) => v.p) : [];
    }
    case 'light':
      return [[e.at[0], e.at[1]]];
    case 'item':
      return [[(item.minX + item.maxX) / 2, (item.minY + item.maxY) / 2]];
    default:
      return [];
  }
}

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

/** The box of what an edit shows on this plan, for the tag's anchor. */
function highlightBox(frame: RenderFrame, h: PlanHighlight): Bounds | null {
  let box: Bounds | null = null;
  for (const id of h.ids) {
    const b: Bounds | undefined = shownItem(frame, id) ?? connectorOf(frame, id)?.box;
    if (!b) continue;
    box = box ? { minX: Math.min(box.minX, b.minX), minY: Math.min(box.minY, b.minY), maxX: Math.max(box.maxX, b.maxX), maxY: Math.max(box.maxY, b.maxY) } : { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY };
  }
  return box;
}

/**
 * The tag (`03-otto.md` §c): a pill 24 px tall, padding 0 10 px 0 6 px, the room glyph at 14 px, then
 * the words in the sans at 500, 12/24 (`01-brand.md` §d: words are sans, only numbers and ids are mono).
 */
const TAG_HEIGHT = 24;
const TAG_GLYPH = 14;
const TAG_TEXT_X = 6 + TAG_GLYPH + 5;
const TAG_PAD_RIGHT = 10;

/** The end nodes over the walls, and the tag on the newest edit (on a short leader from its halo), in screen space. */
function drawAiMarks(ctx: CanvasRenderingContext2D, frame: RenderFrame): { highlights: number; aiTag: AiTag | null } {
  const live = liveHighlights(frame);
  if (!live.length) return { highlights: 0, aiTag: null };
  const { theme, size } = frame;
  screenSpace(ctx, frame);
  ctx.save();
  for (const { h, opacity } of live) {
    ctx.globalAlpha = opacity;
    ctx.fillStyle = theme.ai;
    ctx.strokeStyle = theme.background;
    ctx.lineWidth = 1.5;
    for (const id of h.ids) {
      for (const p of nodesOf(frame, id)) {
        const [x, y] = worldToScreen(frame.camera, size, p);
        if (x < -8 || y < -8 || x > size.width + 8 || y > size.height + 8) continue;
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }
  // One tag, on the newest edit that shows here.
  let tag: AiTag | null = null;
  for (let i = live.length - 1; i >= 0 && !tag; i--) {
    const { h, opacity } = live[i];
    const box = highlightBox(frame, h);
    if (!box) continue;
    const [ax, ay] = worldToScreen(frame.camera, size, [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2]);
    if (ax < 0 || ay < 0 || ax > size.width || ay > size.height) continue;
    const text = highlightTag(h.label, (frame.now ?? Date.now()) - h.at);
    ctx.globalAlpha = opacity;
    ctx.font = `500 12px ${theme.fontSans}`;
    const width = Math.ceil(TAG_TEXT_X + ctx.measureText(text).width + TAG_PAD_RIGHT);
    // Out at 45° towards the side with more free canvas, from the halo's edge, 18 px long.
    const dx = ax <= size.width / 2 ? 1 : -1;
    const dy = ay >= size.height / 2 ? -1 : 1;
    const d = Math.SQRT1_2;
    const sx = ax + dx * d * (HALO_PX / 2);
    const sy = ay + dy * d * (HALO_PX / 2);
    const ex = sx + dx * d * 18;
    const ey = sy + dy * d * 18;
    // The leader ends at the tag's corner nearest the halo; the tag stays 8 px inside the canvas.
    const x = Math.min(Math.max(8, dx > 0 ? ex : ex - width), Math.max(8, size.width - 8 - width));
    const y = Math.min(Math.max(8, dy < 0 ? ey - TAG_HEIGHT : ey), Math.max(8, size.height - 8 - TAG_HEIGHT));
    ctx.strokeStyle = theme.ai;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.fillStyle = theme.ai;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, width, TAG_HEIGHT, 6);
    else ctx.rect(x, y, width, TAG_HEIGHT);
    ctx.fill();
    // The room glyph of Otto's mark: the paper square with the pen still on its top-right corner.
    ctx.strokeStyle = theme.aiFg;
    ctx.fillStyle = theme.aiFg;
    // In a 14 px box 6 px in, centred on the pill: a 9 px square, the dot on its corner.
    const gx = x + 6;
    const gy = y + (TAG_HEIGHT - TAG_GLYPH) / 2;
    ctx.lineWidth = 1.3;
    ctx.strokeRect(gx + 2, gy + 3, 9, 9);
    ctx.beginPath();
    ctx.arc(gx + 11, gy + 3, 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + TAG_TEXT_X, y + TAG_HEIGHT / 2 + 0.5);
    tag = { text, x, y, width, height: TAG_HEIGHT };
  }
  ctx.restore();
  return { highlights: live.length, aiTag: tag };
}

/** The polygons a pending call's target is outlined round (before the 3 px offset). */
function pendingPolygons(frame: RenderFrame, id: string): Polygon[] {
  const item = shownItem(frame, id);
  if (item) {
    const e = item.entity;
    const box: Polygon = [
      [item.minX, item.minY],
      [item.maxX, item.minY],
      [item.maxX, item.maxY],
      [item.minX, item.maxY],
    ];
    switch (e.type) {
      case 'wall':
        return frame.walls?.bodies.get(e.id)?.polygons.map((p) => [...p]) ?? [box];
      case 'opening': {
        const wall = frame.scene?.items.get(e.wallId)?.entity;
        return wall?.type === 'wall' ? [openingFrame(wall, e).cut] : [box];
      }
      case 'column':
        return [columnPolygon(e)];
      case 'room':
      case 'slab':
      case 'void':
      case 'shaft': {
        const region = regionOf(e);
        return region ? [flatten(region.outer)] : [box];
      }
      case 'item':
        return item.footprint?.length ? item.footprint.map((p) => [...p]) : [box];
      default:
        return [box];
    }
  }
  const pc = connectorOf(frame, id);
  return pc ? pc.geometry.footprint.map((p) => [...p]) : [];
}

/**
 * The dashed outline round each target of a destructive call Otto waits on: 1.5 px `--plan-ai`, dashes
 * 6 / 4 px, 3 px outside the entity's outline, no fill (`03-otto.md` §c). The editor draws it above the
 * selection; it returns how many targets it outlined.
 */
export function drawPendingOutline(ctx: CanvasRenderingContext2D, frame: RenderFrame, ids: ReadonlySet<string>): number {
  if (!ids.size) return 0;
  let drawn = 0;
  ctx.save();
  ctx.strokeStyle = frame.theme.ai;
  ctx.lineWidth = px(frame, 1.5);
  ctx.lineJoin = 'round';
  ctx.setLineDash([px(frame, 6), px(frame, 4)]);
  ctx.beginPath();
  for (const id of ids) {
    const polys = pendingPolygons(frame, id).filter((p) => p.length >= 3);
    if (!polys.length) continue;
    for (const poly of inflatePolygons(polys, px(frame, 3), 'round')) tracePolygon(ctx, poly);
    drawn++;
  }
  if (drawn) ctx.stroke();
  ctx.restore();
  return drawn;
}

/** Traces an entity's outline; false when it has none worth drawing (its box is used instead), 'open' for a line that must not be filled. */
function traceOutline(ctx: CanvasRenderingContext2D, item: SceneItem, frame: RenderFrame): boolean | 'open' {
  const e = item.entity;
  switch (e.type) {
    case 'wall': {
      const body = frame.walls?.bodies.get(e.id);
      for (const poly of body?.polygons ?? []) tracePolygon(ctx, poly);
      return Boolean(body);
    }
    case 'opening': {
      const wall = frame.scene?.items.get(e.wallId)?.entity;
      if (!wall || wall.type !== 'wall') return false;
      tracePolygon(ctx, openingFrame(wall, e).cut);
      return true;
    }
    case 'column':
      tracePolygon(ctx, columnPolygon(e));
      return true;
    case 'slab':
    case 'void':
    case 'shaft':
    case 'room': {
      const region = regionOf(e);
      if (region) {
        traceRegion(ctx, region);
        return true;
      }
      if (e.type === 'room' && e.boundary.k === 'detect') {
        ctx.arc(e.boundary.seed[0], e.boundary.seed[1], px(frame, 8), 0, Math.PI * 2);
        return true;
      }
      return false;
    }
    case 'separator':
      tracePath(ctx, e.path);
      return 'open';
    case 'shape':
      tracePath(ctx, e.path);
      return e.path.closed ? true : 'open';
    case 'item':
      for (const poly of item.footprint ?? []) tracePolygon(ctx, poly);
      return Boolean(item.footprint?.length);
    case 'light':
      ctx.moveTo(e.at[0] + LIGHT_GLYPH, e.at[1]);
      ctx.arc(e.at[0], e.at[1], LIGHT_GLYPH, 0, Math.PI * 2);
      return true;
    case 'dimension': {
      for (const pts of dimensionOutline(dimensionGeometry(e, resolveDimensionIn(e, frame), null))) {
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      }
      return 'open';
    }
    default:
      ctx.rect(item.minX, item.minY, item.maxX - item.minX, item.maxY - item.minY);
      return true;
  }
}

/** The world transform: mm to device pixels, y up. */
export function worldSpace(ctx: CanvasRenderingContext2D, frame: RenderFrame): void {
  const { size, dpr, camera } = frame;
  const s = camera.scale * dpr;
  ctx.setTransform(s, 0, 0, -s, dpr * (size.width / 2 - camera.x * camera.scale), dpr * (size.height / 2 + camera.y * camera.scale));
}

function screenSpace(ctx: CanvasRenderingContext2D, frame: RenderFrame): void {
  ctx.setTransform(frame.dpr, 0, 0, frame.dpr, 0, 0);
}

/** A stroke width given in screen pixels, in the current world units. */
const px = (frame: RenderFrame, n: number): number => n / frame.camera.scale;

function drawGrid(ctx: CanvasRenderingContext2D, frame: RenderFrame): void {
  const { size, camera, theme } = frame;
  const { minor, major } = gridSpacing(camera.scale, frame.units.system);
  const box = visibleBox(camera, size);
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    ctx.moveTo(Math.round(x0) + 0.5, Math.round(y0) + 0.5);
    ctx.lineTo(Math.round(x1) + 0.5, Math.round(y1) + 0.5);
  };
  ctx.lineWidth = 1;
  for (const [spacing, color, skipMajor] of [
    [minor, theme.grid, true],
    [major, theme.gridMajor, false],
  ] as const) {
    if ((box.maxX - box.minX) / spacing > 600) continue;
    ctx.strokeStyle = color;
    ctx.beginPath();
    for (let x = Math.ceil(box.minX / spacing) * spacing; x <= box.maxX; x += spacing) {
      if (skipMajor && Math.abs(x / major - Math.round(x / major)) < 1e-6) continue;
      const [sx] = worldToScreen(camera, size, [x, 0]);
      line(sx, 0, sx, size.height);
    }
    for (let y = Math.ceil(box.minY / spacing) * spacing; y <= box.maxY; y += spacing) {
      if (skipMajor && Math.abs(y / major - Math.round(y / major)) < 1e-6) continue;
      const [, sy] = worldToScreen(camera, size, [0, y]);
      line(0, sy, size.width, sy);
    }
    ctx.stroke();
  }
  // The origin's axes.
  ctx.strokeStyle = withAlpha(theme.muted, 0.5);
  ctx.beginPath();
  const [ox, oy] = worldToScreen(camera, size, [0, 0]);
  if (ox >= 0 && ox <= size.width) line(ox, 0, ox, size.height);
  if (oy >= 0 && oy <= size.height) line(0, oy, size.width, oy);
  ctx.stroke();
}

function drawUnderlay(ctx: CanvasRenderingContext2D, frame: RenderFrame, scene: LevelScene, visible: { minX: number; minY: number; maxX: number; maxY: number }): void {
  const color = withAlpha(frame.theme.underlay, 0.35);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  for (const item of searchScene(scene, visible)) {
    const e = item.entity;
    const layer = frame.layers[item.layerId];
    if (layer && !layer.visible) continue;
    if (e.type === 'wall') {
      ctx.beginPath();
      tracePath(ctx, e.path);
      ctx.lineWidth = e.thickness;
      ctx.lineJoin = 'miter';
      ctx.lineCap = 'butt';
      ctx.stroke();
    } else if (e.type === 'column') {
      ctx.beginPath();
      traceColumn(ctx, e);
      ctx.fill();
    } else if ((e.type === 'room' || e.type === 'slab') && regionOf(e)) {
      ctx.beginPath();
      traceRegion(ctx, regionOf(e)!);
      ctx.lineWidth = px(frame, 1);
      ctx.stroke();
    } else if (e.type === 'shape' || e.type === 'separator') {
      ctx.beginPath();
      tracePath(ctx, e.path);
      ctx.lineWidth = px(frame, 1);
      ctx.stroke();
    }
  }
}

function regionOf(e: Entity): Region | null {
  if (e.type === 'room') return e.boundary.k === 'region' ? e.boundary.region : null;
  if (e.type === 'slab') return e.source.k === 'region' ? e.source.region : null;
  if (e.type === 'void' || e.type === 'shaft') return e.region;
  return null;
}

function traceColumn(ctx: CanvasPath, e: Extract<Entity, { type: 'column' }>): void {
  const s = e.shape;
  if (s.k === 'circle') {
    ctx.moveTo(e.at[0] + s.r, e.at[1]);
    ctx.arc(e.at[0], e.at[1], s.r, 0, Math.PI * 2);
    return;
  }
  if (s.k === 'region') {
    traceRegion(ctx, s.region);
    return;
  }
  tracePolygon(ctx, columnPolygon(e));
}

function pathOf(item: SceneItem, path: Path): Path2D | null {
  if (item.path2d) return item.path2d;
  if (typeof Path2D === 'undefined') return null;
  const p = new Path2D();
  tracePath(p, path);
  item.path2d = p;
  return p;
}

function regionPath(item: SceneItem, region: Region): Path2D | null {
  if (item.path2d) return item.path2d;
  if (typeof Path2D === 'undefined') return null;
  const p = new Path2D();
  traceRegion(p, region);
  item.path2d = p;
  return p;
}

const GLYPH = PLAN_GLYPHS.point;

function drawEntity(ctx: CanvasRenderingContext2D, item: SceneItem, frame: RenderFrame, texts: TextOp[]): void {
  const { theme } = frame;
  const e = item.entity;
  switch (e.type) {
    case 'wall':
      // Walls are drawn joined, in drawWalls; a wall without derived geometry (no frame.walls) shows its axis.
      if (!frame.walls) {
        const p = pathOf(item, e.path);
        ctx.lineWidth = e.thickness;
        ctx.lineJoin = 'miter';
        ctx.strokeStyle = theme.wall;
        if (p) ctx.stroke(p);
      }
      return;
    case 'opening':
      drawOpening(ctx, item, frame);
      return;
    case 'column': {
      ctx.fillStyle = theme.wall;
      ctx.beginPath();
      traceColumn(ctx, e);
      ctx.fill();
      return;
    }
    case 'slab': {
      const region = regionOf(e);
      if (!region) return;
      ctx.fillStyle = theme.slab;
      // With stairwells or shafts through this floor, the slab is drawn with them cut out.
      const cut = frame.geometry?.cuts.length ? frame.geometry.slabRegions.get(e.id) : undefined;
      if (cut) {
        ctx.beginPath();
        for (const poly of cut) tracePolygon(ctx, poly);
        ctx.fill('nonzero');
        return;
      }
      const p = regionPath(item, region);
      if (p) ctx.fill(p, 'evenodd');
      return;
    }
    case 'void':
    case 'shaft': {
      const p = regionPath(item, e.region);
      if (!p) return;
      ctx.strokeStyle = e.type === 'shaft' ? theme.wallLine : theme.muted;
      ctx.lineWidth = px(frame, 1);
      ctx.setLineDash([px(frame, 6), px(frame, 4)]);
      ctx.stroke(p);
      ctx.setLineDash([]);
      return;
    }
    case 'room': {
      const g = frame.geometry?.rooms.get(e.id);
      if (g?.polygon && g.enclosed) {
        ctx.fillStyle = withAlpha(theme.room, g.shared ? 0.06 : 0.18);
        ctx.strokeStyle = withAlpha(theme.room, 0.6);
        ctx.lineWidth = px(frame, 1);
        ctx.beginPath();
        tracePolygon(ctx, g.polygon);
        for (const h of g.holes) tracePolygon(ctx, h);
        ctx.fill('evenodd');
        ctx.stroke();
        const label = e.number ? `${e.number} ${e.name}` : e.name;
        texts.push({ text: label, at: g.labelAt, screenPx: 12, color: theme.fg, align: 'center', baseline: 'bottom', dy: -2 });
        if (g.shared) texts.push({ text: 'shares its space', at: g.labelAt, screenPx: 10, color: theme.warning, align: 'center', baseline: 'top', dy: 3, mono: true });
        else texts.push({ text: formatArea(g.area, frame.units), at: g.labelAt, screenPx: 11, color: theme.muted, align: 'center', baseline: 'top', dy: 3, mono: true });
        return;
      }
      // Not enclosed (or no geometry yet): a badge at the seed.
      const seed: Vec2 = e.boundary.k === 'detect' ? e.boundary.seed : [(item.minX + item.maxX) / 2, (item.minY + item.maxY) / 2];
      const color = g && !g.enclosed ? theme.warning : theme.room;
      ctx.fillStyle = withAlpha(color, 0.25);
      ctx.strokeStyle = color;
      ctx.lineWidth = px(frame, 1);
      ctx.beginPath();
      ctx.arc(seed[0], seed[1], px(frame, 5), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      texts.push({ text: g && !g.enclosed ? `${e.name} · not enclosed` : e.name, at: seed, screenPx: 12, color: g && !g.enclosed ? theme.warning : theme.fg, align: 'left', baseline: 'middle', dx: 9 });
      return;
    }
    case 'separator': {
      const p = pathOf(item, e.path);
      ctx.strokeStyle = theme.muted;
      ctx.lineWidth = px(frame, 1);
      ctx.setLineDash([px(frame, 8), px(frame, 4)]);
      if (p) ctx.stroke(p);
      ctx.setLineDash([]);
      return;
    }
    case 'shape': {
      const p = pathOf(item, e.path);
      if (!p) return;
      if (e.path.closed && e.filled) {
        ctx.fillStyle = withAlpha(theme.muted, 0.16);
        ctx.fill(p, 'evenodd');
      }
      ctx.strokeStyle = theme.wallLine;
      ctx.lineWidth = px(frame, 1);
      ctx.lineJoin = 'round';
      ctx.stroke(p);
      if (e.name && e.path.closed) texts.push({ text: e.name, at: polygonCentroid(flatten(e.path, 1)), screenPx: 11, color: theme.muted, align: 'center', baseline: 'middle' });
      return;
    }
    case 'item':
      drawItem(ctx, item, frame, texts);
      return;
    case 'light':
      drawLightSymbol(ctx, frame, e, frame.theme.decor);
      return;
    case 'fixture':
    case 'point': {
      const at: Vec2 = [e.at[0], e.at[1]];
      ctx.strokeStyle = theme.muted;
      ctx.lineWidth = px(frame, 1);
      ctx.beginPath();
      if (e.type === 'fixture' && e.size) {
        ctx.rect(at[0] - e.size[0] / 2, at[1] - e.size[1] / 2, e.size[0], e.size[1]);
      } else {
        ctx.arc(at[0], at[1], GLYPH, 0, Math.PI * 2);
        ctx.moveTo(at[0] - GLYPH, at[1]);
        ctx.lineTo(at[0] + GLYPH, at[1]);
        ctx.moveTo(at[0], at[1] - GLYPH);
        ctx.lineTo(at[0], at[1] + GLYPH);
      }
      ctx.stroke();
      return;
    }
    case 'dimension':
      drawDimension(ctx, e, frame, texts);
      return;
    case 'label':
      texts.push({ text: e.text, at: e.at, mm: e.size, color: theme.fg, align: 'center', baseline: 'middle', rotation: e.rotation });
      return;
  }
}

/** How far a light's symbol reaches on the plan, mm. */
export const LIGHT_GLYPH = PLAN_GLYPHS.light;

/** A furniture item: its footprint (the model's outline) filled lightly and outlined, its name when there is room for it. */
function drawItem(ctx: CanvasRenderingContext2D, item: SceneItem, frame: RenderFrame, texts: TextOp[]): void {
  const e = item.entity as Extract<Entity, { type: 'item' }>;
  const polys = item.footprint ?? [];
  if (!polys.length) return;
  const color = frame.theme.decor;
  ctx.fillStyle = withAlpha(color, 0.16);
  ctx.strokeStyle = color;
  ctx.lineWidth = px(frame, 1.25);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (const poly of polys) tracePolygon(ctx, poly);
  ctx.fill('nonzero');
  ctx.stroke();
  const model = itemModel(e.asset, frame.scene?.assets ?? {});
  if (model.details.length > 1) {
    // The parts one sees from above: cushions, a back, pillows.
    ctx.lineWidth = px(frame, 0.75);
    ctx.globalAlpha *= 0.7;
    ctx.beginPath();
    for (const poly of itemFootprint(e, { outline: model.details })) tracePolygon(ctx, poly);
    ctx.stroke();
    ctx.globalAlpha /= 0.7;
    ctx.lineWidth = px(frame, 1.25);
  }
  // Its front (the model's −y side): a short line just inside that edge.
  const [w, d] = itemSize(e, model);
  const r = e.rotation[2] * DEG;
  const front: Vec2 = [Math.sin(r) * Math.sign(e.scale[1]), -Math.cos(r) * Math.sign(e.scale[1])];
  const inset = Math.min(d / 4, px(frame, 4));
  const tickAt = add([e.at[0], e.at[1]], vscale(front, d / 2 - inset));
  const side = vscale(perp(front), w / 4);
  ctx.beginPath();
  ctx.moveTo(tickAt[0] - side[0], tickAt[1] - side[1]);
  ctx.lineTo(tickAt[0] + side[0], tickAt[1] + side[1]);
  ctx.stroke();
  if (Math.min(w, d) * frame.camera.scale >= 48) texts.push({ text: e.name ?? model.name, at: [e.at[0], e.at[1]], screenPx: 10, color: frame.theme.muted, align: 'center', baseline: 'middle' });
}

/** A light on the plan: a circle with rays (and a spot's aim towards its target). */
export function drawLightSymbol(ctx: CanvasRenderingContext2D, frame: RenderFrame, e: Pick<Extract<Entity, { type: 'light' }>, 'at' | 'kind' | 'target'>, color: string): void {
  const [x, y] = e.at;
  const r = LIGHT_GLYPH * 0.45;
  ctx.strokeStyle = color;
  ctx.fillStyle = withAlpha(color, 0.25);
  ctx.lineWidth = px(frame, 1.25);
  ctx.beginPath();
  if (e.kind === 'area') ctx.rect(x - r, y - r, 2 * r, 2 * r);
  else {
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, Math.PI * 2);
  }
  ctx.fill();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    ctx.moveTo(x + Math.cos(a) * r * 1.35, y + Math.sin(a) * r * 1.35);
    ctx.lineTo(x + Math.cos(a) * LIGHT_GLYPH, y + Math.sin(a) * LIGHT_GLYPH);
  }
  if (e.kind === 'spot' && e.target) {
    ctx.moveTo(x, y);
    ctx.lineTo(e.target[0], e.target[1]);
  }
  ctx.stroke();
}

function drawOpening(ctx: CanvasRenderingContext2D, item: SceneItem, frame: RenderFrame): void {
  const e = item.entity as Extract<Entity, { type: 'opening' }>;
  const wall = frame.scene?.items.get(e.wallId)?.entity;
  if (!wall || wall.type !== 'wall') return;
  const others = frame.scene ? (openingsByWall(frame.scene).get(e.wallId) ?? []) : [];
  const misfit = openingMisfits(wall, e, others);
  drawOpeningSymbol(ctx, frame, wall, e, misfit ? frame.theme.warning : frame.theme.wallLine, misfit);
}

/** A dimension's points as they are now: ends tied to a wall or shape follow it. */
function resolveDimensionIn(e: Extract<Entity, { type: 'dimension' }>, frame: RenderFrame) {
  return resolveDimension(e, (id) => frame.scene?.items.get(id)?.entity, (w) => frame.walls?.bodies.get(w.id) ?? wallBody(w));
}

function drawDimension(ctx: CanvasRenderingContext2D, e: Extract<Entity, { type: 'dimension' }>, frame: RenderFrame, texts: TextOp[]): void {
  drawDimensionGeometry(ctx, frame, dimensionGeometry(e, resolveDimensionIn(e, frame), frame.units, px(frame, 6)), frame.theme.dim, texts);
}

/**
 * Draws a dimension's lines, ticks, arc and arrow in a colour, and its text (queued in `texts`, or
 * drawn at once when null, as tools do). Shared by the plan and the Dimension tool's preview.
 */
export function drawDimensionGeometry(ctx: CanvasRenderingContext2D, frame: RenderFrame, g: DimensionGeometry, color: string, texts: TextOp[] | null): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = px(frame, 0.75);
  ctx.setLineDash([]);
  ctx.beginPath();
  for (const [p, q] of g.lines) {
    ctx.moveTo(p[0], p[1]);
    ctx.lineTo(q[0], q[1]);
  }
  if (g.arc) {
    const { center, radius, start, sweep } = g.arc;
    ctx.moveTo(center[0] + Math.cos(start) * radius, center[1] + Math.sin(start) * radius);
    ctx.arc(center[0], center[1], radius, start, start + sweep, sweep < 0);
  }
  // Tick marks (short slashes at 45° to the line or to the arc's radius) and a radius's arrow head.
  for (const [p, q] of dimensionMarks(g, px(frame, 4), px(frame, 8))) {
    ctx.moveTo(p[0], p[1]);
    ctx.lineTo(q[0], q[1]);
  }
  ctx.stroke();
  if (!g.text) return;
  const op: TextOp = { text: g.text, at: g.textAt, screenPx: 11, color, align: 'center', baseline: 'bottom', rotation: g.textAngle, dy: -3, mono: true };
  if (texts) texts.push(op);
  else drawScreenText(ctx, frame, op);
}

function drawTexts(ctx: CanvasRenderingContext2D, frame: RenderFrame, texts: TextOp[]): void {
  if (!texts.length) return;
  screenSpace(ctx, frame);
  for (const op of texts) {
    const size = op.screenPx ?? (op.mm ?? 250) * frame.camera.scale;
    if (size < 5) continue;
    const [sx, sy] = worldToScreen(frame.camera, frame.size, op.at);
    let rotation = -(op.rotation ?? 0);
    // Keep text readable: never upside down.
    const norm = ((rotation % 360) + 360) % 360;
    if (norm > 90 && norm < 270) rotation += 180;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(rotation * DEG);
    ctx.translate(op.dx ?? 0, op.dy ?? 0);
    ctx.font = `${size}px ${op.mono ? frame.theme.fontMono : frame.theme.fontSans}`;
    ctx.fillStyle = op.color;
    ctx.textAlign = op.align;
    ctx.textBaseline = op.baseline;
    ctx.fillText(op.text, 0, 0);
    ctx.restore();
  }
}

/** Resolves a path's segments once; shared by hit-testing and drawing. */
export const segmentsOf = (path: Path) => resolvePath(path).segs;
export { traceSegments };
