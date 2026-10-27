import { Component, computed, input, linkedSignal } from '@angular/core';
import { FormField, form, hidden, max, min, required } from '@angular/forms/signals';
import { PAPER_SIZES, type PaperSize } from '@studio/core';
import { Button, Checkbox, Input, Label, Select, type DialogComponent } from '@studio/ui';

export type ExportFormat = 'pdf' | 'svg' | 'dxf' | 'glb' | 'png';

/** What the Export dialog asks; `ExchangeActions` turns it into `export.plan`, `export.building` or `export.image`. */
export interface ExportChoice {
  format: ExportFormat;
  /** DXF, SVG and PDF: the level on screen, or every level. */
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

export interface ExportDialogData {
  projectName: string;
  /** The level on screen, for "current level only" and a plan image. */
  levelName: string;
  levelCount: number;
  /** How a 3D image will be seen (the 3D view's camera and display), shown under the view choice. */
  view3dSummary: string;
  initial: ExportChoice;
}

export const FORMATS: { value: ExportFormat; label: string; hint: string; ext: string; filter: string }[] = [
  { value: 'pdf', label: 'PDF', hint: 'Plan drawing to print', ext: 'pdf', filter: 'PDF document' },
  { value: 'svg', label: 'SVG', hint: 'Plan drawing, vector', ext: 'svg', filter: 'SVG drawing' },
  { value: 'dxf', label: 'DXF', hint: 'Plan for CAD', ext: 'dxf', filter: 'DXF drawing' },
  { value: 'glb', label: 'glTF', hint: 'Building in 3D', ext: 'glb', filter: 'glTF binary model' },
  { value: 'png', label: 'PNG', hint: 'Image of the plan or 3D', ext: 'png', filter: 'PNG image' },
];

export const SCALES = [
  { value: 'fit', label: 'Fit to page' },
  { value: '50', label: '1:50' },
  { value: '100', label: '1:100' },
  { value: '200', label: '1:200' },
  { value: '500', label: '1:500' },
];

export const SIZES = [
  { value: '1600x1200', label: '1600 × 1200' },
  { value: '2560x1920', label: '2560 × 1920' },
  { value: '3840x2880', label: '3840 × 2880' },
  { value: 'custom', label: 'Custom' },
];

/**
 * The Export dialog: the format first, then only what that format takes (levels, sheet and scale for
 * the drawings; furniture and finishes for glTF; view, size, theme and background for PNG).
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

  protected readonly formats = FORMATS;
  protected readonly scales = SCALES;
  protected readonly sizes = SIZES;
  protected readonly pages = PAPER_SIZES;

  protected readonly model = linkedSignal(() => ({ ...this.data().initial }));
  protected readonly f = form(this.model, (p) => {
    // The pixel sizes count only for a PNG of a custom size.
    for (const side of [p.width, p.height]) {
      hidden(side, ({ valueOf }) => valueOf(p.size) !== 'custom' || valueOf(p.format) !== 'png');
      required(side, { message: 'Enter a size in pixels' });
      min(side, 64, { message: 'At least 64 px' });
      max(side, 4096, { message: 'At most 4096 px' });
    }
  });

  protected readonly format = computed(() => this.model().format);
  protected readonly isDrawing = computed(() => ['pdf', 'svg', 'dxf'].includes(this.format()));
  protected readonly onSheet = computed(() => this.format() === 'pdf' || this.format() === 'svg');
  protected readonly custom = computed(() => this.model().size === 'custom');
  /** What the chosen levels make: one file per level (DXF, SVG) or one PDF with a page per level. */
  protected readonly levelsHint = computed(() => {
    const { format, levels } = this.model();
    const n = levels === 'all' ? this.data().levelCount : 1;
    if (format === 'pdf') return n === 1 ? 'One page' : `One file, a page per level (${n})`;
    return n === 1 ? 'One file' : `A file per level (${n}), named after it`;
  });
  protected readonly invalid = computed(() => !this.f().valid());

  protected submit(event: Event): void {
    event.preventDefault();
    if (!this.f().valid()) return;
    this.close()(this.model());
  }

  protected cancel(): void {
    this.close()(null);
  }
}
