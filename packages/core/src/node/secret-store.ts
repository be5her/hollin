import type { SecretsApi } from '../types';
import { WriteQueue, readJsonFile, writeJsonAtomic } from './atomic-write';

/** OS-backed encryption, e.g. Electron's safeStorage. */
export interface Cipher {
  readonly available: boolean;
  encrypt(plain: string): Uint8Array;
  decrypt(cipher: Uint8Array): string;
}

/**
 * Named secrets, encrypted with the OS keychain and kept in one file in the app's data folder.
 * Without OS encryption nothing is written: secrets live in memory for this session only, and
 * `persistent` tells the UI to say so. Plain text never touches the disk.
 */
export class SecretStore implements SecretsApi {
  private readonly values = new Map<string, string>();
  private readonly queue = new WriteQueue();

  constructor(
    private readonly file: string,
    private readonly cipher: Cipher,
  ) {}

  get persistent(): boolean {
    return this.cipher.available;
  }

  async load(): Promise<void> {
    if (!this.cipher.available) return;
    let stored: Record<string, unknown> | undefined;
    try {
      stored = await readJsonFile<Record<string, unknown>>(this.file);
    } catch (err) {
      console.warn(`[secrets] could not read ${this.file}: ${(err as Error).message}`);
    }
    for (const [name, value] of Object.entries(stored ?? {})) {
      if (typeof value !== 'string') continue;
      try {
        this.values.set(name, this.cipher.decrypt(Buffer.from(value, 'base64')));
      } catch {
        // Encrypted by another user or machine: unreadable here, so it is dropped on the next write.
        console.warn(`[secrets] could not decrypt "${name}"; it has to be entered again`);
      }
    }
  }

  /** Resolves once every queued write has finished. */
  idle(): Promise<void> {
    return this.queue.idle();
  }

  has(name: string): boolean {
    return this.values.has(name);
  }

  get(name: string): string | undefined {
    return this.values.get(name);
  }

  async set(name: string, value: string): Promise<void> {
    this.values.set(name, value);
    await this.save();
  }

  async delete(name: string): Promise<void> {
    this.values.delete(name);
    await this.save();
  }

  private async save(): Promise<void> {
    if (!this.cipher.available) return;
    const encrypted = Object.fromEntries([...this.values].map(([name, value]) => [name, Buffer.from(this.cipher.encrypt(value)).toString('base64')]));
    await this.queue.run('secrets', () => writeJsonAtomic(this.file, encrypted));
  }
}
