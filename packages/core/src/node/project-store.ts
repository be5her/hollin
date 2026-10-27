import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { StudioError } from '../errors';
import { docFromFiles, levelFileOf, migrateProject, parseLevelFile, parseProjectFile, projectFileOf, stableStringify } from '../doc/files';
import type { LevelData, LevelFile, ProjectDoc } from '../doc/schema';
import { readJsonFile, writeFileAtomic } from './atomic-write';

export const PROJECT_FILE = 'project.json';
export const LEVELS_DIR = 'levels';
export const SNAPSHOTS_DIR = 'snapshots';
/** The prefix of a snapshot's staging folder inside `snapshots/`. */
export const SNAPSHOT_STAGING = '.tmp-';
const LEVEL_FILE = /^[a-z0-9_]+\.[0-9a-f]{12}\.json$/;

/** What is on disk for a project, so the next save writes only what changed. */
export interface SavedState {
  /** Per level: the in-memory object that was written, and its file name. */
  levels: Map<string, { data: LevelData; file: string }>;
  /** The exact text of project.json. */
  projectJson: string;
}

export interface ReadResult {
  doc: ProjectDoc;
  saved: SavedState;
  /** The format version the file had, when it was migrated on reading. */
  migratedFrom?: number;
  /** Problems that did not stop the project from opening, e.g. a missing level file. */
  warnings: string[];
}

const sha = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 12);

/**
 * Reads a project folder. With `removeStrays` (only when the project is being opened, so no save of
 * it can be under way), level files that `project.json` does not list (left by a crash between the
 * steps of a save), stray temp files and snapshot staging folders are removed; anything else in the
 * folder is left alone. Any other read leaves the folder untouched: a level file that is not listed
 * yet may be the first step of a save in progress.
 */
export async function readProjectDir(dir: string, options: { removeStrays?: boolean } = {}): Promise<ReadResult> {
  const raw = await readJsonFile(path.join(dir, PROJECT_FILE)).catch((err: Error) => {
    throw new StudioError('INVALID_INPUT', `project.json could not be read: ${err.message}`);
  });
  if (raw === undefined) throw new StudioError('NOT_FOUND', `No project in ${dir}`);
  const { project: migrated, from, migrated: wasMigrated } = migrateProject(raw);
  const project = parseProjectFile(migrated);
  const warnings: string[] = [];
  const levels: Record<string, LevelFile | undefined> = {};
  for (const [levelId, file] of Object.entries(project.levelFiles)) {
    try {
      const level = await readJsonFile(path.join(dir, LEVELS_DIR, file));
      if (level === undefined) warnings.push(`The file of level "${project.levels[levelId]?.name ?? levelId}" is missing; the level opened empty.`);
      else levels[levelId] = parseLevelFile(level);
    } catch (err) {
      warnings.push(`The file of level "${project.levels[levelId]?.name ?? levelId}" could not be read (${(err as Error).message}); the level opened empty.`);
    }
  }
  const doc = docFromFiles(project, levels);
  if (options.removeStrays) await removeStrays(dir, new Set(Object.values(project.levelFiles)));
  const saved: SavedState = wasMigrated
    ? { levels: new Map(), projectJson: '' }
    : {
        levels: new Map(Object.entries(project.levelFiles).filter(([levelId]) => levels[levelId]).map(([levelId, file]) => [levelId, { data: doc.levelData[levelId], file }])),
        projectJson: stableStringify(project),
      };
  return { doc, saved, warnings, ...(wasMigrated ? { migratedFrom: from } : {}) };
}

async function removeStrays(dir: string, keep: Set<string>): Promise<void> {
  const levelsDir = path.join(dir, LEVELS_DIR);
  const names = await fs.readdir(levelsDir).catch(() => [] as string[]);
  for (const name of names) {
    if ((LEVEL_FILE.test(name) && !keep.has(name)) || name.endsWith('.tmp')) await fs.rm(path.join(levelsDir, name), { force: true }).catch(() => {});
  }
  for (const name of await fs.readdir(dir).catch(() => [] as string[])) {
    if (name.startsWith(`${PROJECT_FILE}.`) && name.endsWith('.tmp')) await fs.rm(path.join(dir, name), { force: true }).catch(() => {});
  }
  // A snapshot is staged in snapshots/.tmp-<id> and renamed into place; a crash in between leaves the staging folder.
  const snapshotsDir = path.join(dir, SNAPSHOTS_DIR);
  for (const name of await fs.readdir(snapshotsDir).catch(() => [] as string[])) {
    if (name.startsWith(SNAPSHOT_STAGING)) await fs.rm(path.join(snapshotsDir, name), { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Saves a project folder so a crash at any moment leaves a loadable project:
 *   1. each changed level is written to a new file named after its content hash (never over an existing one);
 *   2. project.json, which lists the current file of every level, replaces the old one atomically;
 *   3. level files the new project.json no longer lists are deleted.
 * Levels whose object is unchanged since the last save are not even stringified.
 */
export async function writeProjectDir(dir: string, doc: ProjectDoc, previous?: SavedState): Promise<SavedState> {
  const levelFiles: Record<string, string> = {};
  const levels = new Map<string, { data: LevelData; file: string }>();
  for (const levelId of Object.keys(doc.levels)) {
    const data = doc.levelData[levelId] ?? { entities: {} };
    const before = previous?.levels.get(levelId);
    if (before && before.data === data) {
      levelFiles[levelId] = before.file;
      levels.set(levelId, before);
      continue;
    }
    const text = stableStringify(levelFileOf(levelId, data));
    const file = `${levelId}.${sha(text)}.json`;
    if (before?.file !== file) await writeFileAtomic(path.join(dir, LEVELS_DIR, file), text);
    levelFiles[levelId] = file;
    levels.set(levelId, { data, file });
  }

  const projectJson = stableStringify(projectFileOf(doc, levelFiles));
  if (projectJson !== previous?.projectJson) await writeFileAtomic(path.join(dir, PROJECT_FILE), projectJson);

  const current = new Set(Object.values(levelFiles));
  for (const { file } of previous?.levels.values() ?? []) {
    if (!current.has(file)) await fs.rm(path.join(dir, LEVELS_DIR, file), { force: true }).catch(() => {});
  }
  return { levels, projectJson };
}
