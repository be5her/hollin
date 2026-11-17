import type { Message } from '../message';
import { common } from './common';
import { edit } from './edit';
import { exchange } from './exchange';
import { library } from './library';
import { settings } from './settings';
import { shell } from './shell';
import { updates } from './updates';

/**
 * The English catalog, the source of every key: one file per area, merged here. A key is
 * `<area>.<what>` in camel case segments (`settings.language.label`), and no two areas share a prefix.
 */
export const en = {
  ...common,
  ...shell,
  ...settings,
  ...library,
  ...exchange,
  ...updates,
  ...edit,
} as const satisfies Record<string, Message>;

export type MessageKey = keyof typeof en;
