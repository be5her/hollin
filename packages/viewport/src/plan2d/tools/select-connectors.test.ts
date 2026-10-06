import { describe, expect, it } from 'vitest';
import { DEFAULT_RULE_LIMITS, Transaction, addConnectorOps, addEntityOps, addLevelOps, newProjectDoc, type Op, type ProjectDoc } from '@studio/core';
import { planConnectors, type PlanConnector } from '../connectors';
import { gripsOfConnector } from '../grips';
import { hitAll, hitTest, marqueeSelect } from '../hit';
import { createLevelScene, syncLevelScene } from '../scene';
import { SelectTool } from './select';
import type { VertexRef } from '../grips';
import { DEFAULT_TOOL_OPTIONS, type Clipboard, type ToolHost, type ToolPointer } from './tool';

function commit(doc: ProjectDoc, ops: Op[]): ProjectDoc {
  const tx = new Transaction(doc);
  tx.apply(ops);
  return tx.commit()?.doc ?? doc;
}

/** Two storeys with a straight stair (axis (2000, 1000) to (2000, 4750), 1000 wide) and a column inside its footprint on the ground floor. */
function harness() {
  let doc = newProjectDoc({ name: 'Test' });
  const ground = doc.building.groundLevelId;
  const upper = addLevelOps(doc, { name: 'Upper' });
  doc = commit(doc, upper.ops);
  const stair = addConnectorOps({ kind: 'stair', shape: 'straight', bottom: { levelId: ground }, top: { levelId: upper.levelId }, axis: { closed: false, v: [{ p: [2000, 1000] }, { p: [2000, 4750] }] }, width: 1000 });
  doc = commit(doc, stair.ops);
  const column = addEntityOps(doc, { levelId: ground, entity: { type: 'column', at: [2000, 4000], shape: { k: 'rect', w: 200, d: 200 } } });
  doc = commit(doc, column.ops);
  const entities = doc.levelData[ground].entities;
  const layers = doc.layers;
  const scene = createLevelScene(ground);
  syncLevelScene(scene, entities);
  const connectors = planConnectors(doc, ground, DEFAULT_RULE_LIMITS);
  const byId = new Map(connectors.map((pc) => [pc.id, pc]));
  const calls: { id: string; input: unknown }[] = [];
  let selection = new Set<string>();
  let vertex: VertexRef | null = null;
  const options = { tolerance: 50, layers, walls: null, connectors };
  const host: ToolHost & { calls: typeof calls; selected(): string[] } = {
    calls,
    clipboard: null as Clipboard | null,
    invoke: async (id, input) => {
      calls.push({ id, input });
      return {};
    },
    levelId: () => ground,
    entities: () => entities,
    connectors: () => byId,
    previewConnector: (c) => planConnectors({ ...doc, connectors: { ...doc.connectors, [c.id]: c } }, ground, DEFAULT_RULE_LIMITS).find((pc) => pc.id === c.id) ?? null,
    levels: () => [],
    limits: () => DEFAULT_RULE_LIMITS,
    seq: () => 7,
    epoch: () => 1,
    options: () => DEFAULT_TOOL_OPTIONS,
    scale: () => 0.1,
    toScreen: (p) => [p[0] / 10, -p[1] / 10],
    invalidate: () => {},
    finish: () => {},
    vertex: () => vertex,
    selectVertex: (v) => (vertex = v),
    selection: () => selection,
    select: (ids, mode = 'replace') => {
      if (mode === 'replace') selection = new Set(ids);
      else for (const id of ids) if (mode === 'add' || !selection.has(id)) selection.add(id); else selection.delete(id);
    },
    hit: (p) => hitTest(scene, p, options),
    marquee: (box, mode) => marqueeSelect(scene, box, mode, options),
    walls: () => null,
    geometry: () => null,
    snap: () => null,
    requestText: () => {},
    selected: () => [...selection].sort(),
  };
  return { host, scene, options, connectors, stairId: stair.id, columnId: column.id };
}

