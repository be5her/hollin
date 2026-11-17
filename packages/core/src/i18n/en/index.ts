import type { Message } from '../message';
import { building } from './building';
import { assistant } from './assistant';
import { builtin } from './builtin';
import { common } from './common';
import { decor } from './decor';
import { defaults } from './defaults';
import { edit } from './edit';
import { errors } from './errors';
import { exchange } from './exchange';
import { labels } from './labels';
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
  ...errors,
  ...labels,
  ...defaults,
  ...assistant,
} as const satisfies Record<string, Message>;

export type MessageKey = keyof typeof en;
