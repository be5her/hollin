import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

/**
 * What the helper runs (as Node, through the app's own executable): wait until the smoke's process is gone
 * (60 s at most), a second more for Chromium's helper processes, then remove the folder with retries for
 * files Windows still holds.
 */
const SCRIPT = `
const fs = require('node:fs');
const [pid, dir] = process.argv.slice(1);
const alive = () => { try { process.kill(Number(pid), 0); return true; } catch { return false; } };
const start = Date.now();
const tick = () => {
  if (alive() && Date.now() - start < 60000) return void setTimeout(tick, 250);
  setTimeout(() => fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }, () => {}), 1000);
};
tick();
`;

/**
 * Removes the smoke's temporary data folder once this process has exited. The smoke removes it itself before
 * it exits, but Chromium keeps its profile files there (Local Storage, Session Storage, Network, DIPS…) open
 * while the app runs and writes some of them on the way out, so on Windows a folder holding only those was
 * left behind after every run. A detached helper started here waits for this process to end and removes the
 * folder again. Only a `studio-smoke-*` folder directly in the temp folder is ever handed to it.
 */
export function removeAfterExit(dir: string): void {
  const resolved = path.resolve(dir);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('studio-smoke-')) return;
  try {
    spawn(process.execPath, ['-e', SCRIPT, String(process.pid), resolved], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    }).unref();
  } catch {
    // The folder stays in the temp folder, where the OS's own cleanup finds it.
  }
}
