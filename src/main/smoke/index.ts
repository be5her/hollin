import { writeSync } from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type { Host } from '../host';
import { Smoke, freePort } from './harness';
import { smokeHost } from './host';
import { smokeMcp } from './mcp';
import { smokeShell } from './shell';

/**
 * `npm run smoke`: the built app, launched with `--smoke`, checks every feature through commands,
 * through MCP and through the UI, against a temporary data folder and a private MCP port.
 * `SMOKE_SHOTS=<dir>` also saves screenshots. Returns the process exit code.
 */
export async function runSmoke(host: Host, openWindow: () => BrowserWindow): Promise<number> {
  const shots = process.env.SMOKE_SHOTS ? path.resolve(process.env.SMOKE_SHOTS) : undefined;
  const smoke = new Smoke(host, shots);
  const started = Date.now();
  try {
    // Never share the default MCP port with a copy of the app that may already be running.
    const port = await freePort();
    await smoke.run('config.update', { patch: { mcp: { port } } });
    console.log(`MCP port used by this run: ${port}`);

    await smokeHost(smoke);
    await smokeMcp(smoke);

    smoke.section('renderer');
    await smoke.openWindow(openWindow);
    await smokeShell(smoke);
    smoke.check('renderer has no console errors', smoke.consoleErrors.length === 0, smoke.consoleErrors);
  } catch (err) {
    smoke.check(`unexpected error: ${(err as Error).stack ?? String(err)}`, false);
  } finally {
    smoke.closeWindow();
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const summary = smoke.failures.length ? `SMOKE FAILED (${smoke.failures.length} of ${smoke.passes + smoke.failures.length}): ${smoke.failures.join(' | ')}` : `SMOKE PASSED (${smoke.passes} checks, ${seconds}s)`;
  // Synchronous: piped stdout on Windows can drop the last asynchronous log before exit.
  writeSync(1, `\n${summary}\n${shots ? `Screenshots: ${shots}\n` : ''}`);
  return smoke.failures.length ? 1 : 0;
}
