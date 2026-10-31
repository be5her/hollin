import { Injector, runInInjectionContext, signal } from '@angular/core';
import type { Author, DocPatch, HostEventName, HostEvents, Op } from '@studio/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HostBridge } from '../host/host-bridge';
import { OttoEdits } from './otto-edits';

/** A `HostBridge` that only delivers the events a test emits. */
class FakeBridge {
  private readonly listeners = new Map<string, Set<(payload: unknown) => void>>();
  on<E extends HostEventName>(event: E, listener: (payload: HostEvents[E]) => void): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener as (payload: unknown) => void);
    this.listeners.set(event, set);
    return () => void set.delete(listener as (payload: unknown) => void);
  }
  emit<E extends HostEventName>(event: E, payload: HostEvents[E]): void {
    for (const l of this.listeners.get(event) ?? []) l(payload);
  }
}

const otto: Author = { kind: 'assistant', name: 'claude-test' };
const you: Author = { kind: 'user', name: 'You' };
const agent: Author = { kind: 'mcp', name: 'Cursor' };
const P = 'prj_0000000000000001';

const ins = (id: string): Op => ({ t: 'ins', c: 'entity', id, lv: 'lvl_0000000000000001', v: { id } });
const upd = (id: string): Op => ({ t: 'upd', c: 'entity', id, lv: 'lvl_0000000000000001', set: {} });
const del = (id: string): Op => ({ t: 'del', c: 'entity', id, lv: 'lvl_0000000000000001' });

describe('OttoEdits', () => {
  let bridge: FakeBridge;
  let edits: OttoEdits;
  let seq = 0;
  const patch = (txId: string, author: Author, kind: DocPatch['tx']['kind'], ops: Op[], label = 'Add a wall', projectId = P) =>
    bridge.emit('doc.patched', { projectId, epoch: 1, seq: ++seq, tx: { id: txId, label, author, kind }, ops, history: { undo: null, redo: null } });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-31T12:00:00Z'));
    bridge = new FakeBridge();
    const injector = Injector.create({ providers: [{ provide: HostBridge, useValue: bridge }] });
    edits = runInInjectionContext(injector, () => new OttoEdits());
  });
  afterEach(() => vi.useRealTimers());

  const of = (projectId = P) => edits.of(signal(projectId))();

  it("marks Otto's edits with the ids it added or changed, never the ones it removed", () => {
    patch('tx_1', otto, 'do', [ins('wal_a'), upd('wal_b'), del('wal_c'), { t: 'upd', c: 'layer', id: 'lay_a', set: {} }]);
    expect(of()).toEqual([{ txId: 'tx_1', ids: ['wal_a', 'wal_b'], label: 'Add a wall', at: Date.now() }]);
    // Your edits and an MCP agent's are not Otto's.
    patch('tx_2', you, 'do', [ins('wal_d')]);
    patch('tx_3', agent, 'do', [ins('wal_e')]);
    expect(of().map((e) => e.txId)).toEqual(['tx_1']);
    // Other projects keep their own.
    expect(of('prj_0000000000000002')).toEqual([]);
  });

  it('removes an undone edit at once and brings it back on redo with its first age', () => {
    patch('tx_1', otto, 'do', [ins('wal_a')]);
    const at = Date.now();
    vi.advanceTimersByTime(20_000);
    patch('tx_1', otto, 'undo', [del('wal_a')]);
    expect(of()).toEqual([]);
    vi.advanceTimersByTime(10_000);
    patch('tx_1', otto, 'redo', [ins('wal_a')]);
    expect(of()).toEqual([{ txId: 'tx_1', ids: ['wal_a'], label: 'Add a wall', at }]);
    // Still gone a minute after it first landed, not after the redo.
    vi.advanceTimersByTime(30_100);
    expect(of()).toEqual([]);
  });

  it('fades an edit out a minute after it landed', () => {
    patch('tx_1', otto, 'do', [ins('wal_a')]);
    vi.advanceTimersByTime(59_000);
    expect(of()).toHaveLength(1);
    vi.advanceTimersByTime(1_100);
    expect(of()).toEqual([]);
  });

  it('clears the marks over 200 ms on your next edit, and on an agent\'s', () => {
    patch('tx_1', otto, 'do', [ins('wal_a')]);
    patch('tx_2', otto, 'do', [ins('wal_b')]);
    vi.advanceTimersByTime(1000);
    patch('tx_3', you, 'do', [ins('wal_c')]);
    expect(of().map((e) => e.clearedAt)).toEqual([Date.now(), Date.now()]);
    vi.advanceTimersByTime(250);
    expect(of()).toEqual([]);
    patch('tx_4', otto, 'do', [ins('wal_d')]);
    patch('tx_5', agent, 'undo', [del('wal_x')]);
    expect(of()[0].clearedAt).toBe(Date.now());
    vi.advanceTimersByTime(250);
    expect(of()).toEqual([]);
  });

  it('merges a step that coalesced into the one before it, keeping both sets of ids', () => {
    patch('tx_1', otto, 'do', [ins('wal_a')]);
    const at = Date.now();
    vi.advanceTimersByTime(500);
    patch('tx_1', otto, 'do', [upd('wal_a'), ins('wal_b')], 'Add two walls');
    expect(of()).toEqual([{ txId: 'tx_1', ids: ['wal_a', 'wal_b'], label: 'Add two walls', at: at + 500 }]);
  });

  it('ignores project details, and forgets everything on a replace or when the project closes', () => {
    patch('tx_1', otto, 'do', [ins('wal_a')]);
    patch('tx_m', otto, 'meta', [{ t: 'upd', c: 'meta', id: 'meta', set: { name: 'x' } }]);
    expect(of()).toHaveLength(1);
    patch('tx_r', otto, 'replace', []);
    expect(of()).toEqual([]);
    patch('tx_2', otto, 'do', [ins('wal_b')]);
    bridge.emit('project.changed', { projectId: P, kind: 'closed' });
    expect(of()).toEqual([]);
  });
});
