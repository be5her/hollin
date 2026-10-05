import { Service, inject, untracked } from '@angular/core';
import { AppState, HostBridge, Toasts } from '@studio/ui';

/** Undo and redo on the project on screen. */
@Service()
export class EditActions {
  private readonly app = inject(AppState);
  private readonly host = inject(HostBridge);
  private readonly toasts = inject(Toasts);

  async undo(projectId = untracked(this.app.activeProjectId)): Promise<void> {
    if (!projectId) return;
    try {
      await this.host.invoke('edit.undo', {}, projectId);
    } catch (err) {
      this.toasts.error(err);
    }
  }

  async redo(projectId = untracked(this.app.activeProjectId)): Promise<void> {
    if (!projectId) return;
    try {
      await this.host.invoke('edit.redo', {}, projectId);
    } catch (err) {
      this.toasts.error(err);
    }
  }
}
