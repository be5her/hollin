import { describe, expect, it } from 'vitest';
import { MAX_SCALE, MIN_SCALE, drawingScale, fitBox, panBy, screenToWorld, visibleBox, worldToScreen, zoomAt } from './camera';

const size = { width: 800, height: 600 };

describe('camera', () => {
  it('maps the centre of the canvas to the camera point and flips y', () => {
    const cam = { x: 1000, y: 2000, scale: 0.1 };
    expect(worldToScreen(cam, size, [1000, 2000])).toEqual([400, 300]);
    // 1000 mm up in the world is 100 px up on screen.
    expect(worldToScreen(cam, size, [1000, 3000])).toEqual([400, 200]);
    expect(screenToWorld(cam, size, [500, 300])).toEqual([2000, 2000]);
  });

  it('round-trips between world and screen', () => {
    const cam = { x: -340.5, y: 12.25, scale: 0.37 };
    const p: [number, number] = [1234.5, -678.9];
    const back = screenToWorld(cam, size, worldToScreen(cam, size, p));
    expect(back[0]).toBeCloseTo(p[0], 9);
    expect(back[1]).toBeCloseTo(p[1], 9);
  });

  it('zooms about the cursor so the point under it stays put', () => {
    const cam = { x: 0, y: 0, scale: 0.1 };
    const at: [number, number] = [100, 500];
    const world = screenToWorld(cam, size, at);
    const zoomed = zoomAt(cam, size, at, 2);
    expect(zoomed.scale).toBe(0.2);
    const after = worldToScreen(zoomed, size, world);
    expect(after[0]).toBeCloseTo(at[0], 9);
    expect(after[1]).toBeCloseTo(at[1], 9);
  });

  it('clamps the zoom and returns the same camera at a limit', () => {
    const cam = { x: 0, y: 0, scale: MAX_SCALE };
    expect(zoomAt(cam, size, [0, 0], 2)).toBe(cam);
    expect(zoomAt({ x: 0, y: 0, scale: MIN_SCALE }, size, [0, 0], 0.5).scale).toBe(MIN_SCALE);
  });

  it('pans by screen pixels: dragging right moves the centre left in the world', () => {
    const cam = panBy({ x: 0, y: 0, scale: 0.5 }, 100, 50);
    expect(cam).toEqual({ x: -200, y: 100, scale: 0.5 });
  });

  it('fits a box with padding', () => {
    const cam = fitBox({ minX: 0, minY: 0, maxX: 9000, maxY: 6000 }, size, 50);
    expect(cam.x).toBe(4500);
    expect(cam.y).toBe(3000);
    // 700 px for 9000 mm (the limiting side).
    expect(cam.scale).toBeCloseTo(700 / 9000, 9);
    const box = visibleBox(cam, size);
    expect(box.minX).toBeLessThan(0);
    expect(box.maxX).toBeGreaterThan(9000);
  });

  it('survives an empty box and a zero-size canvas', () => {
    expect(fitBox({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }, size)).toEqual({ x: 0, y: 0, scale: 0.1 });
    expect(fitBox({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, { width: 0, height: 0 })).toEqual({ x: 50, y: 50, scale: 0.1 });
  });

  it('reports the drawing scale as 1:N', () => {
    expect(drawingScale({ x: 0, y: 0, scale: 96 / 25.4 / 100 })).toBe(100);
    expect(drawingScale({ x: 0, y: 0, scale: 20 })).toBe(1);
  });
});
