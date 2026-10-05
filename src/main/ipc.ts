import { ipcMain } from 'electron';
import type { Host } from './host';

export const CHANNELS = { invoke: 'studio:invoke', commands: 'studio:commands', event: 'studio:event' } as const;

interface InvokePayload {
  id: string;
  input: unknown;
  projectId: string | null;
}

/** The renderer reaches the host through these two handlers only. They never throw across IPC. */
export function registerIpc(host: Host): void {
  ipcMain.handle(CHANNELS.invoke, (_event, payload: InvokePayload) =>
    host.invoke(String(payload?.id ?? ''), payload?.input, { caller: 'ui', projectId: payload?.projectId ?? null }),
  );
  ipcMain.handle(CHANNELS.commands, () => host.registry.list());
}
