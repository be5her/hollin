import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input } from '@angular/core';
import type { Author, HistoryInfo } from '@studio/core';
import { AppState, Button, OttoMark, invokeResource, relativeTime } from '@studio/ui';
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
 * Then what can be redone.
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
          class="relative grid grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2.5 px-3 py-[7px] min-h-[38px]"
          [class.bg-ai-tint]="entry.author.kind === 'assistant'"
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

  readonly projectId = input.required<string>();

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

  protected ago(iso: string): string {
    return relativeTime(iso);
  }
}
