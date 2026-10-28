// Checks that a release can be cut: CHANGELOG.md has a `## [<version>]` section for package.json's
// version, and the tag being released (when given) is `v<version>`. The release workflow runs it first.
//
//   node scripts/release-check.mjs [<tag>] [--notes <file>]
//
// <tag> may be `v1.2.3` or `refs/tags/v1.2.3`. `--notes` writes the version's changelog section (without
// its heading) to <file>, the draft release's notes. Exits 1 with the reasons when a check fails.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The body of the changelog's `## [<version>]` section (up to the next `## `), or null when there is none. */
export function changelogSection(changelog, version) {
  const lines = changelog.replace(/\r\n?/g, '\n').split('\n');
  const heading = new RegExp(`^## \\[${escape(version)}\\](?:\\s|$)`);
  const start = lines.findIndex((line) => heading.test(line));
  if (start < 0) return null;
  let end = lines.findIndex((line, i) => i > start && /^## /.test(line));
  if (end < 0) end = lines.length;
  // Link references at the end of the file (`[0.1.0]: https://…`) belong to no section.
  const body = lines.slice(start + 1, end).filter((line) => !/^\[[^\]]+\]:\s/.test(line));
  return body.join('\n').trim();
}

/** What stands in the way of releasing `version` (from `tag`, if given). An empty `errors` means none. */
export function checkRelease({ version, changelog, tag }) {
  const errors = [];
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) errors.push(`package.json's version "${version}" is not a semantic version.`);
  const notes = typeof version === 'string' ? changelogSection(changelog, version) : null;
  if (notes == null) errors.push(`CHANGELOG.md has no "## [${version}]" section.`);
  else if (notes === '') errors.push(`CHANGELOG.md's "## [${version}]" section is empty.`);
  if (tag != null && tag !== '') {
    const name = tag.replace(/^refs\/tags\//, '');
    if (name !== `v${version}`) errors.push(`The tag "${name}" does not match package.json's version: expected "v${version}".`);
  }
  return { errors, notes: notes ?? '' };
}

function main(argv) {
  const args = [...argv];
  let notesFile;
  const at = args.indexOf('--notes');
  if (at >= 0) {
    notesFile = args[at + 1];
    if (!notesFile) {
      console.error('release:check: --notes needs a file.');
      return 1;
    }
    args.splice(at, 2);
  }
  if (args.length > 1 || args.some((arg) => arg.startsWith('--'))) {
    console.error('Usage: node scripts/release-check.mjs [<tag>] [--notes <file>]');
    return 1;
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  let changelog = '';
  try {
    changelog = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  } catch {
    console.error('release:check: CHANGELOG.md is missing.');
    return 1;
  }
  const { errors, notes } = checkRelease({ version, changelog, tag: args[0] });
  if (errors.length) {
    for (const error of errors) console.error(`release:check: ${error}`);
    return 1;
  }
  if (notesFile) writeFileSync(notesFile, `${notes}\n`);
  console.log(`release:check: version ${version} is ready${args[0] ? ` for ${args[0].replace(/^refs\/tags\//, '')}` : ''}.`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
