import { Component, ElementRef, afterRenderEffect, computed, effect, inject, linkedSignal, signal, untracked, viewChild } from '@angular/core';
import { FormField, form } from '@angular/forms/signals';
import { commandScore, type CommandMeta } from '@studio/core';
import { AppState, Autofocus, Button, Checkbox, HostBridge, Input, Kbd, Label, Select, TextArea, Toasts, UiActions } from '@studio/ui';
import { buildInput, formFields, initialValues, type FormFieldSpec } from './command-form';

interface PaletteItem {
  key: string;
  /** What the search matches against. */
  value: string;
  title: string;
  shortcut?: string;
  /** Shown on the right for host commands. */
  commandId?: string;
  run(): void;
}

interface PaletteGroup {
  heading: string;
  items: PaletteItem[];
}

/**
 * Ctrl+K: every UI action that applies, plus every non-hidden host command. Typing filters and ranks
 * them fuzzily; arrows (or Ctrl+N/P, Ctrl+J/K) move, Enter runs, Escape closes. A command that needs
 * input opens a small form generated from its schema.
 */
@Component({
  selector: 'x-command-palette',
  imports: [Autofocus, Button, Checkbox, FormField, Input, Kbd, Label, Select, TextArea],
  templateUrl: './command-palette.html',
  styleUrl: './command-palette.css',
  host: { class: 'contents' },
})
export class CommandPalette {
  private readonly app = inject(AppState);
  private readonly host = inject(HostBridge);
  private readonly toasts = inject(Toasts);
  private readonly actions = inject(UiActions);
  private readonly list = viewChild<ElementRef<HTMLDivElement>>('list');

  protected readonly open = this.app.paletteOpen;
  /** Starts empty every time the palette opens. */
  protected readonly search = linkedSignal({ source: this.open, computation: () => '' });

  /** The command whose input form is showing, with its fields. */
  protected readonly pending = signal<{ command: CommandMeta; fields: FormFieldSpec[] } | null>(null);
  protected readonly values = signal<Record<string, string>>({});
  protected readonly flags = signal<Record<string, boolean>>({});
  protected readonly valuesForm = form(this.values);
  protected readonly flagsForm = form(this.flags);
  protected readonly running = signal(false);

  private readonly groups = computed<PaletteGroup[]>(() => {
    if (!this.open()) return [];
    const actions = this.actions.actions();
    const byGroup = new Map<string, PaletteItem[]>();
    for (const a of actions.filter((x) => !x.when || x.when())) {
      const item: PaletteItem = {
        key: `action:${a.id}`,
        value: `${a.title} ${a.keywords?.join(' ') ?? ''} ${a.description ?? ''}`.trim(),
        title: a.title,
        shortcut: a.shortcut,
        run: () => void a.run(),
      };
      byGroup.set(a.group, [...(byGroup.get(a.group) ?? []), item]);
    }
    const groups = [...byGroup.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([heading, items]) => ({ heading, items }));
    // A UI action with the same id as a host command wraps it with proper feedback, so the raw command steps aside.
    const hasProject = this.app.hasProject();
    const commands = this.app.commands().filter((c) => !c.hidden && (c.scope === 'global' || hasProject) && !actions.some((a) => a.id === c.id));
    if (commands.length) {
      groups.push({
        heading: 'Commands',
        items: commands.map((c) => ({
          key: `command:${c.id}`,
          value: `${c.title} ${c.id} ${c.description}`.trim(),
          title: c.noInput ? c.title : `${c.title}…`,
          commandId: c.id,
          run: () => void this.runCommand(c),
        })),
      });
    }
    return groups;
  });

  /** What the search leaves: matches ranked by score within their group, groups by their best match. */
  protected readonly shown = computed<PaletteGroup[]>(() => {
    const search = this.search();
    if (!search) return this.groups();
    return this.groups()
      .map((group) => {
        const scored = group.items.map((item) => ({ item, score: commandScore(item.value, search) })).filter((s) => s.score > 0);
        scored.sort((a, b) => b.score - a.score);
        return { group: { heading: group.heading, items: scored.map((s) => s.item) }, best: scored[0]?.score ?? 0 };
      })
      .filter((g) => g.group.items.length > 0)
      .sort((a, b) => b.best - a.best)
      .map((g) => g.group);
  });

