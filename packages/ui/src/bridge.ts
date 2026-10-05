import type { CommandMeta, ErrorPayload, HostEventMessage } from '@studio/core';

export type InvokeResult = { ok: true; result: unknown } | { ok: false; error: ErrorPayload };

/** What the preload script exposes as `window.studio`. Kept tiny on purpose. */
export interface StudioBridge {
  invoke(id: string, input: unknown, projectId: string | null): Promise<InvokeResult>;
  listCommands(): Promise<CommandMeta[]>;
  /** Returns the function that stops listening. */
  onEvent(listener: (message: HostEventMessage) => void): () => void;
  platform: string;
  version: string;
}

declare global {
  interface Window {
    studio: StudioBridge;
  }
}
