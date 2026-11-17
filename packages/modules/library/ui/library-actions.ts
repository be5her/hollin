import { Service, inject } from '@angular/core';
import { BRANDING, type ProjectSummary } from '@studio/core';
import { Dialogs, HostBridge, I18n, Toasts } from '@studio/ui';

/** Tags typed in a field: separated by commas, the Arabic comma too. */
export function splitTags(text: string): string[] {
  return text.split(/[,،]/).map((tag) => tag.trim()).filter(Boolean);
}

/** What the Home screen, the project tab and the palette do with projects; each step is a host command. */
@Service()
export class LibraryActions {
  private readonly host = inject(HostBridge);
  private readonly dialogs = inject(Dialogs);
  private readonly toasts = inject(Toasts);
  private readonly t = inject(I18n).t;

  /** The native picker's filter for project packages, in the language of the moment. */
  private packageFilter() {
    return [{ name: this.t('library.packageFilter', { product: BRANDING.productName }), extensions: [BRANDING.packageExtension] }];
  }

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
    const name = await this.dialogs.prompt({ title: this.t('library.action.new'), label: this.t('library.name'), defaultValue: this.t('library.untitled'), confirmLabel: this.t('library.create') });
    if (name?.trim()) await this.run('project.create', { name: name.trim() });
  }

  async importProject(): Promise<void> {
    const picked = await this.run<{ path: string | null }>('app.pickFile', { title: this.t('library.import.title'), filters: this.packageFilter() });
    if (picked?.path) await this.run<ProjectSummary>('project.import', { path: picked.path }, (p) => this.t('library.imported', { name: p.name }));
  }

  async rename(p: Pick<ProjectSummary, 'id' | 'name'>): Promise<void> {
    const name = await this.dialogs.prompt({ title: this.t('library.rename.title'), label: this.t('library.name'), defaultValue: p.name, confirmLabel: this.t('library.rename.confirm') });
    if (name?.trim() && name.trim() !== p.name) await this.run('project.update', { id: p.id, name: name.trim() });
  }

  async editTags(p: Pick<ProjectSummary, 'id' | 'tags'>): Promise<void> {
    const text = await this.dialogs.prompt({ title: this.t('library.tags.title'), label: this.t('library.tags.label'), defaultValue: p.tags.join(this.t('common.listSeparator')), placeholder: this.t('library.tags.placeholder'), confirmLabel: this.t('library.save') });
    if (text === null) return;
    await this.run('project.update', { id: p.id, tags: splitTags(text) });
  }

  async duplicate(p: Pick<ProjectSummary, 'id' | 'name'>): Promise<void> {
    await this.run<ProjectSummary>('project.duplicate', { id: p.id }, (copy) => this.t('library.duplicated', { name: copy.name }));
  }

  async exportProject(p: Pick<ProjectSummary, 'id' | 'name'>): Promise<void> {
    const safe = p.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim() || 'project';
    const picked = await this.run<{ path: string | null }>('app.pickSavePath', { title: this.t('library.export.title'), defaultPath: `${safe}.${BRANDING.packageExtension}`, filters: this.packageFilter() });
    if (!picked?.path) return;
    await this.run<{ path: string }>('project.export', { id: p.id, path: picked.path }, (r) => this.t('library.exported', { path: r.path }));
  }

  async trash(p: Pick<ProjectSummary, 'id' | 'name'>): Promise<void> {
    await this.run('project.trash', { id: p.id }, () => this.t('library.trashed', { name: p.name }));
  }

  async restore(p: Pick<ProjectSummary, 'id' | 'name'>): Promise<void> {
    await this.run('project.restore', { id: p.id }, () => this.t('library.restored', { name: p.name }));
  }

  async deleteForever(p: Pick<ProjectSummary, 'id' | 'name'>): Promise<void> {
    const ok = await this.dialogs.confirm({ title: this.t('library.delete.title', { name: p.name }), message: this.t('library.delete.message'), danger: true, confirmLabel: this.t('library.delete.confirm') });
    if (ok) await this.run('project.delete', { id: p.id }, () => this.t('library.deleted', { name: p.name }));
  }
}
