import { Component, computed, inject, input } from '@angular/core';
import { defaultConfig, deriveConnector, deriveLevels, type Connector, type DerivedLevel } from '@studio/core';
import { AppState, EmptyState, ProjectDocs, Units } from '@studio/ui';
import { BuildingActions } from './building-actions';

const W = 1000;
const H = 640;
const LABELS = 190;
const BODY_X = 210;
const BODY_W = 430;
const LANES_X = 690;
const LANES_W = 280;

const TYPE_NAMES: Record<string, [string, string]> = {
  wall: ['wall', 'walls'],
  opening: ['opening', 'openings'],
  column: ['column', 'columns'],
  slab: ['slab', 'slabs'],
  void: ['void', 'voids'],
  shaft: ['shaft', 'shafts'],
  room: ['room', 'rooms'],
  separator: ['room divider', 'room dividers'],
  shape: ['shape', 'shapes'],
  fixture: ['fixture', 'fixtures'],
  point: ['service point', 'service points'],
  dimension: ['dimension', 'dimensions'],
  label: ['label', 'labels'],
  item: ['item', 'items'],
  light: ['light', 'lights'],
};

/**
 * A section through the building: every level drawn at its elevation and height, basements below
 * the ground line, mezzanines inset, and the stairs, ramps and elevators between levels. Click a level
 * to make it active. Below it, what the active level holds.
 */
@Component({
  selector: 'x-section-view',
  imports: [EmptyState],
  template: `
    @if (levels().length) {
      <svg [attr.viewBox]="'0 0 ' + width + ' ' + height" preserveAspectRatio="xMidYMid meet" class="w-full flex-1 min-h-0 select-none" role="img" aria-label="Section through the building" data-testid="section-view">
        <!-- ground line -->
        <line [attr.x1]="20" [attr.x2]="width - 20" [attr.y1]="y(datum())" [attr.y2]="y(datum())" class="stroke-muted/60" stroke-width="1.5" stroke-dasharray="8 6" />
        <text [attr.x]="width - 24" [attr.y]="y(datum()) - 8" text-anchor="end" class="fill-muted text-[13px]">Ground {{ units.length(datum()) }}</text>
        @for (level of levels(); track level.id) {
          @let top = y(level.top);
          @let floor = y(level.elevation);
          @let inset = level.placement === 'offset';
          <g class="cursor-pointer" (click)="select(level)" data-testid="section-level" [attr.data-name]="level.name">
            <rect
              [attr.x]="inset ? bodyX + bodyW / 2 : bodyX"
              [attr.y]="top"
              [attr.width]="inset ? bodyW / 2 : bodyW"
              [attr.height]="Math.max(2, floor - top)"
              rx="3"
              [attr.class]="level.id === active() ? 'fill-accent/15 stroke-accent' : level.isBasement ? 'fill-muted/10 stroke-edge' : 'fill-elevated stroke-edge'"
              [attr.stroke-width]="level.id === active() ? 2.5 : 1.5"
              [attr.stroke-dasharray]="inset ? '6 4' : null"
            />
            <!-- slab under the floor -->
            <rect [attr.x]="inset ? bodyX + bodyW / 2 : bodyX" [attr.y]="floor" [attr.width]="inset ? bodyW / 2 : bodyW" [attr.height]="Math.max(2, slab(level))" class="fill-muted/45" />
            <!-- Names start at the left of each level, so a mezzanine drawn in the right half never covers its host's name. -->
            <text [attr.x]="(inset ? bodyX + bodyW / 2 : bodyX) + 18" [attr.y]="(top + floor) / 2 + 5" text-anchor="start" class="fill-fg text-[15px] font-medium">{{ level.name }}</text>
            <text [attr.x]="labelsX - 12" [attr.y]="floor + 5" text-anchor="end" class="text-[13px] font-mono" [attr.class]="level.elevation < 0 ? 'fill-warning text-[13px] font-mono' : 'fill-muted text-[13px] font-mono'">{{ units.length(level.elevation) }}</text>
            <line [attr.x1]="labelsX - 6" [attr.x2]="bodyX" [attr.y1]="floor" [attr.y2]="floor" class="stroke-muted/50" stroke-width="1" />
          </g>
        }
        @for (c of connectors(); track c.id; let i = $index) {
          @let x = lanesX + 24 + i * laneStep();
          <g data-testid="section-connector" [attr.data-kind]="c.kind">
            @if (c.kind === 'elevator') {
              <rect [attr.x]="x - 10" [attr.y]="y(c.top)" [attr.width]="20" [attr.height]="y(c.bottom) - y(c.top)" class="fill-accent/10 stroke-accent/70" stroke-width="1.5" rx="2" />
              @for (stop of c.stops; track stop) {
                <circle [attr.cx]="x" [attr.cy]="y(stop) - 10" r="4" class="fill-accent" />
              }
            } @else if (c.risers) {
              <path [attr.d]="steps(x, c.bottom, c.top, c.risers)" class="stroke-accent fill-none" stroke-width="2" stroke-linejoin="round" data-testid="section-stair-steps" [attr.data-risers]="c.risers" />
            } @else {
              <line [attr.x1]="x - (c.kind === 'ladder' ? 0 : 10)" [attr.x2]="x + (c.kind === 'ladder' ? 0 : 10)" [attr.y1]="y(c.bottom)" [attr.y2]="y(c.top)" class="stroke-accent" stroke-width="3" stroke-linecap="round" />
            }
            <text [attr.x]="x" [attr.y]="y(c.top) - 8" text-anchor="middle" class="fill-muted text-[12px]">{{ c.label }}</text>
          </g>
        }
      </svg>
      <div class="shrink-0 border-t border-edge px-4 py-2.5 text-xs flex items-center gap-3 flex-wrap" data-testid="level-contents">
        <span class="font-medium">{{ activeName() }}</span>
        @if (contents().length) {
          @for (item of contents(); track item.type) {
            <span class="px-1.5 py-0.5 rounded bg-elevated text-muted">{{ item.count }} {{ item.label }}</span>
          }
        } @else {
          <span class="text-muted">Nothing drawn on this level yet.</span>
        }
      </div>
    } @else {
      <x-empty-state title="Loading the building…" />
    }
  `,
  host: { class: 'flex flex-col h-full min-h-0' },
})
export class SectionView {
  private readonly docs = inject(ProjectDocs);
  private readonly actions = inject(BuildingActions);
  private readonly app = inject(AppState);
  protected readonly units = inject(Units);

