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

  // The library module.
  'library.info': 'موقع المكتبة',
  'project.list': 'قائمة المشاريع',
  'project.tags': 'وسوم المشاريع',
  'project.current': 'المشروع الحالي',
  'project.create': 'مشروع جديد',
  'project.open': 'فتح مشروع',
  'project.close': 'إغلاق المشروع',
  'project.update': 'إعادة تسمية المشروع',
  'project.duplicate': 'تكرار المشروع',
  'project.trash': 'نقل المشروع إلى سلة المحذوفات',
  'project.restore': 'استعادة المشروع من سلة المحذوفات',
  'project.delete': 'حذف المشروع نهائيًا',
  'library.trash.empty': 'إفراغ سلة المحذوفات',
  'project.export': 'تصدير المشروع',
  'project.import': 'استيراد مشروع',
  'library.move': 'نقل المكتبة',
  'project.save': 'حفظ المشروع الآن',
  'project.snapshot.list': 'قائمة النسخ المحفوظة',
  'project.snapshot.create': 'حفظ نسخة',
  'project.snapshot.restore': 'استعادة نسخة محفوظة',
  'project.snapshot.delete': 'حذف نسخة محفوظة',

  // The exchange module.
  'export.plan': 'تصدير رسم المخطط',
  'export.building': 'تصدير المبنى بصيغة glTF',
  'export.image': 'تصدير صورة (PNG)',
  'import.dxf.probe': 'فحص ملف DXF',
  'import.dxf': 'استيراد DXF',

  // The plan module.
  'plan.query': 'البحث عن عناصر',
  'plan.describe': 'وصف التصميم',
  'view.snapshot': 'لقطة لطابق أو للمبنى',
  'plan.layer.add': 'إضافة طبقة',
  'plan.layer.update': 'تعديل طبقة',
  'plan.layer.move': 'إعادة ترتيب طبقة',
  'plan.layer.remove': 'إزالة طبقة',
  'plan.wall.add': 'إضافة جدران',
  'plan.opening.add': 'إضافة باب أو نافذة',
  'plan.room.add': 'إضافة غرفة',
  'plan.room.detect': 'اكتشاف الغرف',
  'plan.rooms': 'قائمة الغرف ومساحاتها',
  'plan.slab': 'وصف بلاطة أرضية الطابق',
  'plan.shape.add': 'إضافة شكل',
  'plan.dimension.add': 'إضافة بُعد',
  'plan.dimensions': 'قائمة الأبعاد وقيمها',
  'plan.transform': 'نقل العناصر أو تدويرها أو عكسها أو نسخها',
  'plan.entity.add': 'إضافة عنصر',
  'plan.entity.update': 'تعديل عنصر',
  'plan.path.vertex.move': 'تحريك ركن',
  'plan.path.vertex.insert': 'إضافة ركن',
  'plan.path.vertex.remove': 'إزالة ركن',
  'plan.path.segment.set': 'تقويم مقطع أو تقويسه',
  'plan.path.corner.set': 'تقويس ركن أو شطفه',
  'plan.entity.delete': 'حذف عناصر',
  'plan.apply': 'تطبيق تعديلات كثيرة دفعة واحدة',

  // The building module.
  'building.get': 'وصف المبنى',
  'building.level.add': 'إضافة طابق',
  'building.level.update': 'تعديل طابق',
  'building.level.duplicate': 'تكرار طابق',
  'building.level.move': 'إعادة ترتيب طابق',
  'building.level.impact': 'ما تزيله إزالة طابق',
  'building.level.remove': 'إزالة طابق',
  'building.connector.add': 'إضافة درج أو منحدر أو سلّم أو مصعد أو سلّم متحرك',
  'building.connector.update': 'تعديل عنصر حركة رأسية',
  'building.connector.remove': 'إزالة عنصر حركة رأسية',

  // The rules module.
  'rules.check': 'فحص التصميم وفق قواعده',

  // The decor module.
  'catalog.search': 'البحث في الكتالوج',
  'catalog.get': 'عنصر من الكتالوج',
  'catalog.import': 'استيراد نموذج',
  'catalog.remove': 'إزالة نموذج من الكتالوج',
  'decor.material.set': 'تعيين تشطيب',
  'decor.light.add': 'إضافة مصدر إضاءة',
  'decor.item.place': 'وضع قطعة أثاث',

  // The edit module.
  'edit.undo': 'تراجع',
  'edit.redo': 'إعادة',
  'edit.history': 'سجل التغييرات',
};
