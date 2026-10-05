import { promises as fs } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import type { ErrorCode, HostEventMessage, HostEventName } from '@studio/core';
import type { BrowserWindow } from 'electron';
import type { Host, InvokeOptions } from '../host';

export const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A port nothing listens on right now, so the smoke run never meets an app that is already running. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

type Rect = { x: number; y: number; width: number; height: number };

/**
 * The smoke test's toolkit: named checks that never throw, commands through the host, the host's
 * events, and a window driven like a user would (DOM queries plus real input events).
 */
export class Smoke {
  readonly failures: string[] = [];
  passes = 0;
  readonly events: HostEventMessage[] = [];
  private win: BrowserWindow | null = null;
  readonly consoleErrors: string[] = [];

  constructor(
    readonly host: Host,
    readonly shotsDir: string | undefined,
  ) {
    host.onEvent((message) => this.events.push(message));
  }

  section(name: string): void {
    console.log(`\n---------- ${name} ----------`);
  }

  check(name: string, ok: boolean, detail?: unknown): boolean {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail !== undefined ? ` ${JSON.stringify(detail)}` : ''}`);
    if (ok) this.passes++;
    else this.failures.push(name);
    return ok;
  }

  /** Runs a command (as the UI unless told otherwise) and returns its result; a failure throws. */
  async run<T = unknown>(id: string, input: unknown = {}, options: Partial<InvokeOptions> = {}): Promise<T> {
    const out = await this.host.invoke(id, input, { caller: 'ui', ...options });
    if (!out.ok) throw new Error(`${id} failed: ${out.error.code} ${out.error.message}`);
    return out.result as T;
  }

  /** Checks that a command fails with the given code. */
  async expectError(name: string, id: string, input: unknown, code: ErrorCode, options: Partial<InvokeOptions> = {}): Promise<void> {
    const out = await this.host.invoke(id, input, { caller: 'ui', ...options });
    this.check(name, !out.ok && out.error.code === code, out.ok ? 'succeeded' : out.error);
  }

  /** Events of one kind seen since `from` (an index into `events`). */
  eventsSince<E extends HostEventName>(from: number, event: E): HostEventMessage<E>['payload'][] {
    return this.events.slice(from).filter((m) => m.event === event).map((m) => m.payload as HostEventMessage<E>['payload']);
  }

  async until(predicate: () => boolean | Promise<boolean>, timeoutMs = 5000, stepMs = 50): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await predicate()) return true;
      await wait(stepMs);
    }
    return Boolean(await predicate());
  }

  // ---------- the window ----------

  async openWindow(open: () => BrowserWindow): Promise<BrowserWindow> {
    const win = open();
    this.win = win;
    win.webContents.on('console-message', (event) => {
      if (event.level === 'error') this.consoleErrors.push(event.message);
    });
    await new Promise<void>((resolve, reject) => {
      win.webContents.once('did-finish-load', () => resolve());
      win.webContents.once('did-fail-load', (_e, code, description) => reject(new Error(`renderer failed to load: ${code} ${description}`)));
    });
    return win;
  }

  get window(): BrowserWindow {
    if (!this.win) throw new Error('No smoke window');
    return this.win;
  }

  closeWindow(): void {
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }

  js<T = unknown>(code: string): Promise<T> {
    return this.window.webContents.executeJavaScript(code) as Promise<T>;
  }

  /** True once the selector matches (and, if given, its text contains `text`). */
  async waitFor(selector: string, timeoutMs = 5000, text?: string): Promise<boolean> {
    return this.until(() => this.js<boolean>(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return !!el && (${JSON.stringify(text ?? '')} === '' || el.textContent.includes(${JSON.stringify(text ?? '')})); })()`), timeoutMs);
  }

  async gone(selector: string, timeoutMs = 5000): Promise<boolean> {
    return this.until(() => this.js<boolean>(`!document.querySelector(${JSON.stringify(selector)})`), timeoutMs);
  }

  text(selector: string): Promise<string | null> {
    return this.js(`document.querySelector(${JSON.stringify(selector)})?.textContent?.trim() ?? null`);
  }

  count(selector: string): Promise<number> {
    return this.js(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
  }

  /** A DOM click on the first match, optionally the one whose text contains `withText`. */
  click(selector: string, withText?: string): Promise<boolean> {
    return this.js(`(() => {
      const all = [...document.querySelectorAll(${JSON.stringify(selector)})];
      const el = ${withText === undefined ? 'all[0]' : `all.find((e) => e.textContent.includes(${JSON.stringify(withText)}))`};
      if (!el) return false;
      el.click();
      return true;
    })()`);
  }

  /** Sets an input's value the way typing does, so Angular sees the change. */
  fill(selector: string, value: string): Promise<boolean> {
    return this.js(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
  }

  rect(selector: string): Promise<Rect | null> {
    return this.js(`(() => { const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null; })()`);
  }

  /** A real key press through Chromium's input pipeline, e.g. `key('k', ['control'])`. */
  async key(keyCode: string, modifiers: ('control' | 'shift' | 'alt' | 'meta')[] = []): Promise<void> {
    const wc = this.window.webContents;
    wc.focus();
    wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    if (keyCode.length === 1 && modifiers.length === 0) wc.sendInputEvent({ type: 'char', keyCode, modifiers });
    wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await wait(60);
  }

  /** Types text as character events into whatever has focus. */
  async typeText(text: string): Promise<void> {
    const wc = this.window.webContents;
    for (const ch of text) wc.sendInputEvent({ type: 'char', keyCode: ch });
    await wait(80);
  }

  /** A real left-button drag in a few steps, in window coordinates. */
  async drag(from: { x: number; y: number }, to: { x: number; y: number }, steps = 8): Promise<void> {
    const wc = this.window.webContents;
    wc.sendInputEvent({ type: 'mouseMove', x: Math.round(from.x), y: Math.round(from.y) });
    wc.sendInputEvent({ type: 'mouseDown', x: Math.round(from.x), y: Math.round(from.y), button: 'left', clickCount: 1 });
    for (let i = 1; i <= steps; i++) {
      const x = Math.round(from.x + ((to.x - from.x) * i) / steps);
      const y = Math.round(from.y + ((to.y - from.y) * i) / steps);
      wc.sendInputEvent({ type: 'mouseMove', x, y, modifiers: ['leftbuttondown'] });
      await wait(16);
    }
    wc.sendInputEvent({ type: 'mouseUp', x: Math.round(to.x), y: Math.round(to.y), button: 'left', clickCount: 1 });
    await wait(80);
  }

  /** A real right click at the centre of the element. */
  async rightClick(selector: string): Promise<boolean> {
    const r = await this.rect(selector);
    if (!r) return false;
    const wc = this.window.webContents;
    const x = Math.round(r.x + r.width / 2);
    const y = Math.round(r.y + r.height / 2);
    wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'right', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'right', clickCount: 1 });
    await wait(80);
    return true;
  }

  async setDark(dark: boolean): Promise<void> {
    await this.js(`document.documentElement.classList.toggle('dark', ${dark})`);
    // Controls animate their colours for 150 ms; capture after that.
    await wait(250);
  }

  /** Saves a screenshot when SMOKE_SHOTS is set. The renderer is asked to paint first, so the capture is current. */
  async shot(name: string): Promise<void> {
    if (!this.shotsDir) return;
    const wc = this.window.webContents;
    wc.invalidate();
    await Promise.race([this.js('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))'), wait(500)]);
    const image = await wc.capturePage();
    await fs.mkdir(this.shotsDir, { recursive: true });
    await fs.writeFile(path.join(this.shotsDir, `${name}.png`), image.toPNG());
  }

  /** Light and dark screenshots of the current view. */
  async shots(name: string): Promise<void> {
    if (!this.shotsDir) return;
    const wasDark = await this.js<boolean>(`document.documentElement.classList.contains('dark')`);
    await this.setDark(false);
    await this.shot(`${name}-light`);
    await this.setDark(true);
    await this.shot(`${name}-dark`);
    await this.setDark(wasDark);
  }
}
