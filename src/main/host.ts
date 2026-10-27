import path from 'node:path';
import {
  BRANDING,
  CommandRegistry,
  StudioError,
  toErrorPayload,
  toolInputSchema,
  type Caller,
  type ErrorPayload,
  type HostApi,
  type HostEventMessage,
  type HostEventName,
  type HostEvents,
  type McpCallEntry,
  type McpStatus,
  type ModuleMain,
  type ProjectApi,
} from '@studio/core';
import { ConfigStore, ProjectService, SecretStore, type Cipher } from '@studio/core/node';
import { startMcpServer, type RunningMcpServer } from '@studio/mcp';
import { mainModules } from '@studio/modules/main';
import { hostCommands } from './host-commands';

export interface HostOptions {
  userDataDir: string;
  version: string;
  platform: string;
  /** Runtime versions shown in Settings > About. */
  runtime?: Record<string, string>;
  cipher: Cipher;
  broadcast(message: HostEventMessage): void;
  /** Recolours the native window controls drawn over the title bar. */
  setTitleBarColors?(colors: { color: string; symbolColor: string }): void;
  /** Extra modules, e.g. the smoke test's. */
  extraModules?: ModuleMain[];
  /** Native file and folder pickers; absent in tests. */
  dialogs?: HostApi['dialogs'];
  /** Autosave timing, shortened by the smoke test. */
  autosave?: { debounceMs?: number; maxWaitMs?: number };
}

export interface InvokeOptions {
  caller: Caller;
  agent?: string;
  projectId?: string | null;
}

export type InvokeOutcome = { ok: true; result: unknown } | { ok: false; error: ErrorPayload };

const MAX_CALLS = 200;

/**
 * The host behind every window: the command registry, config, secrets and the MCP server.
 * Electron-specific pieces (windows, safeStorage, dialogs) are passed in, so this stays testable.
 */
export class Host {
  readonly registry = new CommandRegistry();
  readonly config: ConfigStore;
  readonly secrets: SecretStore;
  readonly api: HostApi;
  private mcp: RunningMcpServer | null = null;
  private mcpError: string | undefined;
  private readonly calls: McpCallEntry[] = [];
  private service: ProjectService | null = null;

  /** The project library and the open projects; available once `start` has run. */
  get projects(): ProjectService {
    if (!this.service) throw new StudioError('INTERNAL', 'The project library is not open yet');
    return this.service;
  }

  /** Where the library lives unless the user moved it. */
  get defaultLibraryRoot(): string {
    return path.join(this.opts.userDataDir, 'Library');
  }

  constructor(readonly opts: HostOptions) {
    const host = this;
    this.config = new ConfigStore(path.join(opts.userDataDir, 'config.json'), (config) => this.emit('config.changed', { config }));
    this.secrets = new SecretStore(path.join(opts.userDataDir, 'secrets.json'), opts.cipher);
    this.api = {
      version: opts.version,
      platform: opts.platform,
      dataDir: opts.userDataDir,
      config: {
        get: () => this.config.get(),
        update: (patch) => this.config.update(patch),
      },
      secrets: this.secrets,
      get projects() {
        return host.projects;
      },
      dialogs: opts.dialogs,
      execute: (id, input, ctx) => this.registry.execute(id, input, ctx),
      meta: (id) => this.registry.meta(id),
      listCommands: () => this.registry.list(),
      inputSchema: (id) => {
        const entry = this.registry.get(id);
        return entry ? toolInputSchema(entry.command.input) : undefined;
      },
      emit: (event, payload) => this.emit(event, payload),
      on: (event, listener) => this.onEvent((message) => void (message.event === event && listener(message.payload as never))),
      mcpStatus: () => this.mcpStatus(),
    };
    this.registry.registerModule({ id: 'host', commands: hostCommands(this) });
    for (const mod of [...mainModules, ...(opts.extraModules ?? [])]) this.registry.registerModule(mod);
  }

  private readonly taps = new Set<(message: HostEventMessage) => void>();

  emit<E extends HostEventName>(event: E, payload: HostEvents[E]): void {
    const message = { event, payload } as HostEventMessage;
    this.opts.broadcast(message);
    for (const tap of this.taps) tap(message);
  }

  /** Sees every event the host broadcasts, e.g. for the smoke test. Returns the function that stops it. */
  onEvent(tap: (message: HostEventMessage) => void): () => void {
    this.taps.add(tap);
    return () => void this.taps.delete(tap);
  }

