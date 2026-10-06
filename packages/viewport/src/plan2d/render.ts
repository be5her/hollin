import { DEG, add, columnPolygon, distance, formatLength, normalize, openingFrame, openingMisfits, perp, resolvePath, scale as vscale, sub, type Entity, type EntityType, type Layer, type LevelWalls, type Path, type Region, type UnitSettings, type Vec2 } from '@studio/core';
import { visibleBox, worldToScreen, type Camera, type Size } from './camera';
import { tracePath, tracePolygon, traceRegion, traceSegments } from './draw';
import { entityBox, searchScene, type LevelScene, type SceneItem } from './scene';
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
  /** The reference level, drawn faintly under the plan. */
  underlay: LevelScene | null;
  showGrid: boolean;
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
  const { jambs, normal: n, cut, across } = openingFrame(wall, e);
  const [jambA, jambB] = jambs;
  ctx.strokeStyle = color;
  ctx.lineWidth = px(frame, 1);
  if (outline) {
    ctx.fillStyle = withAlpha(color, 0.12);
    ctx.beginPath();
    tracePolygon(ctx, cut);
    ctx.fill();
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(cut[0][0], cut[0][1]);
  ctx.lineTo(cut[3][0], cut[3][1]);
  ctx.moveTo(cut[1][0], cut[1][1]);
  ctx.lineTo(cut[2][0], cut[2][1]);
  if (e.kind === 'window') {
    const mid = (across.left + across.right) / 2;
    const quarter = (across.left - across.right) / 4;
    for (const k of [mid - quarter, mid + quarter]) {
      const a = add(jambA, vscale(n, k));
      const b = add(jambB, vscale(n, k));
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
    }
    ctx.stroke();
    return;
  }
  if (e.kind !== 'door') {
    ctx.stroke();
    return;
  }
  const hinge = e.swing?.hinge === 'end' ? jambB : jambA;
  const other = hinge === jambA ? jambB : jambA;
  const side = e.swing?.side === 'right' ? -1 : 1;
  const leafEnd = add(hinge, vscale(n, side * e.width));
  ctx.moveTo(hinge[0], hinge[1]);
  ctx.lineTo(leafEnd[0], leafEnd[1]);
  ctx.stroke();
  ctx.beginPath();
  const a0 = Math.atan2(leafEnd[1] - hinge[1], leafEnd[0] - hinge[0]);
  const a1 = Math.atan2(other[1] - hinge[1], other[0] - hinge[0]);
  let sweep = a1 - a0;
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  while (sweep < -Math.PI) sweep += 2 * Math.PI;
  ctx.setLineDash([px(frame, 3), px(frame, 3)]);
  ctx.arc(hinge[0], hinge[1], e.width, a0, a0 + sweep, sweep < 0);
  ctx.stroke();
  ctx.setLineDash([]);
}

export interface RenderStats {
  /** Entities drawn this frame (the underlay not counted). */
  drawn: number;
  ms: number;
}

