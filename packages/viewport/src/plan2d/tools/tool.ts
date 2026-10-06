import type { Box, Entity, LevelWalls, Vec2 } from '@studio/core';
import type { Hit } from '../hit';
import type { RenderFrame } from '../render';

export type ToolId = 'select' | 'wall';

/** What copy and paste carry: entities as data, and the point they were copied around. */
export interface Clipboard {
  entities: Entity[];
  anchor: Vec2;
}

/** What a drawing tool needs from the editor and its host. */
export interface ToolHost {
  /** Runs a command on the open project; failures are reported to the user by the host. */
  invoke(id: string, input: unknown): Promise<unknown>;
  levelId(): string | null;
  /** The active level's entities. */
  entities(): Record<string, Entity>;
  options(): ToolOptions;
  /** The zoom, to turn pixel tolerances into millimetres. */
  scale(): number;
  invalidate(): void;
  /** A tool asks to go back to selecting. */
  finish(): void;
  selection(): ReadonlySet<string>;
  select(ids: Iterable<string>, mode?: 'replace' | 'add' | 'toggle'): void;
  hit(p: Vec2): Hit | null;
  marquee(box: Box, mode: 'window' | 'crossing'): string[];
  /** The level's joined walls, leaving out the given ones (for a drag preview). */
  walls(exclude?: ReadonlySet<string>): LevelWalls | null;
  clipboard: Clipboard | null;
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
  /** How far the arrow keys move the selection, in mm. */
  nudge: number;
}

export const DEFAULT_TOOL_OPTIONS: ToolOptions = { wall: { thickness: 200, height: null, alignment: 'center', single: false }, nudge: 100 };

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
  /** True while something is being drawn or dragged (Escape cancels it instead of leaving the tool). */
  readonly busy: boolean;
  pointerDown?(e: ToolPointer): void;
  pointerMove?(e: ToolPointer): void;
  pointerUp?(e: ToolPointer): void;
  /** Returns true when the key was used. */
  key?(e: KeyboardEvent): boolean;
  cancel(): void;
  /** The document changed: a drag whose entity vanished is dropped. */
  documentChanged?(entities: Record<string, Entity>): void;
  /** Entities the tool draws itself right now (a drag preview), left out of the joined walls. */
  excluded?(): ReadonlySet<string>;
  /** Draws the preview; the context is in world space, `frame` has the camera and theme. */
  draw?(ctx: CanvasRenderingContext2D, frame: RenderFrame): void;
  /** A one-line hint for the footer. */
  hint(): string;
}
