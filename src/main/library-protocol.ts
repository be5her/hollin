import { promises as fs } from 'node:fs';
import { isId } from '@studio/core';
import { protocol } from 'electron';
import type { Host } from './host';

export const LIBRARY_SCHEME = 'library';

/** Must run before the app is ready. */
export function registerLibraryScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: LIBRARY_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
}

/**
 * Serves library files to the renderer, read-only: `library://project/<id>/thumbnail.png`. Only the
 * paths listed here resolve; everything else is 404. Later milestones add project assets and the catalog.
 */
export function handleLibraryProtocol(host: Host): void {
  protocol.handle(LIBRARY_SCHEME, async (request) => {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);
    if (url.hostname === 'project' && parts.length === 2 && isId(parts[0]) && parts[1] === 'thumbnail.png') {
      const file = host.projects.library.thumbnailFile(parts[0]);
      const data = file ? await fs.readFile(file).catch(() => null) : null;
      if (data) return new Response(new Uint8Array(data), { headers: { 'content-type': 'image/png', 'cache-control': 'max-age=31536000, immutable' } });
    }
    return new Response('Not found', { status: 404 });
  });
}
