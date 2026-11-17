import type { MessageKey } from '../en';
import type { Message } from '../message';
import { common } from './common';
import { edit } from './edit';
import { exchange } from './exchange';
import { library } from './library';
import { settings } from './settings';
import { shell } from './shell';
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
};
