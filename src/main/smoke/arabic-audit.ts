import type { Smoke } from './harness';

/**
 * Latin words an Arabic screen may show anywhere: the names that stay Latin, unit symbols, file formats,
 * the font and library credits About lists, the model and provider names, and words of a few fixed
 * examples. Anything else in Latin letters on an Arabic screen is English left behind. User data (project,
 * level, layer and model names, tags, chat messages, paths, ids) is not checked: it sits in an element with
 * `dir="auto"` or `dir="ltr"` (or `.bidi-ltr`, `code`, `kbd`, `bdi`, `[data-user-text]` in an SVG), which is
 * where `docs/i18n.md` puts it. Key names are not on this list: they pass only inside a `kbd`, a
 * left-to-right island or between isolates (`Home`, `End`, `Delete`, `Space` are English words too).
 */
export const LATIN_ALLOWED = [
  // Names.
  'Hollin', 'Otto', 'Claude', 'Code', 'API', 'MCP', 'Anthropic', 'Opus', 'Sonnet', 'Haiku', 'Fable',
  // Units and symbols.
  'mm', 'cm', 'm', 'ft', 'in', 'lm', 'px', 'K',
  // Formats and things named by their format.
  'PDF', 'SVG', 'DXF', 'PNG', 'GLB', 'glTF', 'JSON', 'ZIP', 'AutoCAD', 'CAD',
  // A4, A3 … paper sizes and the like are letter-and-digit codes (allowed below).
  // About's credits and runtime.
  'Alegreya', 'Sans', 'IBM', 'Plex', 'Mono', 'Fraunces', 'Arabic', 'Markazi', 'Lucide', 'three.js', 'Electron', 'Chromium', 'OFL', 'MIT', 'ISC', 'win32', 'darwin', 'linux',
  // The MCP clients Settings gives snippets for, their transport, and the icon set Lucide derives from.
  'Cursor', 'VS', 'Streamable', 'HTTP', 'Feather',
  // Notation: the coordinate entry's relative offsets (`@dx,dy`), the key field's prefix.
  'dx', 'dy', 'sk-ant',
];

/** Names of two words whose second is an English word too: allowed only whole. */
export const LATIN_PHRASES = ['Claude Desktop', 'Markazi Text'];

/** Paper sizes with no Arabic name (Arabic software writes them so): allowed only in the export dialog's sheet select. */
const PAPER_NAMES = ['Letter', 'Tabloid', 'Legal'];

export interface AuditFinding {
  kind: 'english' | 'reversed' | 'not-isolated';
  where: string;
  text: string;
}

/**
 * Runs in the page (injected with `toString()`, so it may use nothing from outside itself): the visible
 * text and the `title`, `aria-label`, `placeholder` and `alt` of visible elements, and every native
 * `<option>`, checked for English left behind, for measurements and shortcuts drawn reversed in right-to-left
 * text (`mm 3600`, `K Ctrl`), and for plain strings (options, attributes) that hold Arabic and a measurement
 * without isolating it.
 */
