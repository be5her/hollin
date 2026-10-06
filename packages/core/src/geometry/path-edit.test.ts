import { describe, expect, it } from 'vitest';
import type { Entity } from '../doc/schema';
import { pathLength, rectPath, signedArea, type Path } from './path';
import { insertVertex, moveVertex, pathOfEntity, removeVertex, setCorner, setSegment, withPath } from './path-edit';

const lv = 'lvl_0000000000000001';
const layer = 'lyr_0000000000000001';

describe('path edits', () => {
  it('moves, inserts and removes vertices', () => {
    const open: Path = { closed: false, v: [{ p: [0, 0] }, { p: [1000, 0] }, { p: [1000, 1000] }] };
    expect(moveVertex(open, 1, [2000, 0]).v[1].p).toEqual([2000, 0]);
    const inserted = insertVertex(open, 0, [500, 100]);
    expect(inserted.v.map((v) => v.p)).toEqual([[0, 0], [500, 100], [1000, 0], [1000, 1000]]);
    expect(removeVertex(inserted, 1)).toEqual(open);
    expect(() => removeVertex({ closed: false, v: [{ p: [0, 0] }, { p: [1, 1] }] }, 0)).toThrow();
    expect(() => moveVertex(open, 7, [0, 0])).toThrow();
  });

  it('splits an arc into two arcs on the same circle', () => {
    const semi: Path = { closed: false, v: [{ p: [0, 0], s: { k: 'arc', bulge: 1 } }, { p: [2000, 0] }] };
    const split = insertVertex(semi, 0, [1000, -1000]);
    expect(split.v.length).toBe(3);
    expect(split.v[0].s).toEqual({ k: 'arc', bulge: Math.tan(Math.PI / 8) });
    expect(split.v[1].s).toEqual({ k: 'arc', bulge: Math.tan(Math.PI / 8) });
    expect(pathLength(split)).toBeCloseTo(pathLength(semi), 6);
  });

  it('turns a segment into an arc through a point and back into a line', () => {
    const line: Path = { closed: false, v: [{ p: [0, 0] }, { p: [2000, 0] }] };
    const arc = setSegment(line, 0, { k: 'arc', through: [1000, -1000] });
    expect(arc.v[0].s?.k).toBe('arc');
    expect((arc.v[0].s as { bulge: number }).bulge).toBeCloseTo(1, 9);
    expect(setSegment(arc, 0, { k: 'line' }).v[0].s).toBeUndefined();
    expect(setSegment(line, 0, { k: 'arc', through: [1000, 0] }).v[0].s).toBeUndefined();
    expect(setSegment(line, 0, { k: 'arc', bulge: 0.5 }).v[0].s).toEqual({ k: 'arc', bulge: 0.5 });
  });

  it('sets and clears corners, never on the ends of an open path', () => {
    const rect = rectPath(0, 0, 1000, 1000);
    const rounded = setCorner(rect, 1, { k: 'fillet', r: 200 });
    expect(rounded.v[1].c).toEqual({ k: 'fillet', r: 200 });
    expect(signedArea(rounded)).toBeLessThan(signedArea(rect));
    expect(setCorner(rounded, 1, null).v[1].c).toBeUndefined();
    const open: Path = { closed: false, v: [{ p: [0, 0] }, { p: [1000, 0] }, { p: [1000, 1000] }] };
    expect(() => setCorner(open, 0, { k: 'chamfer', d1: 100 })).toThrow();
    expect(setCorner(open, 1, { k: 'chamfer', d1: 100 }).v[1].c).toEqual({ k: 'chamfer', d1: 100 });
  });

  it('addresses the path of any entity that has one', () => {
    const wall: Entity = { id: 'wal_0000000000000001', type: 'wall', levelId: lv, layerId: layer, path: rectPath(0, 0, 1000, 1000), thickness: 200, height: null, alignment: 'center', baseOffset: 0 };
    expect(pathOfEntity(wall)).toBe(wall.path);
    expect(pathOfEntity(wall, { hole: 0 })).toBeNull();
    const moved = withPath(wall, 'outer', moveVertex(wall.path, 0, [-100, -100])) as typeof wall;
    expect(moved.path.v[0].p).toEqual([-100, -100]);
    const region = { outer: rectPath(0, 0, 5000, 4000), holes: [rectPath(1000, 1000, 500, 500)] };
    const room: Entity = { id: 'rom_0000000000000001', type: 'room', levelId: lv, layerId: layer, name: 'Hall', boundary: { k: 'region', region } };
    expect(pathOfEntity(room, { hole: 0 })).toBe(region.holes[0]);
    const grown = withPath(room, { hole: 0 }, rectPath(1000, 1000, 800, 800)) as typeof room;
    expect(grown.boundary.k === 'region' && grown.boundary.region.holes[0].v[2].p).toEqual([1800, 1800]);
    const label: Entity = { id: 'lbl_0000000000000001', type: 'label', levelId: lv, layerId: layer, text: 'x', at: [0, 0], size: 250, rotation: 0 };
    expect(pathOfEntity(label)).toBeNull();
  });
});
