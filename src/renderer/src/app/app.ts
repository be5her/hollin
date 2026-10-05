import { Component, inject } from '@angular/core';
import { AppState, ContextMenuHost, DialogHost, ToastHost } from '@studio/ui';
import { ActivityBar } from './activity-bar/activity-bar';
import { CommandPalette } from './command-palette/command-palette';
import { ShellActions } from './shell-actions';
import { Sidebar } from './sidebar/sidebar';
import { StatusBar } from './status-bar/status-bar';
import { TabContent } from './tabs/tab-content';
import { TitleBar } from './title-bar/title-bar';

/** The frame around the modules: title bar with the document tabs, activity bar, sidebar, status bar, and the overlays. */
@Component({
  selector: 'x-root',
  imports: [ActivityBar, CommandPalette, ContextMenuHost, DialogHost, Sidebar, StatusBar, TabContent, TitleBar, ToastHost],
  template: `
    @if (ready()) {
      <div class="flex flex-col h-full bg-canvas text-fg" data-testid="app-ready">
        <header xTitleBar></header>
        <div class="flex flex-1 min-h-0">
          <nav xActivityBar></nav>
          <aside xSidebar></aside>
          <main class="relative flex flex-col flex-1 min-w-0 min-h-0">
            <x-tab-content />
          </main>
        </div>
        <footer xStatusBar></footer>
        <x-command-palette />
        <x-context-menu-host />
        <x-dialog-host />
        <x-toast-host />
      </div>
    } @else {
      <div class="h-full bg-canvas"></div>
    }
  `,
  host: { '(window:keydown)': 'shortcut($event)' },
})
export class App {
  private readonly shell = inject(ShellActions);
  protected readonly ready = inject(AppState).ready;

  protected shortcut(event: KeyboardEvent): void {
    this.shell.handleShortcut(event);
  }
}
