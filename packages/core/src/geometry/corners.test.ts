import { describe, expect, it } from 'vitest';
import { cornerFrame, cornerFromGrip, cornerGripPoint, filletRadiusMax } from './corners';
import { rectPath, type Path } from './path';

describe('corner grips', () => {
  it('sits on the bisector at the middle of a fillet or a chamfer, and reads the size back from there', () => {
    const square = rectPath(0, 0, 2000, 2000);
    const frame = cornerFrame(square, 1)!;
    expect(frame.vertex).toEqual([2000, 0]);
    expect(frame.halfAngle).toBeCloseTo(Math.PI / 4, 9);
    expect(frame.bisector[0]).toBeCloseTo(-Math.SQRT1_2, 9);
    expect(frame.bisector[1]).toBeCloseTo(Math.SQRT1_2, 9);
    expect(frame.maxIn).toBe(2000);
    expect(filletRadiusMax(frame)).toBeCloseTo(2000, 6);
    const fillet = cornerGripPoint(frame, { k: 'fillet', r: 300 });
    // The arc's middle is r / sin 45° − r = 124.26 mm from the vertex along the bisector.
    expect(fillet[0]).toBeCloseTo(2000 - 300 * (Math.SQRT2 - 1) * Math.SQRT1_2, 6);
    expect(fillet[1]).toBeCloseTo(300 * (Math.SQRT2 - 1) * Math.SQRT1_2, 6);
    expect(cornerFromGrip(frame, { k: 'fillet', r: 100 }, fillet)).toEqual({ k: 'fillet', r: 300 });
    const chamfer = cornerGripPoint(frame, { k: 'chamfer', d1: 200 });
    expect(chamfer[0]).toBeCloseTo(1900, 6);
    expect(chamfer[1]).toBeCloseTo(100, 6);
    expect(cornerFromGrip(frame, { k: 'chamfer', d1: 50 }, chamfer)).toEqual({ k: 'chamfer', d1: 200 });
    // An unequal chamfer keeps its ratio.
    const uneven = cornerGripPoint(frame, { k: 'chamfer', d1: 200, d2: 400 });
    expect(cornerFromGrip(frame, { k: 'chamfer', d1: 100, d2: 200 }, uneven)).toEqual({ k: 'chamfer', d1: 200, d2: 400 });
  });

  it('limits the size to what the edges allow, and a grip pulled onto the vertex makes the corner sharp', () => {
    const square: Path = { closed: true, v: [{ p: [0, 0], c: { k: 'fillet', r: 100 } }, { p: [2000, 0] }, { p: [2000, 2000] }, { p: [0, 2000] }] };
    const frame = cornerFrame(square, 1)!;
    // The edge from vertex 0 has a corner at its other end too: only half of it is available.
    expect(frame.maxIn).toBe(1000);
    expect(frame.maxOut).toBe(2000);
    expect(filletRadiusMax(frame)).toBeCloseTo(1000, 6);
    const far = cornerFromGrip(frame, { k: 'fillet', r: 100 }, [0, 2000]);
    expect(far).toEqual({ k: 'fillet', r: 1000 });
    expect(cornerFromGrip(frame, { k: 'chamfer', d1: 100 }, [0, 2000])).toEqual({ k: 'chamfer', d1: 1000 });
    expect(cornerFromGrip(frame, { k: 'fillet', r: 100 }, [2000, 0])).toBeNull();
    expect(cornerFromGrip(frame, { k: 'fillet', r: 100 }, [2100, -100])).toBeNull();
  });

  it('has no frame at the ends of an open path, next to an arc, or between collinear edges', () => {
    const open: Path = { closed: false, v: [{ p: [0, 0] }, { p: [1000, 0] }, { p: [1000, 1000] }] };
    expect(cornerFrame(open, 0)).toBeNull();
    expect(cornerFrame(open, 2)).toBeNull();
    expect(cornerFrame(open, 1)).not.toBeNull();
    const curved: Path = { closed: false, v: [{ p: [0, 0], s: { k: 'arc', bulge: 0.5 } }, { p: [1000, 0] }, { p: [1000, 1000] }] };
    expect(cornerFrame(curved, 1)).toBeNull();
    const straight: Path = { closed: false, v: [{ p: [0, 0] }, { p: [1000, 0] }, { p: [2000, 0] }] };
    expect(cornerFrame(straight, 1)).toBeNull();
  });
});
