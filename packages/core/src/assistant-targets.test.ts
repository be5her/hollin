import { describe, expect, it } from 'vitest';
import { targetIdsOf } from './assistant-targets';

const wall = 'wal_0123456789abcdef';
const stair = 'str_0123456789abcdeg';

describe('targetIdsOf', () => {
  it('reads ids and id at the top level and in the steps of a batch', () => {
    expect(targetIdsOf({ ids: [wall, stair] })).toEqual([wall, stair]);
    expect(targetIdsOf({ id: wall })).toEqual([wall]);
    expect(targetIdsOf({ label: 'Clear', steps: [{ command: 'plan.entity.delete', input: { ids: [wall] } }, { command: 'plan.entity.delete', input: { ids: [wall, stair] } }] })).toEqual([wall, stair]);
  });

  it('gives nothing for an input that names no ids', () => {
    expect(targetIdsOf({})).toEqual([]);
    expect(targetIdsOf(null)).toEqual([]);
    expect(targetIdsOf('wal_0123456789abcdef')).toEqual([]);
    expect(targetIdsOf({ ids: ['not an id', 3] })).toEqual([]);
  });
});
