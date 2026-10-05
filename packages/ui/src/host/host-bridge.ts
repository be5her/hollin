import { DOCUMENT, DestroyRef, InjectionToken, Service, inject, untracked } from '@angular/core';
import { StudioError, type CommandMeta, type HostEventMessage, type HostEventName, type HostEvents } from '@studio/core';
import type { StudioBridge } from '../bridge';
import { AppState } from '../state/app-state';

/** The functions (plus platform and version) the Electron preload exposes as `window.studio`. */
export const STUDIO_BRIDGE = new InjectionToken<StudioBridge>('StudioBridge', {
  providedIn: 'root',
  factory: () => inject(DOCUMENT).defaultView!.studio,
});

type AnyListener = (message: HostEventMessage) => void;

/**
 * The renderer's only way to the host: commands by id, and the events the host broadcasts.
 * Every feature is a set of registry commands, so the UI, the palette, MCP and the assistant share one path.
 */
@Service()
export class HostBridge {
  private readonly bridge = inject(STUDIO_BRIDGE);
  private readonly app = inject(AppState);
  private readonly listeners = new Set<AnyListener>();
  private attached = false;

  readonly platform = this.bridge.platform;
  readonly version = this.bridge.version;
  readonly isMac = this.bridge.platform === 'darwin';
  /** The modifier key as shortcuts are written on this platform. */
  readonly modKey = this.isMac ? '⌘' : 'Ctrl';

  /**
   * Run a host command. `projectId` defaults to the project on screen; pass `null` to run a global
   * command without one. Throws StudioError with the host's code and message.
   */
  async invoke<T = unknown>(id: string, input: unknown = {}, projectId?: string | null): Promise<T> {
    const project = projectId === undefined ? untracked(this.app.activeProjectId) : projectId;
    const res = await this.bridge.invoke(id, input, project);
    if (!res.ok) throw new StudioError(res.error.code, res.error.message, res.error.details);
    return res.result as T;
  }

  listCommands(): Promise<CommandMeta[]> {
    return this.bridge.listCommands();
  }

  /** Listen to a host event; returns the function that stops listening. One IPC subscription fans out to every listener. */
  on<E extends HostEventName>(event: E, listener: (payload: HostEvents[E]) => void): () => void {
    if (!this.attached) {
      this.attached = true;
      this.bridge.onEvent((message) => {
        for (const l of [...this.listeners]) l(message);
      });
    }
    const wrapped: AnyListener = (message) => {
      if (message.event === event) listener(message.payload as HostEvents[E]);
    };
    this.listeners.add(wrapped);
    return () => void this.listeners.delete(wrapped);
  }
}

/** Listen to a host event for as long as the calling component, directive or service lives. */
export function injectHostEvent<E extends HostEventName>(event: E, listener: (payload: HostEvents[E]) => void): void {
  const off = inject(HostBridge).on(event, listener);
  inject(DestroyRef).onDestroy(off);
}
