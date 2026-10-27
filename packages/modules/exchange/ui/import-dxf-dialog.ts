import { Component, computed, inject, input, linkedSignal } from '@angular/core';
import { FormField, form, max, maxLength, min, required, validate } from '@angular/forms/signals';
import { Button, Checkbox, Input, Label, Select, Units, type DialogComponent } from '@studio/ui';

/** What `import.dxf.probe` returns. */
export interface DxfProbe {
  insUnits: number | null;
  /** $MEASUREMENT: 0 imperial, 1 metric. */
  measurement: number | null;
  units: string | null;
  scale: number;
  layers: { name: string; entities: number; color: number; hidden: boolean }[];
  skipped: Record<string, number>;
  paperSpace: number;
  extents: { min: [number, number]; max: [number, number] } | null;
}

export interface ImportDxfData {
  fileName: string;
  probe: DxfProbe;
  levels: { id: string; name: string }[];
  /** The level on screen, chosen first. */
  levelId: string;
}

/** What the dialog answers: `layers` holds the DXF layers to import, every one of them when all stay ticked. */
export interface ImportDxfChoice {
  levelId: string;
  scale: number;
  origin: [number, number];
  layerPrefix: string;
  layers: string[];
  allLayers: boolean;
}

/**
 * The DXF import dialog, after `import.dxf.probe`: the file's units and the scale they give (editable,
 * in mm per drawing unit), the extent at that scale, the layers with their entity counts to tick, what
 * the import skips, and where it goes: the level, an origin and the layer prefix.
 */
@Component({
  selector: 'x-import-dxf-dialog',
  imports: [Button, Checkbox, FormField, Input, Label, Select],
  templateUrl: './import-dxf-dialog.html',
  host: { class: 'block', 'data-testid': 'import-dxf-dialog' },
})
export class ImportDxfDialog implements DialogComponent<ImportDxfData, ImportDxfChoice> {
  private readonly units = inject(Units);

  readonly data = input.required<ImportDxfData>();
  readonly close = input.required<(value: ImportDxfChoice | null) => void>();

  protected readonly model = linkedSignal(() => {
    const { probe, levelId } = this.data();
    return { scale: probe.scale, levelId, originX: 0, originY: 0, layerPrefix: 'DXF ', layers: probe.layers.map(() => true) };
  });
  protected readonly f = form(this.model, (p) => {
    required(p.scale, { message: 'Enter the millimetres per drawing unit' });
    min(p.scale, 0.000001, { message: 'Must be more than 0' });
    max(p.scale, 1e9, { message: 'Too large' });
    required(p.originX, { message: 'Enter a number' });
    required(p.originY, { message: 'Enter a number' });
    maxLength(p.layerPrefix, 60, { message: 'At most 60 characters' });
    validate(p.layers, ({ value }) => (value().some(Boolean) ? null : { kind: 'none', message: 'Tick at least one layer' }));
  });

  protected readonly unitsLabel = computed(() => {
    const { units, insUnits, measurement } = this.data().probe;
    if (insUnits === null) return measurement === 0 ? 'Inches (an imperial drawing without stated units)' : 'Not stated in the file';
    if (insUnits === 0) return 'Unitless';
    return units ?? `Unknown (code ${insUnits})`;
  });
  /** The drawing's extent in mm at the scale in the field, as the display units show lengths. */
  protected readonly extent = computed(() => {
    const e = this.data().probe.extents;
    const scale = Number(this.model().scale);
    if (!e || !(scale > 0)) return null;
    return { width: this.units.length((e.max[0] - e.min[0]) * scale), height: this.units.length((e.max[1] - e.min[1]) * scale) };
  });
  protected readonly skipped = computed(() => {
    const { skipped, paperSpace } = this.data().probe;
    const parts = Object.entries(skipped)
      .sort((a, b) => b[1] - a[1])
      .map(([type, n]) => `${type} ${n}`);
    if (paperSpace) parts.push(`paper space ${paperSpace}`);
    return parts.join(', ');
  });
  /** A layer to name in the prefix's example: the first that has something to import. */
  protected readonly exampleLayer = computed(() => this.data().probe.layers.find((l) => l.entities > 0) ?? this.data().probe.layers[0] ?? null);
  protected readonly ticked = computed(() => this.model().layers.filter(Boolean).length);
  protected readonly entities = computed(() => this.data().probe.layers.reduce((n, l, i) => n + (this.model().layers[i] ? l.entities : 0), 0));
  protected readonly invalid = computed(() => !this.f().valid());

  protected all(on: boolean): void {
    this.model.update((m) => ({ ...m, layers: m.layers.map(() => on) }));
  }

  protected submit(event: Event): void {
    event.preventDefault();
    if (!this.f().valid()) return;
    const m = this.model();
    const layers = this.data().probe.layers.filter((_, i) => m.layers[i]).map((l) => l.name);
    this.close()({ levelId: m.levelId, scale: m.scale, origin: [m.originX, m.originY], layerPrefix: m.layerPrefix, layers, allLayers: layers.length === m.layers.length });
  }

  protected cancel(): void {
    this.close()(null);
  }
}