const at = (x: number, y: number, extra: Partial<ToolPointer> = {}): ToolPointer => ({ world: [x, y], screen: [x / 10, -y / 10], button: 0, shift: false, ctrl: false, alt: false, clicks: 1, ...extra });
const keyOf = (key: string, extra: Partial<KeyboardEvent> = {}) => ({ key, ctrlKey: false, metaKey: false, shiftKey: false, ...extra }) as KeyboardEvent;

describe('connectors on the plan', () => {
  it('shows a stair on the level it starts from and hits it anywhere on its footprint, after a column inside it', () => {
    const { scene, options, connectors, stairId, columnId } = harness();
    expect(connectors.map((pc: PlanConnector) => [pc.id, pc.role])).toEqual([[stairId, 'bottom']]);
    expect(hitAll(scene, [2300, 2000], options).map((h) => [h.id, h.type])).toEqual([[stairId, 'connector']]);
    expect(hitAll(scene, [2000, 4000], options).map((h) => h.id)).toEqual([columnId, stairId]);
    expect(hitAll(scene, [3000, 2000], options)).toEqual([]);
    expect(marqueeSelect(scene, { minX: 1000, minY: 500, maxX: 3000, maxY: 5000 }, 'window', options)).toContain(stairId);
    expect(marqueeSelect(scene, { minX: 1000, minY: 500, maxX: 3000, maxY: 3000 }, 'window', options)).not.toContain(stairId);
  });

  it('gives a stair the grips of its axis', () => {
    const { connectors } = harness();
    const grips = gripsOfConnector(connectors[0].connector);
    expect(grips.filter((g) => g.kind === 'vertex').map((g) => g.at)).toEqual([
      [2000, 1000],
      [2000, 4750],
    ]);
    expect(grips.filter((g) => g.kind === 'mid')).toHaveLength(1);
  });

  it('selects, drags, reshapes and deletes a stair through the same commands as entities', () => {
    const { host, stairId } = harness();
    const tool = new SelectTool(host);
    tool.pointerDown(at(2300, 2000));
    tool.pointerUp(at(2300, 2000));
    expect(host.selected()).toEqual([stairId]);
    expect(tool.hint()).toMatch(/^Stair selected/);
    // A drag moves it whole.
    tool.pointerDown(at(2300, 2000));
    tool.pointerMove(at(2800, 2000));
    tool.pointerUp(at(2800, 2000));
    expect(host.calls.at(-1)).toEqual({ id: 'plan.transform', input: { ids: [stairId], translate: [500, 0], copy: false } });
    // The top of its walk line (screen (200, -475)) is a grip.
    tool.pointerDown(at(2000, 4750));
    tool.pointerMove(at(2000, 5250));
    tool.pointerUp(at(2000, 5250));
    expect(host.calls.at(-1)).toEqual({ id: 'plan.path.vertex.move', input: { id: stairId, which: 'outer', index: 1, to: [2000, 5250], baseSeq: 7, epoch: 1 } });
    expect(tool.key(keyOf('Delete'))).toBe(true);
    expect(host.calls.at(-1)).toEqual({ id: 'plan.entity.delete', input: { ids: [stairId] } });
  });

  it('takes stairs into select-all, copy and paste', async () => {
    const { host, stairId, columnId } = harness();
    const tool = new SelectTool(host);
    tool.key(keyOf('a', { ctrlKey: true }));
    expect(host.selected()).toEqual([columnId, stairId].sort());
    host.select([stairId]);
    tool.key(keyOf('c', { ctrlKey: true }));
    tool.pointerMove(at(6000, 2875));
    tool.key(keyOf('v', { ctrlKey: true }));
    await Promise.resolve();
    const paste = host.calls.at(-1) as { id: string; input: { steps: { command: string; input: { connector: { axis: { v: { p: number[] }[] }; id?: string } } }[] } };
    expect(paste.id).toBe('plan.apply');
    expect(paste.input.steps.map((s) => s.command)).toEqual(['building.connector.add']);
    // Copied around the middle of its footprint (2000, 2875), pasted at the cursor.
    expect(paste.input.steps[0].input.connector.axis.v.map((v) => v.p)).toEqual([
      [6000, 1000],
      [6000, 4750],
    ]);
    expect(paste.input.steps[0].input.connector.id).toBeUndefined();
  });
});
