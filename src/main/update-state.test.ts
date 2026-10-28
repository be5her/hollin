import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { HostEventMessage, UpdateState } from '@studio/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Host } from './host';
import { UpdaterBase, macSignedFromCodesign, plainNotes, startupCheckDue, updateSupport, type CheckOutcome, type SupportProbe } from './update-state';

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-updates-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('startupCheckDue', () => {
  const now = Date.parse('2026-10-28T12:00:00Z');
  it('runs when on and never checked, or checked a day ago or more', () => {
    expect(startupCheckDue(true, undefined, now)).toBe(true);
    expect(startupCheckDue(true, '2026-10-27T12:00:00Z', now)).toBe(true);
    expect(startupCheckDue(true, 'garbage', now)).toBe(true);
  });
  it('waits within 24 h, and never runs when off', () => {
    expect(startupCheckDue(true, '2026-10-27T13:00:00Z', now)).toBe(false);
    expect(startupCheckDue(false, undefined, now)).toBe(false);
  });
  it('treats a check time in the future (a clock set back) as never checked', () => {
    expect(startupCheckDue(true, '2026-11-28T12:00:00Z', now)).toBe(true);
  });
});

describe('plainNotes', () => {
  it('turns a GitHub release body into plain text', () => {
    const html = '<h2>Added</h2>\n<ul>\n<li>Exports to <strong>PDF</strong> &amp; DXF</li>\n<li>Line<br>break</li>\n</ul><p>See &lt;docs&gt; &#8212; &#x2713;</p><script>alert(1)</script>';
    expect(plainNotes(html)).toBe('Added\n\n- Exports to PDF & DXF\n\n- Line\nbreak\n\nSee <docs> — ✓');
  });
  it('joins a full changelog list and drops empty notes', () => {
    expect(plainNotes([{ version: '1.2.3', note: '<p>One</p>' }, { version: '1.2.2', note: null }])).toBe('1.2.3\nOne\n\n1.2.2');
    expect(plainNotes(null)).toBeUndefined();
    expect(plainNotes('<p> </p>')).toBeUndefined();
  });
  it('keeps unknown or invalid entities as written', () => {
    expect(plainNotes('a &hellip; b &#0; c')).toBe('a &hellip; b &#0; c');
  });
});

describe('updateSupport', () => {
  const files = (present: Record<string, string>): Pick<SupportProbe, 'exists' | 'read'> => ({ exists: (f) => f in present, read: (f) => present[f] });
  const base = { resourcesPath: '/app/resources', appPath: '/app/resources/app.asar' };
  it('needs a packaged build or a dev-app-update.yml in development', () => {
    expect(updateSupport({ ...base, packaged: false, platform: 'win32', ...files({}) }).reason).toMatch(/development/);
    expect(updateSupport({ ...base, packaged: false, platform: 'win32', ...files({ '/app/resources/app.asar/dev-app-update.yml': '' }) })).toEqual({ reason: null, devConfig: true });
  });
  it('needs the app-update.yml a release build carries', () => {
    expect(updateSupport({ ...base, packaged: true, platform: 'win32', ...files({}) }).reason).toMatch(/no update feed/);
    expect(updateSupport({ ...base, packaged: true, platform: 'win32', ...files({ '/app/resources/app-update.yml': '' }) })).toEqual({ reason: null, devConfig: false });
  });
  it('on Linux, an AppImage or an installed deb, rpm or pacman package', () => {
    const feed = { '/app/resources/app-update.yml': '' };
    expect(updateSupport({ ...base, packaged: true, platform: 'linux', ...files(feed) }).reason).toMatch(/AppImage/);
    expect(updateSupport({ ...base, packaged: true, platform: 'linux', appImage: '/home/u/App.AppImage', ...files(feed) }).reason).toBeNull();
    expect(updateSupport({ ...base, packaged: true, platform: 'linux', ...files({ ...feed, '/app/resources/package-type': 'deb\n' }) }).reason).toBeNull();
  });
  it('on macOS, only a signed app', () => {
    const feed = files({ '/app/resources/app-update.yml': '' });
    expect(updateSupport({ ...base, packaged: true, platform: 'darwin', macSigned: () => false, ...feed }).reason).toMatch(/not signed/);
    expect(updateSupport({ ...base, packaged: true, platform: 'darwin', macSigned: () => true, ...feed }).reason).toBeNull();
  });
});

