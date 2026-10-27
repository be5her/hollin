import { writeSync } from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type { Host } from '../host';
import { Smoke, freePort } from './harness';
import { smokeAssistantClaudeCode } from './assistant-claude-code';
import { smokeAssistantUi } from './assistant-ui';
import { smokeBuilding } from './building';
import { smokeBuildingUi } from './building-ui';
import { smokeConnectors } from './connectors';
import { smokeConnectorsUi } from './connectors-ui';
import { smokeDecor, smokeDecorProtocol } from './decor';
import { smokeDecorUi } from './decor-ui';
import { smokeDecorSceneUi } from './decor-scene-ui';
import { smokeDecorFinishesUi } from './decor-finishes-ui';
import { smokeDecorAgentUi } from './decor-agent-ui';
import { smokeExchange, smokeExchangeDecor } from './exchange';
import { smokeHost } from './host';
import { smokeLibrary } from './library';
import { smokeLibraryUi } from './library-ui';
import { smokeMcp } from './mcp';
import { smokePerf } from './perf';
import { smokePlan } from './plan';
import { smokePlanUi } from './plan-ui';
import { smokeRulesUi } from './rules-ui';
import { smokeSceneUi } from './scene-ui';
import { smokeShell } from './shell';
import { smokeSnapshotUi } from './snapshot-ui';
import { smokeTrackingUi } from './tracking-ui';

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
    const { houseId } = await smokeLibrary(smoke);
    const { towerId } = await smokeBuilding(smoke);
    const { planId } = await smokePlan(smoke);
    await smoke.run('project.close', { id: planId });
    const { duplexId } = await smokeConnectors(smoke);
    await smokeExchange(smoke, duplexId);
    const { decorId, tableRef } = await smokeDecor(smoke);
    await smokeExchangeDecor(smoke, decorId);

    smoke.section('renderer');
    await smoke.openWindow(openWindow);
    await smokeShell(smoke);
    await smokeLibraryUi(smoke, houseId);
    await smokeDecorProtocol(smoke, decorId, tableRef);
    await smokeBuildingUi(smoke, towerId);
    await smokePlanUi(smoke, towerId);
    await smokeTrackingUi(smoke);
    await smokeConnectorsUi(smoke, duplexId);
    await smokeRulesUi(smoke, duplexId);
    await smokeSnapshotUi(smoke, duplexId);
    await smokeSceneUi(smoke);
    const { flatId } = await smokeDecorUi(smoke, tableRef);
    await smokeDecorSceneUi(smoke, flatId, tableRef);
    await smokeDecorFinishesUi(smoke, flatId);
    await smokeDecorAgentUi(smoke);
    await smoke.run('project.close', { id: flatId });
    await smokeAssistantUi(smoke, duplexId);
    await smokeAssistantClaudeCode(smoke, duplexId);
    await smokePerf(smoke);
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
