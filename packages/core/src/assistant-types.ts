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
  | { kind: 'tool'; id: string; name: string; command: string; title: string; input: unknown; status: 'running' | 'ok' | 'error' | 'declined'; summary: string; at: string };

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
  /** The model the chat runs against (`config.ai.model`). */
  model: string;
}

/** What `assistant.event` carries: the whole chat after a structural change, or one text delta while a reply streams. */
export type AssistantEvent = { type: 'changed'; state: ChatSnapshot } | { type: 'text'; id: string; delta: string };