describe('macSignedFromCodesign', () => {
  it('wants a team identifier, not ad hoc or unsigned', () => {
    expect(macSignedFromCodesign('Executable=/A.app\nSignature size=9000\nTeamIdentifier=ABCDE12345\n', 0)).toBe(true);
    expect(macSignedFromCodesign('Executable=/A.app\nSignature=adhoc\nTeamIdentifier=not set\n', 0)).toBe(false);
    expect(macSignedFromCodesign('/A.app: code object is not signed at all', 1)).toBe(false);
  });
});

/** A scripted updater for the state machine: `found` is what checks find, `fail` makes the next step throw. */
class TestUpdater extends UpdaterBase {
  found: CheckOutcome = null;
  fail: string | null = null;
  installed = 0;
  protected async find() {
    if (this.fail) throw new Error(`${this.fail}\n    at stack`);
    return this.found;
  }
  protected async fetch(progress: (p: number) => void) {
    for (const p of [0, 10.4, 10.9, 55, 100]) progress(p);
    if (this.fail) throw new Error(this.fail);
  }
  protected async apply() {
    this.installed++;
  }
}

const settle = () => new Promise((r) => setTimeout(r, 10));

describe('UpdaterBase', () => {
  it('checks, keeps the check time in its file, downloads with progress and installs', async () => {
    const stamp = path.join(dir, 'updates.json');
    const u = new TestUpdater(stamp, null);
    const seen: UpdateState[] = [];
    u.onChange((s) => seen.push(s));
    expect(u.status()).toEqual({ state: 'idle' });
    await expect(u.install()).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(() => u.download()).toThrow(/check for updates first/);

    u.found = { version: '1.2.3', notes: 'Fixes' };
    const found = await u.check({ scheduled: true });
    expect(found).toMatchObject({ state: 'available', version: '1.2.3', notes: 'Fixes', scheduled: true });
    await u.idle();
    expect(JSON.parse(await fs.readFile(stamp, 'utf8')).checkedAt).toBe(found.checkedAt);
    expect(new TestUpdater(stamp, null).status()).toEqual({ state: 'idle', checkedAt: found.checkedAt });

    expect(u.download()).toMatchObject({ state: 'downloading', progress: 0, version: '1.2.3' });
    await settle();
    expect(seen.filter((s) => s.state === 'downloading').map((s) => s.progress)).toEqual([0, 10, 55, 100]);
    expect(u.status()).toMatchObject({ state: 'ready', version: '1.2.3', progress: 100 });
    // A downloaded update is kept: a check leaves it alone.
    expect((await u.check()).state).toBe('ready');
    await u.install();
    expect(u.installed).toBe(1);
  });

  it('turns failures into state error, never a throw', async () => {
    const u = new TestUpdater(undefined, null);
    u.fail = 'net::ERR_INTERNET_DISCONNECTED';
    expect(await u.check()).toMatchObject({ state: 'error', message: 'net::ERR_INTERNET_DISCONNECTED', scheduled: false });
    u.fail = null;
    u.found = { version: '2.0.0' };
    await u.check();
    u.fail = 'checksum mismatch';
    u.download();
    await settle();
    expect(u.status()).toMatchObject({ state: 'error', message: 'checksum mismatch', version: '2.0.0' });
  });

  it('does nothing in a build that cannot update', async () => {
    const u = new TestUpdater(undefined, 'this is a development run');
    u.found = { version: '9.9.9' };
    expect(await u.check()).toEqual({ state: 'unsupported', message: 'this is a development run' });
  });
});

describe('Host and the updater', () => {
  it('announces update.changed and says in app.info whether the build can update', async () => {
    const events: HostEventMessage[] = [];
    const updater = new TestUpdater(undefined, null);
    const host = new Host({ userDataDir: dir, version: 'test', platform: 'test', cipher: { available: false, encrypt: () => new Uint8Array(), decrypt: () => '' }, broadcast: (m) => events.push(m), updater });
    const info = await host.invoke('app.info', {}, { caller: 'ui' });
    expect(info.ok && (info.result as { updates: boolean }).updates).toBe(true);
    await host.invoke('app.update.check', {}, { caller: 'ui' });
    expect(events.filter((e) => e.event === 'update.changed').map((e) => (e.payload as UpdateState).state)).toEqual(['checking', 'up-to-date']);
    const install = await host.invoke('app.update.install', {}, { caller: 'mcp' });
    expect(install.ok).toBe(false);
    expect(host.registry.list().filter((c) => c.id.startsWith('app.update.')).every((c) => c.hidden)).toBe(true);
  });
});
