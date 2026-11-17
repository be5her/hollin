import type { labels as source } from '../en/labels';
import type { Message } from '../message';

// History labels: short verbal nouns, as the tools' own (`tools.history.*`) are. `{what}` is an
// indefinite noun from `tools.noun.*` ("إضافة جدار"); a name people wrote sits in «…» between
// U+2068 … U+2069.

export const labels = {
  'labels.add': 'إضافة {what}',
  'labels.change': 'تعديل {what}',
  'labels.remove': 'إزالة {what}',
  'labels.delete': 'حذف {what}',
  'labels.move': 'تحريك {what}',
  'labels.copy': 'نسخ {what}',
  'labels.rotate': 'تدوير {what}',
  'labels.mirror': 'عكس {what}',
  'labels.nudge': 'إزاحة {what}',
  'labels.items': { zero: '{count} عنصر', one: 'عنصر واحد', two: 'عنصرين', few: '{count} عناصر', many: '{count} عنصرًا', other: '{count} عنصر' },

  'labels.corner.move': 'تحريك ركن {what}',
  'labels.corner.add': 'إضافة ركن إلى {what}',
  'labels.corner.remove': 'إزالة ركن من {what}',
  'labels.corner.round': 'تقويس ركن {what}',
  'labels.corner.chamfer': 'شطف ركن {what}',
  'labels.corner.sharpen': 'جعل ركن {what} حادًا',
  'labels.segment.change': 'تعديل ضلع من {what}',

  'labels.wall.addMany': { zero: 'إضافة {count} جدار', one: 'إضافة جدار واحد', two: 'إضافة جدارين', few: 'إضافة {count} جدران', many: 'إضافة {count} جدارًا', other: 'إضافة {count} جدار' },
  'labels.room.add': 'إضافة غرفة',
  'labels.room.detect': 'اكتشاف الغرف',
  'labels.shape.add': 'إضافة شكل',
  'labels.dimension.add': 'إضافة بُعد',

  'labels.level.add': 'إضافة طابق',
  'labels.level.addNamed': 'إضافة الطابق «\u2068{name}\u2069»',
  'labels.level.change': 'تعديل الطابق «\u2068{name}\u2069»',
  'labels.level.duplicate': 'تكرار الطابق «\u2068{name}\u2069»',
  'labels.level.move': 'نقل الطابق «\u2068{name}\u2069»',
  'labels.level.remove': 'إزالة الطابق «\u2068{name}\u2069»',

  'labels.layer.add.structure': 'إضافة طبقة إنشائية',
  'labels.layer.add.interior': 'إضافة طبقة داخلية',
  'labels.layer.add.decor': 'إضافة طبقة ديكور',
  'labels.layer.show': 'إظهار «\u2068{name}\u2069»',
  'labels.layer.hide': 'إخفاء «\u2068{name}\u2069»',
  'labels.layer.lock': 'قفل «\u2068{name}\u2069»',
  'labels.layer.unlock': 'فتح قفل «\u2068{name}\u2069»',
  'labels.layer.change': 'تعديل الطبقة «\u2068{name}\u2069»',
  'labels.layer.reorder': 'إعادة ترتيب الطبقات',
  'labels.layer.remove': 'إزالة الطبقة «\u2068{name}\u2069»',

  'labels.place': 'وضع \u2068{name}\u2069',
  'labels.light.point': 'إضافة إضاءة نقطية',
  'labels.light.spot': 'إضافة إضاءة موجّهة',
  'labels.light.area': 'إضافة لوح إضاءة',
  'labels.finish.wall.left': 'تشطيب الجدار (الوجه الأيسر): \u2068{what}\u2069',
  'labels.finish.wall.right': 'تشطيب الجدار (الوجه الأيمن): \u2068{what}\u2069',
  'labels.finish.walls': 'تشطيب جدران «\u2068{name}\u2069»: \u2068{what}\u2069',
  'labels.finish.floor': 'تشطيب أرضية «\u2068{name}\u2069»: \u2068{what}\u2069',
  'labels.finish.ceiling': 'تشطيب سقف «\u2068{name}\u2069»: \u2068{what}\u2069',
  'labels.finish.nothing': 'بلا تشطيب',

  'labels.import': 'استيراد \u2066{name}\u2069',
  'labels.projectDetails': 'تفاصيل المشروع',
} satisfies Record<keyof typeof source, Message>;
