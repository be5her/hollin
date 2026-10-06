import { defaultConfig, deriveLevels, emptyBox, type Box, type Layer, type ProjectDoc, type UnitSettings, type Vec2 } from '@studio/core';
import { defaultCamera, fitBox, panBy, sameCamera, screenToWorld, zoomAt, type Camera, type Size } from './camera';
import { renderPlan, type RenderStats } from './render';
import { createLevelScene, sceneBox, syncLevelScene, type LevelScene } from './scene';
import { LIGHT_THEME, type PlanTheme } from './theme';

export type UnderlayMode = 'none' | 'below' | 'above';

export interface EditorCallbacks {
  onCameraChange?(camera: Camera): void;
  /** The cursor's world position, or null when it leaves the canvas. */
  onCursor?(world: Vec2 | null): void;
  onFrame?(stats: RenderStats): void;
  /** PageUp (+1) or PageDown (−1) on the canvas: the host switches level. */
  onLevelStep?(direction: 1 | -1): void;
}

/**
 * The plan of one level on a canvas: a camera, the level's scene (and the reference level's), pan
 * and zoom from the mouse and keyboard, and one render per animation frame. Framework-free: the
 * Angular host attaches it to a canvas, feeds it the document and reads it through callbacks.
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
  private cameraValue: Camera = defaultCamera();
  private fitted = false;
  private frameId = 0;
  private pan: { pointerId: number; x: number; y: number } | null = null;
  private spaceDown = false;
  private readonly listeners: (() => void)[] = [];
  showGrid = true;
  lastStats: RenderStats = { drawn: 0, ms: 0 };

  constructor(private readonly callbacks: EditorCallbacks = {}) {}

  get camera(): Camera {
    return this.cameraValue;
  }

  /** The active level's scene, once a document and level are set. */
  get levelScene(): LevelScene | null {
    return this.levelId ? (this.scenes.get(this.levelId) ?? null) : null;
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
    on('contextmenu', (e) => e.preventDefault());
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
  }

  setLevel(levelId: string | null): void {
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

  invalidate(): void {
    if (this.frameId || !this.ctx || typeof requestAnimationFrame === 'undefined') return;
    this.frameId = requestAnimationFrame(() => {
      this.frameId = 0;
      this.render();
    });
  }

  // ---------- internals ----------

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
    this.lastStats = renderPlan(this.ctx, {
      size: this.size,
      dpr: this.dpr,
      camera: this.cameraValue,
      theme: this.theme,
      units: this.units,
      layers: this.layers(),
      scene,
      underlay: under ? (this.scenes.get(under) ?? null) : null,
      showGrid: this.showGrid,
    });
    this.callbacks.onFrame?.(this.lastStats);
  }

  private local(e: PointerEvent | WheelEvent): Vec2 {
    const r = this.canvas!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private pointerDown(e: PointerEvent): void {
    this.canvas?.focus({ preventScroll: true });
    if (e.button === 1 || (e.button === 0 && this.spaceDown)) {
      e.preventDefault();
      const [x, y] = this.local(e);
      this.pan = { pointerId: e.pointerId, x, y };
      this.canvas?.setPointerCapture(e.pointerId);
    }
  }

  private pointerMove(e: PointerEvent): void {
    const [x, y] = this.local(e);
    if (this.pan && e.pointerId === this.pan.pointerId) {
      this.moveCamera(panBy(this.cameraValue, x - this.pan.x, y - this.pan.y));
      this.pan = { ...this.pan, x, y };
    }
    this.callbacks.onCursor?.(this.screenToWorld([x, y]));
  }

  private pointerUp(e: PointerEvent): void {
    if (this.pan && e.pointerId === this.pan.pointerId) {
      this.pan = null;
      if (this.canvas?.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    }
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    const factor = Math.min(2, Math.max(0.5, Math.exp(-e.deltaY * 0.002)));
    this.zoomBy(factor, this.local(e));
  }

  private keyDown(e: KeyboardEvent): void {
    if (e.key === ' ') {
      this.spaceDown = true;
      e.preventDefault();
    } else if (e.key === 'Home') {
      this.zoomToFit();
      e.preventDefault();
    } else if (e.key === 'PageUp' || e.key === 'PageDown') {
      this.callbacks.onLevelStep?.(e.key === 'PageUp' ? 1 : -1);
      e.preventDefault();
    }
  }

  private keyUp(e: KeyboardEvent): void {
    if (e.key === ' ') this.spaceDown = false;
  }
}
