import { describe, expect, it } from 'vitest';
import { DEFAULT_RULE_LIMITS } from '@studio/core';
import { ShapeTool } from './shape';
import { DEFAULT_TOOL_OPTIONS, type ToolHost, type ToolOptions, type ToolPointer } from './tool';

function host(options: Partial<ToolOptions['shape']> = {}) {
  const calls: { id: string; input: unknown }[] = [];
  const h: ToolHost & { calls: typeof calls } = {
    calls,
    clipboard: null,
    invoke: async (id, input) => {
      calls.push({ id, input });
      return {};
    },
    levelId: () => 'lvl_0000000000000001',
    entities: () => ({}),
    assets: () => ({}),
    seq: () => 0,
    epoch: () => 1,
    connectors: () => new Map(),
    previewConnector: () => null,
    levels: () => [],
    limits: () => DEFAULT_RULE_LIMITS,
    options: () => ({ ...DEFAULT_TOOL_OPTIONS, shape: { ...DEFAULT_TOOL_OPTIONS.shape, ...options } }),
    scale: () => 0.1,
    toScreen: (p) => [p[0] / 10, -p[1] / 10],
    invalidate: () => {},
    finish: () => {},
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

const click = (x: number, y: number, clicks = 1): ToolPointer => ({ world: [x, y], screen: [0, 0], button: 0, shift: false, ctrl: false, alt: false, clicks });
const keyOf = (key: string) => ({ key }) as KeyboardEvent;

describe('ShapeTool', () => {
  it('draws a polyline shape closed on its first point, or left open on Enter', () => {
    const h = host();
    const tool = new ShapeTool(h, 'polyline');
    expect(tool.id).toBe('shape');
    tool.pointerDown(click(0, 0));
    tool.pointerDown(click(3000, 0));
    tool.pointerDown(click(3000, 2000));
    tool.pointerDown(click(0, 2000));
    expect(h.calls.length).toBe(0);
    tool.pointerDown(click(20, -30));
    expect(h.calls.length).toBe(1);
    expect(h.calls[0].id).toBe('plan.shape.add');
    expect(h.calls[0].input).toMatchObject({ levelId: 'lvl_0000000000000001', filled: true, path: { closed: true, v: [{ p: [0, 0] }, { p: [3000, 0] }, { p: [3000, 2000] }, { p: [0, 2000] }] } });
    expect(tool.busy).toBe(false);
    tool.pointerDown(click(0, 0));
    tool.pointerDown(click(1000, 500));
    expect(tool.key(keyOf('Enter'))).toBe(true);
    expect(h.calls[1].input).toMatchObject({ path: { closed: false, v: [{ p: [0, 0] }, { p: [1000, 500] }] } });
  });

  it('closes with C, makes arcs with A, and ends on a double click', () => {
    const h = host({ filled: false });
    const tool = new ShapeTool(h, 'polyline');
    tool.pointerDown(click(0, 0));
    expect(tool.key(keyOf('a'))).toBe(true);
    tool.pointerDown(click(2000, 0));
    tool.pointerDown(click(1000, 500));
    tool.pointerDown(click(2000, 2000));
    expect(tool.key(keyOf('c'))).toBe(true);
    const input = h.calls[0].input as { filled: boolean; path: { closed: boolean; v: { p: number[]; s?: { k: string; bulge: number } }[] } };
    expect(input.filled).toBe(false);
    expect(input.path.closed).toBe(true);
    expect(input.path.v.length).toBe(3);
    expect(input.path.v[0].s?.k).toBe('arc');
    expect(input.path.v[0].s?.bulge).toBeLessThan(0);
    tool.pointerDown(click(0, 0));
    tool.pointerDown(click(500, 0));
    tool.pointerDown(click(500, 0, 2));
    expect(h.calls.length).toBe(2);
    expect(h.calls[1].input).toMatchObject({ path: { closed: false } });
  });

  it('draws rectangles and circles from two clicks or a typed size', () => {
    const h = host();
    const rect = new ShapeTool(h, 'rectangle');
    expect(rect.id).toBe('rectangle');
    rect.pointerDown(click(3000, 2000));
    rect.pointerDown(click(1000, 500));
    expect(h.calls[0].input).toMatchObject({ path: { closed: true, v: [{ p: [1000, 500] }, { p: [3000, 500] }, { p: [3000, 2000] }, { p: [1000, 2000] }] } });
    rect.pointerDown(click(0, 0));
    expect(rect.typed('@2000,1500', { k: 'relative', dx: 2000, dy: 1500 }, null)).toBe(true);
    expect(h.calls[1].input).toMatchObject({ path: { v: [{ p: [0, 0] }, { p: [2000, 0] }, { p: [2000, 1500] }, { p: [0, 1500] }] } });
    const circle = new ShapeTool(h, 'circle');
    circle.pointerDown(click(1000, 1000));
    expect(circle.typed('750', { k: 'length', mm: 750 }, [2000, 1000])).toBe(true);
    const path = (h.calls[2].input as { path: { closed: boolean; v: { p: number[]; s?: { k: string; bulge: number } }[] } }).path;
    expect(path.closed).toBe(true);
    expect(path.v.length).toBe(2);
    expect(path.v[0].p).toEqual([1750, 1000]);
    expect(path.v[1].p).toEqual([250, 1000]);
    expect(path.v[0].s).toEqual({ k: 'arc', bulge: 1 });
    expect(circle.busy).toBe(false);
  });

  it('makes rooms, slabs and voids as counter-clockwise regions, always closed', () => {
    const h = host({ kind: 'room' });
    const tool = new ShapeTool(h, 'polyline');
    // Clockwise, and ended open with Enter: a region closes it and turns it around.
    tool.pointerDown(click(0, 0));
    tool.pointerDown(click(0, 2000));
    tool.pointerDown(click(3000, 2000));
    tool.pointerDown(click(3000, 0));
    expect(tool.key(keyOf('Enter'))).toBe(true);
    expect(h.calls[0].id).toBe('plan.room.add');
    const region = (h.calls[0].input as { region: { outer: { closed: boolean; v: { p: number[] }[] }; holes: unknown[] } }).region;
    expect(region.outer.closed).toBe(true);
    expect(region.holes).toEqual([]);
    expect(region.outer.v.map((v) => v.p)).toEqual([[0, 0], [3000, 0], [3000, 2000], [0, 2000]]);
    const slab = new ShapeTool(host({ kind: 'slab' }), 'rectangle');
    const hs = (slab as unknown as { host: ReturnType<typeof host> }).host;
    slab.pointerDown(click(0, 0));
    slab.pointerDown(click(4000, 3000));
    expect(hs.calls[0].id).toBe('plan.entity.add');
    expect(hs.calls[0].input).toMatchObject({ entity: { type: 'slab', source: { k: 'region' } } });
    const hv = host({ kind: 'void' });
    const voidTool = new ShapeTool(hv, 'circle');
    voidTool.pointerDown(click(0, 0));
    voidTool.pointerDown(click(500, 0));
    expect(hv.calls[0].input).toMatchObject({ entity: { type: 'void', region: { holes: [] } } });
    // Two points cannot make a region: nothing is sent.
    const two = host({ kind: 'room' });
    const line = new ShapeTool(two, 'polyline');
    line.pointerDown(click(0, 0));
    line.pointerDown(click(1000, 0));
    line.key(keyOf('Enter'));
    expect(two.calls.length).toBe(0);
    expect(line.busy).toBe(false);
  });
});
