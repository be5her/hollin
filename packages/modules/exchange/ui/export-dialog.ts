import { Component, computed, inject, input, linkedSignal } from '@angular/core';
import { FormField, form, hidden, required, validate } from '@angular/forms/signals';
import { PAPER_SIZES, parseNumber, type MessageKey, type PaperSize } from '@studio/core';
import { Button, Checkbox, I18n, Input, Label, Select, type DialogComponent, type Translate } from '@studio/ui';

export type ExportFormat = 'pdf' | 'svg' | 'dxf' | 'glb' | 'png';

/** What the Export dialog asks; `ExchangeActions` turns it into `export.plan`, `export.building` or `export.image`. */
export interface ExportChoice {
  format: ExportFormat;
  /** DXF, SVG, PDF and glTF: the level on screen, or every level. */
  levels: 'current' | 'all';
  page: PaperSize;
  orientation: 'landscape' | 'portrait';
  /** SVG and PDF: `fit` or a 1:N denominator. */
  scale: string;
  includeItems: boolean;
  includeFinishes: boolean;
  view: 'plan' | '3d';
  /** PNG: a preset `<w>x<h>` or `custom` (then `width` and `height`). */
  size: string;
  width: number;
  height: number;
  theme: 'light' | 'dark';
  transparent: boolean;
}

/** How the 3D view shows the building, as a 3D image takes it: the line under the view choice says it. */
export interface View3dShown {
  azimuth: number;
  elevation: number;
  display: 'all' | 'isolate' | 'cutaway';
  /** The level on screen, which `isolate` and `cutaway` are about. */
  level: string;
  explode: number;
  lighting: 'day' | 'night';
}

export interface ExportDialogData {
  projectName: string;
  /** The level on screen, for "current level only" and a plan image. */
  levelName: string;
  levelCount: number;
  /** How a 3D image will be seen (the 3D view's camera and display), shown under the view choice. */
  view3d: View3dShown;
  initial: ExportChoice;
}

/** "As the 3D view shows it: from 225°, 30° up, every level, by day." */
export function view3dSummary(v: View3dShown, t: Translate): string {
  const shown = v.display === 'all' ? t('exchange.view3d.all') : t(v.display === 'isolate' ? 'exchange.view3d.isolate' : 'exchange.view3d.cutaway', { level: v.level });
  const exploded = v.explode ? t('exchange.view3d.exploded', { percent: Math.round(v.explode * 100) }) : '';
  return t('exchange.view3d.summary', { azimuth: v.azimuth, elevation: v.elevation, shown, exploded, lighting: t(v.lighting === 'night' ? 'exchange.view3d.night' : 'exchange.view3d.day') });
}

/** The formats by their own names (PDF, glTF), with what each makes and the native picker's filter as message keys. */
export const FORMATS: { value: ExportFormat; label: string; hint: MessageKey; ext: string; filter: MessageKey }[] = [
  { value: 'pdf', label: 'PDF', hint: 'exchange.format.pdf', ext: 'pdf', filter: 'exchange.filter.pdf' },
  { value: 'svg', label: 'SVG', hint: 'exchange.format.svg', ext: 'svg', filter: 'exchange.filter.svg' },
  { value: 'dxf', label: 'DXF', hint: 'exchange.format.dxf', ext: 'dxf', filter: 'exchange.filter.dxf' },
  { value: 'glb', label: 'glTF', hint: 'exchange.format.glb', ext: 'glb', filter: 'exchange.filter.glb' },
  { value: 'png', label: 'PNG', hint: 'exchange.format.png', ext: 'png', filter: 'exchange.filter.png' },
];

/** A label is a message key or a ratio shown as it is. */
export const SCALES = [
  { value: 'fit', label: 'exchange.export.fit' },
  { value: '50', label: '1:50' },
  { value: '100', label: '1:100' },
  { value: '200', label: '1:200' },
  { value: '500', label: '1:500' },
];

