import { Component, computed, inject, input } from '@angular/core';
import type { Author, HistoryInfo } from '@studio/core';
import { Button, Icon, invokeResource, relativeTime } from '@studio/ui';
import { Bot, Redo2, Sparkles, Undo2, User } from 'lucide';
import { EditActions } from './edit-actions';

interface History {
  undo: HistoryInfo[];
  redo: HistoryInfo[];
  seq: number;
}

/** Every change that can be undone, newest first, with who made it; then what can be redone. */
@Component({
  selector: 'x-history-panel',
  imports: [Button, Icon],
  template: `
    <div class="flex items-center gap-1.5 px-3 py-2 border-b border-edge">
      <button xButton size="sm" [icon]="icons.Undo2" [disabled]="!history.value()?.undo?.length" (click)="actions.undo(projectId())" data-testid="history-undo">Undo</button>
      <button xButton size="sm" [icon]="icons.Redo2" [disabled]="!history.value()?.redo?.length" (click)="actions.redo(projectId())" data-testid="history-redo">Redo</button>
    </div>
    <ol class="flex flex-col py-1 text-xs" data-testid="history-list">
      @for (entry of redo(); track entry.id) {
        <li class="flex items-center gap-2 px-3 py-1.5 text-muted/70 line-through decoration-muted/40" data-testid="history-redo-item">
          <svg [xIcon]="iconFor(entry.author)" class="size-3.5 shrink-0"></svg>
          <span class="flex-1 truncate">{{ entry.label }}</span>
        </li>
      }
      @for (entry of history.value()?.undo ?? []; track entry.id; let first = $first) {
        <li class="flex items-center gap-2 px-3 py-1.5" [class.bg-elevated]="first" data-testid="history-item" [attr.data-label]="entry.label" [attr.data-author]="authorName(entry.author)">
          <svg [xIcon]="iconFor(entry.author)" class="size-3.5 shrink-0" [class]="entry.author.kind === 'user' ? 'text-muted' : 'text-accent'"></svg>
          <span class="flex-1 min-w-0">
            <span class="block truncate">{{ entry.label }}</span>
            <span class="block text-[10px] text-muted truncate">{{ authorName(entry.author) }} · {{ ago(entry.at) }}</span>
          </span>
        </li>
      } @empty {
        @if (!redo().length) {
          <li class="px-3 py-2 text-muted">No changes yet. Everything you or an agent change appears here and can be undone.</li>
        }
      }
    </ol>
  `,
  host: { class: 'flex flex-col', 'data-testid': 'history-panel' },
})
export class HistoryPanel {
  protected readonly actions = inject(EditActions);

  readonly projectId = input.required<string>();

  protected readonly icons = { Redo2, Undo2 };
  protected readonly history = invokeResource<History>('edit.history', () => ({}), { projectId: () => this.projectId(), refreshOnEvents: ['doc.patched'] });
  protected readonly redo = computed(() => [...(this.history.value()?.redo ?? [])].reverse());

  protected iconFor(author: Author) {
    return author.kind === 'user' ? User : author.kind === 'assistant' ? Sparkles : Bot;
  }

  protected authorName(author: Author): string {
    return author.kind === 'user' ? 'You' : author.kind === 'assistant' ? `Assistant (${author.name})` : `via MCP: ${author.name}`;
  }

  protected ago(iso: string): string {
    return relativeTime(iso);
  }
}
