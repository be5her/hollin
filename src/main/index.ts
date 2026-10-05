import { promises as fs, writeSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BRANDING, type HostEventMessage } from '@studio/core';
import type { Cipher } from '@studio/core/node';
import { BrowserWindow, app, safeStorage } from 'electron';
import { Host } from './host';
import { CHANNELS, registerIpc } from './ipc';
import { installMenu } from './menu';
import { createMainWindow, setTitleBarColors } from './window';

const smoke = process.argv.includes('--smoke');
const dev = Boolean(process.env.ELECTRON_RENDERER_URL);

process.env.STUDIO_VERSION = app.getVersion();
app.setName(BRANDING.productName);
// Windows groups taskbar entries and notifications by this id; the installer gives the shortcut the same one.
app.setAppUserModelId(BRANDING.appId);

if (smoke) {
  // The smoke test's UI checks need a window that keeps painting: Chromium stops drawing one that other
  // windows cover, and then screenshots go stale and pointer input is never delivered.
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
}

/** OS-backed encryption for secrets. Linux's `basic_text` fallback uses a fixed key, so it counts as none. */
const cipher: Cipher = {
  get available() {
    if (!safeStorage.isEncryptionAvailable()) return false;
    return !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text');
  },
  encrypt: (plain) => safeStorage.encryptString(plain),
  decrypt: (data) => safeStorage.decryptString(Buffer.from(data)),
};

function broadcast(message: HostEventMessage): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(CHANNELS.event, message);
  }
}

let host: Host | null = null;

async function main(): Promise<void> {
  // The data folder is named from branding.json, not the package name, so a rename keeps the user's data.
  // Development and smoke runs never touch the real library or settings.
  const dataDir = smoke
    ? await fs.mkdtemp(path.join(os.tmpdir(), 'studio-smoke-'))
    : path.join(app.getPath('appData'), dev ? `${BRANDING.dataDirName} Dev` : BRANDING.dataDirName);
  app.setPath('userData', dataDir);

  if (!smoke && !app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  await app.whenReady();
  installMenu(dev);

  const smokeModules = smoke ? (await import('./smoke/gate-module')).smokeModules : [];
  host = new Host({
    userDataDir: dataDir,
    version: app.getVersion(),
    platform: process.platform,
    runtime: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
    cipher,
    broadcast,
    setTitleBarColors,
    extraModules: smokeModules,
  });
  registerIpc(host);
  await host.start();

  if (smoke) {
    const { runSmoke } = await import('./smoke');
    let code = 1;
    try {
      code = await runSmoke(host, () => createMainWindow({ show: true }));
    } catch (err) {
      writeSync(2, `SMOKE FAILED: ${(err as Error).stack ?? String(err)}\n`);
    }
    await host.stop();
    await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
    // Piped stdout is asynchronous on Windows; give the last lines a moment to leave the process.
    await new Promise((r) => setTimeout(r, 150));
    app.exit(code);
    return;
  }

  createMainWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
}

app.on('window-all-closed', () => {
  // Smoke mode closes its window itself and exits with the result of the checks.
  if (process.platform !== 'darwin' && !smoke) app.quit();
});

let stopping = false;
app.on('before-quit', (event) => {
  if (!host || stopping || smoke) return;
  // Let the host finish its writes before the process goes away.
  event.preventDefault();
  stopping = true;
  void host.stop().finally(() => app.quit());
});

void main().catch((err) => {
  console.error('[main] fatal', err);
  app.exit(1);
});
