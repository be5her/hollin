import { UpdaterBase, type CheckOutcome } from '../update-state';

/** What the next checks and downloads do. */
export interface UpdateScript {
  /** A check finds this version, finds none, or fails with `message`. */
  outcome: 'available' | 'up-to-date' | 'error';
  version?: string;
  notes?: string;
  message?: string;
  /** The percentages a download reports, in order (default 0, 25, 50, 75, 100). */
  progress?: number[];
  /** A download fails with this message after its progress. */
  downloadError?: string;
  /** The next check, or the next download after reporting `holdAt`, waits for `release()`, so the UI's in-between state can be looked at. */
  hold?: 'check' | 'download';
  /** The step a held download waits after (default its last). */
  holdAt?: number;
}

/**
 * The host's updater in smoke runs, scripted by the smoke like the dialogs (`smoke.updates`): checks
 * and downloads do what `script` says without touching the network, `unsupported` turns the build
 * into one without a feed, and `install` records that it was asked (after the same checks the real
 * one makes) instead of stopping the host and quitting.
 */
export class SmokeUpdater extends UpdaterBase {
  private plan: UpdateScript = { outcome: 'up-to-date' };
  private held: (() => void) | null = null;
  /** How many times an install went through. */
  installs = 0;
  /** How many checks reached the (scripted) feed, and whether the last was the startup one. */
  checks: { scheduled: boolean }[] = [];

  script(plan: UpdateScript): void {
    this.plan = plan;
  }

  /** Lets a held check or download go on. */
  release(): void {
    const go = this.held;
    this.held = null;
    go?.();
  }

  /** Whether a check or download is waiting for `release()`. */
  get holding(): boolean {
    return this.held !== null;
  }

  unsupported(reason: string | null): void {
    this.setUnsupported(reason);
  }

  /** Back to a build that has never checked, between smoke sections; a held step is let go first. */
  reset(): void {
    this.release();
    this.plan = { outcome: 'up-to-date' };
    this.set({ state: 'idle' });
  }

  override check(options: { scheduled?: boolean } = {}) {
    if (this.status().state !== 'unsupported') this.checks.push({ scheduled: options.scheduled === true });
    return super.check(options);
  }

  private hold(what: UpdateScript['hold']): Promise<void> {
    if (this.plan.hold !== what) return Promise.resolve();
    this.plan = { ...this.plan, hold: undefined };
    return new Promise((resolve) => (this.held = resolve));
  }

  protected async find(): Promise<CheckOutcome> {
    const plan = this.plan;
    await this.hold('check');
    if (plan.outcome === 'error') throw new Error(plan.message ?? 'net::ERR_INTERNET_DISCONNECTED');
    return plan.outcome === 'available' ? { version: plan.version ?? '1.2.3', ...(plan.notes ? { notes: plan.notes } : {}) } : null;
  }

  protected async fetch(progress: (percent: number) => void): Promise<void> {
    const plan = this.plan;
    const steps = plan.progress ?? [0, 25, 50, 75, 100];
    for (const [i, step] of steps.entries()) {
      progress(step);
      // A held download waits here, so "Downloading n %" stays on screen until the smoke has seen it.
      if (step === (plan.holdAt ?? steps[steps.length - 1])) await this.hold('download');
      if (i < steps.length - 1) await new Promise((r) => setTimeout(r, 20));
    }
    if (plan.downloadError) throw new Error(plan.downloadError);
  }

  protected async apply(): Promise<void> {
    this.installs++;
  }
}

export function createSmokeUpdater(stampFile: string): SmokeUpdater {
  return new SmokeUpdater(stampFile, null);
}
