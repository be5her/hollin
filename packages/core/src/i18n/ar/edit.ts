import type { edit as source } from '../en/edit';
import type { Message } from '../message';

export const edit = {
  'edit.title': 'السجل',
  'edit.group': 'تحرير',
  'edit.undo': 'تراجع',
  'edit.redo': 'إعادة',
  'edit.waiting': 'Otto · ينتظر موافقتك',
  'edit.entry': '{label}، {signature}. اضغط Enter لتحديده في المخطط، أو انقر نقرًا مزدوجًا للتراجع حتى هذا التغيير.',
  'edit.entryHint': 'انقر لتحديد ما غيّره، وانقر نقرًا مزدوجًا للتراجع حتى هنا',
  'edit.empty': 'لا توجد تغييرات بعد. كل ما تغيّره أنت أو Otto أو أحد الوكلاء يظهر هنا ويمكن التراجع عنه.',
  'edit.author.user': 'أنت',
  'edit.author.mcp': 'MCP · {name}',
} satisfies Record<keyof typeof source, Message>;
