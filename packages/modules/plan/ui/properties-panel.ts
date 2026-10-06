import { Component, computed, inject, input, linkedSignal, untracked } from '@angular/core';
import { FormField, form } from '@angular/forms/signals';
import { arcGeometry, bulgeOf, distance, findEntity, pathLength, pathOfEntity, type Entity, type Path, type Vec2 } from '@studio/core';
import { AngleInput, EmptyState, HostBridge, Input, LengthInput, ProjectDocs, Select, Toasts, Units } from '@studio/ui';
import { PlanSelection } from './plan-selection';

type Wall = Extract<Entity, { type: 'wall' }>;
type Opening = Extract<Entity, { type: 'opening' }>;

const TYPE_NAMES: Record<Entity['type'], string> = { wall: 'Wall', opening: 'Opening', column: 'Column', slab: 'Slab', void: 'Void', shaft: 'Shaft', room: 'Room', fixture: 'Fixture', point: 'Service point', dimension: 'Dimension', label: 'Label', item: 'Item', light: 'Light' };

interface Draft {
  name: string;
  thickness: string;
  height: string;
  alignment: string;
  kind: string;
  width: string;
  sill: string;
  along: string;
  hinge: string;
  side: string;
  number: string;
  text: string;
  size: string;
  rotation: string;
  w: string;
  d: string;
  r: string;
  offset: string;
}

interface VertexDraft {
  x: string;
  y: string;
  segment: 'line' | 'arc';
  radius: string;
  direction: 'ccw' | 'cw';
  corner: 'sharp' | 'fillet' | 'chamfer';
  cornerRadius: string;
  d1: string;
  d2: string;
}

/**
 * The Properties panel: the selected entity's fields (lengths in display units, typed in any unit),
 * the common fields of a multi-selection, and the selected corner of a path (position, segment,
 * corner). Every change is one command carrying the change number the panel saw, so an edit on
 * stale data is refused instead of landing on moved geometry.
 */
@Component({
  selector: 'x-properties-panel',
  imports: [AngleInput, EmptyState, FormField, Input, LengthInput, Select],
  templateUrl: './properties-panel.html',
  host: { class: 'flex flex-col', 'data-testid': 'properties-panel' },
})
export class PropertiesPanel {
  private readonly docs = inject(ProjectDocs);
  private readonly host = inject(HostBridge);
  private readonly toasts = inject(Toasts);
  private readonly selection = inject(PlanSelection);
  protected readonly units = inject(Units);

  readonly projectId = input.required<string>();

  protected readonly names = TYPE_NAMES;
  private readonly state = computed(() => this.docs.read(this.projectId()));
  private readonly selected = computed(() => this.selection.of(this.projectId())());
  protected readonly entities = computed(() => {
    const doc = this.state()?.doc;
    if (!doc) return [];
    return this.selected().ids.map((id) => findEntity(doc, id)).filter((e): e is Entity => Boolean(e));
  });
  protected readonly entity = computed(() => (this.entities().length === 1 ? this.entities()[0] : null));
  protected readonly sameType = computed(() => {
    const list = this.entities();
    return list.length > 1 && list.every((e) => e.type === list[0].type) ? list[0].type : null;
  });
  protected readonly summary = computed(() => {
    const counts = new Map<string, number>();
    for (const e of this.entities()) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
    return [...counts].map(([type, n]) => `${n} ${TYPE_NAMES[type as Entity['type']].toLowerCase()}${n === 1 ? '' : 's'}`).join(', ');
  });
  /** The first entity, which the form shows; a multi-selection of one type edits them all. */
  protected readonly subject = computed(() => this.entity() ?? (this.sameType() ? this.entities()[0] : null));
  protected readonly wallLength = computed(() => {
    const e = this.subject();
    return e?.type === 'wall' ? this.units.length(pathLength(e.path)) : '';
  });

