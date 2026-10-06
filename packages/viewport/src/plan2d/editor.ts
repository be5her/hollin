import { defaultConfig, deriveLevels, emptyBox, type Box, type Entity, type Layer, type LevelWalls, type ProjectDoc, type UnitSettings, type Vec2 } from '@studio/core';
import { defaultCamera, fitBox, panBy, sameCamera, screenToWorld, zoomAt, type Camera, type Size } from './camera';
import { LevelGeometryCache } from './geometry-cache';
import { hitTest, marqueeSelect, type Hit } from './hit';
import { renderPlan, worldSpace, type RenderFrame, type RenderStats } from './render';
import { createLevelScene, sceneBox, syncLevelScene, type LevelScene } from './scene';
import { LIGHT_THEME, type PlanTheme } from './theme';
import { SelectTool } from './tools/select';
import { DEFAULT_TOOL_OPTIONS, type Clipboard, type Tool, type ToolHost, type ToolId, type ToolOptions, type ToolPointer } from './tools/tool';
import { WallTool } from './tools/wall';

export type UnderlayMode = 'none' | 'below' | 'above';

/** How far from an outline a click still hits, in CSS pixels. */
const HIT_PX = 6;

export interface EditorCallbacks {
  /** Runs a command on the open project. The host reports failures to the user. */
  invoke?(id: string, input: unknown): Promise<unknown>;
  onCameraChange?(camera: Camera): void;
  /** The cursor's world position, or null when it leaves the canvas. */
  onCursor?(world: Vec2 | null): void;
  onFrame?(stats: RenderStats): void;
  /** PageUp (+1) or PageDown (−1) on the canvas: the host switches level. */
  onLevelStep?(direction: 1 | -1): void;
  onToolChange?(tool: ToolId, hint: string): void;
  onSelectionChange?(ids: string[]): void;
  /** A right click: the host shows a menu for the selection (the hit entity is selected first). */
  onContextMenu?(event: MouseEvent, ids: string[]): void;
}

/**
 * The plan of one level on a canvas: a camera, the level's scene (and the reference level's), the
 * derived geometry (joined walls), the selection, the tools, pan and zoom from the mouse and
 * keyboard, and one render per animation frame. Framework-free: the Angular host attaches it to a
 * canvas, feeds it the document and reads it through callbacks.
 */
export class Plan2dEditor {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private size: Size = { width: 0, height: 0 };
  private dpr = 1;
  private theme: PlanTheme = LIGHT_THEME;
  private units: UnitSettings = defaultConfig().units;
  private doc: ProjectDoc | undefined;
  private levelId: string | null = null;
  private underlayMode: UnderlayMode = 'none';
  private readonly scenes = new Map<string, LevelScene>();
  private readonly geometry = new LevelGeometryCache();
  private cameraValue: Camera = defaultCamera();
  private fitted = false;
  private frameId = 0;
  private pan: { pointerId: number; x: number; y: number } | null = null;
  private spaceDown = false;
  private readonly listeners: (() => void)[] = [];
  private toolOptions: ToolOptions = DEFAULT_TOOL_OPTIONS;
  private readonly tools: Record<ToolId, Tool>;
  private activeTool: Tool;
  private selected = new Set<string>();
  clipboard: Clipboard | null = null;
  showGrid = true;
  lastStats: RenderStats = { drawn: 0, ms: 0 };

  constructor(private readonly callbacks: EditorCallbacks = {}) {
    const editor = this;
    const host: ToolHost = {
      invoke: (id, input) => this.callbacks.invoke?.(id, input) ?? Promise.resolve(undefined),
      levelId: () => this.levelId,
      entities: () => this.entities(),
      options: () => this.toolOptions,
      scale: () => this.cameraValue.scale,
      invalidate: () => this.invalidate(),
      finish: () => this.setTool('select'),
      selection: () => this.selected,
      select: (ids, mode) => this.select(ids, mode),
      hit: (p) => this.hit(p),
      marquee: (box, mode) => (this.levelScene ? marqueeSelect(this.levelScene, box, mode, this.hitOptions()) : []),
      walls: (exclude) => this.levelWalls(exclude),
      get clipboard() {
        return editor.clipboard;
      },
      set clipboard(value) {
        editor.clipboard = value;
      },
    };
    this.tools = { select: new SelectTool(host), wall: new WallTool(host) };
    this.activeTool = this.tools.select;
  }

