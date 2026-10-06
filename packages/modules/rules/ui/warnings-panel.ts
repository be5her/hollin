import { Component, computed, inject, input } from '@angular/core';
import { deriveLevels, type Warning } from '@studio/core';
import { Icon, ProjectDocs, ProjectView, invokeResource } from '@studio/ui';
import { CircleAlert, ShieldCheck, TriangleAlert } from 'lucide';
import { PlanSelection } from '../../plan/ui/plan-selection';

interface Result {
  warnings: Warning[];
  count: number;
  byLevel: Record<string, number>;
}

/** The warnings the design raises, grouped by level; a click shows the level and selects what the warning is about. */
@Component({
  selector: 'x-warnings-panel',
  imports: [Icon],
  template: `
    @let groups = grouped();
    @if (!groups.length) {
      <div class="flex flex-col items-center gap-2 px-4 py-10 text-center text-muted" data-testid="warnings-empty">
        <svg [xIcon]="icons.ShieldCheck" class="size-6 text-success"></svg>
        <div class="text-sm text-fg">No warnings</div>
        <div class="text-xs">Stairs, ramps, elevators, openings and rooms are within the rules in Settings.</div>
      </div>
    } @else {
      <div class="px-3 py-2 text-xs text-muted border-b border-edge" data-testid="warnings-count">{{ result.value()?.count }} {{ result.value()?.count === 1 ? 'warning' : 'warnings' }}</div>
      <ol class="flex-1 min-h-0 overflow-y-auto">
        @for (group of groups; track group.levelId) {
          <li class="px-3 pt-2 pb-1 text-[11px] font-medium text-muted uppercase tracking-wide">{{ group.name }}</li>
          @for (w of group.warnings; track w.id) {
            <li>
              <button type="button" class="w-full flex items-start gap-2 px-3 py-1.5 text-left text-xs hover:bg-elevated" (click)="show(w)" [attr.data-testid]="'warning-row'" [attr.data-rule]="w.rule" [attr.data-target]="w.target.id" [attr.data-level]="w.levelId">
                <svg [xIcon]="w.severity === 'error' ? icons.CircleAlert : icons.TriangleAlert" class="size-3.5 mt-0.5 shrink-0" [class]="w.severity === 'error' ? 'text-danger' : 'text-warning'"></svg>
                <span>{{ w.message }}</span>
              </button>
            </li>
          }
        }
      </ol>
    }
  `,
  host: { class: 'flex flex-col min-h-0', 'data-testid': 'warnings-panel' },
})
export class WarningsPanel {
  private readonly docs = inject(ProjectDocs);
  private readonly view = inject(ProjectView);
  private readonly selection = inject(PlanSelection);

  readonly projectId = input.required<string>();

  protected readonly icons = { CircleAlert, ShieldCheck, TriangleAlert };
  protected readonly result = invokeResource<Result>('rules.check', () => ({}), { projectId: () => this.projectId(), refreshOnEvents: ['rules.changed'] });

  /** The warnings by level, bottom to top, with those about the whole building first. */
  protected readonly grouped = computed(() => {
    const warnings = this.result.value()?.warnings ?? [];
    const doc = this.docs.read(this.projectId())?.doc;
    const levels = doc ? deriveLevels(doc) : [];
    const order = new Map(levels.map((l, i) => [l.id, i]));
    const groups = new Map<string, { levelId: string; name: string; warnings: Warning[] }>();
    for (const w of warnings) {
      const key = w.levelId ?? '';
      const name = w.levelId ? (doc?.levels[w.levelId]?.name ?? 'Level') : 'Building';
      let group = groups.get(key);
      if (!group) groups.set(key, (group = { levelId: key, name, warnings: [] }));
      group.warnings.push(w);
    }
    return [...groups.values()].sort((a, b) => (order.get(a.levelId) ?? -1) - (order.get(b.levelId) ?? -1));
  });

  /** Shows the warning's level on the plan and selects what it is about. */
  protected show(w: Warning): void {
    const projectId = this.projectId();
    if (!w.levelId) return;
    this.view.setActiveLevel(projectId, w.levelId);
    this.selection.request(projectId, { levelId: w.levelId, ids: [w.target.id] });
  }
}
