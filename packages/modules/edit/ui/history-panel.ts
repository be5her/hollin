import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input, untracked } from '@angular/core';
import type { Author, HistoryInfo } from '@studio/core';
import { AppState, Button, HostBridge, OttoMark, ProjectDocs, ProjectView, Toasts, invokeResource, relativeTime } from '@studio/ui';
import { PlanSelection } from '../../plan/ui/plan-selection';
import { Redo2, Undo2 } from 'lucide';
import { EditActions } from './edit-actions';

interface History {
  undo: HistoryInfo[];
  redo: HistoryInfo[];
  seq: number;
}

/**
 * Every change that can be undone, newest first, signed by who made it (`03-otto.md` §d): yours with a
 * graphite dot, Otto's on its tint with its mark, an MCP agent's with a hollow ring; the newest (what
 * Ctrl+Z takes) with a terracotta bar. A destructive call Otto is waiting on sits greyed at the top.
 * Then what can be redone. Clicking a row selects what it changed on the plan (switching to its level first,
 * through `PlanSelection.request`, as the Warnings panel does); double-clicking undoes down to that entry,
 * one undo at a time with `ifTop`, so redo brings it all back and nothing newer than the list is undone.
 */
@Component({
  selector: 'x-history-panel',
  imports: [Button, NgTemplateOutlet, OttoMark],
  template: `
    <div class="flex items-center gap-1.5 h-10 px-3 border-b border-edge">
      <button xButton size="sm" [icon]="icons.Undo2" [disabled]="!history.value()?.undo?.length" (click)="actions.undo(projectId())" data-testid="history-undo">Undo</button>
      <button xButton size="sm" [icon]="icons.Redo2" [disabled]="!history.value()?.redo?.length" (click)="actions.redo(projectId())" data-testid="history-redo">Redo</button>
    </div>
    <ol class="flex flex-col py-1" data-testid="history-list">
      @for (entry of redo(); track entry.id) {
        <li class="grid grid-cols-[16px_minmax(0,1fr)] items-center gap-2.5 px-3 py-[7px] min-h-[38px] text-muted opacity-70 line-through" data-testid="history-redo-item">
          <ng-container *ngTemplateOutlet="glyph; context: { $implicit: entry.author }" />
          <span class="truncate text-[13px] leading-[18px]">{{ entry.label }}</span>
        </li>
      }
      @if (pending(); as wait) {
        <li class="grid grid-cols-[16px_minmax(0,1fr)] items-center gap-2.5 px-3 py-[7px] min-h-[38px] bg-ai-tint opacity-45" data-testid="history-waiting" [attr.data-command]="wait.command">
          <x-otto-mark size="16" />
          <span class="min-w-0">
            <span class="block truncate text-[13px] leading-[18px] text-fg">{{ wait.title }}</span>
            <span class="block truncate text-[11px] leading-[14px] italic text-fg/70">Otto · waiting for your yes</span>
          </span>
        </li>
      }
      @for (entry of history.value()?.undo ?? []; track entry.id; let first = $first) {
        <li
          class="relative grid grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2.5 px-3 py-[7px] min-h-[38px] cursor-default select-none focus:outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
          [class]="entry.author.kind === 'assistant' ? 'bg-ai-tint hover:bg-[color-mix(in_srgb,var(--ai-tint)_50%,var(--elevated))]' : 'hover:bg-elevated'"
          tabindex="0"
          [attr.aria-label]="entry.label + ', ' + signature(entry) + '. Enter selects it on the plan, double-click undoes down to it.'"
          [title]="'Click to select what it changed; double-click to undo down to here'"
          (click)="select(entry)"
          (keydown.enter)="select(entry)"
          (dblclick)="undoTo(entry)"
          [attr.data-kind]="entry.author.kind"
          [attr.data-newest]="first ? 'true' : null"
          data-testid="history-item"
          [attr.data-label]="entry.label"
          [attr.data-author]="authorName(entry.author)"
        >
          @if (first) {
            <span class="absolute left-0 inset-y-0 w-0.5 bg-accent" aria-hidden="true" data-testid="history-newest-bar"></span>
          }
          <ng-container *ngTemplateOutlet="glyph; context: { $implicit: entry.author }" />
          <span class="min-w-0">
            <span class="block truncate text-[13px] leading-[18px] text-fg" [class.font-medium]="first">{{ entry.label }}</span>
            <span class="block truncate text-[11px] leading-[14px]" [class]="entry.author.kind === 'assistant' ? 'text-fg/70' : 'text-muted'" data-testid="history-signature">{{ signature(entry) }}</span>
          </span>
          <span class="text-[11px] italic whitespace-nowrap" [class]="entry.author.kind === 'assistant' ? 'text-fg/70' : 'text-muted'">{{ ago(entry.at) }}</span>
        </li>
      } @empty {
        @if (!redo().length && !pending()) {
          <li class="px-3 py-2 text-[13px] leading-[18px] text-muted">No changes yet. Everything you, Otto or an agent change appears here and can be undone.</li>
        }
      }
    </ol>

    <ng-template #glyph let-author>
      <span class="flex items-center justify-center size-4" [attr.data-glyph]="author.kind">
        @switch (author.kind) {
          @case ('assistant') {
            <x-otto-mark size="16" />
          }
          @case ('mcp') {
            <span class="size-1.5 rounded-full border-[1.5px] border-muted box-content"></span>
          }
          @default {
            <span class="size-1.5 rounded-full bg-muted"></span>
          }
        }
      </span>
    </ng-template>
  `,
  host: { class: 'flex flex-col', 'data-testid': 'history-panel' },
})
export class HistoryPanel {
  protected readonly actions = inject(EditActions);
  private readonly app = inject(AppState);
  private readonly host = inject(HostBridge);
  private readonly docs = inject(ProjectDocs);
  private readonly view = inject(ProjectView);
  private readonly selection = inject(PlanSelection);
  private readonly toasts = inject(Toasts);

