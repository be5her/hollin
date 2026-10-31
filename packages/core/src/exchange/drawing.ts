import { DEFAULT_RULE_LIMITS, defaultConfig, type RuleLimits, type UnitSettings } from '../config';
import { itemFootprint, itemModel, itemSize } from '../decor/items';
import { deriveLevels, entitiesOnLevel } from '../doc/derive';
import type { Entity, EntityOf, ProjectDoc } from '../doc/schema';
import { regionPolygons } from '../geometry/clip';
import { connectorCuts, connectorsOnLevel, deriveConnector, type ConnectorGeometry, type ConnectorRole } from '../geometry/connectors';
import { dimensionGeometry, dimensionMarks, resolveDimension } from '../geometry/dimensions';
import { deriveRooms, deriveWalls, type Opening, type Wall } from '../geometry/level-geometry';
import { columnPolygon, openingMisfits, openingSymbol } from '../geometry/openings';
import { arcGeometry, flatten, flattenSegment, resolvePath, type Path, type Region, type Seg } from '../geometry/path';
import { PLAN_GLYPHS, arrowHeadLines, breakLinePoints, walkSegments, walkTangent } from '../geometry/plan-symbols';
import { polygonCentroid } from '../geometry/polygon';
import { DEG, add, emptyBox, extendBox, perp, scale, sub, type Box, type Vec2 } from '../geometry/vec';
import { wallBody } from '../geometry/walls';
import { formatArea } from '../units';

/*
 * A level's plan as a pure, layered vector drawing in millimetres (y up, as the model), from the
 * same derived geometry the canvas draws. DXF, SVG and PDF are writers over it.
 */

/** What a layer of the drawing holds, back to front. */
export const DRAWING_LAYER_KINDS = ['slabs', 'rooms', 'voids', 'shapes', 'separators', 'walls', 'columns', 'openings', 'fixtures', 'furniture', 'lights', 'connectors', 'dimensions', 'labels'] as const;
export type DrawingLayerKind = (typeof DRAWING_LAYER_KINDS)[number];

/** A colour by its role on the plan (the plan theme's names), so each writer picks its own palette. */
export type DrawingColor = 'fg' | 'muted' | 'wall' | 'wallLine' | 'room' | 'slab' | 'dim' | 'connector' | 'decor' | 'warning';

/** A piece of a stroke: a straight line, or a circular arc kept exact (radians, `sweep` positive counter-clockwise; a full circle sweeps ±2π and ends where it starts). */
export type DrawingSegment = { k: 'line'; a: Vec2; b: Vec2 } | { k: 'arc'; a: Vec2; b: Vec2; center: Vec2; radius: number; start: number; sweep: number };

/** A pen line: segments end to end. `width` and `dash` (on, off, ... lengths) are on paper, in mm, whatever the drawing's scale. */
export interface DrawingStroke {
  type: 'stroke';
  segs: DrawingSegment[];
  closed: boolean;
  width: number;
  dash?: readonly number[];
  /** Overrides the layer's colour. */
  color?: DrawingColor;
}

/** An area: flattened rings (outlines counter-clockwise, holes clockwise; even-odd and non-zero agree). */
export interface DrawingFill {
  type: 'fill';
  rings: Vec2[][];
  color: DrawingColor;
  /** 1 for poché (walls, columns), slabs and marks, a tint below that. */
  opacity: number;
  /** A small solid mark (a stair's or ramp's start dot), part of the drawing proper on any layer, so a CAD writer hatches it too. */
  mark?: boolean;
}

/** A single line of text; `height` in drawing mm, `rotation` in degrees counter-clockwise, always kept readable (−90° to 90°). */
export interface DrawingText {
  type: 'text';
  at: Vec2;
  text: string;
  height: number;
  rotation: number;
  align: 'left' | 'center' | 'right';
  baseline: 'bottom' | 'middle' | 'top';
  mono?: boolean;
  color?: DrawingColor;
}

export type DrawingPrimitive = DrawingStroke | DrawingFill | DrawingText;

export interface DrawingLayer {
  kind: DrawingLayerKind;
  /** A human name, used as the DXF layer and the SVG group. */
  name: string;
  color: DrawingColor;
  /** Whether the fills are part of the drawing proper (poché: walls, columns), so a CAD writer hatches them; other fills are tints for SVG and PDF. */
  hatch: boolean;
  primitives: DrawingPrimitive[];
}

