import { itemMatrix, itemModel, recipeMeshes, type Asset, type Entity, type Layer, type ItemModel, type Vec3 } from '@studio/core';
import { BoxGeometry, BufferAttribute, BufferGeometry, Color, Group, Mesh, PointLight, RectAreaLight, SpotLight, type Light, type Material, type Object3D } from 'three';
import type { DecorMaterials } from './materials';
import type { ModelCache } from './models';

type Item = Extract<Entity, { type: 'item' }>;
type LightEntity = Extract<Entity, { type: 'light' }>;

/**
 * How bright the project's lights are drawn: their lumens, turned into candela (a point light: lm / 4π;
 * a spot: lm over its cone's solid angle; an area light: lm / (π × area) as luminance), times this,
 * so a 800 lm bulb lights a floor 2 m below to about half its colour with no tone mapping.
 */
export const LIGHT_SCALE = 0.1;
/** An area light's panel, mm. */
export const AREA_LIGHT_SIZE = 600;

/** A light of the design as three draws it, where it is in the building (mm, its level's explode not included). */
export interface PlacedLight {
  id: string;
  levelId: string;
  object: Light;
  at: Vec3;
}

export interface DecorContext {
  materials: DecorMaterials;
  models: ModelCache;
  /** The URL an imported model of the project is fetched from. */
  modelUrl(file: string): string;
  /** What a box standing in for a model is drawn in: the scene theme's `standIn` colour. */
  standIn: Material;
}

/** Recipe slot meshes as geometry, shared by every item made from that recipe. */
const geometries = new Map<string, BufferGeometry>();

function slotGeometry(recipeId: string, slot: string, mesh: { positions: Float32Array; uvs?: Float32Array }): BufferGeometry {
  const key = `${recipeId}|${slot}`;
  let g = geometries.get(key);
  if (!g) {
    g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(mesh.positions, 3));
    if (mesh.uvs) g.setAttribute('uv', new BufferAttribute(mesh.uvs, 2));
    g.computeVertexNormals();
    geometries.set(key, g);
  }
  return g;
}

/** The candela-like intensity three is given for a light. */
export function lightIntensity(e: Pick<LightEntity, 'kind' | 'intensity' | 'angle'>): number {
  if (e.kind === 'spot') {
    const half = (((e.angle ?? 60) / 2) * Math.PI) / 180;
    return (e.intensity / (2 * Math.PI * (1 - Math.cos(half)))) * LIGHT_SCALE;
  }
  if (e.kind === 'area') return (e.intensity / (Math.PI * (AREA_LIGHT_SIZE / 1000) ** 2)) * LIGHT_SCALE;
  return (e.intensity / (4 * Math.PI)) * LIGHT_SCALE;
}

/**
 * A level's furniture and lights in 3D, kept in step with its entities by identity: an item is built
 * again only when its entity, its level's elevation, its model (an imported one arriving) or its
 * layer's visibility changed. Items are placed by `itemMatrix` (core): a recipe's slot meshes in
 * their materials, or a clone of an imported model (its material slots repainted, found by the slot
 * `ModelCache` marked on each material), with a box in the theme's stand-in colour while a model
 * loads or when it cannot be (its geometry, the only one an item owns, freed when it goes).
 */
export class LevelDecor {
  readonly group = new Group();
  private readonly items = new Map<string, { entity: Item; object: Object3D; key: string }>();
  private readonly lightObjects = new Map<string, { entity: LightEntity; light: PlacedLight; key: string }>();

  constructor(private readonly levelId: string) {
    this.group.userData['decor'] = levelId;
  }

  /** The level's lights as built. */
  lights(): PlacedLight[] {
    return [...this.lightObjects.values()].map((l) => l.light);
  }

  update(entities: Record<string, Entity>, assets: Readonly<Record<string, Asset>>, layers: Record<string, Layer>, elevation: number, ctx: DecorContext): boolean {
    let changed = false;
    const seen = new Set<string>();
    for (const id in entities) {
      const e = entities[id];
      if (e.type !== 'item' && e.type !== 'light') continue;
      if (layers[e.layerId]?.visible === false) continue;
      seen.add(id);
      if (e.type === 'item') changed = this.updateItem(e, assets, elevation, ctx) || changed;
      else changed = this.updateLight(e, elevation) || changed;
    }
    for (const [id, built] of this.items) {
      if (seen.has(id)) continue;
      this.release(built.object);
      this.items.delete(id);
      changed = true;
    }
    for (const [id, built] of this.lightObjects) {
      if (seen.has(id)) continue;
      this.group.remove(built.light.object);
      if (built.light.object instanceof SpotLight) this.group.remove(built.light.object.target);
      built.light.object.dispose();
      this.lightObjects.delete(id);
      changed = true;
    }
    return changed;
  }

