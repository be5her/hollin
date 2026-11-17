import type { Message } from '../message';
import { building } from './building';
import { builtin } from './builtin';
import { common } from './common';
import { decor } from './decor';
import { edit } from './edit';
import { exchange } from './exchange';
import { library } from './library';
import { plan } from './plan';
import { rules } from './rules';
import { settings } from './settings';
import { shell } from './shell';
import { tools } from './tools';
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
  ...plan,
  ...tools,
  ...building,
  ...rules,
  ...decor,
  ...builtin,
} as const satisfies Record<string, Message>;

export type MessageKey = keyof typeof en;
