import { readFileSync } from 'node:fs';
import { StudioError, type UpdateState, type UpdaterApi } from '@studio/core';
import { WriteQueue, writeJsonAtomic } from '@studio/core/node';

/** The host's updater: the API commands see, plus waiting for its own writes when the host stops. */
export interface Updater extends UpdaterApi {
  /** Resolves once the last check's time is on disk. */
  idle(): Promise<void>;
  /** When a check last reached the feed, for the startup schedule. */
  readonly checkedAt: string | undefined;
}

/** What a check found: a newer version (with its notes), or none. */
export type CheckOutcome = { version: string; notes?: string } | null;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whether the startup check is due: the setting is on and no check reached the feed in the last 24 h. */
export function startupCheckDue(enabled: boolean, checkedAt: string | undefined, now = Date.now()): boolean {
  if (!enabled) return false;
  const last = checkedAt ? Date.parse(checkedAt) : Number.NaN;
  // A time in the future (a clock set back) counts as never checked.
  return !Number.isFinite(last) || last > now || now - last >= DAY_MS;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/**
 * Release notes as plain text. GitHub gives the release body as HTML (electron-updater reads it from
 * the releases feed), and `fullChangelog` gives a list of versions: tags go, block ends and `<br>`
 * become line breaks, list items get a dash, entities are decoded, blank runs are squeezed.
 */
export function plainNotes(notes: string | readonly { version: string; note?: string | null }[] | null | undefined): string | undefined {
  if (notes == null) return undefined;
  const html = typeof notes === 'string' ? notes : notes.map((n) => `<p>${n.version}</p>${n.note ?? ''}`).join('\n');
  const text = html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|li|ul|ol|h[1-6]|pre|blockquote|tr)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*|#39);/gi, (whole, name: string) => {
      const lower = name.toLowerCase();
      if (lower.startsWith('#x')) return safeChar(Number.parseInt(lower.slice(2), 16)) ?? whole;
      if (lower.startsWith('#') && lower !== '#39') return safeChar(Number.parseInt(lower.slice(1), 10)) ?? whole;
      return ENTITIES[lower] ?? whole;
    })
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text || undefined;
}

const safeChar = (code: number): string | undefined => (Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : undefined);

/**
 * The state machine both updaters share (electron-updater's in `updater.ts`, the smoke's scripted
 * one): one `UpdateState` record, announced on every change, the time of the last check that reached
 * the feed kept in `stampFile` (the host's data folder, not config), and the rules of what may follow
 * what. A subclass only finds, fetches and applies; its errors become `state: 'error'`, never a throw.
 */
export abstract class UpdaterBase implements Updater {
  private current: UpdateState;
  private readonly listeners = new Set<(state: UpdateState) => void>();
  private readonly writes = new WriteQueue();
  /** Bumped by `restart`: a check or download that began before it no longer owns the state. */
  private generation = 0;
  /** The install under way: a second ask (the toast and the button, a double click) waits for it instead of installing twice. */
  private pendingInstall: Promise<void> | null = null;

  constructor(
    private readonly stampFile: string | undefined,
    unsupported: string | null,
  ) {
    const checkedAt = stampFile ? readStamp(stampFile) : undefined;
    this.current = unsupported ? { state: 'unsupported', message: unsupported } : { state: 'idle', ...(checkedAt ? { checkedAt } : {}) };
  }

  /** Asks the feed; resolves with the newer version or null. `beta`: pre-releases count too. */
  protected abstract find(options: { beta: boolean }): Promise<CheckOutcome>;
  /** Downloads the version `find` returned, reporting percent done. */
  protected abstract fetch(progress: (percent: number) => void): Promise<void>;
  /** Installs the downloaded version (and quits). */
  protected abstract apply(): Promise<void>;

  status(): UpdateState {
    return { ...this.current };
  }