  get camera(): Camera {
    return this.cameraValue;
  }

  /** The active level's scene, once a document and level are set. */
  get levelScene(): LevelScene | null {
    return this.levelId ? (this.scenes.get(this.levelId) ?? null) : null;
  }

  get tool(): ToolId {
    return this.activeTool.id;
  }

  get selection(): ReadonlySet<string> {
    return this.selected;
  }

  // ---------- host feed ----------

  attach(canvas: HTMLCanvasElement): void {
    this.detach();
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    const on = <K extends keyof HTMLElementEventMap>(type: K, handler: (e: HTMLElementEventMap[K]) => void, options?: AddEventListenerOptions) => {
      canvas.addEventListener(type, handler, options);
      this.listeners.push(() => canvas.removeEventListener(type, handler, options));
    };
    on('pointerdown', (e) => this.pointerDown(e));
    on('pointermove', (e) => this.pointerMove(e));
    on('pointerup', (e) => this.pointerUp(e));
    on('pointercancel', (e) => this.pointerUp(e));
    on('pointerleave', () => this.callbacks.onCursor?.(null));
    on('wheel', (e) => this.wheel(e), { passive: false });
    on('keydown', (e) => this.keyDown(e));
    on('keyup', (e) => this.keyUp(e));
    on('blur', () => {
      this.spaceDown = false;
      this.pan = null;
    });
    on('contextmenu', (e) => this.contextMenu(e));
    this.invalidate();
  }

  detach(): void {
    for (const off of this.listeners.splice(0)) off();
    if (this.frameId && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this.frameId);
    this.frameId = 0;
    this.canvas = null;
    this.ctx = null;
  }

  /** The canvas's CSS size and the device pixel ratio; the backing store follows. */
  resize(width: number, height: number, dpr: number): void {
    this.size = { width, height };
    this.dpr = dpr;
    if (this.canvas) {
      const w = Math.max(1, Math.round(width * dpr));
      const h = Math.max(1, Math.round(height * dpr));
      if (this.canvas.width !== w) this.canvas.width = w;
      if (this.canvas.height !== h) this.canvas.height = h;
    }
    this.invalidate();
  }

  setTheme(theme: PlanTheme): void {
    this.theme = theme;
    this.invalidate();
  }

  setUnits(units: UnitSettings): void {
    this.units = units;
    this.invalidate();
  }

  setDocument(doc: ProjectDoc | undefined): void {
    this.doc = doc;
    this.sync();
    const entities = this.entities();
    this.activeTool.documentChanged?.(entities);
    // Whatever vanished (an agent's delete, an undo) leaves the selection.
    const kept = [...this.selected].filter((id) => id in entities);
    if (kept.length !== this.selected.size) this.select(kept);
  }

  setLevel(levelId: string | null): void {
    if (levelId !== this.levelId) {
      this.activeTool.cancel();
      this.select([]);
    }
    this.levelId = levelId;
    this.sync();
  }

  setUnderlay(mode: UnderlayMode): void {
    this.underlayMode = mode;
    this.sync();
  }

  /** A camera restored from view state (or chosen by the host); it counts as fitted. */
  setCamera(camera: Camera): void {
    this.fitted = true;
    this.moveCamera(camera);
  }

  setToolOptions(options: ToolOptions): void {
    this.toolOptions = options;
    this.invalidate();
  }

  setTool(id: ToolId): void {
    if (this.activeTool.id !== id) {
      this.activeTool.cancel();
      this.activeTool = this.tools[id];
    }
    this.callbacks.onToolChange?.(id, this.activeTool.hint());
    this.invalidate();
  }

  select(ids: Iterable<string>, mode: 'replace' | 'add' | 'toggle' = 'replace'): void {
    const next = mode === 'replace' ? new Set<string>() : new Set(this.selected);
    for (const id of ids) {
      if (mode === 'toggle' && next.has(id)) next.delete(id);
      else next.add(id);
    }
    const same = next.size === this.selected.size && [...next].every((id) => this.selected.has(id));
    if (same) return;
    this.selected = next;
    this.callbacks.onSelectionChange?.([...next]);
    this.callbacks.onToolChange?.(this.activeTool.id, this.activeTool.hint());
    this.invalidate();
  }