function auditPage(allowed: string[], phrases: string[], paperNames: string[]): AuditFinding[] {
  const allow = new Set(allowed);
  const findings: AuditFinding[] = [];
  const seen = new Set<string>();
  const add = (f: AuditFinding) => {
    const key = `${f.kind}|${f.text}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push(f);
  };
  // Where people's own text, ids, paths, versions and other left-to-right islands live.
  // An SVG's text is checked (the section's words), except what people wrote in it (`data-user-text`); text marked as another language (`lang="en"`: the wordmark, a language's own name) is not Arabic interface text.
  const USER = '[dir=auto], [dir=ltr], .bidi-ltr, code, kbd, bdi, pre, [data-user-text], [lang]:not([lang|=ar]), canvas, script, style, noscript, x-wordmark, [data-testid=toast-detail]';
  const ARABIC = /[\u0600-\u06ff]/;
  const MEASURE = /\d[\d.,]*(?:\u00a0|\s)?(?:mm|cm|m²|m|ft|in|lm|°|%)(?![A-Za-z])/g;
  const describe = (el: Element) => {
    const id = el.closest('[data-testid]')?.getAttribute('data-testid');
    return `${el.tagName.toLowerCase()}${id ? `@${id}` : ''}`;
  };
  // `shown`: laid out and not hidden. Text must also be opaque; a control revealed on hover (opacity 0 until then) has its `title` and `aria-label` checked all the same.
  const visible = (el: Element, shown = false) => {
    if (!(el instanceof HTMLElement) && !(el instanceof SVGElement)) return false;
    if (el.getClientRects().length === 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none' && (shown || Number(style.opacity) > 0.01);
  };
  // Words people wrote may come back in a tooltip or a label: only in the element that holds them (its own user text or value).
  const userWordsOf = (el: Element) => {
    const words = new Set<string>();
    const take = (text: string) => {
      for (const w of text.match(/[A-Za-z][\w'’.-]*/g) ?? []) words.add(w);
    };
    for (const u of [el.closest(USER), ...el.querySelectorAll(USER)]) if (u) take(u.textContent ?? '');
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) take(el.value ?? '');
    return words;
  };
  // A word: Latin letters, digits and the joiners of names (three.js, sk-ant-), but not `+`, which joins keys (Ctrl+Z).
  const WORD = /[A-Za-z][\w'’.-]*/g;
  const fine = (word: string) => {
    const w = word.replace(/[.,:;!?)…-]+$/, '');
    return !w || allow.has(w) || /\d/.test(w) || /^[A-Za-z]$/.test(w) || w.includes('.') || w.includes('_');
  };
  // What sits between isolates in a plain string is an island the message put there: a path, a version, a name.
  const outsideIsolates = (text: string) => {
    let out = '';
    let depth = 0;
    for (const ch of text) {
      if (ch === '\u2066' || ch === '\u2067' || ch === '\u2068') depth++;
      else if (ch === '\u2069') depth = Math.max(0, depth - 1);
      else if (depth === 0) out += ch;
      else out += ' ';
    }
    return out;
  };
  const english = (text: string, where: string, extra = new Set<string>()) => {
    // A value that never got its text is a bug in any language, island or not.
    if (/\b(undefined|null|NaN)\b|\[object /.test(text)) add({ kind: 'english', where, text: `undefined ← ${text.trim().slice(0, 120)}` });
    let outside = outsideIsolates(text);
    for (const phrase of phrases) outside = outside.split(phrase).join(' ');
    const words = outside.match(WORD) ?? [];
    const bad = words.filter((w) => !fine(w) && !extra.has(w.replace(/[.,:;!?)…-]+$/, '')));
    if (bad.length) add({ kind: 'english', where, text: `${bad.join(' ')} ← ${text.trim().slice(0, 120)}` });
  };
  const isolated = (text: string, index: number) => {
    const before = text.slice(0, index);
    const open = Math.max(before.lastIndexOf('\u2066'), before.lastIndexOf('\u2068'));
    return open > before.lastIndexOf('\u2069');
  };
  const plain = (text: string, where: string) => {
    if (!ARABIC.test(text)) return;
    for (const m of text.matchAll(MEASURE)) if (!isolated(text, m.index ?? 0)) add({ kind: 'not-isolated', where, text: text.trim().slice(0, 120) });
  };

  // Visible text.
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node.textContent ?? '';
    if (!text.trim()) continue;
    const el = node.parentElement;
    if (!el || el.closest(USER) || !visible(el)) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    if (range.getClientRects().length === 0) continue;
    english(text, describe(el));
    if (getComputedStyle(el).direction !== 'rtl') continue;
    // A measurement or a shortcut in right-to-left text: its first character must be drawn left of its last.
    const order = (m: RegExpMatchArray, last: number) => {
      const at = (i: number) => {
        const r = document.createRange();
        r.setStart(node!, i);
        r.setEnd(node!, i + 1);
        return r.getBoundingClientRect().x;
      };
      const i = m.index ?? 0;
      if (at(i) > at(i + last)) add({ kind: 'reversed', where: describe(el), text: `${m[0]} ← ${text.trim().slice(0, 120)}` });
    };
    for (const m of text.matchAll(MEASURE)) order(m, m[0].length - 1);
    for (const m of text.matchAll(/(?:Ctrl|Cmd|Shift|Alt)\+[\w,.]+/g)) order(m, m[0].length - 1);
  }
  // A field holding a measurement must read left to right, or `3000 mm` shows as `mm 3000`.
  for (const input of document.querySelectorAll('input:not([type]), input[type=text], input[type=number]')) {
    const value = (input as HTMLInputElement).value;
    if (!visible(input) || !value) continue;
    MEASURE.lastIndex = 0;
    if (MEASURE.test(value) && getComputedStyle(input).direction === 'rtl') add({ kind: 'reversed', where: describe(input), text: `${value} ← a right-to-left field` });
  }
  // Attributes a person hears or sees on hover, and native options.
  for (const el of document.querySelectorAll('[title], [aria-label], [placeholder], [alt]')) {
    if (!visible(el, true)) continue;
    const userWords = userWordsOf(el);
    for (const name of ['title', 'aria-label', 'placeholder', 'alt']) {
      const value = el.getAttribute(name);
      if (!value) continue;
      english(value, `${describe(el)}[${name}]`, userWords);
      plain(value, `${describe(el)}[${name}]`);
    }
  }
  for (const option of document.querySelectorAll('option')) {
    const select = option.closest('select');
    if (!select || !visible(select)) continue;
    // An option is user text when its select reads by its own text (a level's name) or is a left-to-right field.
    const papers = select.getAttribute('data-testid') === 'export-page' ? new Set(paperNames) : new Set<string>();
    if (!select.closest('[dir=ltr], .bidi-ltr') && select.getAttribute('dir') !== 'auto' && !option.closest(USER)) english(option.textContent ?? '', `${describe(select)} option`, papers);
    plain(option.textContent ?? '', `${describe(select)} option`);
  }
  return findings;
}

/**
 * Checks what an Arabic screen shows (`auditPage`): no English left, no measurement or shortcut reversed,
 * no measurement unisolated in a plain string. A real check, run at every screen the Arabic walk looks at.
 */
export async function auditArabic(smoke: Smoke, where: string): Promise<AuditFinding[]> {
  const findings = await smoke.js<AuditFinding[]>(`(${auditPage.toString()})(${JSON.stringify(LATIN_ALLOWED)}, ${JSON.stringify(LATIN_PHRASES)}, ${JSON.stringify(PAPER_NAMES)})`);
  smoke.check(`${where}: Arabic throughout, no English left, nothing reversed`, findings.length === 0, findings);
  return findings;
}

/** Audits an Arabic screen and takes its screenshots, light and dark. */
export async function lookArabic(smoke: Smoke, name: string, where = name): Promise<void> {
  await auditArabic(smoke, where);
  await smoke.shots(name);
}
