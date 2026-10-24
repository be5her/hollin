import { Component, ElementRef, afterRenderEffect, computed, inject, untracked, viewChild } from '@angular/core';
import { BRANDING } from '@studio/core';
import { AppState, ContextMenu, DropMarker, HostBridge, Icon, Kbd, TabsState, dragReorder, type Tab } from '@studio/ui';
import { House, Search, Settings, X } from 'lucide';
import { ShellActions } from '../shell-actions';

/**
 * The window's title bar: the app name, the document tabs (Home, projects, Settings; drag to reorder,
 * middle-click or Ctrl+W to close, right-click for more), the palette and the Settings gear. The OS draws its window
 * buttons over the right end (left on macOS), so those areas stay empty.
 */
@Component({
  selector: 'header[xTitleBar]',
  imports: [DropMarker, Icon, Kbd],
  templateUrl: './title-bar.html',
  host: {
    class: 'app-drag flex items-stretch h-10 border-b border-edge shrink-0 select-none',
    style: 'background: var(--titlebar); color: var(--titlebar-fg)',
  },
})
export class TitleBar {
  private readonly app = inject(AppState);
  private readonly tabsState = inject(TabsState);
  private readonly contextMenu = inject(ContextMenu);
  protected readonly host = inject(HostBridge);
  protected readonly shell = inject(ShellActions);
  private readonly strip = viewChild<ElementRef<HTMLDivElement>>('strip');

  protected readonly productName = BRANDING.productName;
  protected readonly icons = { House, Search, Settings, X };
  protected readonly tabs = this.tabsState.tabs;
  protected readonly activeId = this.tabsState.activeTabId;
  protected readonly reorder = dragReorder(
    'x',
    () => this.strip()?.nativeElement,
    (id, to) => {
      this.tabsState.move(id, to);
      this.tabsState.activate(id);
    },
  );
  /** Changes when another tab becomes active or the number of tabs changes. */
  private readonly activeSpot = computed(() => `${this.activeId()}:${this.tabs().length}`);

  constructor() {
    afterRenderEffect({
      write: () => {
        const [id] = this.activeSpot().split(':');
        this.strip()?.nativeElement.querySelector<HTMLElement>(`[data-drag-id="${id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      },
    });
  }

  protected activate(tab: Tab): void {
    if (!this.reorder.suppressClick()) this.tabsState.activate(tab.id);
  }

  protected close(event: MouseEvent, tab: Tab): void {
    event.stopPropagation();
    void this.shell.closeTabs([tab.id]);
  }

  /** The middle button would start autoscroll on the strip instead of reaching `auxclick`. */
  protected mouseDown(event: MouseEvent): void {
    if (event.button === 1) event.preventDefault();
  }

  protected auxClick(event: MouseEvent, tab: Tab): void {
    if (event.button === 1) void this.shell.closeTabs([tab.id]);
  }

  /** The strip has no scrollbar; the wheel scrolls it sideways. */
  protected wheel(event: WheelEvent): void {
    if (event.deltaY && !event.deltaX) (event.currentTarget as HTMLElement).scrollLeft += event.deltaY;
  }

  protected openPalette(): void {
    this.app.paletteOpen.set(true);
  }

  protected showMenu(event: MouseEvent, tab: Tab): void {
    const tabs = untracked(this.tabs);
    const index = tabs.findIndex((t) => t.id === tab.id);
    const others = tabs.filter((t) => t.id !== tab.id && !t.pinned).map((t) => t.id);
    const right = tabs.slice(index + 1).filter((t) => !t.pinned).map((t) => t.id);
    this.contextMenu.open(event, [
      { label: 'Close', shortcut: 'Ctrl+W', select: () => void this.shell.closeTabs([tab.id]), disabled: tab.pinned, testId: 'tab-menu-close' },
      { label: 'Close Others', select: () => void this.shell.closeTabs(others), disabled: others.length === 0, testId: 'tab-menu-close-others' },
      { label: 'Close to the Right', select: () => void this.shell.closeTabs(right), disabled: right.length === 0, testId: 'tab-menu-close-right' },
    ]);
  }
}