  // ---------- navigation ----------

  zoomBy(factor: number, at?: Vec2): void {
    const point = at ?? [this.size.width / 2, this.size.height / 2];
    this.moveCamera(zoomAt(this.cameraValue, this.size, point, factor));
  }

  /** Fits what is on screen: the level and, when shown, the reference level. */
  zoomToFit(): void {
    const box = this.contentBox();
    if (!box) {
      this.moveCamera({ ...defaultCamera() });
      return;
    }
    this.fitted = true;
    this.moveCamera(fitBox(box, this.size));
  }

  screenToWorld(screen: Vec2): Vec2 {
    return screenToWorld(this.cameraValue, this.size, screen);
  }

  /** The level the underlay shows for the active one, by the stack order. */
  underlayLevelId(): string | null {
    if (!this.doc || !this.levelId || this.underlayMode === 'none') return null;
    const levels = deriveLevels(this.doc);
    const i = levels.findIndex((l) => l.id === this.levelId);
    if (i < 0) return null;
    return levels[i + (this.underlayMode === 'below' ? -1 : 1)]?.id ?? null;
  }

  /** The active level's entities (empty when none). */
  entities(): Record<string, Entity> {
    return (this.doc && this.levelId ? this.doc.levelData[this.levelId]?.entities : undefined) ?? {};
  }

  /** The joined walls of the active level, leaving out walls on hidden layers and `exclude`. */
  levelWalls(exclude?: ReadonlySet<string>): LevelWalls | null {
    const entities = this.doc && this.levelId ? this.doc.levelData[this.levelId]?.entities : undefined;
    if (!entities) return null;
    const out = new Set<string>(exclude ?? []);
    for (const id in entities) {
      const e = entities[id];
      if (e.type === 'wall' && this.doc!.layers[e.layerId]?.visible === false) out.add(id);
    }
    return this.geometry.walls(entities, out);
  }

  hit(p: Vec2): Hit | null {
    return this.levelScene ? hitTest(this.levelScene, p, this.hitOptions()) : null;
  }

  invalidate(): void {
    if (this.frameId || !this.ctx || typeof requestAnimationFrame === 'undefined') return;
    this.frameId = requestAnimationFrame(() => {
      this.frameId = 0;
      this.render();
    });
  }

  // ---------- internals ----------

  private hitOptions() {
    return { tolerance: HIT_PX / this.cameraValue.scale, layers: this.layers(), walls: this.levelWalls() };
  }

  private contentBox(): Box | null {
    let box = emptyBox();
    const under = this.underlayLevelId();
    for (const scene of [this.levelScene, under ? this.scenes.get(under) : null]) {
      if (!scene) continue;
      const b = sceneBox(scene);
      box = { minX: Math.min(box.minX, b.minX), minY: Math.min(box.minY, b.minY), maxX: Math.max(box.maxX, b.maxX), maxY: Math.max(box.maxY, b.maxY) };
    }
    return Number.isFinite(box.minX) ? box : null;
  }

  private moveCamera(camera: Camera): void {
    if (sameCamera(camera, this.cameraValue)) return;
    this.cameraValue = camera;
    this.callbacks.onCameraChange?.(camera);
    this.invalidate();
  }

  private sync(): void {
    const wanted = new Set<string>();
    if (this.doc && this.levelId && this.doc.levelData[this.levelId]) wanted.add(this.levelId);
    const under = this.underlayLevelId();
    if (under && this.doc?.levelData[under]) wanted.add(under);
    for (const id of [...this.scenes.keys()]) if (!wanted.has(id)) this.scenes.delete(id);
    for (const id of wanted) {
      let scene = this.scenes.get(id);
      if (!scene) {
        scene = createLevelScene(id);
        this.scenes.set(id, scene);
      }
      syncLevelScene(scene, this.doc!.levelData[id].entities);
    }
    this.invalidate();
  }

  private layers(): Record<string, Layer> {
    return this.doc?.layers ?? {};
  }

