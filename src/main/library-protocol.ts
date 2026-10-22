import { promises as fs } from 'node:fs';
import { libraryUrlFile } from '@studio/core/node';
import { protocol } from 'electron';
import type { Host } from './host';

export const LIBRARY_SCHEME = 'library';

/** Must run before the app is ready. */
export function registerLibraryScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: LIBRARY_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
}

/**
 * Serves library files to the renderer, read-only: project thumbnails and assets, and the catalog's
 * models and thumbnails (`libraryUrlFile` in core lists the paths). Everything else is 404.
 */
export function handleLibraryProtocol(host: Host): void {
  protocol.handle(LIBRARY_SCHEME, async (request) => {
    const target = request.method === 'GET' ? libraryUrlFile(host.projects.library, request.url) : null;
    const data = target ? await fs.readFile(target.file).catch(() => null) : null;
    if (target && data) return new Response(new Uint8Array(data), { headers: { 'content-type': target.type, 'cache-control': 'max-age=31536000, immutable' } });
    return new Response('Not found', { status: 404 });
  });
}
