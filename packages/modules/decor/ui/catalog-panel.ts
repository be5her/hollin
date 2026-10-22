import { Component, computed, inject, input, signal } from '@angular/core';
import { searchCatalog, type CatalogEntry } from '@studio/core';
import { Button, ContextMenu, Dialogs, HostBridge, Icon, Input, ProjectDocs, Segment, Segmented, Toasts, Units, invokeResource } from '@studio/ui';
import { Import, Lamp, Search } from 'lucide';
import { PlanTools } from '../../plan/ui/plan-tools';
import { CatalogThumbnails } from './catalog-thumbnails';

type Tab = 'item' | 'material';

const CATEGORY_NAMES: Record<string, string> = { living: 'Living', dining: 'Dining', bedroom: 'Bedroom', kitchen: 'Kitchen', bathroom: 'Bathroom', office: 'Office', lighting: 'Lighting', outdoor: 'Outdoor', imported: 'Imported', paint: 'Paint', wood: 'Wood', tile: 'Tile', stone: 'Stone', concrete: 'Concrete', carpet: 'Carpet', brick: 'Brick', fabric: 'Fabric', metal: 'Metal', glass: 'Glass', ceramic: 'Ceramic', nature: 'Nature' };

/**
 * The catalog in the project tab's right column: furniture (built-in, imported into the library,
 * or only in this project) and materials, with search, category chips and pictures. A click on a
 * model arms the plan's Furniture tool with it; Import… adds a model file to the library; a right
 * click on an imported model removes it from the catalog.
 */
@Component({
  selector: 'x-catalog-panel',
  imports: [Button, Icon, Input, Segment, Segmented],
  template: `
    <x-segmented [(value)]="tab" class="px-2 shrink-0">
      <button xSegment="item" data-testid="catalog-tab-item">Furniture</button>
      <button xSegment="material" data-testid="catalog-tab-material">Materials</button>
    </x-segmented>
    <div class="flex items-center gap-1.5 px-3 pt-2.5 shrink-0">
      <div class="relative flex-1 min-w-0">
        <svg [xIcon]="icons.Search" class="size-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted pointer-events-none"></svg>
        <input xInput class="h-7 text-xs pl-7" placeholder="Search" [value]="query()" (input)="query.set($any($event.target).value)" aria-label="Search the catalog" data-testid="catalog-search" />
      </div>
      @if (tab() === 'item') {
        <button xButton size="sm" [icon]="icons.Import" (click)="importModel()" data-testid="catalog-import">Import…</button>
      }
    </div>
    <div class="flex flex-wrap gap-1 px-3 pt-2 shrink-0" role="toolbar" aria-label="Categories">
      <button type="button" class="chip" [class.chip-on]="!category()" (click)="category.set(null)" data-testid="catalog-category">All</button>
      @for (c of categories(); track c) {
        <button type="button" class="chip" [class.chip-on]="category() === c" (click)="category.set(category() === c ? null : c)" data-testid="catalog-category" [attr.data-category]="c">{{ categoryName(c) }}</button>
      }
    </div>
    @let list = shown();
    @if (!list.length) {
      <div class="px-4 py-8 text-center text-xs text-muted" data-testid="catalog-empty">Nothing matches.</div>
    }
    <ul class="grid grid-cols-2 gap-2 p-3 overflow-y-auto min-h-0" data-testid="catalog-grid">
      @for (e of list; track e.ref) {
        <li>
          <button type="button" class="w-full flex flex-col rounded-md border bg-canvas text-left overflow-hidden transition-colors hover:border-accent" [class.border-accent]="armedRef() === e.ref" [class.border-edge]="armedRef() !== e.ref" [title]="tooltip(e)" (click)="pick(e)" (contextmenu)="menu($event, e)" data-testid="catalog-card" [attr.data-ref]="e.ref" [attr.data-source]="e.source">
            <span class="aspect-square w-full flex items-center justify-center bg-surface">
              @if (thumb(e); as url) {
                <img [src]="url" alt="" class="size-full object-contain" [class.p-1]="e.kind === 'item'" draggable="false" />
              } @else {
                <span class="text-[10px] text-muted">{{ e.kind === 'item' ? 'No picture yet' : '' }}</span>
              }
            </span>
            <span class="px-2 pt-1 text-xs leading-tight line-clamp-2 flex items-center gap-1">
              @if (e.lamp) {
                <svg [xIcon]="icons.Lamp" class="size-3 shrink-0 text-muted"></svg>
              }
              {{ e.name }}
            </span>
            <span class="px-2 pb-1.5 text-[10px] text-muted font-mono truncate">{{ caption(e) }}</span>
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

  protected categoryName(c: string): string {
    return CATEGORY_NAMES[c] ?? c;
  }

  protected thumb(e: CatalogEntry): string | null {
    return this.thumbnails.url(e);
  }

  protected caption(e: CatalogEntry): string {
    if (e.kind === 'item' && e.size) return `${this.units.length(e.size[0])} × ${this.units.length(e.size[1])}`;
    return this.categoryName(e.category);
  }

  protected tooltip(e: CatalogEntry): string {
    const size = e.size ? ` · ${this.units.length(e.size[0])} × ${this.units.length(e.size[1])} × ${this.units.length(e.size[2])}` : '';
    return `${e.name}${size}${e.source === 'library' ? ' · imported' : e.source === 'project' ? ' · in this project only' : ''}`;
  }

  /** A model arms the plan's Furniture tool; a material arms painting (the plan's Paint tool, and clicks in 3D). */
  protected pick(e: CatalogEntry): void {
    if (e.kind === 'material') this.tools.armPaint(this.projectId(), { ref: e.ref, name: e.name });
    else if (e.kind === 'item') this.tools.armItem(this.projectId(), { ref: e.ref, name: e.name, size: e.size, ...(e.lamp ? { lamp: true } : {}) });
  }

  protected menu(event: MouseEvent, e: CatalogEntry): void {
    if (e.source !== 'library') return;
    this.contextMenu.open(event, [{ label: 'Remove from the catalog', danger: true, testId: 'catalog-remove', select: () => void this.remove(e) }]);
  }

  private async remove(e: CatalogEntry): Promise<void> {
    const ok = await this.dialogs.confirm({ title: `Remove "${e.name}" from the catalog?`, message: 'Projects that use it keep their own copy.', danger: true, confirmLabel: 'Remove' });
    if (!ok) return;
    try {
      await this.host.invoke('catalog.remove', { ref: e.ref }, null);
      this.toasts.notify(`Removed "${e.name}"`, 'success');
    } catch (err) {
      this.toasts.error(err);
    }
  }

  protected async importModel(): Promise<void> {
    try {
      const picked = await this.host.invoke<{ path: string | null }>('app.pickFile', { title: 'Import a model', filters: [{ name: 'glTF model', extensions: ['glb', 'gltf'] }] }, null);
      if (!picked.path) return;
      const entry = await this.host.invoke<CatalogEntry & { added: boolean }>('catalog.import', { path: picked.path }, null);
      this.tab.set('item');
      this.category.set(null);
      this.toasts.notify(entry.added ? `Imported "${entry.name}"` : `"${entry.name}" is already in the catalog`, 'success');
    } catch (err) {
      this.toasts.error(err);
    }
  }
}