  private render(): void {
    if (!this.ctx) return;
    if (this.size.width < 1 || this.size.height < 1) return;
    const scene = this.levelScene;
    if (!this.fitted) {
      const box = this.contentBox();
      if (box) {
        this.fitted = true;
        this.moveCamera(fitBox(box, this.size));
      }
    }
    const under = this.underlayLevelId();
    const frame: RenderFrame = {
      size: this.size,
      dpr: this.dpr,
      camera: this.cameraValue,
      theme: this.theme,
      units: this.units,
      layers: this.layers(),
      scene,
      walls: this.levelWalls(this.activeTool.excluded?.()),
      underlay: under ? (this.scenes.get(under) ?? null) : null,
      showGrid: this.showGrid,
    };
    this.lastStats = renderPlan(this.ctx, frame);
    if (this.activeTool.draw) {
      worldSpace(this.ctx, frame);
      this.activeTool.draw(this.ctx, frame);
    }
    this.callbacks.onFrame?.(this.lastStats);
  }

  private local(e: MouseEvent): Vec2 {
    const r = this.canvas!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private toolPointer(e: PointerEvent, screen: Vec2): ToolPointer {
    return { world: this.screenToWorld(screen), screen, button: e.button, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey };
  }

  private announceTool(): void {
    this.callbacks.onToolChange?.(this.activeTool.id, this.activeTool.hint());
  }

  private pointerDown(e: PointerEvent): void {
    this.canvas?.focus({ preventScroll: true });
    const screen = this.local(e);
    if (e.button === 1 || (e.button === 0 && this.spaceDown)) {
      e.preventDefault();
      this.pan = { pointerId: e.pointerId, x: screen[0], y: screen[1] };
      this.canvas?.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button === 0) this.canvas?.setPointerCapture(e.pointerId);
    this.activeTool.pointerDown?.(this.toolPointer(e, screen));
    this.announceTool();
  }

  private pointerMove(e: PointerEvent): void {
    const screen = this.local(e);
    if (this.pan && e.pointerId === this.pan.pointerId) {
      this.moveCamera(panBy(this.cameraValue, screen[0] - this.pan.x, screen[1] - this.pan.y));
      this.pan = { ...this.pan, x: screen[0], y: screen[1] };
    } else {
      const busy = this.activeTool.busy;
      this.activeTool.pointerMove?.(this.toolPointer(e, screen));
      if (this.activeTool.busy !== busy) this.announceTool();
    }
    this.callbacks.onCursor?.(this.screenToWorld(screen));
  }

  private pointerUp(e: PointerEvent): void {
    if (this.canvas?.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (this.pan && e.pointerId === this.pan.pointerId) {
      this.pan = null;
      return;
    }
    this.activeTool.pointerUp?.(this.toolPointer(e, this.local(e)));
    this.announceTool();
  }

  private contextMenu(e: MouseEvent): void {
    e.preventDefault();
    if (this.activeTool.busy) return;
    const hit = this.hit(this.screenToWorld(this.local(e)));
    if (hit && !this.selected.has(hit.id)) this.select([hit.id]);
    this.callbacks.onContextMenu?.(e, [...this.selected]);
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    const factor = Math.min(2, Math.max(0.5, Math.exp(-e.deltaY * 0.002)));
    this.zoomBy(factor, this.local(e));
  }

  private keyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      if (this.activeTool.busy) this.activeTool.cancel();
      else if (this.activeTool.id !== 'select') this.setTool('select');
      else this.select([]);
      this.announceTool();
      e.preventDefault();
      return;
    }
    // The tool first (it may take Ctrl combinations such as Ctrl+C); the shell only sees what is left.
    if (this.activeTool.key?.(e)) {
      this.announceTool();
      e.preventDefault();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === ' ') {
      this.spaceDown = true;
      e.preventDefault();
    } else if (e.key === 'Home') {
      this.zoomToFit();
      e.preventDefault();
    } else if (e.key === 'PageUp' || e.key === 'PageDown') {
      this.callbacks.onLevelStep?.(e.key === 'PageUp' ? 1 : -1);
      e.preventDefault();
    } else if (e.key === 'v' || e.key === 'V') {
      this.setTool('select');
      e.preventDefault();
    } else if (e.key === 'w' || e.key === 'W') {
      this.setTool('wall');
      e.preventDefault();
    }
  }

  private keyUp(e: KeyboardEvent): void {
    if (e.key === ' ') this.spaceDown = false;
  }
}
