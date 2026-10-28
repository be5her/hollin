import type { z } from 'zod';
import type { AssistantCaller, AssistantEvent } from './assistant-types';
import type { ConfigPatch, GlobalConfig } from './config';
import type { CatalogApi } from './decor/catalog';
import type { Author, DocPatch, EditContext, HistoryInfo, HistoryState, LastTouched } from './doc/engine';
import { StudioError } from './errors';
import type { ProjectDoc } from './doc/schema';
import type { LibraryInfo, ListQuery, OpenProject, ProjectSummary, SaveStatus, SnapshotInfo } from './projects';

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

export interface EditResult<T> {
  result: T;
  changed: boolean;
  txId: string | null;
}

/** What a command learns about the project it runs against, and how it changes it. */
export interface ProjectApi {
  readonly id: string;
  readonly name: string;
  /** The current document (inside a batch: as changed so far). Read it; never mutate it. */
  readonly doc: ProjectDoc;
  /**
   * Changes the document as one transaction (one undo step) labelled and attributed to `author`.
   * Inside `plan.apply`, edits join the batch's transaction instead. With `dryRun` the change is
   * checked but not applied.
   */
  edit<T>(author: Author, label: string, fn: (tx: EditContext) => T | Promise<T>, options?: { coalesce?: string; dryRun?: boolean }): Promise<EditResult<T>>;
  undo(ifTop?: string): Promise<HistoryState>;
  redo(): Promise<HistoryState>;
  history(): { undo: HistoryInfo[]; redo: HistoryInfo[]; seq: number; epoch: number };
  /** When a record last changed and by whom (null: not since opening), for conflict checks. */
  lastTouched(id: string): LastTouched | null;
  /** True inside a `plan.apply` batch. */
  readonly batching?: boolean;
}

/** Who made a change or a snapshot: the user, the in-app assistant, or an MCP agent by name. */
export function authorOf(ctx: Pick<CommandContext, 'caller' | 'agent'>): string {
  return authorFrom(ctx).label;
}

export function authorFrom(ctx: Pick<CommandContext, 'caller' | 'agent'>): Author & { label: string } {
  if (ctx.caller === 'ui') return { kind: 'user', name: 'You', label: 'You' };
  if (ctx.caller === 'assistant') return { kind: 'assistant', name: ctx.agent ?? 'Assistant', label: `Assistant${ctx.agent ? ` (${ctx.agent})` : ''}` };
  return { kind: 'mcp', name: ctx.agent ?? 'unknown agent', label: `via MCP: ${ctx.agent ?? 'unknown agent'}` };
}

/**
 * Refuses an edit addressed by index (a vertex, a field read from a copy) when the record changed
 * since the caller looked at it: `baseSeq` is the change number the caller's copy had. Call it inside
 * the edit, where it runs in the project's edit queue. A reload (new epoch) counts as a change.
 */
export function assertUnchanged(ctx: CommandContext, id: string, what: string, baseSeq?: number, epoch?: number): void {
  if (baseSeq === undefined || !ctx.project) return;
  const current = ctx.project.history();
  if (epoch !== undefined && epoch !== current.epoch) throw new StudioError('CONFLICT', 'The project was reloaded since you looked at it; nothing was changed. Try again.', { kind: 'stale', epoch: current.epoch });
  const last = ctx.project.lastTouched(id);
  if (last && last.seq > baseSeq) {
    const by = last.author.kind === 'user' ? 'you' : last.author.kind === 'assistant' ? `the assistant (${last.author.name})` : `via MCP: ${last.author.name}`;
    throw new StudioError('CONFLICT', `The ${what} was changed by ${by} meanwhile; nothing was changed. Look again and retry.`, { kind: 'stale', seq: last.seq, by: last.author });
  }
}

/** Runs an edit of the command's project, attributed to whoever called the command. */
export function editProject<T>(ctx: CommandContext, label: string, fn: (tx: EditContext) => T | Promise<T>, options?: { coalesce?: string }): Promise<EditResult<T>> {
  if (!ctx.project) throw new Error('editProject needs a project');
  const { label: _display, ...author } = authorFrom(ctx);
  return ctx.project.edit(author, label, fn, options);
}