  readonly projectId = input.required<string>();

  protected readonly Math = Math;
  protected readonly width = W;
  protected readonly height = H;
  protected readonly labelsX = LABELS;
  protected readonly bodyX = BODY_X;
  protected readonly bodyW = BODY_W;
  protected readonly lanesX = LANES_X;
  protected readonly doc = computed(() => this.docs.read(this.projectId())?.doc);
  protected readonly levels = computed(() => {
    const doc = this.doc();
    return doc ? deriveLevels(doc) : [];
  });
  protected readonly active = this.actions.activeLevel(computed(() => this.projectId()), this.doc);
  protected readonly datum = computed(() => this.doc()?.building.datum ?? 0);
  private readonly range = computed(() => {
    const levels = this.levels();
    const lo = Math.min(...levels.map((l) => l.elevation - l.slabThickness), this.datum());
    const hi = Math.max(...levels.map((l) => l.top), this.datum());
    const pad = Math.max(600, (hi - lo) * 0.08);
    return { lo: lo - pad, hi: hi + pad };
  });

  protected readonly connectors = computed(() => {
    const doc = this.doc();
    if (!doc) return [];
    const levels = this.levels();
    const limits = this.app.config()?.rules ?? defaultConfig().rules;
    const at = (id: string, offset = 0) => (levels.find((l) => l.id === id)?.elevation ?? 0) + offset;
    const names: Record<Connector['kind'], string> = { stair: 'Stair', ladder: 'Ladder', ramp: 'Ramp', elevator: 'Elevator', escalator: 'Escalator' };
    return Object.values(doc.connectors).map((c) => {
      if (c.kind === 'elevator') {
        const stops = c.stops.map((s) => at(s.levelId));
        const top = Math.max(...stops) + 2400;
        return { id: c.id, kind: c.kind, label: c.name ?? names[c.kind], bottom: Math.min(...stops), top, stops, risers: 0 };
      }
      const risers = c.kind === 'stair' ? (deriveConnector(c, levels, limits) as { risers: number }).risers : 0;
      return { id: c.id, kind: c.kind, label: c.name ?? names[c.kind], bottom: at(c.bottom.levelId, c.bottom.offset), top: at(c.top.levelId, c.top.offset), stops: [] as number[], risers };
    });
  });
  protected readonly laneStep = computed(() => Math.min(70, (LANES_W - 48) / Math.max(1, this.connectors().length - 1)));

  protected readonly activeName = computed(() => this.doc()?.levels[this.active() ?? '']?.name ?? '');
  protected readonly contents = computed(() => {
    const doc = this.doc();
    const levelId = this.active();
    const counts = new Map<string, number>();
    for (const e of Object.values((doc && levelId && doc.levelData[levelId]?.entities) || {})) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
    return [...counts].map(([type, count]) => ({ type, count, label: (TYPE_NAMES[type] ?? [type, `${type}s`])[count === 1 ? 0 : 1] }));
  });

  /** Elevation (mm) to drawing y. */
  protected y(elevation: number): number {
    const { lo, hi } = this.range();
    return 20 + ((hi - elevation) / (hi - lo)) * (H - 40);
  }

  /** A stair's profile in its lane: its risers as steps from bottom to top, 20 px across. */
  protected steps(x: number, bottom: number, top: number, risers: number): string {
    const y0 = this.y(bottom);
    const rise = (this.y(top) - y0) / risers;
    const run = 20 / risers;
    let d = `M ${x - 10} ${y0}`;
    for (let i = 0; i < risers; i++) d += ` v ${rise} h ${run}`;
    return d;
  }

  protected slab(level: DerivedLevel): number {
    const { lo, hi } = this.range();
    return (level.slabThickness / (hi - lo)) * (H - 40);
  }

  protected select(level: DerivedLevel): void {
    this.actions.setActiveLevel(this.projectId(), level.id);
  }
}
