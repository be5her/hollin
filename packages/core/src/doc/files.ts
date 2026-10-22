import { StudioError } from '../errors';
import { FORMAT_VERSION, LevelFileSchema, ProjectDocSchema, ProjectFileSchema, type LevelData, type LevelFile, type ProjectDoc, type ProjectFile } from './schema';

/**
 * JSON with object keys in a stable order, so the same document always produces the same bytes
 * (and the same content hash), and files diff cleanly.
 */
export function stableStringify(value: unknown): string {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

/** The level file of one level: its entities sorted by id. */
export function levelFileOf(levelId: string, data: LevelData): LevelFile {
  const entities = Object.values(data.entities).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { levelId, entities };
}

/** `project.json` for a document, given the file name each level was written to. */
export function projectFileOf(doc: ProjectDoc, levelFiles: Record<string, string>): ProjectFile {
  const { levelData: _levelData, ...rest } = doc;
  return { ...rest, levelFiles };
}

/** Rebuilds a document from `project.json` and its level files; a level whose file is missing comes back empty. */
export function docFromFiles(project: ProjectFile, levels: Record<string, LevelFile | undefined>): ProjectDoc {
  const { levelFiles: _files, ...rest } = project;
  const levelData: Record<string, LevelData> = {};
  for (const levelId of Object.keys(project.levels)) {
    const file = levels[levelId];
    levelData[levelId] = { entities: Object.fromEntries((file?.entities ?? []).map((e) => [e.id, e])) };
  }
  return ProjectDocSchema.parse({ ...rest, levelData });
}

/** Validates a parsed `project.json` after migration. */
export function parseProjectFile(raw: unknown): ProjectFile {
  const result = ProjectFileSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`);
    throw new StudioError('INVALID_INPUT', `project.json is not valid: ${issues.join('; ')}`, issues);
  }
  return result.data;
}

export function parseLevelFile(raw: unknown): LevelFile {
  return LevelFileSchema.parse(raw);
}

type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

/** Steps from each format version to the next. */
const MIGRATIONS: Record<number, Migration> = {
  // 2: the project's asset registry (decor models).
  1: (raw) => ({ ...raw, assets: {} }),
};

/**
 * Brings a raw `project.json` up to the current format. A file from a newer version of the app is
 * refused, never rewritten: parsing would drop fields this version does not know.
 */
export function migrateProject(raw: unknown): { project: Record<string, unknown>; from: number; migrated: boolean } {
  if (!raw || typeof raw !== 'object') throw new StudioError('INVALID_INPUT', 'project.json is not an object');
  let project = raw as Record<string, unknown>;
  const from = typeof project.formatVersion === 'number' ? project.formatVersion : 0;
  if (from > FORMAT_VERSION) {
    throw new StudioError('UNSUPPORTED_VERSION', `This project was saved by a newer version of the app (format ${from}; this version reads up to ${FORMAT_VERSION}). Update the app to open it.`);
  }
  for (let v = from; v < FORMAT_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) throw new StudioError('UNSUPPORTED_VERSION', `No migration from format ${v}.`);
    project = { ...step(project), formatVersion: v + 1 };
  }
  return { project, from, migrated: from !== FORMAT_VERSION };
}