  protected readonly draft = linkedSignal<Entity | null, Draft>({
    source: this.subject,
    computation: (e) => {
      const len = (mm: number | null | undefined) => (mm === null || mm === undefined ? '' : this.units.length(mm));
      const base: Draft = { name: e?.name ?? '', thickness: '', height: '', alignment: 'center', kind: 'door', width: '', sill: '', along: '', hinge: 'start', side: 'left', number: '', text: '', size: '', rotation: '', w: '', d: '', r: '', offset: '' };
      if (!e) return base;
      switch (e.type) {
        case 'wall':
          return { ...base, thickness: len(e.thickness), height: len(e.height), alignment: e.alignment };
        case 'opening':
          return { ...base, kind: e.kind, width: len(e.width), height: len(e.height), sill: len(e.sill), along: len(e.along), hinge: e.swing?.hinge ?? 'start', side: e.swing?.side ?? 'left' };
        case 'room':
          return { ...base, name: e.name, number: e.number ?? '' };
        case 'label':
          return { ...base, text: e.text, size: len(e.size), rotation: this.units.angle(e.rotation) };
        case 'column':
          return { ...base, rotation: this.units.angle(e.rotation), w: e.shape.k === 'rect' ? len(e.shape.w) : '', d: e.shape.k === 'rect' ? len(e.shape.d) : '', r: e.shape.k === 'circle' ? len(e.shape.r) : '' };
        case 'slab':
          return { ...base, thickness: len(e.thickness) };
        case 'dimension':
          return { ...base, offset: len(e.offset) };
        case 'fixture':
        case 'point':
          return { ...base, rotation: this.units.angle(e.rotation) };
        default:
          return base;
      }
    },
  });
  protected readonly f = form(this.draft);

  // ---------- the selected corner ----------

  protected readonly vertexRef = computed(() => this.selected().vertex);
  protected readonly vertexPath = computed((): Path | null => {
    const v = this.vertexRef();
    const e = this.entity();
    return v && e && e.id === v.id ? pathOfEntity(e, v.which) : null;
  });
  protected readonly vertexDraft = linkedSignal<{ path: Path | null; index: number }, VertexDraft>({
    source: computed(() => ({ path: this.vertexPath(), index: this.vertexRef()?.index ?? -1 })),
    computation: ({ path, index }) => {
      const base: VertexDraft = { x: '', y: '', segment: 'line', radius: '', direction: 'ccw', corner: 'sharp', cornerRadius: '', d1: '', d2: '' };
      const v = path?.v[index];
      if (!path || !v) return base;
      const out = { ...base, x: this.units.length(v.p[0]), y: this.units.length(v.p[1]) };
      const next = path.v[(index + 1) % path.v.length];
      if (v.s?.k === 'arc' && next && (path.closed || index < path.v.length - 1)) {
        const g = arcGeometry(v.p, next.p, v.s.bulge);
        out.segment = 'arc';
        out.radius = this.units.length(g.radius);
        out.direction = v.s.bulge > 0 ? 'ccw' : 'cw';
      }
      if (v.c?.k === 'fillet') {
        out.corner = 'fillet';
        out.cornerRadius = this.units.length(v.c.r);
      } else if (v.c?.k === 'chamfer') {
        out.corner = 'chamfer';
        out.d1 = this.units.length(v.c.d1);
        out.d2 = this.units.length(v.c.d2 ?? v.c.d1);
      }
      return out;
    },
  });
  protected readonly vf = form(this.vertexDraft);
  protected readonly vertexHasSegment = computed(() => {
    const path = this.vertexPath();
    const index = this.vertexRef()?.index ?? -1;
    return Boolean(path && (path.closed || index < path.v.length - 1));
  });
  protected readonly vertexHasCorner = computed(() => {
    const path = this.vertexPath();
    const index = this.vertexRef()?.index ?? -1;
    return Boolean(path && (path.closed || (index > 0 && index < path.v.length - 1)));
  });

  // ---------- commands ----------

  private stale() {
    const s = untracked(this.state);
    return s ? { baseSeq: s.seq, epoch: s.epoch } : {};
  }

  private async run(id: string, input: unknown): Promise<unknown> {
    try {
      return await this.host.invoke(id, input, untracked(this.projectId));
    } catch (err) {
      this.toasts.error(err);
      return undefined;
    }
  }

  /** Sets fields on the subject, or on every entity of a same-type selection, as one change. */
  protected set(set: Record<string, unknown>, unset: string[] = []): void {
    const list = untracked(this.entities);
    if (!list.length) return;
    if (list.length === 1) void this.run('plan.entity.update', { id: list[0].id, set, unset, ...this.stale() });
    else void this.run('plan.apply', { label: `Change ${list.length} ${TYPE_NAMES[list[0].type].toLowerCase()}s`, steps: list.map((e) => ({ command: 'plan.entity.update', input: { id: e.id, set, unset, ...this.stale() } })) });
  }

  protected setLength(field: string, mm: number | null): void {
    if (mm === null) this.set({}, [field]);
    else this.set({ [field]: mm });
  }

  protected setNullable(field: string, mm: number | null): void {
    this.set({ [field]: mm });
  }

  protected setName(): void {
    const name = untracked(this.draft).name.trim();
    const e = untracked(this.subject);
    if (!e) return;
    if (e.type === 'room') {
      if (name && name !== e.name) this.set({ name });
      return;
    }
    if (name === (e.name ?? '')) return;
    if (name) this.set({ name });
    else this.set({}, ['name']);
  }

