import { Service, computed, inject } from '@angular/core';
import { defaultConfig, formatAngle, formatLength, parseAngle, parseLength } from '@studio/core';
import { AppState } from './app-state';

/** Lengths and angles in the user's display units. Reading `format` in a template follows unit changes. */
@Service()
export class Units {
  private readonly app = inject(AppState);
  readonly settings = computed(() => this.app.units() ?? defaultConfig().units);

  /** A length in mm, as the user reads it. */
  length(mm: number | null | undefined): string {
    return mm === null || mm === undefined ? '' : formatLength(mm, this.settings());
  }

  /** Text the user typed, in mm; null when it is not a length. */
  parseLength(text: string): number | null {
    return parseLength(text, this.settings());
  }

  angle(degrees: number): string {
    return formatAngle(degrees, this.settings());
  }

  parseAngle(text: string): number | null {
    return parseAngle(text);
  }
}