/** The project library and the open projects, as commands see them. */
export interface ProjectsApi {
  info(): LibraryInfo;
  list(query?: ListQuery): ProjectSummary[];
  tags(): { tag: string; count: number }[];
  get(id: string): ProjectSummary | undefined;
  /** The open projects in tab order. */
  openProjects(): OpenProject[];
  /** The project on screen, if any. */
  current(): OpenProject | null;
  create(input: { name: string; description?: string; tags?: string[] }): Promise<ProjectSummary>;
  /** Opens a project (or focuses it when already open). `focus` brings its tab to the front. */
  open(id: string, options?: { focus?: boolean }): Promise<OpenProject & { warnings: string[] }>;
  close(id: string): Promise<void>;
  focus(id: string | null): Promise<void>;
  update(id: string, patch: { name?: string; description?: string; tags?: string[] }): Promise<ProjectSummary>;
  duplicate(id: string, name?: string): Promise<ProjectSummary>;
  trash(id: string): Promise<ProjectSummary>;
  restore(id: string): Promise<ProjectSummary>;
  deleteForever(id: string): Promise<void>;
  emptyTrash(): Promise<{ deleted: number }>;
  save(id: string): Promise<SaveStatus>;
  snapshots(id: string): Promise<SnapshotInfo[]>;
  createSnapshot(id: string, name: string, createdBy: string): Promise<SnapshotInfo>;
  restoreSnapshot(id: string, snapshotId: string, by: string): Promise<{ restored: SnapshotInfo; backup: SnapshotInfo }>;
  deleteSnapshot(id: string, snapshotId: string): Promise<void>;
  exportProject(id: string, target: string, options?: { includeSnapshots?: boolean }): Promise<{ path: string; bytes: number; files: number }>;
  importProject(source: string): Promise<ProjectSummary>;
  setThumbnail(id: string, png: Uint8Array): Promise<ProjectSummary>;
  moveLibrary(target: string, mode: 'move' | 'adopt'): Promise<LibraryInfo>;
  reindex(): Promise<{ projects: number }>;
  /** The project a command acts on: the named one (opened if needed), else the one on screen. */
  resolve(hint: string | null): Promise<ProjectApi | undefined>;
  /** Per-machine view state of a project (active level, panels, the assistant's session): never part of the design, snapshots or exports. */
  uiState(id: string): Promise<Record<string, unknown>>;
  /** Merges `state` over the stored record key by key (a key set to `null` is removed), so main and the renderer can each own their keys. */
  setUiState(id: string, state: Record<string, unknown>): Promise<void>;
  /** Keeps an open project as it is in an automatic snapshot, e.g. before a large batch by an agent. */
  autoSnapshot?(id: string, name: string, createdBy: string): Promise<void>;
  /** The bytes of a file in a project's `assets/` (a content-addressed name from its registry, `<sha256>.<ext>`), or undefined when it is not there. */
  readAsset(id: string, file: string): Promise<Uint8Array | undefined>;
  /** The library's catalog of imported furniture models. */
  readonly catalog: CatalogApi;
}

export interface MutationRequest {
  command: CommandMeta;
  input: unknown;
  caller: Caller;
  agent?: string;
}

export interface FileDialogOptions {
  title?: string;
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
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
  projects: ProjectsApi;
  /** Runs another command with the given context (e.g. the steps of `plan.apply`). */
  execute(id: string, input: unknown, ctx: CommandContext): Promise<unknown>;
  meta(id: string): CommandMeta | undefined;
  /** Every command's metadata, hidden ones included (an agent-facing caller filters on `hidden`). */
  listCommands(): CommandMeta[];
  /** A command's input as JSON Schema (`toolInputSchema`), for tool definitions. */
  inputSchema(id: string): Record<string, unknown> | undefined;
  /** Native dialogs, present when the host has a window. */
  dialogs?: {
    pickFile(options?: FileDialogOptions): Promise<string | undefined>;
    pickSavePath(options?: FileDialogOptions): Promise<string | undefined>;
    pickFolder(options?: { title?: string; defaultPath?: string }): Promise<string | undefined>;
    /** Shows a file in the system's file manager (Explorer, Finder), selected. */
    reveal(path: string): void;
  };
  /** Broadcast an event to every window. */
  emit<E extends HostEventName>(event: E, payload: HostEvents[E]): void;
  /** Listen to the host's events in main (a module's watcher); returns the function that stops listening. */
  on<E extends HostEventName>(event: E, listener: (payload: HostEvents[E]) => void): () => void;
  /**
   * Ask the user in the UI whether the in-app assistant may run a mutating command. The assistant
   * module installs it when it starts (the question appears in the chat); without it, mutating
   * assistant calls are refused with MUTATION_BLOCKED.
   */
  confirmMutation?(request: MutationRequest): Promise<boolean>;
  /**
   * Recognises a Claude Code process the assistant spawned by the token it carries in the MCP URL.
   * Installed by the assistant module; the MCP server asks it for every `?assistant=` request.
   */
  identifyAssistant?(token: string): AssistantCaller | undefined;
  /** Whether the MCP server runs and where. */
  mcpStatus(): McpStatus;
  /** In-app updates (`app.update.*`); absent in hosts without one (tests). */
  updater?: UpdaterApi;
}

