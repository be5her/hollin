import { Service, inject } from '@angular/core';
import { BRANDING, type ProjectSummary } from '@studio/core';
import { Dialogs, HostBridge, Toasts } from '@studio/ui';

const PACKAGE_FILTER = [{ name: `${BRANDING.productName} project`, extensions: [BRANDING.packageExtension] }];

/** What the Home screen, the project tab and the palette do with projects; each step is a host command. */
@Service()
export class LibraryActions {
  private readonly host = inject(HostBridge);
  private readonly dialogs = inject(Dialogs);
  private readonly toasts = inject(Toasts);

  private async run<T>(id: string, input: unknown, done?: (result: T) => string | null): Promise<T | undefined> {
    try {
      const result = await this.host.invoke<T>(id, input, null);
      const message = done?.(result);
      if (message) this.toasts.notify(message, 'success');
      return result;
    } catch (err) {
      this.toasts.error(err);
      return undefined;
    }
  }

  async create(): Promise<void> {
    const name = await this.dialogs.prompt({ title: 'New project', label: 'Name', defaultValue: 'Untitled project', confirmLabel: 'Create' });
    if (name?.trim()) await this.run('project.create', { name: name.trim() });
  }

  async importProject(): Promise<void> {
    const picked = await this.run<{ path: string | null }>('app.pickFile', { title: 'Import project', filters: PACKAGE_FILTER });
    if (picked?.path) await this.run<ProjectSummary>('project.import', { path: picked.path }, (p) => `Imported "${p.name}"`);
  }

  async rename(p: Pick<ProjectSummary, 'id' | 'name'>): Promise<void> {
    const name = await this.dialogs.prompt({ title: 'Rename project', label: 'Name', defaultValue: p.name, confirmLabel: 'Rename' });
    if (name?.trim() && name.trim() !== p.name) await this.run('project.update', { id: p.id, name: name.trim() });
  }

  async editTags(p: Pick<ProjectSummary, 'id' | 'tags'>): Promise<void> {
    const text = await this.dialogs.prompt({ title: 'Edit tags', label: 'Tags, separated by commas', defaultValue: p.tags.join(', '), placeholder: 'residential, concept', confirmLabel: 'Save' });
    if (text === null) return;
    const tags = text.split(',').map((t) => t.trim()).filter(Boolean);
    await this.run('project.update', { id: p.id, tags });
  }

  async duplicate(p: Pick<ProjectSummary, 'id' | 'name'>): Promise<void> {
    await this.run<ProjectSummary>('project.duplicate', { id: p.id }, (copy) => `Created "${copy.name}"`);
  }

  async exportProject(p: Pick<ProjectSummary, 'id' | 'name'>): Promise<void> {
    const safe = p.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim() || 'project';
    const picked = await this.run<{ path: string | null }>('app.pickSavePath', { title: 'Export project', defaultPath: `${safe}.${BRANDING.packageExtension}`, filters: PACKAGE_FILTER });
    if (!picked?.path) return;
    await this.run<{ path: string }>('project.export', { id: p.id, path: picked.path }, (r) => `Exported to ${r.path}`);
  }

  async trash(p: Pick<ProjectSummary, 'id' | 'name'>): Promise<void> {
    await this.run('project.trash', { id: p.id }, () => `Moved "${p.name}" to the trash`);
  }

  async restore(p: Pick<ProjectSummary, 'id' | 'name'>): Promise<void> {
    await this.run('project.restore', { id: p.id }, () => `Restored "${p.name}"`);
  }

  async deleteForever(p: Pick<ProjectSummary, 'id' | 'name'>): Promise<void> {
    const ok = await this.dialogs.confirm({ title: `Delete "${p.name}" permanently?`, message: 'It cannot be restored afterwards.', danger: true, confirmLabel: 'Delete' });
    if (ok) await this.run('project.delete', { id: p.id }, () => `Deleted "${p.name}"`);
  }
}