export interface PlanDrawing {
  levelId: string;
  levelName: string;
  /** The units the texts were written in. */
  units: UnitSettings;
  /** The extent of everything drawn, mm (empty when nothing is). */
  bounds: Box;
  /** Back to front; only layers with something on them. */
  layers: DrawingLayer[];
}

export interface PlanDrawingOptions {
  /** For areas and lengths in texts; the app's defaults otherwise. */
  units?: UnitSettings;
  /** The limits connectors are derived with (risers, the plan cut). */
  limits?: Readonly<RuleLimits>;
  /** The layer kinds to draw; all of them by default. */
  layers?: readonly DrawingLayerKind[];
  /** Leave out entities on hidden layers (default true). Hidden walls still enclose rooms, as on the plan. */
  skipHidden?: boolean;
  /** The text height of room names, mm in the drawing (default 200, 2 mm on paper at 1:100); the other texts and symbols scale from it. Labels keep their own size. */
  textHeight?: number;
}

const LAYER_META: Record<DrawingLayerKind, { name: string; color: DrawingColor; hatch: boolean }> = {
  slabs: { name: 'Slabs', color: 'muted', hatch: false },
  rooms: { name: 'Rooms', color: 'room', hatch: false },
  voids: { name: 'Voids and shafts', color: 'muted', hatch: false },
  shapes: { name: 'Shapes', color: 'wallLine', hatch: false },
  separators: { name: 'Room dividers', color: 'muted', hatch: false },
  walls: { name: 'Walls', color: 'wallLine', hatch: true },
  columns: { name: 'Columns', color: 'wallLine', hatch: true },
  openings: { name: 'Doors and windows', color: 'wallLine', hatch: false },
  fixtures: { name: 'Fixtures and points', color: 'muted', hatch: false },
  furniture: { name: 'Furniture', color: 'decor', hatch: false },
  lights: { name: 'Lights', color: 'decor', hatch: false },
  connectors: { name: 'Stairs and lifts', color: 'connector', hatch: false },
  dimensions: { name: 'Dimensions', color: 'dim', hatch: false },
  labels: { name: 'Labels', color: 'fg', hatch: false },
};

/** Pen widths on paper, mm. */
const PEN = { heavy: 0.5, medium: 0.35, normal: 0.25, thin: 0.18, fine: 0.13, mark: 0.7 } as const;
/** Dash patterns on paper, mm. */
const DASH = { swing: [1, 1], void: [2, 1.3], divider: [2.5, 1.2], aboveCut: [1.3, 1] } as const;
/** How finely curves that cannot stay arcs (Béziers, fills) are flattened, mm. */
const TOLERANCE = 0.5;
/** An arc sweeping less than this (radians) is left out: the writers would take one that starts where it ends for a full circle. */
const MIN_SWEEP = 1e-9;

// ---------- primitives ----------

/** Resolved segments as drawing segments: lines and arcs exact, Béziers flattened. */
export function drawingSegments(segs: readonly Seg[]): DrawingSegment[] {
  const out: DrawingSegment[] = [];
  for (const s of segs) {
    if (s.k === 'line') out.push({ k: 'line', a: s.a, b: s.b });
    else if (s.k === 'arc') {
      const g = arcGeometry(s.a, s.b, s.bulge);
      out.push({ k: 'arc', a: s.a, b: s.b, center: g.center, radius: g.radius, start: g.start, sweep: g.sweep });
    } else {
      const pts: Vec2[] = [];
      flattenSegment(s, TOLERANCE, pts);
      pts.push(s.b);
      for (let i = 1; i < pts.length; i++) out.push({ k: 'line', a: pts[i - 1], b: pts[i] });
    }
  }
  return out;
}

const polySegs = (pts: readonly Vec2[], closed: boolean): DrawingSegment[] => {
  const out: DrawingSegment[] = [];
  for (let i = 1; i < pts.length; i++) out.push({ k: 'line', a: pts[i - 1], b: pts[i] });
  if (closed && pts.length > 2) out.push({ k: 'line', a: pts[pts.length - 1], b: pts[0] });
  return out;
};

