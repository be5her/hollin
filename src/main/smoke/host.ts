import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { GlobalConfig } from '@studio/core';
import type { Smoke } from './harness';

/** The registry's checks, config and secrets, through commands as the UI calls them. */
export async function smokeHost(smoke: Smoke): Promise<void> {
  const { host } = smoke;
  const dataDir = host.opts.userDataDir;

  smoke.section('registry');
  await smoke.expectError('unknown command fails with UNKNOWN_COMMAND', 'no.such.command', {}, 'UNKNOWN_COMMAND');
  await smoke.expectError('project command without a project fails with NO_PROJECT', 'smoke.where', {}, 'NO_PROJECT');
  await smoke.expectError('a named project that is not open is NOT_FOUND', 'smoke.where', {}, 'NOT_FOUND', { projectId: 'prj_missing' });
  const invalid = await host.invoke('smoke.echo', { text: '', times: 9 }, { caller: 'ui' });
  smoke.check(
    'invalid input fails with INVALID_INPUT, one "path: message" per issue',
    !invalid.ok && invalid.error.code === 'INVALID_INPUT' && /text: .*; times: /.test(invalid.error.message),
    invalid,
  );
  const echo = await smoke.run<{ text: string; caller: string }>('smoke.echo', { text: 'ab', times: 2 });
  smoke.check('a valid command runs with defaults applied', echo.text === 'abab' && echo.caller === 'ui', echo);
  smoke.check('the UI is never gated', (await smoke.run<{ destroyed: boolean }>('smoke.destroy')).destroyed === true);
  const list = host.registry.list();
  smoke.check('the command list carries mutating, conditional, hidden and noInput', (() => {
    const by = (id: string) => list.find((c) => c.id === id);
    return by('smoke.destroy')?.mutating === true && by('smoke.maybe')?.conditional === true && by('config.update')?.hidden === true && by('app.info')?.noInput === true && by('smoke.echo')?.noInput === false;
  })());
  await smoke.expectError('the assistant cannot run mutating commands without a confirmation channel', 'smoke.destroy', {}, 'MUTATION_BLOCKED', { caller: 'assistant' });

  smoke.section('config');
  const info = await smoke.run<{ productName: string; version: string; mcp: { running: boolean } }>('app.info');
  smoke.check('app.info names the product and reports MCP running', info.productName.length > 0 && info.mcp.running, info);
  const from = smoke.events.length;
  await smoke.run('config.update', { patch: { units: { system: 'imperial', fraction: 8 } } });
  const onDisk = JSON.parse(await fs.readFile(path.join(dataDir, 'config.json'), 'utf8')) as GlobalConfig;
  smoke.check('config updates are written to config.json', onDisk.units.system === 'imperial' && onDisk.units.fraction === 8 && onDisk.units.metricUnit === 'mm', onDisk.units);
  smoke.check('config updates are announced with config.changed', smoke.eventsSince(from, 'config.changed').some((p) => p.config.units.system === 'imperial'));
  await smoke.expectError('config patches are validated', 'config.update', { patch: { units: { fraction: 3 } } }, 'INVALID_INPUT');
  await smoke.expectError('unknown config sections are refused', 'config.update', { patch: { nope: {} } }, 'INVALID_INPUT');
  await smoke.run('config.update', { patch: { units: { system: 'metric', fraction: 16 } } });

  smoke.section('secrets');
  const key = 'sk-ant-smoke-test-key-0123456789';
  const status = await smoke.run<{ set: boolean; persistent: boolean }>('ai.key.set', { key });
  smoke.check('the API key is stored', status.set);
  const secretsFile = path.join(dataDir, 'secrets.json');
  const raw = await fs.readFile(secretsFile, 'utf8').catch(() => '');
  if (status.persistent) smoke.check('the stored key is encrypted, not plain text', raw.length > 0 && !raw.includes(key) && !raw.includes('smoke-test'));
  else smoke.check('without OS encryption nothing is written', raw === '');
  smoke.check('nothing returns the key itself', !JSON.stringify(await smoke.run('ai.key.status')).includes(key) && !JSON.stringify(await smoke.run('config.get')).includes(key));
  await smoke.run('ai.key.clear');
  smoke.check('the API key can be removed', (await smoke.run<{ set: boolean }>('ai.key.status')).set === false);
}
