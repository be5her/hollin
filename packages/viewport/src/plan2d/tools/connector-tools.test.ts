import { describe, expect, it } from 'vitest';
import { DEFAULT_RULE_LIMITS, addLevelOps, applyPatch, deriveLevels, newProjectDoc, type ProjectDoc } from '@studio/core';
import { ColumnTool } from './column';
import { ElevatorTool, EscalatorTool, LadderTool, RampTool, StairTool, connectorLevels } from './connectors';
import { DEFAULT_TOOL_OPTIONS, type ToolHost, type ToolOptions, type ToolPointer } from './tool';

function storeys(): { doc: ProjectDoc; ground: string; upper: string; attic: string } {
  let doc = newProjectDoc({ name: 'Test' });
  const ground = doc.building.groundLevelId;
  const upper = addLevelOps(doc, { name: 'Upper' });
  doc = applyPatch(doc, upper.ops);
  const attic = addLevelOps(doc, { name: 'Attic' });
  doc = applyPatch(doc, attic.ops);
  return { doc, ground, upper: upper.levelId, attic: attic.levelId };
}

type Ids = { ground: string; upper: string; attic: string };
/** A host over a three-storey document; the options may name levels by role, and the active level too. */
function host(options: Partial<ToolOptions> | ((ids: Ids) => Partial<ToolOptions>) = {}, level: keyof Ids = 'ground') {
  const { doc, ground, upper, attic } = storeys();
  const ids: Ids = { ground, upper, attic };
  const levelId = ids[level];
  const chosen = typeof options === 'function' ? options(ids) : options;
  const calls: { id: string; input: unknown }[] = [];
  const h: ToolHost & { calls: typeof calls; ground: string; upper: string; attic: string } = {
    calls,
    ground,
    upper,
    attic,
    clipboard: null,
    invoke: async (id, input) => {
      calls.push({ id, input });
      return {};
    },
    levelId: () => levelId,
    entities: () => ({}),
    assets: () => ({}),
    layers: () => ({}),
    seq: () => 0,
    epoch: () => 1,
    connectors: () => new Map(),
    previewConnector: () => null,
    levels: () => deriveLevels(doc),
    limits: () => DEFAULT_RULE_LIMITS,
    options: () => ({ ...DEFAULT_TOOL_OPTIONS, ...chosen }),
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

const click = (x: number, y: number, extra: Partial<ToolPointer> = {}): ToolPointer => ({ world: [x, y], screen: [0, 0], button: 0, shift: false, ctrl: false, alt: false, clicks: 1, ...extra });
const keyOf = (key: string) => ({ key }) as KeyboardEvent;
type Added = { connector: { kind: string; shape?: string; axis?: { v: { p: number[]; s?: { k: string; bulge: number } }[] }; bottom?: { levelId: string }; top?: { levelId: string }; width?: number; at?: number[]; direction?: number; stops?: { levelId: string }[] } };

describe('connectorLevels', () => {
  it('takes the active level and the stacked level above it unless the options say otherwise', () => {
    const h = host();
    expect(connectorLevels(h)).toMatchObject({ bottom: { id: h.ground }, top: { id: h.upper } });
    expect(connectorLevels(host({}, 'attic'))).toBeNull();
    const chosen = host((ids) => ({ connector: { bottomLevelId: ids.upper, topLevelId: ids.attic } }));
    expect(connectorLevels(chosen)).toMatchObject({ bottom: { id: chosen.upper }, top: { id: chosen.attic } });
  });
});

describe('StairTool', () => {
  it('draws a straight stair from two clicks between the active level and the one above', () => {
    const h = host();
    const tool = new StairTool(h);
    expect(tool.hint()).toContain('start of the stair');
    tool.pointerDown(click(1000, 1000));
    expect(tool.busy).toBe(true);
    tool.pointerDown(click(1000, 4750));
    expect(tool.busy).toBe(false);
    expect(h.calls.length).toBe(1);
    expect(h.calls[0].id).toBe('building.connector.add');
    const added = h.calls[0].input as Added;
    expect(added.connector).toMatchObject({ kind: 'stair', shape: 'straight', width: 1000, bottom: { levelId: h.ground, offset: 0 }, top: { levelId: h.upper, offset: 0 } });
    expect(added.connector.axis!.v.map((v) => v.p)).toEqual([[1000, 1000], [1000, 4750]]);
  });

  it('takes the corner as the second click of an L, ends a winder on Enter, and curves through the third click', () => {
    const h = host({ stair: { shape: 'l', width: 1200, turn: 'left' } });
    const tool = new StairTool(h);
    tool.pointerDown(click(0, 0));
    tool.pointerDown(click(0, 2500));
    expect(h.calls.length).toBe(0);
    expect(tool.hint()).toContain('top of the stair');
    tool.pointerDown(click(2000, 2500));
    expect((h.calls[0].input as Added).connector).toMatchObject({ shape: 'l', width: 1200 });
    expect((h.calls[0].input as Added).connector.axis!.v.map((v) => v.p)).toEqual([[0, 0], [0, 2500], [2000, 2500]]);
    const w = host({ stair: { shape: 'winder', width: 1000, turn: 'left' } });
    const winder = new StairTool(w);
    winder.pointerDown(click(0, 0));
    winder.pointerDown(click(0, 2000));
    expect(winder.key(keyOf('Enter'))).toBe(true);
    expect((w.calls[0].input as Added).connector.axis!.v.length).toBe(2);
    const c = host({ stair: { shape: 'curved', width: 1000, turn: 'left' } });
    const curved = new StairTool(c);
    curved.pointerDown(click(0, 0));
    curved.pointerDown(click(2000, 0));
    curved.pointerDown(click(1000, -1000));
    const arc = (c.calls[0].input as Added).connector.axis!.v[0].s;
    expect(arc?.k).toBe('arc');
    expect(arc?.bulge).toBeCloseTo(1, 9);
  });

  it('lays a U out from the start and the direction, and a spiral from the centre and the first step', () => {
    const h = host({ stair: { shape: 'u', width: 1000, turn: 'right' } });
    const tool = new StairTool(h);
    tool.pointerDown(click(0, 0));
    tool.pointerDown(click(0, 3000));
    const u = (h.calls[0].input as Added).connector.axis!.v.map((v) => v.p);
    expect(u.length).toBe(4);
    expect(u[2][0]).toBe(1000);
    const s = host({ stair: { shape: 'spiral', width: 800, turn: 'left' } });
    const spiral = new StairTool(s);
    expect(spiral.hint()).toContain('centre');
    spiral.pointerDown(click(0, 0));
    spiral.pointerDown(click(900, 0));
    expect((s.calls[0].input as Added).connector.axis!.v.every((v, i, all) => i === all.length - 1 || v.s?.k === 'arc')).toBe(true);
  });

  it('refuses to draw without a level above, and drops an unfinished stair on cancel', () => {
    const h = host({}, 'attic');
    const tool = new StairTool(h);
    expect(tool.hint()).toContain('needs a level above');
    tool.pointerDown(click(0, 0));
    tool.pointerDown(click(0, 3000));
    expect(h.calls.length).toBe(0);
    const g = host();
    const started = new StairTool(g);
    started.pointerDown(click(0, 0));
    started.cancel();
    expect(started.busy).toBe(false);
    expect(g.calls.length).toBe(0);
  });
});

describe('RampTool, LadderTool and ElevatorTool', () => {
  it('ends a ramp on Enter or a double click, with the width and slope limit from the options', () => {
    const h = host({ ramp: { width: 1500 } });
    const tool = new RampTool(h);
    tool.pointerDown(click(0, 0));
    tool.pointerDown(click(6000, 0));
    tool.pointerDown(click(6000, 4000));
    expect(h.calls.length).toBe(0);
    expect(tool.key(keyOf('Enter'))).toBe(true);
    expect((h.calls[0].input as Added).connector).toMatchObject({ kind: 'ramp', width: 1500, maxSlope: 8.33, bottom: { levelId: h.ground } });
    expect((h.calls[0].input as Added).connector.axis!.v.length).toBe(3);
    tool.pointerDown(click(0, 0));
    tool.pointerDown(click(5000, 0));
    tool.pointerDown(click(5000, 0, { clicks: 2 }));
    expect(h.calls.length).toBe(2);
  });

  it('places a ladder by its foot and the direction it leans towards', () => {
    const h = host();
    const tool = new LadderTool(h);
    tool.pointerDown(click(1000, 1000));
    expect(tool.busy).toBe(true);
    tool.pointerDown(click(1000, 2000));
    expect((h.calls[0].input as Added).connector).toMatchObject({ kind: 'ladder', at: [1000, 1000], direction: 90, bottom: { levelId: h.ground }, top: { levelId: h.upper } });
    expect(tool.busy).toBe(false);
  });

  it('places an elevator stopping at every stacked level between the chosen ones', () => {
    const h = host((ids) => ({ connector: { bottomLevelId: null, topLevelId: ids.attic }, elevator: { shaft: { w: 2100, d: 2100 }, car: { w: 1000, d: 1300 } } }));
    const tool = new ElevatorTool(h);
    tool.pointerDown(click(5000, 5000));
    const lift = (h.calls[0].input as Added).connector;
    expect(lift).toMatchObject({ kind: 'elevator', at: [5000, 5000], shaft: { w: 2100, d: 2100 }, car: { w: 1000, d: 1300 } });
    expect(lift.stops!.map((s) => s.levelId)).toEqual([h.ground, h.upper, h.attic]);
  });
});

describe('EscalatorTool', () => {
  it('places an escalator by its foot and the direction it rises towards, with the width and levels from the options', () => {
    const h = host((ids) => ({ connector: { bottomLevelId: null, topLevelId: ids.attic }, escalator: { width: 1200 } }));
    const tool = new EscalatorTool(h);
    expect(tool.hint()).toContain('foot of the escalator');
    tool.pointerDown(click(1000, 1000));
    expect(tool.busy).toBe(true);
    expect(tool.hint()).toContain('direction it rises towards');
    expect(h.calls.length).toBe(0);
    tool.pointerDown(click(1000, -2000));
    expect(tool.busy).toBe(false);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].id).toBe('building.connector.add');
    expect((h.calls[0].input as Added).connector).toEqual({ kind: 'escalator', at: [1000, 1000], direction: 270, width: 1200, bottom: { levelId: h.ground, offset: 0 }, top: { levelId: h.attic, offset: 0 } });
  });

  it('ignores a second click on the foot, drops an unfinished escalator on cancel, and needs a level above', () => {
    const h = host();
    const tool = new EscalatorTool(h);
    tool.pointerDown(click(0, 0));
    tool.pointerDown(click(0, 0));
    expect(tool.busy).toBe(true);
    expect(h.calls.length).toBe(0);
    tool.cancel();
    expect(tool.busy).toBe(false);
    tool.pointerDown(click(0, 0, { button: 2 }));
    expect(tool.busy).toBe(false);
    const top = host({}, 'attic');
    const none = new EscalatorTool(top);
    expect(none.hint()).toContain('needs a level above');
    none.pointerDown(click(0, 0));
    none.pointerDown(click(3000, 0));
    expect(top.calls.length).toBe(0);
    // Levels chosen the wrong way round make nothing either.
    const inverted = host((ids) => ({ connector: { bottomLevelId: ids.upper, topLevelId: ids.ground } }));
    const down = new EscalatorTool(inverted);
    down.pointerDown(click(0, 0));
    down.pointerDown(click(3000, 0));
    expect(inverted.calls.length).toBe(0);
  });
});

describe('ColumnTool', () => {
  it('adds a rectangular or round column at the click, with a span up to the chosen level', () => {
    const h = host({ column: { shape: 'rect', w: 400, d: 300, r: 150, rotation: 30, topLevelId: null } });
    const tool = new ColumnTool(h);
    expect(tool.hint()).toContain('400 × 300');
    tool.pointerDown(click(2000, 1500));
    expect(h.calls[0]).toEqual({ id: 'plan.entity.add', input: { levelId: h.ground, entity: { type: 'column', at: [2000, 1500], shape: { k: 'rect', w: 400, d: 300 }, rotation: 30 } } });
    const round = host((ids) => ({ column: { shape: 'circle', w: 300, d: 300, r: 200, rotation: 0, topLevelId: ids.upper } }));
    new ColumnTool(round).pointerDown(click(0, 0));
    expect((round.calls[0].input as { entity: { shape: unknown; span: unknown } }).entity).toMatchObject({ shape: { k: 'circle', r: 200 }, span: { topLevelId: round.upper, baseOffset: 0, topOffset: 0 } });
  });
});
