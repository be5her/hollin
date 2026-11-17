import { BRANDING } from '../../branding';

/** Words many places share. A key here is used by more than one area; a string used once lives in its area's file. */
export const common = {
  'common.ok': 'OK',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.confirm': 'Confirm',
  'common.dismiss': 'Dismiss',
  'common.copy': 'Copy',
  'common.copied': 'Copied',
  'common.copyFailed': 'Could not copy to the clipboard',
  'common.justNow': 'just now',
  /** The product's one-line description; English is the one in branding.json. */
  'common.appDescription': BRANDING.description,
  'common.lengthInvalid': `Not a length (try 3200, 3.2m or 10' 6")`,
  'common.angleInvalid': 'Not an angle (try 45 or 30°)',
  /** Otto's standing rule, as the assistant panel's header and Settings say it. */
  'common.ottoRule': 'asks before deleting',
  /** Claude Code's effort level after the model, as the assistant panel shows it: "high effort". */
  'common.effort': '{effort} effort',
  'common.effort.low': 'low',
  'common.effort.medium': 'medium',
  'common.effort.high': 'high',
  'common.effort.xhigh': 'xhigh',
  'common.effort.max': 'max',
  /** How Otto reaches Claude, in the words of Settings' provider choice (by `AI_PROVIDERS` id). */
  'common.provider.api': 'Claude API, with your key',
  'common.provider.claude-code': 'Claude Code, your local install',
} as const;
