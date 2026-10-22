import { StudioError } from '../errors';
import type { Mesh, Vec3 } from '../solids/mesh';

/**
 * glTF 2.0 binary (GLB) files, read and written without a library: enough to check a model before
 * it enters the catalog (its structure, every accessor inside its buffer, extensions this app cannot
 * draw) and to measure it, and to write simple meshes (the smoke test's model, Milestone 9's export).
 *
 * glTF is Y-up in metres; the app is Z-up in millimetres. A glTF point (x, y, z) is the app's
 * (1000 x, −1000 z, 1000 y): a model's front, which faces +Z in glTF, faces −y (south) on the plan.
 */

const MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

/** Extensions three's loader cannot use without decoders this app does not ship. */
const REFUSED: Record<string, string> = {
  KHR_draco_mesh_compression: 'Draco-compressed meshes',
  EXT_meshopt_compression: 'meshopt-compressed buffers',
  KHR_texture_basisu: 'KTX2 (Basis) textures',
};

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const COMPONENT_BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
  min?: number[];
  max?: number[];
  normalized?: boolean;
}
interface GltfBufferView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
}
interface GltfNode {
  mesh?: number;
  children?: number[];
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}
interface GltfPrimitive {
  attributes: Record<string, number>;
  indices?: number;
  mode?: number;
  material?: number;
}
export interface GltfJson {
  asset?: { version?: string; generator?: string };
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: GltfNode[];
  meshes?: { name?: string; primitives: GltfPrimitive[] }[];
  accessors?: GltfAccessor[];
  bufferViews?: GltfBufferView[];
  buffers?: { byteLength: number; uri?: string }[];
  materials?: unknown[];
  images?: { uri?: string; bufferView?: number; mimeType?: string }[];
  extensionsUsed?: string[];
  extensionsRequired?: string[];
  [key: string]: unknown;
}

export interface ModelInfo {
  /** The model's extent in the app's terms: mm, z up. */
  min: Vec3;
  max: Vec3;
  size: Vec3;
  meshes: number;
  triangles: number;
}

function bad(message: string): never {
  throw new StudioError('INVALID_INPUT', `Not a usable glTF model: ${message}`);
}

/** The JSON and binary chunks of a GLB file, checked for structure. */
export function readGlbChunks(bytes: Uint8Array): { json: GltfJson; bin: Uint8Array | null } {
  if (bytes.length < 20) bad('the file is too short');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== MAGIC) bad('it is not a GLB file (no glTF header)');
  if (view.getUint32(4, true) !== 2) bad(`glTF version ${view.getUint32(4, true)} is not supported (only 2)`);
  const length = view.getUint32(8, true);
  if (length !== bytes.length) bad(`the header says ${length} bytes but the file has ${bytes.length} (truncated?)`);
  let offset = 12;
  let json: GltfJson | null = null;
  let bin: Uint8Array | null = null;
  while (offset < length) {
    if (offset + 8 > length) bad('a chunk header runs past the end of the file');
    const chunkLength = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + chunkLength > length) bad('a chunk runs past the end of the file');
    const data = bytes.subarray(start, start + chunkLength);
    if (type === CHUNK_JSON) {
      if (json) bad('it has two JSON chunks');
      try {
        json = JSON.parse(new TextDecoder().decode(data)) as GltfJson;
      } catch {
        bad('its JSON chunk is not valid JSON');
      }
    } else if (type === CHUNK_BIN) {
      if (!json) bad('the binary chunk comes before the JSON chunk');
      if (bin) bad('it has two binary chunks');
      bin = data;
    }
    offset = start + chunkLength + ((4 - (chunkLength % 4)) % 4);
  }
  if (!json || typeof json !== 'object') bad('it has no JSON chunk');
  return { json: json!, bin };
}

/** The bytes of each buffer: the GLB's binary chunk for buffer 0 without a uri, or an embedded data URI. */
function bufferBytes(json: GltfJson, bin: Uint8Array | null): Uint8Array[] {
  return (json.buffers ?? []).map((buffer, i) => {
    if (!Number.isInteger(buffer.byteLength) || buffer.byteLength < 0) bad(`buffer ${i} has no valid byteLength`);
    let data: Uint8Array;
    if (buffer.uri === undefined) {
      if (i !== 0 || !bin) bad(`buffer ${i} has no data`);
      data = bin!;
    } else data = decodeDataUri(buffer.uri, `buffer ${i}`);
    if (data.length < buffer.byteLength) bad(`buffer ${i} is shorter than it says (${data.length} of ${buffer.byteLength} bytes)`);
    return data.subarray(0, buffer.byteLength);
  });
}

