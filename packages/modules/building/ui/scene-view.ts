import { DOCUMENT, Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { DEFAULT_RULE_LIMITS } from '@studio/core';
import { AppState, Button, EmptyState, Icon, IconButton, ProjectDocs, ProjectView } from '@studio/ui';
import { Scene3dView, parseOrbit, readSceneTheme, type Orbit, type OrbitPreset, type Scene3dFrame } from '@studio/viewport';
import { Maximize } from 'lucide';

/** What the 3D view keeps in the project's view state (`view3d`). */
interface View3dState {
  orbit?: Orbit;
}

const PRESETS: { id: OrbitPreset; label: string; title: string }[] = [
  { id: 'iso', label: '3/4', title: 'From the south-west, above' },
  { id: 'top', label: 'Top', title: 'From above, north up' },
  { id: 'front', label: 'Front', title: 'From the south' },
  { id: 'side', label: 'Side', title: 'From the east' },
];

/**
 * The whole building in 3D: every level at its elevation with its walls (openings cut), slabs,
 * columns and the stairs, ramps and elevators between them, drawn by `@studio/viewport`'s
 * `Scene3dView` from the mirror of the document, so a change made anywhere shows at once. The camera
 * is kept per project in its view state; the view mirrors what it drew into attributes the smoke
 * test reads.
 */
@Component({
  selector: 'x-scene-view',
  imports: [Button, EmptyState, Icon, IconButton],
  templateUrl: './scene-view.html',
  host: { class: 'flex flex-col h-full min-h-0', 'data-testid': 'scene-view' },
})
export class SceneView {
  private readonly docs = inject(ProjectDocs);
  private readonly view = inject(ProjectView);
  private readonly app = inject(AppState);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  readonly projectId = input.required<string>();

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly container = viewChild.required<ElementRef<HTMLDivElement>>('container');

  protected readonly icons = { Maximize };
  protected readonly presets = PRESETS;
  protected readonly doc = computed(() => this.docs.read(this.projectId())?.doc);
  private readonly limits = computed(() => this.app.config()?.rules ?? DEFAULT_RULE_LIMITS, { equal: (a, b) => JSON.stringify(a) === JSON.stringify(b) });
  private readonly stored = computed(() => this.view.get<View3dState | null>(this.projectId(), 'view3d', null));
  private readonly storedOrbit = computed(() => parseOrbit(this.stored()?.orbit));

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
  protected readonly frameMs = computed(() => (this.frame()?.frameMs ?? 0).toFixed(1));
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
      const doc = this.doc();
      const limits = this.limits();
      if (!this.mounted() || !doc) return;
      untracked(() => this.scene?.setDocument(doc, { limits }));
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

  private mount(): void {
    const canvas = this.canvas().nativeElement;
    const container = this.container().nativeElement;
    try {
      this.scene = new Scene3dView(
        canvas,
        {
          onFrame: (frame) => this.frame.set(frame),
          onOrbit: (orbit) => this.storeOrbit(orbit),
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

  private storeOrbit(orbit: Orbit): void {
    const rounded: Orbit = { target: [Math.round(orbit.target[0]), Math.round(orbit.target[1]), Math.round(orbit.target[2])], distance: Math.round(orbit.distance), azimuth: +orbit.azimuth.toFixed(2), elevation: +orbit.elevation.toFixed(2) };
    this.lastOrbit = JSON.stringify(rounded);
    const projectId = untracked(this.projectId);
    this.view.set(projectId, 'view3d', { ...(untracked(this.stored) ?? {}), orbit: rounded } satisfies View3dState);
  }
}
