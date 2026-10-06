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
export type Point = { x: number; y: number };
export type KeyModifier = 'control' | 'shift' | 'alt' | 'meta';
export type MouseModifier = KeyModifier | 'leftbuttondown' | 'middlebuttondown' | 'rightbuttondown';
export type MouseButton = 'left' | 'middle' | 'right';
const HELD: Record<MouseButton, MouseModifier> = { left: 'leftbuttondown', middle: 'middlebuttondown', right: 'rightbuttondown' };

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

  /** True once the selector matches an element (whose text contains `text`, if given). */
  async waitFor(selector: string, timeoutMs = 5000, text?: string): Promise<boolean> {
    const wanted = JSON.stringify(text ?? '');
    return this.until(() => this.js<boolean>(`[...document.querySelectorAll(${JSON.stringify(selector)})].some((el) => ${wanted} === '' || el.textContent.includes(${wanted}))`), timeoutMs);
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

  /** A real key press through Chromium's input pipeline, e.g. `key('k', ['control'])`. A single character also sends its `char` event, so it lands in a focused input. */
  async key(keyCode: string, modifiers: KeyModifier[] = []): Promise<void> {
    const wc = this.window.webContents;
    wc.focus();
    wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    if (keyCode.length === 1 && modifiers.length === 0) wc.sendInputEvent({ type: 'char', keyCode, modifiers });
    wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await wait(60);
  }

  /** Holds a key down (`keyUp` releases it), e.g. Space while dragging the plan. */
  async keyDown(keyCode: string, modifiers: KeyModifier[] = []): Promise<void> {
    this.window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    await wait(30);
  }

  async keyUp(keyCode: string, modifiers: KeyModifier[] = []): Promise<void> {
    this.window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await wait(30);
  }

  /** Types text as character events into whatever has focus (no keydown: a canvas listening for keys does not see these). */
  async typeText(text: string): Promise<void> {
    const wc = this.window.webContents;
    for (const ch of text) wc.sendInputEvent({ type: 'char', keyCode: ch });
    await wait(80);
  }

  // ---------- real mouse input, in window coordinates (CSS pixels) ----------

  async mouseMove(x: number, y: number, modifiers: MouseModifier[] = []): Promise<void> {
    this.window.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(x), y: Math.round(y), modifiers });
    await wait(16);
  }

  async mouseDown(x: number, y: number, button: MouseButton = 'left', modifiers: MouseModifier[] = [], clickCount = 1): Promise<void> {
    this.window.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(x), y: Math.round(y), button, modifiers, clickCount });
    await wait(16);
  }

  async mouseUp(x: number, y: number, button: MouseButton = 'left', modifiers: MouseModifier[] = [], clickCount = 1): Promise<void> {
    this.window.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(x), y: Math.round(y), button, modifiers, clickCount });
    await wait(16);
  }

  /** A real click at a point: move there, press and release (`clickCount: 2` double-clicks). */
  async clickAt(x: number, y: number, options: { button?: MouseButton; modifiers?: MouseModifier[]; clickCount?: number } = {}): Promise<void> {
    const { button = 'left', modifiers = [], clickCount = 1 } = options;
    await this.mouseMove(x, y, modifiers);
    for (let i = 1; i <= clickCount; i++) {
      await this.mouseDown(x, y, button, modifiers, i);
      await this.mouseUp(x, y, button, modifiers, i);
    }
    await wait(60);
  }

  /** A real drag with any button, in a few steps, with the button reported as held while moving. */
  async dragAt(from: Point, to: Point, options: { button?: MouseButton; modifiers?: MouseModifier[]; steps?: number } = {}): Promise<void> {
    const { button = 'left', modifiers = [], steps = 8 } = options;
    await this.mouseMove(from.x, from.y, modifiers);
    await this.mouseDown(from.x, from.y, button, modifiers);
    const held: MouseModifier[] = [...modifiers, HELD[button]];
    for (let i = 1; i <= steps; i++) {
      await this.mouseMove(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps, held);
    }
    await this.mouseUp(to.x, to.y, button, modifiers);
    await wait(80);
  }

  /** A real left-button drag in a few steps, in window coordinates. */
  drag(from: Point, to: Point, steps = 8): Promise<void> {
    return this.dragAt(from, to, { steps });
  }

  /** A wheel tick at a point, with the DOM's sign: a negative `deltaY` is the wheel pushed away (zoom in). */
  async wheel(x: number, y: number, deltaY: number, modifiers: MouseModifier[] = []): Promise<void> {
    this.window.webContents.sendInputEvent({ type: 'mouseWheel', x: Math.round(x), y: Math.round(y), deltaX: 0, deltaY: -deltaY, modifiers, canScroll: true });
    await wait(80);
  }

  /** The painted colour of a canvas pixel at a window point, as `r,g,b`, after the renderer has drawn a frame. */
  async canvasPixel(selector: string, x: number, y: number): Promise<string | null> {
    return this.js(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
      const c = document.querySelector(${JSON.stringify(selector)});
      if (!c) return resolve(null);
      const r = c.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const d = c.getContext('2d').getImageData(Math.round((${x} - r.x) * dpr), Math.round((${y} - r.y) * dpr), 1, 1).data;
      resolve(d[0] + ',' + d[1] + ',' + d[2]);
    })))`);
  }

  /** A real right click at the centre of the element (or at an offset from its top-left corner). */
  async rightClick(selector: string, offset?: { x: number; y: number }): Promise<boolean> {
    const r = await this.rect(selector);
    if (!r) return false;
    await this.rightClickAt(offset ? r.x + offset.x : r.x + r.width / 2, offset ? r.y + offset.y : r.y + r.height / 2);
    return true;
  }

  /** A real right click at a window point. */
  async rightClickAt(x: number, y: number): Promise<void> {
    const wc = this.window.webContents;
    wc.sendInputEvent({ type: 'mouseDown', x: Math.round(x), y: Math.round(y), button: 'right', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x: Math.round(x), y: Math.round(y), button: 'right', clickCount: 1 });
    await wait(80);
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
