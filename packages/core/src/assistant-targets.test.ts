import { describe, expect, it } from 'vitest';
import { targetIdsOf } from './assistant-targets';

const wall = 'wal_0123456789abcdef';
const stair = 'str_0123456789abcdeg';

describe('targetIdsOf', () => {
  it('reads ids and id at the top level and in the steps of a batch', () => {
    expect(targetIdsOf({ ids: [wall, stair] })).toEqual([wall, stair]);
    expect(targetIdsOf({ id: wall })).toEqual([wall]);
    const deleting = (c: string) => c === 'plan.entity.delete';
    expect(targetIdsOf({ label: 'Clear', steps: [{ command: 'plan.entity.delete', input: { ids: [wall] } }, { command: 'plan.entity.delete', input: { ids: [wall, stair] } }] }, deleting)).toEqual([wall, stair]);
  });

  it("outlines only the steps of a batch that delete, never the batch's other edits", () => {
    const label = 'lbl_0123456789abcdef';
    const batch = { label: 'Tidy up', steps: [{ command: 'plan.entity.update', input: { id: label, patch: { text: 'Hall' } } }, { command: 'plan.entity.delete', input: { ids: [wall] } }, { command: 'plan.transform', input: { ids: [stair] } }] };
    expect(targetIdsOf(batch, (c) => c === 'plan.entity.delete')).toEqual([wall]);
    // Without a test for the steps, a batch names nothing to outline.
    expect(targetIdsOf(batch)).toEqual([]);
    // Malformed steps are skipped.
    expect(targetIdsOf({ steps: [null, 3, { input: { ids: [wall] } }] }, () => true)).toEqual([]);
  });

  it('gives nothing for an input that names no ids', () => {
    expect(targetIdsOf({})).toEqual([]);
    expect(targetIdsOf(null)).toEqual([]);
    expect(targetIdsOf('wal_0123456789abcdef')).toEqual([]);
    expect(targetIdsOf({ ids: ['not an id', 3] })).toEqual([]);
  });
});
