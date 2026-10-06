import type { Box, Connector, Coordinate, DerivedLevel, DimensionKind, Entity, LevelGeometry, LevelWalls, RuleLimits, Vec2 } from '@studio/core';
import type { PlanConnector } from '../connectors';
import type { VertexRef } from '../grips';
import type { Hit } from '../hit';
import type { RenderFrame } from '../render';
import type { SnapOptions, SnapResult } from '../snap';

export type ToolId = 'select' | 'wall' | 'door' | 'window' | 'room' | 'separator' | 'shape' | 'rectangle' | 'circle' | 'dimension' | 'label' | 'stair' | 'ramp' | 'ladder' | 'elevator' | 'column';

export type StairShape = Extract<Connector, { kind: 'stair' }>['shape'];

/** A tool asks the host for a line of text typed at a screen position (a label's text). */
export interface TextRequest {
  screen: Vec2;
  placeholder: string;
  commit(text: string): void;
}

/** What copy and paste carry: entities and connectors as data, and the point they were copied around. */
export interface Clipboard {
  entities: Entity[];
  connectors?: Connector[];
  anchor: Vec2;
}

/** What a drawing tool needs from the editor and its host. */
export interface ToolHost {
  /** Runs a command on the open project; failures are reported to the user by the host. */
  invoke(id: string, input: unknown): Promise<unknown>;
  levelId(): string | null;
  /** The active level's entities. */
  entities(): Record<string, Entity>;
  /** The stairs, ramps, elevators and other connectors the active level shows, by id. */
  connectors(): ReadonlyMap<string, PlanConnector>;
  /** A connector as a gesture would leave it, derived for the active level (null when it would not show there). */
  previewConnector(connector: Connector): PlanConnector | null;
  /** The levels bottom to top with their elevations, the same array while the document's levels are unchanged. */
  levels(): readonly DerivedLevel[];
  /** The limits connectors are derived with. */
  limits(): RuleLimits;
  /** The mirror's change number and epoch, sent with edits addressed by index so a stale one is refused. */
  seq(): number;
  epoch(): number;
  options(): ToolOptions;
  /** The zoom, to turn pixel tolerances into millimetres. */
  scale(): number;
  toScreen(p: Vec2): Vec2;
  invalidate(): void;
  /** A tool asks to go back to selecting. */
  finish(): void;
  selection(): ReadonlySet<string>;
  select(ids: Iterable<string>, mode?: 'replace' | 'add' | 'toggle'): void;
  vertex(): VertexRef | null;
  selectVertex(vertex: VertexRef | null): void;
  hit(p: Vec2): Hit | null;
  marquee(box: Box, mode: 'window' | 'crossing'): string[];
  /** The level's joined walls, leaving out the given ones (for a drag preview). */
  walls(exclude?: ReadonlySet<string>): LevelWalls | null;
  /** Everything the level derives to: walls, enclosed spaces, rooms, the automatic slab. */
  geometry(): LevelGeometry | null;
  /** Snaps a cursor position (null: nothing near): `from` enables the directional snaps and tracking, `relativeTo` the parallels and perpendiculars. The result is drawn until the next call. */
  snap(p: Vec2, options?: SnapOptions): SnapResult | null;
  /** Opens an input at a screen position; `commit` gets what was typed (Enter), nothing on Escape. */
  requestText(request: TextRequest): void;
  clipboard: Clipboard | null;
}

export interface WallOptions {
  thickness: number;
  height: number | null;
  alignment: 'center' | 'left' | 'right';
  /** One entity for the whole polyline instead of one wall per segment. */
  single: boolean;
}

/** What the shape tools make from an outline, and whether a free shape is filled. */
export interface ShapeOptions {
  kind: 'shape' | 'room' | 'slab' | 'void';
  filled: boolean;
}

export interface ToolOptions {
  wall: WallOptions;
  door: { width: number; height: number };
  window: { width: number; height: number; sill: number };
  shape: ShapeOptions;
  dimension: { kind: DimensionKind };
  /** The text height of new labels, in mm. */
  label: { size: number };
  /** How far the arrow keys move the selection, in mm. */
  nudge: number;
  /** The levels a new stair, ramp, ladder or elevator joins; null: the active level and the stacked level above it. */
  connector: { bottomLevelId: string | null; topLevelId: string | null };
  stair: { shape: StairShape; width: number; turn: 'left' | 'right' };
  ramp: { width: number };
  elevator: { shaft: { w: number; d: number }; car: { w: number; d: number } };
  /** A new column: rectangular (w × d) or round (r), its rotation, and the level it reaches up to (null: this level only). */
  column: { shape: 'rect' | 'circle'; w: number; d: number; r: number; rotation: number; topLevelId: string | null };
}

export const DEFAULT_TOOL_OPTIONS: ToolOptions = { wall: { thickness: 200, height: null, alignment: 'center', single: false }, door: { width: 900, height: 2100 }, window: { width: 1200, height: 1200, sill: 900 }, shape: { kind: 'shape', filled: true }, dimension: { kind: 'aligned' }, label: { size: 250 }, nudge: 100, connector: { bottomLevelId: null, topLevelId: null }, stair: { shape: 'straight', width: 1000, turn: 'left' }, ramp: { width: 1200 }, elevator: { shaft: { w: 2000, d: 2200 }, car: { w: 1100, d: 1400 } }, column: { shape: 'rect', w: 300, d: 300, r: 150, rotation: 0, topLevelId: null } };

export interface ToolPointer {
  world: Vec2;
  screen: Vec2;
  button: number;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  /** 1 for a click, 2 for the second click of a double click. */
  clicks: number;
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
  /** The selection changed (by a click, a prune, the host). */
  selectionChanged?(): void;
  /** Entities the tool draws itself right now (a drag preview), left out of the joined walls. */
  excluded?(): ReadonlySet<string>;
  /** Draws the preview; the context is in world space, `frame` has the camera and theme. */
  draw?(ctx: CanvasRenderingContext2D, frame: RenderFrame): void;
  /** A one-line hint for the footer. */
  hint(): string;
  /** True while the tool waits for a point that can be typed instead of clicked. */
  acceptsTyped?(): boolean;
  /** A coordinate typed into the dynamic input (`coord` is null when the text is not one; a tool may still read `text`, e.g. as an angle). True when it was used. */
  typed?(text: string, coord: Coordinate | null, cursor: Vec2 | null): boolean;
}
