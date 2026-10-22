import { describe, expect, it } from 'vitest';
import { DEFAULT_RULE_LIMITS, deriveLevelGeometry, deriveWalls, rectPath, type Entity, type Layer } from '@studio/core';
import { gripsOf } from '../grips';
import { hitTest } from '../hit';
import { createLevelScene, syncLevelScene } from '../scene';
import { ItemTool } from './item';
import { LightTool } from './light';
import { PaintTool } from './paint';
import { SelectTool } from './select';
import { DEFAULT_TOOL_OPTIONS, type ToolHost, type ToolOptions, type ToolPointer } from './tool';

const lv = 'lvl_0000000000000001';
const layer = 'lyr_0000000000000001';
const layers: Record<string, Layer> = { [layer]: { id: layer, levelId: lv, kind: 'decor', name: 'Decor', order: 0, visible: true, locked: false, opacity: 1 } };
const sofa: Entity = { id: 'itm_000000000000000a', type: 'item', levelId: lv, layerId: layer, asset: 'builtin:sofa-3', at: [1000, 1000, 0], rotation: [0, 0, 0], scale: [1, 1, 1], materials: {} };

function harness(item: Partial<ToolOptions['item']> = {}) {
  const entities: Record<string, Entity> = { [sofa.id]: sofa };
  const scene = createLevelScene(lv);
  syncLevelScene(scene, entities, {});
  const calls: { id: string; input: Record<string, unknown> }[] = [];
  let selection = new Set<string>();
  const host: ToolHost & { calls: typeof calls } = {
    calls,
    clipboard: null,
    invoke: async (id, input) => {
      calls.push({ id, input: input as Record<string, unknown> });
      return {};
    },
    levelId: () => lv,
    entities: () => entities,
    assets: () => ({}),
    seq: () => 3,
    epoch: () => 1,
    connectors: () => new Map(),
    previewConnector: () => null,
    levels: () => [],
    limits: () => DEFAULT_RULE_LIMITS,
    options: () => ({ ...DEFAULT_TOOL_OPTIONS, item: { ...DEFAULT_TOOL_OPTIONS.item, ...item } }),
    scale: () => 0.1,
    toScreen: (p) => [p[0] / 10, -p[1] / 10],
    invalidate: () => {},
    finish: () => {},
    selection: () => selection,
    select: (ids) => (selection = new Set(ids)),
    vertex: () => null,
    selectVertex: () => {},
    hit: (p) => hitTest(scene, p, { tolerance: 50, layers, walls: null }),
    marquee: () => [],
    walls: () => null,
    geometry: () => null,
    snap: () => null,
    requestText: () => {},
  };
  return { host, scene };
}

const at = (x: number, y: number, extra: Partial<ToolPointer> = {}): ToolPointer => ({ world: [x, y], screen: [x / 10, -y / 10], button: 0, shift: false, ctrl: false, alt: false, clicks: 1, ...extra });
const key = (k: string, shift = false) => ({ key: k, shiftKey: shift, ctrlKey: false, metaKey: false, altKey: false }) as KeyboardEvent;

describe('ItemTool', () => {
  it('places the armed model where it is clicked, turned by R and the wheel, and stays for the next', () => {
    const { host } = harness({ ref: 'builtin:armchair', name: 'Armchair' });
    const tool = new ItemTool(host);
    tool.pointerMove(at(2000, 3000));
    expect(tool.key(key('r'))).toBe(true);
    expect(tool.key(key('r'))).toBe(true);
    expect(tool.key(key('R', true))).toBe(true);
    expect(tool.wheel({ shiftKey: true, deltaY: -100, deltaX: 0 } as WheelEvent)).toBe(true);
    expect(tool.wheel({ shiftKey: false, deltaY: -100, deltaX: 0 } as WheelEvent)).toBe(false);
    tool.pointerDown(at(2000, 3000));
    tool.pointerDown(at(4000, 3000));
    expect(host.calls).toEqual([
      { id: 'decor.item.place', input: { levelId: lv, ref: 'builtin:armchair', at: [2000, 3000], rotation: 30 } },
      { id: 'decor.item.place', input: { levelId: lv, ref: 'builtin:armchair', at: [4000, 3000], rotation: 30 } },
    ]);
    expect(tool.hint()).toMatch(/Armchair.*30°/);
    tool.cancel();
    expect(tool.rotation).toBe(0);
  });

  it('does nothing without a model, and says where to pick one', () => {
    const { host } = harness();
    const tool = new ItemTool(host);
    tool.pointerDown(at(0, 0));
    expect(host.calls).toEqual([]);
    expect(tool.hint()).toMatch(/Catalog panel/);
  });

  it('brings a lamp’s light when asked', () => {
    const { host } = harness({ ref: 'builtin:floor-lamp', name: 'Floor lamp', withLight: true });
    new ItemTool(host).pointerDown(at(500, 500));
    expect(host.calls[0].input).toMatchObject({ ref: 'builtin:floor-lamp', withLight: true });
  });
});

