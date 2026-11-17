import type { defaults as source } from '../en/defaults';
import type { Message } from '../message';

// Default names follow the glossary (طابق، قبو، ميزانين، طبقة إنشائية / داخلية / ديكور، غرفة، نسخة
// محفوظة). They are stored in documents and the library, so they carry no Unicode isolates (the places
// that show them set `dir="auto"`); only the author labels, which are shown and never stored, do.

export const defaults = {
  'defaults.level.ground': 'الطابق الأرضي',
  'defaults.level.numbered': 'الطابق {n}',
  'defaults.level.basement': 'القبو {n}',
  'defaults.level.mezzanine': 'ميزانين',
  'defaults.layer.structure': 'إنشائية',
  'defaults.layer.interior': 'داخلية',
  'defaults.layer.decor': 'ديكور',
  'defaults.layer.numbered': '{name} {n}',
  'defaults.room': 'غرفة {n}',
  'defaults.lampLight': 'إضاءة {name}',
  'defaults.copy': '{name} (نسخة)',
  'defaults.snapshot.named': 'نسخة محفوظة',
  'defaults.snapshot.beforeUpgrade': 'قبل الترقية من الصيغة {format}',
  'defaults.snapshot.beforeRestore': 'قبل استعادة «{name}»',
  'defaults.snapshot.beforeEditing': 'قبل التعديل ({when})',
  'defaults.snapshot.beforeBatch': 'قبل «{label}»',
  'defaults.author.app': 'التطبيق',
  'defaults.author.assistant': 'المساعد',
  'defaults.author.assistantModel': 'المساعد (\u2066{name}\u2069)',
  'defaults.author.mcp': 'MCP · \u2068{name}\u2069',
  'defaults.author.unknownAgent': 'وكيل غير معروف',
} satisfies Record<keyof typeof source, Message>;
