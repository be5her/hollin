import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultConfig } from '../config';
import { WriteQueue, readJsonFile, renameWithRetry, writeFileAtomic } from './atomic-write';
import { ConfigStore } from './config-store';
import { SecretStore, type Cipher } from './secret-store';

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-test-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const busy = (code: string) => Object.assign(new Error(code), { code });

describe('renameWithRetry', () => {
  it('retries while Windows reports a transient lock', async () => {
    let calls = 0;
    const rename = async () => {
      calls++;
      if (calls < 4) throw busy(calls % 2 ? 'EPERM' : 'EBUSY');
    };
    await renameWithRetry('a', 'b', { rename, sleep: async () => {} });
    expect(calls).toBe(4);
  });

  it('gives up after its budget, and at once on other errors', async () => {
    let calls = 0;
    const always = async () => {
      throw busy('EACCES');
    };
    await expect(renameWithRetry('a', 'b', { rename: always, sleep: async () => {}, budgetMs: 100 })).rejects.toMatchObject({ code: 'EACCES' });
    calls = 0;
    const missing = async () => {
      calls++;
      throw busy('ENOENT');
    };
    await expect(renameWithRetry('a', 'b', { rename: missing, sleep: async () => {} })).rejects.toMatchObject({ code: 'ENOENT' });
    expect(calls).toBe(1);
  });
});

describe('writeFileAtomic', () => {
  it('replaces the file and leaves no temp files, even with overlapping writes', async () => {
    const file = path.join(dir, 'nested', 'a.json');
    await Promise.all(Array.from({ length: 10 }, (_, i) => writeFileAtomic(file, `{"n":${i}}`)));
    expect(await readJsonFile<{ n: number }>(file)).toMatchObject({ n: expect.any(Number) });
    expect(await fs.readdir(path.dirname(file))).toEqual(['a.json']);
  });

  it('removes the temp file when the rename fails', async () => {
    const file = path.join(dir, 'b.json');
    await expect(writeFileAtomic(file, 'x', { rename: async () => Promise.reject(busy('ENOSPC')) })).rejects.toMatchObject({ code: 'ENOSPC' });
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it('reads a missing file as undefined', async () => {
    expect(await readJsonFile(path.join(dir, 'missing.json'))).toBeUndefined();
  });
});

describe('WriteQueue', () => {
  it('keeps running tasks after one fails', async () => {
    const queue = new WriteQueue();
    const order: number[] = [];
    const first = queue.run('k', async () => {
      order.push(1);
      throw new Error('disk full');
    });
    const second = queue.run('k', async () => void order.push(2));
    await expect(first).rejects.toThrow('disk full');
    await expect(second).resolves.toBeUndefined();
    expect(order).toEqual([1, 2]);
  });
});

describe('ConfigStore', () => {
  it('starts from defaults, persists updates and announces them', async () => {
    const file = path.join(dir, 'config.json');
    const seen: number[] = [];
    const store = new ConfigStore(file, (config) => seen.push(config.mcp.port));
    expect(await store.load()).toEqual(defaultConfig());
    await store.update({ mcp: { port: 9001 } });
    expect(seen).toEqual([9001]);
    const reloaded = await new ConfigStore(file).load();
    expect(reloaded.mcp.port).toBe(9001);
    expect(reloaded.mcp.enabled).toBe(true);
  });

  it('keeps a corrupt file aside and starts from defaults', async () => {
    const file = path.join(dir, 'config.json');
    await fs.writeFile(file, '{ not json');
    expect(await new ConfigStore(file).load()).toEqual(defaultConfig());
    const names = await fs.readdir(dir);
    expect(names.some((n) => n.startsWith('config.corrupt-'))).toBe(true);
    expect(names).not.toContain('config.json');
  });
});

describe('SecretStore', () => {
  const xor: Cipher = {
    available: true,
    encrypt: (plain) => Buffer.from(plain, 'utf8').map((b) => b ^ 0x5a),
    decrypt: (cipher) => Buffer.from(cipher.map((b) => b ^ 0x5a)).toString('utf8'),
  };

  it('stores secrets encrypted and reads them back', async () => {
    const file = path.join(dir, 'secrets.json');
    const store = new SecretStore(file, xor);
    await store.set('anthropic', 'sk-ant-secret');
    expect(await fs.readFile(file, 'utf8')).not.toContain('sk-ant-secret');
    const again = new SecretStore(file, xor);
    await again.load();
    expect(again.get('anthropic')).toBe('sk-ant-secret');
    await again.delete('anthropic');
    expect(again.has('anthropic')).toBe(false);
  });

  it('writes nothing without OS encryption', async () => {
    const file = path.join(dir, 'secrets.json');
    const store = new SecretStore(file, { ...xor, available: false });
    await store.set('anthropic', 'sk-ant-secret');
    expect(store.get('anthropic')).toBe('sk-ant-secret');
    expect(store.persistent).toBe(false);
    expect(await fs.readdir(dir)).toEqual([]);
  });
});
