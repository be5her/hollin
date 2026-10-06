import { DEG, add, distance, formatLength, normalize, perp, pointAt, resolvePath, scale as vscale, sub, type Entity, type EntityType, type Layer, type Path, type Region, type UnitSettings, type Vec2 } from '@studio/core';
import { visibleBox, worldToScreen, type Camera, type Size } from './camera';
import { tracePath, traceRegion, traceSegments } from './draw';
import { searchScene, type LevelScene, type SceneItem } from './scene';
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
  /** The reference level, drawn faintly under the plan. */
  underlay: LevelScene | null;
  showGrid: boolean;
}

export interface RenderStats {
  /** Entities drawn this frame (the underlay not counted). */
  drawn: number;
  ms: number;
}

/** Back to front. */
const DRAW_ORDER: Record<EntityType, number> = { slab: 0, room: 1, void: 2, shaft: 2, wall: 3, column: 4, opening: 5, fixture: 6, point: 6, item: 6, light: 6, dimension: 7, label: 8 };

interface TextOp {
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
    for (const item of items) {
      const layer = frame.layers[item.layerId];
      if (layer && !layer.visible) continue;
      ctx.globalAlpha = layer?.opacity ?? 1;
      drawEntity(ctx, item, frame, texts);
      drawn++;
    }
    ctx.globalAlpha = 1;
  }
  drawTexts(ctx, frame, texts);
  return { drawn, ms: performance.now() - started };
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
  const a = e.rotation * DEG;
  const u: Vec2 = [Math.cos(a), Math.sin(a)];
  const v = perp(u);
  const corners = [add(add(e.at, vscale(u, -s.w / 2)), vscale(v, -s.d / 2)), add(add(e.at, vscale(u, s.w / 2)), vscale(v, -s.d / 2)), add(add(e.at, vscale(u, s.w / 2)), vscale(v, s.d / 2)), add(add(e.at, vscale(u, -s.w / 2)), vscale(v, s.d / 2))];
  ctx.moveTo(corners[0][0], corners[0][1]);
  for (let i = 1; i < 4; i++) ctx.lineTo(corners[i][0], corners[i][1]);
  ctx.closePath();
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
    case 'wall': {
      // Milestone 4 step 1: the body as a thick stroke along the axis; exact bodies and joins come with step 2.
      const p = pathOf(item, e.path);
      ctx.lineWidth = e.thickness;
      ctx.lineJoin = 'miter';
      ctx.miterLimit = 4;
      ctx.lineCap = 'butt';
      ctx.strokeStyle = theme.wall;
      if (p) ctx.stroke(p);
      else {
        ctx.beginPath();
        tracePath(ctx, e.path);
        ctx.stroke();
      }
      return;
    }
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
  const { theme } = frame;
  const { point: c, tangent: u } = pointAt(wall.path, e.along);
  const n = perp(u);
  const t = wall.thickness;
  const half = e.width / 2;
  // The cut: the wall body between the jambs, in the background colour, slightly oversized to cover the body stroke.
  const jambA = add(c, vscale(u, -half));
  const jambB = add(c, vscale(u, half));
  const corners = [add(jambA, vscale(n, t / 2 + 0.5)), add(jambB, vscale(n, t / 2 + 0.5)), add(jambB, vscale(n, -t / 2 - 0.5)), add(jambA, vscale(n, -t / 2 - 0.5))];
  ctx.fillStyle = theme.background;
  ctx.beginPath();
  ctx.moveTo(corners[0][0], corners[0][1]);
  for (let i = 1; i < 4; i++) ctx.lineTo(corners[i][0], corners[i][1]);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = theme.wallLine;
  ctx.lineWidth = px(frame, 1);
  ctx.beginPath();
  // Jamb lines.
  ctx.moveTo(corners[0][0], corners[0][1]);
  ctx.lineTo(corners[3][0], corners[3][1]);
  ctx.moveTo(corners[1][0], corners[1][1]);
  ctx.lineTo(corners[2][0], corners[2][1]);
  if (e.kind === 'window') {
    for (const k of [-0.25, 0.25]) {
      const a = add(jambA, vscale(n, t * k));
      const b = add(jambB, vscale(n, t * k));
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
    }
  } else if (e.kind === 'door') {
    const hinge = e.swing?.hinge === 'end' ? jambB : jambA;
    const other = hinge === jambA ? jambB : jambA;
    const side = e.swing?.side === 'right' ? -1 : 1;
    const dir = vscale(n, side);
    const leafEnd = add(hinge, vscale(dir, e.width));
    ctx.moveTo(hinge[0], hinge[1]);
    ctx.lineTo(leafEnd[0], leafEnd[1]);
    ctx.stroke();
    ctx.beginPath();
    // A quarter circle from the leaf end to the opposite jamb.
    const a0 = Math.atan2(leafEnd[1] - hinge[1], leafEnd[0] - hinge[0]);
    const a1 = Math.atan2(other[1] - hinge[1], other[0] - hinge[0]);
    let sweep = a1 - a0;
    while (sweep > Math.PI) sweep -= 2 * Math.PI;
    while (sweep < -Math.PI) sweep += 2 * Math.PI;
    ctx.setLineDash([px(frame, 3), px(frame, 3)]);
    ctx.arc(hinge[0], hinge[1], e.width, a0, a0 + sweep, sweep < 0);
    ctx.stroke();
    ctx.setLineDash([]);
    return;
  }
  ctx.stroke();
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
