import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { AppImageUpdater, autoUpdater, type AppUpdater, type ProgressInfo } from 'electron-updater';
import { UpdaterBase, installAfterStop, macSignedFromCodesign, messageOf, plainNotes, updateSupport, type CheckOutcome, type Updater } from './update-state';

export interface CreateUpdaterOptions {
  /** Where the time of the last check is kept (the host's data folder). */
  stampFile: string;
  /** Stops the host the way quitting does, so pending writes land before the installer takes over. */
  beforeInstall(): Promise<void>;
}

/**
 * The real updater: electron-updater behind the host's `Updater`, fed by the GitHub Releases the build
 * names in `app-update.yml`. It never downloads by itself (`autoDownload: false`); a downloaded update
 * also installs when the app quits (`autoInstallOnAppQuit`). A build that cannot update says why
 * (`unsupported`) and never touches electron-updater.
 */
export function createUpdater(options: CreateUpdaterOptions): Updater {
  const { reason, devConfig, appImage } = updateSupport({
    packaged: app.isPackaged,
    platform: process.platform,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    appImage: process.env.APPIMAGE,
    // Noted in the milestone-10 review: this runs `codesign` synchronously (10 s at most) at startup, on macOS with a feed only.
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
  return new ElectronUpdater(options, reason, devConfig, appImage);
}

class ElectronUpdater extends UpdaterBase {
  private instance: AppUpdater | null = null;
  private installing = false;
  private applying: Promise<void> | null = null;

  constructor(
    private readonly options: CreateUpdaterOptions,
    reason: string | null,
    private readonly devConfig: boolean,
    private readonly appImage: boolean,
  ) {
    super(options.stampFile, reason);
  }

  /**
   * electron-updater, set up on first use. In an AppImage the AppImage updater, always: `autoUpdater`
   * picks the Linux updater from a `package-type` file before looking at `APPIMAGE`, and an AppImage can
   * carry the deb's (see `updateSupport`). Everywhere else `autoUpdater`, which reading creates.
   */
  private updater(): AppUpdater {
    if (!this.instance) {
      const updater = this.appImage ? new AppImageUpdater() : autoUpdater;
      this.instance = updater;
      updater.autoDownload = false;
      updater.autoInstallOnAppQuit = true;
      updater.forceDevUpdateConfig = this.devConfig;
      // Without a listener an 'error' event would throw. Checks and downloads report theirs through
      // their promises; this one is for what fails after them, while installing.
      updater.on('error', (err) => {
        console.warn(`[updater] ${err.message.split('\n')[0]}`);
        if (this.installing) this.installFailed(err);
      });
    }
    return this.instance;
  }

  protected async find({ beta }: { beta: boolean }): Promise<CheckOutcome> {
    const updater = this.updater();
    // Set on every check, from the setting: electron-updater would otherwise turn it on by itself in a
    // beta build (a version with a pre-release part). With it, the GitHub provider reads the releases feed
    // and takes the newest published release, pre-release or not; without it, the latest stable one.
    updater.allowPrerelease = beta;
    const result = await updater.checkForUpdates();
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

  /** Once only: the process is on its way out, and a second `quitAndInstall` would start the installer again. */
  protected apply(): Promise<void> {
    this.applying ??= installAfterStop({
      stop: () => {
        this.installing = true;
        return this.options.beforeInstall();
      },
      // Silent, and start the new version once installed. Windows close, `before-quit` finds the host stopped.
      quitAndInstall: () => this.updater().quitAndInstall(true, true),
      fail: (err) => this.installFailed(err),
    });
    return this.applying;
  }

  /**
   * The install failed after the host began to stop (the stop, `quitAndInstall`, or the installer):
   * say so, then start the app afresh rather than leave it running without a host.
   */
  private installFailed(err: unknown): void {
    if (!this.installing) return;
    this.installing = false;
    this.set({ ...this.status(), state: 'error', message: `The update could not be installed: ${messageOf(err, 'unknown error')}` });
    app.relaunch();
    app.quit();
  }
}
