import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { z } from 'zod';
import { StudioError } from '../errors';
import { writeFileAtomic } from './atomic-write';
import { LEVELS_DIR, PROJECT_FILE, readProjectDir } from './project-store';

/** Stable across product renames: identifies the file format, not the app. */
export const PACKAGE_FORMAT = 'studio-project-package';
export const PACKAGE_VERSION = 1;

export const PackageManifestSchema = z.object({
  format: z.literal(PACKAGE_FORMAT),
  formatVersion: z.number().int().min(1),
  exportedAt: z.string(),
  appVersion: z.string(),
  projectId: z.string(),
  name: z.string(),
  includesSnapshots: z.boolean(),
});
export type PackageManifest = z.infer<typeof PackageManifestSchema>;

export interface PackageLimits {
  /** Largest package file accepted. */
  maxPackageBytes: number;
  /** Largest total size once unpacked. */
  maxUnpackedBytes: number;
  maxEntries: number;
  /** Largest compression ratio of a single large entry (zip bombs). */
  maxRatio: number;
}

export const DEFAULT_LIMITS: PackageLimits = { maxPackageBytes: 2 * 1024 ** 3, maxUnpackedBytes: 4 * 1024 ** 3, maxEntries: 20000, maxRatio: 200 };

/** Already-compressed formats are stored as they are. */
const STORED = new Set(['.png', '.jpg', '.jpeg', '.webp', '.glb', '.ktx2', '.zip', '.psp']);
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
const TOP_LEVEL = new Set([PROJECT_FILE, LEVELS_DIR, 'assets', 'thumbnail.png', 'snapshots']);
const ASSET_NAME = /^([0-9a-f]{64})\.[a-z0-9]{1,8}$/;

async function walk(dir: string, base = ''): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await walk(path.join(dir, entry.name), rel)));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

/** Which files of a project folder go into a package: the saved project, its assets and thumbnail, optionally its snapshots. */
async function packageFiles(projectDir: string, includeSnapshots: boolean): Promise<string[]> {
  const { saved } = await readProjectDir(projectDir);
  const levelFiles = [...saved.levels.values()].map((l) => `${LEVELS_DIR}/${l.file}`);
  const assets = (await walk(path.join(projectDir, 'assets'))).map((f) => `assets/${f}`).filter((f) => ASSET_NAME.test(path.posix.basename(f)));
  const thumbnail = (await fs.stat(path.join(projectDir, 'thumbnail.png')).catch(() => null)) ? ['thumbnail.png'] : [];
  const snapshots = includeSnapshots ? (await walk(path.join(projectDir, 'snapshots'))).filter((f) => !f.startsWith('.tmp-') && !f.endsWith('.tmp')).map((f) => `snapshots/${f}`) : [];
  return [PROJECT_FILE, ...levelFiles, ...assets, ...thumbnail, ...snapshots];
}

/** Writes a project folder (already saved) to a single-file package. Secrets are never part of a project. */
export async function exportPackage(
  projectDir: string,
  target: string,
  options: { appVersion: string; includeSnapshots: boolean },
): Promise<{ bytes: number; files: number; manifest: PackageManifest }> {
  const { doc } = await readProjectDir(projectDir);
  const files = await packageFiles(projectDir, options.includeSnapshots);
  const manifest: PackageManifest = {
    format: PACKAGE_FORMAT,
    formatVersion: PACKAGE_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: options.appVersion,
    projectId: doc.meta.id,
    name: doc.meta.name,
    includesSnapshots: options.includeSnapshots,
  };
  const zippable: Zippable = { 'manifest.json': [strToU8(`${JSON.stringify(manifest, null, 2)}\n`), { level: 6 }] };
  for (const rel of files) {
    const data = new Uint8Array(await fs.readFile(path.join(projectDir, ...rel.split('/'))));
    zippable[`project/${rel}`] = [data, { level: STORED.has(path.extname(rel).toLowerCase()) ? 0 : 6 }];
  }
  const zipped = zipSync(zippable);
  await writeFileAtomic(target, zipped);
  return { bytes: zipped.length, files: files.length, manifest };
}

