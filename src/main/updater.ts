import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { autoUpdater, type ProgressInfo } from 'electron-updater';
import { UpdaterBase, macSignedFromCodesign, plainNotes, updateSupport, type CheckOutcome, type Updater } from './update-state';

export interface CreateUpdaterOptions {
  /** Where the time of the last check is kept (the host's data folder). */
  stampFile: string;
  /** Stops the host the way quitting does, so pending writes land before the installer takes over. */
  beforeInstall(): Promise<void>;
}

/**
 * The real updater: electron-updater's `autoUpdater` behind the host's `Updater`, fed by the GitHub
 * Releases the build names in `app-update.yml`. It never downloads by itself (`autoDownload: false`);
 * a downloaded update also installs when the app quits (`autoInstallOnAppQuit`). A build that cannot
 * update says why (`unsupported`) and never touches electron-updater.
 */
export function createUpdater(options: CreateUpdaterOptions): Updater {
  const { reason, devConfig } = updateSupport({
    packaged: app.isPackaged,
    platform: process.platform,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    appImage: process.env.APPIMAGE,
    macSigned: () => {
      // …/Name.app/Contents/MacOS/Name → …/Name.app
      const bundle = path.resolve(process.execPath, '..', '..', '..');
      const run = spawnSync('codesign', ['-dv', '--verbose=2', bundle], { encoding: 'utf8', timeout: 10_000 });
      return macSignedFromCodesign(`${run.stdout ?? ''}${run.stderr ?? ''}`, run.status);
    },
    exists: existsSync,
    read: (file) => {
      try {
        return readFileSync(file, 'utf8');
      } catch {
        return undefined;
      }
    },
  });
  return new ElectronUpdater(options, reason, devConfig);
}

class ElectronUpdater extends UpdaterBase {
  private configured = false;
  private installing = false;

  constructor(
    private readonly options: CreateUpdaterOptions,
    reason: string | null,
    private readonly devConfig: boolean,
  ) {
    super(options.stampFile, reason);
  }

  /** electron-updater, set up on first use (reading `autoUpdater` creates the platform's updater). */
  private updater() {
    if (!this.configured) {
      this.configured = true;
      autoUpdater.autoDownload = false;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.forceDevUpdateConfig = this.devConfig;
      // Without a listener an 'error' event would throw. Checks and downloads report theirs through
      // their promises; this one is for what fails after them, while installing.
      autoUpdater.on('error', (err) => {
        console.warn(`[updater] ${err.message.split('\n')[0]}`);
        if (!this.installing) return;
        this.installing = false;
        this.set({ ...this.status(), state: 'error', message: `The update could not be installed: ${err.message.split('\n')[0]}` });
        // The host has already stopped for the installer: start the app afresh rather than leave it without one.
        app.relaunch();
        app.quit();
      });
    }
    return autoUpdater;
  }

  protected async find(): Promise<CheckOutcome> {
    const result = await this.updater().checkForUpdates();
    if (!result) throw new Error('The updater is not active in this build.');
    if (!result.isUpdateAvailable) return null;
    return { version: result.updateInfo.version, notes: plainNotes(result.updateInfo.releaseNotes) };
  }

  protected async fetch(progress: (percent: number) => void): Promise<void> {
    const updater = this.updater();
    const onProgress = (info: ProgressInfo) => progress(info.percent);
    updater.on('download-progress', onProgress);
    try {
      await updater.downloadUpdate();
    } finally {
      updater.off('download-progress', onProgress);
    }
  }

  protected async apply(): Promise<void> {
    await this.options.beforeInstall();
    this.installing = true;
    // Silent, and start the new version once installed. Windows windows close, `before-quit` finds the host stopped.
    this.updater().quitAndInstall(true, true);
  }
}
