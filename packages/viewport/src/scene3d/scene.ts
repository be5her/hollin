import { deriveConnectorsSolids, deriveLevelSolids, deriveLevels, meshBox, type ConnectorSolids, type DerivedLevel, type LevelSolids, type ProjectDoc, type RuleLimits, type SolidKind, type SolidPart, type Vec3 } from '@studio/core';
import { BufferAttribute, BufferGeometry, Color, DoubleSide, EdgesGeometry, FrontSide, Group, LineBasicMaterial, LineSegments, Mesh, MeshLambertMaterial } from 'three';
import { LIGHT_SCENE_THEME, kindColor, type SceneTheme } from './theme';

/** Kinds drawn with their edges as lines; thin rails would be all edges. */
const EDGED = new Set<SolidKind>(['wall', 'slab', 'column', 'connector', 'glass', 'car']);
/** Faces meeting at more than this angle (degrees) get an edge line. */
const EDGE_ANGLE = 25;
const KINDS: SolidKind[] = ['wall', 'slab', 'column', 'glass', 'connector', 'rail', 'car'];

/** What a mesh in the scene stands for, for picking. */
export interface SceneHit {
  levelId: string;
  kind: SolidKind;
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
  key: readonly unknown[];
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
  private levelsList: DerivedLevel[] = [];

  constructor(theme: SceneTheme = LIGHT_SCENE_THEME) {
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

  /** Brings the scene up to date with the document; true when anything was rebuilt. */
  update(doc: ProjectDoc, options: BuildOptions): boolean {
    const levels = deriveLevels(doc);
    this.levelsList = levels;
    let changed = false;
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
        group.add(solids, connectors);
        group.userData['levelId'] = level.id;
        this.root.add(group);
        node = { level, group, solids, connectors, key, data };
        this.nodes.set(level.id, node);
      } else {
        clear(node.solids);
        node.level = level;
        node.key = key;
        node.data = data;
      }
      for (const part of data.parts) node.solids.add(...this.objects(part, { levelId: level.id, kind: part.kind, ids: part.ids }));
    }
    for (const [id, node] of this.nodes) {
      if (seen.has(id)) continue;
      clear(node.group);
      this.root.remove(node.group);
      this.nodes.delete(id);
      changed = true;
    }
    const connectorKey = [doc.connectors, doc.levels, doc.building, options.limits, levels.map((l) => l.id).join(',')];
    if (changed || !sameKey(this.connectorKey, connectorKey)) {
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
    }
    for (const c of this.connectorData) {
      const node = this.nodes.get(c.levelId);
      if (!node?.group.visible) continue;
      for (const part of c.parts) grow(meshBox(part.mesh), node.group.position.z);
    }
    if (!Number.isFinite(min[0])) return null;
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
    clear(this.root);
    this.nodes.clear();
    for (const m of this.materials.values()) m.dispose();
    this.edgeMaterial.dispose();
  }

  private objects(part: SolidPart, hit: SceneHit): (Mesh | LineSegments)[] {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(part.mesh.positions, 3));
    geometry.computeVertexNormals();
    const mesh = new Mesh(geometry, this.materials.get(part.kind)!);
    mesh.userData['hit'] = hit;
    if (part.kind === 'glass') mesh.renderOrder = 1;
    if (!EDGED.has(part.kind)) return [mesh];
    const edges = new LineSegments(new EdgesGeometry(geometry, EDGE_ANGLE), this.edgeMaterial);
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