  onChange(listener: (state: UpdateState) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  idle(): Promise<void> {
    return this.writes.idle();
  }

  get checkedAt(): string | undefined {
    return this.current.checkedAt ?? (this.stampFile ? readStamp(this.stampFile) : undefined);
  }

  protected set(next: UpdateState): void {
    this.current = next;
    const copy = this.status();
    for (const listener of [...this.listeners]) listener(copy);
  }

  /** Starts over from `next`: a check or download still running ends without touching the state. */
  protected restart(next: UpdateState): void {
    this.generation++;
    this.set(next);
  }

  /** For a build that turns out unable to update (or, in the smoke, is scripted so). `null` makes it able again. */
  protected setUnsupported(reason: string | null): void {
    if (reason) this.restart({ state: 'unsupported', message: reason });
    else if (this.current.state === 'unsupported') this.restart({ state: 'idle', ...(this.checkedAt ? { checkedAt: this.checkedAt } : {}) });
  }

  async check(options: { scheduled?: boolean; beta?: boolean } = {}): Promise<UpdateState> {
    const { state } = this.current;
    // Nothing to do without a feed; a check or download under way is left alone, and a downloaded update is kept.
    if (state === 'unsupported' || state === 'checking' || state === 'downloading' || state === 'ready') return this.status();
    const scheduled = options.scheduled === true;
    const previous = this.current.checkedAt;
    this.set({ state: 'checking', scheduled, ...(previous ? { checkedAt: previous } : {}) });
    const generation = this.generation;
    try {
      const found = await this.find({ beta: options.beta === true });
      if (generation !== this.generation) return this.status();
      const checkedAt = new Date().toISOString();
      if (this.stampFile) void this.writes.run('stamp', () => writeJsonAtomic(this.stampFile!, { checkedAt })).catch((err: Error) => console.warn(`[updater] could not keep the check time: ${err.message}`));
      this.set(found ? { state: 'available', version: found.version, ...(found.notes ? { notes: found.notes } : {}), checkedAt, scheduled } : { state: 'up-to-date', checkedAt, scheduled });
    } catch (err) {
      if (generation !== this.generation) return this.status();
      this.set({ state: 'error', message: messageOf(err, 'The update check failed.'), scheduled, ...(previous ? { checkedAt: previous } : {}) });
    }
    return this.status();
  }

  download(): UpdateState {
    const found = this.current;
    if (found.state !== 'available' || !found.version) throw new StudioError('CONFLICT', 'There is no update to download: check for updates first.');
    const base: UpdateState = { state: 'downloading', version: found.version, ...(found.notes ? { notes: found.notes } : {}), ...(found.checkedAt ? { checkedAt: found.checkedAt } : {}) };
    this.set({ ...base, progress: 0 });
    const started = this.status();
    const generation = this.generation;
    const current = () => generation === this.generation;
    let shown = 0;
    void this.fetch((percent) => {
      // One announcement per whole percent, never backwards.
      const progress = Math.max(0, Math.min(100, Math.floor(percent)));
      if (progress <= shown || !current() || this.current.state !== 'downloading') return;
      shown = progress;
      this.set({ ...base, progress });
    }).then(
      () => {
        if (current()) this.set({ ...base, state: 'ready', progress: 100 });
      },
      (err: unknown) => {
        if (current()) this.set({ ...base, state: 'error', message: messageOf(err, 'The download failed.') });
      },
    );
    return started;
  }

  install(): Promise<void> {
    // A second ask while one runs waits for that one: electron-updater would start the installer again.
    if (this.pendingInstall) return this.pendingInstall;
    if (this.current.state !== 'ready') return Promise.reject(new StudioError('CONFLICT', 'No update is ready to install: download it first.'));
    this.pendingInstall = (async () => {
      try {
        await this.apply();
      } catch (err) {
        this.set({ ...this.current, state: 'error', message: messageOf(err, 'The update could not be installed.') });
      } finally {
        this.pendingInstall = null;
      }
    })();
    return this.pendingInstall;
  }
}

function readStamp(file: string): string | undefined {
  try {
    const { checkedAt } = JSON.parse(readFileSync(file, 'utf8')) as { checkedAt?: unknown };
    return typeof checkedAt === 'string' && Number.isFinite(Date.parse(checkedAt)) ? checkedAt : undefined;
  } catch {
    return undefined;
  }
}

/** A short message for the status line: the error's first line, without electron-updater's appended stack or HTTP dump. */
export function messageOf(err: unknown, fallback: string): string {
  const text = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  const first = text.split('\n')[0]?.trim() ?? '';
  return first ? (first.length > 300 ? `${first.slice(0, 299)}…` : first) : fallback;
}

/** What `updateSupport` needs to know about the running app; `exists` and `read` look at files. */
export interface SupportProbe {
  packaged: boolean;
  platform: string;
  /** `process.resourcesPath`: where electron-builder writes `app-update.yml` (and `package-type` for Linux packages). */
  resourcesPath: string;
  /** `app.getAppPath()`: where a development run may keep `dev-app-update.yml`. */
  appPath: string;
  /** `process.env.APPIMAGE`, set by an AppImage's runtime. */
  appImage?: string;
  /** macOS: whether the app bundle carries a real (Developer ID) signature; see `macSigned`. */
  macSigned?: () => boolean;
  exists(file: string): boolean;
  read(file: string): string | undefined;
}

/**
 * Whether electron-updater can update this build, read from electron-updater 6's own rules: it only
 * runs packaged (`isUpdaterActive`) or with a `dev-app-update.yml` forced in development; it needs the
 * `app-update.yml` electron-builder writes only when a build has a `publish` feed; on Linux it updates
 * an AppImage (`APPIMAGE` set) or a deb, rpm or pacman package (`package-type`, written by
 * electron-builder's package targets); on macOS Squirrel.Mac installs only into a signed app.
 */
export function updateSupport(probe: SupportProbe): { reason: string | null; devConfig: boolean; appImage: boolean } {
  const join = (dir: string, name: string) => `${dir.replace(/[\/]+$/, '')}/${name}`;
  const no = (reason: string, devConfig: boolean) => ({ reason, devConfig, appImage: false });
  let devConfig = false;
  if (!probe.packaged) {
    if (!probe.exists(join(probe.appPath, 'dev-app-update.yml'))) return no('this is a development run', devConfig);
    devConfig = true;
  } else if (!probe.exists(join(probe.resourcesPath, 'app-update.yml'))) {
    return no('this build has no update feed (only release builds have one)', devConfig);
  }
  if (probe.platform === 'linux' && !devConfig) {
    // The AppImage first, before `package-type`: electron-builder packs the AppImage from the folder its
    // deb target writes `package-type` into, in parallel, so an AppImage may carry the deb's file, and
    // read first it would make electron-updater install the AppImage's update through dpkg.
    if (probe.appImage) return { reason: null, devConfig, appImage: true };
    const packageType = probe.read(join(probe.resourcesPath, 'package-type'))?.trim();
    if (!['deb', 'rpm', 'pacman'].includes(packageType ?? '')) return no('the app is not running from its AppImage or an installed package', devConfig);
  }
  if (probe.platform === 'darwin' && probe.packaged && probe.macSigned && !probe.macSigned()) {
    return no('this macOS build is not signed, and macOS installs updates only into a signed app', devConfig);
  }
  return { reason: null, devConfig, appImage: false };
}

/**
 * The real install, once the user asked: stop the host (pending writes land), then hand over to the
 * installer. Once the stop has begun, any failure (the stop itself, or `quitAndInstall` throwing) goes
 * to `fail`, which must relaunch the app: the host is stopped, so leaving it running would leave it
 * without one. A failure the installer reports later (electron-updater's `error` event) goes to the same `fail`.
 */
export async function installAfterStop(steps: { stop(): Promise<void>; quitAndInstall(): void; fail(err: unknown): void }): Promise<void> {
  try {
    await steps.stop();
    steps.quitAndInstall();
  } catch (err) {
    steps.fail(err);
  }
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * The scheduled checks of a running app: the first `firstMs` after start, then every `everyMs` (an hour)
 * while it runs, each only when `due()` says so (the setting is on and the last check is a day old), and
 * none once the app is stopping. So an app left open notices a release the day after. The timers never
 * keep the process alive. Returns a function that cancels them.
 */
export function scheduleChecks(options: { due(): boolean; stopping(): boolean; check(): void; firstMs?: number; everyMs?: number }): () => void {
  const run = () => {
    if (!options.stopping() && options.due()) options.check();
  };
  let every: ReturnType<typeof setInterval> | undefined;
  const first = setTimeout(() => {
    run();
    every = setInterval(run, options.everyMs ?? HOUR_MS);
    every.unref?.();
  }, options.firstMs ?? 10_000);
  first.unref?.();
  return () => {
    clearTimeout(first);
    if (every) clearInterval(every);
  };
}

/**
 * Reads `codesign -dv` output (it prints to stderr): signed for updates means a team identifier, so
 * neither unsigned (`code object is not signed`) nor ad hoc (`Signature=adhoc`, what an unsigned arm64
 * build gets), both of which Squirrel.Mac refuses.
 */
export function macSignedFromCodesign(output: string, exitCode: number | null): boolean {
  if (exitCode !== 0) return false;
  if (/^Signature=adhoc\s*$/m.test(output)) return false;
  const team = /^TeamIdentifier=(.+)$/m.exec(output)?.[1]?.trim();
  return Boolean(team) && team !== 'not set';
}
