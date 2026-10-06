import { DEG, angleOf, cornerFrame, cornerFromGrip, distance, fitOpening, formatAngle, insertVertex, joinWalls, junctionNodes, junctionPatches, moveVertex, nearestPoint, parseAngle, pathOfEntity, resolveCoordinate, setCorner, setSegment, sub, transformEntity, wallBody, wallEnds, withPath, type Box, type Coordinate, type Corner, type Entity, type Transform, type Vec2 } from '@studio/core';

type Opening = Extract<Entity, { type: 'opening' }>;
import { tracePolygon } from '../draw';
import { gripAt, gripsOf, type Grip, type VertexRef } from '../grips';
import { drawEntityPreview, drawGrips, drawScreenText, drawSelection, type RenderFrame } from '../render';
import { withAlpha } from '../theme';
import type { Tool, ToolHost, ToolPointer } from './tool';

/** Another wall's end that sits on a dragged vertex and moves with it. */
interface JoinedEnd {
  id: string;
  index: number;
}

type Mode =
  | { k: 'idle' }
  | { k: 'press'; start: Vec2; screen: Vec2; hit: string | null; toggle: boolean; copy: boolean }
  | { k: 'drag'; start: Vec2; ids: string[]; copy: boolean; delta: Vec2; slide?: { wallId: string; along: number } }
  | { k: 'marquee'; start: Vec2; end: Vec2; toggle: boolean }
  | { k: 'rotate'; pivot?: Vec2; reference?: Vec2; cursor?: Vec2; copy: boolean }
  | { k: 'mirror'; a?: Vec2; cursor?: Vec2; copy: boolean }
  | { k: 'grip-press'; id: string; grip: Grip; screen: Vec2; alt: boolean; clicks: number }
  | { k: 'grip-drag'; id: string; grip: Grip; cursor: Vec2; alt: boolean; joined: JoinedEnd[] };

const DRAG_THRESHOLD_PX = 3;
/** Wall ends this close to a dragged vertex move with it. */
const JOIN_TOLERANCE = 1;
const DEFAULT_FILLET = 300;
const DEFAULT_CHAMFER = 200;

/**
 * Selecting and editing: click (Shift toggles), a window or crossing marquee, dragging the selection
 * (Ctrl copies), arrow-key nudges, Delete, Ctrl+A/C/V/D, R to rotate about a pivot (click the
 * pivot, a reference point, then the new direction) and Shift+M to mirror across two points. A
 * single selected entity shows grips: drag a vertex (wall ends that meet it come along; Alt
 * detaches), drag a segment's middle to curve it through the cursor (Alt inserts a vertex instead),
 * double-click it to straighten, click a vertex to edit it (F and C round or chamfer it, Delete
 * removes it), drag a corner's grip to size its fillet or chamfer. Every change is one command;
 * drags preview locally and send it on pointer-up.
 */
export class SelectTool implements Tool {
  readonly id = 'select';
  private mode: Mode = { k: 'idle' };
  private cursor: Vec2 | null = null;

  constructor(private readonly host: ToolHost) {}

  get busy(): boolean {
    return this.mode.k !== 'idle' && this.mode.k !== 'press' && this.mode.k !== 'grip-press';
  }

  // ---------- pointer ----------

  pointerDown(e: ToolPointer): void {
    if (e.button !== 0) return;
    const mode = this.mode;
    if (mode.k === 'rotate') {
      const p = this.snapped(e, mode.pivot);
      if (!mode.pivot) this.mode = { ...mode, pivot: p };
      else if (!mode.reference) this.mode = { ...mode, reference: p };
      else this.commitRotate(mode.pivot, mode.reference, p, mode.copy || e.ctrl);
      this.host.invalidate();
      return;
    }
    if (mode.k === 'mirror') {
      const p = this.snapped(e, mode.a);
      if (!mode.a) this.mode = { ...mode, a: p };
      else this.commitMirror(mode.a, p, mode.copy || e.ctrl);
      this.host.invalidate();
      return;
    }
    const single = this.singleSelected();
    if (single) {
      const grip = gripAt(gripsOf(single, this.host.entities()), e.screen, (p) => this.host.toScreen(p));
      if (grip) {
        this.mode = { k: 'grip-press', id: single.id, grip, screen: e.screen, alt: e.alt, clicks: e.clicks };
        return;
      }
    }
    const hit = this.host.hit(e.world);
    this.mode = { k: 'press', start: e.world, screen: e.screen, hit: hit?.id ?? null, toggle: e.shift, copy: e.ctrl };
    if (hit && !e.shift && !this.host.selection().has(hit.id)) this.host.select([hit.id]);
  }