function decodeDataUri(uri: string, what: string): Uint8Array {
  const m = /^data:[^;,]*;base64,(.*)$/s.exec(uri);
  if (!m) bad(`${what} refers to an outside file (${uri.slice(0, 60)}); embed it, or export a .glb`);
  let text: string;
  try {
    text = atob(m![1]);
  } catch {
    return bad(`${what} is not valid base64`);
  }
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
  return out;
}

/** Checks the model's structure: extensions, buffers, buffer views, accessors, meshes and nodes. */
function validate(json: GltfJson, buffers: Uint8Array[]): void {
  if (json.asset?.version && !/^2\./.test(json.asset.version)) bad(`glTF version ${json.asset.version} is not supported (only 2.x)`);
  for (const ext of [...(json.extensionsUsed ?? []), ...(json.extensionsRequired ?? [])]) {
    if (REFUSED[ext]) bad(`it uses ${REFUSED[ext]} (${ext}), which this app cannot read; export it without compression`);
  }
  for (const [i, image] of (json.images ?? []).entries()) {
    if (image.uri !== undefined && !image.uri.startsWith('data:')) bad(`image ${i} refers to an outside file (${image.uri.slice(0, 60)}); embed it, or export a .glb`);
    if (image.mimeType === 'image/ktx2') bad('it uses KTX2 textures, which this app cannot read');
  }
  const views = json.bufferViews ?? [];
  for (const [i, v] of views.entries()) {
    const buffer = buffers[v.buffer];
    if (!buffer) bad(`buffer view ${i} names a buffer that does not exist`);
    const start = v.byteOffset ?? 0;
    if (!Number.isInteger(start) || !Number.isInteger(v.byteLength) || start < 0 || v.byteLength < 0 || start + v.byteLength > buffer.length) bad(`buffer view ${i} runs past the end of its buffer`);
  }
  for (const [i, a] of (json.accessors ?? []).entries()) {
    const components = COMPONENTS[a.type];
    const size = COMPONENT_BYTES[a.componentType];
    if (!components || !size) bad(`accessor ${i} has an unknown type`);
    if (!Number.isInteger(a.count) || a.count < 1) bad(`accessor ${i} has no elements`);
    if (a.bufferView === undefined) continue;
    const view = views[a.bufferView];
    if (!view) bad(`accessor ${i} names a buffer view that does not exist`);
    const element = components * size;
    const stride = view.byteStride ?? element;
    const end = (a.byteOffset ?? 0) + stride * (a.count - 1) + element;
    if (end > view.byteLength) bad(`accessor ${i} reads past the end of its buffer view`);
  }
  const accessors = json.accessors ?? [];
  for (const [m, mesh] of (json.meshes ?? []).entries()) {
    if (!Array.isArray(mesh.primitives) || !mesh.primitives.length) bad(`mesh ${m} has no primitives`);
    for (const p of mesh.primitives) {
      const position = p.attributes?.POSITION;
      if (position === undefined || !accessors[position]) bad(`mesh ${m} has a primitive without positions`);
      if (accessors[position].type !== 'VEC3') bad(`mesh ${m}'s positions are not 3D points`);
      for (const index of Object.values(p.attributes)) if (!accessors[index]) bad(`mesh ${m} names an accessor that does not exist`);
      if (p.indices !== undefined && !accessors[p.indices]) bad(`mesh ${m} names an index accessor that does not exist`);
    }
  }
  const nodes = json.nodes ?? [];
  for (const [i, n] of nodes.entries()) {
    if (n.mesh !== undefined && !json.meshes?.[n.mesh]) bad(`node ${i} names a mesh that does not exist`);
    for (const c of n.children ?? []) if (!nodes[c]) bad(`node ${i} names a child that does not exist`);
  }
  for (const scene of json.scenes ?? []) for (const n of scene.nodes ?? []) if (!nodes[n]) bad('a scene names a node that does not exist');
}

type Mat4 = number[];
const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** a × b, column-major as glTF stores them. */
function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return out;
}

function localMatrix(node: GltfNode): Mat4 {
  if (node.matrix?.length === 16) return node.matrix;
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

const apply = (m: Mat4, p: readonly number[]): [number, number, number] => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];

