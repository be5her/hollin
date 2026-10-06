import { describe, expect, it } from 'vitest';
import { addEntityOps, addLevelOps, applyPatch, newProjectDoc, rectPath, type ProjectDoc } from '@studio/core';
import { Plan2dEditor } from './editor';

function building(): { doc: ProjectDoc; ground: string; upper: string } {
  let doc = newProjectDoc({ name: 'Test' });
  const ground = doc.building.groundLevelId;
  const added = addLevelOps(doc, { name: 'Level 1' });
  doc = applyPatch(doc, added.ops);
  const wall = addEntityOps(doc, { levelId: ground, entity: { type: 'wall', path: rectPath(0, 0, 9000, 6000), thickness: 250 } });
  doc = applyPatch(doc, wall.ops);
  const column = addEntityOps(doc, { levelId: added.levelId, entity: { type: 'column', at: [1000, 1000], shape: { k: 'circle', r: 200 } } });
  doc = applyPatch(doc, column.ops);
  return { doc, ground, upper: added.levelId };
}

describe('Plan2dEditor without a canvas', () => {
  it('keeps a scene for the active level and the reference level only', () => {
    const { doc, ground, upper } = building();
    const editor = new Plan2dEditor();
    editor.setDocument(doc);
    editor.setLevel(ground);
    expect(editor.levelScene?.items.size).toBe(1);
    expect(editor.underlayLevelId()).toBeNull();
    editor.setUnderlay('above');
    expect(editor.underlayLevelId()).toBe(upper);
    editor.setUnderlay('below');
    expect(editor.underlayLevelId()).toBeNull();
    editor.setLevel(upper);
    expect(editor.underlayLevelId()).toBe(ground);
    expect(editor.levelScene?.items.size).toBe(1);
    expect(editor.levelScene?.items.values().next().value?.type).toBe('column');
  });

  it('zooms to the level and reports camera changes', () => {
    const { doc, ground } = building();
    const changes: number[] = [];
    const editor = new Plan2dEditor({ onCameraChange: (c) => changes.push(c.scale) });
    editor.setDocument(doc);
    editor.setLevel(ground);
    editor.resize(1000, 800, 2);
    editor.zoomToFit();
    expect(editor.camera.x).toBe(4500);
    expect(editor.camera.y).toBe(3000);
    expect(changes.length).toBe(1);
    editor.zoomBy(2);
    expect(editor.camera.scale).toBeCloseTo(changes[0] * 2);
    const w = editor.screenToWorld([500, 400]);
    expect(w[0]).toBeCloseTo(4500);
    expect(w[1]).toBeCloseTo(3000);
  });

  it('follows a changed document without rebuilding untouched items', () => {
    const { doc, ground } = building();
    const editor = new Plan2dEditor();
    editor.setDocument(doc);
    editor.setLevel(ground);
    const before = editor.levelScene!.items.values().next().value!;
    // The mirror receives parsed records (defaults filled in by main), so give the label its defaults.
    const more = addEntityOps(doc, { levelId: ground, entity: { type: 'label', text: 'Hi', at: [100, 100], size: 250, rotation: 0 } });
    editor.setDocument(applyPatch(doc, more.ops));
    expect(editor.levelScene!.items.size).toBe(2);
    expect(editor.levelScene!.items.get(before.id)).toBe(before);
  });
});