  pointerMove(e: ToolPointer): void {
    this.cursor = e.world;
    const mode = this.mode;
    if (mode.k === 'press') {
      if (distance(mode.screen, e.screen) < DRAG_THRESHOLD_PX) return;
      if (mode.hit) {
        const ids = [...this.host.selection()];
        if (ids.length) this.mode = { k: 'drag', start: mode.start, ids, copy: mode.copy, delta: sub(e.world, mode.start) };
      } else this.mode = { k: 'marquee', start: mode.start, end: e.world, toggle: mode.toggle };
      this.host.invalidate();
      return;
    }
    if (mode.k === 'grip-press') {
      if (distance(mode.screen, e.screen) < DRAG_THRESHOLD_PX) return;
      if (mode.grip.kind === 'hinge' || mode.grip.kind === 'side') return;
      const joined = mode.grip.kind === 'vertex' && !mode.alt ? this.joinedEnds(mode.id, mode.grip) : [];
      this.mode = { k: 'grip-drag', id: mode.id, grip: mode.grip, cursor: e.world, alt: mode.alt, joined };
      this.host.invalidate();
      return;
    }
    if (mode.k === 'drag') {
      const opening = this.slidingOpening(mode.ids);
      if (opening) this.mode = { ...mode, delta: sub(e.world, mode.start), slide: this.slideTarget(opening, e.world) };
      else this.mode = { ...mode, delta: sub(this.snapped(e, mode.start, new Set(mode.ids)), mode.start) };
      this.host.invalidate();
    } else if (mode.k === 'marquee') {
      this.mode = { ...mode, end: e.world };
      this.host.invalidate();
    } else if (mode.k === 'grip-drag') {
      this.mode = { ...mode, cursor: this.gripSnap(mode, e) };
      this.host.invalidate();
    } else if (mode.k === 'rotate' || mode.k === 'mirror') {
      this.mode = { ...mode, cursor: this.snapped(e, mode.k === 'rotate' ? mode.pivot : mode.a) };
      this.host.invalidate();
    }
  }

  pointerUp(e: ToolPointer): void {
    const mode = this.mode;
    if (mode.k === 'press') {
      if (mode.hit) {
        if (mode.toggle) this.host.select([mode.hit], 'toggle');
        else this.host.select([mode.hit]);
      } else if (!mode.toggle) this.host.select([]);
      this.mode = { k: 'idle' };
      this.host.invalidate();
      return;
    }
    if (mode.k === 'grip-press') {
      this.mode = { k: 'idle' };
      if (mode.grip.kind === 'hinge' || mode.grip.kind === 'side') this.flipSwing(mode.id, mode.grip.kind);
      else if (mode.grip.kind === 'vertex') this.host.selectVertex({ id: mode.id, which: mode.grip.which, index: mode.grip.index });
      else if (mode.clicks >= 2) void this.pathEdit(mode.id, 'plan.path.segment.set', { which: mode.grip.which, index: mode.grip.index, segment: { k: 'line' } });
      this.host.invalidate();
      return;
    }
    if (mode.k === 'grip-drag') {
      this.mode = { k: 'idle' };
      this.commitGrip(mode, this.gripSnap(mode, e));
      this.host.invalidate();
      return;
    }
    if (mode.k === 'drag') {
      const opening = this.slidingOpening(mode.ids);
      this.mode = { k: 'idle' };
      if (opening) {
        const slide = this.slideTarget(opening, e.world);
        if (slide && (slide.along !== opening.along || slide.wallId !== opening.wallId)) void this.host.invoke('plan.entity.update', { id: opening.id, set: { along: slide.along, wallId: slide.wallId }, ...this.stale() });
        this.host.invalidate();
        return;
      }
      const delta = sub(this.snapped(e, mode.start, new Set(mode.ids)), mode.start);
      if (distance(delta, [0, 0]) > 0) void this.transform(mode.ids, { translate: delta }, mode.copy || e.ctrl);
      this.host.invalidate();
      return;
    }
    if (mode.k === 'marquee') {
      const box = boxOf(mode.start, mode.end);
      const ids = this.host.marquee(box, mode.end[0] >= mode.start[0] ? 'window' : 'crossing');
      this.host.select(ids, mode.toggle ? 'add' : 'replace');
      this.mode = { k: 'idle' };
      this.host.invalidate();
    }
  }

  // ---------- keys ----------

