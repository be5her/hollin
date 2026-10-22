import path from 'node:path';
import { ASSET_FILE } from '../decor/refs';
import { isId } from '../ids';
import type { Library } from './library';

const MODEL_FILE = /^[0-9a-f]{64}\.(glb|png)$/;

const TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.ktx2': 'image/ktx2', '.bin': 'application/octet-stream' };

/**
 * The file a `library://` URL stands for, read-only, or null for anything else:
 *
 *   library://project/<id>/thumbnail.png
 *   library://project/<id>/assets/<sha256>.<ext>       a live project's asset (content-addressed names only)
 *   library://catalog/furniture/<sha256>.glb | .png    a catalog model and its thumbnail
 *
 * The query is ignored. Every segment is matched whole against a strict pattern, so `..`, encoded separators and other
 * names never reach the file system.
 */
export function libraryUrlFile(library: Pick<Library, 'get' | 'projectDir' | 'thumbnailFile' | 'catalogDir'>, url: string): { file: string; type: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  // A query (`?v=<version>`) only defeats the cache; it names nothing.
  const raw = parsed.pathname.split('/').filter(Boolean);
  // Percent-encoded slashes or dots would decode to something other than what was matched.
  if (raw.some((p) => p.includes('%'))) return null;
  const type = (name: string) => TYPES[path.extname(name).toLowerCase()] ?? 'application/octet-stream';
  if (parsed.hostname === 'project' && raw.length >= 2 && isId(raw[0])) {
    const summary = library.get(raw[0]);
    if (!summary) return null;
    if (raw.length === 2 && raw[1] === 'thumbnail.png') {
      const file = library.thumbnailFile(raw[0]);
      return file ? { file, type: 'image/png' } : null;
    }
    if (raw.length === 3 && raw[1] === 'assets' && ASSET_FILE.test(raw[2]) && !summary.trashedAt) return { file: path.join(library.projectDir(raw[0]), 'assets', raw[2]), type: type(raw[2]) };
    return null;
  }
  if (parsed.hostname === 'catalog' && raw.length === 2 && raw[0] === 'furniture' && MODEL_FILE.test(raw[1])) return { file: path.join(library.catalogDir, 'furniture', raw[1]), type: type(raw[1]) };
  return null;
}
