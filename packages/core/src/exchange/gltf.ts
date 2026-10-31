import type { RuleLimits } from '../config';
import { builtinMaterial } from '../decor/builtin';
import { matrixToGltf, meshToGlb, readGlbTriangles, writeGlbScene, type GlbMesh, type GlbNode, type GlbTriangles, type GltfAlphaMode } from '../decor/glb';
import { itemMatrix, itemModel } from '../decor/items';
import { recipeMeshes } from '../decor/recipes';
import { parseRef } from '../decor/refs';
import { deriveLevels } from '../doc/derive';
import type { ProjectDoc } from '../doc/schema';
import { deriveBuildingSolids, type SolidKind, type SolidPart } from '../solids/building';
import type { Mesh } from '../solids/mesh';

/**
 * The colour each kind of solid is drawn in when the design names no material: the 3D view's light
 * palette (the viewport's `LIGHT_SCENE_THEME` takes its kind colours from here). Frames, leaves and
 * finishes without a material are drawn in the walls' colour.
 */
export const SOLID_COLORS: Readonly<Record<SolidKind, string>> = {
  wall: '#efe6d6',
  slab: '#cdbea7',
  column: '#ddd1bd',
  glass: '#9bb9c7',
  connector: '#d5c2a3',
  rail: '#5a4f45',
  car: '#b9552f',
  frame: '#efe6d6',
  leaf: '#efe6d6',
  finish: '#efe6d6',
};

/** How see-through the 3D view draws glass without a material. */
const GLASS_OPACITY = 0.35;
/** The colour a material reference that does not resolve is drawn in, as in the view. */
const FALLBACK = '#b8b4ac';

/** The order kinds are written in, and the name of each kind's node. */
const KIND_NODES: readonly [SolidKind, string][] = [
  ['wall', 'Walls'],
  ['slab', 'Slabs'],
  ['column', 'Columns'],
  ['glass', 'Glass'],
  ['frame', 'Frames'],
  ['leaf', 'Leaves'],
  ['finish', 'Finishes'],
  ['connector', 'Steps'],
  ['rail', 'Rails'],
  ['car', 'Car'],
];

const CONNECTOR_NAMES: Record<string, string> = { stair: 'Stair', ladder: 'Ladder', ramp: 'Ramp', elevator: 'Elevator', escalator: 'Escalator' };

/** An sRGB colour (`#rrggbb`) as linear RGB, 0–1: what glTF's `baseColorFactor` holds. */
export function srgbToLinear(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0xb8b4ac;
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return [lin((n >> 16) & 255), lin((n >> 8) & 255), lin(n & 255)];
}

/** What a material looks like in the file. */
interface Look {
  name: string;
  color: [number, number, number, number];
  metallic: number;
  roughness: number;
  doubleSided?: boolean;
  /** An imported model's own alpha mode, kept as its file has it. */
  alphaMode?: GltfAlphaMode;
  alphaCutoff?: number;
}

const look = (name: string, hex: string, roughness: number, metallic = 0, opacity = 1): Look => ({
  name,
  color: [...srgbToLinear(hex), opacity],
  metallic,
  roughness,
  ...(opacity < 1 ? { doubleSided: true } : {}),
});

/** A design material (`builtin:<id>`, `paint:#rrggbb`) as the 3D view draws it; its pattern is left out (the material's colour stands for it). */
export function materialLook(ref: string | undefined, fallback: Look = look(ref ?? 'default', FALLBACK, 0.8)): Look {
  const parsed = ref ? parseRef(ref) : null;
  if (parsed?.k === 'builtin') {
    const m = builtinMaterial(parsed.id);
    if (m) return look(ref!, m.color, m.roughness, m.metalness, m.opacity ?? 1);
  }
  if (parsed?.k === 'paint') return look(ref!, parsed.color, 0.85);
  return fallback;
}

/** A solid's look: its material when it has one, else its kind's colour (glass see-through). */
function partLook(part: SolidPart): Look {
  if (part.material) return materialLook(part.material);
  return look(part.kind, SOLID_COLORS[part.kind], 0.9, 0, part.kind === 'glass' ? GLASS_OPACITY : 1);
}

function glbMesh(mesh: Mesh, l: Look): GlbMesh {
  return {
    ...meshToGlb(mesh, l.color),
    material: l.name,
    metallic: l.metallic,
    roughness: l.roughness,
    ...(l.doubleSided ? { doubleSided: true } : {}),
    ...(l.alphaMode ? { alphaMode: l.alphaMode } : {}),
    ...(l.alphaCutoff !== undefined ? { alphaCutoff: l.alphaCutoff } : {}),
  };
}

export interface BuildingGlbOptions {
  limits: RuleLimits;
  /** The levels to write (every level by default); a connector goes with the level it starts on. */
  levelIds?: readonly string[];
  /** Furniture (default true). Lights are never written. */
  includeItems?: boolean;
  /** Floor, wall and ceiling finishes (default true). */
  includeFinishes?: boolean;
  /** The bytes of a project asset by its `asset:` reference, for imported models; undefined when the file is missing. */
  assetBytes?: (ref: string) => Uint8Array | undefined;
  generator?: string;
}

