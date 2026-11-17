import { Component, computed, inject, input, linkedSignal, untracked } from '@angular/core';
import { FormField, form } from '@angular/forms/signals';
import { DEFAULT_RULE_LIMITS, deriveConnector, deriveLevels, toLatinDigits, type Connector } from '@studio/core';
import { AngleInput, AppState, Checkbox, HostBridge, I18n, Input, LengthInput, ProjectDocs, Select, Toasts, Units } from '@studio/ui';

/** The stair shapes, in the select's order; each is named by `plan.connector.<shape>`. */
const SHAPES = ['straight', 'l', 'u', 'winder', 'curved', 'spiral'] as const;
/** What keeps a length (`650 mm`) and a range (`600–650`) on one line in a broken limit. */
const NO_BREAK_SPACE = String.fromCharCode(0xa0);
const WORD_JOINER = String.fromCharCode(0x2060);

interface Draft {
  name: string;
  shape: string;
  width: string;
  bottomLevel: string;
  bottomOffset: string;
  topLevel: string;
  topOffset: string;
  risers: string;
  maxSlope: string;
  angle: string;
  direction: string;
  rotation: string;
  shaftW: string;
  shaftD: string;
  carW: string;
  carD: string;
  railLeft: boolean;
  railRight: boolean;
}

/**
 * A selected stair, ramp, ladder, elevator or escalator in the Properties panel: its fields in
 * display units (typed in any unit), the levels it joins, and what it derives to now (risers and
 * treads, slope, run) with the limits it breaks. Every change is `building.connector.update` with
 * the change number the panel saw.
 */
@Component({
  selector: 'x-connector-properties',
  imports: [AngleInput, Checkbox, FormField, Input, LengthInput, Select],
  templateUrl: './connector-properties.html',
  host: { class: 'flex flex-col', 'data-testid': 'connector-editor' },
})
export class ConnectorProperties {
  private readonly docs = inject(ProjectDocs);
  private readonly host = inject(HostBridge);
  private readonly toasts = inject(Toasts);
  private readonly app = inject(AppState);
  protected readonly units = inject(Units);
  private readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  protected readonly label = this.i18n.label;

  readonly projectId = input.required<string>();
  readonly connector = input.required<Connector>();

  protected readonly shapes = SHAPES;
  private readonly state = computed(() => this.docs.read(this.projectId()));
  protected readonly levels = computed(() => {
    const doc = this.state()?.doc;
    return doc ? deriveLevels(doc).reverse() : [];
  });
  private readonly limits = computed(() => this.app.config()?.rules ?? DEFAULT_RULE_LIMITS);
  /** What it derives to now, in display units. */
  protected readonly derived = computed(() => {
    const doc = this.state()?.doc;
    if (!doc) return null;
    const g = deriveConnector(this.connector(), deriveLevels(doc), this.limits());
    const len = (mm: number) => this.units.length(mm);
    const t = this.t;
    const lines: string[] = [];
    switch (g.kind) {
      case 'stair': {
        const flights = t('plan.connector.flights', { count: g.flights.length });
        lines.push(t('plan.connector.riserLine', { count: g.risers, height: len(g.riserHeight) }), t('plan.connector.treads', { depth: len(g.treadDepth) }), g.landings.length ? t('plan.connector.flightsLandings', { flights, count: g.landings.length }) : flights, t('plan.connector.rise', { length: len(g.rise) }));
        break;
      }
      case 'ramp':
        lines.push(t('plan.connector.slope', { slope: (Math.round(g.slope * 10) / 10).toFixed(1) }), t('plan.connector.run', { length: len(g.run) }), t('plan.connector.rise', { length: len(g.rise) }));
        break;
      case 'ladder':
      case 'escalator':
        lines.push(t('plan.connector.run', { length: len(g.run) }), t('plan.connector.rise', { length: len(g.rise) }));
        break;
      case 'elevator':
        lines.push(t('plan.connector.travel', { count: g.stops.length, length: len(g.rise) }));
        break;
    }
    // As the Warnings panel shows them: a length or a range never broken across lines (screenshot 136 had `600–650` and its `mm` apart).
    const whole = (mm: number) => len(mm).replace(/ /g, NO_BREAK_SPACE);
    return { lines, broken: g.broken.map((b) => this.i18n.phrase(b.text, whole).replace(/(\d)–(\d)/g, `$1${WORD_JOINER}–${WORD_JOINER}$2`)) };
  });
  /** An elevator's stops as checkboxes over the levels, top to bottom, with the door side of each. */
  protected readonly stops = computed(() => {
    const c = this.connector();
    if (c.kind !== 'elevator') return [];
    return this.levels().map((l) => {
      const stop = c.stops.find((s) => s.levelId === l.id);
      return { levelId: l.id, name: l.name, stop: Boolean(stop), door: stop?.door ?? 'front' };
    });
  });