  dispose(): void {
    for (const built of this.lightObjects.values()) built.light.object.dispose();
    for (const built of this.items.values()) this.release(built.object);
    this.items.clear();
    this.lightObjects.clear();
    this.group.clear();
  }

  private updateItem(e: Item, assets: Readonly<Record<string, Asset>>, elevation: number, ctx: DecorContext): boolean {
    const model = itemModel(e.asset, assets);
    const file = model.asset?.file;
    const loaded = file ? ctx.models.get(ctx.modelUrl(file)) : null;
    // What the object depends on beyond the entity: the floor it stands on, and whether its model has arrived.
    const key = `${elevation}|${file ? (loaded === undefined ? 'loading' : loaded === null ? 'failed' : 'loaded') : ''}`;
    const built = this.items.get(e.id);
    if (built && built.entity === e && built.key === key) return false;
    if (built) this.release(built.object);
    const object = this.itemObject(e, model, loaded ?? null, ctx);
    object.matrixAutoUpdate = false;
    object.matrix.fromArray(itemMatrix(e, model, elevation));
    const hit = { levelId: this.levelId, kind: 'item', ids: [e.id] };
    object.traverse((o) => (o.userData['hit'] = hit));
    this.group.add(object);
    this.items.set(e.id, { entity: e, object, key });
    return true;
  }

  private itemObject(e: Item, model: ItemModel, loaded: Group | null, ctx: DecorContext): Object3D {
    const out = new Group();
    if (model.recipe) {
      for (const { slot, mesh } of recipeMeshes(model.recipe)) {
        const material = ctx.materials.get(e.materials[slot] ?? model.recipe.slots[slot]);
        out.add(new Mesh(slotGeometry(model.recipe.id, slot, mesh), material));
      }
      return out;
    }
    if (loaded) {
      const clone = loaded.clone(true);
      if (Object.keys(e.materials).length) {
        clone.traverse((o) => {
          if (!(o instanceof Mesh)) return;
          // GLTFLoader shades a primitive without normals flat; its repaint keeps that.
          const repaint = (m: Material) => {
            const ref = e.materials[(m.userData['slot'] as string | undefined) ?? m.name];
            return ref ? ctx.materials.get(ref, undefined, false, 'flatShading' in m && m.flatShading === true) : m;
          };
          o.material = Array.isArray(o.material) ? o.material.map(repaint) : repaint(o.material);
        });
      }
      out.add(clone);
      return out;
    }
    // A stand-in while the model loads, or when it cannot be: its extent, in the theme's stand-in colour.
    const [w, d, h] = model.size;
    const box = new Mesh(new BoxGeometry(w, d, h), ctx.standIn);
    box.userData['standIn'] = true;
    box.position.set(-model.offset[0], -model.offset[1], -model.offset[2] + h / 2);
    out.add(box);
    return out;
  }

  /** Takes an item's object out of the level, freeing a stand-in box's geometry (recipe and model geometry is shared and kept). */
  private release(object: Object3D): void {
    this.group.remove(object);
    object.traverse((o) => {
      if (o instanceof Mesh && o.userData['standIn']) (o.geometry as BufferGeometry).dispose();
    });
  }

  private updateLight(e: LightEntity, elevation: number): boolean {
    const key = String(elevation);
    const built = this.lightObjects.get(e.id);
    if (built && built.entity === e && built.key === key) return false;
    if (built) {
      this.group.remove(built.light.object);
      if (built.light.object instanceof SpotLight) this.group.remove(built.light.object.target);
      built.light.object.dispose();
    }
    const at: Vec3 = [e.at[0], e.at[1], elevation + e.at[2]];
    const color = new Color(e.color);
    let light: Light;
    if (e.kind === 'spot') {
      const spot = new SpotLight(color, lightIntensity(e), 0, (((e.angle ?? 60) / 2) * Math.PI) / 180, 0.35, 2);
      const t = e.target ?? [e.at[0], e.at[1], 0];
      spot.target.position.set(t[0], t[1], elevation + t[2]);
      this.group.add(spot.target);
      light = spot;
    } else if (e.kind === 'area') {
      // A panel lighting its local −z, which is straight down here; its size is in the world's units (metres): three does not scale it.
      light = new RectAreaLight(color, lightIntensity(e), AREA_LIGHT_SIZE / 1000, AREA_LIGHT_SIZE / 1000);
    } else light = new PointLight(color, lightIntensity(e), 0, 2);
    light.position.set(at[0], at[1], at[2]);
    light.visible = false;
    light.userData['hit'] = { levelId: this.levelId, kind: 'light', ids: [e.id] };
    this.group.add(light);
    this.lightObjects.set(e.id, { entity: e, light: { id: e.id, levelId: this.levelId, object: light, at }, key });
    return true;
  }
}
