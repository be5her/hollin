import { describe, expect, it } from 'vitest';
import { fitOrbit, mmPerPixel, orbitAxes, orbitBy, orbitEye, orbitPan, parseOrbit, orbitZoomAt, type Orbit } from './orbit';

const o: Orbit = { target: [1000, 2000, 1500], distance: 10_000, azimuth: 270, elevation: 0 };
const close = (a: readonly number[], b: readonly number[], digits = 6) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));

describe('orbit camera', () => {
  it('looks from its azimuth and elevation at the target', () => {
    // From the south (270°), level: the eye is 10 m south of the target.
    close(orbitEye(o), [1000, -8000, 1500]);
    close(orbitEye({ ...o, azimuth: 0, elevation: 90 }), [1000, 2000, 11_500]);
    const { right, up, forward } = orbitAxes(o);
    close(forward, [0, 1, 0]);
    close(right, [1, 0, 0]);
    close(up, [0, 0, 1]);
  });

  it('turns around the target and stays off the poles', () => {
    expect(orbitBy(o, 100, 0).azimuth).toBe(10);
    expect(orbitBy(o, 0, 120).elevation).toBe(89);
    expect(orbitBy(o, 0, -120).elevation).toBe(-89);
  });

  it('pans so the scene follows the pointer', () => {
    const k = mmPerPixel(o, 600);
    // Dragging right moves the scene right: the target moves left by as many mm as the pixels cover.
    close(orbitPan(o, 100, 0, 600).target, [1000 - 100 * k, 2000, 1500]);
    // Dragging down moves it down: the target goes up.
    close(orbitPan(o, 0, 50, 600).target, [1000, 2000, 1500 + 50 * k]);
  });

  it('zooms at the cursor, keeping the point under it where it is', () => {
    const k = mmPerPixel(o, 600);
    const zoomed = orbitZoomAt(o, 0.5, { x: 200, y: -100 }, 600);
    expect(zoomed.distance).toBe(5000);
    // The point 200 px right and 100 px up of the centre, at the target's depth…
    const p = [1000 + 200 * k, 2000, 1500 + 100 * k];
    // …is still 200 px right and 100 px up after the zoom.
    const k2 = mmPerPixel(zoomed, 600);
    close([zoomed.target[0] + 200 * k2, zoomed.target[1], zoomed.target[2] + 100 * k2], p, 3);
    expect(orbitZoomAt(o, 1e-9, { x: 0, y: 0 }, 600).distance).toBe(300);
  });

  it('fits a box whole from a direction', () => {
    const box = { min: [0, 0, 0] as const, max: [10_000, 8000, 6000] as const };
    const fit = fitOrbit(box, 1.5, { azimuth: 225, elevation: 30 });
    close(fit.target, [5000, 4000, 3000]);
    const radius = Math.hypot(10_000, 8000, 6000) / 2;
    // The sphere around the box fits the vertical field of view, with a margin.
    expect(fit.distance * Math.sin((20 * Math.PI) / 180)).toBeCloseTo(radius * 1.1, 3);
    // A tall, narrow view fits the horizontal field instead: farther away.
    expect(fitOrbit(box, 0.5).distance).toBeGreaterThan(fit.distance);
  });

  it('reads a stored orbit back only when it is one', () => {
    expect(parseOrbit({ target: [1, 2, 3], distance: 5000, azimuth: 400, elevation: 95 })).toEqual({ target: [1, 2, 3], distance: 5000, azimuth: 40, elevation: 89 });
    expect(parseOrbit({ target: [1, 2], distance: 5000, azimuth: 0, elevation: 0 })).toBeNull();
    expect(parseOrbit(null)).toBeNull();
  });
});
