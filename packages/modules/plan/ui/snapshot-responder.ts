import { DOCUMENT, Service, inject, untracked } from '@angular/core';
import { DEFAULT_RULE_LIMITS, type HostEvents, type ProjectDoc } from '@studio/core';
import { AppState, HostBridge, ProjectDocs, Units } from '@studio/ui';
import { DARK_SCENE_THEME, DARK_THEME, LIGHT_SCENE_THEME, LIGHT_THEME, SnapshotSizeError, renderBuildingToPng, renderLevelToPng } from '@studio/viewport';
import { PlanGeometry } from './plan-geometry';

/** How long to wait for a project's document to arrive in the mirror before giving up on a snapshot. */
const DOC_TIMEOUT = 5000;

/**
 * Answers `view.snapshot`: main has no canvas, so it asks the window to draw a level
 * (`view.snapshot.request`) and this service renders it with `renderLevelToPng` (the plan) or
 * `renderBuildingToPng` (the building in 3D) from the mirror of the project's document (loading it
 * when the project has no tab open) and sends the PNG back through the hidden `view.snapshot.reply`.
 * Light colours on the paper by default and never a grid, so a model sees the design plainly; the
 * request can ask for the dark palette and a transparent background (`export.image`).
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
    let reply: { id: string; png?: string; error?: string; code?: 'NOT_FOUND' | 'UNAVAILABLE' };
    try {
      const doc = await this.docFor(request.projectId);
      const createCanvas = (width: number, height: number) => {
        const c = this.document.createElement('canvas');
        c.width = width;
        c.height = height;
        return c;
      };
      const limits = untracked(this.app.config)?.rules ?? DEFAULT_RULE_LIMITS;
      const { width, height, transparent } = request;
      const dark = request.theme === 'dark';
      const png =
        request.view === '3d'
          ? await renderBuildingToPng(doc, { width, height, createCanvas, limits, theme: dark ? DARK_SCENE_THEME : LIGHT_SCENE_THEME, transparent, azimuth: request.azimuth, elevation: request.elevation, mode: request.display, levelId: request.levelId, explode: request.explode, lighting: request.lighting })
          : renderLevelToPng(doc, request.levelId, { width, height, createCanvas, limits, theme: dark ? DARK_THEME : LIGHT_THEME, transparent, units: untracked(this.units.settings), cache: this.geometry.cache });
      const nothing = request.view === '3d' ? 'Nothing is built in 3D yet: the building has no walls, slabs, columns or connectors.' : `Nothing is drawn on level ${doc.levels[request.levelId]?.name ?? request.levelId} yet.`;
      reply = png ? { id: request.id, png } : { id: request.id, error: nothing };
    } catch (err) {
      reply = { id: request.id, error: err instanceof Error ? err.message : String(err), ...(err instanceof SnapshotSizeError ? { code: 'UNAVAILABLE' as const } : {}) };
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
