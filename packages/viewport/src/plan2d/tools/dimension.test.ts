import { describe, expect, it } from 'vitest';
import type { SnapResult } from '../snap';
import { DimensionTool } from './dimension';
import { LabelTool } from './label';
import { DEFAULT_TOOL_OPTIONS, type TextRequest, type ToolHost, type ToolOptions, type ToolPointer } from './tool';

function host(options: Partial<ToolOptions['dimension']> = {}, snap: (p: readonly [number, number]) => SnapResult | null = () => null) {
  const calls: { id: string; input: unknown }[] = [];
  const texts: TextRequest[] = [];
  const h: ToolHost & { calls: typeof calls; texts: typeof texts } = {
    calls,
    texts,
    clipboard: null,
    invoke: async (id, input) => {
      calls.push({ id, input });
      return {};
    },
    levelId: () => 'lvl_0000000000000001',
    entities: () => ({}),
    seq: () => 0,
    epoch: () => 1,
    options: () => ({ ...DEFAULT_TOOL_OPTIONS, dimension: { ...DEFAULT_TOOL_OPTIONS.dimension, ...options } }),
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
    snap: (p) => snap(p),
    requestText: (r) => texts.push(r),
  };
  return h;
}

const click = (x: number, y: number): ToolPointer => ({ world: [x, y], screen: [0, 0], button: 0, shift: false, ctrl: false, alt: false, clicks: 1 });
const keyOf = (key: string) => ({ key }) as KeyboardEvent;

describe('DimensionTool', () => {
  it('places an aligned dimension with two points and the line, tied to the corners it snapped to', () => {
    const corner: SnapResult = { point: [5000, 0], kind: 'endpoint', label: 'Endpoint', guides: [], anchor: { entityId: 'wal_a', vertex: 1, side: 'axis' } };
    const h = host({}, (p) => (Math.hypot(p[0] - 5000, p[1]) < 100 ? corner : null));
    const tool = new DimensionTool(h);
    tool.pointerDown(click(0, 0));
    expect(tool.busy).toBe(true);
    expect(tool.hint()).toContain('second point');
    tool.pointerDown(click(4990, 10));
    expect(tool.hint()).toContain('dimension line');
    tool.pointerDown(click(2500, -700));
    expect(h.calls[0].id).toBe('plan.dimension.add');
    expect(h.calls[0].input).toEqual({ levelId: 'lvl_0000000000000001', kind: 'aligned', from: [0, 0], to: [5000, 0], offset: -700, anchors: { to: { entityId: 'wal_a', vertex: 1, side: 'axis' } } });
    expect(tool.busy).toBe(false);
  });

  it('takes typed points and a typed distance on the cursor side; Enter places the line at the cursor', () => {
    const h = host({ kind: 'horizontal' });
    const tool = new DimensionTool(h);
    expect(tool.typed('0,0', { k: 'absolute', x: 0, y: 0 }, null)).toBe(true);
    expect(tool.typed('@3000,1000', { k: 'relative', dx: 3000, dy: 1000 }, null)).toBe(true);
    tool.pointerMove(click(1000, 1800));
    expect(tool.typed('500', { k: 'length', mm: 500 }, [1000, 1800])).toBe(true);
    expect(h.calls[0].input).toMatchObject({ kind: 'horizontal', from: [0, 0], to: [3000, 1000], offset: 500 });
    tool.pointerDown(click(0, 0));
    tool.pointerDown(click(2000, 0));
    tool.pointerMove(click(500, -300));
    expect(tool.key(keyOf('Enter'))).toBe(true);
    expect(h.calls[1].input).toMatchObject({ offset: -300 });
    expect(tool.typed('x', null, null)).toBe(false);
  });

  it('measures an angle from its corner and two sides, and a radius from the centre and a point', () => {
    const h = host({ kind: 'angular' });
    const tool = new DimensionTool(h);
    tool.pointerDown(click(0, 0));
    expect(tool.hint()).toContain('first side');
    tool.pointerDown(click(1000, 0));
    tool.pointerDown(click(0, 1000));
    expect(h.calls.length).toBe(0);
    tool.pointerDown(click(300, 400));
    expect(h.calls[0].input).toMatchObject({ kind: 'angular', vertex: [0, 0], from: [1000, 0], to: [0, 1000], offset: 500 });
    const hr = host({ kind: 'radius' });
    const radius = new DimensionTool(hr);
    radius.pointerDown(click(1000, 1000));
    radius.pointerDown(click(1600, 1000));
    expect(hr.calls[0].input).toEqual({ levelId: 'lvl_0000000000000001', kind: 'radius', from: [1000, 1000], to: [1600, 1000], offset: 0 });
    expect(radius.busy).toBe(false);
  });

  it('drops an unfinished dimension on cancel', () => {
    const h = host();
    const tool = new DimensionTool(h);
    tool.pointerDown(click(0, 0));
    tool.cancel();
    expect(tool.busy).toBe(false);
    expect(h.calls.length).toBe(0);
  });
});

describe('LabelTool', () => {
  it('asks the host for text at the clicked point and places the label with it', () => {
    const h = host();
    const tool = new LabelTool(h);
    tool.pointerDown({ ...click(1000, 2000), screen: [100, -200] });
    expect(h.texts.length).toBe(1);
    expect(h.texts[0].screen).toEqual([100, -200]);
    expect(tool.hint()).toContain('Type');
    h.texts[0].commit('  Kitchen ');
    expect(h.calls[0]).toEqual({ id: 'plan.entity.add', input: { levelId: 'lvl_0000000000000001', entity: { type: 'label', text: 'Kitchen', at: [1000, 2000], size: 250 } } });
    tool.pointerDown(click(0, 0));
    h.texts[1].commit('   ');
    expect(h.calls.length).toBe(1);
    expect(tool.hint()).toContain('Click');
  });
});