/** Why an entry name is unsafe to unpack, or null when it is fine. */
export function unsafeEntryName(name: string): string | null {
  if (name.includes('\\')) return 'backslash in path';
  if (name.startsWith('/') || /^[a-z]:/i.test(name)) return 'absolute path';
  if (name.includes('\0') || /[<>:"|?*\x00-\x1f]/.test(name)) return 'forbidden character';
  const segments = name.split('/');
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') return 'path escapes the package';
    if (RESERVED.test(segment)) return 'reserved name';
    if (/[. ]$/.test(segment)) return 'name ends with a dot or space';
  }
  if (name !== 'manifest.json') {
    if (segments[0] !== 'project' || segments.length < 2) return 'unexpected file';
    if (!TOP_LEVEL.has(segments[1])) return 'unexpected file';
  }
  return null;
}

/**
 * Unpacks a package into a new folder under `stagingDir` and checks it the way opening a project
 * does. Rejects path tricks, reserved or colliding names, oversized or suspiciously compressed
 * content, and assets whose content does not match their hash name. The caller moves the folder
 * into the library.
 */
export async function importPackage(source: string, stagingDir: string, limits: PackageLimits = DEFAULT_LIMITS): Promise<{ dir: string; manifest: PackageManifest }> {
  const stat = await fs.stat(source).catch(() => null);
  if (!stat?.isFile()) throw new StudioError('NOT_FOUND', `No file at ${source}`);
  if (stat.size > limits.maxPackageBytes) throw new StudioError('INVALID_INPUT', 'The package is too large.');
  const data = new Uint8Array(await fs.readFile(source));

  let entries = 0;
  let unpacked = 0;
  const seen = new Set<string>();
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data, {
      filter: (file) => {
        if (file.name.endsWith('/')) return false;
        if (++entries > limits.maxEntries) throw new StudioError('INVALID_INPUT', 'The package has too many files.');
        const problem = unsafeEntryName(file.name);
        if (problem) throw new StudioError('INVALID_INPUT', `The package contains an unsafe file (${problem}): ${file.name}`);
        const key = file.name.toLowerCase();
        if (seen.has(key)) throw new StudioError('INVALID_INPUT', `The package contains two files whose names differ only in case: ${file.name}`);
        seen.add(key);
        unpacked += file.originalSize;
        if (unpacked > limits.maxUnpackedBytes) throw new StudioError('INVALID_INPUT', 'The package unpacks to more than the allowed size.');
        if (file.originalSize > 1024 * 1024 && file.size > 0 && file.originalSize / file.size > limits.maxRatio) {
          throw new StudioError('INVALID_INPUT', `The package contains a suspiciously compressed file: ${file.name}`);
        }
        return true;
      },
    });
  } catch (err) {
    if (err instanceof StudioError) throw err;
    throw new StudioError('INVALID_INPUT', `Not a valid project package: ${(err as Error).message}`);
  }

  const manifestBytes = files['manifest.json'];
  if (!manifestBytes) throw new StudioError('INVALID_INPUT', 'Not a project package: manifest.json is missing.');
  let manifest: PackageManifest;
  try {
    manifest = PackageManifestSchema.parse(JSON.parse(strFromU8(manifestBytes)));
  } catch {
    throw new StudioError('INVALID_INPUT', 'Not a project package: manifest.json is not valid.');
  }
  if (manifest.formatVersion > PACKAGE_VERSION) throw new StudioError('UNSUPPORTED_VERSION', 'This package was made by a newer version of the app. Update the app to import it.');
  if (!files[`project/${PROJECT_FILE}`]) throw new StudioError('INVALID_INPUT', 'Not a project package: project.json is missing.');

  for (const [name, bytes] of Object.entries(files)) {
    const asset = name.startsWith('project/assets/') ? ASSET_NAME.exec(path.posix.basename(name)) : null;
    if (asset && createHash('sha256').update(bytes).digest('hex') !== asset[1]) {
      throw new StudioError('INVALID_INPUT', `The package is damaged: ${path.posix.basename(name)} does not match its checksum.`);
    }
  }

  const dir = path.join(stagingDir, `import-${randomBytes(6).toString('hex')}`);
  try {
    for (const [name, bytes] of Object.entries(files)) {
      if (name === 'manifest.json') continue;
      await writeFileAtomic(path.join(dir, ...name.slice('project/'.length).split('/')), bytes, { fsync: false });
    }
    await readProjectDir(dir);
  } catch (err) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    if (err instanceof StudioError) throw new StudioError(err.code, `The package's project could not be opened: ${err.message}`);
    throw err;
  }
  return { dir, manifest };
}
