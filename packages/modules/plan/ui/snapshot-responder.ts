import { DOCUMENT, Service, inject, untracked } from '@angular/core';
import { DEFAULT_RULE_LIMITS, type HostEvents, type ProjectDoc } from '@studio/core';
import { AppState, HostBridge, ProjectDocs, Units } from '@studio/ui';
import { LIGHT_THEME, renderLevelToPng } from '@studio/viewport';
import { PlanGeometry } from './plan-geometry';

/** How long to wait for a project's document to arrive in the mirror before giving up on a snapshot. */
const DOC_TIMEOUT = 5000;

/**
 * Answers `view.snapshot`: main has no canvas, so it asks the window to draw a level
 * (`view.snapshot.request`) and this service renders it with `renderLevelToPng` from the mirror of the
 * project's document (loading it when the project has no tab open) and sends the PNG back through the
 * hidden `view.snapshot.reply`. Always light colours and no grid, so a model sees the plan plainly.
 */
@Service()
export class SnapshotResponder {
  private readonly host = inject(HostBridge);
  private readonly docs = inject(ProjectDocs);
  private readonly units = inject(Units);
  private readonly app = inject(AppState);
  private readonly geometry = inject(PlanGeometry);
  private readonly document = inject(DOCUMENT);

  start(): void {
    this.host.on('view.snapshot.request', (request) => void this.answer(request));
  }

  private async answer(request: HostEvents['view.snapshot.request']): Promise<void> {
    let reply: { id: string; png?: string; error?: string };
    try {
      const doc = await this.docFor(request.projectId);
      const png = renderLevelToPng(doc, request.levelId, {
        width: request.width,
        height: request.height,
        theme: LIGHT_THEME,
        units: untracked(this.units.settings),
        limits: untracked(this.app.config)?.rules ?? DEFAULT_RULE_LIMITS,
        cache: this.geometry.cache,
        createCanvas: (width, height) => {
          const c = this.document.createElement('canvas');
          c.width = width;
          c.height = height;
          return c;
        },
      });
      reply = png ? { id: request.id, png } : { id: request.id, error: `Nothing is drawn on level ${doc.levels[request.levelId]?.name ?? request.levelId} yet.` };
    } catch (err) {
      reply = { id: request.id, error: err instanceof Error ? err.message : String(err) };
    }
    await this.host.invoke('view.snapshot.reply', reply, null).catch(() => undefined);
  }

  /** The project's document from the mirror, waiting for it to load when the project has just been opened. */
  private async docFor(projectId: string): Promise<ProjectDoc> {
    const state = this.docs.state(projectId);
    const deadline = Date.now() + DOC_TIMEOUT;
    for (;;) {
      const doc = untracked(state)?.doc;
      if (doc) return doc;
      const error = untracked(this.docs.errors)[projectId];
      if (error) throw new Error(error);
      if (Date.now() > deadline) throw new Error('The project document did not arrive in time.');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}