/** A pixel size between left-to-right isolates (an option has no element for `bidi-ltr`): right to left it would read `1200 × 1600`. */
const pixels = (width: number, height: number) => `${String.fromCharCode(0x2066)}${width} × ${height}${String.fromCharCode(0x2069)}`;

/** A label is a message key or a pixel size shown as it is. */
export const SIZES = [
  { value: '1600x1200', label: pixels(1600, 1200) },
  { value: '2560x1920', label: pixels(2560, 1920) },
  { value: '3840x2880', label: pixels(3840, 2880) },
  { value: 'custom', label: 'exchange.export.custom' },
];

/**
 * The Export dialog: the format first, then only what that format takes (levels, sheet and scale for
 * the drawings; levels, furniture and finishes for glTF; view, size, theme and background for PNG).
 */
@Component({
  selector: 'x-export-dialog',
  imports: [Button, Checkbox, FormField, Input, Label, Select],
  templateUrl: './export-dialog.html',
  host: { class: 'block', 'data-testid': 'export-dialog' },
})
export class ExportDialog implements DialogComponent<ExportDialogData, ExportChoice> {
  readonly data = input.required<ExportDialogData>();
  readonly close = input.required<(value: ExportChoice | null) => void>();
  private readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  /** A message key (a hint, a validation message) or text shown as it is. */
  protected readonly label = this.i18n.label;

  protected readonly formats = FORMATS;
  protected readonly scales = SCALES;
  protected readonly sizes = SIZES;
  protected readonly pages = PAPER_SIZES;

  /** The choice as the form edits it: the pixel sizes as typed (text fields, so Arabic-Indic digits arrive). */
  protected readonly model = linkedSignal(() => {
    const initial = this.data().initial;
    return { ...initial, width: String(initial.width), height: String(initial.height) };
  });
  protected readonly f = form(this.model, (p) => {
    // The pixel sizes count only for a PNG of a custom size.
    for (const side of [p.width, p.height]) {
      hidden(side, ({ valueOf }) => valueOf(p.size) !== 'custom' || valueOf(p.format) !== 'png');
      required(side, { message: 'exchange.export.sizeRequired' });
      validate(side, ({ value }) => {
        if (!value().trim()) return null;
        const n = parseNumber(value());
        if (!Number.isFinite(n)) return { kind: 'number', message: 'exchange.export.sizeRequired' };
        if (n < 64) return { kind: 'min', message: 'exchange.export.sizeMin' };
        return n > 4096 ? { kind: 'max', message: 'exchange.export.sizeMax' } : null;
      });
    }
  });

  protected readonly format = computed(() => this.model().format);
  protected readonly isDrawing = computed(() => ['pdf', 'svg', 'dxf'].includes(this.format()));
  /** The drawings and glTF take the level on screen or every level. */
  protected readonly hasLevels = computed(() => this.isDrawing() || this.format() === 'glb');
  protected readonly onSheet = computed(() => this.format() === 'pdf' || this.format() === 'svg');
  protected readonly custom = computed(() => this.model().size === 'custom');
  /** What the chosen levels make: one file per level (DXF, SVG), one PDF with a page per level, or one model. */
  protected readonly levelsHint = computed(() => {
    const { format, levels } = this.model();
    const n = levels === 'all' ? this.data().levelCount : 1;
    if (format === 'glb') return this.t(n === 1 ? 'exchange.export.glbOne' : 'exchange.export.glbAll');
    if (format === 'pdf') return n === 1 ? this.t('exchange.export.pdfOne') : this.t('exchange.export.pdfAll', { count: n });
    return n === 1 ? this.t('exchange.export.fileOne') : this.t('exchange.export.fileAll', { count: n });
  });
  protected readonly view3dLine = computed(() => view3dSummary(this.data().view3d, this.t));
  protected readonly invalid = computed(() => !this.f().valid());

  protected submit(event: Event): void {
    event.preventDefault();
    if (!this.f().valid()) return;
    const m = this.model();
    this.close()({ ...m, width: parseNumber(m.width), height: parseNumber(m.height) });
  }

  protected cancel(): void {
    this.close()(null);
  }
}
