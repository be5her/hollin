import { DOCUMENT, Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { FormField, form } from '@angular/forms/signals';
import { deriveLevels, type Vec2 } from '@studio/core';
import { AppState, Checkbox, ContextMenu, HostBridge, Icon, IconButton, Input, ProjectDocs, ProjectView, Select, Toasts, Units, type ContextMenuItem } from '@studio/ui';
import { DEFAULT_TOOL_OPTIONS, Plan2dEditor, drawingScale, readPlanTheme, type Camera, type ToolId, type UnderlayMode, type WallOptions } from '@studio/viewport';
import { BrickWall, Maximize, MousePointer2, ZoomIn, ZoomOut } from 'lucide';
import { PlanSelection } from './plan-selection';

interface WallDraft {
  thickness: string;
  height: string;
  alignment: WallOptions['alignment'];
  single: boolean;
}

/**
 * The plan of the active level: the tools, the level switcher, reference underlay and zoom
 * controls on top, the canvas, and the cursor position and a hint below. The drawing and the
 * gestures live in the framework-free `Plan2dEditor`; this component feeds it the document, the
 * theme, the tool options and the canvas size, runs its commands, and mirrors its state into
 * attributes the smoke test reads.
 */
@Component({
  selector: 'x-plan-view',
  imports: [Checkbox, FormField, Icon, IconButton, Input, Select],
  templateUrl: './plan-view.html',
  host: { class: 'flex flex-col h-full min-h-0', 'data-testid': 'plan-view' },
})
export class PlanView {
  private readonly docs = inject(ProjectDocs);
  private readonly view = inject(ProjectView);
  private readonly app = inject(AppState);
  private readonly host = inject(HostBridge);
  private readonly toasts = inject(Toasts);
  private readonly menu = inject(ContextMenu);
  private readonly planSelection = inject(PlanSelection);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly units = inject(Units);

  readonly projectId = input.required<string>();

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly container = viewChild.required<ElementRef<HTMLDivElement>>('container');

  protected readonly icons = { BrickWall, Maximize, MousePointer2, ZoomIn, ZoomOut };
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
  protected readonly tool = signal<ToolId>('select');
  protected readonly hint = signal('');
  protected readonly selection = signal<string[]>([]);
  protected readonly vertexAttr = signal('');
  protected readonly selectionAttr = computed(() => this.selection().join(' '));
  protected readonly selectionLabel = computed(() => {
    const n = this.selection().length;
    return n === 0 ? '' : n === 1 ? '1 selected' : `${n} selected`;
  });

  /** The wall tool's options, typed in display units. */
  protected readonly wallDraft = signal<WallDraft>({ thickness: '', height: '', alignment: 'center', single: false });
  protected readonly wallForm = form(this.wallDraft);
  private wallOptions: WallOptions = { ...DEFAULT_TOOL_OPTIONS.wall };

  private cameraRestored = false;
  private persistTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly editor = new Plan2dEditor({
    invoke: async (id, input) => {
      try {
        return await this.host.invoke(id, input, untracked(this.projectId));
      } catch (err) {
        this.toasts.error(err);
        return undefined;
      }
    },
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
    onToolChange: (tool, hint) => {
      this.tool.set(tool);
      this.hint.set(hint);
    },
    onSelectionChange: (ids) => {
      this.selection.set(ids);
      this.planSelection.setIds(untracked(this.projectId), ids);
    },
    onVertexSelect: (vertex) => {
      this.vertexAttr.set(vertex ? `${vertex.id}:${vertex.index}` : '');
      this.planSelection.setVertex(untracked(this.projectId), vertex);
    },
    onContextMenu: (event, ids) => this.menu.open(event, this.menuItems(ids)),
  });

  private menuItems(ids: string[]): ContextMenuItem[] {
    const projectId = untracked(this.projectId);
    const run = (id: string, input: unknown) => this.host.invoke(id, input, projectId).catch((err) => this.toasts.error(err));
    const n = ids.length;
    const what = n === 1 ? 'item' : `${n} items`;
    return [
      {
        label: `Duplicate ${what}`,
        shortcut: 'Ctrl+D',
        disabled: !n,
        testId: 'menu-duplicate',
        select: () =>
          void run('plan.transform', { ids, translate: [100, -100], copy: true }).then((result) => {
            const copies = (result as { ids?: string[] } | undefined)?.ids;
            if (copies?.length) this.editor.select(copies);
          }),
      },
      { label: `Delete ${what}`, shortcut: 'Del', danger: true, disabled: !n, testId: 'menu-delete', select: () => void run('plan.entity.delete', { ids }) },
      'separator',
      { label: 'Select all', shortcut: 'Ctrl+A', testId: 'menu-select-all', select: () => this.editor.select(Object.keys(this.editor.entities())) },
      { label: 'Zoom to fit', shortcut: 'Home', select: () => this.editor.zoomToFit() },
    ];
  }

  constructor() {
    effect(() => {
      const state = this.docs.read(this.projectId());
      this.editor.setDocument(state?.doc, state?.seq ?? 0, state?.epoch ?? 1);
    });
    effect(() => this.editor.setLevel(this.activeLevelId()));
    effect(() => this.editor.setUnderlay(this.underlay()));
    effect(() => {
      this.editor.setUnits(this.units.settings());
      // Show the options in the current units.
      this.wallDraft.set({ thickness: this.units.length(this.wallOptions.thickness), height: this.wallOptions.height === null ? '' : this.units.length(this.wallOptions.height), alignment: this.wallOptions.alignment, single: this.wallOptions.single });
    });
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
    this.editor.setTool('select');
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

  protected chooseTool(tool: ToolId): void {
    this.editor.setTool(tool);
    this.canvas().nativeElement.focus({ preventScroll: true });
  }

  /** Reads the wall options from the form (lengths in any unit) and hands them to the editor. */
  protected applyWallOptions(): void {
    const draft = untracked(this.wallDraft);
    const thickness = this.units.parseLength(draft.thickness);
    const height = draft.height.trim() === '' ? null : this.units.parseLength(draft.height);
    if (thickness === null || thickness <= 0) this.toasts.notify(`"${draft.thickness}" is not a thickness`, 'error');
    else this.wallOptions = { ...this.wallOptions, thickness };
    if (draft.height.trim() !== '' && (height === null || height <= 0)) this.toasts.notify(`"${draft.height}" is not a height`, 'error');
    else this.wallOptions = { ...this.wallOptions, height };
    this.wallOptions = { ...this.wallOptions, alignment: draft.alignment, single: draft.single };
    this.wallDraft.set({ thickness: this.units.length(this.wallOptions.thickness), height: this.wallOptions.height === null ? '' : this.units.length(this.wallOptions.height), alignment: this.wallOptions.alignment, single: this.wallOptions.single });
    this.editor.setToolOptions({ ...DEFAULT_TOOL_OPTIONS, wall: this.wallOptions });
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