  private readonly flat = computed(() => this.shown().flatMap((g) => g.items));

  /** The highlighted entry: the first match after every keystroke, then wherever the keys or the pointer take it. */
  protected readonly selected = linkedSignal<{ search: string; keys: string[] }, string | undefined>({
    source: () => ({ search: this.search(), keys: this.flat().map((i) => i.key) }),
    computation: (source, previous) =>
      previous && previous.source.search === source.search && previous.value && source.keys.includes(previous.value) ? previous.value : source.keys[0],
  });

  constructor() {
    effect((onCleanup) => {
      if (!this.open()) {
        untracked(() => this.pending.set(null));
        return;
      }
      const onKey = (e: KeyboardEvent) => {
        if (e.key !== 'Escape') return;
        if (untracked(this.pending)) this.pending.set(null);
        else this.close();
      };
      window.addEventListener('keydown', onKey);
      onCleanup(() => window.removeEventListener('keydown', onKey));
    });

    afterRenderEffect({
      write: () => {
        const key = this.selected();
        const item = key ? this.list()?.nativeElement.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`) : null;
        if (!item) return;
        if (item.parentElement?.firstElementChild === item) item.closest('[data-group]')?.querySelector('[data-heading]')?.scrollIntoView({ block: 'nearest' });
        item.scrollIntoView({ block: 'nearest' });
      },
    });
  }

  protected close(): void {
    this.open.set(false);
  }

  protected typed(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  protected choose(item: PaletteItem): void {
    // Commands with input keep the palette open for their form.
    if (!item.commandId || this.app.commands().find((c) => c.id === item.commandId)?.noInput) this.close();
    item.run();
  }

  protected keydown(event: KeyboardEvent): void {
    if (this.pending() || event.defaultPrevented || event.isComposing) return;
    const vim = event.ctrlKey;
    switch (event.key) {
      case 'n':
      case 'j':
        if (vim) this.step(event, 1);
        break;
      case 'ArrowDown':
        this.step(event, 1);
        break;
      case 'p':
      case 'k':
        if (vim) this.step(event, -1);
        break;
      case 'ArrowUp':
        this.step(event, -1);
        break;
      case 'Enter': {
        event.preventDefault();
        const key = untracked(this.selected);
        const item = untracked(this.flat).find((i) => i.key === key);
        if (item) this.choose(item);
      }
    }
  }

  /** One entry up or down, wrapping around at either end. */
  private step(event: KeyboardEvent, by: 1 | -1): void {
    event.preventDefault();
    const items = untracked(this.flat);
    if (!items.length) return;
    const index = items.findIndex((i) => i.key === untracked(this.selected));
    this.selected.set(items[(index + by + items.length) % items.length].key);
  }

  private async runCommand(command: CommandMeta): Promise<void> {
    if (command.noInput) {
      await this.execute(command, {});
      return;
    }
    try {
      const schema = await this.host.invoke('command.schema', { id: command.id }, null);
      const fields = formFields(schema);
      const { values, flags } = initialValues(fields);
      this.values.set(values);
      this.flags.set(flags);
      this.pending.set({ command, fields });
    } catch (err) {
      this.toasts.error(err);
    }
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    const pending = untracked(this.pending);
    if (!pending || untracked(this.running)) return;
    let input: Record<string, unknown>;
    try {
      input = buildInput(pending.fields, untracked(this.values), untracked(this.flags));
    } catch (err) {
      this.toasts.error(err);
      return;
    }
    this.running.set(true);
    const ok = await this.execute(pending.command, input);
    this.running.set(false);
    if (ok) this.close();
  }

  protected back(): void {
    this.pending.set(null);
  }

  private async execute(command: CommandMeta, input: Record<string, unknown>): Promise<boolean> {
    try {
      const result = await this.host.invoke(command.id, input);
      const text = typeof result === 'string' ? result : JSON.stringify(result);
      this.toasts.notify(`${command.title}: ${text.length > 160 ? `${text.slice(0, 160)}…` : text}`, 'success');
      return true;
    } catch (err) {
      this.toasts.error(err);
      return false;
    }
  }
}