const stroke = (segs: DrawingSegment[], closed: boolean, width: number, extra: { dash?: readonly number[]; color?: DrawingColor } = {}): DrawingStroke => ({ type: 'stroke', segs, closed, width, ...(extra.dash ? { dash: extra.dash } : {}), ...(extra.color ? { color: extra.color } : {}) });
const pathStroke = (path: Path, width: number, extra: { dash?: readonly number[]; color?: DrawingColor } = {}): DrawingStroke => stroke(drawingSegments(resolvePath(path).segs), path.closed, width, extra);
const polyStroke = (pts: readonly Vec2[], closed: boolean, width: number, extra: { dash?: readonly number[]; color?: DrawingColor } = {}): DrawingStroke => stroke(polySegs(pts, closed), closed, width, extra);
const lineStroke = (a: Vec2, b: Vec2, width: number, extra: { dash?: readonly number[]; color?: DrawingColor } = {}): DrawingStroke => stroke([{ k: 'line', a, b }], false, width, extra);
const arcSeg = (center: Vec2, radius: number, start: number, sweep: number): DrawingSegment => ({
  k: 'arc',
  a: [center[0] + radius * Math.cos(start), center[1] + radius * Math.sin(start)],
  b: [center[0] + radius * Math.cos(start + sweep), center[1] + radius * Math.sin(start + sweep)],
  center,
  radius,
  start,
  sweep,
});
const circleStroke = (center: Vec2, radius: number, width: number, extra: { color?: DrawingColor } = {}): DrawingStroke => {
  const seg = arcSeg(center, radius, 0, 2 * Math.PI);
  return stroke([{ ...seg, b: seg.a }], true, width, extra);
};
const fill = (rings: readonly (readonly Vec2[])[], color: DrawingColor, opacity: number): DrawingFill => ({ type: 'fill', rings: rings.filter((r) => r.length >= 3).map((r) => [...r]), color, opacity });
const circleRing = (center: Vec2, radius: number): Vec2[] => {
  const n = Math.max(16, Math.min(96, Math.ceil((2 * Math.PI * radius) / 20)));
  return Array.from({ length: n }, (_, i): Vec2 => [center[0] + radius * Math.cos((i / n) * 2 * Math.PI), center[1] + radius * Math.sin((i / n) * 2 * Math.PI)]);
};

/** An angle in degrees turned so text never reads upside down: (−90°, 90°]. */
export function readableAngle(degrees: number): number {
  let r = ((degrees % 360) + 360) % 360;
  if (r > 90 && r <= 270) r -= 180;
  else if (r > 270) r -= 360;
  return r;
}

/** The text's "up" direction for a rotation in degrees. */
const upOf = (degrees: number): Vec2 => [-Math.sin(degrees * DEG), Math.cos(degrees * DEG)];

const text = (at: Vec2, value: string, height: number, extra: Partial<Omit<DrawingText, 'type' | 'at' | 'text' | 'height'>> = {}): DrawingText => ({
  type: 'text',
  at,
  text: value,
  height,
  rotation: readableAngle(extra.rotation ?? 0),
  align: extra.align ?? 'center',
  baseline: extra.baseline ?? 'middle',
  ...(extra.mono ? { mono: true } : {}),
  ...(extra.color ? { color: extra.color } : {}),
});

// ---------- the level ----------

const regionOf = (e: Entity): Region | null => {
  if (e.type === 'room') return e.boundary.k === 'region' ? e.boundary.region : null;
  if (e.type === 'slab') return e.source.k === 'region' ? e.source.region : null;
  if (e.type === 'void' || e.type === 'shaft') return e.region;
  return null;
};

/**
 * One level of a document as a layered vector drawing: the joined walls (outlines and holes, with the
 * openings cut out), door and window symbols, rooms with their names and areas, columns, slabs,
 * voids and shafts, shapes, room dividers, fixtures and points, dimensions, labels, furniture
 * footprints, lights and the connectors' plan symbols, as the plan view draws them. Entities that
 * span up from other levels show too. Pure: nothing is cached or drawn.
 */