  async start(): Promise<void> {
    const config = await this.config.load();
    await this.secrets.load();
    for (const mod of this.registry.listModules()) {
      try {
        await mod.onStart?.(this.api);
      } catch (err) {
        console.warn(`[host] module ${mod.id} failed to start: ${(err as Error).message}`);
      }
    }
    this.service = new ProjectService({
      libraryRoot: config.library.path || this.defaultLibraryRoot,
      defaultLibraryRoot: this.defaultLibraryRoot,
      appVersion: this.opts.version,
      emit: (event, payload) => this.emit(event, payload),
      rememberSession: async (session) => void (await this.config.update({ session })),
      rememberLibrary: async (root) => void (await this.config.update({ library: { path: path.resolve(root) === path.resolve(this.defaultLibraryRoot) ? '' : root } })),
      session: this.opts.autosave,
      onProjectOpen: async (project) => {
        for (const mod of this.registry.listModules()) await mod.onProjectOpen?.(project, this.api);
      },
      onProjectClose: async (project) => {
        for (const mod of this.registry.listModules()) await mod.onProjectClose?.(project, this.api);
      },
    });
    await this.service.start(config.session);
    if (config.mcp.enabled) await this.startMcp();
  }

  /**
   * Stops the MCP server, saves and closes the projects, stops the modules and lets queued writes
   * finish. Idempotent: a second call (Windows logoff, then quit) waits for the first.
   */
  stop(): Promise<void> {
    this.stopping ??= this.stopOnce();
    return this.stopping;
  }

  private stopping: Promise<void> | null = null;

  private async stopOnce(): Promise<void> {
    await this.stopMcp();
    await this.service?.stop();
    for (const mod of this.registry.listModules()) {
      try {
        await mod.onStop?.(this.api);
      } catch (err) {
        console.warn(`[host] module ${mod.id} failed to stop: ${(err as Error).message}`);
      }
    }
    // Let queued writes finish before the process (or the smoke test's cleanup) removes anything.
    await Promise.all([this.config.idle(), this.secrets.idle()]);
  }

  /** Runs a command for the UI (or the smoke test) and never throws: the outcome crosses IPC as data. */
  async invoke(id: string, input: unknown, options: InvokeOptions): Promise<InvokeOutcome> {
    try {
      const project = options.projectId ? await this.resolveProject(options.projectId) : undefined;
      const result = await this.registry.execute(id, input, { caller: options.caller, agent: options.agent, host: this.api, project });
      return { ok: true, result };
    } catch (err) {
      if (!(err instanceof StudioError)) console.error(`[host] command ${id} failed`, err);
      return { ok: false, error: toErrorPayload(err) };
    }
  }

  /** The project a call acts on: the named one (opened if needed), else the one on screen. */
  resolveProject(hint: string | null): Promise<ProjectApi | undefined> {
    return this.projects.resolve(hint);
  }

  // ---------- MCP ----------

  mcpStatus(): McpStatus {
    const { port } = this.config.get().mcp;
    return { running: this.mcp !== null, port, url: `http://127.0.0.1:${port}/mcp`, ...(this.mcpError ? { error: this.mcpError } : {}) };
  }

  mcpCalls(): McpCallEntry[] {
    return [...this.calls];
  }

  async startMcp(): Promise<void> {
    await this.stopMcp(false);
    const { port } = this.config.get().mcp;
    try {
      this.mcp = await startMcpServer({
        registry: this.registry,
        host: this.api,
        port,
        name: BRANDING.mcpServerName,
        version: this.opts.version,
        instructions: `${BRANDING.productName} is a desktop app for designing buildings, floor plans and interiors. Lengths are in millimetres. Project tools act on the project open in the app unless you pass projectId.`,
        resolveProject: (hint) => this.resolveProject(hint),
        identifyAssistant: (token) => this.api.identifyAssistant?.(token),
        onCall: (entry) => {
          this.calls.push(entry);
          if (this.calls.length > MAX_CALLS) this.calls.splice(0, this.calls.length - MAX_CALLS);
          this.emit('mcp.call', entry);
        },
      });
      this.mcpError = undefined;
      console.log(`[host] MCP server listening on ${this.mcp.url}`);
    } catch (err) {
      this.mcp = null;
      const code = (err as NodeJS.ErrnoException).code;
      this.mcpError = code === 'EADDRINUSE' ? `Port ${port} is already in use. Choose another port.` : (err as Error).message;
      console.error(`[host] MCP server failed to start on port ${port}: ${this.mcpError}`);
    }
    this.emit('mcp.status', this.mcpStatus());
  }

  async stopMcp(announce = true): Promise<void> {
    if (this.mcp) {
      await this.mcp.close();
      this.mcp = null;
    }
    this.mcpError = undefined;
    if (announce) this.emit('mcp.status', this.mcpStatus());
  }
}
