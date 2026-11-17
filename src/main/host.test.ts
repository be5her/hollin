import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { currentLanguage, setLanguage } from '@studio/core';
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

describe('Host language', () => {
  const make = (systemLocale: string, events: unknown[]) =>
    new Host({
      userDataDir: dir,
      version: 'test',
      platform: 'test',
      cipher: { available: false, encrypt: () => new Uint8Array(), decrypt: () => '' },
      broadcast: (message) => void (message.event === 'language.changed' && events.push(message.payload)),
      systemLocale,
    });

  afterEach(() => setLanguage('en'));

  it('follows the system locale, announces a change and answers app.language', async () => {
    const events: unknown[] = [];
    const host = make('ar-EG', events);
    // No MCP server: the test must not take the port of an app that may be running.
    await fs.writeFile(path.join(dir, 'config.json'), JSON.stringify({ mcp: { enabled: false } }));
    await host.start();
    expect(currentLanguage()).toBe('ar');
    const answer = await host.invoke('app.language', {}, { caller: 'mcp' });
    expect(answer).toEqual({ ok: true, result: { language: 'ar', direction: 'rtl', preference: 'system', systemLocale: 'ar-EG' } });
    expect(host.registry.meta('app.language')?.readOnly).toBe(true);

    events.length = 0;
    await host.invoke('config.update', { patch: { appearance: { language: 'en' } } }, { caller: 'ui' });
    expect(events).toEqual([{ language: 'en', direction: 'ltr' }]);
    expect(currentLanguage()).toBe('en');
    // A config change that leaves the language as it was announces nothing.
    await host.invoke('config.update', { patch: { appearance: { theme: 'dark' } } }, { caller: 'ui' });
    expect(events).toHaveLength(1);
    await host.stop();
  });

  it('speaks English on a system whose language it does not speak', async () => {
    const host = make('fr-FR', []);
    await fs.writeFile(path.join(dir, 'config.json'), JSON.stringify({ mcp: { enabled: false } }));
    await host.start();
    expect(host.languageState()).toMatchObject({ language: 'en', direction: 'ltr' });
    await host.stop();
  });
});