  readonly projectId = input.required<string>();
  private readonly activeLevel = this.view.activeLevel(this.projectId, computed(() => this.docs.read(this.projectId())?.doc));
  private undoing = false;

  protected readonly icons = { Redo2, Undo2 };
  protected readonly history = invokeResource<History>('edit.history', () => ({}), { projectId: () => this.projectId(), refreshOnEvents: ['doc.patched'] });
  protected readonly redo = computed(() => [...(this.history.value()?.redo ?? [])].reverse());
  /** The destructive call Otto is waiting on in this project, from the assistant's presence. */
  protected readonly pending = computed(() => {
    const otto = this.app.assistant();
    return otto?.projectId === this.projectId() ? otto.pending : null;
  });

  /** Who made the change, as History names them: "You", "Otto", or "MCP · <client>". */
  protected authorName(author: Author): string {
    return author.kind === 'user' ? 'You' : author.kind === 'assistant' ? 'Otto' : `MCP · ${author.name}`;
  }

  /** The meta line: author · layer · command id, as far as the entry carries them. */
  protected signature(entry: HistoryInfo): string {
    const parts = [this.authorName(entry.author)];
    if (entry.layer) parts.push(entry.layer);
    if (entry.command && entry.author.kind !== 'user') parts.push(entry.command);
    return parts.join(' · ');
  }

  /** Selects on the plan what the entry added or changed, on its level (the one on screen when it touched connectors only). */
  protected async select(entry: HistoryInfo): Promise<void> {
    const projectId = this.projectId();
    try {
      const changed = await this.host.invoke<{ levelId: string | null; ids: string[] }>('edit.history.changed', { id: entry.id }, projectId);
      const levelId = changed.levelId ?? untracked(this.activeLevel);
      if (!levelId || !changed.ids.length) return;
      this.view.setActiveLevel(projectId, levelId);
      this.selection.request(projectId, { levelId, ids: changed.ids });
    } catch {
      // The entry left the history meanwhile (an undo elsewhere): nothing to select.
    }
  }

  /** Undoes every change down to and including `entry`, newest first, each only while it is still the newest. */
  protected async undoTo(entry: HistoryInfo): Promise<void> {
    if (this.undoing) return;
    const list = untracked(this.history.value)?.undo ?? [];
    const index = list.findIndex((e) => e.id === entry.id);
    if (index < 0) return;
    this.undoing = true;
    try {
      for (const e of list.slice(0, index + 1)) await this.host.invoke('edit.undo', { ifTop: e.id }, this.projectId());
    } catch (err) {
      this.toasts.error(err);
    } finally {
      this.undoing = false;
    }
  }

  protected ago(iso: string): string {
    return relativeTime(iso);
  }
}
