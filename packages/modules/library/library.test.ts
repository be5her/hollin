import { CommandRegistry, testHost, type CommandContext } from '@studio/core';
import { describe, expect, it } from 'vitest';
import { libraryModule } from './main';

describe('library commands', () => {
  it('refuse relative paths for packages and the library folder before touching anything', async () => {
    const registry = new CommandRegistry();
    registry.registerModule(libraryModule);
    // The test host has no library: a call that got past its input would fail with INTERNAL.
    const ctx = { host: testHost({ registry }), caller: 'ui' } as unknown as CommandContext;
    const calls: [string, Record<string, unknown>][] = [
      ['project.export', { id: 'prj_0000000000000000', path: 'House.psp' }],
      ['project.import', { path: '../House.psp' }],
      ['library.move', { path: 'Library', mode: 'move' }],
    ];
    for (const [id, input] of calls) {
      await expect(registry.execute(id, input, ctx)).rejects.toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('absolute') });
      await expect(registry.execute(id, { ...input, path: process.platform === 'win32' ? 'C:\\Out\\House.psp' : '/out/House.psp' }, ctx)).rejects.toMatchObject({ code: 'INTERNAL' });
    }
  });
});
