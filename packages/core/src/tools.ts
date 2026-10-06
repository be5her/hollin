import { z } from 'zod';
import type { AnyZodObject } from './types';

/*
 * How commands become tools, shared by the MCP server and the in-app assistant so both name and
 * describe every command the same way.
 */

/** The tool name of a command: its id with every character outside `[A-Za-z0-9_-]` replaced by `_` (`plan.wall.add` → `plan_wall_add`). */
export function toolNameFor(commandId: string): string {
  return commandId.replace(/[^A-Za-z0-9_-]/g, '_');
}

/** A command's input schema as JSON Schema (its input side, with what JSON Schema cannot express loosened to `any`). */
export function toolInputSchema(input: AnyZodObject): Record<string, unknown> {
  return z.toJSONSchema(input, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
}

/** The shape an `output: 'image'` command returns: a PNG (or other image) as base64, plus whatever else it reports. */
export interface ImageResult {
  mimeType: string;
  /** Base64, without a `data:` prefix. */
  data: string;
  [key: string]: unknown;
}

export function isImageResult(value: unknown): value is ImageResult {
  return typeof value === 'object' && value !== null && typeof (value as ImageResult).mimeType === 'string' && (value as ImageResult).mimeType.startsWith('image/') && typeof (value as ImageResult).data === 'string';
}

/** An image result split for a caller that carries images and text separately: the image, and the other fields as JSON. */
export function splitImageResult(result: ImageResult): { image: { mimeType: string; data: string }; rest: Record<string, unknown> } {
  const { mimeType, data, ...rest } = result;
  return { image: { mimeType, data }, rest };
}
