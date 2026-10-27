import { Service, inject, untracked } from '@angular/core';
import type { ProjectDoc } from '@studio/core';
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
  /** The last answer of the Export dialog in this session, so a second export starts from it. */
  private last: ExportChoice | null = null;

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
    if (!doc) return;
    const projectName = untracked(this.projects.projects).find((p) => p.id === projectId)?.name ?? 'Project';
    const levelId = this.activeLevel(projectId, doc);
    const view3d = this.view3d(projectId, doc);
    const initial: ExportChoice = this.last ?? {
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
      theme: untracked(this.app.resolvedTheme),
      transparent: false,
    };
    const choice = await this.dialogs.open(ExportDialog, { projectName, levelName: doc.levels[levelId]?.name ?? '', levelCount: doc.building.stack.length, view3dSummary: view3d.summary, initial });
    if (!choice) return;
    this.last = choice;
    const format = FORMATS.find((f) => f.value === choice.format)!;
    const path = await this.pick('app.pickSavePath', { title: `Export ${format.label}`, defaultPath: `${fileSafe(projectName)}.${format.ext}`, filters: [{ name: format.filter, extensions: [format.ext] }] });
    if (!path) return;

    let id: string;
    let input: Record<string, unknown>;
    if (choice.format === 'glb') {
      id = 'export.building';
      input = { path, includeItems: choice.includeItems, includeFinishes: choice.includeFinishes };
    } else if (choice.format === 'png') {
      const [w, h] = choice.size === 'custom' ? [choice.width, choice.height] : choice.size.split('x').map(Number);
      id = 'export.image';
      input = { path, levelId, view: choice.view, width: w, height: h, theme: choice.theme, transparent: choice.transparent, ...(choice.view === '3d' ? view3d.input : {}) };
    } else {
      const fit = choice.scale === 'fit';
      id = 'export.plan';
      input = { path, format: choice.format, levelIds: choice.levels === 'current' ? [levelId] : doc.building.stack, scale: fit ? 100 : Number(choice.scale), fit, page: choice.page, orientation: choice.orientation };
    }
    try {
      const result = await this.host.invoke<Exported>(id, input, projectId);
      const files = result.files?.map((f) => f.path) ?? (result.path ? [result.path] : [path]);
      const cut = result.levels?.filter((l) => !l.fits) ?? [];
      const notice = cut.length ? `; ${cut.map((l) => l.name).join(', ')} ${cut.length === 1 ? 'does' : 'do'} not fit the sheet at 1:${cut[0].scale}` : '';
      this.toasts.notify(`Exported ${plural(files.length, 'file')} to ${folderOf(files[0])}${notice}`, 'success', { label: 'Show', run: () => void this.reveal(files[0]) });
    } catch (err) {
      this.toasts.error(err);
    }
  }

  async importDxf(projectId: string): Promise<void> {
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
    const choice = await this.dialogs.open(ImportDxfDialog, { fileName, probe, levels, levelId: this.activeLevel(projectId, doc) });
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
      const skipped = Object.values(result.skipped).reduce((n, v) => n + v, 0);
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
