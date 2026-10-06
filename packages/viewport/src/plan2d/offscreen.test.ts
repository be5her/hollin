import { describe, expect, it } from 'vitest';
import { addEntityOps, applyPatch, newProjectDoc, rectPath } from '@studio/core';
import { renderLevelToPng } from './offscreen';

/** A canvas whose 2D context swallows every call, enough to run the renderer in node. */
function fakeCanvas(log: string[]) {
  return (width: number, height: number): HTMLCanvasElement => {
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (_t, key) => {
        if (key === 'measureText') return () => ({ width: 10 });
        return (...args: unknown[]) => {
          if (key === 'fillRect') log.push(`fillRect ${args.join(',')}`);
          return undefined;
        };
      },
      set: () => true,
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
    // The background was painted over the whole canvas.
    expect(log[0]).toBe('fillRect 0,0,480,360');
    expect(renderLevelToPng(doc, 'lvl_0000000000000000', { width: 10, height: 10, createCanvas: fakeCanvas([]) })).toBeNull();
  });
});