/**
 * Where an in-app update stands (`app.update.status`, announced as `update.changed`). `unsupported`:
 * this build has no update feed or cannot install one (`message` says why).
 */
export interface UpdateState {
  state: 'idle' | 'checking' | 'available' | 'up-to-date' | 'downloading' | 'ready' | 'error' | 'unsupported';
  /** The version found: available, downloading, ready. */
  version?: string;
  /** Its release notes, plain text. */
  notes?: string;
  /** Download progress, 0 to 100. */
  progress?: number;
  /** The error, or why this build cannot update. */
  message?: string;
  /** When a check last reached the feed (ISO time). */
  checkedAt?: string;
  /** The last check was the one the app runs at startup, not one the user asked for. */
  scheduled?: boolean;
}

/** The host's updater. Nothing downloads or installs unless asked. */
export interface UpdaterApi {
  status(): UpdateState;
  /** Asks the feed for a newer version; resolves with the outcome (never rejects: an error is `state: 'error'`). */
  check(options?: { scheduled?: boolean }): Promise<UpdateState>;
  /** Starts downloading the version found and returns at once (`downloading`); CONFLICT when there is none. */
  download(): UpdateState;
  /** Stops the app the way quitting does, then installs the downloaded version and restarts; CONFLICT when none is ready. */
  install(): Promise<void>;
  onChange(listener: (state: UpdateState) => void): () => void;
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
  /**
   * Changes nothing at all (a query, a description, a list, a probe, a picture of the design), so MCP
   * marks it `readOnlyHint`. Ordinary edits are neither read-only nor mutating. Never with `mutating`.
   */
  readOnly?: boolean;
  /** An editing command that can run as a step of `plan.apply` (one transaction for many edits). */
  batchable?: boolean;
  /**
   * What the handler returns: JSON (the default), or an image (`ImageResult`: `mimeType`, base64 `data`
   * and any other fields), which MCP and the assistant pass to the model as image content.
   */
  output?: 'json' | 'image';
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
  /** True when the command changes nothing (`readOnly` in its definition). */
  readOnly: boolean;
  /** True when an empty input is valid, so the palette can run it directly. */
  noInput: boolean;
  batchable: boolean;
  output: 'json' | 'image';
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
  /** `assistant` for a Claude Code process the assistant spawned, else `mcp`. */
  caller: Caller;
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
  /** The library catalog changed: a model was imported, removed or got its thumbnail (`file`). */
  'catalog.changed': { reason: string; file?: string };
  /** The library's listing changed: a project was created, renamed, trashed, imported, and so on. */
  'library.changed': { reason: string; projectId?: string };
  /**
   * An open project changed state: opened, closed, saved, failed to save, renamed, its snapshots or its
   * whole document replaced (snapshot restore). `focus` asks the UI to bring the project's tab forward.
   */
  'project.changed': { projectId: string; kind: 'opened' | 'closed' | 'save' | 'updated' | 'snapshots' | 'replaced'; focus?: boolean; save?: SaveStatus };
  /** An open project's document changed; the renderer's mirror applies `ops` (or refetches on a new epoch or a gap in `seq`). */
  'doc.patched': DocPatch & { projectId: string };
  /** A project's warnings changed (see `rules.check`); `count` is the new total. */
  'rules.changed': { projectId: string; count: number };
  /**
   * `view.snapshot` asks a window to draw a level's plan, or the building in 3D seen from `azimuth`
   * and `elevation` (degrees) with a display mode at `levelId`, an explode amount and day or night
   * lighting, in the light or dark palette and with or without a background (`export.image` asks for
   * those; `view.snapshot` defaults to light on paper); the window answers with the hidden
   * `view.snapshot.reply`.
   */
  'view.snapshot.request': { id: string; projectId: string; levelId: string; width: number; height: number; view: 'plan' | '3d'; azimuth: number; elevation: number; display: 'all' | 'isolate' | 'cutaway'; explode: number; lighting: 'day' | 'night'; theme: 'light' | 'dark'; transparent: boolean };
  /** The assistant's chat for a project changed: the whole chat after a structural change, or a text delta while a reply streams. */
  'assistant.event': { projectId: string; event: AssistantEvent };
  /** An export wrote files outside the library (`export.plan`, `export.building`, `export.image`): the format and the full paths written. */
  'exchange.exported': { projectId: string; format: string; files: string[] };
  /** The in-app update moved on: checking, found, downloading (progress), ready, failed. */
  'update.changed': UpdateState;
}

export type HostEventName = keyof HostEvents;
export type HostEventMessage<E extends HostEventName = HostEventName> = { event: E; payload: HostEvents[E] };
