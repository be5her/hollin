import { EYE_HEIGHT, floorAt, levelAt, nudgeOut, rideElevator, walkRelative, walkWorld, type ProjectDoc, type RuleLimits, type Vec3, type WalkWorld, type Walker } from '@studio/core';
import { Color, DirectionalLight, HemisphereLight, Matrix4, Mesh, PerspectiveCamera, Raycaster, Scene, Vector2, Vector3, WebGLRenderer, type Intersection, type Object3D } from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { FOV, ORBIT_PRESETS, fitOrbit, orbitBy, orbitEye, orbitPan, orbitZoomAt, type Orbit, type OrbitPreset } from './orbit';
import { BuildingScene, DEFAULT_DISPLAY, type SceneDisplay, type SceneHit } from './scene';
import { LIGHT_SCENE_THEME, type SceneTheme } from './theme';

/** Where the walk camera is: its feet (mm), the way it faces and looks (degrees), and the level it is on. */
export interface WalkState {
  at: Vec3;
  yaw: number;
  pitch: number;
  levelId: string | null;
}

/** Day: the sky and a key light. Night: a dim sky and the design's own lights. */
export type SceneLighting = 'day' | 'night';

/** What a frame showed, for the component to mirror. */
export interface Scene3dFrame {
  orbit: Orbit;
  /** World mm (z up) to clip space, column-major: the smoke test turns building points into window pixels with it. */
  viewProjection: number[];
  frameMs: number;
  meshes: number;
  /** The levels drawn, bottom to top. */
  levels: string[];
  /** Where the cutaway's plane clips the connectors, mm, or null. */
  clip: number | null;
  /** The walk camera, while walking. */
  walk: WalkState | null;
  lighting: SceneLighting;
  /** How many of the design's lights were on (at night, the nearest ones). */
  lightsOn: number;
}

export interface Scene3dCallbacks {
  /** After every frame drawn. */
  onFrame?: (frame: Scene3dFrame) => void;
  /** When a gesture or a fit moved the camera (not when `setOrbit` did). */
  onOrbit?: (orbit: Orbit) => void;
  /** A click (a press and release without a drag) on something drawn, or on nothing (null). */
  onPick?: (hit: SceneHit | null) => void;
  /** When the GPU took the WebGL context away (true) and when it gave it back (false); nothing is drawn in between. */
  onContextLost?: (lost: boolean) => void;
}

/** Degrees turned per pixel dragged. */
const ORBIT_SPEED = 0.35;
const LOOK_SPEED = 0.25;
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
/** At night the sky barely lights anything, and the background is dark whatever the theme. */
const NIGHT_SKY = 0.12;
const NIGHT_BACKGROUND = '#0f0d0b';
/** At most this many of the design's lights are on at once (the nearest to the camera), with no shadows, so software GL keeps up. */
export const MAX_LIGHTS = 16;
let areaLightsReady = false;
/** The key light comes from the camera's upper left, so whichever side is in view reads in three tones. */
const KEY_TURN = 40;
const KEY_ELEVATION = 35;
/** Walking speed, mm per second, and how much faster Shift goes. */
const WALK_SPEED = 1400;
const RUN = 2.5;
const MAX_PITCH = 85;
/** A frame longer than this is counted as this long, so a stall never throws the walker through a room. */
const MAX_FRAME_S = 0.1;
/** Keys that move the walker: forward, back, left, right. */
const MOVES: Record<string, [number, number]> = {
  w: [1, 0],
  arrowup: [1, 0],
  s: [-1, 0],
  arrowdown: [-1, 0],
  a: [0, -1],
  arrowleft: [0, -1],
  d: [0, 1],
  arrowright: [0, 1],
};

interface Walking {
  walker: Walker;
  pitch: number;
  /** The movement keys held down. */
  keys: Set<string>;
  run: boolean;
  /** When the last movement frame was drawn, ms. */
  last: number;
  /** The orbit to go back to. */
  orbit: Orbit;
}

