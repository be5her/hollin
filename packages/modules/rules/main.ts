import { checkConnectorRules, checkLevelRules, checkRules, defineCommand, defineModule, deriveLevels, type DocPatch, type HostApi, type ProjectApi, type Warning } from '@studio/core';
import { z } from 'zod';

interface Watched {
  project: ProjectApi;
  /** Bumped when a patch touches the level's entities. */
  levelRev: Map<string, number>;
  /** Bumped when a patch touches the building, a level or a connector (every level's slab coverage depends on them). */
  buildingRev: number;
  levels: Map<string, { key: string; warnings: Warning[] }>;
  connectors: { key: string; warnings: Warning[] } | null;
  fingerprint: string | null;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * Keeps every open project's warnings current: after each change (250 ms after the last of a burst)
 * it recomputes what the change could have touched (a level's entities, or the connectors and every
 * level when the building, a level or a connector changed) and announces `rules.changed` only when
 * the set of warnings differs.
 */
export class RulesWatcher {
  private readonly watched = new Map<string, Watched>();
  private limitsRev = 0;
  private readonly offs: (() => void)[] = [];

  constructor(
    private readonly host: HostApi,
    private readonly debounceMs = 250,
  ) {}

  start(): void {
    this.offs.push(
      this.host.on('doc.patched', (patch) => this.patched(patch)),
      this.host.on('config.changed', () => {
        this.limitsRev++;
        for (const w of this.watched.values()) this.schedule(w);
      }),
      this.host.on('project.changed', (p) => {
        const w = this.watched.get(p.projectId);
        if (w && p.kind === 'replaced') {
          this.touchAll(w);
          this.schedule(w);
        }
      }),
    );
  }

  stop(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    for (const w of this.watched.values()) if (w.timer) clearTimeout(w.timer);
    this.watched.clear();
  }

  open(project: ProjectApi): void {
    this.watched.set(project.id, { project, levelRev: new Map(), buildingRev: 0, levels: new Map(), connectors: null, fingerprint: null, timer: null });
  }

  close(projectId: string): void {
    const w = this.watched.get(projectId);
    if (w?.timer) clearTimeout(w.timer);
    this.watched.delete(projectId);
  }

  /** The project's warnings as of now, from the cache where the inputs are unchanged. An unwatched project is checked afresh. */
  warnings(project: ProjectApi): Warning[] {
    const w = this.watched.get(project.id);
    const limits = this.host.config.get().rules;
    if (!w) return checkRules(project.doc, limits);
    const doc = w.project.doc;
    const levels = deriveLevels(doc);
    const buildingKey = `${w.buildingRev}:${this.limitsRev}`;
    if (w.connectors?.key !== buildingKey) w.connectors = { key: buildingKey, warnings: checkConnectorRules(doc, limits, levels) };
    const out = [...w.connectors.warnings];
    for (const id of [...w.levels.keys()]) if (!doc.levelData[id]) w.levels.delete(id);
    for (const level of levels) {
      if (!doc.levelData[level.id]) continue;
      const key = `${w.levelRev.get(level.id) ?? 0}:${buildingKey}`;
      let entry = w.levels.get(level.id);
      if (entry?.key !== key) {
        entry = { key, warnings: checkLevelRules(doc, level.id, limits, levels) };
        w.levels.set(level.id, entry);
      }
      out.push(...entry.warnings);
    }
    return out;
  }

  // ---------- internals ----------

  private patched(patch: DocPatch & { projectId: string }): void {
    const w = this.watched.get(patch.projectId);
    if (!w) return;
    if (patch.tx.kind === 'replace' || !patch.ops.length) this.touchAll(w);
    for (const op of patch.ops) {
      if (op.c === 'entity' && op.lv) w.levelRev.set(op.lv, (w.levelRev.get(op.lv) ?? 0) + 1);
      else if (op.c === 'entity') this.touchAll(w);
      else if (op.c !== 'meta') w.buildingRev++;
    }
    this.schedule(w);
  }

  private touchAll(w: Watched): void {
    w.buildingRev++;
    for (const id of Object.keys(w.project.doc.levelData)) w.levelRev.set(id, (w.levelRev.get(id) ?? 0) + 1);
  }

  private schedule(w: Watched): void {
    if (w.timer) clearTimeout(w.timer);
    w.timer = setTimeout(() => {
      w.timer = null;
      if (!this.watched.has(w.project.id)) return;
      // A project leaves the open list before the modules' close hooks run one by one, so a check due in between finds it gone: let it go.
      if (!this.host.projects.openProjects().some((p) => p.id === w.project.id)) {
        this.watched.delete(w.project.id);
        return;
      }
      try {
        const list = this.warnings(w.project);
        const fingerprint = list.map((x) => `${x.id}|${x.message}`).join('\n');
        if (fingerprint === w.fingerprint) return;
        w.fingerprint = fingerprint;
        this.host.emit('rules.changed', { projectId: w.project.id, count: list.length });
      } catch (err) {
        console.warn(`[rules] check failed for ${w.project.id}: ${(err as Error).message}`);
      }
    }, this.debounceMs);
  }
}

let watcher: RulesWatcher | undefined;

/** The rules engine: `rules.check` reads the warnings main keeps current for every open project. */
export const rulesModule = defineModule({
  id: 'rules',
  commands: [
    defineCommand({
      id: 'rules.check',
      title: 'Check the design against its rules',
      description:
        'The warnings the design raises right now: stairs and ramps outside the limits in the settings, elevators with bad stops, connectors whose top is not above their bottom or whose opening lies outside a floor slab, doors and windows that do not fit their wall, detected rooms that are not enclosed, and walls, shapes or regions that cross themselves. Each warning names its rule, its severity, a message, the entity or connector it is about and its level. Filter with levelId or rule. Returns the warnings, the total count and the count per level; the host announces rules.changed with the count after every change that alters the set.',
      scope: 'project',
      input: z.object({ levelId: z.string().optional().describe('Only this level'), rule: z.string().optional().describe('Only this rule, e.g. stair-limits, room-open') }),
      handler: async ({ levelId, rule }, ctx) => {
        const all = (watcher ?? new RulesWatcher(ctx.host)).warnings(ctx.project!);
        const byLevel: Record<string, number> = {};
        for (const w of all) if (w.levelId) byLevel[w.levelId] = (byLevel[w.levelId] ?? 0) + 1;
        return { warnings: all.filter((w) => (!levelId || w.levelId === levelId) && (!rule || w.rule === rule)), count: all.length, byLevel };
      },
    }),
  ],
  onStart: (host) => {
    watcher = new RulesWatcher(host);
    watcher.start();
  },
  onStop: () => {
    watcher?.stop();
    watcher = undefined;
  },
  onProjectOpen: (project) => watcher?.open(project),
  onProjectClose: (project) => watcher?.close(project.id),
});
