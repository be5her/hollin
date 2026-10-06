import type { Tool } from './tool';

/** The default tool. Selection and editing arrive with the next step; for now it only pans and zooms. */
export class SelectTool implements Tool {
  readonly id = 'select';
  readonly busy = false;

  cancel(): void {}

  hint(): string {
    return 'W: draw walls';
  }
}
