import { describe, expect, it } from 'vitest';
import { deriveWalls, type Entity, type Layer } from '@studio/core';
import { hitTest, marqueeSelect } from '../hit';
import { createLevelScene, syncLevelScene } from '../scene';
import { SelectTool } from './select';
import { DEFAULT_TOOL_OPTIONS, type Clipboard, type ToolHost, type ToolPointer } from './tool';

const lv = 'lvl_0000000000000001';
const layer = 'lyr_0000000000000001';
const layers: Record<string, Layer> = { [layer]: { id: layer, levelId: lv, kind: 'structure', name: 'Structure', order: 0, visible: true, locked: false, opacity: 1 } };
const wall = (id: string, y: number): Entity => ({ id, type: 'wall', levelId: lv, layerId: layer, path: { closed: false, v: [{ p: [0, y] }, { p: [5000, y] }] }, thickness: 200, height: null, alignment: 'center', baseOffset: 0 });

function harness() {
  const a = wall('wal_000000000000000a', 0);
  const b = wall('wal_000000000000000b', 3000);
  const door: Entity = { id: 'opn_000000000000000d', type: 'opening', levelId: lv, layerId: layer, kind: 'door', wallId: a.id, along: 1000, width: 900, height: 2100, sill: 0 };
  let entities: Record<string, Entity> = { [a.id]: a, [b.id]: b, [door.id]: door };
  const scene = createLevelScene(lv);
  syncLevelScene(scene, entities);
  const walls = deriveWalls([a, b] as Extract<Entity, { type: 'wall' }>[]);
  const calls: { id: string; input: unknown }[] = [];
  let selection = new Set<string>();
  const host: ToolHost & { calls: typeof calls; setEntities(e: Record<string, Entity>): void; selected(): string[] } = {
    calls,
    clipboard: null as Clipboard | null,
    invoke: async (id, input) => {
      calls.push({ id, input });
      return { ids: ['new'] };
    },
    levelId: () => lv,
    entities: () => entities,
    options: () => DEFAULT_TOOL_OPTIONS,
    scale: () => 0.1,
    invalidate: () => {},
    finish: () => {},
    selection: () => selection,
    select: (ids, mode = 'replace') => {
      if (mode === 'replace') selection = new Set(ids);
      else for (const id of ids) if (mode === 'add' || !selection.has(id)) selection.add(id); else selection.delete(id);
    },
    hit: (p) => hitTest(scene, p, { tolerance: 50, layers, walls }),
    marquee: (box, mode) => marqueeSelect(scene, box, mode, { tolerance: 50, layers, walls }),
    walls: () => walls,
    setEntities: (e) => {
      entities = e;
      syncLevelScene(scene, e);
    },
    selected: () => [...selection].sort(),
  };
  return { host, a, b, door };
}

const at = (x: number, y: number, extra: Partial<ToolPointer> = {}): ToolPointer => ({ world: [x, y], screen: [x / 10, -y / 10], button: 0, shift: false, ctrl: false, alt: false, ...extra });
const keyOf = (key: string, extra: Partial<KeyboardEvent> = {}) => ({ key, ctrlKey: false, metaKey: false, shiftKey: false, ...extra }) as KeyboardEvent;

