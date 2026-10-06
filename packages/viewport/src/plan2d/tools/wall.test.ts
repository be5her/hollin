import { describe, expect, it } from 'vitest';
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
    seq: () => 0,
    epoch: () => 1,
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
    snap: () => null,
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