export function planDrawing(doc: ProjectDoc, levelId: string, options: PlanDrawingOptions = {}): PlanDrawing {
  const units = options.units ?? defaultConfig().units;
  const limits = options.limits ?? DEFAULT_RULE_LIMITS;
  const include = new Set<DrawingLayerKind>(options.layers ?? DRAWING_LAYER_KINDS);
  const skipHidden = options.skipHidden ?? true;
  const h = options.textHeight ?? 200;
  const level = doc.levels[levelId];
  const layers = new Map<DrawingLayerKind, DrawingLayer>();
  const out = (kind: DrawingLayerKind): DrawingPrimitive[] | null => {
    if (!include.has(kind)) return null;
    let layer = layers.get(kind);
    if (!layer) {
      layer = { kind, ...LAYER_META[kind], primitives: [] };
      layers.set(kind, layer);
    }
    return layer.primitives;
  };
  const finish = (): PlanDrawing => {
    const list = DRAWING_LAYER_KINDS.map((k) => layers.get(k)).filter((l): l is DrawingLayer => Boolean(l?.primitives.length));
    return { levelId, levelName: level?.name ?? levelId, units, bounds: drawingBounds(list), layers: list };
  };
  if (!level || !doc.levelData[levelId]) return finish();

  // The level's entities and those spanning up through it, as on the plan.
  const entities: Record<string, Entity> = Object.fromEntries(
    entitiesOnLevel(doc, levelId)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((e) => [e.id, e]),
  );
  const hidden = (e: Entity) => skipHidden && doc.layers[e.layerId]?.visible === false;
  const walls: Wall[] = [];
  const openings: Opening[] = [];
  const hiddenWalls = new Set<string>();
  for (const e of Object.values(entities)) {
    if (e.type === 'wall') {
      walls.push(e);
      if (hidden(e)) hiddenWalls.add(e.id);
    } else if (e.type === 'opening') openings.push(e);
  }
  // Rooms are enclosed by every wall (hiding is a view choice); the drawn walls leave the hidden ones out.
  const allWalls = deriveWalls(walls, { openings });
  const drawnWalls = hiddenWalls.size ? deriveWalls(walls, { openings, exclude: hiddenWalls }) : allWalls;
  const geometry = deriveRooms(entities, allWalls, connectorCuts(doc, levelId, limits));
  const bodyOf = (w: Wall) => allWalls.bodies.get(w.id) ?? wallBody(w);

  // Walls: one poché fill and every outline (outer loops and holes).
  const wallLayer = out('walls');
  if (wallLayer && drawnWalls.cut.length) {
    wallLayer.push(fill(drawnWalls.cut, 'wall', 1));
    for (const ring of drawnWalls.cut) wallLayer.push(polyStroke(ring, true, PEN.heavy));
  }

  // The automatic slab, when one of its entities is on a shown layer.
  const slabLayer = out('slabs');
  if (slabLayer && geometry.slab.length && geometry.autoSlabs.some((s) => !(skipHidden && doc.layers[s.layerId]?.visible === false))) {
    slabLayer.push(fill(geometry.slab, 'slab', 1));
    for (const ring of geometry.slab) slabLayer.push(polyStroke(ring, true, PEN.fine));
  }

  const byWall = new Map<string, Opening[]>();
  for (const o of openings) byWall.set(o.wallId, [...(byWall.get(o.wallId) ?? []), o]);

  for (const e of Object.values(entities)) {
    if (hidden(e)) continue;
    switch (e.type) {
      case 'wall':
        break;
      case 'opening': {
        const layer = out('openings');
        const wall = entities[e.wallId];
        if (!layer || !wall || wall.type !== 'wall' || hiddenWalls.has(wall.id)) break;
        const color: DrawingColor | undefined = openingMisfits(wall, e, byWall.get(e.wallId) ?? []) ? 'warning' : undefined;
        const symbol = openingSymbol(wall, e);
        for (const [a, b] of [...symbol.jambs, ...symbol.glazing]) layer.push(lineStroke(a, b, PEN.normal, { color }));
        if (symbol.leaf) layer.push(lineStroke(symbol.leaf[0], symbol.leaf[1], PEN.normal, { color }));
        if (symbol.swing && Math.abs(symbol.swing.sweep) >= MIN_SWEEP) layer.push(stroke([arcSeg(symbol.swing.center, symbol.swing.radius, symbol.swing.start, symbol.swing.sweep)], false, PEN.fine, { dash: DASH.swing, color }));
        break;
      }
      case 'column': {
        const layer = out('columns');
        if (!layer) break;
        const s = e.shape;
        if (s.k === 'circle') {
          layer.push(fill([circleRing(e.at, s.r)], 'wall', 1));
          layer.push(circleStroke(e.at, s.r, PEN.medium));
        } else if (s.k === 'region') {
          layer.push(fill(regionPolygons(s.region), 'wall', 1));
          for (const p of [s.region.outer, ...s.region.holes]) layer.push(pathStroke(p, PEN.medium));
        } else {
          const poly = columnPolygon(e);
          layer.push(fill([poly], 'wall', 1));
          layer.push(polyStroke(poly, true, PEN.medium));
        }
        break;
      }
      case 'slab': {
        const layer = out('slabs');
        const region = regionOf(e);
        if (!layer || !region) break;
        const polys = geometry.slabRegions.get(e.id) ?? regionPolygons(region);
        layer.push(fill(polys, 'slab', 1));
        for (const ring of polys) layer.push(polyStroke(ring, true, PEN.fine));
        break;
      }
      case 'void':
      case 'shaft': {
        const layer = out('voids');
        if (!layer) break;
        const color: DrawingColor = e.type === 'shaft' ? 'wallLine' : 'muted';
        for (const p of [e.region.outer, ...e.region.holes]) layer.push(pathStroke(p, PEN.thin, { dash: DASH.void, color }));
        break;
      }
      case 'room':
        drawRoom(e, out('rooms'));
        break;
      case 'separator': {
        const layer = out('separators');
        if (layer) layer.push(pathStroke(e.path, PEN.thin, { dash: DASH.divider }));
        break;
      }
      case 'shape': {
        const layer = out('shapes');
        if (!layer) break;
        if (e.path.closed && e.filled) layer.push(fill([flatten(e.path, TOLERANCE)], 'muted', 0.16));
        layer.push(pathStroke(e.path, PEN.normal));
        if (e.name && e.path.closed) layer.push(text(polygonCentroid(flatten(e.path, 1)), e.name, h * 0.85, { color: 'muted' }));
        break;
      }
      case 'fixture':
      case 'point': {
        const layer = out('fixtures');
        if (!layer) break;
        const at = e.at;
        if (e.type === 'fixture' && e.size) {
          const r = e.rotation * DEG;
          const u: Vec2 = [Math.cos(r), Math.sin(r)];
          const v = perp(u);
          const [w, d] = e.size;
          const corner = (i: number, j: number): Vec2 => add(add(at, scale(u, (i * w) / 2)), scale(v, (j * d) / 2));
          layer.push(polyStroke([corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)], true, PEN.thin));
        } else {
          const g = PLAN_GLYPHS.point;
          layer.push(circleStroke(at, g, PEN.thin));
          layer.push(lineStroke([at[0] - g, at[1]], [at[0] + g, at[1]], PEN.thin));
          layer.push(lineStroke([at[0], at[1] - g], [at[0], at[1] + g], PEN.thin));
        }
        break;
      }
      case 'dimension': {
        const layer = out('dimensions');
        if (!layer) break;
        const dh = h * 0.8;
        const g = dimensionGeometry(e, resolveDimension(e, entities, bodyOf), units, dh * 0.5);
        for (const [p, q] of g.lines) layer.push(lineStroke(p, q, PEN.fine));
        if (g.arc && Math.abs(g.arc.sweep) >= MIN_SWEEP) layer.push(stroke([arcSeg(g.arc.center, g.arc.radius, g.arc.start, g.arc.sweep)], false, PEN.fine));
        for (const [p, q] of dimensionMarks(g, dh * 0.35, dh * 0.7)) layer.push(lineStroke(p, q, PEN.thin));
        if (g.text) {
          const rotation = readableAngle(g.textAngle);
          layer.push(text(add(g.textAt, scale(upOf(rotation), dh * 0.25)), g.text, dh, { rotation, baseline: 'bottom', mono: true }));
        }
        break;
      }
      case 'label': {
        const layer = out('labels');
        if (layer) layer.push(text(e.at, e.text, e.size, { rotation: e.rotation }));
        break;
      }
      case 'item':
        drawItem(e, out('furniture'));
        break;
      case 'light':
        drawLight(e, out('lights'));
        break;
    }
  }

  const connectorLayer = out('connectors');
  if (connectorLayer) {
    const levels = deriveLevels(doc);
    for (const { connector, role } of connectorsOnLevel(doc, levelId, levels)) drawConnector(deriveConnector(connector, levels, limits), role, connectorLayer);
  }
  return finish();

  // ---------- per entity ----------

  function drawRoom(e: EntityOf<'room'>, layer: DrawingPrimitive[] | null): void {
    if (!layer) return;
    const g = geometry.rooms.get(e.id);
    const gap = h * 0.15;
    if (g?.polygon && g.enclosed) {
      layer.push(fill([g.polygon, ...g.holes], 'room', g.shared ? 0.06 : 0.18));
      for (const ring of [g.polygon, ...g.holes]) layer.push(polyStroke(ring, true, PEN.fine));
      const name = e.number ? `${e.number} ${e.name}` : e.name;
      layer.push(text(add(g.labelAt, [0, gap]), name, h, { baseline: 'bottom', color: 'fg' }));
      if (g.shared) layer.push(text(sub(g.labelAt, [0, gap]), 'shares its space', h * 0.8, { baseline: 'top', mono: true, color: 'warning' }));
      else layer.push(text(sub(g.labelAt, [0, gap]), formatArea(g.area, units), h * 0.9, { baseline: 'top', mono: true, color: 'muted' }));
      return;
    }
    // Not enclosed (a seed outside every space): a mark at the seed and the name.
    const region = regionOf(e);
    let seed: Vec2;
    if (e.boundary.k === 'detect') seed = e.boundary.seed;
    else if (region) seed = polygonCentroid(flatten(region.outer, 1));
    else return;
    const color: DrawingColor = g && !g.enclosed ? 'warning' : 'room';
    layer.push(circleStroke(seed, h * 0.4, PEN.thin, { color }));
    layer.push(text(add(seed, [h * 0.75, 0]), g && !g.enclosed ? `${e.name} · not enclosed` : e.name, h, { align: 'left', color: g && !g.enclosed ? 'warning' : 'fg' }));
  }

  function drawItem(e: EntityOf<'item'>, layer: DrawingPrimitive[] | null): void {
    if (!layer) return;
    const model = itemModel(e.asset, doc.assets);
    const polys = itemFootprint(e, model);
    if (!polys.length) return;
    layer.push(fill(polys, 'decor', 0.16));
    for (const poly of polys) layer.push(polyStroke(poly, true, PEN.thin));
    // The parts one sees from above: cushions, a back, pillows.
    if (model.details.length > 1) for (const poly of itemFootprint(e, { outline: model.details })) layer.push(polyStroke(poly, true, PEN.fine));
    // Its front (the model's −y side): a short line just inside that edge.
    const [w, d] = itemSize(e, model);
    const r = e.rotation[2] * DEG;
    const front: Vec2 = [Math.sin(r) * Math.sign(e.scale[1]), -Math.cos(r) * Math.sign(e.scale[1])];
    const at: Vec2 = [e.at[0], e.at[1]];
    const tickAt = add(at, scale(front, d / 2 - Math.min(d / 4, h * 0.2)));
    const side = scale(perp(front), w / 4);
    layer.push(lineStroke(sub(tickAt, side), add(tickAt, side), PEN.thin));
    const th = h * 0.7;
    if (Math.min(w, d) >= th * 4) layer.push(text(at, e.name ?? model.name, th, { color: 'muted' }));
  }

  function drawLight(e: EntityOf<'light'>, layer: DrawingPrimitive[] | null): void {
    if (!layer) return;
    const at: Vec2 = [e.at[0], e.at[1]];
    const reach = PLAN_GLYPHS.light;
    const r = reach * 0.45;
    if (e.kind === 'area') {
      const square: Vec2[] = [
        [at[0] - r, at[1] - r],
        [at[0] + r, at[1] - r],
        [at[0] + r, at[1] + r],
        [at[0] - r, at[1] + r],
      ];
      layer.push(fill([square], 'decor', 0.25));
      layer.push(polyStroke(square, true, PEN.thin));
    } else {
      layer.push(fill([circleRing(at, r)], 'decor', 0.25));
      layer.push(circleStroke(at, r, PEN.thin));
    }
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      layer.push(lineStroke([at[0] + Math.cos(a) * r * 1.35, at[1] + Math.sin(a) * r * 1.35], [at[0] + Math.cos(a) * reach, at[1] + Math.sin(a) * reach], PEN.thin));
    }
    if (e.kind === 'spot' && e.target) layer.push(lineStroke(at, [e.target[0], e.target[1]], PEN.fine));
  }

  function drawConnector(g: ConnectorGeometry, role: ConnectorRole, layer: DrawingPrimitive[]): void {
    // A level it only passes shows it faintly; one that breaks a limit in the warning colour.
    const faint = role === 'crosses';
    const color: DrawingColor | undefined = faint ? 'muted' : g.broken.length ? 'warning' : undefined;
    const lh = h * 0.8;
    const label = (value: string, at: Vec2) => layer.push(text(at, value, lh, { mono: true, ...(color ? { color } : {}) }));
    for (const poly of g.footprint) layer.push(polyStroke(poly, true, PEN.medium, { color }));
    const walkArrow = (segs: readonly Seg[], total: number, way: 'up' | 'down', cut: number | null, extra: string | null) => {
      const end = way === 'up' ? (cut ?? total) : total;
      const walk = walkSegments(segs, 0, end);
      if (!walk.length) return;
      layer.push(stroke(drawingSegments(walk), false, PEN.thin, { color }));
      const head = way === 'up' ? arrowHeadLines(walk[walk.length - 1].b, walkTangent(segs, end), lh * 0.9) : arrowHeadLines(walk[0].a, scale(walkTangent(segs, 0), -1), lh * 0.9);
      for (const [a, b] of head) layer.push(lineStroke(a, b, PEN.thin, { color }));
      const dot = way === 'up' ? walk[0].a : walk[walk.length - 1].b;
      layer.push({ ...fill([circleRing(dot, lh * 0.27)], color ?? 'connector', 1), mark: true });
      const n = perp(walkTangent(segs, way === 'up' ? 0 : total));
      label(way === 'up' ? 'UP' : 'DN', add(dot, scale(n, lh * 1.27)));
      if (extra) label(extra, sub(dot, scale(n, lh * 1.27)));
    };
    switch (g.kind) {
      case 'stair': {
        const cut = role === 'bottom' ? g.cutAlong : null;
        for (const t of g.treads) {
          const above = cut !== null && t.along > cut + 1e-6;
          layer.push(lineStroke(t.a, t.b, PEN.thin, { color, ...(above ? { dash: DASH.aboveCut } : {}) }));
        }
        for (const rail of g.handrails) layer.push(pathStroke(rail, PEN.thin, { color }));
        if (cut !== null) {
          const t = g.treads.find((x) => x.along >= cut - 1e-6);
          const centre = t ? scale(add(t.a, t.b), 0.5) : g.axis[0].a;
          layer.push(polyStroke(breakLinePoints(g.axis, cut, Math.max(1, t ? Math.hypot(t.a[0] - t.b[0], t.a[1] - t.b[1]) : 1000), centre), false, PEN.medium, { color }));
        }
        if (!faint && g.axis.length) walkArrow(g.axis, g.walkLength, role === 'top' ? 'down' : 'up', cut, `${g.risers} R`);
        break;
      }
      case 'ramp': {
        if (faint || !g.axis.length) break;
        walkArrow(g.axis, g.walkLength, role === 'top' ? 'down' : 'up', null, null);
        const mid = walkSegments(g.axis, g.walkLength / 2, g.walkLength / 2 + 1)[0]?.a;
        if (mid) label(`${(Math.round(g.slope * 10) / 10).toFixed(1)} %`, add(mid, scale(perp(walkTangent(g.axis, g.walkLength / 2)), lh * 1.1)));
        break;
      }
      case 'ladder':
        for (const [a, b] of [...g.rails, ...g.rungs]) layer.push(lineStroke(a, b, PEN.thin, { color }));
        break;
      case 'escalator': {
        for (const [a, b] of g.steps) layer.push(lineStroke(a, b, PEN.thin, { color }));
        if (faint) break;
        const dir = scale(sub(g.head, g.foot), 1 / Math.max(1e-9, Math.hypot(g.head[0] - g.foot[0], g.head[1] - g.foot[1])));
        const [from, to] = role === 'top' ? [g.head, g.foot] : [g.foot, g.head];
        const start = add(from, scale(sub(to, from), 0.1));
        const end = add(from, scale(sub(to, from), 0.9));
        layer.push(lineStroke(start, end, PEN.thin, { color }));
        for (const [a, b] of arrowHeadLines(end, role === 'top' ? scale(dir, -1) : dir, lh * 0.9)) layer.push(lineStroke(a, b, PEN.thin, { color }));
        label(role === 'top' ? 'DN' : 'UP', add(start, scale(perp(dir), lh * 1.1)));
        break;
      }
      case 'elevator': {
        layer.push(polyStroke(g.car, true, PEN.thin, { color }));
        layer.push(lineStroke(g.car[0], g.car[2], PEN.thin, { color }));
        layer.push(lineStroke(g.car[1], g.car[3], PEN.thin, { color }));
        const stop = g.stops.find((s) => s.levelId === levelId);
        if (stop && !faint) layer.push(lineStroke(stop.door[0], stop.door[1], PEN.mark, { color }));
        break;
      }
    }
  }
}

