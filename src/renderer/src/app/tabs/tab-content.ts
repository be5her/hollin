import { NgComponentOutlet } from '@angular/common';
import { Component, inject } from '@angular/core';
import { TabsState } from '@studio/ui';
import { resolveTabComponent } from '../modules';

/**
 * Every open tab stays rendered (hidden when inactive), so editors, views and scroll positions
 * survive switching without reloading.
 */
@Component({
  selector: 'x-tab-content',
  imports: [NgComponentOutlet],
  template: `
    @for (tab of tabs.tabs(); track tab.id) {
      <div [class]="tab.id === tabs.activeTabId() ? 'absolute inset-0 flex flex-col' : 'hidden'" [attr.data-tab-type]="tab.type" [attr.data-tab-id]="tab.id">
        @if (component(tab.type); as tabComponent) {
          <ng-container *ngComponentOutlet="tabComponent; inputs: { tab }" />
        } @else {
          <div class="p-4 text-sm text-muted">No view for tab type "{{ tab.type }}".</div>
        }
      </div>
    }
  `,
  host: { class: 'contents' },
})
export class TabContent {
  protected readonly tabs = inject(TabsState);
  protected readonly component = resolveTabComponent;
}
