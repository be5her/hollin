import type { updates as source } from '../en/updates';
import type { Message } from '../message';

// Versions and dates sit between left-to-right isolates (U+2066 … U+2069): `0.2.0-beta.2` must not reorder.

export const updates = {
  'updates.title': 'التحديثات',
  'updates.note': 'تأتي الإصدارات الجديدة من صفحة إصدارات التطبيق، ولا يُنزَّل شيء ولا يُثبَّت حتى تطلب ذلك.',
  'updates.check': 'التحقق من وجود تحديثات',
  'updates.download': 'تنزيل',
  'updates.install': 'إعادة التشغيل والتثبيت',
  'updates.notes': 'ما الجديد في \u2066{version}\u2069',
  'updates.auto': 'التحقق من وجود تحديثات عند بدء التطبيق',
  'updates.beta': 'الحصول على الإصدارات التجريبية',
  'updates.betaNote': 'الإصدارات التجريبية معاينات للإصدار القادم تصدر قبل اكتماله. عند إيقاف الخيار، يبقى الإصدار التجريبي المثبّت لديك حتى يصدر إصدار مستقر أحدث.',

  'updates.state.lastChecked': 'آخر تحقق: \u2068{at}\u2069',
  'updates.state.notChecked': 'لم يتم التحقق بعد',
  'updates.state.checking': 'جارٍ التحقق…',
  'updates.state.available': 'الإصدار \u2066{version}\u2069 متاح',
  'updates.state.upToDate': 'لديك أحدث إصدار (آخر تحقق: \u2068{at}\u2069)',
  'updates.state.downloading': 'جارٍ التنزيل \u2066{progress} %\u2069',
  'updates.state.ready': 'الإصدار \u2066{version}\u2069 جاهز للتثبيت، ويُثبَّت أيضًا عند إغلاق التطبيق.',
  'updates.state.error': 'حدث خطأ ما.',
  'updates.state.unsupported': 'التحديثات غير متاحة في هذه النسخة من التطبيق: {reason}',
  'updates.state.noFeed': 'لا يوجد مصدر للتحديثات',

  'updates.reason.development': 'هذه نسخة تطوير',
  'updates.reason.noFeed': 'ليس لهذه النسخة مصدر للتحديثات (لا يتوفر إلا في النسخ المنشورة)',
  'updates.reason.notInstalled': 'التطبيق لا يعمل من ملف AppImage الخاص به ولا من حزمة مثبّتة',
  'updates.reason.unsignedMac': 'نسخة macOS هذه غير موقَّعة، ولا يثبّت macOS التحديثات إلا في تطبيق موقَّع',
  'updates.error.detail': 'تعذّر التحديث: \u2066{detail}\u2069',
  'updates.error.checkFailed': 'تعذّر التحقق من وجود تحديثات.',
  'updates.error.downloadFailed': 'تعذّر التنزيل.',
  'updates.error.installFailed': 'تعذّر تثبيت التحديث.',
  'updates.error.installFailedWith': 'تعذّر تثبيت التحديث: \u2066{detail}\u2069',

  'updates.toast.ready': 'الإصدار \u2066{version}\u2069 جاهز للتثبيت',
  'updates.toast.settings': 'الإعدادات',
} satisfies Record<keyof typeof source, Message>;
