import type { HostEventMessage } from '@studio/core';
import type { StudioBridge } from '@studio/ui/bridge';
import { contextBridge, ipcRenderer } from 'electron';

/**
 * The only bridge between the renderer and the main process. Modules never touch IPC: they call
 * commands by id, and the host routes them through the registry.
 */
const bridge: StudioBridge = {
  invoke: (id, input, projectId) => ipcRenderer.invoke('studio:invoke', { id, input, projectId }),
  listCommands: () => ipcRenderer.invoke('studio:commands'),
  onEvent: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, message: HostEventMessage) => listener(message);
    ipcRenderer.on('studio:event', wrapped);
    return () => void ipcRenderer.removeListener('studio:event', wrapped);
  },
  platform: process.platform,
  version: process.env.STUDIO_VERSION ?? '0.0.0',
};

contextBridge.exposeInMainWorld('studio', bridge);
