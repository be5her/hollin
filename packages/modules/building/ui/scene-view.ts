import { DOCUMENT, Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { DEFAULT_RULE_LIMITS, deriveLevelGeometry, deriveLevels, surfaceAt } from '@studio/core';
import { AppState, Button, EmptyState, HostBridge, Icon, IconButton, ProjectDocs, ProjectView, Select, Toasts, Units } from '@studio/ui';
import { Scene3dView, parseOrbit, readSceneTheme, type Orbit, type OrbitPreset, type Scene3dFrame, type SceneLighting, type SceneMode } from '@studio/viewport';
import { Maximize, Moon, Sun } from 'lucide';
import { PlanSelection } from '../../plan/ui/plan-selection';
import { PlanTools } from '../../plan/ui/plan-tools';
import { BuildingActions } from './building-actions';

/** What the 3D view keeps in the project's view state (`view3d`). */
interface View3dState {
  orbit?: Orbit;
  mode?: SceneMode;
  explode?: number;
  lighting?: SceneLighting;
}

const PRESETS: { id: OrbitPreset; label: string; title: string }[] = [
  { id: 'iso', label: '3/4', title: 'From the south-west, above' },
  { id: 'top', label: 'Top', title: 'From above, north up' },
  { id: 'front', label: 'Front', title: 'From the south' },
  { id: 'side', label: 'Side', title: 'From the east' },
];

const MODES: { id: SceneMode; label: string; title: string }[] = [
  { id: 'all', label: 'All', title: 'Every level' },
  { id: 'isolate', label: 'Isolate', title: 'The active level alone' },
  { id: 'cutaway', label: 'Cutaway', title: 'The active level cut at the plan cut height, and the levels below it' },
];

/**
 * The whole building in 3D: every level at its elevation with its walls (openings cut), slabs,
 * columns and the stairs, ramps and elevators between them, drawn by `@studio/viewport`'s
 * `Scene3dView` from the mirror of the document, so a change made anywhere shows at once. All
 * levels, the active one alone, or a cutaway at it; the levels spread apart by Explode; a click on
 * something makes its level active, and the active level is the plan's. The camera and the display
 * are kept per project in its view state; the view mirrors what it drew into attributes the smoke
 * test reads.
 */
@Component({
  selector: 'x-scene-view',
  imports: [Button, EmptyState, Icon, IconButton, Select],
  templateUrl: './scene-view.html',
  host: { class: 'flex flex-col h-full min-h-0', 'data-testid': 'scene-view' },
})
export class SceneView {
  private readonly docs = inject(ProjectDocs);
  private readonly view = inject(ProjectView);
  private readonly app = inject(AppState);
  private readonly actions = inject(BuildingActions);
  private readonly planSelection = inject(PlanSelection);
  private readonly planTools = inject(PlanTools);
  private readonly host = inject(HostBridge);
  private readonly toasts = inject(Toasts);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly units = inject(Units);

  readonly projectId = input.required<string>();

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly container = viewChild.required<ElementRef<HTMLDivElement>>('container');

  protected readonly icons = { Maximize, Moon, Sun };
  protected readonly presets = PRESETS;
  protected readonly modes = MODES;
  protected readonly doc = computed(() => this.docs.read(this.projectId())?.doc);
  protected readonly levelsTopDown = computed(() => {
    const doc = this.doc();
    return doc ? deriveLevels(doc).reverse() : [];
  });
  protected readonly activeLevelId = this.actions.activeLevel(computed(() => this.projectId()), this.doc);
  private readonly limits = computed(() => this.app.config()?.rules ?? DEFAULT_RULE_LIMITS, { equal: (a, b) => JSON.stringify(a) === JSON.stringify(b) });
  private readonly stored = computed(() => this.view.get<View3dState | null>(this.projectId(), 'view3d', null));
  private readonly storedOrbit = computed(() => parseOrbit(this.stored()?.orbit));
  protected readonly mode = computed<SceneMode>(() => {
    const m = this.stored()?.mode;
    return m === 'isolate' || m === 'cutaway' ? m : 'all';
  });
  protected readonly explode = computed(() => Math.min(1, Math.max(0, Number(this.stored()?.explode) || 0)));
  protected readonly lighting = computed<SceneLighting>(() => (this.stored()?.lighting === 'night' ? 'night' : 'day'));
  protected readonly lightsOn = computed(() => this.frame()?.lightsOn ?? 0);
  /** The material a click paints with, while one is armed in the Catalog panel. */
  protected readonly paint = computed(() => this.planTools.armedPaint(this.projectId())());

  /** Why there is no 3D view (no WebGL), or null. */
  protected readonly unavailable = signal<string | null>(null);
  private readonly mounted = signal(false);
  private readonly frame = signal<Scene3dFrame | null>(null);
  protected readonly cameraAttr = computed(() => this.frame()?.viewProjection.map((v) => +v.toPrecision(9)).join(',') ?? '');
  protected readonly orbitAttr = computed(() => {
    const o = this.frame()?.orbit;
    return o ? [...o.target, o.distance, o.azimuth, o.elevation].map((v) => +v.toFixed(3)).join(',') : '';
  });
  protected readonly meshes = computed(() => this.frame()?.meshes ?? 0);
  protected readonly levelsAttr = computed(() => this.frame()?.levels.join(' ') ?? '');
  protected readonly clipAttr = computed(() => {
    const clip = this.frame()?.clip;
    return clip === null || clip === undefined ? '' : String(Math.round(clip));
  });
  protected readonly frameMs = computed(() => (this.frame()?.frameMs ?? 0).toFixed(1));
  protected readonly walk = computed(() => this.frame()?.walk ?? null);
  protected readonly walkAttr = computed(() => {
    const w = this.walk();
    return w ? [...w.at, w.yaw].map((v) => Math.round(v)).join(',') : '';
  });
  protected readonly walkLevelName = computed(() => this.doc()?.levels[this.walk()?.levelId ?? '']?.name ?? '');
  protected readonly empty = computed(() => this.mounted() && this.frame() !== null && this.meshes() === 0);

  private scene: Scene3dView | null = null;
  /** The orbit last stored or applied, so the stored value is only applied when it is news. */
  private lastOrbit = '';

  constructor() {
    afterNextRender(() => this.mount());
    // A stored orbit first, so the first document does not fit the camera over it.
    effect(() => {
      const orbit = this.storedOrbit();
      if (!this.mounted() || !orbit) return;
      const json = JSON.stringify(orbit);
      if (json === this.lastOrbit) return;
      this.lastOrbit = json;
      untracked(() => this.scene?.setOrbit(orbit));
    });
    effect(() => {
      const display = { mode: this.mode(), levelId: this.activeLevelId(), explode: this.explode(), cutHeight: this.limits().stairCutHeight };
      if (!this.mounted()) return;
      untracked(() => this.scene?.setDisplay(display));
    });
    effect(() => {
      const lighting = this.lighting();
      if (!this.mounted()) return;
      untracked(() => this.scene?.setLighting(lighting));
    });
    effect(() => {
      const doc = this.doc();
      const limits = this.limits();
      if (!this.mounted() || !doc) return;
      untracked(() => this.scene?.setDocument(doc, limits));
    });
    this.destroyRef.onDestroy(() => this.scene?.dispose());
  }

  protected preset(id: OrbitPreset): void {
    this.scene?.fit(id);
    this.canvas().nativeElement.focus();
  }

  protected fit(): void {
    this.scene?.fit();
    this.canvas().nativeElement.focus();
  }

  protected chooseMode(mode: SceneMode): void {
    this.storeState({ mode });
  }

  protected chooseLighting(lighting: SceneLighting): void {
    this.storeState({ lighting });
  }

  protected chooseLevel(levelId: string): void {
    this.actions.setActiveLevel(untracked(this.projectId), levelId);
  }

  protected setExplode(event: Event): void {
    this.storeState({ explode: Number((event.target as HTMLInputElement).value) / 100 });
  }

  private mount(): void {
    const canvas = this.canvas().nativeElement;
    const container = this.container().nativeElement;
    try {
      this.scene = new Scene3dView(
        canvas,
        {
          onFrame: (frame) => this.frame.set(frame),
          onOrbit: (orbit) => this.storeOrbit(orbit),
          onPick: (hit) => {
            if (!hit) return;
            if (untracked(this.paint)) {
              this.paintAt(hit);
              return;
            }
            this.chooseLevel(hit.levelId);
            // Furniture is selected on the plan too, as a warning's target is.
            if (hit.kind === 'item') this.planSelection.request(untracked(this.projectId), { levelId: hit.levelId, ids: hit.ids });
          },
        },
        readSceneTheme(this.document.documentElement),
      );
    } catch (err) {
      this.unavailable.set(`This computer's graphics could not start a WebGL context (${err instanceof Error ? err.message : String(err)}). The plan and the section still work.`);
      return;
    }
    const measure = () => {
      const r = container.getBoundingClientRect();
      this.scene?.setSize(r.width, r.height, this.document.defaultView?.devicePixelRatio ?? 1);
    };
    const resizes = new ResizeObserver(measure);
    resizes.observe(container);
    measure();
    // The smoke test flips the theme by toggling the class; follow the class, not only the app's signal.
    const themes = new MutationObserver(() => this.scene?.setTheme(readSceneTheme(this.document.documentElement)));
    themes.observe(this.document.documentElement, { attributes: true, attributeFilter: ['class'] });
    this.destroyRef.onDestroy(() => {
      resizes.disconnect();
      themes.disconnect();
    });
    this.mounted.set(true);
  }

  /** Gives the armed material to the wall face, floor or ceiling under a click. */
  private paintAt(hit: { levelId: string; point?: readonly [number, number, number]; normal?: readonly [number, number, number] }): void {
    const paint = untracked(this.paint);
    const entities = untracked(this.doc)?.levelData[hit.levelId]?.entities;
    if (!paint || !entities || !hit.point || !hit.normal) return;
    const target = surfaceAt(entities, deriveLevelGeometry(entities).rooms.values(), hit.point, hit.normal);
    if (!target) {
      this.toasts.notify('Click a wall face, a floor or a ceiling to paint it.', 'error');
      return;
    }
    this.host.invoke('decor.material.set', { target, material: paint.ref }, untracked(this.projectId)).catch((err) => this.toasts.error(err));
  }

  protected stopPainting(): void {
    this.planTools.disarmPaint(untracked(this.projectId));
  }

  private storeOrbit(orbit: Orbit): void {
    const rounded: Orbit = { target: [Math.round(orbit.target[0]), Math.round(orbit.target[1]), Math.round(orbit.target[2])], distance: Math.round(orbit.distance), azimuth: +orbit.azimuth.toFixed(2), elevation: +orbit.elevation.toFixed(2) };
    this.lastOrbit = JSON.stringify(rounded);
    this.storeState({ orbit: rounded });
  }

  private storeState(change: View3dState): void {
    this.view.set(untracked(this.projectId), 'view3d', { ...(untracked(this.stored) ?? {}), ...change } satisfies View3dState);
  }
}
