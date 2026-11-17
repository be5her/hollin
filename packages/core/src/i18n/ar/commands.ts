/**
 * Arabic titles of the commands, by command id, for the palette and the assistant's tool cards. The
 * English title is the one the command is defined with, and agents always read that one (with the
 * English description). `packages/modules/commands-i18n.test.ts` fails when a command the palette
 * shows has no title here.
 */
export const arCommandTitles: Record<string, string> = {
  // The host's own commands (src/main/host-commands.ts).
  'app.info': 'معلومات التطبيق',
  'app.language': 'لغة التطبيق',
  'config.get': 'قراءة الإعدادات',
  'config.update': 'تغيير الإعدادات',
  'command.schema': 'مخطط مدخلات الأمر',
  'mcp.status': 'حالة خادم MCP',
  'mcp.restart': 'إعادة تشغيل خادم MCP',
  'mcp.calls': 'آخر استدعاءات MCP',
  'app.pickFile': 'اختيار ملف',
  'app.pickSavePath': 'اختيار مكان الحفظ',
  'app.pickFolder': 'اختيار مجلد',
  'app.revealPath': 'الإظهار في المجلد',
  'window.titleBarColors': 'تلوين أزرار النافذة',

  // The settings module.
  'ai.key.status': 'حالة مفتاح API للمساعد',
  'ai.key.set': 'تعيين مفتاح API للمساعد',
  'ai.key.clear': 'إزالة مفتاح API للمساعد',
};