/** An accessor's own min and max, or (when a writer left them out) read from float data. */
function accessorBounds(json: GltfJson, buffers: Uint8Array[], index: number): { min: number[]; max: number[] } {
  const a = json.accessors![index];
  if (a.min?.length === 3 && a.max?.length === 3) return { min: a.min, max: a.max };
  if (a.componentType !== 5126 || a.bufferView === undefined) bad(`accessor ${index} has no min and max`);
  const view = json.bufferViews![a.bufferView!];
  const bytes = buffers[view.buffer];
  const data = new DataView(bytes.buffer, bytes.byteOffset + (view.byteOffset ?? 0) + (a.byteOffset ?? 0));
  const stride = view.byteStride ?? 12;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < a.count; i++) {
    for (let k = 0; k < 3; k++) {
      const v = data.getFloat32(i * stride + k * 4, true);
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}

/** glTF metres, Y up, to the app's millimetres, Z up. */
export const fromGltf = (p: readonly number[]): Vec3 => [p[0] * 1000, -p[2] * 1000, p[1] * 1000];
/** The app's millimetres, Z up, to glTF metres, Y up. */
export const toGltf = (p: readonly number[]): [number, number, number] => [p[0] / 1000, p[2] / 1000, -p[1] / 1000];

/**
 * Checks a parsed glTF and measures it: the extent of every mesh primitive's positions through the
 * node transforms of the default scene (every root node when it names none), in mm with z up.
 */
export function inspectGltf(json: GltfJson, bin: Uint8Array | null): ModelInfo {
  const buffers = bufferBytes(json, bin);
  validate(json, buffers);
  const nodes = json.nodes ?? [];
  const scene = json.scenes?.[json.scene ?? 0];
  const children = new Set(nodes.flatMap((n) => n.children ?? []));
  const roots = scene?.nodes ?? nodes.map((_, i) => i).filter((i) => !children.has(i));
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let meshes = 0;
  let triangles = 0;
  const seen = new Set<number>();
  const visit = (index: number, parent: Mat4) => {
    if (seen.has(index)) bad('its node tree has a cycle');
    seen.add(index);
    const node = nodes[index];
    const world = multiply(parent, localMatrix(node));
    if (node.mesh !== undefined) {
      meshes++;
      for (const p of json.meshes![node.mesh].primitives) {
        const count = p.indices !== undefined ? json.accessors![p.indices].count : json.accessors![p.attributes.POSITION].count;
        if ((p.mode ?? 4) === 4) triangles += Math.floor(count / 3);
        const box = accessorBounds(json, buffers, p.attributes.POSITION);
        for (let c = 0; c < 8; c++) {
          const corner = [c & 1 ? box.max[0] : box.min[0], c & 2 ? box.max[1] : box.min[1], c & 4 ? box.max[2] : box.min[2]];
          const q = fromGltf(apply(world, corner));
          for (let k = 0; k < 3; k++) {
            if (q[k] < min[k]) min[k] = q[k];
            if (q[k] > max[k]) max[k] = q[k];
          }
        }
      }
    }
    for (const child of node.children ?? []) visit(child, world);
    seen.delete(index);
  };
  for (const root of roots) visit(root, IDENTITY);
  if (!meshes || !Number.isFinite(min[0])) bad('it has no meshes to show');
  const round = (v: number) => Math.round(v * 1000) / 1000;
  const lo: Vec3 = [round(min[0]), round(min[1]), round(min[2])];
  const hi: Vec3 = [round(max[0]), round(max[1]), round(max[2])];
  return { min: lo, max: hi, size: [round(hi[0] - lo[0]), round(hi[1] - lo[1]), round(hi[2] - lo[2])], meshes, triangles };
}

/** Reads and measures a GLB file. Throws INVALID_INPUT with the reason when it is damaged or unusable. */
export function inspectGlb(bytes: Uint8Array): ModelInfo {
  const { json, bin } = readGlbChunks(bytes);
  return inspectGltf(json, bin);
}

const pad4 = (n: number) => (4 - (n % 4)) % 4;

/** A GLB file from a glTF JSON and its one binary buffer. */
export function packGlb(json: GltfJson, bin: Uint8Array | null): Uint8Array {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = jsonBytes.length + pad4(jsonBytes.length);
  const binLength = bin ? bin.length + pad4(bin.length) : 0;
  const total = 12 + 8 + jsonLength + (bin ? 8 + binLength : 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, CHUNK_JSON, true);
  out.set(jsonBytes, 20);
  out.fill(0x20, 20 + jsonBytes.length, 20 + jsonLength);
  if (bin) {
    const at = 20 + jsonLength;
    view.setUint32(at, binLength, true);
    view.setUint32(at + 4, CHUNK_BIN, true);
    out.set(bin, at + 8);
  }
  return out;
}

/**
 * A `.gltf` whose buffers are embedded data URIs, as one GLB: the buffers are joined into the binary
 * chunk (each on a 4-byte boundary) and the buffer views point into it. Images keep their data URIs.
 */
export function gltfToGlb(json: GltfJson): Uint8Array {
  const buffers = bufferBytes(json, null);
  const offsets: number[] = [];
  let length = 0;
  for (const b of buffers) {
    offsets.push(length);
    length += b.length + pad4(b.length);
  }
  const bin = new Uint8Array(length);
  buffers.forEach((b, i) => bin.set(b, offsets[i]));
  const next: GltfJson = {
    ...json,
    buffers: buffers.length ? [{ byteLength: length }] : [],
    bufferViews: (json.bufferViews ?? []).map((v) => ({ ...v, buffer: 0, byteOffset: (v.byteOffset ?? 0) + (offsets[v.buffer] ?? 0) })),
  };
  return packGlb(next, buffers.length ? bin : null);
}

/** One mesh to write: triangles in glTF space (metres, y up), counter-clockwise, with a base colour. */
export interface GlbMesh {
  name?: string;
  positions: Float32Array;
  normals?: Float32Array;
  indices?: Uint32Array;
  /** Linear RGBA, 0–1. */
  color: readonly [number, number, number, number];
  metallic?: number;
  roughness?: number;
}

/** Writes meshes as a GLB file: one node per mesh, each with its own base-colour material. */
export function writeGlb(meshes: readonly GlbMesh[], options: { generator?: string } = {}): Uint8Array {
  const parts: Uint8Array[] = [];
  let length = 0;
  const bufferViews: GltfBufferView[] = [];
  const accessors: GltfAccessor[] = [];
  const add = (data: Float32Array | Uint32Array, target: number, accessor: Omit<GltfAccessor, 'bufferView'>) => {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    bufferViews.push({ buffer: 0, byteOffset: length, byteLength: bytes.length, target } as GltfBufferView);
    parts.push(bytes);
    length += bytes.length;
    const pad = pad4(length);
    if (pad) {
      parts.push(new Uint8Array(pad));
      length += pad;
    }
    accessors.push({ ...accessor, bufferView: bufferViews.length - 1 });
    return accessors.length - 1;
  };
  const gltfMeshes: GltfJson['meshes'] = [];
  const materials: unknown[] = [];
  for (const [i, mesh] of meshes.entries()) {
    const count = mesh.positions.length / 3;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let v = 0; v < count; v++) {
      for (let k = 0; k < 3; k++) {
        const x = mesh.positions[v * 3 + k];
        if (x < min[k]) min[k] = x;
        if (x > max[k]) max[k] = x;
      }
    }
    const attributes: Record<string, number> = { POSITION: add(mesh.positions, 34962, { componentType: 5126, count, type: 'VEC3', min, max }) };
    if (mesh.normals) attributes.NORMAL = add(mesh.normals, 34962, { componentType: 5126, count, type: 'VEC3' });
    const primitive: GltfPrimitive = { attributes, material: i, mode: 4 };
    if (mesh.indices) primitive.indices = add(mesh.indices, 34963, { componentType: 5125, count: mesh.indices.length, type: 'SCALAR' });
    gltfMeshes.push({ ...(mesh.name ? { name: mesh.name } : {}), primitives: [primitive] });
    materials.push({ pbrMetallicRoughness: { baseColorFactor: [...mesh.color], metallicFactor: mesh.metallic ?? 0, roughnessFactor: mesh.roughness ?? 0.8 } });
  }
  const bin = new Uint8Array(length);
  let at = 0;
  for (const p of parts) {
    bin.set(p, at);
    at += p.length;
  }
  const json: GltfJson = {
    asset: { version: '2.0', generator: options.generator ?? 'studio' },
    scene: 0,
    scenes: [{ nodes: meshes.map((_, i) => i) }],
    nodes: meshes.map((m, i) => ({ mesh: i, ...(m.name ? { name: m.name } : {}) })),
    meshes: gltfMeshes,
    materials,
    accessors,
    bufferViews,
    buffers: length ? [{ byteLength: length }] : [],
  };
  return packGlb(json, length ? bin : null);
}

/** A core mesh (mm, z up, flat triangles) in glTF space, with a normal per vertex from its triangle. */
export function meshToGlb(mesh: Mesh, color: GlbMesh['color'], name?: string): GlbMesh {
  const src = mesh.positions;
  const positions = new Float32Array(src.length);
  const normals = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) positions.set(toGltf([src[i], src[i + 1], src[i + 2]]), i);
  for (let i = 0; i < positions.length; i += 9) {
    const ux = positions[i + 3] - positions[i], uy = positions[i + 4] - positions[i + 1], uz = positions[i + 5] - positions[i + 2];
    const vx = positions[i + 6] - positions[i], vy = positions[i + 7] - positions[i + 1], vz = positions[i + 8] - positions[i + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    for (let k = 0; k < 3; k++) normals.set([nx, ny, nz], i + k * 3);
  }
  return { ...(name ? { name } : {}), positions, normals, color };
}
