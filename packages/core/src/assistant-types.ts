import type { AiProvider } from './config';
import type { CommandMeta } from './types';

/*
 * What the in-app assistant shows: the transcript of a project's chat and the events that stream it
 * to the window. Pure types, shared by the assistant module's Node side and its panel.
 */

export type TranscriptItem =
  | { kind: 'user'; id: string; text: string; at: string }
  /** A reply, streamed: `text` grows with `assistant.event` text deltas. */
  | { kind: 'assistant'; id: string; text: string; at: string }
  /** A tool call: the command it ran, what it was given, and how it ended. */
  | ToolItem;

/**
 * A tool call in the chat. `status` `stopped`: the run was stopped while the call ran. The optional fields
 * are what the card's second line says, filled in main where the call carries them: the level and layer
 * of the edit it made (from the undo entry it left) or of the level it named, how many edits a batch
 * held, whether it only read, whether it left an undo step, what a snapshot showed, and that it
 * returned an image (fetched with `assistant.image`, never sent with the chat).
 */
export interface ToolItem {
  kind: 'tool';
  id: string;
  name: string;
  command: string;
  title: string;
  input: unknown;
  status: 'running' | 'ok' | 'error' | 'declined' | 'stopped';
  summary: string;
  at: string;
  level?: string;
  layer?: string;
  /** The number of edits in a `plan.apply` batch. */
  ops?: number;
  readOnly?: boolean;
  /** The call left an undo step (signed by the assistant). */
  undoable?: boolean;
  /** For a snapshot: `plan` or `3D, night` and so on. */
  view?: string;
  /** The call returned an image, kept in main for this chat while the project is open. */
  image?: { mimeType: string };
}

/** A mutating command the assistant wants to run; the user allows or declines it in the chat. */
export interface PendingConfirmation {
  id: string;
  command: CommandMeta;
  input: unknown;
}

export interface ChatSnapshot {
  projectId: string;
  /** `waiting`: a confirmation is pending. */
  status: 'idle' | 'running' | 'waiting';
  /** Why the last run ended early, if it did. */
  error: string | null;
  items: TranscriptItem[];
  confirm: PendingConfirmation | null;
  /** The model the chat runs against (`config.ai.model`), or the Claude Code label. */
  model: string;
  provider: AiProvider;
  /** The Claude Code session this chat continues (stored in the project's view state), if any. */
  sessionId: string | null;
  /** Stop was pressed and the run (with Claude Code, its process) has not ended yet: the next message waits for it. */
  stopping: boolean;
}

/** What `assistant.event` carries: the whole chat after a structural change, or one text delta while a reply streams. */
export type AssistantEvent = { type: 'changed'; state: ChatSnapshot } | { type: 'text'; id: string; delta: string };

/** What the assistant module found out about the user's Claude Code install (`claude --version`, `claude auth status`). */
export interface ClaudeCodeStatus {
  /** The configured path, or `claude` for the PATH lookup. */
  path: string;
  /** The binary resolved on disk, when found. */
  resolved?: string;
  found: boolean;
  version?: string;
  /** Null until known: `claude auth status` could not say. */
  loggedIn: boolean | null;
  error?: string;
}

/** What `assistant.status` returns: enough for the panel's empty states and the Settings section. */
export interface AssistantStatus {
  provider: AiProvider;
  model: string;
  keySet: boolean;
  persistent: boolean;
  mcp: { running: boolean; url: string };
  /** Only for the `claude-code` provider. */
  claudeCode: ClaudeCodeStatus | null;
}

/**
 * How the MCP server recognises a Claude Code process the assistant spawned: the per-process token in
 * the URL maps to the chat, whose calls then run as `caller: 'assistant'` under `agent`, inside `run`
 * (so the chat's confirmation finds them), against `projectId`.
 */
export interface AssistantCaller {
  agent: string;
  projectId: string;
  run<T>(fn: () => Promise<T>): Promise<T>;
}