// ---------- extent ----------

/** The extent of a drawing segment, arcs by the axis extremes they pass. */
function segmentExtent(box: Box, s: DrawingSegment): Box {
  box = extendBox(extendBox(box, s.a), s.b);
  if (s.k === 'arc') {
    const lo = Math.min(s.start, s.start + s.sweep);
    const hi = Math.max(s.start, s.start + s.sweep);
    for (let k = Math.ceil(lo / (Math.PI / 2)); k * (Math.PI / 2) <= hi; k++) {
      const a = k * (Math.PI / 2);
      box = extendBox(box, [s.center[0] + s.radius * Math.cos(a), s.center[1] + s.radius * Math.sin(a)]);
    }
  }
  return box;
}

/** The corners of a rough box round a text (0.6 of the height per character, one height tall), placed by its alignment and baseline and turned with it. */
export function textCorners(t: DrawingText): Vec2[] {
  const w = t.text.length * t.height * 0.6;
  const x0 = t.align === 'left' ? 0 : t.align === 'right' ? -w : -w / 2;
  const y0 = t.baseline === 'bottom' ? 0 : t.baseline === 'top' ? -t.height : -t.height / 2;
  const along: Vec2 = [Math.cos(t.rotation * DEG), Math.sin(t.rotation * DEG)];
  const up = upOf(t.rotation);
  return [
    [x0, y0],
    [x0 + w, y0],
    [x0 + w, y0 + t.height],
    [x0, y0 + t.height],
  ].map(([x, y]): Vec2 => add(t.at, add(scale(along, x), scale(up, y))));
}

/** The extent of everything in the layers; a text counts a rough box round it, on the side its alignment puts it. */
export function drawingBounds(layers: readonly DrawingLayer[]): Box {
  let box = emptyBox();
  for (const layer of layers) {
    for (const p of layer.primitives) {
      if (p.type === 'stroke') for (const s of p.segs) box = segmentExtent(box, s);
      else if (p.type === 'fill') for (const ring of p.rings) for (const q of ring) box = extendBox(box, q);
      else for (const q of textCorners(p)) box = extendBox(box, q);
    }
  }
  return box;
}

/** How many primitives of each type a drawing holds, per layer kind (for tests and summaries). */
export function drawingCounts(drawing: PlanDrawing): Partial<Record<DrawingLayerKind, { stroke: number; fill: number; text: number }>> {
  const out: Partial<Record<DrawingLayerKind, { stroke: number; fill: number; text: number }>> = {};
  for (const layer of drawing.layers) {
    const c = { stroke: 0, fill: 0, text: 0 };
    for (const p of layer.primitives) c[p.type]++;
    out[layer.kind] = c;
  }
  return out;
}

