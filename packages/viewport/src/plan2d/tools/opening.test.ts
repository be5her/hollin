import { describe, expect, it } from 'vitest';
import { deriveWalls, type Entity, type Layer } from '@studio/core';
import { hitTest } from '../hit';
import { createLevelScene, syncLevelScene } from '../scene';
import { OpeningTool } from './opening';
import { DEFAULT_TOOL_OPTIONS, type ToolHost, type ToolPointer } from './tool';

const lv = 'lvl_0000000000000001';
const layer = 'lyr_0000000000000001';
const layers: Record<string, Layer> = { [layer]: { id: layer, levelId: lv, kind: 'structure', name: 'Structure', order: 0, visible: true, locked: false, opacity: 1 } };
const wall: Entity = { id: 'wal_000000000000000a', type: 'wall', levelId: lv, layerId: layer, path: { closed: false, v: [{ p: [0, 0] }, { p: [5000, 0] }] }, thickness: 200, height: null, alignment: 'center', baseOffset: 0 };
const existing: Entity = { id: 'opn_000000000000000x', type: 'opening', levelId: lv, layerId: layer, kind: 'window', wallId: wall.id, along: 2500, width: 1200, height: 1200, sill: 900 };

function harness() {
  const entities = { [wall.id]: wall, [existing.id]: existing };
  const scene = createLevelScene(lv);
  syncLevelScene(scene, entities);
  const walls = deriveWalls([wall as Extract<Entity, { type: 'wall' }>]);
  const calls: { id: string; input: unknown }[] = [];
  const host: ToolHost & { calls: typeof calls } = {
    calls,
    clipboard: null,
    invoke: async (id, input) => {
      calls.push({ id, input });
      return { id: 'new' };
    },
    levelId: () => lv,
    entities: () => entities,
    seq: () => 1,
    epoch: () => 1,
    options: () => DEFAULT_TOOL_OPTIONS,
    scale: () => 0.1,
    toScreen: (p) => [p[0] / 10, -p[1] / 10],
    invalidate: () => {},
    finish: () => {},
    selection: () => new Set(),
    select: () => {},
    vertex: () => null,
    selectVertex: () => {},
    hit: (p) => hitTest(scene, p, { tolerance: 60, layers, walls }),
    marquee: () => [],
    walls: () => walls,
    snap: () => null,
  };
  return host;
}

const at = (x: number, y: number): ToolPointer => ({ world: [x, y], screen: [x / 10, -y / 10], button: 0, shift: false, ctrl: false, alt: false, clicks: 1 });

describe('OpeningTool', () => {
  it('places a door where the cursor projects on the wall, with the defaults', () => {
    const host = harness();
    const tool = new OpeningTool(host, 'door');
    tool.pointerMove(at(1000, 40));
    expect(tool.hint()).toContain('Click to place the door');
    tool.pointerDown(at(1000, 40));
    expect(host.calls[0]).toEqual({ id: 'plan.opening.add', input: { wallId: wall.id, kind: 'door', along: 1000, width: 900, height: 2100, sill: 0, swing: { hinge: 'start', side: 'left' } } });
  });

  it('moves the opening into the nearest free gap, and refuses where nothing fits', () => {
    const host = harness();
    const tool = new OpeningTool(host, 'window');
    // Over the existing window: the nearest gap starts at 2500 + 600 + 600.
    tool.pointerDown(at(2700, 0));
    expect(host.calls[0].input).toMatchObject({ kind: 'window', along: 3700, sill: 900 });
    tool.pointerDown(at(4950, 0));
    expect(host.calls[1].input).toMatchObject({ along: 4400 });
    tool.pointerMove(at(2500, 3000));
    expect(tool.hint()).toContain('Move over a wall');
    tool.pointerDown(at(2500, 3000));
    expect(host.calls.length).toBe(2);
  });

  it('flips the swing while placing and takes a typed distance from the start', () => {
    const host = harness();
    const tool = new OpeningTool(host, 'door');
    tool.pointerMove(at(1000, 0));
    expect(tool.key({ key: 'f' } as KeyboardEvent)).toBe(true);
    expect(tool.key({ key: 'h' } as KeyboardEvent)).toBe(true);
    expect(tool.acceptsTyped()).toBe(true);
    // 1500 would overlap the window (1900–3100); 1000 fits just before it.
    expect(tool.typed('1500', { k: 'length', mm: 1500 })).toBe(false);
    expect(tool.typed('1000', { k: 'length', mm: 1000 })).toBe(true);
    expect(host.calls[0].input).toMatchObject({ along: 1000, swing: { hinge: 'end', side: 'right' } });
    expect(tool.typed('-600', { k: 'length', mm: -600 })).toBe(true);
    expect(host.calls[1].input).toMatchObject({ along: 4400 });
    expect(tool.typed('100', { k: 'length', mm: 100 })).toBe(false);
  });
});
