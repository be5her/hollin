import type { ProjectDoc, RuleLimits } from '@studio/core';
import { Color, DirectionalLight, HemisphereLight, Matrix4, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { FOV, ORBIT_PRESETS, fitOrbit, orbitBy, orbitEye, orbitPan, orbitZoomAt, type Orbit, type OrbitPreset } from './orbit';
import { BuildingScene, type BuildOptions } from './scene';
import { LIGHT_SCENE_THEME, type SceneTheme } from './theme';

/** What a frame showed, for the component to mirror. */
export interface Scene3dFrame {
  orbit: Orbit;
  /** World mm (z up) to clip space, column-major: the smoke test turns building points into window pixels with it. */
  viewProjection: number[];
  frameMs: number;
  meshes: number;
  /** The levels drawn, bottom to top. */
  levels: string[];
}

export interface Scene3dCallbacks {
  /** After every frame drawn. */
  onFrame?: (frame: Scene3dFrame) => void;
  /** When a gesture or a fit moved the camera (not when `setOrbit` did). */
  onOrbit?: (orbit: Orbit) => void;
}

/** Degrees turned per pixel dragged. */
const ORBIT_SPEED = 0.35;
/** How far the pointer may move before a press becomes a drag, px. */
const DRAG_SLOP = 4;
/** The world is drawn in metres: the solids' millimetres scaled down, so depth precision suits a building. */
const MM = 0.001;
/**
 * Light intensities (three's physical units, where a Lambert surface reflects intensity / π of its
 * colour): the sky alone gives upward faces about 0.9 of their colour and walls about 0.6; the key
 * light adds about a third more to the faces turned to it.
 */
const SKY_LIGHT = 2.9;
const KEY_LIGHT = 1.15;
/** The key light comes from the camera's upper left, so whichever side is in view reads in three tones. */
const KEY_TURN = 40;
const KEY_ELEVATION = 35;

/**
 * The 3D view on a canvas, framework-free: a WebGL renderer over a `BuildingScene`, lit by a sky
 * light and a key light (no shadows, so software GL keeps up), drawn only when something changed.
 * Left-drag orbits, right- or middle-drag (or Shift+left) pans, the wheel zooms at the cursor, Home
 * fits. The constructor throws when the canvas cannot give a WebGL context.
 */
export class Scene3dView {
  readonly building: BuildingScene;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(FOV, 1, 0.05, 5000);
  private readonly key = new DirectionalLight('#ffffff', KEY_LIGHT);
  private orbit: Orbit = { target: [0, 0, 0], distance: 20_000, azimuth: ORBIT_PRESETS.iso.azimuth, elevation: ORBIT_PRESETS.iso.elevation };
  private size = { width: 1, height: 1 };
  private pending = 0;
  private placed = false;
  private drag: { id: number; x: number; y: number; mode: 'orbit' | 'pan'; moved: boolean } | null = null;
  private readonly detach: () => void;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly callbacks: Scene3dCallbacks = {},
    theme: SceneTheme = LIGHT_SCENE_THEME,
  ) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true });
    this.camera.up.set(0, 0, 1);
    this.building = new BuildingScene(theme);
    this.building.root.scale.setScalar(MM);
    // The sky is above: z is up here, and a hemisphere light takes its up from its position.
    const sky = new HemisphereLight('#ffffff', '#8c8a84', SKY_LIGHT);
    sky.position.set(0, 0, 1);
    this.scene.add(sky, this.key, this.key.target, this.building.root);
    this.setTheme(theme);
    this.detach = this.listen();
  }

  setTheme(theme: SceneTheme): void {
    this.building.setTheme(theme);
    this.scene.background = new Color(theme.background);
    this.requestRender();
  }

  setSize(width: number, height: number, dpr: number): void {
    this.size = { width: Math.max(1, width), height: Math.max(1, height) };
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.size.width, this.size.height, false);
    this.camera.aspect = this.size.width / this.size.height;
    this.requestRender();
  }

  /**
   * Brings the scene up to date with the document; the first time there is something to show, the
   * camera fits it (unless an orbit was set). That fit is not reported to `onOrbit`: it is no choice
   * of the user's, and a stored orbit arriving after it still wins.
   */
  setDocument(doc: ProjectDoc, options: BuildOptions): void {
    if (this.building.update(doc, options)) this.requestRender();
    if (!this.placed && this.building.box()) this.fit(undefined, false);
  }

  getOrbit(): Orbit {
    return this.orbit;
  }

  /** Puts the camera where a stored or chosen orbit says, without telling `onOrbit`. */
  setOrbit(orbit: Orbit): void {
    this.orbit = orbit;
    this.placed = true;
    this.requestRender();
  }

  /** Shows the whole building, from a preset direction or the current one; `notify` reports it to `onOrbit`. */
  fit(preset?: OrbitPreset, notify = true): void {
    const box = this.building.box();
    const direction = preset ? ORBIT_PRESETS[preset] : this.orbit;
    if (!box) {
      this.orbit = { ...this.orbit, azimuth: direction.azimuth, elevation: direction.elevation };
    } else {
      this.orbit = fitOrbit(box, this.size.width / this.size.height, direction);
      this.placed = true;
    }
    if (notify) this.moved();
    else this.requestRender();
  }

  requestRender(): void {
    if (this.pending) return;
    this.pending = requestAnimationFrame(() => {
      this.pending = 0;
      this.render();
    });
  }

  dispose(): void {
    if (this.pending) cancelAnimationFrame(this.pending);
    this.detach();
    this.building.dispose();
    this.renderer.dispose();
  }

  private render(): void {
    const started = performance.now();
    const o = this.orbit;
    const eye = orbitEye(o);
    this.camera.position.set(eye[0] * MM, eye[1] * MM, eye[2] * MM);
    const d = o.distance * MM;
    this.camera.near = Math.max(0.02, d / 500);
    this.camera.far = d * 20 + 200;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(o.target[0] * MM, o.target[1] * MM, o.target[2] * MM);
    this.camera.updateMatrixWorld();
    const a = ((o.azimuth - KEY_TURN) * Math.PI) / 180;
    const e = (KEY_ELEVATION * Math.PI) / 180;
    this.key.target.position.set(o.target[0] * MM, o.target[1] * MM, o.target[2] * MM);
    this.key.position.set(o.target[0] * MM + Math.cos(e) * Math.cos(a), o.target[1] * MM + Math.cos(e) * Math.sin(a), o.target[2] * MM + Math.sin(e));
    this.renderer.render(this.scene, this.camera);
    const viewProjection = new Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse).multiply(new Matrix4().makeScale(MM, MM, MM));
    this.callbacks.onFrame?.({
      orbit: o,
      viewProjection: viewProjection.elements.slice(),
      frameMs: performance.now() - started,
      meshes: this.building.meshCount(),
      levels: this.building.levels.filter((l) => this.building.levelGroup(l.id)?.visible).map((l) => l.id),
    });
  }

  private moved(): void {
    this.requestRender();
    this.callbacks.onOrbit?.(this.orbit);
  }

  private listen(): () => void {
    const c = this.canvas;
    const down = (e: PointerEvent) => {
      if (this.drag) return;
      const pan = e.button === 1 || e.button === 2 || (e.button === 0 && e.shiftKey);
      if (e.button !== 0 && !pan) return;
      c.setPointerCapture(e.pointerId);
      c.focus();
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, mode: pan ? 'pan' : 'orbit', moved: false };
      e.preventDefault();
    };
    const move = (e: PointerEvent) => {
      const d = this.drag;
      if (!d || e.pointerId !== d.id) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
      d.moved = true;
      d.x = e.clientX;
      d.y = e.clientY;
      this.placed = true;
      this.orbit = d.mode === 'orbit' ? orbitBy(this.orbit, -dx * ORBIT_SPEED, dy * ORBIT_SPEED) : orbitPan(this.orbit, dx, dy, this.size.height);
      this.moved();
    };
    const up = (e: PointerEvent) => {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      if (c.hasPointerCapture(e.pointerId)) c.releasePointerCapture(e.pointerId);
      this.drag = null;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      this.placed = true;
      this.orbit = orbitZoomAt(this.orbit, Math.exp(e.deltaY * 0.0015), { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 }, this.size.height);
      this.moved();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Home') {
        e.preventDefault();
        this.fit();
      }
    };
    const menu = (e: Event) => e.preventDefault();
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', wheel, { passive: false });
    c.addEventListener('keydown', key);
    c.addEventListener('contextmenu', menu);
    return () => {
      c.removeEventListener('pointerdown', down);
      c.removeEventListener('pointermove', move);
      c.removeEventListener('pointerup', up);
      c.removeEventListener('pointercancel', up);
      c.removeEventListener('wheel', wheel);
      c.removeEventListener('keydown', key);
      c.removeEventListener('contextmenu', menu);
    };
  }
}