describe('SelectTool', () => {
  it('selects by click, toggles with Shift and clears on empty space', () => {
    const { host, a, b } = harness();
    const tool = new SelectTool(host);
    tool.pointerDown(at(3000, 0));
    tool.pointerUp(at(3000, 0));
    expect(host.selected()).toEqual([a.id]);
    tool.pointerDown(at(3000, 3000, { shift: true }));
    tool.pointerUp(at(3000, 3000, { shift: true }));
    expect(host.selected()).toEqual([a.id, b.id]);
    tool.pointerDown(at(3000, 0, { shift: true }));
    tool.pointerUp(at(3000, 0, { shift: true }));
    expect(host.selected()).toEqual([b.id]);
    tool.pointerDown(at(2000, 1500));
    tool.pointerUp(at(2000, 1500));
    expect(host.selected()).toEqual([]);
  });

  it('drags a marquee: window to the right, crossing to the left', () => {
    const { host, a, b, door } = harness();
    const tool = new SelectTool(host);
    tool.pointerDown(at(-500, -700));
    tool.pointerMove(at(5500, 3500));
    expect(tool.busy).toBe(true);
    tool.pointerUp(at(5500, 3500));
    expect(host.selected()).toEqual([door.id, a.id, b.id].sort());
    tool.pointerDown(at(3000, 1500));
    tool.pointerMove(at(2000, -500));
    tool.pointerUp(at(2000, -500));
    expect(host.selected()).toEqual([a.id]);
  });

  it('moves the selection by dragging and sends one transform on release', () => {
    const { host, a } = harness();
    const tool = new SelectTool(host);
    tool.pointerDown(at(3000, 0));
    tool.pointerMove(at(3000, 500));
    expect(tool.busy).toBe(true);
    expect([...tool.excluded()]).toEqual([a.id]);
    tool.pointerUp(at(3000, 500));
    expect(host.calls).toEqual([{ id: 'plan.transform', input: { ids: [a.id], translate: [0, 500], copy: false } }]);
    expect(tool.busy).toBe(false);
  });

  it('drops a drag whose entity an agent deleted', () => {
    const { host, a, b, door } = harness();
    const tool = new SelectTool(host);
    tool.pointerDown(at(3000, 0));
    tool.pointerMove(at(3000, 500));
    host.setEntities({ [b.id]: b });
    tool.documentChanged({ [b.id]: b });
    expect(tool.busy).toBe(false);
    tool.pointerUp(at(3000, 500));
    expect(host.calls).toEqual([]);
    void a;
    void door;
  });

  it('nudges, deletes, duplicates, rotates and mirrors through commands', () => {
    const { host, a } = harness();
    const tool = new SelectTool(host);
    host.select([a.id]);
    expect(tool.key(keyOf('ArrowRight'))).toBe(true);
    expect(tool.key(keyOf('ArrowUp', { shiftKey: true }))).toBe(true);
    expect(host.calls[0]).toEqual({ id: 'plan.transform', input: { ids: [a.id], translate: [100, 0], nudge: true } });
    expect(host.calls[1]).toEqual({ id: 'plan.transform', input: { ids: [a.id], translate: [0, 1000], nudge: true } });
    expect(tool.key(keyOf('d', { ctrlKey: true }))).toBe(true);
    expect(host.calls[2]).toEqual({ id: 'plan.transform', input: { ids: [a.id], translate: [100, -100], copy: true } });
    expect(tool.key(keyOf('r'))).toBe(true);
    tool.pointerDown(at(0, 0));
    tool.pointerDown(at(1000, 0));
    tool.pointerDown(at(0, 1000));
    expect(host.calls[3]).toEqual({ id: 'plan.transform', input: { ids: [a.id], rotate: { angle: 90, pivot: [0, 0] }, copy: false } });
    expect(tool.key(keyOf('M', { shiftKey: true }))).toBe(true);
    tool.pointerDown(at(0, 500));
    tool.pointerDown(at(1000, 500, { ctrl: true }));
    expect(host.calls[4]).toEqual({ id: 'plan.transform', input: { ids: [a.id], mirror: { a: [0, 500], b: [1000, 500] }, copy: true } });
    expect(tool.key(keyOf('Delete'))).toBe(true);
    expect(host.calls[5]).toEqual({ id: 'plan.entity.delete', input: { ids: [a.id] } });
  });

  it('copies and pastes as one batch with openings naming their walls', async () => {
    const { host, a, door } = harness();
    const tool = new SelectTool(host);
    host.select([a.id]);
    expect(tool.key(keyOf('c', { ctrlKey: true }))).toBe(true);
    expect(host.clipboard?.entities.map((e) => e.id).sort()).toEqual([door.id, a.id].sort());
    tool.pointerMove(at(2500 + 1000, 2000));
    expect(tool.key(keyOf('v', { ctrlKey: true }))).toBe(true);
    await Promise.resolve();
    const apply = host.calls.find((c) => c.id === 'plan.apply')!.input as { steps: { command: string; input: { entity: Record<string, unknown> }; as?: string }[] };
    expect(apply.steps.length).toBe(2);
    expect(apply.steps[0].as).toBe('w0');
    expect((apply.steps[0].input.entity['path'] as { v: { p: number[] }[] }).v[0].p).toEqual([1000, 2000]);
    expect(apply.steps[1].input.entity['wallId']).toBe('$w0');
  });
});
