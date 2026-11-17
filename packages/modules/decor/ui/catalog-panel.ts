import { Component, computed, inject, input, signal } from '@angular/core';
import { searchCatalog, type CatalogEntry } from '@studio/core';
import { Button, ContextMenu, Dialogs, HostBridge, I18n, Icon, Input, ProjectDocs, Segment, Segmented, Toasts, Units, invokeResource } from '@studio/ui';
import { Import, Lamp, Search } from 'lucide';
import { PlanTools } from '../../plan/ui/plan-tools';
import { CatalogThumbnails } from './catalog-thumbnails';

type Tab = 'item' | 'material';

/**
 * The catalog in the project tab's right column: furniture (built-in, imported into the library,
 * or only in this project) and materials, with search, category chips and pictures. A click on a
 * model arms the plan's Furniture tool with it; Import… adds a model file to the library; a right
 * click on an imported model removes it from the catalog. Built-ins and categories show by their
 * names in the interface's language (`builtin.<id>`, `decor.category.<id>`), and a search matches
 * them in every language (`searchCatalog`).
 */
@Component({
  selector: 'x-catalog-panel',
  imports: [Button, Icon, Input, Segment, Segmented],
  template: `
    <x-segmented [(value)]="tab" class="px-2 shrink-0">
      <button xSegment="item" data-testid="catalog-tab-item">{{ t('decor.tab.item') }}</button>
      <button xSegment="material" data-testid="catalog-tab-material">{{ t('decor.tab.material') }}</button>
    </x-segmented>
    <div class="flex items-center gap-1.5 px-3 pt-2.5 shrink-0">
      <div class="relative flex-1 min-w-0">
        <svg [xIcon]="icons.Search" class="size-3.5 absolute start-2 top-1/2 -translate-y-1/2 text-muted pointer-events-none"></svg>
        <input xInput class="h-7 text-xs ps-7" dir="auto" [placeholder]="t('decor.search')" [value]="query()" (input)="query.set($any($event.target).value)" [attr.aria-label]="t('decor.searchLabel')" data-testid="catalog-search" />
      </div>
      @if (tab() === 'item') {
        <button xButton size="sm" [icon]="icons.Import" (click)="importModel()" data-testid="catalog-import">{{ t('decor.import') }}</button>
      }
    </div>
    <div class="flex flex-wrap gap-1 px-3 pt-2 shrink-0" role="toolbar" [attr.aria-label]="t('decor.categories')">
      <button type="button" class="chip" [class.chip-on]="!category()" (click)="category.set(null)" data-testid="catalog-category">{{ t('decor.category.all') }}</button>
      @for (c of categories(); track c) {
        <button type="button" class="chip" [class.chip-on]="category() === c" (click)="category.set(category() === c ? null : c)" data-testid="catalog-category" [attr.data-category]="c">{{ i18n.categoryName(c) }}</button>
      }
    </div>
    @let list = shown();
    @if (!list.length) {
      <div class="px-4 py-8 text-center text-xs text-muted" data-testid="catalog-empty">{{ t('decor.empty') }}</div>
    }
    <ul class="grid grid-cols-2 gap-2 p-3 overflow-y-auto min-h-0" data-testid="catalog-grid">
      @for (e of list; track e.ref) {
        <li>
          <button type="button" class="w-full flex flex-col rounded-md border bg-canvas text-start overflow-hidden transition-colors hover:border-accent" [class.border-accent]="armedRef() === e.ref" [class.border-edge]="armedRef() !== e.ref" [title]="tooltip(e)" (click)="pick(e)" (contextmenu)="menu($event, e)" data-testid="catalog-card" [attr.data-ref]="e.ref" [attr.data-source]="e.source">
            <span class="aspect-square w-full flex items-center justify-center bg-surface">
              @if (thumb(e); as url) {
                <img [src]="url" alt="" class="size-full object-contain" [class.p-1]="e.kind === 'item'" draggable="false" />
              } @else if (e.kind === 'item') {
                <span class="text-[10px] text-muted">{{ t('decor.noPicture') }}</span>
              }
            </span>
            <span class="px-2 pt-1 text-xs leading-tight line-clamp-2 flex items-center gap-1" dir="auto" data-testid="catalog-card-name">
              @if (e.lamp) {
                <svg [xIcon]="icons.Lamp" class="size-3 shrink-0 text-muted"></svg>
              }
              {{ name(e) }}
            </span>
            <span class="px-2 pb-1.5 text-[10px] text-muted font-mono truncate" dir="auto" data-testid="catalog-card-caption">{{ caption(e) }}</span>
          </button>
        </li>
      }
    </ul>
  `,
  styles: `
    .chip { height: 1.375rem; padding: 0 0.5rem; border-radius: 999px; border: 1px solid var(--edge); font-size: 11px; color: var(--muted); }
    .chip:hover { color: var(--fg); }
    .chip-on { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
    .chip-on:hover { color: var(--accent-fg); }
  `,
  host: { class: 'flex flex-col min-h-0 h-full', 'data-testid': 'catalog-panel' },
})
export class CatalogPanel {
  private readonly host = inject(HostBridge);
  private readonly docs = inject(ProjectDocs);
  private readonly toasts = inject(Toasts);
  private readonly dialogs = inject(Dialogs);
  private readonly contextMenu = inject(ContextMenu);
  private readonly tools = inject(PlanTools);
  private readonly thumbnails = inject(CatalogThumbnails);
  private readonly units = inject(Units);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;

