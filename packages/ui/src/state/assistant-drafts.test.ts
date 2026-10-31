import { Injector, runInInjectionContext } from '@angular/core';
import type { HostEvents } from '@studio/core';
import { describe, expect, it } from 'vitest';
import { HostBridge } from '../host/host-bridge';
import { AssistantDrafts } from './assistant-drafts';

describe('AssistantDrafts', () => {
  it("hands an offer to its project's panel once, and drops it when that project closes first", () => {
    let changed: ((payload: HostEvents['project.changed']) => void) | undefined;
    const bridge = { on: (_event: string, listener: typeof changed) => ((changed = listener), () => {}) };
    const injector = Injector.create({ providers: [{ provide: HostBridge, useValue: bridge }] });
    const drafts = runInInjectionContext(injector, () => new AssistantDrafts());
    drafts.offer('prj_a', 'a studio');
    expect(drafts.take('prj_b')).toBeNull();
    expect(drafts.take('prj_a')).toBe('a studio');
    expect(drafts.take('prj_a')).toBeNull();
    drafts.offer('prj_a', 'a cabin');
    changed!({ projectId: 'prj_b', kind: 'closed' });
    expect(drafts.pending()).toEqual({ projectId: 'prj_a', text: 'a cabin' });
    changed!({ projectId: 'prj_a', kind: 'save' });
    expect(drafts.pending()).not.toBeNull();
    changed!({ projectId: 'prj_a', kind: 'closed' });
    expect(drafts.pending()).toBeNull();
    expect(drafts.take('prj_a')).toBeNull();
  });
});
