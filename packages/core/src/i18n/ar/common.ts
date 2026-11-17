import type { common as source } from '../en/common';
import type { Message } from '../message';

export const common = {
  'common.ok': 'موافق',
  'common.cancel': 'إلغاء',
  'common.close': 'إغلاق',
  'common.confirm': 'تأكيد',
  'common.dismiss': 'إغلاق',
  'common.copy': 'نسخ',
  'common.copied': 'تم النسخ',
  'common.copyFailed': 'تعذّر النسخ إلى الحافظة',
  'common.justNow': 'الآن',
  'common.listSeparator': '، ',
  'common.group.projects': 'المشاريع',
  'common.appDescription': 'صمّم المباني والمخططات والمساحات الداخلية والديكور، مع ذكاء اصطناعي مدمج.',
  'common.lengthInvalid': 'ليس طولًا صالحًا (جرّب \u20663200\u2069 أو \u20663.2m\u2069 أو \u206610\' 6"\u2069)',
  'common.angleInvalid': 'ليست زاوية صالحة (جرّب \u206645\u2069 أو \u206630°\u2069)',
  'common.ottoRule': 'يستأذن قبل الحذف',
  'common.effort': 'جهد {effort}',
  'common.effort.low': 'منخفض',
  'common.effort.medium': 'متوسط',
  'common.effort.high': 'مرتفع',
  'common.effort.xhigh': 'مرتفع جدًا',
  'common.effort.max': 'أقصى',
  'common.provider.api': 'Claude API، بمفتاحك',
  'common.provider.claude-code': 'Claude Code، المثبّت على جهازك',
} satisfies Record<keyof typeof source, Message>;
