import { describe, expect, it } from 'vitest';
import { DEFAULT_RULE_LIMITS, Transaction, addEntityOps, newProjectDoc, rectPath, type ProjectDoc } from '@studio/core';
import { Mesh, type MeshStandardMaterial } from 'three';
import { BuildingScene } from './scene';

/** The material of the first mesh drawn for a kind of solid. */
function materialOf(scene: BuildingScene, kind: string): MeshStandardMaterial | undefined {
  let found: MeshStandardMaterial | undefined;
  scene.root.traverse((o) => {
    if (!found && o instanceof Mesh && (o.userData['hit'] as { kind?: string } | undefined)?.kind === kind) found = o.material as MeshStandardMaterial;
  });
  return found;
}

/** How far a material moves its faces in the depth test; negative pulls them towards the camera. */
const depthOffset = (m: MeshStandardMaterial) => (m.polygonOffset ? [m.polygonOffsetFactor, m.polygonOffsetUnits] : [0, 0]);

describe('BuildingScene', () => {
  it('draws a floor finish in front of the slab under it, so the 2 mm skin never fights it from afar', () => {
    let doc: ProjectDoc = newProjectDoc({ name: 'Finished' });
    const ground = doc.building.groundLevelId;
    // Through a transaction, as an edit goes: it fills in the defaults (a wall's base offset) the solids read.
    const add = (entity: Parameters<typeof addEntityOps>[1]['entity']) => {
      const tx = new Transaction(doc);
      tx.apply(addEntityOps(doc, { levelId: ground, entity }).ops);
      doc = tx.commit()?.doc ?? doc;
    };
    add({ type: 'wall', path: rectPath(0, 0, 6000, 4500), thickness: 200, materials: { left: 'builtin:paint-sage' } });
    add({ type: 'slab', source: { k: 'region', region: { outer: rectPath(0, 0, 6000, 4500), holes: [] } } });
    add({ type: 'room', name: 'Living', boundary: { k: 'detect', seed: [3000, 2250] }, finish: { floor: 'builtin:oak-floor' } });
    const scene = new BuildingScene();
    scene.update(doc, { limits: DEFAULT_RULE_LIMITS });
    const slab = materialOf(scene, 'slab')!;
    const wall = materialOf(scene, 'wall')!;
    const finish = materialOf(scene, 'finish')!;
    expect(finish.name).toBe('builtin:oak-floor');
    const [slabFactor, slabUnits] = depthOffset(slab);
    const [wallFactor, wallUnits] = depthOffset(wall);
    const [factor, units] = depthOffset(finish);
    expect(factor).toBeLessThan(Math.min(slabFactor, wallFactor));
    expect(units).toBeLessThan(Math.min(slabUnits, wallUnits));
    // The same material on furniture keeps the ordinary offset, behind its edge lines.
    const furniture = scene.decorMaterials.get('builtin:oak-floor');
    expect(furniture).not.toBe(finish);
    expect(depthOffset(furniture)).toEqual([slabFactor, slabUnits]);
    // A wall face's finish is a skin as well.
    expect(scene.decorMaterials.get('builtin:paint-sage', undefined, true).polygonOffsetFactor).toBe(factor);
    scene.dispose();
  });
});
