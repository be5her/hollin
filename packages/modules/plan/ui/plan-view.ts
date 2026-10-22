import { DOCUMENT, Component, DestroyRef, ElementRef, afterNextRender, afterRenderEffect, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { FormField, form } from '@angular/forms/signals';
import { DEFAULT_RULE_LIMITS, deriveLevels, type DimensionKind, type GlobalConfig, type ProjectDoc, type Vec2, parseAngle } from '@studio/core';
import { AppState, Checkbox, ContextMenu, HostBridge, Icon, IconButton, Input, LengthInput, ProjectDocs, ProjectView, Select, Toasts, Units, type ContextMenuItem } from '@studio/ui';
import { DEFAULT_TOOL_OPTIONS, LIGHT_THEME, Plan2dEditor, drawingScale, readPlanTheme, renderLevelToPng, type Camera, type ShapeOptions, type SnapResult, type StairShape, type TextRequest, type ToolId, type UnderlayMode, type WallOptions } from '@studio/viewport';
import { ArrowBigUp, Blinds, BrickWall, ChevronDown, ChevronsUp, Circle, CircleDot, DoorOpen, DraftingCompass, Footprints, LandPlot, Magnet, Maximize, MousePointer2, Pentagon, Ruler, SeparatorVertical, Sofa, Square, TrendingUp, Type, ZoomIn, ZoomOut } from 'lucide';
import { PlanGeometry } from './plan-geometry';
import { PlanSelection } from './plan-selection';
import { PlanTools, type ItemArm } from './plan-tools';

interface WallDraft {
  thickness: string;
  height: string;
  alignment: WallOptions['alignment'];
  single: boolean;
}

type EditorConfig = GlobalConfig['editor'];

/** The snap kinds the menu toggles, in order. */
const SNAP_KINDS: { key: keyof EditorConfig; label: string }[] = [
  { key: 'snapEndpoint', label: 'Endpoints' },
  { key: 'snapMidpoint', label: 'Midpoints' },
  { key: 'snapCenter', label: 'Centres' },
  { key: 'snapIntersection', label: 'Intersections' },
  { key: 'snapPerpendicular', label: 'Perpendicular and tangent' },
  { key: 'snapExtension', label: 'Extensions' },
  { key: 'snapAngle', label: 'Angle tracking' },
  { key: 'snapGrid', label: 'Grid' },
];

/**
 * The plan of the active level: the tools, the level switcher, reference underlay, snapping and
 * zoom controls on top, the canvas, and the cursor position, snap and a hint below. The drawing and
 * the gestures live in the framework-free `Plan2dEditor`; this component feeds it the document, the
 * theme, the settings and the canvas size, runs its commands, and mirrors its state into
 * attributes the smoke test reads.
 */
@Component({
  selector: 'x-plan-view',
  imports: [Checkbox, FormField, Icon, IconButton, Input, LengthInput, Select],
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
  private readonly planTools = inject(PlanTools);
  private readonly planGeometry = inject(PlanGeometry);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly units = inject(Units);

  readonly projectId = input.required<string>();

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly container = viewChild.required<ElementRef<HTMLDivElement>>('container');
  private readonly dynamicInputEl = viewChild<ElementRef<HTMLInputElement>>('dynamicInput');

  protected readonly icons = { ArrowBigUp, Blinds, BrickWall, ChevronDown, ChevronsUp, Circle, CircleDot, DoorOpen, DraftingCompass, Footprints, LandPlot, Magnet, Maximize, MousePointer2, Pentagon, Ruler, SeparatorVertical, Sofa, Square, TrendingUp, Type, ZoomIn, ZoomOut };
  protected readonly snapKinds = SNAP_KINDS;
  protected readonly doc = computed(() => this.docs.read(this.projectId())?.doc);
  protected readonly levels = computed(() => {
    const doc = this.doc();
    return doc ? deriveLevels(doc) : [];
  });
  protected readonly levelsTopDown = computed(() => [...this.levels()].reverse());
  protected readonly activeLevelId = this.view.activeLevel(computed(() => this.projectId()), this.doc);
  protected readonly levelName = computed(() => this.doc()?.levels[this.activeLevelId() ?? '']?.name ?? '');
  protected readonly underlay = computed(() => this.view.get<UnderlayMode>(this.projectId(), 'underlay', 'none'));
  protected readonly editorConfig = computed(() => this.app.config()?.editor);
  /** The limits connectors are derived with; the same object until the settings change. */
  private readonly ruleLimits = computed(() => this.app.config()?.rules ?? DEFAULT_RULE_LIMITS, { equal: (a, b) => JSON.stringify(a) === JSON.stringify(b) });

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
  protected readonly connectorCount = signal(0);
  protected readonly frameMs = signal('0');
  /** The level the last frame drew: the canvas shows it, whatever the switcher already says. */
  protected readonly frameLevel = signal<string | null>(null);
  protected readonly tool = signal<ToolId>('select');
  protected readonly isShapeTool = computed(() => this.tool() === 'shape' || this.tool() === 'rectangle' || this.tool() === 'circle');
  /** What the shape tools make from an outline, and whether a free shape is filled. */
  protected readonly shapeKind = signal<ShapeOptions['kind']>('shape');
  protected readonly shapeFilled = signal(true);
  /** The kind of dimension the Dimension tool draws, and the text height of new labels (mm). */
  protected readonly dimensionKind = signal<DimensionKind>('aligned');
  protected readonly labelSize = signal(250);
  protected readonly labelDraft = signal({ size: '' });
  protected readonly labelForm = form(this.labelDraft);
  /** The connector and column tools' choices that live in the view: the stair's shape and turn, the levels a new connector joins (null: the active level and the stacked level above it), the column's shape, rotation and span. */
  protected readonly stairShape = signal<StairShape>('straight');
  protected readonly stairTurn = signal<'left' | 'right'>('left');
  protected readonly connectorFrom = signal<string | null>(null);
  protected readonly connectorTo = signal<string | null>(null);
  protected readonly columnShape = signal<'rect' | 'circle'>('rect');
  protected readonly columnRotation = signal(0);
  protected readonly columnSpan = signal<string | null>(null);
  /** The model the Item tool places (armed from the Catalog panel), and whether a lamp brings its light. */
  protected readonly itemArm = signal<ItemArm | null>(null);
  protected readonly itemWithLight = signal(true);
  private armedSeen = 0;
  protected readonly isConnectorTool = computed(() => this.tool() === 'stair' || this.tool() === 'ramp' || this.tool() === 'ladder' || this.tool() === 'elevator');
  /** The levels the options show for a new connector: the chosen ones, else the active level and the stacked level above it. */
  protected readonly connectorFromShown = computed(() => this.connectorFrom() ?? this.activeLevelId() ?? '');
  protected readonly connectorToShown = computed(() => this.connectorTo() ?? this.levelAbove(this.connectorFromShown()) ?? '');
  /** The sizes of the connector and column tools, typed in display units and remembered in the settings. */
  protected readonly sizeDraft = signal({ stairWidth: '', rampWidth: '', elevatorShaftW: '', elevatorShaftD: '', elevatorCarW: '', elevatorCarD: '', columnW: '', columnD: '', columnR: '' });
  protected readonly sizeForm = form(this.sizeDraft);
  protected readonly hint = signal('');
  protected readonly selection = signal<string[]>([]);
  protected readonly vertexAttr = signal('');
  protected readonly snapLabel = signal('');
  protected readonly snapMenuOpen = signal(false);
  /** The input that opens at the cursor: a coordinate when a digit is typed while a tool waits for a point, or text a tool asked for (a label). */
  protected readonly dynamicInput = signal<{ x: number; y: number; value: string; mode: 'coord' | 'text'; placeholder: string; commit?: (text: string) => void } | null>(null);
  protected readonly selectionAttr = computed(() => this.selection().join(' '));
  protected readonly selectionLabel = computed(() => {
    const n = this.selection().length;
    return n === 0 ? '' : n === 1 ? '1 selected' : `${n} selected`;
  });

  /** The wall tool's options, typed in display units; thickness and height are remembered in the settings. */
  protected readonly wallDraft = signal<WallDraft>({ thickness: '', height: '', alignment: 'center', single: false });
  protected readonly wallForm = form(this.wallDraft);
  private wallOptions: WallOptions = { ...DEFAULT_TOOL_OPTIONS.wall };
  /** The door and window tools' sizes, typed in display units and remembered in the settings. */
  protected readonly openingDraft = signal({ doorWidth: '', doorHeight: '', windowWidth: '', windowHeight: '', windowSill: '' });
  protected readonly openingForm = form(this.openingDraft);
  /** The grid spacing field in the snap menu. */
  protected readonly gridDraft = signal({ spacing: '' });
  protected readonly gridForm = form(this.gridDraft);

  private cameraRestored = false;
  private persistTimer: ReturnType<typeof setTimeout> | undefined;
  /** The project thumbnail: the ground floor, drawn 1.5 s after the last change (or when the tab is left). */
  private thumbnailTimer: ReturnType<typeof setTimeout> | undefined;
  private thumbnailDirty = false;
  /** The change number first seen: opening a project writes nothing, only a change does. */
  private thumbnailSeq: number | undefined;
  /** The document the thumbnail is drawn from: the last one seen, never read back (reading a closed project's document would reopen it). */
  private thumbnailDoc: ProjectDoc | undefined;
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
      this.connectorCount.set(stats.connectors);
      this.frameMs.set(stats.ms.toFixed(1));
      this.frameLevel.set(stats.levelId);
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
    onSnap: (snap: SnapResult | null) => this.snapLabel.set(snap?.label ?? ''),
    onContextMenu: (event, ids) => this.menu.open(event, this.menuItems(ids)),
    onDynamicInput: ({ char, screen }) => this.dynamicInput.set({ x: screen[0] + 14, y: screen[1] + 14, value: char, mode: 'coord', placeholder: '3000 · 3000<45 · @dx,dy · x,y' }),
    onTextInput: (request: TextRequest) => this.dynamicInput.set({ x: request.screen[0] + 14, y: request.screen[1] + 14, value: '', mode: 'text', placeholder: request.placeholder, commit: request.commit }),
  }, { cache: this.planGeometry.cache });

  constructor() {
    effect(() => {
      const state = this.docs.read(this.projectId());
      this.editor.setDocument(state?.doc, state?.seq ?? 0, state?.epoch ?? 1);
    });
    effect(() => this.editor.setLevel(this.activeLevelId()));
    effect(() => {
      // A selection asked for from outside (a warning clicked): once the level matches, select it and bring it into view.
      const request = this.planSelection.requested(this.projectId())();
      if (!request || request.levelId !== this.activeLevelId()) return;
      untracked(() => {
        this.editor.select(request.ids);
        this.editor.revealSelection();
        this.planSelection.clearRequest(this.projectId(), request.n);
      });
    });
    effect(() => {
      // A model armed in the Catalog panel: the Item tool places it.
      const armed = this.planTools.armedItem(this.projectId())();
      if (!armed || armed.n === this.armedSeen) return;
      this.armedSeen = armed.n;
      untracked(() => {
        this.itemArm.set(armed.item);
        const c = this.editorConfig();
        if (c) this.editor.setToolOptions(this.toolOptions(c));
        this.chooseTool('item');
      });
    });
    effect(() => this.editor.setUnderlay(this.underlay()));
    effect(() => this.editor.setRuleLimits(this.ruleLimits()));
    effect(() => {
      this.editor.setUnits(this.units.settings());
      this.showWallOptions();
      this.gridDraft.set({ spacing: this.units.length(untracked(this.editorConfig)?.gridSpacing ?? 100) });
      this.labelDraft.set({ size: this.units.length(untracked(this.labelSize)) });
    });
    effect(() => {
      // The settings drive snapping, the grid and the wall tool's defaults.
      const c = this.editorConfig();
      if (!c) return;
      this.editor.setSnapSettings({ enabled: c.snap, endpoint: c.snapEndpoint, midpoint: c.snapMidpoint, center: c.snapCenter, intersection: c.snapIntersection, perpendicular: c.snapPerpendicular, extension: c.snapExtension, grid: c.snapGrid, gridSpacing: c.gridSpacing, angle: c.snapAngle, angleStep: c.angleStep });
      this.editor.showGrid = c.gridShow;
      this.wallOptions = { ...this.wallOptions, thickness: c.wallThickness, height: c.wallHeight };
      this.editor.setToolOptions(this.toolOptions(c));
      this.showWallOptions();
      const len = (mm: number) => this.units.length(mm);
      this.openingDraft.set({ doorWidth: len(c.doorWidth), doorHeight: len(c.doorHeight), windowWidth: len(c.windowWidth), windowHeight: len(c.windowHeight), windowSill: len(c.windowSill) });
      this.sizeDraft.set({ stairWidth: len(c.stairWidth), rampWidth: len(c.rampWidth), elevatorShaftW: len(c.elevatorShaftW), elevatorShaftD: len(c.elevatorShaftD), elevatorCarW: len(c.elevatorCarW), elevatorCarD: len(c.elevatorCarD), columnW: len(c.columnW), columnD: len(c.columnD), columnR: len(c.columnR) });
      this.gridDraft.set({ spacing: this.units.length(c.gridSpacing) });
      this.editor.invalidate();
    });
    effect(() => {
      // The shape, dimension and label tools' options live in the view only.
      this.shapeKind();
      this.shapeFilled();
      this.dimensionKind();
      this.labelSize();
      this.stairShape();
      this.stairTurn();
      this.connectorFrom();
      this.connectorTo();
      this.columnShape();
      this.columnRotation();
      this.columnSpan();
      this.itemArm();
      this.itemWithLight();
      const c = untracked(this.editorConfig);
      if (c) this.editor.setToolOptions(this.toolOptions(c));
    });
    effect(() => {
      // Every change (not the opening itself) schedules a fresh thumbnail of the ground floor, 1.5 s after the last one.
      const state = this.docs.read(this.projectId());
      if (!state?.doc) return;
      this.thumbnailDoc = state.doc;
      if (this.thumbnailSeq === undefined) {
        this.thumbnailSeq = state.seq;
        return;
      }
      if (state.seq === this.thumbnailSeq) return;
      this.thumbnailSeq = state.seq;
      this.thumbnailDirty = true;
      clearTimeout(this.thumbnailTimer);
      this.thumbnailTimer = setTimeout(() => this.writeThumbnail(), 1500);
    });
    effect(() => {
      // Leaving the tab writes a pending thumbnail at once.
      if (this.app.activeProjectId() !== this.projectId() && this.thumbnailDirty) this.writeThumbnail();
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
    afterRenderEffect(() => {
      // Focus the dynamic input as soon as it appears, with the caret after the seeded character.
      const el = this.dynamicInputEl()?.nativeElement;
      if (el && this.dynamicInput() && this.document.activeElement !== el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });
    afterNextRender(() => this.mount());
    this.destroyRef.onDestroy(() => {
      clearTimeout(this.persistTimer);
      if (this.thumbnailDirty) this.writeThumbnail();
      this.editor.detach();
    });
  }

  /** Draws the ground floor into a canvas and stores it as the project's thumbnail (the Home card shows it). */
  private writeThumbnail(): void {
    clearTimeout(this.thumbnailTimer);
    this.thumbnailDirty = false;
    const projectId = untracked(this.projectId);
    const doc = this.thumbnailDoc;
    if (!doc) return;
    const png = renderLevelToPng(doc, doc.building.groundLevelId, {
      width: 480,
      height: 360,
      theme: LIGHT_THEME,
      units: untracked(this.units.settings),
      limits: untracked(this.ruleLimits),
      cache: this.planGeometry.cache,
      createCanvas: (width, height) => {
        const c = this.document.createElement('canvas');
        c.width = width;
        c.height = height;
        return c;
      },
    });
    if (!png) return;
    this.host.invoke('project.thumbnail.set', { id: projectId, png }, null).catch(() => undefined);
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
      ...this.swingItems(ids),
      { label: `Delete ${what}`, shortcut: 'Del', danger: true, disabled: !n, testId: 'menu-delete', select: () => void run('plan.entity.delete', { ids }) },
      'separator',
      { label: 'Select all', shortcut: 'Ctrl+A', testId: 'menu-select-all', select: () => this.editor.select(Object.keys(this.editor.entities())) },
      { label: 'Zoom to fit', shortcut: 'Home', select: () => this.editor.zoomToFit() },
    ];
  }

  private toolOptions(c: EditorConfig) {
    return { ...DEFAULT_TOOL_OPTIONS, nudge: c.gridSpacing, wall: this.wallOptions, door: { width: c.doorWidth, height: c.doorHeight }, window: { width: c.windowWidth, height: c.windowHeight, sill: c.windowSill }, shape: { kind: untracked(this.shapeKind), filled: untracked(this.shapeFilled) }, dimension: { kind: untracked(this.dimensionKind) }, label: { size: untracked(this.labelSize) }, connector: { bottomLevelId: untracked(this.connectorFrom), topLevelId: untracked(this.connectorTo) }, stair: { shape: untracked(this.stairShape), width: c.stairWidth, turn: untracked(this.stairTurn) }, ramp: { width: c.rampWidth }, elevator: { shaft: { w: c.elevatorShaftW, d: c.elevatorShaftD }, car: { w: c.elevatorCarW, d: c.elevatorCarD } }, column: { shape: untracked(this.columnShape), w: c.columnW, d: c.columnD, r: c.columnR, rotation: untracked(this.columnRotation), topLevelId: untracked(this.columnSpan) }, item: this.itemOptions() };
  }

  private itemOptions() {
    const arm = untracked(this.itemArm);
    return { ref: arm?.ref ?? null, name: arm?.name ?? '', size: arm?.size ?? null, ...(arm?.min ? { min: arm.min } : {}), rotation: 0, withLight: Boolean(arm?.lamp) && untracked(this.itemWithLight) };
  }

  protected setItemWithLight(checked: boolean): void {
    this.itemWithLight.set(checked);
    this.canvas().nativeElement.focus({ preventScroll: true });
  }

  /** The stacked level above a level (a mezzanine's: above its host), or null at the top. */
  protected levelAbove(levelId: string): string | null {
    const from = this.levels().find((l) => l.id === levelId);
    if (!from) return null;
    return this.levels().filter((l) => l.placement === 'stack' && l.elevation > from.elevation).sort((a, b) => a.elevation - b.elevation)[0]?.id ?? null;
  }

  protected setStairShape(value: string): void {
    if (value === 'straight' || value === 'l' || value === 'u' || value === 'winder' || value === 'spiral' || value === 'curved') this.stairShape.set(value);
    this.canvas().nativeElement.focus({ preventScroll: true });
  }

  protected setStairTurn(value: string): void {
    if (value === 'left' || value === 'right') this.stairTurn.set(value);
    this.canvas().nativeElement.focus({ preventScroll: true });
  }

  protected setConnectorLevel(which: 'from' | 'to', levelId: string): void {
    (which === 'from' ? this.connectorFrom : this.connectorTo).set(levelId || null);
    this.canvas().nativeElement.focus({ preventScroll: true });
  }

  protected setColumnShape(value: string): void {
    if (value === 'rect' || value === 'circle') this.columnShape.set(value);
    this.canvas().nativeElement.focus({ preventScroll: true });
  }

  protected setColumnRotation(value: string): void {
    const degrees = parseAngle(value);
    if (degrees !== null) this.columnRotation.set(degrees);
    this.canvas().nativeElement.focus({ preventScroll: true });
  }

  protected setColumnSpan(levelId: string): void {
    this.columnSpan.set(levelId || null);
    this.canvas().nativeElement.focus({ preventScroll: true });
  }

  /** A connector or column size typed in the options bar, in any unit: remembered in the settings. */
  protected setToolSize(key: 'stairWidth' | 'rampWidth' | 'elevatorShaftW' | 'elevatorShaftD' | 'elevatorCarW' | 'elevatorCarD' | 'columnW' | 'columnD' | 'columnR', mm: number | null): void {
    if (mm === null || mm <= 0) return;
    void this.updateEditorConfig({ [key]: mm });
  }

  protected setDimensionKind(value: string): void {
    if (value === 'aligned' || value === 'horizontal' || value === 'vertical' || value === 'angular' || value === 'radius') this.dimensionKind.set(value);
    this.canvas().nativeElement.focus({ preventScroll: true });
  }

  protected setLabelSize(mm: number | null): void {
    if (mm && mm > 0) this.labelSize.set(mm);
    this.labelDraft.set({ size: this.units.length(untracked(this.labelSize)) });
    this.canvas().nativeElement.focus({ preventScroll: true });
  }

  protected setShapeKind(value: string): void {
    if (value === 'shape' || value === 'room' || value === 'slab' || value === 'void') this.shapeKind.set(value);
    this.canvas().nativeElement.focus({ preventScroll: true });
  }

  protected setShapeFilled(checked: boolean): void {
    this.shapeFilled.set(checked);
    this.canvas().nativeElement.focus({ preventScroll: true });
  }

  /** A door or window size typed in the options bar, in any unit: remembered in the settings. */
  protected setOpeningSize(key: 'doorWidth' | 'doorHeight' | 'windowWidth' | 'windowHeight' | 'windowSill', mm: number | null): void {
    if (mm === null || (mm <= 0 && key !== 'windowSill') || mm < 0) return;
    void this.updateEditorConfig({ [key]: mm });
  }

  // ---------- typed coordinates ----------

  protected commitTyped(): void {
    const value = this.dynamicInputEl()?.nativeElement.value ?? '';
    const current = untracked(this.dynamicInput);
    if (current?.mode === 'text') {
      current.commit?.(value);
      this.closeTyped();
      return;
    }
    if (!value.trim()) {
      this.closeTyped();
      return;
    }
    if (this.editor.typed(value)) this.closeTyped();
    else this.toasts.notify(`"${value}" is not a length or coordinate (try 3000, 3000<45, @1000,500 or 1000,500)`, 'error');
  }

  protected closeTyped(): void {
    this.dynamicInput.set(null);
    this.canvas().nativeElement.focus({ preventScroll: true });
  }

  /** For a single selected door: flip its swing side or hinge. */
  private swingItems(ids: string[]): ContextMenuItem[] {
    if (ids.length !== 1) return [];
    const e = this.editor.entities()[ids[0]];
    if (!e || e.type !== 'opening' || e.kind !== 'door') return [];
    const swing = { hinge: e.swing?.hinge ?? 'start', side: e.swing?.side ?? 'left' };
    const projectId = untracked(this.projectId);
    const flip = (next: typeof swing) => void this.host.invoke('plan.entity.update', { id: e.id, set: { swing: next } }, projectId).catch((err) => this.toasts.error(err));
    return [
      { label: 'Flip swing side', testId: 'menu-flip-side', select: () => flip({ ...swing, side: swing.side === 'left' ? 'right' : 'left' }) },
      { label: 'Flip hinge', testId: 'menu-flip-hinge', select: () => flip({ ...swing, hinge: swing.hinge === 'start' ? 'end' : 'start' }) },
    ];
  }

  // ---------- tools ----------

  protected chooseTool(tool: ToolId): void {
    this.editor.setTool(tool);
    this.canvas().nativeElement.focus({ preventScroll: true });
  }

  private showWallOptions(): void {
    this.wallDraft.set({ thickness: this.units.length(this.wallOptions.thickness), height: this.wallOptions.height === null ? '' : this.units.length(this.wallOptions.height), alignment: this.wallOptions.alignment, single: this.wallOptions.single });
  }

  /** Reads the wall options from the form (lengths in any unit), hands them to the editor and remembers the sizes. */
  protected applyWallOptions(): void {
    const draft = untracked(this.wallDraft);
    const thickness = this.units.parseLength(draft.thickness);
    const height = draft.height.trim() === '' ? null : this.units.parseLength(draft.height);
    if (thickness === null || thickness <= 0) this.toasts.notify(`"${draft.thickness}" is not a thickness`, 'error');
    else this.wallOptions = { ...this.wallOptions, thickness };
    if (draft.height.trim() !== '' && (height === null || height <= 0)) this.toasts.notify(`"${draft.height}" is not a height`, 'error');
    else this.wallOptions = { ...this.wallOptions, height };
    this.wallOptions = { ...this.wallOptions, alignment: draft.alignment, single: draft.single };
    this.showWallOptions();
    const current = untracked(this.editorConfig);
    if (current) this.editor.setToolOptions(this.toolOptions(current));
    const c = untracked(this.editorConfig);
    if (c && (c.wallThickness !== this.wallOptions.thickness || c.wallHeight !== this.wallOptions.height)) void this.updateEditorConfig({ wallThickness: this.wallOptions.thickness, wallHeight: this.wallOptions.height });
  }

  // ---------- snapping and the grid ----------

  protected toggleSnap(): void {
    void this.updateEditorConfig({ snap: !(untracked(this.editorConfig)?.snap ?? true) });
  }

  protected toggleAngleTracking(): void {
    void this.updateEditorConfig({ snapAngle: !(untracked(this.editorConfig)?.snapAngle ?? true) });
  }

  protected angleTrackingLabel(c: EditorConfig): string {
    if (!c.snapAngle) return 'Angle tracking off';
    return c.snap ? `Angle tracking on, every ${c.angleStep}° (Shift: 45° steps)` : 'Angle tracking on, but snapping is off';
  }

  protected setEditorFlag(key: keyof EditorConfig, value: boolean): void {
    void this.updateEditorConfig({ [key]: value });
  }

  protected setGridSpacing(mm: number | null): void {
    if (mm && mm > 0) void this.updateEditorConfig({ gridSpacing: mm });
  }

  protected setAngleStep(value: string): void {
    const step = Number(value);
    if (Number.isFinite(step) && step >= 1 && step <= 90) void this.updateEditorConfig({ angleStep: step });
  }

  private async updateEditorConfig(patch: Partial<EditorConfig>): Promise<void> {
    try {
      await this.host.invoke('config.update', { patch: { editor: patch } }, null);
    } catch (err) {
      this.toasts.error(err);
    }
  }

  // ---------- levels and the camera ----------

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
