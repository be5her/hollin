import { deriveConnectorsSolids, deriveLevelSolids, deriveLevels, meshBox, type BuildingSolids, type ConnectorSolids, type DerivedLevel, type LevelSolids, type ProjectDoc, type RuleLimits, type SolidKind, type SolidPart, type Vec3 } from '@studio/core';
import { LevelDecor, type PlacedLight } from './decor';
import { DecorMaterials } from './materials';
import { ModelCache } from './models';
import { BufferAttribute, BufferGeometry, Color, DoubleSide, EdgesGeometry, FrontSide, Group, LineBasicMaterial, LineSegments, Mesh, MeshLambertMaterial, Plane, Vector3 } from 'three';
import { LIGHT_SCENE_THEME, kindColor, type SceneTheme } from './theme';

/** Kinds drawn with their edges as lines; thin rails would be all edges. */
const EDGED = new Set<SolidKind>(['wall', 'slab', 'column', 'connector', 'glass', 'car', 'frame', 'leaf']);
/** Faces meeting at more than this angle (degrees) get an edge line. */
const EDGE_ANGLE = 25;
const KINDS: SolidKind[] = ['wall', 'slab', 'column', 'glass', 'connector', 'rail', 'car', 'frame', 'leaf'];
/**
 * Kinds the cutaway clips with a plane at the cut: what the solids do not cut themselves (the active
 * level's walls, columns and windows are cut exactly, with caps). Connectors running up from below
 * are cut there too.
 */
const CLIPPED = new Set<SolidKind>(['connector', 'rail', 'car', 'glass']);
/** How far apart a fully exploded view sets each level from the one below, mm. */
export const EXPLODE_GAP = 4000;

/** How the levels are shown. */
export type SceneMode = 'all' | 'isolate' | 'cutaway';
export interface SceneDisplay {
  /** All levels; the active level alone (with the connectors that start on it); or the active level and everything below it, its walls cut at `cutHeight`. */
  mode: SceneMode;
  levelId: string | null;
  /** 0 (stacked as built) to 1 (each level `EXPLODE_GAP` above the one below). */
  explode: number;
  /** Where the cutaway cuts the active level, mm above its floor. */
  cutHeight: number;
}

export const DEFAULT_DISPLAY: SceneDisplay = { mode: 'all', levelId: null, explode: 0, cutHeight: 1200 };

/** What a mesh in the scene stands for, for picking: a solid of some kind, or a furniture item. */
export interface SceneHit {
  levelId: string;
  kind: SolidKind | 'item';
  ids: string[];
  /** The connector it belongs to, when it is one. */
  connectorId?: string;
}

interface LevelNode {
  level: DerivedLevel;
  /** Placed for the display mode (explode moves it up). */
  group: Group;
  /** The level's own solids, rebuilt when its inputs change. */
  solids: Group;
  /** The connectors starting on this level, rebuilt with the connectors. */
  connectors: Group;
  /** Its furniture and lights, kept in step item by item. */
  decor: LevelDecor;
  key: readonly unknown[];
  decorKey: readonly unknown[];
  data: LevelSolids;
}

export interface BuildOptions {
  limits: RuleLimits;
  /** Cuts one level's walls this far above its floor (the cutaway view). */
  cut?: { levelId: string; height: number } | null;
}

/**
 * The building as three objects, built from `deriveLevelSolids` and `deriveConnectorsSolids`: one
 * group per level holding its solids and the connectors that start on it, in millimetres with z up
 * (the caller scales `root` into metres). `update` rebuilds only the levels whose inputs changed (a
 * level's entities, the levels, the layers, the connectors and the limits, compared by identity, as
 * the mirror replaces exactly what a patch touched).
 */
export class BuildingScene {
  readonly root = new Group();
  private readonly nodes = new Map<string, LevelNode>();
  private connectorKey: readonly unknown[] = [];
  private connectorData: ConnectorSolids[] = [];
  private readonly materials = new Map<SolidKind, MeshLambertMaterial>();
  private readonly edgeMaterial = new LineBasicMaterial({ color: LIGHT_SCENE_THEME.edge });
  /** The edges of the kinds the cutaway clips, clipped with them. */
  private readonly clippedEdgeMaterial = new LineBasicMaterial({ color: LIGHT_SCENE_THEME.edge });
  private levelsList: DerivedLevel[] = [];
  private display: SceneDisplay = DEFAULT_DISPLAY;
  /** The design's materials (frames, leaves, furniture), shared across levels. */
  readonly decorMaterials = new DecorMaterials();
  /** Imported models, loaded once; `models.version` changes as they arrive. */
  readonly models: ModelCache;
  private modelsVersion = 0;

