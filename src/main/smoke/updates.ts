import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { toolNameFor, type UpdateState } from '@studio/core';
import type { Smoke } from './harness';

const COMMANDS = ['app.update.status', 'app.update.check', 'app.update.download', 'app.update.install'];

/**
 * In-app updates through commands, with the scripted updater (`smoke/updater.ts`) in place of
 * electron-updater: the four commands are hidden (no palette entry, no MCP tool) yet run for the UI;
 * a check finds nothing, fails, or finds a version with notes; a download reports progress and ends
 * ready; install reaches the updater; a build without a feed is unsupported and says so.
 */
export async function smokeUpdates(smoke: Smoke): Promise<void> {
  smoke.section('updates');
  const { host } = smoke;
  const u = smoke.updates;
  const list = host.registry.list();
  const metas = COMMANDS.map((id) => list.find((c) => c.id === id));
  smoke.check('the four update commands exist and are hidden', metas.every((m) => m?.hidden === true), metas.map((m) => m && { id: m.id, hidden: m.hidden }));
  smoke.check('download and install are also mutating', metas[2]?.mutating === true && metas[3]?.mutating === true);

  const { url } = host.mcpStatus();
  const client = new Client({ name: 'smoke-updates', version: '1.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  const names = new Set((await client.listTools()).tools.map((t) => t.name));
  smoke.check('no update command is an MCP tool', COMMANDS.every((id) => !names.has(toolNameFor(id))) && names.size > 0);
  // The real protection: a hidden command is no tool, so calling it by its tool name over MCP finds nothing.
  // The SDK refuses an unknown tool with a protocol error (a rejected call); an error result would do as well.
  for (const id of ['app.update.download', 'app.update.install']) {
    const name = toolNameFor(id);
    const outcome = await client.callTool({ name, arguments: {} }).then(
      (result) => ({ rejected: false, isError: result.isError === true, text: JSON.stringify(result.content) }),
      (err: unknown) => ({ rejected: true, isError: true, text: err instanceof Error ? err.message : String(err) }),
    );
    smoke.check(`an MCP client calling ${name} by name gets an unknown tool`, outcome.isError && /not found/i.test(outcome.text), outcome);
  }
  await client.close();
  smoke.check('nothing was downloaded or installed through MCP', u.status().state === 'idle' && u.installs === 0, { state: u.status(), installs: u.installs });
  // Only the mutating gate: `execute` runs a hidden command for any caller, so an MCP caller naming install is refused for being mutating.
  await smoke.expectError('the mutating gate refuses install to an MCP caller', 'app.update.install', {}, 'MUTATION_BLOCKED', { caller: 'mcp' });
  await smoke.expectError('and download', 'app.update.download', {}, 'MUTATION_BLOCKED', { caller: 'mcp' });

  smoke.check('the startup check is on by default', host.config.get().updates.check === true);
  smoke.check('a fresh data folder has never checked', (await smoke.run<UpdateState>('app.update.status')).state === 'idle');
  smoke.check('app.info says this build can update', (await smoke.run<{ updates: boolean }>('app.info')).updates === true);
  await smoke.expectError('nothing to download before a check', 'app.update.download', {}, 'CONFLICT');
  await smoke.expectError('nothing to install before a download', 'app.update.install', {}, 'CONFLICT');

  let from = smoke.events.length;
  u.script({ outcome: 'up-to-date' });
  const latest = await smoke.run<UpdateState>('app.update.check');
  const states = () => smoke.eventsSince(from, 'update.changed').map((s) => s.state);
  smoke.check('a check that finds nothing: checking, then up-to-date, announced', latest.state === 'up-to-date' && Boolean(latest.checkedAt) && latest.scheduled === false && states().join() === 'checking,up-to-date', states());
  await u.idle();
  const stamp = JSON.parse(await fs.readFile(path.join(host.opts.userDataDir, 'updates.json'), 'utf8').catch(() => '{}')) as { checkedAt?: string };
  smoke.check('the time of the check is kept in the data folder, not in config', stamp.checkedAt === latest.checkedAt && !JSON.stringify(host.config.get()).includes(latest.checkedAt!), stamp);

  u.script({ outcome: 'error', message: 'net::ERR_INTERNET_DISCONNECTED' });
  const failed = await smoke.run<UpdateState>('app.update.check');
  smoke.check('a failed check is state error with the message, not a failed command', failed.state === 'error' && failed.message === 'net::ERR_INTERNET_DISCONNECTED' && failed.checkedAt === latest.checkedAt, failed);

  from = smoke.events.length;
  u.script({ outcome: 'available', version: '1.2.3', notes: 'Faster exports.\n- The PDF title block fits long names.' });
  const found = await smoke.run<UpdateState>('app.update.check');
  smoke.check('a check finds 1.2.3 with its notes', found.state === 'available' && found.version === '1.2.3' && found.notes?.includes('title block') === true, found);
  from = smoke.events.length;
  const started = await smoke.run<UpdateState>('app.update.download');
  smoke.check('download returns at once, downloading from 0 %', started.state === 'downloading' && started.progress === 0, started);
  smoke.check('the download ends ready', await smoke.until(() => u.status().state === 'ready'), u.status());
  const progress = smoke.eventsSince(from, 'update.changed').filter((s) => s.state === 'downloading').map((s) => s.progress ?? -1);
  smoke.check('progress is announced, rising to 100', progress.length >= 3 && progress.every((p, i) => i === 0 || p > progress[i - 1]) && progress.at(-1) === 100, progress);
  smoke.check('a check leaves a downloaded update alone', (await smoke.run<UpdateState>('app.update.check')).state === 'ready');
  const installs = u.installs;
  const installed = await smoke.run<UpdateState>('app.update.install');
  smoke.check('install reaches the updater (the fake records it and does not quit)', u.installs === installs + 1 && installed.state === 'ready', { installs: u.installs, installed });

  u.reset();
  u.unsupported('this build has no update feed (only release builds have one)');
  from = smoke.events.length;
  const none = await smoke.run<UpdateState>('app.update.check');
  smoke.check('a build without a feed is unsupported, says why, and a check does nothing', none.state === 'unsupported' && /no update feed/.test(none.message ?? '') && !states().includes('checking'), none);
  smoke.check('app.info then says this build cannot update', (await smoke.run<{ updates: boolean }>('app.info')).updates === false);
  await smoke.expectError('nor can it download', 'app.update.download', {}, 'CONFLICT');
  u.unsupported(null);
  u.reset();
}