export interface BuildingGlb {
  glb: Uint8Array;
  /** Nodes written, the root included. */
  nodes: number;
  triangles: number;
  /** What was left out and why (an imported model whose file is missing, unreadable or without triangles). */
  skipped: string[];
}

/**
 * The building as one self-contained glTF 2.0 binary (GLB), in metres with y up: a root node named
 * after the project, a child per level (bottom to top, named after it) holding a node per kind of
 * solid (`Walls`, `Slabs`, `Glass`, `Finishes` ..., a primitive per material), a node per connector
 * starting on it (named by its type, `Stair`, `Elevator` ..., and its name when it has one) and a node
 * per furniture item (named after its model, placed by its 4 × 4 `itemMatrix`). Materials are what
 * the 3D view draws: builtin materials' colour, roughness, metalness and opacity, paints, each kind's
 * colour otherwise; see-through ones blend and are double-sided. An imported model keeps its own
 * materials' alpha, alpha mode and sides. Lights are not written.
 */
export function buildingToGlb(doc: ProjectDoc, options: BuildingGlbOptions): BuildingGlb {
  const includeItems = options.includeItems ?? true;
  const includeFinishes = options.includeFinishes ?? true;
  const levels = deriveLevels(doc);
  const wanted = new Set(options.levelIds ?? levels.map((l) => l.id));
  const solids = deriveBuildingSolids(doc, { limits: options.limits, levels });
  const skipped: string[] = [];
  let triangles = 0;
  const count = (meshes: GlbMesh[]) => {
    for (const m of meshes) triangles += m.positions.length / 9;
    return meshes;
  };
  const models = new Map<string, GlbTriangles[] | null>();
  const modelTriangles = (ref: string): GlbTriangles[] | null => {
    if (!models.has(ref)) {
      const bytes = options.assetBytes?.(ref);
      let read: GlbTriangles[] | null = null;
      if (bytes) {
        try {
          read = readGlbTriangles(bytes);
        } catch {
          read = null;
        }
      }
      models.set(ref, read);
    }
    return models.get(ref)!;
  };

  const levelNodes: GlbNode[] = [];
  for (const level of levels) {
    if (!wanted.has(level.id)) continue;
    const data = solids.levels.find((l) => l.levelId === level.id);
    const parts = (data?.parts ?? []).filter((p) => includeFinishes || p.kind !== 'finish');
    const children: GlbNode[] = [];
    for (const [kind, name] of KIND_NODES) {
      const ofKind = parts.filter((p) => p.kind === kind && p.mesh.positions.length);
      if (ofKind.length) children.push({ name, meshes: count(ofKind.map((p) => glbMesh(p.mesh, partLook(p)))) });
    }
    for (const c of solids.connectors) {
      if (c.levelId !== level.id) continue;
      const own = doc.connectors[c.id]?.name?.trim();
      const meshes = c.parts.filter((p) => p.mesh.positions.length).map((p) => glbMesh(p.mesh, partLook(p)));
      if (meshes.length) children.push({ name: own ? `${CONNECTOR_NAMES[c.kind]} ${own}` : CONNECTOR_NAMES[c.kind], meshes: count(meshes) });
    }
    if (includeItems) {
      const entities = doc.levelData[level.id]?.entities ?? {};
      for (const id in entities) {
        const e = entities[id];
        if (e.type !== 'item' || doc.layers[e.layerId]?.visible === false) continue;
        const model = itemModel(e.asset, doc.assets);
        let meshes: GlbMesh[] = [];
        if (model.recipe) {
          const recipe = model.recipe;
          meshes = recipeMeshes(recipe).map(({ slot, mesh }) => glbMesh(mesh, materialLook(e.materials[slot] ?? recipe.slots[slot])));
        } else if (model.asset) {
          const read = modelTriangles(e.asset);
          if (!read) {
            skipped.push(`${model.name} (${e.id}): its model file ${e.asset} is missing or unreadable`);
            continue;
          }
          meshes = read
            .filter((t) => t.positions.length)
            .map((t) => {
              const repaint = e.materials[t.material];
              const l: Look = repaint
                ? materialLook(repaint)
                : { name: t.material || model.name, color: [...t.color, t.alpha], metallic: 0, roughness: 0.8, alphaMode: t.alphaMode, ...(t.alphaCutoff !== undefined ? { alphaCutoff: t.alphaCutoff } : {}), ...(t.doubleSided ? { doubleSided: true } : {}) };
              return glbMesh({ positions: t.positions }, l);
            });
          if (!meshes.length) {
            skipped.push(`${model.name} (${e.id}): its model file ${e.asset} has no triangles to write`);
            continue;
          }
        } else {
          skipped.push(`${model.name} (${e.id}): ${e.asset} is not registered in the project`);
          continue;
        }
        if (meshes.length) children.push({ name: model.name, matrix: matrixToGltf(itemMatrix(e, model, level.elevation)), meshes: count(meshes) });
      }
    }
    levelNodes.push({ name: doc.levels[level.id]?.name ?? level.id, children });
  }
  const root: GlbNode = { name: doc.meta.name, children: levelNodes };
  const nodeCount = (n: GlbNode): number => 1 + (n.children ?? []).reduce((s, c) => s + nodeCount(c), 0);
  return { glb: writeGlbScene(root, { generator: options.generator }), nodes: nodeCount(root), triangles, skipped };
}
