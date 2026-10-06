import type { Vec2 } from '@studio/core';
import type { RenderFrame } from '../render';

export type ToolId = 'select' | 'wall';

/** What a drawing tool needs from the editor and its host. */
export interface ToolHost {
  /** Runs a command on the open project; failures are reported to the user by the host. */
  invoke(id: string, input: unknown): Promise<unknown>;
  levelId(): string | null;
  options(): ToolOptions;
  /** The zoom, to turn pixel tolerances into millimetres. */
  scale(): number;
  invalidate(): void;
  /** A tool asks to go back to selecting. */
  finish(): void;
}

export interface WallOptions {
  thickness: number;
  height: number | null;
  alignment: 'center' | 'left' | 'right';
  /** One entity for the whole polyline instead of one wall per segment. */
  single: boolean;
}

export interface ToolOptions {
  wall: WallOptions;
}

export const DEFAULT_TOOL_OPTIONS: ToolOptions = { wall: { thickness: 200, height: null, alignment: 'center', single: false } };

export interface ToolPointer {
  world: Vec2;
  screen: Vec2;
  button: number;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
}

/** A tool is a small state machine fed pointer and key events; it previews on the canvas and commits through commands. */
export interface Tool {
  readonly id: ToolId;
  /** True while something is being drawn (Escape cancels it instead of leaving the tool). */
  readonly busy: boolean;
  pointerDown?(e: ToolPointer): void;
  pointerMove?(e: ToolPointer): void;
  pointerUp?(e: ToolPointer): void;
  /** Returns true when the key was used. */
  key?(e: KeyboardEvent): boolean;
  cancel(): void;
  /** Draws the preview; the context is in world space, `frame` has the camera and theme. */
  draw?(ctx: CanvasRenderingContext2D, frame: RenderFrame): void;
  /** A one-line hint for the footer. */
  hint(): string;
}
