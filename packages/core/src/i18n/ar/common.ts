import type { common as source } from '../en/common';
import type { Message } from '../message';

export const common = {
  'common.ok': 'موافق',
  'common.cancel': 'إلغاء',
  'common.close': 'إغلاق',
  'common.confirm': 'تأكيد',
  'common.dismiss': 'تجاهل',
  'common.copy': 'نسخ',
  'common.copied': 'تم النسخ',
  'common.copyFailed': 'تعذّر النسخ إلى الحافظة',
  'common.justNow': 'الآن',
  'common.appDescription': 'صمّم المباني والمخططات والمساحات الداخلية والديكور، مع ذكاء اصطناعي مدمج.',
  'common.lengthInvalid': `ليس طولًا صالحًا (جرّب 3200 أو 3.2m أو 10' 6")`,
  'common.angleInvalid': 'ليست زاوية صالحة (جرّب 45 أو 30°)',
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
