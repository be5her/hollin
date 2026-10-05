import type { z } from 'zod';
import type { ConfigPatch, GlobalConfig } from './config';

/** Who is calling a command. Each caller gets the mutating gate its own way (see CommandRegistry). */
export type Caller = 'ui' | 'mcp' | 'assistant';

/** Encrypted per-machine secrets, e.g. the assistant's API key. Never written to config, projects or exports. */
export interface SecretsApi {
  /** False when the OS offers no encryption; secrets then live in memory for this session only. */
  readonly persistent: boolean;
  has(name: string): boolean;
  get(name: string): string | undefined;
  set(name: string, value: string): Promise<void>;
  delete(name: string): Promise<void>;
}

/** What a command learns about the project it runs against. Grows with the document model. */
export interface ProjectApi {
  readonly id: string;
  readonly name: string;
}

export interface MutationRequest {
  command: CommandMeta;
  input: unknown;
  caller: Caller;
  agent?: string;
}

/** What the host (the Electron main process, or a test) gives to commands. */
export interface HostApi {
  readonly version: string;
  readonly platform: string;
  /** Per-machine app data folder. Absent in hosts without one. */
  readonly dataDir?: string;
  config: {
    get(): GlobalConfig;
    update(patch: ConfigPatch): Promise<GlobalConfig>;
  };
  secrets: SecretsApi;
  /** Broadcast an event to every window. */
  emit<E extends HostEventName>(event: E, payload: HostEvents[E]): void;
  /**
   * Ask the user in the UI whether the in-app assistant may run a mutating command.
   * Absent until the assistant exists; mutating assistant calls are refused meanwhile.
   */
  confirmMutation?(request: MutationRequest): Promise<boolean>;
}

export interface CommandContext {
  caller: Caller;
  /** Which agent is calling, for attribution: the MCP client's name or the assistant's model. */
  agent?: string;
  host: HostApi;
  project?: ProjectApi;
}

export type AnyZodObject = z.ZodObject<z.ZodRawShape>;

export interface CommandDefinition<S extends AnyZodObject = AnyZodObject, O = unknown> {
  /** Dotted and stable, such as `plan.wall.add`. Becomes `plan_wall_add` as an MCP tool. */
  id: string;
  title: string;
  /** Becomes the tool description agents read, so say what it does and what it returns. */
  description: string;
  /** Project commands need an open project in the context. */
  scope: 'global' | 'project';
  /** Validated on every call; also the tool's input schema. */
  input: S;
  /**
   * Deletes, writes outside the library or is otherwise destructive. MCP callers are refused until the
   * user allows mutations; the assistant asks the user first. A function decides per call, after
   * validation. Ordinary design edits are not mutating: they are undoable transactions.
   */
  mutating?: boolean | ((input: z.infer<S>, ctx: CommandContext) => boolean | Promise<boolean>);
  /** Plumbing for the UI: kept out of the palette and MCP. */
  hidden?: boolean;
  handler(input: z.infer<S>, ctx: CommandContext): Promise<O>;
}

export interface CommandMeta {
  id: string;
  module: string;
  title: string;
  description: string;
  scope: 'global' | 'project';
  /** True when the command may mutate; `conditional` says it decides per call. */
  mutating: boolean;
  conditional: boolean;
  hidden: boolean;
  /** True when an empty input is valid, so the palette can run it directly. */
  noInput: boolean;
}

export interface ModuleMain {
  id: string;
  commands: CommandDefinition[];
  /** Once the host has loaded its config, before projects reopen. */
  onStart?(host: HostApi): Promise<void> | void;
  /** On shutdown, after projects closed. */
  onStop?(host: HostApi): Promise<void> | void;
  onProjectOpen?(project: ProjectApi, host: HostApi): Promise<void> | void;
  onProjectClose?(project: ProjectApi, host: HostApi): Promise<void> | void;
}

export interface McpStatus {
  running: boolean;
  port: number;
  url: string;
  error?: string;
}

/** One call an agent made to the MCP server, as listed in Settings. */
export interface McpCallEntry {
  tool: string;
  agent: string;
  projectId?: string;
  ok: boolean;
  /** The error code of a failed call. */
  error?: string;
  durationMs: number;
  at: string;
}

/** Events broadcast from the host to every window. Every change a view shows must be announced by one. */
export interface HostEvents {
  'config.changed': { config: GlobalConfig };
  'mcp.status': McpStatus;
  'mcp.call': McpCallEntry;
  /** The assistant's API key was set or cleared. */
  'secrets.changed': { name: string };
}

export type HostEventName = keyof HostEvents;
export type HostEventMessage<E extends HostEventName = HostEventName> = { event: E; payload: HostEvents[E] };
