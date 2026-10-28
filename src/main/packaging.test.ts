import { createRequire } from 'node:module';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const configFile = path.resolve(__dirname, '../../electron-builder.cjs');

interface BuilderConfig {
  publish: { provider: string; owner: string; repo: string } | null;
  extraMetadata?: { homepage?: string };
  linux: { target: string[] };
}

/** electron-builder.cjs as electron-builder reads it, with GITHUB_REPOSITORY set to `repository` (or unset). */
function loadConfig(repository: string | undefined): BuilderConfig {
  if (repository === undefined) delete process.env.GITHUB_REPOSITORY;
  else process.env.GITHUB_REPOSITORY = repository;
  delete require.cache[configFile];
  return require(configFile) as BuilderConfig;
}

const saved = process.env.GITHUB_REPOSITORY;
afterEach(() => {
  if (saved === undefined) delete process.env.GITHUB_REPOSITORY;
  else process.env.GITHUB_REPOSITORY = saved;
  delete require.cache[configFile];
});

describe('electron-builder.cjs', () => {
  it('a local build has no feed, and on Linux makes the AppImage only (the deb needs a homepage)', () => {
    const config = loadConfig(undefined);
    expect(config.publish).toBeNull();
    expect(config.extraMetadata).toBeUndefined();
    expect(config.linux.target).toEqual(['AppImage']);
  });
  it('a workflow build has the feed, the homepage from the repository, and the deb', () => {
    const config = loadConfig('someone/some-repo');
    expect(config.publish).toMatchObject({ provider: 'github', owner: 'someone', repo: 'some-repo' });
    expect(config.extraMetadata?.homepage).toBe('https://github.com/someone/some-repo');
    expect(config.linux.target).toEqual(['AppImage', 'deb']);
  });
  it('treats an empty GITHUB_REPOSITORY as none', () => {
    expect(loadConfig(' ').linux.target).toEqual(['AppImage']);
  });
});