describe('LightTool', () => {
  it('adds a light of the chosen kind at the click, at the height and lumens the options give', () => {
    const { host } = harness();
    const options = host.options;
    host.options = () => ({ ...options(), light: { kind: 'spot', height: 2600, intensity: 1200 } });
    const tool = new LightTool(host);
    tool.pointerMove(at(3000, 2000));
    expect(tool.hint()).toMatch(/spot.*1200 lm.*2600 mm/);
    tool.pointerDown(at(3000, 2000));
    expect(host.calls).toEqual([{ id: 'decor.light.add', input: { levelId: lv, kind: 'spot', at: [3000, 2000, 2600], intensity: 1200 } }]);
  });
});

describe('PaintTool', () => {
  it('paints the face of a wall on the side clicked, and the floor of a room anywhere in it', () => {
    const { host } = harness();
    const ring: Entity = { id: 'wal_000000000000000r', type: 'wall', levelId: lv, layerId: layer, path: rectPath(0, 0, 4000, 3000), thickness: 200, height: null, alignment: 'center', baseOffset: 0 };
    const room: Entity = { id: 'rom_000000000000000r', type: 'room', levelId: lv, layerId: layer, name: 'Hall', boundary: { k: 'detect', seed: [2000, 1500] } };
    const entities: Record<string, Entity> = { [ring.id]: ring, [room.id]: room };
    const scene = createLevelScene(lv);
    syncLevelScene(scene, entities, {});
    const walls = deriveWalls([ring as Extract<Entity, { type: 'wall' }>]);
    const geometry = deriveLevelGeometry(entities);
    host.entities = () => entities;
    host.hit = (p) => hitTest(scene, p, { tolerance: 50, layers, walls, geometry });
    host.geometry = () => geometry;
    const options = host.options;
    host.options = () => ({ ...options(), paint: { ref: 'builtin:paint-sage', name: 'Sage paint' } });
    const tool = new PaintTool(host);
    expect(tool.hint()).toMatch(/Sage paint/);
    tool.pointerDown(at(2000, 50));
    tool.pointerDown(at(2000, -50));
    tool.pointerDown(at(3500, 2500));
    expect(host.calls.map((c) => c.input)).toEqual([
      { target: { wallId: ring.id, side: 'left' }, material: 'builtin:paint-sage' },
      { target: { wallId: ring.id, side: 'right' }, material: 'builtin:paint-sage' },
      { target: { roomId: room.id, surface: 'floor' }, material: 'builtin:paint-sage' },
    ]);
  });
});

describe('items on the plan', () => {
  it('are hit by their footprint, not their centre alone', () => {
    const { host } = harness();
    // The 3-seat sofa is 2200 × 900 around (1000, 1000).
    expect(host.hit([1000 + 1000, 1000 + 400])?.id).toBe(sofa.id);
    expect(host.hit([1000 + 1200, 1000])).toBeNull();
  });

  it('turn by their grip: the front faces the cursor, held on 15° steps', () => {
    const { host } = harness();
    host.select([sofa.id]);
    const [grip] = gripsOf(sofa, { [sofa.id]: sofa }, {});
    // In front of the sofa (−y), past its half depth.
    expect(grip.kind).toBe('rotate');
    expect(grip.at[0]).toBeCloseTo(1000);
    expect(grip.at[1]).toBeLessThan(1000 - 450);
    const tool = new SelectTool(host);
    tool.pointerDown(at(grip.at[0], grip.at[1]));
    tool.pointerMove(at(3000, 1050));
    // Towards +x (east) at about 1.4°: a quarter turn, held on 90°.
    tool.pointerUp(at(3000, 1050));
    expect(host.calls).toEqual([{ id: 'plan.entity.update', input: { id: sofa.id, set: { rotation: [0, 0, 90] }, baseSeq: 3, epoch: 1 } }]);
  });
});
