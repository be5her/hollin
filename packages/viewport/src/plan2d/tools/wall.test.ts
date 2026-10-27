import { describe, expect, it } from 'vitest';
import { DEFAULT_RULE_LIMITS } from '@studio/core';
import { DEG } from '@studio/core';
import { DEFAULT_SNAP_SETTINGS, SnapIndex, snapPoint } from '../snap';
import { DEFAULT_TOOL_OPTIONS, type ToolHost, type ToolOptions, type ToolPointer } from './tool';
import { WallTool } from './wall';

function host(options: Partial<ToolOptions['wall']> = {}) {
  const calls: { id: string; input: unknown }[] = [];
  const h: ToolHost & { calls: typeof calls; finished: number } = {
    calls,
    finished: 0,
    clipboard: null,
    invoke: async (id, input) => {
      calls.push({ id, input });
      return {};
    },
    levelId: () => 'lvl_0000000000000001',
    entities: () => ({}),
    assets: () => ({}),
    layers: () => ({}),
    seq: () => 0,
    epoch: () => 1,
    connectors: () => new Map(),
    previewConnector: () => null,
    levels: () => [],
    limits: () => DEFAULT_RULE_LIMITS,
    options: () => ({ ...DEFAULT_TOOL_OPTIONS, wall: { ...DEFAULT_TOOL_OPTIONS.wall, ...options } }),
    scale: () => 0.1,
    toScreen: (p) => [p[0] / 10, -p[1] / 10],
    invalidate: () => {},
    finish: () => h.finished++,
    selection: () => new Set(),
    select: () => {},
    vertex: () => null,
    selectVertex: () => {},
    hit: () => null,
    marquee: () => [],
    walls: () => null,
    geometry: () => null,
    snap: () => null,
    requestText: () => {},
  };
  return h;
}

const click = (x: number, y: number): ToolPointer => ({ world: [x, y], screen: [0, 0], button: 0, shift: false, ctrl: false, alt: false, clicks: 1 });
const keyOf = (key: string) => ({ key }) as KeyboardEvent;

describe('WallTool', () => {
  it('adds one wall per click after the first, and closes on the first point', () => {
    const h = host();
    const tool = new WallTool(h);
    tool.pointerDown(click(0, 0));
    expect(tool.busy).toBe(true);
    tool.pointerDown(click(5000, 0));
    tool.pointerDown(click(5000, 4000));
    expect(h.calls.length).toBe(2);
    expect(h.calls[1].input).toMatchObject({ points: [{ p: [5000, 0] }, { p: [5000, 4000] }], closed: false, thickness: 200, alignment: 'center', single: false });
    // Within 8 px (80 mm at this zoom) of the start: close the run.
    tool.pointerDown(click(30, 4000));
    tool.pointerDown(click(20, -20));
    expect(h.calls.length).toBe(4);
    expect(h.calls[3].input).toMatchObject({ points: [{ p: [30, 4000] }, { p: [0, 0] }] });
    expect(tool.busy).toBe(false);
  });

  it('makes one entity for the whole run with the single option, on Enter or when closed', () => {
    const h = host({ single: true });
    const tool = new WallTool(h);
    tool.pointerDown(click(0, 0));
    tool.pointerDown(click(5000, 0));
    tool.pointerDown(click(5000, 4000));
    expect(h.calls.length).toBe(0);
    expect(tool.key(keyOf('Enter'))).toBe(true);
    expect(h.calls.length).toBe(1);
    expect(h.calls[0].input).toMatchObject({ points: [{ p: [0, 0] }, { p: [5000, 0] }, { p: [5000, 4000] }], closed: false, single: true });
    tool.pointerDown(click(0, 0));
    tool.pointerDown(click(3000, 0));
    tool.pointerDown(click(3000, 3000));
    tool.pointerDown(click(10, 10));
    expect(h.calls[1].input).toMatchObject({ closed: true, single: true });
    expect((h.calls[1].input as { points: unknown[] }).points.length).toBe(3);
  });

  it('draws an arc through a point after A', () => {
    const h = host();
    const tool = new WallTool(h);
    tool.pointerDown(click(0, 0));
    expect(tool.key(keyOf('a'))).toBe(true);
    tool.pointerDown(click(2000, 0));
    expect(h.calls.length).toBe(0);
    tool.pointerDown(click(1000, -1000));
    expect(h.calls.length).toBe(1);
    const points = (h.calls[0].input as { points: { p: number[]; bulge?: number }[] }).points;
    expect(points[0].bulge).toBeCloseTo(1, 9);
    expect(points[1].p).toEqual([2000, 0]);
    expect(tool.hint()).toContain('next point');
  });

  it('tracks the next segment perpendicular to the previous one, and a typed length runs along the tracked direction', () => {
    const h = host();
    const idx = new SnapIndex();
    idx.build({}, null);
    h.snap = (p, options) => snapPoint(idx, p, 100, DEFAULT_SNAP_SETTINGS, options);
    const tool = new WallTool(h);
    const at = (from: [number, number], degrees: number, len: number): [number, number] => [from[0] + len * Math.cos(degrees * DEG), from[1] + len * Math.sin(degrees * DEG)];
    tool.pointerDown(click(0, 0));
    // 37° is tracked by nothing, so the first wall goes exactly where it was clicked.
    const first = at([0, 0], 37, 3000);
    tool.pointerDown(click(...first));
    expect((h.calls[0].input as { points: { p: number[] }[] }).points[1].p).toEqual(first);
    // 128° from there is within reach of the perpendicular (127°), not of 120° or 135°.
    tool.pointerDown(click(...at(first, 128, 2000)));
    const second = (h.calls[1].input as { points: { p: number[] }[] }).points;
    expect(second[0].p).toEqual(first);
    const d = [second[1].p[0] - first[0], second[1].p[1] - first[1]];
    expect(Math.abs(d[0] * Math.cos(37 * DEG) + d[1] * Math.sin(37 * DEG))).toBeLessThan(1e-6);
    // Near vertical from the new end: the host hands the tool the tracked cursor, so a typed length goes straight up.
    const last = second[1].p as [number, number];
    const cursor = h.snap(at(last, 88, 1500), { from: last })!;
    expect(cursor.label).toBe('90°');
    expect(tool.typed('1200', { k: 'length', mm: 1200 }, cursor.point)).toBe(true);
    const third = (h.calls[2].input as { points: { p: number[] }[] }).points;
    expect(third[1].p[0]).toBeCloseTo(last[0], 9);
    expect(third[1].p[1]).toBeCloseTo(last[1] + 1200, 9);
    // Alt draws free.
    tool.pointerDown({ ...click(...at(third[1].p as [number, number], 88, 1000)), alt: true });
    const fourth = (h.calls[3].input as { points: { p: number[] }[] }).points;
    expect(fourth[1].p[0] - third[1].p[0]).toBeCloseTo(1000 * Math.cos(88 * DEG), 9);
  });

  it('cancels an unfinished run and ignores other buttons', () => {
    const h = host();
    const tool = new WallTool(h);
    tool.pointerDown({ ...click(0, 0), button: 2 });
    expect(tool.busy).toBe(false);
    tool.pointerDown(click(0, 0));
    tool.cancel();
    expect(tool.busy).toBe(false);
    expect(h.calls.length).toBe(0);
  });
});
