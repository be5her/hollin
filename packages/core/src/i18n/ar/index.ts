import type { MessageKey } from '../en';
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

/** The Arabic catalog: the same areas and keys as English (a missing or extra key is a type error in its area's file). */
export const ar: Record<MessageKey, Message> = {
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
};
