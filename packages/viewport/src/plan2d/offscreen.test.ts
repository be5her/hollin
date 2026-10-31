import { describe, expect, it } from 'vitest';
import { addEntityOps, addLevelOps, applyPatch, newProjectDoc, rectPath } from '@studio/core';
import { renderLevelToPng } from './offscreen';
import { DARK_THEME } from './theme';

/** A canvas whose 2D context swallows every call, enough to run the renderer in node. */
function fakeCanvas(log: string[]) {
  return (width: number, height: number): HTMLCanvasElement => {
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (_t, key) => {
        if (key === 'measureText') return () => ({ width: 10 });
        return (...args: unknown[]) => {
          if (key === 'fillRect' || key === 'clearRect') log.push(`${String(key)} ${args.join(',')}`);
          return undefined;
        };
      },
      set: (_t, key, value) => {
        if (key === 'fillStyle') log.push(`fillStyle ${String(value)}`);
        return true;
      },
    });
    return { width, height, getContext: () => ctx, toDataURL: () => 'data:image/png;base64,iVBORw0KGgo=' } as unknown as HTMLCanvasElement;
  };
}

describe('renderLevelToPng', () => {
  it('fits a level into the canvas and returns the PNG bytes, and skips an empty level', () => {
    let doc = newProjectDoc({ name: 'Thumb' });
    const ground = doc.building.groundLevelId;
    expect(renderLevelToPng(doc, ground, { width: 480, height: 360, createCanvas: fakeCanvas([]) })).toBeNull();
    // Labels alone are no plan either.
    doc = applyPatch(doc, addEntityOps(doc, { levelId: ground, entity: { type: 'label', text: 'Soon', at: [0, 0] } }).ops);
    expect(renderLevelToPng(doc, ground, { width: 480, height: 360, createCanvas: fakeCanvas([]) })).toBeNull();
    doc = applyPatch(doc, addEntityOps(doc, { levelId: ground, entity: { type: 'wall', path: rectPath(0, 0, 9000, 6000), thickness: 250 } }).ops);
    const log: string[] = [];
    const png = renderLevelToPng(doc, ground, { width: 480, height: 360, createCanvas: fakeCanvas(log) });
    expect(png).toBe('iVBORw0KGgo=');
    // The background was painted over the whole canvas, in the theme's paper colour.
    expect(log.slice(0, 2)).toEqual(['fillStyle #f6f1e8', 'fillRect 0,0,480,360']);
    expect(renderLevelToPng(doc, 'lvl_0000000000000000', { width: 10, height: 10, createCanvas: fakeCanvas([]) })).toBeNull();
  });

  it('leaves the background transparent when asked, and paints the dark paper with the dark theme', () => {
    let doc = newProjectDoc({ name: 'Clear' });
    const ground = doc.building.groundLevelId;
    doc = applyPatch(doc, addEntityOps(doc, { levelId: ground, entity: { type: 'wall', path: rectPath(0, 0, 9000, 6000), thickness: 250 } }).ops);
    const clear: string[] = [];
    expect(renderLevelToPng(doc, ground, { width: 200, height: 100, createCanvas: fakeCanvas(clear), transparent: true })).toBe('iVBORw0KGgo=');
    expect(clear[0]).toBe('clearRect 0,0,200,100');
    expect(clear).not.toContain('fillRect 0,0,200,100');
    const dark: string[] = [];
    renderLevelToPng(doc, ground, { width: 200, height: 100, createCanvas: fakeCanvas(dark), theme: DARK_THEME });
    expect(dark.slice(0, 2)).toEqual([`fillStyle ${DARK_THEME.background}`, 'fillRect 0,0,200,100']);
  });

  it('draws the columns, shafts and voids that span up from other levels, as the plan view does', () => {
    let doc = newProjectDoc({ name: 'Span' });
    const ground = doc.building.groundLevelId;
    const added = addLevelOps(doc, { position: 'top' });
    doc = applyPatch(doc, added.ops);
    const upper = added.levelId;
    // Nothing of its own upstairs: the level is empty until the column from downstairs spans it.
    expect(renderLevelToPng(doc, upper, { width: 100, height: 100, createCanvas: fakeCanvas([]) })).toBeNull();
    doc = applyPatch(doc, addEntityOps(doc, { levelId: ground, entity: { type: 'column', at: [1000, 1000], shape: { k: 'rect', w: 400, d: 400 }, rotation: 0, span: { topLevelId: upper, baseOffset: 0, topOffset: 3000 } } }).ops);
    expect(renderLevelToPng(doc, upper, { width: 100, height: 100, createCanvas: fakeCanvas([]) })).toBe('iVBORw0KGgo=');
    // A column that stops at the upper floor's slab (topOffset 0) does not show there.
    let doc2 = newProjectDoc({ name: 'Stop' });
    const up2 = addLevelOps(doc2, { position: 'top' });
    doc2 = applyPatch(doc2, up2.ops);
    doc2 = applyPatch(doc2, addEntityOps(doc2, { levelId: doc2.building.groundLevelId, entity: { type: 'column', at: [0, 0], shape: { k: 'rect', w: 400, d: 400 }, rotation: 0, span: { topLevelId: up2.levelId, baseOffset: 0, topOffset: 0 } } }).ops);
    expect(renderLevelToPng(doc2, up2.levelId, { width: 100, height: 100, createCanvas: fakeCanvas([]) })).toBeNull();
  });
});
