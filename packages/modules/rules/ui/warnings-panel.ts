import { Component, computed, inject, input } from '@angular/core';
import { deriveLevels, type Warning } from '@studio/core';
import { I18n, Icon, ProjectDocs, ProjectView, Units, invokeResource } from '@studio/ui';
import { CircleAlert, ShieldCheck, TriangleAlert } from 'lucide';
import { PlanSelection } from '../../plan/ui/plan-selection';

interface Result {
  warnings: Warning[];
  count: number;
  byLevel: Record<string, number>;
}

/**
 * The warnings the design raises, grouped by level; a click shows the level and selects what the
 * warning is about. Each warning is shown from its phrase (`Warning.text`), in the interface's
 * language and the display units; agents read its English `message`.
 */
@Component({
  selector: 'x-warnings-panel',
  imports: [Icon],
  template: `
    @let groups = grouped();
    @if (!groups.length) {
      <div class="flex flex-col items-center gap-2 px-4 py-10 text-center text-muted" data-testid="warnings-empty">
        <svg [xIcon]="icons.ShieldCheck" class="size-6 text-success"></svg>
        <div class="text-sm text-fg">{{ t('rules.none') }}</div>
        <div class="text-xs">{{ t('rules.noneHint') }}</div>
      </div>
    } @else {
      <div class="px-3 py-2 text-xs text-muted border-b border-edge" data-testid="warnings-count">{{ t('rules.count', { count: result.value()?.count ?? 0 }) }}</div>
      <ol class="flex-1 min-h-0 overflow-y-auto">
        @for (group of groups; track group.levelId) {
          <li class="px-3 pt-2 pb-1 text-[11px] font-medium text-muted uppercase tracking-wide" data-testid="warnings-group"><span dir="auto">{{ group.name }}</span></li>
          @for (w of group.warnings; track w.id) {
            <li>
              <button type="button" class="w-full flex items-start gap-2 px-3 py-1.5 text-start text-xs hover:bg-elevated" (click)="show(w)" [attr.data-testid]="'warning-row'" [attr.data-rule]="w.rule" [attr.data-target]="w.target.id" [attr.data-level]="w.levelId">
                <svg [xIcon]="w.severity === 'error' ? icons.CircleAlert : icons.TriangleAlert" class="size-3.5 mt-0.5 shrink-0" [class]="w.severity === 'error' ? 'text-danger' : 'text-warning'"></svg>
                <span data-testid="warning-text">{{ text(w) }}</span>
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
  private readonly units = inject(Units);
  private readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;

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
      const name = w.levelId ? (doc?.levels[w.levelId]?.name ?? this.t('rules.group.level')) : this.t('rules.group.building');
      let group = groups.get(key);
      if (!group) groups.set(key, (group = { levelId: key, name, warnings: [] }));
      group.warnings.push(w);
    }
    return [...groups.values()].sort((a, b) => (order.get(a.levelId) ?? -1) - (order.get(b.levelId) ?? -1));
  });

  /** A warning as the user reads it: in the interface's language, its lengths in the display units (its English message when it has no phrase). */
  protected text(w: Warning): string {
    if (!w.text) return w.message;
    // A length or a range of lengths never breaks across lines: a no-break space before the unit, word joiners round a range's dash.
    return this.i18n.phrase(w.text, (mm) => this.units.length(mm).replace(/ /g, '\u00a0')).replace(/(\d)–(\d)/g, '$1\u2060–\u2060$2');
  }

  /** Shows the warning's level on the plan and selects what it is about. */
  protected show(w: Warning): void {
    const projectId = this.projectId();
    if (!w.levelId) return;
    this.view.setActiveLevel(projectId, w.levelId);
    this.selection.request(projectId, { levelId: w.levelId, ids: [w.target.id] });
  }
}