  key(e: KeyboardEvent): boolean {
    const ids = [...this.host.selection()];
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    const vertex = this.host.vertex();
    if (ctrl && key === 'a') {
      this.host.select(Object.keys(this.host.entities()));
      return true;
    }
    if (ctrl && key === 'c') {
      if (ids.length) this.copyToClipboard(ids);
      return ids.length > 0;
    }
    if (ctrl && key === 'v') {
      if (this.host.clipboard) void this.paste();
      return Boolean(this.host.clipboard);
    }
    if (ctrl && key === 'd') {
      if (ids.length) {
        const step = this.host.options().nudge;
        void this.transform(ids, { translate: [step, -step] }, true);
      }
      return ids.length > 0;
    }
    if (ctrl) return false;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (vertex) {
        void this.pathEdit(vertex.id, 'plan.path.vertex.remove', { which: vertex.which, index: vertex.index });
        return true;
      }
      if (ids.length) void this.host.invoke('plan.entity.delete', { ids });
      return ids.length > 0;
    }
    if ((key === 'f' || key === 'c') && vertex && !e.shiftKey) {
      this.toggleCorner(vertex, key === 'f' ? 'fillet' : 'chamfer');
      return true;
    }
    if (e.key.startsWith('Arrow') && ids.length) {
      const step = this.host.options().nudge * (e.shiftKey ? 10 : 1);
      const d: Vec2 = e.key === 'ArrowLeft' ? [-step, 0] : e.key === 'ArrowRight' ? [step, 0] : e.key === 'ArrowUp' ? [0, step] : [0, -step];
      void this.host.invoke('plan.transform', { ids, translate: d, nudge: true });
      return true;
    }
    if (key === 'r' && !e.shiftKey && ids.length) {
      this.mode = { k: 'rotate', copy: false };
      this.host.invalidate();
      return true;
    }
    if (key === 'm' && e.shiftKey && ids.length) {
      this.mode = { k: 'mirror', copy: false };
      this.host.invalidate();
      return true;
    }
    return false;
  }

  acceptsTyped(): boolean {
    const mode = this.mode;
    return mode.k === 'drag' || mode.k === 'grip-drag' || (mode.k === 'rotate' && Boolean(mode.pivot && mode.reference)) || (mode.k === 'mirror' && Boolean(mode.a));
  }

  /** While moving: a length runs along the drag, relative and absolute forms as written. While rotating: an angle. While mirroring: the axis's second point. */
  typed(text: string, coord: Coordinate | null, cursor: Vec2 | null): boolean {
    const mode = this.mode;
    if (mode.k === 'rotate' && mode.pivot && mode.reference) {
      const degrees = parseAngle(text);
      if (degrees === null) return false;
      const ids = [...this.host.selection()];
      this.mode = { k: 'idle' };
      if (degrees !== 0 && ids.length) void this.transform(ids, { rotate: { angle: degrees, pivot: mode.pivot } }, mode.copy);
      this.host.invalidate();
      return true;
    }
    if (!coord) return false;
    if (mode.k === 'drag') {
      const direction = cursor ? sub(cursor, mode.start) : undefined;
      const point = resolveCoordinate(coord, { from: mode.start, direction });
      if (!point) return false;
      this.mode = { k: 'idle' };
      const delta = sub(point, mode.start);
      if (distance(delta, [0, 0]) > 0) void this.transform(mode.ids, { translate: delta }, mode.copy);
      this.host.invalidate();
      return true;
    }
    if (mode.k === 'grip-drag' && mode.grip.kind === 'corner') {
      if (coord.k !== 'length' || coord.mm <= 0) return false;
      const entity = this.host.entities()[mode.id];
      const current = entity ? pathOfEntity(entity, mode.grip.which)?.v[mode.grip.index]?.c : undefined;
      this.mode = { k: 'idle' };
      const corner: Corner = current?.k === 'chamfer' ? { k: 'chamfer', d1: coord.mm } : { k: 'fillet', r: coord.mm };
      void this.pathEdit(mode.id, 'plan.path.corner.set', { which: mode.grip.which, index: mode.grip.index, corner });
      this.host.invalidate();
      return true;
    }
    if (mode.k === 'grip-drag') {
      const entity = this.host.entities()[mode.id];
      const path = entity ? pathOfEntity(entity, mode.grip.which) : null;
      const from = mode.grip.kind === 'vertex' ? (path?.v[mode.grip.index - 1]?.p ?? (path?.closed ? path.v[path.v.length - 1]?.p : undefined)) : mode.grip.at;
      const point = resolveCoordinate(coord, { from, direction: from && cursor ? sub(cursor, from) : undefined });
      if (!point) return false;
      this.mode = { k: 'idle' };
      this.commitGrip(mode, point);
      this.host.invalidate();
      return true;
    }
    if (mode.k === 'mirror' && mode.a) {
      const point = resolveCoordinate(coord, { from: mode.a, direction: cursor ? sub(cursor, mode.a) : undefined });
      if (!point) return false;
      this.commitMirror(mode.a, point, mode.copy);
      this.host.invalidate();
      return true;
    }
    return false;
  }

  cancel(): void {
    this.mode = { k: 'idle' };
    this.host.invalidate();
  }

  documentChanged(entities: Record<string, Entity>): void {
    const mode = this.mode;
    if (mode.k === 'drag' && mode.ids.some((id) => !(id in entities))) this.cancel();
    if (mode.k === 'grip-drag' && !(mode.id in entities)) this.cancel();
    const vertex = this.host.vertex();
    if (vertex) {
      const path = entities[vertex.id] ? pathOfEntity(entities[vertex.id], vertex.which) : null;
      if (!path || vertex.index >= path.v.length) this.host.selectVertex(null);
    }
  }

  selectionChanged(): void {
    const vertex = this.host.vertex();
    if (vertex && (this.host.selection().size !== 1 || !this.host.selection().has(vertex.id))) this.host.selectVertex(null);
  }

  excluded(): ReadonlySet<string> {
    const mode = this.mode;
    if (mode.k === 'drag' && !mode.copy && !mode.slide) return new Set(mode.ids);
    if (mode.k === 'grip-drag') return new Set([mode.id, ...mode.joined.map((j) => j.id)]);
    return new Set();
  }

  hint(): string {
    const mode = this.mode;
    if (mode.k === 'drag' && mode.slide) return 'Release to slide the opening here (over another wall: move it there)';
    if (mode.k === 'drag') return mode.copy ? 'Release to copy here' : 'Release to move here · Ctrl: copy';
    if (mode.k === 'marquee') return mode.end[0] >= mode.start[0] ? 'Window: what lies fully inside' : 'Crossing: what the box touches';
    if (mode.k === 'rotate') return !mode.pivot ? 'Rotate: click the pivot' : !mode.reference ? 'Click a reference point' : 'Click the new direction · Ctrl: keep a copy';
    if (mode.k === 'mirror') return !mode.a ? 'Mirror: click the first point of the axis' : 'Click the second point · Ctrl: keep a copy';
    if (mode.k === 'grip-drag' && mode.grip.kind === 'corner') return 'Release to size the corner (or type the radius or distance) · onto the vertex: sharp';
    if (mode.k === 'grip-drag') return mode.grip.kind === 'vertex' ? (mode.joined.length ? `Release to move the corner (${mode.joined.length} joined end${mode.joined.length === 1 ? '' : 's'} follow) · Alt: detach` : 'Release to move the corner') : mode.alt ? 'Release to add a corner here' : 'Release to curve the segment through here · Alt: add a corner instead';
    if (this.host.vertex()) return 'Corner selected · drag to move · F: round · C: chamfer · Delete: remove · Escape: back';
    const n = this.host.selection().size;
    if (n === 1) return '1 selected · drag to move (Ctrl: copy) · drag a grip to reshape · click a corner to edit it (F: round · C: chamfer) · R: rotate · Shift+M: mirror · Delete';
    if (n) return `${n} selected · drag to move (Ctrl: copy) · arrows: nudge · R: rotate · Shift+M: mirror · Delete`;
    return 'Click to select · Shift: add · drag: window (→) or crossing (←) · W: draw walls';
  }

  // ---------- drawing ----------

  draw(ctx: CanvasRenderingContext2D, frame: RenderFrame): void {
    const mode = this.mode;
    const preview = this.previewEntities();
    const selection = this.host.selection();
    if (preview) this.drawPreview(ctx, frame, preview.entities, preview.copy);
    else {
      drawSelection(ctx, frame, selection);
      const single = this.singleSelected();
      if (single) {
        const vertex = this.host.vertex();
        drawGrips(ctx, frame, gripsOf(single, this.host.entities()), vertex && vertex.id === single.id ? vertex : null);
      }
    }
    if (mode.k === 'marquee') {
      const box = boxOf(mode.start, mode.end);
      ctx.strokeStyle = frame.theme.selection;
      ctx.fillStyle = withAlpha(frame.theme.selection, 0.08);
      ctx.lineWidth = 1 / frame.camera.scale;
      if (mode.end[0] < mode.start[0]) ctx.setLineDash([6 / frame.camera.scale, 4 / frame.camera.scale]);
      ctx.beginPath();
      ctx.rect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (mode.k === 'rotate' && mode.pivot) {
      const r = 6 / frame.camera.scale;
      ctx.strokeStyle = frame.theme.snap;
      ctx.lineWidth = 1 / frame.camera.scale;
      ctx.beginPath();
      ctx.arc(mode.pivot[0], mode.pivot[1], r, 0, Math.PI * 2);
      ctx.stroke();
      const to = mode.cursor;
      if (to) {
        ctx.setLineDash([4 / frame.camera.scale, 4 / frame.camera.scale]);
        ctx.beginPath();
        ctx.moveTo(mode.pivot[0], mode.pivot[1]);
        if (mode.reference) ctx.lineTo(mode.reference[0], mode.reference[1]);
        ctx.moveTo(mode.pivot[0], mode.pivot[1]);
        ctx.lineTo(to[0], to[1]);
        ctx.stroke();
        ctx.setLineDash([]);
        if (mode.reference) drawScreenText(ctx, frame, { text: formatAngle(this.rotationAngle(mode.pivot, mode.reference, to), { precision: 1 }), at: to, screenPx: 11, color: frame.theme.snap, align: 'left', baseline: 'bottom', dx: 8, dy: -8, mono: true });
      }
    }
    if (mode.k === 'mirror' && mode.a) {
      const b = mode.cursor ?? mode.a;
      ctx.strokeStyle = frame.theme.snap;
      ctx.lineWidth = 1 / frame.camera.scale;
      ctx.setLineDash([8 / frame.camera.scale, 4 / frame.camera.scale]);
      ctx.beginPath();
      ctx.moveTo(mode.a[0], mode.a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  /** The entities as the current gesture would leave them, for the preview. */
  private previewEntities(): { entities: Entity[]; copy: boolean } | null {
    const mode = this.mode;
    const entities = this.host.entities();
    let xf: Transform | null = null;
    let copy = false;
    if (mode.k === 'drag' && mode.slide) {
      const opening = this.slidingOpening(mode.ids);
      return opening ? { entities: [{ ...opening, wallId: mode.slide.wallId, along: mode.slide.along }], copy: false } : null;
    }
    if (mode.k === 'drag') {
      xf = { translate: mode.delta };
      copy = mode.copy;
    } else if (mode.k === 'rotate' && mode.pivot && mode.reference && mode.cursor) {
      xf = { rotate: { angle: this.rotationAngle(mode.pivot, mode.reference, mode.cursor), pivot: mode.pivot } };
      copy = mode.copy;
    } else if (mode.k === 'mirror' && mode.a && mode.cursor && distance(mode.a, mode.cursor) > 1e-6) {
      xf = { mirror: { a: mode.a, b: mode.cursor } };
      copy = mode.copy;
    }
    if (xf) {
      const moved: Entity[] = [];
      for (const id of this.host.selection()) {
        const e = entities[id];
        if (e && e.type !== 'opening') moved.push(transformEntity(e, xf));
      }
      return { entities: moved, copy };
    }
    if (mode.k === 'grip-drag') return { entities: this.gripResult(mode, mode.cursor), copy: false };
    return null;
  }

  /** The entities a grip drag ending at `to` produces: the edited one, and the walls whose ends follow. */
  private gripResult(mode: Extract<Mode, { k: 'grip-drag' }>, to: Vec2): Entity[] {
    const entities = this.host.entities();
    const entity = entities[mode.id];
    if (!entity) return [];
    const path = pathOfEntity(entity, mode.grip.which);
    if (!path) return [];
    const out: Entity[] = [];
    try {
      if (mode.grip.kind === 'vertex') {
        out.push(withPath(entity, mode.grip.which, moveVertex(path, mode.grip.index, to)));
        for (const j of mode.joined) {
          const other = entities[j.id];
          if (other?.type === 'wall') out.push(withPath(other, 'outer', moveVertex(other.path, j.index, to)));
        }
      } else if (mode.grip.kind === 'corner') {
        const corner = this.cornerAt(path, mode.grip.index, to);
        if (corner !== undefined) out.push(withPath(entity, mode.grip.which, setCorner(path, mode.grip.index, corner)));
        else out.push(entity);
      } else if (mode.alt) out.push(withPath(entity, mode.grip.which, insertVertex(path, mode.grip.index, to)));
      else out.push(withPath(entity, mode.grip.which, setSegment(path, mode.grip.index, { k: 'arc', through: to })));
    } catch {
      return [entity];
    }
    return out;
  }

  /** The transformed selection drawn over the plan: walls joined with the rest, other entities as they would be. */
  private drawPreview(ctx: CanvasRenderingContext2D, frame: RenderFrame, moved: Entity[], copy: boolean): void {
    const entities = this.host.entities();
    const movedIds = new Set(moved.map((e) => e.id));
    const walls = moved.filter((e): e is Extract<Entity, { type: 'wall' }> => e.type === 'wall');
    if (walls.length) {
      // Join the moving walls with the others: their bodies, plus the corner fills at the junctions they take part in.
      const still = Object.values(entities).filter((e): e is Extract<Entity, { type: 'wall' }> => e.type === 'wall' && (copy || !movedIds.has(e.id)));
      const all = [...still, ...walls];
      const nodes = junctionNodes(wallEnds(all)).filter((node) => node.some((end) => movedIds.has(end.id)));
      const patches = junctionPatches(nodes, new Map(all.map((w) => [w.id, w])));
      const bodies = walls.map((w) => wallBody(w).polygons);
      const base = copy ? (frame.walls?.joined ?? []) : (this.host.walls(movedIds)?.joined ?? []);
      const joined = joinWalls([base, ...bodies], patches);
      ctx.fillStyle = withAlpha(frame.theme.wall, 0.7);
      ctx.strokeStyle = frame.theme.wallLine;
      ctx.lineWidth = 1.5 / frame.camera.scale;
      ctx.beginPath();
      for (const poly of joined) tracePolygon(ctx, poly);
      ctx.fill('nonzero');
      ctx.stroke();
    }
    ctx.globalAlpha = 0.8;
    for (const e of moved) if (e.type !== 'wall') drawEntityPreview(ctx, e, frame);
    ctx.globalAlpha = 1;
  }

  /** The cursor snapped (Alt suspends it); `from` enables perpendicular and angle snaps, Shift forces 45° steps from it. */
  private snapped(e: ToolPointer, from?: Vec2, exclude?: ReadonlySet<string>): Vec2 {
    if (e.alt) return e.world;
    return this.host.snap(e.world, { from, exclude, ortho: e.shift && Boolean(from) })?.point ?? e.world;
  }

  /** A dragged vertex snaps to everything but its own entity and the walls that follow it; the vertex before it gives the direction. */
  private gripSnap(mode: Extract<Mode, { k: 'grip-drag' }>, e: ToolPointer): Vec2 {
    if (e.alt || mode.grip.kind === 'corner') return e.world;
    const exclude = new Set([mode.id, ...mode.joined.map((j) => j.id)]);
    let from: Vec2 | undefined;
    if (mode.grip.kind === 'vertex') {
      const entity = this.host.entities()[mode.id];
      const path = entity ? pathOfEntity(entity, mode.grip.which) : null;
      const prev = path?.v[mode.grip.index - 1] ?? (path?.closed ? path.v[path.v.length - 1] : undefined);
      from = prev?.p;
    }
    return this.host.snap(e.world, { from, exclude, ortho: e.shift && Boolean(from) })?.point ?? e.world;
  }

  private rotationAngle(pivot: Vec2, reference: Vec2, to: Vec2): number {
    const a = angleOf(sub(reference, pivot));
    const b = angleOf(sub(to, pivot));
    let deg = (b - a) / DEG;
    while (deg > 180) deg -= 360;
    while (deg <= -180) deg += 360;
    return Math.round(deg * 1000) / 1000;
  }

  /** The one opening being dragged, if the selection is exactly that. */
  private slidingOpening(ids: string[]): Opening | null {
    if (ids.length !== 1) return null;
    const e = this.host.entities()[ids[0]];
    return e?.type === 'opening' ? e : null;
  }

  /** Where a dragged opening goes: the cursor projected on the wall under it (or its own), moved into the nearest free gap. */
  private slideTarget(opening: Opening, cursor: Vec2): { wallId: string; along: number } | undefined {
    const entities = this.host.entities();
    const hit = this.host.hit(cursor);
    let wall = hit ? entities[hit.id] : undefined;
    if (wall?.type === 'opening') wall = entities[wall.wallId];
    if (!wall || wall.type !== 'wall') wall = entities[opening.wallId];
    if (!wall || wall.type !== 'wall') return undefined;
    const others = Object.values(entities).filter((e): e is Opening => e.type === 'opening' && e.wallId === wall!.id && e.id !== opening.id);
    const fit = fitOpening(wall, others, nearestPoint(wall.path, cursor).along, opening.width);
    if (Number.isNaN(fit.along)) return undefined;
    return { wallId: wall.id, along: fit.along };
  }

  private flipSwing(id: string, which: 'hinge' | 'side'): void {
    const e = this.host.entities()[id];
    if (e?.type !== 'opening') return;
    const swing = { hinge: e.swing?.hinge ?? 'start', side: e.swing?.side ?? 'left' };
    if (which === 'hinge') swing.hinge = swing.hinge === 'start' ? 'end' : 'start';
    else swing.side = swing.side === 'left' ? 'right' : 'left';
    void this.host.invoke('plan.entity.update', { id, set: { swing }, ...this.stale() });
  }

  private singleSelected(): Entity | null {
    const selection = this.host.selection();
    if (selection.size !== 1) return null;
    return this.host.entities()[[...selection][0]] ?? null;
  }

  /** The ends of other open walls that sit on this vertex. */
  private joinedEnds(id: string, grip: Grip): JoinedEnd[] {
    const entities = this.host.entities();
    const entity = entities[id];
    if (!entity || entity.type !== 'wall' || grip.which !== 'outer') return [];
    const out: JoinedEnd[] = [];
    for (const other of Object.values(entities)) {
      if (other.id === id || other.type !== 'wall' || other.path.closed) continue;
      for (const index of [0, other.path.v.length - 1]) if (distance(other.path.v[index].p, grip.at) <= JOIN_TOLERANCE) out.push({ id: other.id, index });
    }
    return out;
  }

  // ---------- commands ----------

  private stale() {
    return { baseSeq: this.host.seq(), epoch: this.host.epoch() };
  }

  private pathEdit(id: string, command: string, input: Record<string, unknown>): Promise<unknown> {
    return this.host.invoke(command, { id, ...input, ...this.stale() });
  }

  private commitGrip(mode: Extract<Mode, { k: 'grip-drag' }>, to: Vec2): void {
    const { grip, id } = mode;
    if (grip.kind === 'vertex') {
      if (!mode.joined.length) {
        void this.pathEdit(id, 'plan.path.vertex.move', { which: grip.which, index: grip.index, to });
        return;
      }
      const steps = [{ id, which: grip.which, index: grip.index }, ...mode.joined.map((j) => ({ id: j.id, which: 'outer' as const, index: j.index }))].map((s) => ({ command: 'plan.path.vertex.move', input: { ...s, to, ...this.stale() } }));
      void this.host.invoke('plan.apply', { label: 'Move corner', steps });
      return;
    }
    if (grip.kind === 'corner') {
      const entity = this.host.entities()[id];
      const path = entity ? pathOfEntity(entity, grip.which) : null;
      const corner = path ? this.cornerAt(path, grip.index, to) : undefined;
      if (corner !== undefined) void this.pathEdit(id, 'plan.path.corner.set', { which: grip.which, index: grip.index, corner });
      return;
    }
    if (mode.alt) void this.pathEdit(id, 'plan.path.vertex.insert', { which: grip.which, index: grip.index, at: to });
    else void this.pathEdit(id, 'plan.path.segment.set', { which: grip.which, index: grip.index, segment: { k: 'arc', through: to } });
  }

  /** The corner a grip dragged to `to` means (null: sharp); undefined when the vertex has no sizeable corner. */
  private cornerAt(path: ReturnType<typeof pathOfEntity> & object, index: number, to: Vec2): Corner | null | undefined {
    const current = path.v[index]?.c;
    const frame = cornerFrame(path, index);
    if (!current || !frame) return undefined;
    return cornerFromGrip(frame, current, to);
  }

  private toggleCorner(vertex: VertexRef, kind: 'fillet' | 'chamfer'): void {
    const entity = this.host.entities()[vertex.id];
    const path = entity ? pathOfEntity(entity, vertex.which) : null;
    const current = path?.v[vertex.index]?.c;
    const corner = current?.k === kind ? null : kind === 'fillet' ? { k: 'fillet', r: DEFAULT_FILLET } : { k: 'chamfer', d1: DEFAULT_CHAMFER };
    void this.pathEdit(vertex.id, 'plan.path.corner.set', { which: vertex.which, index: vertex.index, corner });
  }

  private transform(ids: string[], xf: Transform, copy: boolean): Promise<unknown> {
    return this.host.invoke('plan.transform', { ids, ...xf, copy }).then((result) => {
      const r = result as { ids?: string[] } | undefined;
      if (copy && r?.ids?.length) this.host.select(r.ids);
    });
  }

  private commitRotate(pivot: Vec2, reference: Vec2, to: Vec2, copy: boolean): void {
    const angle = this.rotationAngle(pivot, reference, to);
    const ids = [...this.host.selection()];
    this.mode = { k: 'idle' };
    if (angle !== 0 && ids.length) void this.transform(ids, { rotate: { angle, pivot } }, copy);
  }

  private commitMirror(a: Vec2, b: Vec2, copy: boolean): void {
    const ids = [...this.host.selection()];
    this.mode = { k: 'idle' };
    if (distance(a, b) > 1e-6 && ids.length) void this.transform(ids, { mirror: { a, b } }, copy);
  }

  private copyToClipboard(ids: string[]): void {
    const entities = this.host.entities();
    const list = ids.map((id) => entities[id]).filter((e): e is Entity => Boolean(e));
    // A wall's openings come along; an opening without its wall cannot be pasted.
    const set = new Map(list.map((e) => [e.id, e]));
    for (const e of list) if (e.type === 'wall') for (const o of Object.values(entities)) if (o.type === 'opening' && o.wallId === e.id) set.set(o.id, o);
    const copied = [...set.values()].filter((e) => e.type !== 'opening' || set.has(e.wallId));
    const box = copied.reduce<Box>((b, e) => extendByEntity(b, e), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    const anchor: Vec2 = Number.isFinite(box.minX) ? [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2] : [0, 0];
    this.host.clipboard = { entities: structuredClone(copied), anchor };
  }

  /** Pastes at the cursor (or where it was copied) as one batch: walls first, so openings can name them. */
  private paste(): Promise<unknown> {
    const clip = this.host.clipboard!;
    const levelId = this.host.levelId();
    if (!levelId) return Promise.resolve();
    const at = this.cursor ?? clip.anchor;
    const delta: Vec2 = [at[0] - clip.anchor[0], at[1] - clip.anchor[1]];
    const names = new Map<string, string>();
    const steps: { command: string; input: unknown; as?: string }[] = [];
    const ordered = [...clip.entities.filter((e) => e.type !== 'opening'), ...clip.entities.filter((e) => e.type === 'opening')];
    ordered.forEach((e, i) => {
      const moved = transformEntity(e, { translate: delta }) as Entity & Record<string, unknown>;
      const { id: _id, levelId: _lv, layerId: _layer, ...fields } = moved;
      const entity: Record<string, unknown> = { ...fields };
      if (e.type === 'opening') {
        const name = names.get(e.wallId);
        if (!name) return;
        entity['wallId'] = `$${name}`;
      }
      const as = e.type === 'wall' ? `w${i}` : undefined;
      if (as) names.set(e.id, as);
      steps.push({ command: 'plan.entity.add', input: { levelId, entity }, ...(as ? { as } : {}) });
    });
    if (!steps.length) return Promise.resolve();
    return this.host.invoke('plan.apply', { label: steps.length === 1 ? `Paste ${ordered[0].type}` : `Paste ${steps.length} items`, steps }).then((result) => {
      const r = result as { results?: { result?: { id?: string } }[] } | undefined;
      const ids = r?.results?.map((s) => s.result?.id).filter((id): id is string => Boolean(id)) ?? [];
      if (ids.length) this.host.select(ids);
    });
  }
}

const boxOf = (a: Vec2, b: Vec2): Box => ({ minX: Math.min(a[0], b[0]), minY: Math.min(a[1], b[1]), maxX: Math.max(a[0], b[0]), maxY: Math.max(a[1], b[1]) });

function extendByEntity(box: Box, e: Entity): Box {
  const points: Vec2[] = [];
  if (e.type === 'wall' || e.type === 'separator' || e.type === 'shape') points.push(...e.path.v.map((v) => v.p));
  else if (e.type === 'dimension') points.push(e.from, e.to);
  else if ('at' in e) points.push([e.at[0], e.at[1]]);
  else if (e.type === 'room') points.push(...(e.boundary.k === 'detect' ? [e.boundary.seed] : e.boundary.region.outer.v.map((v) => v.p)));
  else if (e.type === 'slab') points.push(...(e.source.k === 'region' ? e.source.region.outer.v.map((v) => v.p) : []));
  else if (e.type === 'void' || e.type === 'shaft') points.push(...e.region.outer.v.map((v) => v.p));
  return points.reduce((b, p) => ({ minX: Math.min(b.minX, p[0]), minY: Math.min(b.minY, p[1]), maxX: Math.max(b.maxX, p[0]), maxY: Math.max(b.maxY, p[1]) }), box);
}
