import type { rules as source } from '../en/rules';
import type { Message } from '../message';

// A length, a percentage or a size inside a warning sits between U+2066 … U+2069 (left to right); a name
// people wrote (a level, a room, a connector) between U+2068 … U+2069. A connector is masculine in every
// kind (درج، سلّم، منحدر، مصعد، سلّم متحرك), so "its" (ـه) agrees with whichever one a warning is about.

export const rules = {
  'rules.title': 'التحذيرات',
  'rules.panel.warnings': 'التحذيرات',
  'rules.none': 'لا توجد تحذيرات',
  'rules.noneHint': 'الأدراج والمنحدرات والمصاعد والفتحات والغرف ضمن القواعد المحددة في الإعدادات.',
  'rules.count': { zero: '{count} تحذير', one: 'تحذير واحد', two: 'تحذيران', few: '{count} تحذيرات', many: '{count} تحذيرًا', other: '{count} تحذير' },
  'rules.group.building': 'المبنى',
  'rules.group.level': 'طابق',

  'rules.connector': '\u2068{name}\u2069: {detail}',
  'rules.kind.stair': 'الدرج',
  'rules.kind.ladder': 'السلّم',
  'rules.kind.ramp': 'المنحدر',
  'rules.kind.elevator': 'المصعد',
  'rules.kind.escalator': 'السلّم المتحرك',
  'rules.break.inverted': 'نهايته العليا ليست أعلى من بدايته (يرتفع \u2066{rise}\u2069).',
  'rules.break.tooFewRisers': 'عدد القوائم ({risers}) لا يكفي لعدد القلبات ({flights}).',
  'rules.break.riserHigh': 'ارتفاع القائمة \u2066{height}\u2069 يتجاوز الحد الأقصى \u2066{limit}\u2069.',
  'rules.break.riserLow': 'ارتفاع القائمة \u2066{height}\u2069 دون الحد الأدنى \u2066{limit}\u2069.',
  'rules.break.treadShort': 'عمق النائمة \u2066{depth}\u2069 دون الحد الأدنى \u2066{limit}\u2069.',
  'rules.break.comfort': 'ضعف القائمة مع النائمة \u2066{step}\u2069، خارج المدى \u2066{range}\u2069.',
  'rules.break.tooNarrow': 'عرضه \u2066{width}\u2069، أضيق من الحد الأدنى \u2066{limit}\u2069.',
  'rules.break.straightTurns': 'الدرج المستقيم يمتد على خط واحد، لكن خط مسيره ينعطف.',
  'rules.break.lTurns': 'الدرج على شكل L ينعطف مرة واحدة، لكن عدد انعطافات خط مسيره {count}.',
  'rules.break.uTurns': 'الدرج على شكل U يرتدّ على نفسه عند ركنين.',
  'rules.break.winderCorner': 'الدرج المروحي يحتاج إلى ركن يلتف حوله.',
  'rules.break.curvedStraight': 'الدرج المنحني يتبع قوسًا، لكن خط مسيره مستقيم.',
  'rules.break.spiralStraight': 'الدرج الحلزوني يتبع قوسًا، لكن خط مسيره مستقيم.',
  'rules.break.walkCrosses': 'خط مسيره يتقاطع مع نفسه.',
  'rules.break.tooSteep': 'ميله \u2066{slope} %\u2069 أشد من الحد الأقصى \u2066{limit} %\u2069.',
  'rules.break.axisCrosses': 'محوره يتقاطع مع نفسه.',
  'rules.break.stopOffStack': 'يتوقف عند «\u2068{level}\u2069»، وهو ميزانين ليس ضمن تسلسل الطوابق.',
  'rules.break.stopsSameElevation': 'توقفان من توقفاته على المنسوب نفسه (\u2066{elevation}\u2069).',
  'rules.break.carTooBig': 'كابينته (\u2066{carW} × {carD}\u2069) لا تتسع داخل بئره (\u2066{shaftW} × {shaftD}\u2069).',

  'rules.misfit.door': 'الباب لا يتّسع له جداره في \u2068{level}\u2069',
  'rules.misfit.window': 'النافذة لا يتّسع لها جدارها في \u2068{level}\u2069',
  'rules.misfit.opening': 'الفتحة لا يتّسع لها جدارها في \u2068{level}\u2069',
  'rules.crosses': 'مسار {type} يتقاطع مع نفسه في \u2068{level}\u2069',
  'rules.crossesNamed': 'مسار {type} «\u2068{name}\u2069» يتقاطع مع نفسه في \u2068{level}\u2069',
  'rules.type.wall': 'الجدار',
  'rules.type.shape': 'الشكل',
  'rules.type.separator': 'الفاصل',
  'rules.type.slab': 'البلاطة',
  'rules.type.room': 'الغرفة',
  'rules.type.void': 'الفراغ',
  'rules.type.shaft': 'البئر',
  'rules.type.outline': 'المحيط',
  'rules.roomOpen': 'الغرفة «\u2068{name}\u2069» في \u2068{level}\u2069 غير مغلقة',
  'rules.uncovered': '\u2068{name}\u2069 يمر عبر \u2068{level}\u2069 خارج بلاطة الطابق',
  'rules.noSlab': '\u2068{name}\u2069 يمر عبر \u2068{level}\u2069، وهو طابق بلا بلاطة',
} satisfies Record<keyof typeof source, Message>;