  readonly projectId = input.required<string>();

  protected readonly icons = { Import, Lamp, Search };
  protected readonly tab = signal<Tab>('item');
  protected readonly query = signal('');
  protected readonly category = signal<string | null>(null);
  /** The project's registered models, so a model placed from another machine's catalog shows up. */
  private readonly assetCount = computed(() => Object.keys(this.docs.read(this.projectId())?.doc.assets ?? {}).length);
  private readonly entries = invokeResource<CatalogEntry[]>('catalog.search', () => ({ kind: this.tab(), limit: 500, assets: this.assetCount() }), { projectId: () => this.projectId(), refreshOnEvents: ['catalog.changed'] });
  protected readonly armedRef = computed(() => (this.tab() === 'material' ? (this.tools.armedPaint(this.projectId())()?.ref ?? null) : (this.tools.armedItem(this.projectId())()?.item.ref ?? null)));

  protected readonly categories = computed(() => [...new Set((this.entries.value() ?? []).filter((e) => e.kind === this.tab()).map((e) => e.category))]);
  protected readonly shown = computed(() => {
    const category = this.category();
    const list = (this.entries.value() ?? []).filter((e) => e.kind === this.tab() && (!category || e.category === category));
    return searchCatalog(list, this.query());
  });

  /** An entry's name in the interface's language: a built-in's from the catalog, an imported model's as it is. */
  protected name(e: CatalogEntry): string {
    return this.i18n.catalogName(e.ref, e.name);
  }

  protected thumb(e: CatalogEntry): string | null {
    return this.thumbnails.url(e);
  }

  protected caption(e: CatalogEntry): string {
    const len = (mm: number) => this.units.length(mm);
    if (e.kind === 'item' && e.size) return this.t('decor.size2', { w: len(e.size[0]), d: len(e.size[1]) });
    return this.i18n.categoryName(e.category);
  }

  protected tooltip(e: CatalogEntry): string {
    const len = (mm: number) => this.units.length(mm);
    const text = e.size ? this.t('decor.tooltip', { name: this.name(e), size: this.t('decor.size3', { w: len(e.size[0]), d: len(e.size[1]), h: len(e.size[2]) }) }) : this.name(e);
    return e.source === 'library' ? this.t('decor.tooltip.imported', { text }) : e.source === 'project' ? this.t('decor.tooltip.projectOnly', { text }) : text;
  }

  /** A model arms the plan's Furniture tool; a material arms painting (the plan's Paint tool, and clicks in 3D). */
  protected pick(e: CatalogEntry): void {
    if (e.kind === 'material') this.tools.armPaint(this.projectId(), { ref: e.ref, name: e.name });
    else if (e.kind === 'item') this.tools.armItem(this.projectId(), { ref: e.ref, name: e.name, size: e.size, ...(e.lamp ? { lamp: true } : {}) });
  }

  protected menu(event: MouseEvent, e: CatalogEntry): void {
    if (e.source !== 'library') return;
    this.contextMenu.open(event, [{ label: this.t('decor.menu.remove'), danger: true, testId: 'catalog-remove', select: () => void this.remove(e) }]);
  }

  private async remove(e: CatalogEntry): Promise<void> {
    const ok = await this.dialogs.confirm({ title: this.t('decor.remove.title', { name: e.name }), message: this.t('decor.remove.message'), danger: true, confirmLabel: this.t('decor.remove.confirm') });
    if (!ok) return;
    try {
      await this.host.invoke('catalog.remove', { ref: e.ref }, null);
      this.toasts.notify(this.t('decor.removed', { name: e.name }), 'success');
    } catch (err) {
      this.toasts.error(err);
    }
  }

  protected async importModel(): Promise<void> {
    try {
      const picked = await this.host.invoke<{ path: string | null }>('app.pickFile', { title: this.t('decor.pick.title'), filters: [{ name: this.t('decor.pick.filter'), extensions: ['glb', 'gltf'] }] }, null);
      if (!picked.path) return;
      const entry = await this.host.invoke<CatalogEntry & { added: boolean }>('catalog.import', { path: picked.path }, null);
      this.tab.set('item');
      this.category.set(null);
      this.toasts.notify(this.t(entry.added ? 'decor.imported' : 'decor.already', { name: entry.name }), 'success');
    } catch (err) {
      this.toasts.error(err);
    }
  }
}
