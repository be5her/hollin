import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

/** Errors Windows reports while an antivirus scanner, the search indexer or a preview pane briefly holds a file. */
const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES']);

export interface RetryOptions {
  /** Total time to keep retrying, in ms. */
  budgetMs?: number;
  /** Injected for tests. */
  rename?: (from: string, to: string) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * `fs.rename`, retried with backoff while the error looks like a transient lock (Windows), for up to
 * about two seconds. Used for files and for whole folders (trash, restore, staging).
 */
export async function renameWithRetry(from: string, to: string, options: RetryOptions = {}): Promise<void> {
  const rename = options.rename ?? fs.rename;
  const sleep = options.sleep ?? wait;
  const budget = options.budgetMs ?? 2000;
  let delay = 10;
  let spent = 0;
  for (;;) {
    try {
      await rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? '';
      if (!TRANSIENT.has(code) || spent >= budget) throw err;
      await sleep(delay);
      spent += delay;
      delay = Math.min(delay * 2, 250);
    }
  }
}

export interface AtomicWriteOptions extends RetryOptions {
  /** Flush the data to disk before the rename (default true). */
  fsync?: boolean;
}

/**
 * Writes a file so readers only ever see the old or the new content: a uniquely named temp file next
 * to it, fsync, then rename over the target (retried on Windows locks). The temp file is removed on failure.
 */
export async function writeFileAtomic(file: string, data: string | Uint8Array, options: AtomicWriteOptions = {}): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    const handle = await fs.open(tmp, 'w');
    try {
      await handle.writeFile(data);
      if (options.fsync !== false) await handle.sync();
    } finally {
      await handle.close();
    }
    await renameWithRetry(tmp, file, options);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

export async function writeJsonAtomic(file: string, value: unknown, options?: AtomicWriteOptions): Promise<void> {
  await writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`, options);
}

/** The parsed JSON of a file, or undefined when it does not exist. Other errors (bad JSON, permissions) throw. */
export async function readJsonFile<T = unknown>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

/**
 * Runs tasks one after another per key. A failed task rejects its own caller but never blocks the
 * tasks queued after it (a plain `chain = chain.then(task)` stays rejected forever after one failure).
 */
export class WriteQueue {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const next = previous.then(task, task);
    const tail = next.catch(() => {});
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return next;
  }

  /** Resolves once everything queued so far has finished, successfully or not. */
  async idle(key?: string): Promise<void> {
    const tails = key ? [this.tails.get(key)] : [...this.tails.values()];
    await Promise.all(tails.map((t) => t?.catch(() => {})));
  }
}