/** Back to front. */
const DRAW_ORDER: Record<EntityType, number> = { slab: 0, room: 1, void: 2, shaft: 2, wall: 3, column: 4, opening: 5, fixture: 6, point: 6, item: 6, light: 6, dimension: 7, label: 8 };

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
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, size.width, size.height);
  if (frame.showGrid) drawGrid(ctx, frame);

  const texts: TextOp[] = [];
  const visible = visibleBox(camera, size);
  worldSpace(ctx, frame);
  if (frame.underlay) drawUnderlay(ctx, frame, frame.underlay, visible);
  let drawn = 0;
  if (frame.scene) {
    const items = searchScene(frame.scene, visible).sort((a, b) => DRAW_ORDER[a.type] - DRAW_ORDER[b.type] || (a.id < b.id ? -1 : 1));
    let wallsDrawn = false;
    for (const item of items) {
      const layer = frame.layers[item.layerId];
      if (layer && !layer.visible) continue;
      if (DRAW_ORDER[item.type] >= DRAW_ORDER.wall && !wallsDrawn) {
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
    if (!wallsDrawn) drawWalls(ctx, frame);
    ctx.globalAlpha = 1;
  }
  drawTexts(ctx, frame, texts);
  return { drawn, ms: performance.now() - started };
}

/** Text at a world position, drawn in screen space; for tools and overlays. Restores the world transform afterwards. */
export function drawScreenText(ctx: CanvasRenderingContext2D, frame: RenderFrame, op: TextOp): void {
  drawTexts(ctx, frame, [op]);
  worldSpace(ctx, frame);
}

/** An entity that is not (yet) in the scene, e.g. a drag preview: drawn like the real thing, without caching. */
export function drawEntityPreview(ctx: CanvasRenderingContext2D, entity: Entity, frame: RenderFrame): void {
  const texts: TextOp[] = [];
  const box = entityBox(entity, frame.scene ? Object.fromEntries([...frame.scene.items].map(([id, item]) => [id, item.entity])) : {});
  const item: SceneItem = { ...box, id: entity.id, type: entity.type, layerId: entity.layerId, entity, path2d: null };
  drawEntity(ctx, item, frame, texts);
  drawTexts(ctx, frame, texts);
  worldSpace(ctx, frame);
}

/** The snap marker at the snapped point (a glyph per kind), its guide lines and a label. */
export function drawSnap(ctx: CanvasRenderingContext2D, frame: RenderFrame, snap: { point: Vec2; kind: string; label: string; guides: { from: Vec2; to: Vec2 }[] }): void {
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
  if (snap.label) {
    ctx.font = `11px ${theme.fontSans}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const w = ctx.measureText(snap.label).width + 8;
    ctx.fillStyle = withAlpha(theme.background, 0.9);
    ctx.fillRect(x + 12, y + 10, w, 16);
    ctx.fillStyle = theme.snap;
    ctx.fillText(snap.label, x + 16, y + 12);
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
    else {
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
  if (!selection.size || !frame.scene) return;
  ctx.strokeStyle = frame.theme.selection;
  ctx.fillStyle = withAlpha(frame.theme.selection, 0.12);
  ctx.lineWidth = px(frame, 2);
  ctx.lineJoin = 'round';
  for (const id of selection) {
    const item = frame.scene.items.get(id);
    if (!item) continue;
    ctx.beginPath();
    if (traceOutline(ctx, item, frame)) {
      ctx.fill('nonzero');
      ctx.stroke();
    }
  }
}

/** Traces an entity's outline; false when it has none worth drawing (its box is used instead). */
function traceOutline(ctx: CanvasRenderingContext2D, item: SceneItem, frame: RenderFrame): boolean {
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
    case 'dimension': {
      const u = normalize(sub(e.to, e.from));
      const n = perp(u);
      const a = add(e.from, vscale(n, e.offset));
      const b = add(e.to, vscale(n, e.offset));
      ctx.moveTo(e.from[0], e.from[1]);
      ctx.lineTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.lineTo(e.to[0], e.to[1]);
      return true;
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

const GLYPH = 100;

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
      const p = regionPath(item, region);
      ctx.fillStyle = theme.slab;
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
      if (e.boundary.k === 'region') {
        const p = regionPath(item, e.boundary.region);
        if (p) {
          ctx.fillStyle = withAlpha(theme.room, 0.1);
          ctx.fill(p, 'evenodd');
          ctx.strokeStyle = withAlpha(theme.room, 0.6);
          ctx.lineWidth = px(frame, 1);
          ctx.stroke(p);
        }
        texts.push({ text: e.name, at: [(item.minX + item.maxX) / 2, (item.minY + item.maxY) / 2], screenPx: 12, color: theme.fg, align: 'center', baseline: 'middle' });
      } else {
        const seed = e.boundary.seed;
        ctx.fillStyle = withAlpha(theme.room, 0.25);
        ctx.strokeStyle = theme.room;
        ctx.lineWidth = px(frame, 1);
        ctx.beginPath();
        ctx.arc(seed[0], seed[1], px(frame, 5), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        texts.push({ text: e.name, at: seed, screenPx: 12, color: theme.fg, align: 'left', baseline: 'middle', dx: 9 });
      }
      return;
    }
    case 'fixture':
    case 'point':
    case 'item':
    case 'light': {
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

function drawOpening(ctx: CanvasRenderingContext2D, item: SceneItem, frame: RenderFrame): void {
  const e = item.entity as Extract<Entity, { type: 'opening' }>;
  const wall = frame.scene?.items.get(e.wallId)?.entity;
  if (!wall || wall.type !== 'wall') return;
  const others = frame.scene ? (openingsByWall(frame.scene).get(e.wallId) ?? []) : [];
  const misfit = openingMisfits(wall, e, others);
  drawOpeningSymbol(ctx, frame, wall, e, misfit ? frame.theme.warning : frame.theme.wallLine, misfit);
}

function drawDimension(ctx: CanvasRenderingContext2D, e: Extract<Entity, { type: 'dimension' }>, frame: RenderFrame, texts: TextOp[]): void {
  const { theme } = frame;
  const d = distance(e.from, e.to);
  if (d < 1e-6) return;
  const u = normalize(sub(e.to, e.from));
  const n = perp(u);
  const a = add(e.from, vscale(n, e.offset));
  const b = add(e.to, vscale(n, e.offset));
  const over = px(frame, 6) * Math.sign(e.offset || 1);
  ctx.strokeStyle = theme.dim;
  ctx.lineWidth = px(frame, 0.75);
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  for (const [p, q] of [
    [e.from, a],
    [e.to, b],
  ] as const) {
    const ext = add(q, vscale(n, over));
    ctx.moveTo(p[0], p[1]);
    ctx.lineTo(ext[0], ext[1]);
  }
  // Tick marks: short slashes at 45°.
  const tick = px(frame, 4);
  const slash = normalize(add(u, n));
  for (const p of [a, b]) {
    const s0 = sub(p, vscale(slash, tick));
    const s1 = add(p, vscale(slash, tick));
    ctx.moveTo(s0[0], s0[1]);
    ctx.lineTo(s1[0], s1[1]);
  }
  ctx.stroke();
  const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  texts.push({ text: formatLength(d, frame.units), at: mid, screenPx: 11, color: theme.dim, align: 'center', baseline: 'bottom', rotation: Math.atan2(u[1], u[0]) / DEG, dy: -3, mono: true });
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