  /** `onModel` is called when an imported model has arrived, so the caller can update and draw again. */
  constructor(theme: SceneTheme = LIGHT_SCENE_THEME, onModel: () => void = () => {}) {
    this.models = new ModelCache(() => {
      this.modelsVersion++;
      onModel();
    });
    for (const kind of KINDS) {
      const glass = kind === 'glass';
      this.materials.set(
        kind,
        new MeshLambertMaterial({
          color: kindColor(theme, kind),
          transparent: glass,
          opacity: glass ? 0.35 : 1,
          depthWrite: !glass,
          side: glass ? DoubleSide : FrontSide,
          // Faces sit a hair behind their edge lines, so the lines never flicker.
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
        }),
      );
    }
    this.setTheme(theme);
  }

  setTheme(theme: SceneTheme): void {
    for (const kind of KINDS) this.materials.get(kind)!.color = new Color(kindColor(theme, kind));
    this.edgeMaterial.color = new Color(theme.edge);
    this.clippedEdgeMaterial.color = new Color(theme.edge);
  }

  /**
   * Shows, hides and places the levels for a display mode (see `SceneDisplay`); kept and applied
   * again after every `update`. The cutaway's cut itself is a build option (`BuildOptions.cut`).
   */
  applyDisplay(display: SceneDisplay): void {
    this.display = display;
    const active = this.levelsList.find((l) => l.id === display.levelId) ?? null;
    const mode = active ? display.mode : 'all';
    let clipAt: number | null = null;
    this.levelsList.forEach((level, i) => {
      const node = this.nodes.get(level.id);
      if (!node) return;
      node.group.visible = mode === 'all' ? true : mode === 'isolate' ? level.id === active!.id : level.elevation <= active!.elevation + 1e-6;
      node.group.position.z = i * display.explode * EXPLODE_GAP;
      if (mode === 'cutaway' && level.id === active!.id) clipAt = level.elevation + display.cutHeight + node.group.position.z;
    });
    // The plane works in the world's units (the root is scaled to metres) and keeps what lies below it.
    const planes = clipAt === null ? [] : [new Plane(new Vector3(0, 0, -1), clipAt * this.root.scale.z)];
    for (const kind of CLIPPED) this.materials.get(kind)!.clippingPlanes = planes;
    this.clippedEdgeMaterial.clippingPlanes = planes;
    // Furniture above the cut goes with it.
    this.decorMaterials.setClipping(planes);
  }

  /** Every light of the design as built, on the levels shown. */
  lights(): PlacedLight[] {
    return [...this.nodes.values()].filter((n) => n.group.visible).flatMap((n) => n.decor.lights());
  }

  /** Resolves once every imported model asked for has arrived (or failed), for a snapshot. */
  modelsSettled(): Promise<void> {
    return this.models.settled();
  }

  /** Where the cutaway's plane is, mm (world, explode included), or null. */
  clipHeight(): number | null {
    const plane = this.materials.get('connector')!.clippingPlanes?.[0];
    return plane ? plane.constant / this.root.scale.z : null;
  }

  /** The levels as last built, bottom to top. */
  get levels(): readonly DerivedLevel[] {
    return this.levelsList;
  }

  /** A level's group (to show, hide or move it), or undefined. */
  levelGroup(levelId: string): Group | undefined {
    return this.nodes.get(levelId)?.group;
  }

  /** A level's solids as last built. */
  levelSolids(levelId: string): LevelSolids | undefined {
    return this.nodes.get(levelId)?.data;
  }

  /** The connectors as last built. */
  get connectorSolids(): readonly ConnectorSolids[] {
    return this.connectorData;
  }

  /** Everything as last built, bottom to top: what the walk camera walks on. */
  solids(): BuildingSolids {
    return { levels: this.levelsList.map((l) => this.nodes.get(l.id)?.data).filter((d): d is LevelSolids => d !== undefined), connectors: this.connectorData };
  }

