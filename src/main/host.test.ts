import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Host } from './host';

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-host-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('Host.stop', () => {
  it('stops once when called again (Windows logoff, then quit)', async () => {
    let stops = 0;
    let release!: () => void;
    const host = new Host({
      userDataDir: dir,
      version: 'test',
      platform: 'test',
      cipher: { available: false, encrypt: () => new Uint8Array(), decrypt: () => '' },
      broadcast: () => {},
      extraModules: [{ id: 'probe', commands: [], onStop: () => (stops++, new Promise<void>((r) => (release = r))) }],
    });
    const first = host.stop();
    const second = host.stop();
    await new Promise((r) => setTimeout(r, 10));
    expect(stops).toBe(1);
    release();
    await Promise.all([first, second]);
    await host.stop();
    expect(stops).toBe(1);
  });
});
