import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { changelogSection, checkRelease } from './release-check.mjs';

const script = fileURLToPath(new URL('./release-check.mjs', import.meta.url));
const root = path.resolve(path.dirname(script), '..');

const CHANGELOG = `# Changelog

## [Unreleased]

## [1.2.0] - 2026-11-02

### Added
- Something new.

## [1.1.0] - 2026-10-30

- Older.

[1.2.0]: https://example.invalid/compare/v1.1.0...v1.2.0
`;

describe('changelogSection', () => {
  it('returns the body of the version heading up to the next section', () => {
    expect(changelogSection(CHANGELOG, '1.2.0')).toBe('### Added\n- Something new.');
    expect(changelogSection(CHANGELOG, '1.1.0')).toBe('- Older.');
  });

  it('is null for a version without a section, and never matches a prefix', () => {
    expect(changelogSection(CHANGELOG, '1.3.0')).toBeNull();
    expect(changelogSection(CHANGELOG, '1.2')).toBeNull();
    expect(changelogSection('## [1.2.0.1]\n- x', '1.2.0')).toBeNull();
  });

  it('reads CRLF files and treats dots as dots', () => {
    expect(changelogSection('## [1.0.0]\r\n- a\r\n', '1.0.0')).toBe('- a');
    expect(changelogSection('## [1x0x0]\n- a\n', '1.0.0')).toBeNull();
  });
});

describe('checkRelease', () => {
  it('passes with a section and a matching tag, in either form', () => {
    expect(checkRelease({ version: '1.2.0', changelog: CHANGELOG, tag: 'v1.2.0' }).errors).toEqual([]);
    expect(checkRelease({ version: '1.2.0', changelog: CHANGELOG, tag: 'refs/tags/v1.2.0' }).errors).toEqual([]);
    expect(checkRelease({ version: '1.2.0', changelog: CHANGELOG }).notes).toBe('### Added\n- Something new.');
  });

  it('fails without a section, with an empty one, and with a tag that does not match', () => {
    expect(checkRelease({ version: '1.3.0', changelog: CHANGELOG }).errors).toEqual(['CHANGELOG.md has no "## [1.3.0]" section.']);
    expect(checkRelease({ version: '2.0.0', changelog: '## [2.0.0]\n\n## [1.0.0]\n- a' }).errors).toEqual(['CHANGELOG.md\'s "## [2.0.0]" section is empty.']);
    expect(checkRelease({ version: '1.2.0', changelog: CHANGELOG, tag: 'v1.2.1' }).errors).toEqual(['The tag "v1.2.1" does not match package.json\'s version: expected "v1.2.0".']);
    expect(checkRelease({ version: '1.2.0', changelog: CHANGELOG, tag: '1.2.0' }).errors).toHaveLength(1);
  });

  it('fails for a version that is not semantic', () => {
    expect(checkRelease({ version: '1.2', changelog: '## [1.2]\n- a' }).errors).toEqual(['package.json\'s version "1.2" is not a semantic version.']);
  });
});

describe('the script on this repository', () => {
  const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

  it('finds the current version in CHANGELOG.md and writes its notes', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'release-check-'));
    try {
      const notes = path.join(dir, 'notes.md');
      const ok = run(`v${version}`, '--notes', notes);
      expect(ok.stderr).toBe('');
      expect(ok.status).toBe(0);
      expect(readFileSync(notes, 'utf8').trim()).toBe(changelogSection(readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'), version));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits 1 for a tag of another version', () => {
    const bad = run('v999.0.0');
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain(`expected "v${version}"`);
  });
});