  protected setText(field: 'text' | 'number'): void {
    const value = untracked(this.draft)[field].trim();
    const e = untracked(this.subject);
    if (!e) return;
    const current = (e as Record<string, unknown>)[field] ?? '';
    if (value === current) return;
    if (value) this.set({ [field]: value });
    else if (field === 'number') this.set({}, ['number']);
  }

  protected setSwing(part: 'hinge' | 'side', value: string): void {
    const e = untracked(this.subject) as Opening | null;
    if (!e) return;
    this.set({ swing: { hinge: e.swing?.hinge ?? 'start', side: e.swing?.side ?? 'left', [part]: value } });
  }

  protected setColumnSize(field: 'w' | 'd' | 'r', mm: number | null): void {
    const e = untracked(this.subject);
    if (!e || e.type !== 'column' || mm === null) return;
    if (e.shape.k === 'rect' && field !== 'r') this.set({ shape: { ...e.shape, [field]: mm } });
    if (e.shape.k === 'circle' && field === 'r') this.set({ shape: { k: 'circle', r: mm } });
  }

  // ---------- the corner ----------

  private pathEdit(command: string, input: Record<string, unknown>): void {
    const v = untracked(this.vertexRef);
    if (!v) return;
    void this.run(command, { id: v.id, which: v.which, index: v.index, ...input, ...this.stale() });
  }

  protected moveVertex(axis: 0 | 1, mm: number | null): void {
    const path = untracked(this.vertexPath);
    const v = untracked(this.vertexRef);
    if (!path || !v || mm === null) return;
    const p = path.v[v.index].p;
    const to: Vec2 = axis === 0 ? [mm, p[1]] : [p[0], mm];
    this.pathEdit('plan.path.vertex.move', { to });
  }

  protected setSegment(): void {
    const d = untracked(this.vertexDraft);
    if (d.segment === 'line') {
      this.pathEdit('plan.path.segment.set', { segment: { k: 'line' } });
      return;
    }
    this.setArc(this.units.parseLength(d.radius), d.direction);
  }

  protected setArcRadius(mm: number | null): void {
    this.setArc(mm, untracked(this.vertexDraft).direction);
  }

  /** An arc of the given radius between the vertex and the next one (the minor arc); null keeps a quarter turn. */
  private setArc(radius: number | null, direction: 'ccw' | 'cw'): void {
    const path = untracked(this.vertexPath);
    const v = untracked(this.vertexRef);
    if (!path || !v) return;
    const a = path.v[v.index].p;
    const b = path.v[(v.index + 1) % path.v.length].p;
    const chord = distance(a, b);
    const r = radius && radius > 0 ? Math.max(radius, chord / 2) : chord / Math.SQRT2;
    const sweep = 2 * Math.asin(Math.min(1, chord / (2 * r)));
    const bulge = bulgeOf(sweep) * (direction === 'cw' ? -1 : 1);
    this.pathEdit('plan.path.segment.set', { segment: { k: 'arc', bulge } });
  }

  protected setCornerKind(kind: string): void {
    if (kind === 'sharp') this.pathEdit('plan.path.corner.set', { corner: null });
    else if (kind === 'fillet') this.pathEdit('plan.path.corner.set', { corner: { k: 'fillet', r: this.units.parseLength(untracked(this.vertexDraft).cornerRadius) || 300 } });
    else {
      const d = untracked(this.vertexDraft);
      this.pathEdit('plan.path.corner.set', { corner: { k: 'chamfer', d1: this.units.parseLength(d.d1) || 200, d2: this.units.parseLength(d.d2) || this.units.parseLength(d.d1) || 200 } });
    }
  }

  protected setCornerSize(field: 'cornerRadius' | 'd1' | 'd2', mm: number | null): void {
    if (mm === null || mm <= 0) return;
    const d = untracked(this.vertexDraft);
    if (field === 'cornerRadius') this.pathEdit('plan.path.corner.set', { corner: { k: 'fillet', r: mm } });
    else {
      const d1 = field === 'd1' ? mm : (this.units.parseLength(d.d1) ?? mm);
      const d2 = field === 'd2' ? mm : (this.units.parseLength(d.d2) ?? d1);
      this.pathEdit('plan.path.corner.set', { corner: { k: 'chamfer', d1, d2 } });
    }
  }

  protected typeName(e: Entity): string {
    return TYPE_NAMES[e.type];
  }

  protected asWall(e: Entity): Wall {
    return e as Wall;
  }
}
