/**
 * The references decor uses, one grammar everywhere:
 *
 *   builtin:<id>        a furniture recipe, material or opening style that ships with the app
 *   asset:<sha256>.<ext> a file in the project's assets (and, for models, in the library catalog)
 *   paint:#rrggbb       any plain colour, as a material
 *
 * Items take models (builtin or asset), finishes and slots take materials (builtin or paint),
 * openings take styles (builtin).
 */

/** A content-addressed file name: its SHA-256 and extension (`ASSET_NAME` in the packages). */
export const ASSET_FILE = /^[0-9a-f]{64}\.[a-z0-9]{1,8}$/;
const BUILTIN = /^builtin:([a-z0-9][a-z0-9-]{0,63})$/;
const ASSET = /^asset:([0-9a-f]{64}\.[a-z0-9]{1,8})$/;
const PAINT = /^paint:(#[0-9a-f]{6})$/i;

export type DecorRef = { k: 'builtin'; id: string } | { k: 'asset'; file: string } | { k: 'paint'; color: string };

/** The parts of a reference, or null when it follows none of the forms. */
export function parseRef(ref: string): DecorRef | null {
  let m = BUILTIN.exec(ref);
  if (m) return { k: 'builtin', id: m[1] };
  m = ASSET.exec(ref);
  if (m) return { k: 'asset', file: m[1] };
  m = PAINT.exec(ref);
  if (m) return { k: 'paint', color: m[1].toLowerCase() };
  return null;
}

export const isModelRef = (ref: string): boolean => {
  const r = parseRef(ref);
  return r?.k === 'builtin' || r?.k === 'asset';
};
export const isMaterialRef = (ref: string): boolean => {
  const r = parseRef(ref);
  return r?.k === 'builtin' || r?.k === 'paint';
};
export const isStyleRef = (ref: string): boolean => parseRef(ref)?.k === 'builtin';

export const assetRef = (file: string): string => `asset:${file}`;
export const builtinRef = (id: string): string => `builtin:${id}`;

/** The asset file an `asset:` reference names, or null for any other reference. */
export function assetFileOf(ref: string): string | null {
  const r = parseRef(ref);
  return r?.k === 'asset' ? r.file : null;
}
