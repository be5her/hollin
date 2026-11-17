import type { MessageKey } from '../en';
import type { Message } from '../message';
import { common } from './common';
import { settings } from './settings';
import { shell } from './shell';

/** The Arabic catalog: the same areas and keys as English (a missing or extra key is a type error in its area's file). */
export const ar: Record<MessageKey, Message> = {
  ...common,
  ...shell,
  ...settings,
};