/**
 * The 3D view on a canvas, framework-free: a WebGL renderer over a `BuildingScene`, lit by a sky
 * light and a key light (no shadows, so software GL keeps up), drawn only when something changed.
 * Left-drag orbits, right- or middle-drag (or Shift+left) pans, the wheel zooms at the cursor, Home
 * fits, a click picks. A double click on a floor starts walking there (see `startWalk`). The
 * constructor throws when the canvas cannot give a WebGL context.
 */
export class Scene3dView {
  readonly building: BuildingScene;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(FOV, 1, 0.05, 5000);
  private readonly key = new DirectionalLight('#ffffff', KEY_LIGHT);
  private readonly sky = new HemisphereLight('#ffffff', '#8c8a84', SKY_LIGHT);
  private lighting: SceneLighting = 'day';
  /** No background at all (a render laid over something else): the scene's background stays null. */
  private readonly transparent: boolean;
  private background = new Color(LIGHT_SCENE_THEME.background);
  /** The lights switched on, as a key, so they are switched (and the shaders rebuilt) only when the set changes. */
  private lightsKey = '';
  private lightsOn = 0;
  private orbit: Orbit = { target: [0, 0, 0], distance: 20_000, azimuth: ORBIT_PRESETS.iso.azimuth, elevation: ORBIT_PRESETS.iso.elevation };
  private size = { width: 1, height: 1 };
  private pending = 0;
  private placed = false;
  private drag: { id: number; x: number; y: number; mode: 'orbit' | 'pan' | 'look'; moved: boolean } | null = null;
  private doc: ProjectDoc | null = null;
  private limits: RuleLimits | null = null;
  private display: SceneDisplay = DEFAULT_DISPLAY;
  private walking: Walking | null = null;
  private world: WalkWorld | null = null;
  /** True while the WebGL context is lost: frames wait for it to be restored. */
  private contextLost = false;
  private readonly raycaster = new Raycaster();
  private readonly detach: () => void;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly callbacks: Scene3dCallbacks = {},
    theme: SceneTheme = LIGHT_SCENE_THEME,
    options: { preserveDrawingBuffer?: boolean; transparent?: boolean } = {},
  ) {
    this.transparent = options.transparent ?? false;
    this.renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: options.preserveDrawingBuffer ?? false, alpha: this.transparent });
    // Transparent: no sky colour behind the building, the canvas cleared to alpha 0.
    if (this.transparent) this.renderer.setClearColor(0x000000, 0);
    // The cutaway clips the connectors with a plane.
    this.renderer.localClippingEnabled = true;
    if (!areaLightsReady) {
      RectAreaLightUniformsLib.init();
      areaLightsReady = true;
    }
    this.camera.up.set(0, 0, 1);
    // An imported model arriving: place it where its items stand.
    this.building = new BuildingScene(theme, () => {
      this.rebuild();
      this.requestRender();
    });
    this.building.root.scale.setScalar(MM);
    // The sky is above: z is up here, and a hemisphere light takes its up from its position.
    this.sky.position.set(0, 0, 1);
    this.scene.add(this.sky, this.key, this.key.target, this.building.root);
    this.setTheme(theme);
    this.detach = this.listen();
  }

  setTheme(theme: SceneTheme): void {
    this.building.setTheme(theme);
    this.background = new Color(theme.background);
    this.requestRender();
  }

  /** Day (the sky and a key light) or night (a dim sky, and the nearest `MAX_LIGHTS` of the design's lights). */
  setLighting(lighting: SceneLighting): void {
    if (lighting === this.lighting) return;
    this.lighting = lighting;
    this.requestRender();
  }

  /** Waits for every imported model the design shows, then updates the scene with them (for a snapshot). */
  async modelsReady(): Promise<void> {
    await this.building.modelsSettled();
    this.rebuild();
  }

  /** The size of the drawing buffer WebGL actually gave, which can be smaller than asked for past the GPU's limits. */
  drawingBufferSize(): { width: number; height: number } {
    const gl = this.renderer.getContext();
    return { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight };
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
  setDocument(doc: ProjectDoc, limits: RuleLimits): void {
    this.doc = doc;
    this.limits = limits;
    this.rebuild();
    if (!this.placed && this.building.box()) this.fit(undefined, false);
  }

  /** Shows all levels, one, or one and those below it cut (see `SceneDisplay`), spread apart by `explode`. While walking, every level shows, whole and in place. */
  setDisplay(display: SceneDisplay): void {
    this.display = display;
    this.building.applyDisplay(this.shownDisplay());
    this.rebuild();
    this.requestRender();
  }

  /** What is drawn under a window point (the first visible mesh, above the cutaway's plane skipped), where, and which way its face looks; or null. */
  pick(clientX: number, clientY: number): SceneHit | null {
    const hit = this.intersect(clientX, clientY);
    const meant = hit ? (hit.object.userData['hit'] as SceneHit | undefined) : undefined;
    if (!hit || !meant) return null;
    const level = this.building.levels.find((l) => l.id === meant.levelId);
    const lift = this.building.levelGroup(meant.levelId)?.position.z ?? 0;
    const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : null;
    return { ...meant, point: [hit.point.x / MM, hit.point.y / MM, hit.point.z / MM - lift - (level?.elevation ?? 0)], ...(n ? { normal: [n.x, n.y, n.z] as Vec3 } : {}) };
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

  /** Shows the whole building, from a preset direction or the current one; `notify` reports it to `onOrbit`. Ends a walk. */
  fit(preset?: OrbitPreset, notify = true): void {
    this.fitFrom(preset ? ORBIT_PRESETS[preset] : this.orbit, notify);
  }

  /** Shows the whole building from a direction (degrees, as in `Orbit`). */
  fitFrom(direction: { azimuth: number; elevation: number }, notify = true): void {
    if (this.walking) this.stopWalk();
    const box = this.building.box();
    if (!box) {
      this.orbit = { ...this.orbit, azimuth: direction.azimuth, elevation: direction.elevation };
    } else {
      this.orbit = fitOrbit(box, this.size.width / this.size.height, direction);
      this.placed = true;
    }
    if (notify) this.moved();
    else this.requestRender();
  }

  /** True while the walk camera is on. */
  get isWalking(): boolean {
    return this.walking !== null;
  }

  /**
   * The walk camera: eyes 1.6 m above the feet at `at` (mm), facing `yaw`. W, A, S, D or the arrow
   * keys walk (Shift runs), up stairs and ramps and through doors but not walls (`walkRelative`), a
   * start inside furniture or against a wall moves to the nearest clear spot (`nudgeOut`), a
   * drag looks around, PageUp and PageDown ride the elevator stood in, Escape goes back to the orbit.
   * Every level shows, whole and in place, while walking.
   */
  startWalk(at: Vec3, yaw: number): void {
    const orbit = this.walking?.orbit ?? this.orbit;
    this.walking = { walker: { at, yaw: ((yaw % 360) + 360) % 360 }, pitch: 0, keys: new Set(), run: false, last: 0, orbit };
    this.building.applyDisplay(this.shownDisplay());
    this.rebuild();
    this.world = walkWorld(this.building.solids(), this.building.levels);
    // A start on a sofa or against a wall begins beside it, where the walker can move.
    this.walking.walker = { ...this.walking.walker, at: nudgeOut(this.world, at) };
    this.canvas.focus();
    this.requestRender();
  }

  stopWalk(): void {
    if (!this.walking) return;
    this.orbit = this.walking.orbit;
    this.walking = null;
    this.world = null;
    this.building.applyDisplay(this.shownDisplay());
    this.rebuild();
    this.requestRender();
  }

  /** Draws a frame now instead of on the next animation frame (an offscreen render). */
  renderNow(): void {
    if (this.pending) cancelAnimationFrame(this.pending);
    this.pending = 0;
    this.render();
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
    // Free the context now: a page may hold only a few at once, and snapshots make one each.
    this.renderer.forceContextLoss();
  }

  /** The display as shown: walking shows everything in place. */
  private shownDisplay(): SceneDisplay {
    return this.walking ? { ...this.display, mode: 'all', explode: 0 } : this.display;
  }

  /** The solids for the document and the cutaway's cut (rebuilding only what changed). */
  private rebuild(): void {
    if (!this.doc || !this.limits) return;
    const d = this.shownDisplay();
    const cut = d.mode === 'cutaway' && d.levelId ? { levelId: d.levelId, height: d.cutHeight } : null;
    if (this.building.update(this.doc, { limits: this.limits, cut })) {
      if (this.walking) this.world = walkWorld(this.building.solids(), this.building.levels);
      this.requestRender();
    }
  }

  /** The first visible mesh under a window point, anything above the cutaway's plane skipped; glass is looked through when `solid`. */
  private intersect(clientX: number, clientY: number, solid = false): Intersection | null {
    const r = this.canvas.getBoundingClientRect();
    this.raycaster.setFromCamera(new Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), this.camera);
    const clip = this.building.clipHeight();
    for (const hit of this.raycaster.intersectObject(this.building.root, true)) {
      if (!(hit.object instanceof Mesh) || !shown(hit.object)) continue;
      if (clip !== null && hit.point.z / MM > clip + 1) continue;
      if (solid && (hit.object.userData['hit'] as SceneHit | undefined)?.kind === 'glass') continue;
      return hit;
    }
    return null;
  }

  /** Moves the walker for the keys held since the last frame. */
  private step(now: number): void {
    const w = this.walking;
    if (!w || !this.world || !w.keys.size) return;
    const dt = w.last ? Math.min(MAX_FRAME_S, (now - w.last) / 1000) : 1 / 60;
    w.last = now;
    let forward = 0;
    let right = 0;
    for (const k of w.keys) {
      forward += MOVES[k][0];
      right += MOVES[k][1];
    }
    const length = Math.hypot(forward, right);
    if (!length) return;
    const distance = WALK_SPEED * (w.run ? RUN : 1) * dt;
    w.walker = walkRelative(this.world, w.walker, (forward / length) * distance, (right / length) * distance);
  }

  private render(): void {
    if (this.contextLost) return;
    const started = performance.now();
    const w = this.walking;
    if (w) this.step(started);
    let target: Vec3;
    let keyAzimuth: number;
    if (w) {
      const [x, y, z] = w.walker.at;
      const yaw = (w.walker.yaw * Math.PI) / 180;
      const pitch = (w.pitch * Math.PI) / 180;
      this.camera.position.set(x * MM, y * MM, (z + EYE_HEIGHT) * MM);
      this.camera.near = 0.05;
      this.camera.far = 1000;
      target = [x + Math.cos(pitch) * Math.cos(yaw) * 1000, y + Math.cos(pitch) * Math.sin(yaw) * 1000, z + EYE_HEIGHT + Math.sin(pitch) * 1000];
      keyAzimuth = w.walker.yaw + 180;
    } else {
      const o = this.orbit;
      const eye = orbitEye(o);
      this.camera.position.set(eye[0] * MM, eye[1] * MM, eye[2] * MM);
      const d = o.distance * MM;
      this.camera.near = Math.max(0.02, d / 500);
      this.camera.far = d * 20 + 200;
      target = o.target;
      keyAzimuth = o.azimuth;
    }
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(target[0] * MM, target[1] * MM, target[2] * MM);
    this.camera.updateMatrixWorld();
    this.applyLighting();
    const a = ((keyAzimuth - KEY_TURN) * Math.PI) / 180;
    const e = (KEY_ELEVATION * Math.PI) / 180;
    this.key.target.position.set(target[0] * MM, target[1] * MM, target[2] * MM);
    this.key.position.set(target[0] * MM + Math.cos(e) * Math.cos(a), target[1] * MM + Math.cos(e) * Math.sin(a), target[2] * MM + Math.sin(e));
    this.renderer.render(this.scene, this.camera);
    const viewProjection = new Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse).multiply(new Matrix4().makeScale(MM, MM, MM));
    this.callbacks.onFrame?.({
      orbit: this.orbit,
      viewProjection: viewProjection.elements.slice(),
      frameMs: performance.now() - started,
      meshes: this.building.meshCount(),
      levels: this.building.levels.filter((l) => this.building.levelGroup(l.id)?.visible).map((l) => l.id),
      clip: this.building.clipHeight(),
      walk: w ? { at: w.walker.at, yaw: w.walker.yaw, pitch: w.pitch, levelId: (this.world && levelAt(this.world, w.walker.at[2])?.id) ?? null } : null,
      lighting: this.lighting,
      lightsOn: this.lightsOn,
    });
    // Keep moving while a movement key is held.
    if (w?.keys.size) this.requestRender();
  }

  private moved(): void {
    this.requestRender();
    this.callbacks.onOrbit?.(this.orbit);
  }

  /** Day: the sky and the key light, the design's lights off. Night: a dim sky, a dark background, and the lights nearest the camera on. */
  private applyLighting(): void {
    const night = this.lighting === 'night';
    this.sky.intensity = night ? NIGHT_SKY : SKY_LIGHT;
    this.key.intensity = night ? 0 : KEY_LIGHT;
    this.scene.background = this.transparent ? null : night ? new Color(NIGHT_BACKGROUND) : this.background;
    const lights = this.building.lights();
    let on: typeof lights = [];
    if (night) {
      const eye = this.camera.position;
      const p = new Vector3();
      on = lights
        .map((l) => ({ l, d: l.object.getWorldPosition(p).distanceToSquared(eye) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, MAX_LIGHTS)
        .map((x) => x.l);
    }
    const key = on.map((l) => l.id).sort().join(',');
    this.lightsOn = on.length;
    if (key === this.lightsKey && lights.every((l) => l.object.visible === on.includes(l))) return;
    this.lightsKey = key;
    const set = new Set(on);
    for (const l of lights) l.object.visible = set.has(l);
  }

  /** Starts walking on the floor under a window point, facing away from the camera. */
  private walkFrom(clientX: number, clientY: number): void {
    const hit = this.intersect(clientX, clientY, true);
    if (!hit) return;
    const p: Vec3 = [hit.point.x / MM, hit.point.y / MM, hit.point.z / MM];
    // Explode lifts the levels apart; the walk happens with everything in place, so the point is looked up with the level it belongs to.
    const levelId = (hit.object.userData['hit'] as SceneHit | undefined)?.levelId;
    const lift = (levelId && this.building.levelGroup(levelId)?.position.z) || 0;
    const z = p[2] - lift;
    this.building.applyDisplay({ ...this.display, mode: 'all', explode: 0 });
    this.rebuild();
    const world = walkWorld(this.building.solids(), this.building.levels);
    const floor = floorAt(world, [p[0], p[1]], z + 1) ?? z;
    this.startWalk([p[0], p[1], floor], this.orbit.azimuth + 180);
  }

  private listen(): () => void {
    const c = this.canvas;
    const down = (e: PointerEvent) => {
      if (this.drag) return;
      const pan = e.button === 1 || e.button === 2 || (e.button === 0 && e.shiftKey);
      if (e.button !== 0 && !pan) return;
      c.setPointerCapture(e.pointerId);
      c.focus();
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, mode: this.walking ? 'look' : pan ? 'pan' : 'orbit', moved: false };
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
      if (d.mode === 'look') {
        const w = this.walking;
        if (!w) return;
        w.walker = { ...w.walker, yaw: (((w.walker.yaw - dx * LOOK_SPEED) % 360) + 360) % 360 };
        w.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, w.pitch - dy * LOOK_SPEED));
        this.requestRender();
        return;
      }
      this.placed = true;
      this.orbit = d.mode === 'orbit' ? orbitBy(this.orbit, -dx * ORBIT_SPEED, dy * ORBIT_SPEED) : orbitPan(this.orbit, dx, dy, this.size.height);
      this.moved();
    };
    const up = (e: PointerEvent) => {
      const d = this.drag;
      if (!d || e.pointerId !== d.id) return;
      if (c.hasPointerCapture(e.pointerId)) c.releasePointerCapture(e.pointerId);
      this.drag = null;
      if (!d.moved && d.mode === 'orbit' && e.type === 'pointerup') this.callbacks.onPick?.(this.pick(e.clientX, e.clientY));
    };
    const dblclick = (e: MouseEvent) => {
      if (this.walking) return;
      e.preventDefault();
      this.walkFrom(e.clientX, e.clientY);
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (this.walking) return;
      const r = c.getBoundingClientRect();
      this.placed = true;
      this.orbit = orbitZoomAt(this.orbit, Math.exp(e.deltaY * 0.0015), { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 }, this.size.height);
      this.moved();
    };
    const keyName = (e: KeyboardEvent) => (e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase());
    const keydown = (e: KeyboardEvent) => {
      const w = this.walking;
      if (!w) {
        if (e.key === 'Home') {
          e.preventDefault();
          this.fit();
        }
        return;
      }
      const k = keyName(e);
      w.run = e.shiftKey;
      if (k in MOVES) {
        e.preventDefault();
        e.stopPropagation();
        if (!w.keys.size) w.last = 0;
        w.keys.add(k);
        this.requestRender();
      } else if (k === 'pageup' || k === 'pagedown') {
        e.preventDefault();
        e.stopPropagation();
        const rode = this.world && rideElevator(this.world, w.walker, k === 'pageup' ? 1 : -1);
        if (rode) {
          w.walker = rode;
          this.requestRender();
        }
      } else if (k === 'escape') {
        e.preventDefault();
        e.stopPropagation();
        this.stopWalk();
      }
    };
    const keyup = (e: KeyboardEvent) => {
      const w = this.walking;
      if (!w) return;
      w.run = e.shiftKey;
      w.keys.delete(keyName(e));
    };
    const blur = () => this.walking?.keys.clear();
    const menu = (e: Event) => e.preventDefault();
    // Context loss (a GPU reset, a driver update): three keeps the scene and uploads it again on restore; the frame is drawn then.
    const lost = (e: Event) => {
      e.preventDefault();
      this.contextLost = true;
      this.callbacks.onContextLost?.(true);
    };
    const restored = () => {
      this.contextLost = false;
      this.callbacks.onContextLost?.(false);
      this.requestRender();
    };
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('dblclick', dblclick);
    c.addEventListener('wheel', wheel, { passive: false });
    c.addEventListener('keydown', keydown);
    c.addEventListener('keyup', keyup);
    c.addEventListener('blur', blur);
    c.addEventListener('contextmenu', menu);
    c.addEventListener('webglcontextlost', lost);
    c.addEventListener('webglcontextrestored', restored);
    return () => {
      c.removeEventListener('pointerdown', down);
      c.removeEventListener('pointermove', move);
      c.removeEventListener('pointerup', up);
      c.removeEventListener('pointercancel', up);
      c.removeEventListener('dblclick', dblclick);
      c.removeEventListener('wheel', wheel);
      c.removeEventListener('keydown', keydown);
      c.removeEventListener('keyup', keyup);
      c.removeEventListener('blur', blur);
      c.removeEventListener('contextmenu', menu);
      c.removeEventListener('webglcontextlost', lost);
      c.removeEventListener('webglcontextrestored', restored);
    };
  }
}

/** True when the object and every group above it are visible. */
function shown(o: Object3D | null): boolean {
  for (let p = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}