  protected readonly draft = linkedSignal<Connector, Draft>({
    source: this.connector,
    computation: (c) => {
      const len = (mm: number | undefined) => (mm === undefined ? '' : this.units.length(mm));
      const d: Draft = { name: c.name ?? '', shape: 'straight', width: '', bottomLevel: '', bottomOffset: '', topLevel: '', topOffset: '', risers: '', maxSlope: '', angle: '', direction: '', rotation: '', shaftW: '', shaftD: '', carW: '', carD: '', railLeft: true, railRight: true };
      if ('width' in c) d.width = len(c.width);
      if ('bottom' in c) {
        d.bottomLevel = c.bottom.levelId;
        d.bottomOffset = len(c.bottom.offset);
        d.topLevel = c.top.levelId;
        d.topOffset = len(c.top.offset);
      }
      if (c.kind === 'stair') {
        d.shape = c.shape;
        d.risers = c.riser.count ? String(c.riser.count) : '';
        d.railLeft = c.handrails.left;
        d.railRight = c.handrails.right;
      }
      if (c.kind === 'ramp') d.maxSlope = String(c.maxSlope);
      if (c.kind === 'ladder') d.angle = this.units.angle(c.angle);
      if (c.kind === 'ladder' || c.kind === 'escalator') d.direction = this.units.angle(c.direction);
      if (c.kind === 'elevator') {
        d.rotation = this.units.angle(c.rotation);
        d.shaftW = len(c.shaft.w);
        d.shaftD = len(c.shaft.d);
        d.carW = len(c.car.w);
        d.carD = len(c.car.d);
      }
      return d;
    },
  });
  protected readonly f = form(this.draft);

  private async update(set: Record<string, unknown>): Promise<void> {
    const s = untracked(this.state);
    try {
      await this.host.invoke('building.connector.update', { id: untracked(this.connector).id, set, ...(s ? { baseSeq: s.seq, epoch: s.epoch } : {}) }, untracked(this.projectId));
    } catch (err) {
      this.toasts.error(err);
      // Put the fields back to what is stored.
      this.draft.set(untracked(this.draft));
    }
  }

  protected setName(): void {
    const name = untracked(this.draft).name.trim();
    const c = untracked(this.connector);
    if (name !== (c.name ?? '')) void this.update({ name });
  }

  protected set(field: string, value: unknown): void {
    void this.update({ [field]: value });
  }

  protected setLength(field: string, mm: number | null): void {
    if (mm !== null && mm > 0) void this.update({ [field]: mm });
  }

  /** One end's level or offset: `end` is bottom or top. */
  protected setEnd(end: 'bottom' | 'top', part: 'levelId' | 'offset', value: string | number | null): void {
    const c = untracked(this.connector);
    if (!('bottom' in c) || value === null) return;
    void this.update({ [end]: { ...c[end], [part]: value } });
  }

  protected setRisers(): void {
    const c = untracked(this.connector);
    if (c.kind !== 'stair') return;
    const text = untracked(this.draft).risers.trim();
    if (!text) {
      if (c.riser.count !== undefined) void this.update({ riser: { ...c.riser, count: undefined } });
      return;
    }
    const n = Number(toLatinDigits(text));
    if (!Number.isInteger(n) || n < 2 || n > 60) {
      this.toasts.notify(this.t('plan.connector.risersInvalid'), 'error');
      this.draft.update((d) => ({ ...d, risers: c.riser.count ? String(c.riser.count) : '' }));
      return;
    }
    if (n !== c.riser.count) void this.update({ riser: { ...c.riser, count: n } });
  }

  protected setRail(side: 'left' | 'right', on: boolean): void {
    const c = untracked(this.connector);
    if (c.kind === 'stair') void this.update({ handrails: { ...c.handrails, [side]: on } });
  }

  protected setSlope(): void {
    const c = untracked(this.connector);
    if (c.kind !== 'ramp') return;
    const value = Number(toLatinDigits(untracked(this.draft).maxSlope).replace(/[%٪]/, '').trim());
    if (!Number.isFinite(value) || value <= 0 || value > 100) {
      this.toasts.notify(this.t('plan.connector.slopeInvalid'), 'error');
      this.draft.update((d) => ({ ...d, maxSlope: String(c.maxSlope) }));
      return;
    }
    if (value !== c.maxSlope) void this.update({ maxSlope: value });
  }

  protected setSize(field: 'shaft' | 'car', part: 'w' | 'd', mm: number | null): void {
    const c = untracked(this.connector);
    if (c.kind !== 'elevator' || mm === null || mm <= 0) return;
    void this.update({ [field]: { ...c[field], [part]: mm } });
  }

  /** Adds or removes a stop, or changes its door side; the list stays bottom to top. */
  protected setStop(levelId: string, change: { stop?: boolean; door?: string }): void {
    const c = untracked(this.connector);
    if (c.kind !== 'elevator') return;
    const order = [...untracked(this.levels)].reverse().map((l) => l.id);
    let stops = c.stops.filter((s) => s.levelId !== levelId);
    const current = c.stops.find((s) => s.levelId === levelId);
    const keep = change.stop ?? Boolean(current);
    if (keep) stops.push({ levelId, door: (change.door ?? current?.door ?? 'front') as 'front' });
    stops = stops.sort((a, b) => order.indexOf(a.levelId) - order.indexOf(b.levelId));
    if (stops.length < 2) {
      this.toasts.notify(this.t('plan.connector.twoStops'), 'error');
      return;
    }
    void this.update({ stops });
  }
}
