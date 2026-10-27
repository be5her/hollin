import { Service, inject, signal, untracked } from '@angular/core';
import { StudioError, type ProjectDoc } from '@studio/core';
import { AppState, Dialogs, HostBridge, OpenProjects, ProjectDocs, ProjectView, Toasts } from '@studio/ui';
import { ExportDialog, FORMATS, type ExportChoice } from './export-dialog';
import { ImportDxfDialog, type DxfProbe } from './import-dxf-dialog';

type Exported = { files?: { path: string }[]; path?: string; levels?: { name: string; scale: number; fits: boolean }[] };
type Imported = { levelId: string; counts: { shapes: number; separators: number; labels: number; layers: number }; skipped: Record<string, number> };
type View3d = { orbit?: { azimuth?: number; elevation?: number }; mode?: string; explode?: number; lighting?: string };

const DXF_FILTER = [{ name: 'DXF drawing', extensions: ['dxf'] }];

/** A name Windows accepts as a file name: the forbidden characters dropped. */
const fileSafe = (name: string) => name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim() || 'Export';
const folderOf = (path: string) => path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))) || path;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The Export dialog and the DXF import, as the project tab's toolbar, the Layers panel and the palette
 * run them: each asks in a dialog, picks the path with the host's native picker, then runs the
 * exchange module's command as the UI and says how it went in a toast.
 */
@Service()
export class ExchangeActions {
  private readonly app = inject(AppState);
  private readonly host = inject(HostBridge);
  private readonly dialogs = inject(Dialogs);
  private readonly toasts = inject(Toasts);
  private readonly docs = inject(ProjectDocs);
  private readonly projects = inject(OpenProjects);
  private readonly view = inject(ProjectView);
  /** The last answer of the Export dialog in this session, so a second export starts from it (but for the PNG theme, which follows the app's). */
  private last: ExportChoice | null = null;
  private readonly running = signal<ReadonlySet<string>>(new Set());

  /** Whether an export of this project is being written: its Export… button shows a spinner and is disabled until the command returns. */
  exporting(projectId: string): boolean {
    return this.running().has(projectId);
  }

  private setRunning(projectId: string, on: boolean): void {
    this.running.update((ids) => {
      const next = new Set(ids);
      if (on) next.add(projectId);
      else next.delete(projectId);
      return next;
    });
  }

  private doc(projectId: string): ProjectDoc | undefined {
    return untracked(() => this.docs.read(projectId)?.doc);
  }

  private activeLevel(projectId: string, doc: ProjectDoc): string {
    const stored = untracked(() => this.view.get<string | null>(projectId, 'activeLevel', null));
    return stored && doc.levels[stored] ? stored : doc.building.groundLevelId;
  }

  /** The 3D view's camera and display as `export.image` takes them, with a line saying so. */
  private view3d(projectId: string, doc: ProjectDoc): { input: Record<string, unknown>; summary: string } {
    const stored = untracked(() => this.view.get<View3d | null>(projectId, 'view3d', null)) ?? {};
    const finite = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
    const azimuth = Math.round(((finite(stored.orbit?.azimuth, 225) % 360) + 360) % 360);
    const elevation = Math.round(Math.min(89, Math.max(-89, finite(stored.orbit?.elevation, 30))));
    const display = stored.mode === 'isolate' || stored.mode === 'cutaway' ? stored.mode : 'all';
    const explode = Math.min(1, Math.max(0, finite(stored.explode, 0)));
    const lighting = stored.lighting === 'night' ? 'night' : 'day';
    const level = doc.levels[this.activeLevel(projectId, doc)]?.name ?? '';
    const shown = display === 'all' ? 'every level' : display === 'isolate' ? `${level} alone` : `cut away at ${level}`;
    const summary = `As the 3D view shows it: from ${azimuth}°, ${elevation}° up, ${shown}${explode ? `, exploded ${Math.round(explode * 100)} %` : ''}, ${lighting === 'night' ? 'at night' : 'by day'}.`;
    return { input: { azimuth, elevation, display, explode, lighting }, summary };
  }