  /** Brings the scene up to date with the document; true when anything was rebuilt. */
  update(doc: ProjectDoc, options: BuildOptions): boolean {
    const levels = deriveLevels(doc);
    this.levelsList = levels;
    let changed = false;
    // Levels added or removed: the connectors hang in the level groups, so they are placed again.
    let regrouped = false;
    const seen = new Set<string>();
    for (const level of levels) {
      seen.add(level.id);
      const cutHeight = options.cut?.levelId === level.id ? options.cut.height : undefined;
      const key = [doc.levelData[level.id]?.entities, doc.levels, doc.building, doc.layers, doc.connectors, options.limits, cutHeight];
      let node = this.nodes.get(level.id);
      if (node && sameKey(node.key, key)) {
        node.level = level;
        continue;
      }
      changed = true;
      const data = deriveLevelSolids(doc, level.id, { limits: options.limits, levels, cutHeight });
      if (!node) {
        const group = new Group();
        const solids = new Group();
        const connectors = new Group();
        const decor = new LevelDecor(level.id);
        group.add(solids, connectors, decor.group);
        group.userData['levelId'] = level.id;
        this.root.add(group);
        node = { level, group, solids, connectors, decor, key, decorKey: [], data };
        this.nodes.set(level.id, node);
        regrouped = true;
      } else {
        clear(node.solids);
        node.level = level;
        node.key = key;
        node.data = data;
      }
      for (const part of data.parts) node.solids.add(...this.objects(part, { levelId: level.id, kind: part.kind, ids: part.ids }));
    }
    // Furniture and lights, item by item: they change far more often than the walls.
    const project = doc.meta.id;
    for (const level of levels) {
      const node = this.nodes.get(level.id)!;
      const decorKey = [doc.levelData[level.id]?.entities, doc.assets, doc.layers, level.elevation, this.modelsVersion];
      if (sameKey(node.decorKey, decorKey)) continue;
      node.decorKey = decorKey;
      const ctx = { materials: this.decorMaterials, models: this.models, modelUrl: (file: string) => `library://project/${project}/assets/${file}` };
      if (node.decor.update(doc.levelData[level.id]?.entities ?? {}, doc.assets, doc.layers, level.elevation, ctx)) changed = true;
    }
    for (const [id, node] of this.nodes) {
      if (seen.has(id)) continue;
      node.decor.dispose();
      clear(node.group);
      this.root.remove(node.group);
      this.nodes.delete(id);
      changed = true;
      regrouped = true;
    }
    const connectorKey = [doc.connectors, doc.levels, doc.building, options.limits, levels.map((l) => l.id).join(',')];
    if (regrouped || !sameKey(this.connectorKey, connectorKey)) {
      this.connectorKey = connectorKey;
      this.connectorData = deriveConnectorsSolids(doc, options.limits, levels);
      for (const node of this.nodes.values()) clear(node.connectors);
      for (const c of this.connectorData) {
        const node = this.nodes.get(c.levelId);
        if (!node) continue;
        for (const part of c.parts) node.connectors.add(...this.objects(part, { levelId: c.levelId, kind: part.kind, ids: part.ids, connectorId: c.id }));
      }
      changed = true;
    }
    this.applyDisplay(this.display);
    return changed;
  }

  /** The extent of everything shown, mm; null when nothing is. */
  box(): { min: Vec3; max: Vec3 } | null {
    let min: [number, number, number] = [Infinity, Infinity, Infinity];
    let max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    const grow = (b: { min: Vec3; max: Vec3 } | null, dz: number) => {
      if (!b) return;
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], b.min[k] + (k === 2 ? dz : 0));
        max[k] = Math.max(max[k], b.max[k] + (k === 2 ? dz : 0));
      }
    };
    for (const node of this.nodes.values()) {
      if (!node.group.visible) continue;
      for (const part of node.data.parts) grow(meshBox(part.mesh), node.group.position.z);
      // Furniture counts too (a tree in the garden).
      for (const o of node.data.obstacles) {
        const pts = o.footprint.flat();
        if (pts.length) grow({ min: [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), o.z0], max: [Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1])), o.z1] }, node.group.position.z);
      }
    }
    for (const c of this.connectorData) {
      const node = this.nodes.get(c.levelId);
      if (!node?.group.visible) continue;
      for (const part of c.parts) grow(meshBox(part.mesh), node.group.position.z);
    }
    if (!Number.isFinite(min[0])) return null;
    // Nothing shows above the cutaway's plane, so a fit leaves it out.
    const clip = this.clipHeight();
    if (clip !== null) max[2] = Math.max(min[2], Math.min(max[2], clip));
    return { min, max };
  }

  /** The number of meshes shown (the smoke test reads it). */
  meshCount(): number {
    let n = 0;
    this.root.traverseVisible((o) => {
      if (o instanceof Mesh) n++;
    });
    return n;
  }

  dispose(): void {
    for (const node of this.nodes.values()) node.decor.dispose();
    clear(this.root);
    this.nodes.clear();
    this.decorMaterials.dispose();
    for (const m of this.materials.values()) m.dispose();
    this.edgeMaterial.dispose();
    this.clippedEdgeMaterial.dispose();
  }

  private objects(part: SolidPart, hit: SceneHit): (Mesh | LineSegments)[] {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(part.mesh.positions, 3));
    geometry.computeVertexNormals();
    const mesh = new Mesh(geometry, part.material ? this.decorMaterials.get(part.material) : this.materials.get(part.kind)!);
    mesh.userData['hit'] = hit;
    if (part.kind === 'glass') mesh.renderOrder = 1;
    if (!EDGED.has(part.kind)) return [mesh];
    const edges = new LineSegments(new EdgesGeometry(geometry, EDGE_ANGLE), CLIPPED.has(part.kind) ? this.clippedEdgeMaterial : this.edgeMaterial);
    edges.userData['hit'] = hit;
    return [mesh, edges];
  }
}

const sameKey = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Removes a group's children and frees their geometry (materials are shared and live as long as the scene). */
function clear(group: Group): void {
  for (const child of [...group.children]) {
    child.traverse((o) => {
      if (o instanceof Mesh || o instanceof LineSegments) (o.geometry as BufferGeometry).dispose();
    });
    group.remove(child);
  }
}

