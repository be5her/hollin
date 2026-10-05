import { promises as fs } from 'node:fs';
import { defaultConfig, mergeConfig, type ConfigPatch, type GlobalConfig } from '../config';
import { WriteQueue, renameWithRetry, writeJsonAtomic } from './atomic-write';

/**
 * The global config: one JSON file in the app's data folder. Loading merges the file over the
 * defaults section by section and normalises every field, so an older or hand-edited file cannot
 * break the app. A file that is not JSON at all is kept aside as `config.corrupt-<time>.json`.
 */
export class ConfigStore {
  private config: GlobalConfig = defaultConfig();
  private readonly queue = new WriteQueue();

  constructor(
    private readonly file: string,
    private readonly onChange: (config: GlobalConfig) => void = () => {},
  ) {}

  async load(): Promise<GlobalConfig> {
    let raw: string | undefined;
    try {
      raw = await fs.readFile(this.file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.warn(`[config] could not read ${this.file}: ${(err as Error).message}`);
    }
    if (raw === undefined) {
      this.config = defaultConfig();
      return this.config;
    }
    try {
      this.config = mergeConfig(defaultConfig(), JSON.parse(raw));
    } catch {
      const aside = this.file.replace(/\.json$/, '') + `.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      await renameWithRetry(this.file, aside).catch(() => {});
      console.warn(`[config] ${this.file} was not valid JSON; kept it as ${aside} and started from defaults`);
      this.config = defaultConfig();
    }
    return this.config;
  }

  get(): GlobalConfig {
    return this.config;
  }

  /** Resolves once every queued write has finished. */
  idle(): Promise<void> {
    return this.queue.idle();
  }

  /** Applies the patch at once (so readers see it immediately), then writes the file and announces the change. */
  async update(patch: ConfigPatch): Promise<GlobalConfig> {
    this.config = mergeConfig(this.config, patch);
    const snapshot = this.config;
    await this.queue.run('config', () => writeJsonAtomic(this.file, snapshot));
    this.onChange(this.config);
    return this.config;
  }
}