  async export(projectId: string): Promise<void> {
    const doc = this.doc(projectId);
    if (!doc || untracked(() => this.exporting(projectId))) return;
    const projectName = untracked(this.projects.projects).find((p) => p.id === projectId)?.name ?? 'Project';
    const levelId = this.activeLevel(projectId, doc);
    const view3d = this.view3d(projectId, doc);
    const defaults: ExportChoice = {
      format: 'pdf',
      levels: 'all',
      page: 'A3',
      orientation: 'landscape',
      scale: 'fit',
      includeItems: true,
      includeFinishes: true,
      view: 'plan',
      size: '1600x1200',
      width: 1600,
      height: 1200,
      theme: 'light',
      transparent: false,
    };
    const initial: ExportChoice = { ...(this.last ?? defaults), theme: untracked(this.app.resolvedTheme) };
    const choice = await this.dialogs.open(ExportDialog, { projectName, levelName: doc.levels[levelId]?.name ?? '', levelCount: doc.building.stack.length, view3dSummary: view3d.summary, initial });
    if (!choice) return;
    this.last = choice;
    const format = FORMATS.find((f) => f.value === choice.format)!;
    const path = await this.pick('app.pickSavePath', { title: `Export ${format.label}`, defaultPath: `${fileSafe(projectName)}.${format.ext}`, filters: [{ name: format.filter, extensions: [format.ext] }] });
    if (!path) return;

    let id: string;
    let input: Record<string, unknown>;
    const levelIds = choice.levels === 'current' ? [levelId] : doc.building.stack;
    if (choice.format === 'glb') {
      id = 'export.building';
      input = { path, levelIds, includeItems: choice.includeItems, includeFinishes: choice.includeFinishes };
    } else if (choice.format === 'png') {
      const [w, h] = choice.size === 'custom' ? [choice.width, choice.height] : choice.size.split('x').map(Number);
      id = 'export.image';
      input = { path, levelId, view: choice.view, width: w, height: h, theme: choice.theme, transparent: choice.transparent, ...(choice.view === '3d' ? view3d.input : {}) };
    } else {
      const fit = choice.scale === 'fit';
      id = 'export.plan';
      input = { path, format: choice.format, levelIds, scale: fit ? 100 : Number(choice.scale), fit, page: choice.page, orientation: choice.orientation };
    }
    this.setRunning(projectId, true);
    try {
      const result = await this.invokeExport(id, input, projectId);
      if (!result) return;
      const files = result.files?.map((f) => f.path) ?? (result.path ? [result.path] : [path]);
      const cut = result.levels?.filter((l) => !l.fits) ?? [];
      const notice = cut.length ? `; ${cut.map((l) => l.name).join(', ')} ${cut.length === 1 ? 'does' : 'do'} not fit the sheet at 1:${cut[0].scale}` : '';
      this.toasts.notify(`Exported ${plural(files.length, 'file')} to ${folderOf(files[0])}${notice}`, 'success', { label: 'Show', run: () => void this.reveal(files[0]) });
    } catch (err) {
      this.toasts.error(err);
    } finally {
      this.setRunning(projectId, false);
    }
  }

  /**
   * Runs an export; when it would replace files of several levels that are there already (CONFLICT
   * with their paths), asks first and runs it again with `overwrite`. Null when the user declined.
   */
  private async invokeExport(id: string, input: Record<string, unknown>, projectId: string): Promise<Exported | null> {
    try {
      return await this.host.invoke<Exported>(id, input, projectId);
    } catch (err) {
      const existing = err instanceof StudioError && err.code === 'CONFLICT' ? (err.details as { existing?: string[] } | undefined)?.existing : undefined;
      if (!existing?.length) throw err;
      const replace = await this.dialogs.confirm({
        title: `Replace ${plural(existing.length, 'file')}?`,
        message: `A file per level is written next to the name you chose. These are in ${folderOf(existing[0])} already:`,
        details: existing.map((p) => p.slice(Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1)),
        confirmLabel: 'Replace',
        danger: true,
      });
      return replace ? this.host.invoke<Exported>(id, { ...input, overwrite: true }, projectId) : null;
    }
  }

  /** The DXF import: a file from the picker, probed, then the import dialog, onto `levelId` (the level on screen by default). */
  async importDxf(projectId: string, levelId?: string): Promise<void> {
    const doc = this.doc(projectId);
    if (!doc) return;
    const path = await this.pick('app.pickFile', { title: 'Import DXF', filters: DXF_FILTER });
    if (!path) return;
    let probe: DxfProbe;
    try {
      probe = await this.host.invoke<DxfProbe>('import.dxf.probe', { path }, null);
    } catch (err) {
      this.toasts.error(err);
      return;
    }
    const levels = [...doc.building.stack].reverse().map((id) => ({ id, name: doc.levels[id].name }));
    const fileName = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
    const choice = await this.dialogs.open(ImportDxfDialog, { fileName, probe, levels, levelId: levelId && doc.levels[levelId] ? levelId : this.activeLevel(projectId, doc) });
    if (!choice) return;
    try {
      const result = await this.host.invoke<Imported>(
        'import.dxf',
        { path, levelId: choice.levelId, scale: choice.scale, origin: choice.origin, layerPrefix: choice.layerPrefix, ...(choice.allLayers ? {} : { layers: choice.layers }) },
        projectId,
      );
      // Show the level the drawing went to, so it is on screen.
      this.view.setActiveLevel(projectId, result.levelId);
      const { shapes, separators, labels, layers } = result.counts;
      // Only what the import does not support: `<TYPE> (degenerate)` and `<TYPE> (empty)` made nothing to skip.
      const skipped = Object.entries(result.skipped).reduce((n, [type, v]) => (/ \((degenerate|empty)\)$/.test(type) ? n : n + v), 0);
      this.toasts.notify(`Imported ${plural(shapes, 'shape')}, ${plural(separators, 'divider')} and ${plural(labels, 'label')} on ${plural(layers, 'layer')}${skipped ? ` (${skipped} skipped)` : ''}`, 'success');
    } catch (err) {
      this.toasts.error(err);
    }
  }

  private async pick(id: 'app.pickFile' | 'app.pickSavePath', options: Record<string, unknown>): Promise<string | null> {
    try {
      return (await this.host.invoke<{ path: string | null }>(id, options, null)).path;
    } catch (err) {
      this.toasts.error(err);
      return null;
    }
  }

  private async reveal(path: string): Promise<void> {
    try {
      await this.host.invoke('app.revealPath', { path }, null);
    } catch (err) {
      this.toasts.error(err);
    }
  }
}
