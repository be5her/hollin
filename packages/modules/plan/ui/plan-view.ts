import { DOCUMENT, Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { deriveLevels, type Vec2 } from '@studio/core';
import { AppState, Icon, IconButton, ProjectDocs, ProjectView, Select, Units } from '@studio/ui';
import { Plan2dEditor, drawingScale, readPlanTheme, type Camera, type UnderlayMode } from '@studio/viewport';
import { Maximize, ZoomIn, ZoomOut } from 'lucide';

/**
 * The plan of the active level: the canvas with its level switcher, reference underlay and zoom
 * controls on top, the cursor position below. The drawing and the gestures live in the
 * framework-free `Plan2dEditor`; this component feeds it the document, the theme and the canvas size,
 * and mirrors its state into attributes the smoke test reads.
 */
@Component({
  selector: 'x-plan-view',
  imports: [Icon, IconButton, Select],
  templateUrl: './plan-view.html',
  host: { class: 'flex flex-col h-full min-h-0', 'data-testid': 'plan-view' },
})
export class PlanView {
  private readonly docs = inject(ProjectDocs);
  private readonly view = inject(ProjectView);
  private readonly app = inject(AppState);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly units = inject(Units);

  readonly projectId = input.required<string>();

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly container = viewChild.required<ElementRef<HTMLDivElement>>('container');

  protected readonly icons = { Maximize, ZoomIn, ZoomOut };
  protected readonly doc = computed(() => this.docs.read(this.projectId())?.doc);
  protected readonly levels = computed(() => {
    const doc = this.doc();
    return doc ? deriveLevels(doc) : [];
  });
  protected readonly levelsTopDown = computed(() => [...this.levels()].reverse());
  protected readonly activeLevelId = this.view.activeLevel(computed(() => this.projectId()), this.doc);
  protected readonly levelName = computed(() => this.doc()?.levels[this.activeLevelId() ?? '']?.name ?? '');
  protected readonly underlay = computed(() => this.view.get<UnderlayMode>(this.projectId(), 'underlay', 'none'));

  private readonly camera = signal<Camera | null>(null);
  protected readonly cameraAttr = computed(() => {
    const c = this.camera();
    return c ? `${c.x.toFixed(3)},${c.y.toFixed(3)},${c.scale.toFixed(6)}` : '';
  });
  protected readonly zoomLabel = computed(() => {
    const c = this.camera();
    return c ? `1:${drawingScale(c)}` : '';
  });
  private readonly cursor = signal<Vec2 | null>(null);
  protected readonly cursorLabel = computed(() => {
    const p = this.cursor();
    return p ? `${this.units.length(p[0])}, ${this.units.length(p[1])}` : '';
  });
  protected readonly entityCount = signal(0);
  protected readonly frameMs = signal('0');

  private cameraRestored = false;
  private persistTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly editor = new Plan2dEditor({
    onCameraChange: (camera) => {
      this.camera.set(camera);
      clearTimeout(this.persistTimer);
      this.persistTimer = setTimeout(() => this.view.set(untracked(this.projectId), 'camera', camera), 300);
    },
    onCursor: (p) => this.cursor.set(p),
    onFrame: (stats) => {
      this.entityCount.set(stats.drawn);
      this.frameMs.set(stats.ms.toFixed(1));
    },
    onLevelStep: (direction) => this.stepLevel(direction),
  });

  constructor() {
    effect(() => this.editor.setDocument(this.doc()));
    effect(() => this.editor.setLevel(this.activeLevelId()));
    effect(() => this.editor.setUnderlay(this.underlay()));
    effect(() => this.editor.setUnits(this.units.settings()));
    effect(() => {
      // A camera stored with the project is restored once; afterwards the editor's own moves are what is stored.
      const stored = this.view.get<Camera | null>(this.projectId(), 'camera', null);
      if (stored && !this.cameraRestored) {
        this.cameraRestored = true;
        this.editor.setCamera(stored);
      }
    });
    effect(() => {
      this.app.resolvedTheme();
      this.editor.setTheme(readPlanTheme(this.document.documentElement));
    });
    afterNextRender(() => this.mount());
    this.destroyRef.onDestroy(() => {
      clearTimeout(this.persistTimer);
      this.editor.detach();
    });
  }

  private mount(): void {
    const canvas = this.canvas().nativeElement;
    const container = this.container().nativeElement;
    this.editor.attach(canvas);
    const measure = () => {
      const r = container.getBoundingClientRect();
      this.editor.resize(r.width, r.height, this.document.defaultView?.devicePixelRatio ?? 1);
    };
    const resizes = new ResizeObserver(measure);
    resizes.observe(container);
    measure();
    // The smoke test flips the theme by toggling the class; follow the class, not only the app's signal.
    const themes = new MutationObserver(() => this.editor.setTheme(readPlanTheme(this.document.documentElement)));
    themes.observe(this.document.documentElement, { attributes: true, attributeFilter: ['class'] });
    this.editor.setTheme(readPlanTheme(this.document.documentElement));
    this.destroyRef.onDestroy(() => {
      resizes.disconnect();
      themes.disconnect();
    });
  }

  protected chooseLevel(levelId: string): void {
    if (levelId) this.view.setActiveLevel(this.projectId(), levelId);
  }

  protected chooseUnderlay(mode: string): void {
    this.view.set(this.projectId(), 'underlay', mode === 'below' || mode === 'above' ? mode : 'none');
  }

  protected zoom(factor: number): void {
    this.editor.zoomBy(factor);
  }

  protected fit(): void {
    this.editor.zoomToFit();
  }

  private stepLevel(direction: 1 | -1): void {
    const levels = untracked(this.levels);
    const i = levels.findIndex((l) => l.id === untracked(this.activeLevelId));
    const next = levels[i + direction];
    if (next) this.view.setActiveLevel(untracked(this.projectId), next.id);
  }
}
