import { promises as fs, writeSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BRANDING, type HostEventMessage } from '@studio/core';
import type { Cipher } from '@studio/core/node';
import { BrowserWindow, app, dialog, safeStorage } from 'electron';
import { Host } from './host';
import { CHANNELS, registerIpc } from './ipc';
import { handleLibraryProtocol, registerLibraryScheme } from './library-protocol';
import { installMenu } from './menu';
import { createMainWindow, setTitleBarColors } from './window';

const smoke = process.argv.includes('--smoke');
const dev = Boolean(process.env.ELECTRON_RENDERER_URL);

process.env.STUDIO_VERSION = app.getVersion();
app.setName(BRANDING.productName);
// Windows groups taskbar entries and notifications by this id; the installer gives the shortcut the same one.
app.setAppUserModelId(BRANDING.appId);

registerLibraryScheme();

if (smoke) {
  // The smoke test's UI checks need a window that keeps painting: Chromium stops drawing one that other
  // windows cover, and then screenshots go stale and pointer input is never delivered.
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  // The 3D view needs WebGL. On a machine without a GPU (CI) Chromium only falls back to its software
  // renderer when allowed to; real runs keep Chromium's default.
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
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

const parentWindow = () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];

const dialogs = {
  async pickFile(options: { title?: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[] } = {}) {
    const result = await dialog.showOpenDialog(parentWindow(), { properties: ['openFile'], ...options });
    return result.canceled ? undefined : result.filePaths[0];
  },
  async pickSavePath(options: { title?: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[] } = {}) {
    const result = await dialog.showSaveDialog(parentWindow(), options);
    return result.canceled ? undefined : result.filePath;
  },
  async pickFolder(options: { title?: string; defaultPath?: string } = {}) {
    const result = await dialog.showOpenDialog(parentWindow(), { properties: ['openDirectory', 'createDirectory'], ...options });
    return result.canceled ? undefined : result.filePaths[0];
  },
};

/** A project package passed on the command line (a double-clicked file, or a second launch). */
const packageArg = (argv: string[]) => argv.find((a) => a.toLowerCase().endsWith(`.${BRANDING.packageExtension}`) && !a.startsWith('-'));

async function importFromShell(file: string): Promise<void> {
  if (!host) return;
  const outcome = await host.invoke('project.import', { path: file, open: true }, { caller: 'ui' });
  if (!outcome.ok) dialog.showErrorBox('Could not import the project', outcome.error.message);
}

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
  app.on('second-instance', (_event, argv) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
    const file = packageArg(argv);
    if (file) void importFromShell(file);
  });
  // macOS delivers double-clicked files as events, also before the app is ready.
  const pendingFiles: string[] = [];
  app.on('open-file', (event, file) => {
    event.preventDefault();
    if (host) void importFromShell(file);
    else pendingFiles.push(file);
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
    dialogs: smoke ? undefined : dialogs,
    // Smoke runs check autosave without waiting the full interval.
    autosave: smoke ? { debounceMs: 150, maxWaitMs: 1000 } : undefined,
  });
  registerIpc(host);
  await host.start();
  handleLibraryProtocol(host);

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

  const win = createMainWindow();
  // Windows logoff or shutdown: save what is pending while the OS still waits.
  win.on('session-end', () => void host?.stop());
  for (const file of [...pendingFiles, packageArg(process.argv)].filter((f): f is string => Boolean(f))) void importFromShell(file);
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
