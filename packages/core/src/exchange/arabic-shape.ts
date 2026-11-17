import { ltrIslands, hasRtl } from '../i18n/text';

/*
 * Arabic for writers that draw glyphs themselves (the PDF): shaping to the presentation forms (each
 * letter's isolated, final, initial or medial form by its neighbours' joining types, the lam-alef
 * ligatures, marks transparent and kept on their letter), and a small bidi pass that puts a line into
 * visual order for a left-to-right text operator (the Unicode bidi algorithm's weak, neutral and implicit
 * rules, isolates honoured, embeddings and marks dropped, mirrored brackets). Pure.
 */

/** [letter, its first presentation form, how many forms: 1 isolated, 2 isolated and final, 4 isolated, final, initial, medial]. */
const FORMS: readonly (readonly [number, number, 1 | 2 | 4])[] = [
  // Arabic Presentation Forms-B (U+FE80 to U+FEF4).
  [0x0621, 0xfe80, 1], [0x0622, 0xfe81, 2], [0x0623, 0xfe83, 2], [0x0624, 0xfe85, 2], [0x0625, 0xfe87, 2], [0x0626, 0xfe89, 4],
  [0x0627, 0xfe8d, 2], [0x0628, 0xfe8f, 4], [0x0629, 0xfe93, 2], [0x062a, 0xfe95, 4], [0x062b, 0xfe99, 4], [0x062c, 0xfe9d, 4],
  [0x062d, 0xfea1, 4], [0x062e, 0xfea5, 4], [0x062f, 0xfea9, 2], [0x0630, 0xfeab, 2], [0x0631, 0xfead, 2], [0x0632, 0xfeaf, 2],
  [0x0633, 0xfeb1, 4], [0x0634, 0xfeb5, 4], [0x0635, 0xfeb9, 4], [0x0636, 0xfebd, 4], [0x0637, 0xfec1, 4], [0x0638, 0xfec5, 4],
  [0x0639, 0xfec9, 4], [0x063a, 0xfecd, 4], [0x0641, 0xfed1, 4], [0x0642, 0xfed5, 4], [0x0643, 0xfed9, 4], [0x0644, 0xfedd, 4],
  [0x0645, 0xfee1, 4], [0x0646, 0xfee5, 4], [0x0647, 0xfee9, 4], [0x0648, 0xfeed, 2], [0x0649, 0xfeef, 2], [0x064a, 0xfef1, 4],
  // Presentation Forms-A for the letters Persian and Urdu add (U+FB50 to U+FBFF).
  [0x0671, 0xfb50, 2], [0x0679, 0xfb66, 4], [0x067e, 0xfb56, 4], [0x0686, 0xfb7a, 4], [0x0688, 0xfb88, 2], [0x0691, 0xfb8c, 2],
  [0x0698, 0xfb8a, 2], [0x06a4, 0xfb6a, 4], [0x06a9, 0xfb8e, 4], [0x06af, 0xfb92, 4], [0x06ba, 0xfb9e, 2], [0x06be, 0xfbaa, 4],
  [0x06c0, 0xfba4, 2], [0x06c1, 0xfba6, 4], [0x06cc, 0xfbfc, 4], [0x06d2, 0xfbae, 2],
];

/** A letter's forms, [isolated, final, initial, medial] (the last two absent for a letter that joins on its right only). */
const FORMS_OF = new Map<number, number[]>(FORMS.map(([letter, first, count]) => [letter, Array.from({ length: count }, (_, i) => first + i)]));

/** Lam followed by an alef: the ligature's [isolated, final] forms. */
const LAM_ALEF = new Map<number, [number, number]>([
  [0x0622, [0xfef5, 0xfef6]],
  [0x0623, [0xfef7, 0xfef8]],
  [0x0625, [0xfef9, 0xfefa]],
  [0x0627, [0xfefb, 0xfefc]],
]);
const LAM = 0x0644;

/** What a presentation form stands for, in logical order: its letter, or lam and alef for a ligature. */
const BASE_OF = new Map<number, string>();
for (const [letter, forms] of FORMS_OF) for (const f of forms) BASE_OF.set(f, String.fromCodePoint(letter));
for (const [alef, forms] of LAM_ALEF) for (const f of forms) BASE_OF.set(f, String.fromCodePoint(LAM, alef));

/** The letters a presentation form (or a lam-alef ligature) stands for; any other character as it is. For a PDF's ToUnicode map. */
export function presentationBase(codePoint: number): string {
  return BASE_OF.get(codePoint) ?? String.fromCodePoint(codePoint);
}

/**
 * Joining types of the Arabic block's letters (U+0620 to U+06FF) from Unicode's ArabicShaping.txt, as ranges
 * [first, last, type]; marks and format controls are transparent by their category, everything else here
 * does not join. A letter without presentation forms still joins its neighbours by its type, so a rare
 * letter (U+063B, U+06AD, U+06C6 ...) does not break the shape of the letters beside it.
 */
const JOINING_RANGES: readonly (readonly [number, number, 'R' | 'D' | 'U'])[] = [
  [0x0620, 0x0620, 'D'], [0x0621, 0x0621, 'U'], [0x0622, 0x0625, 'R'], [0x0626, 0x0626, 'D'], [0x0627, 0x0627, 'R'],
  [0x0628, 0x0628, 'D'], [0x0629, 0x0629, 'R'], [0x062a, 0x062e, 'D'], [0x062f, 0x0632, 'R'], [0x0633, 0x063f, 'D'],
  [0x0641, 0x0647, 'D'], [0x0648, 0x0648, 'R'], [0x0649, 0x064a, 'D'], [0x066e, 0x066f, 'D'], [0x0671, 0x0673, 'R'],
  [0x0674, 0x0674, 'U'], [0x0675, 0x0677, 'R'], [0x0678, 0x0687, 'D'], [0x0688, 0x0699, 'R'], [0x069a, 0x06bf, 'D'],
  [0x06c0, 0x06c0, 'R'], [0x06c1, 0x06c2, 'D'], [0x06c3, 0x06cb, 'R'], [0x06cc, 0x06cc, 'D'], [0x06cd, 0x06cd, 'R'],
  [0x06ce, 0x06ce, 'D'], [0x06cf, 0x06cf, 'R'], [0x06d0, 0x06d1, 'D'], [0x06d2, 0x06d3, 'R'], [0x06d5, 0x06d5, 'R'],
  [0x06ee, 0x06ef, 'R'], [0x06fa, 0x06fc, 'D'], [0x06ff, 0x06ff, 'D'],
];
const JOINING = new Map<number, 'R' | 'D' | 'U'>();
for (const [first, last, type] of JOINING_RANGES) for (let c = first; c <= last; c++) JOINING.set(c, type);
/** Format characters of the Arabic block that ArabicShaping marks as not joining (the number signs, the end of ayah). */
const NON_JOINING_FORMAT = new Set([0x0600, 0x0601, 0x0602, 0x0603, 0x0604, 0x0605, 0x06dd]);

/** A string from code points, in chunks: a spread of a long text's code points overflows the stack. */
function fromCodePoints(cps: readonly number[]): string {
  let out = '';
  for (let i = 0; i < cps.length; i += 4096) out += String.fromCodePoint(...cps.slice(i, i + 4096));
  return out;
}

/** A combining mark (tashkeel among them): drawn on the letter before it, transparent to joining. */
const MARK = /^[\p{Mn}\p{Me}]$/u;
/** The bidi controls, which never print: marks, embeddings, overrides and isolates. */
const BIDI_CONTROLS = /[؜‎‏‪-‮⁦-⁩]/g;

/** The text without its bidi controls (for writers whose readers may draw them as boxes). */
export function stripBidiControls(text: string): string {
  return text.replace(BIDI_CONTROLS, '');
}

type Joining = 'U' | 'R' | 'D' | 'C' | 'T';

/** A character's joining type: dual (D), right (R), join-causing (C: tatweel, ZWJ), transparent (T: marks and format controls) or none (U). */
export function joiningType(codePoint: number): Joining {
  const known = JOINING.get(codePoint);
  if (known) return known;
  const forms = FORMS_OF.get(codePoint);
  if (forms) return forms.length === 4 ? 'D' : forms.length === 2 ? 'R' : 'U';
  if (codePoint === 0x0640 || codePoint === 0x200d) return 'C';
  if (codePoint === 0x200c || NON_JOINING_FORMAT.has(codePoint)) return 'U';
  const ch = String.fromCodePoint(codePoint);
  if (MARK.test(ch) || /^\p{Cf}$/u.test(ch)) return 'T';
  return 'U';
}

/**
 * Arabic letters replaced by their presentation forms, in logical order: each letter takes the form its
 * neighbours call for (marks between them do not break a join), lam and alef become one ligature (the marks
 * on the lam following it), and a letter whose form the tables lack stays as it is.
 */
export function shapeArabic(text: string): string {
  const cps = [...text].map((c) => c.codePointAt(0)!);
  const types = cps.map(joiningType);
  const near = (from: number, step: 1 | -1) => {
    let i = from + step;
    while (i >= 0 && i < cps.length && types[i] === 'T') i += step;
    return i;
  };
  const out: number[] = [];
  for (let i = 0; i < cps.length; i++) {
    const type = types[i];
    if (type !== 'R' && type !== 'D') {
      out.push(cps[i]);
      continue;
    }
    const prev = near(i, -1);
    const joinsBefore = prev >= 0 && (types[prev] === 'D' || types[prev] === 'C');
    const next = near(i, 1);
    const nextJoins = next < cps.length && (types[next] === 'R' || types[next] === 'D' || types[next] === 'C');
    const ligature = cps[i] === LAM && next < cps.length ? LAM_ALEF.get(cps[next]) : undefined;
    if (ligature) {
      out.push(ligature[joinsBefore ? 1 : 0]);
      // The marks on the lam, then the alef's own come after it in the loop.
      for (let k = i + 1; k < next; k++) out.push(cps[k]);
      i = next;
      continue;
    }
    const joinsAfter = type === 'D' && nextJoins;
    const forms = FORMS_OF.get(cps[i]);
    // A letter the presentation forms lack is written as it is; it still joined its neighbours above.
    if (!forms) {
      out.push(cps[i]);
      continue;
    }
    const form = joinsBefore && joinsAfter ? 3 : joinsBefore ? 1 : joinsAfter ? 2 : 0;
    out.push(forms[form] ?? forms[joinsBefore ? 1 : 0] ?? cps[i]);
  }
  return fromCodePoints(out);
}

// ---------- bidi ----------

type BidiClass = 'L' | 'R' | 'AL' | 'EN' | 'ES' | 'ET' | 'AN' | 'CS' | 'NSM' | 'BN' | 'B' | 'S' | 'WS' | 'ON';

/** A character's bidi class, for the scripts and symbols the app writes (the Unicode database's, simplified outside them). */
export function bidiClass(c: number): BidiClass {
  if (c === 0x200e) return 'L';
  if (c === 0x200f) return 'R';
  if (c === 0x061c) return 'AL';
  if ((c >= 0x30 && c <= 0x39) || c === 0xb2 || c === 0xb3 || c === 0xb9 || (c >= 0x06f0 && c <= 0x06f9) || (c >= 0x2070 && c <= 0x2079) || (c >= 0x2080 && c <= 0x2089)) return 'EN';
  if ((c >= 0x0660 && c <= 0x0669) || c === 0x066b || c === 0x066c || (c >= 0x0600 && c <= 0x0605) || c === 0x06dd) return 'AN';
  if (c === 0x2b || c === 0x2d || c === 0x2212 || c === 0x207a || c === 0x207b || c === 0x208a || c === 0x208b) return 'ES';
  if (c === 0x23 || c === 0x24 || c === 0x25 || (c >= 0xa2 && c <= 0xa5) || c === 0xb0 || c === 0xb1 || c === 0x066a || (c >= 0x2030 && c <= 0x2034) || (c >= 0x20a0 && c <= 0x20cf)) return 'ET';
  if (c === 0x2c || c === 0x2e || c === 0x2f || c === 0x3a || c === 0xa0 || c === 0x060c || c === 0x202f || c === 0x2044) return 'CS';
  if (c === 0x0a || c === 0x0d || (c >= 0x1c && c <= 0x1e) || c === 0x85 || c === 0x2029) return 'B';
  if (c === 0x09 || c === 0x0b || c === 0x1f) return 'S';
  if (c === 0x20 || c === 0x0c || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x205f || c === 0x3000) return 'WS';
  if (c < 0x20 || (c >= 0x7f && c < 0xa0) || c === 0xad || (c >= 0x200b && c <= 0x200d) || (c >= 0x202a && c <= 0x202e) || (c >= 0x2060 && c <= 0x2069) || c === 0xfeff) return 'BN';
  const ch = String.fromCodePoint(c);
  if (MARK.test(ch)) return 'NSM';
  if ((c >= 0x0590 && c <= 0x05ff) || (c >= 0x07c0 && c <= 0x085f) || (c >= 0xfb1d && c <= 0xfb4f) || (c >= 0x10800 && c <= 0x10fff)) return 'R';
  if ((c >= 0x0600 && c <= 0x07bf) || (c >= 0x0860 && c <= 0x08ff) || (c >= 0xfb50 && c <= 0xfdff) || (c >= 0xfe70 && c <= 0xfefe)) return 'AL';
  if (/^[\p{L}\p{Mc}\p{Nd}\p{Nl}]$/u.test(ch)) return 'L';
  return 'ON';
}

const [LRI, RLI, FSI, PDI] = [0x2066, 0x2067, 0x2068, 0x2069];

/** A character of a line, or an isolate (LRI, RLI or FSI up to its PDI) holding its own. */
type Node = { cp: number; cls: BidiClass } | { isolate: 'ltr' | 'rtl' | 'auto'; nodes: Node[] };

function parse(cps: readonly number[]): Node[] {
  const root: Node[] = [];
  const stack: Node[][] = [root];
  for (const cp of cps) {
    const top = stack[stack.length - 1];
    if (cp === LRI || cp === RLI || cp === FSI) {
      const node: Node = { isolate: cp === LRI ? 'ltr' : cp === RLI ? 'rtl' : 'auto', nodes: [] };
      top.push(node);
      stack.push(node.nodes);
    } else if (cp === PDI) {
      // An unmatched PDI is dropped.
      if (stack.length > 1) stack.pop();
    } else top.push({ cp, cls: bidiClass(cp) });
  }
  return root;
}

/** The direction of the first strong letter outside any isolate (rule P2), or null. */
function firstStrong(nodes: readonly Node[]): 'ltr' | 'rtl' | null {
  for (const n of nodes) {
    if ('isolate' in n) continue;
    if (n.cls === 'L') return 'ltr';
    if (n.cls === 'R' || n.cls === 'AL') return 'rtl';
  }
  return null;
}

interface Placed {
  cp: number;
  level: number;
  /** Whether the bidi controls' LRM, RLM or ALM: they take part in the resolution and never print. */
  silent: boolean;
}

const NEUTRAL = new Set(['ON', 'WS', 'S', 'B', 'NI']);

/** Resolves one isolating run at embedding `level` (rules W1 to W7, N1, N2, I1, I2) and its isolates at theirs. */
function resolve(nodes: readonly Node[], level: number, out: Placed[]): void {
  const seq = nodes.filter((n) => 'isolate' in n || n.cls !== 'BN' || n.cp === 0x200e || n.cp === 0x200f);
  const e = level % 2 ? 'R' : 'L';
  const t: string[] = seq.map((n) => ('isolate' in n ? 'NI' : n.cls));
  const count = t.length;
  // W1: a mark takes the type before it.
  for (let i = 0; i < count; i++) if (t[i] === 'NSM') t[i] = i === 0 ? e : t[i - 1] === 'NI' ? 'ON' : t[i - 1];
  // W2: European digits after an Arabic letter are Arabic numbers.
  let last = e;
  for (let i = 0; i < count; i++) {
    if (t[i] === 'L' || t[i] === 'R' || t[i] === 'AL') last = t[i];
    else if (t[i] === 'EN' && last === 'AL') t[i] = 'AN';
  }
  // W3
  for (let i = 0; i < count; i++) if (t[i] === 'AL') t[i] = 'R';
  // W4: one separator between two numbers of a kind joins them.
  for (let i = 1; i + 1 < count; i++) {
    if (t[i] === 'ES' && t[i - 1] === 'EN' && t[i + 1] === 'EN') t[i] = 'EN';
    else if (t[i] === 'CS' && (t[i - 1] === 'EN' || t[i - 1] === 'AN') && t[i + 1] === t[i - 1]) t[i] = t[i - 1];
  }
  // W5: terminators next to European digits.
  for (let i = 0; i < count; i++) {
    if (t[i] !== 'ET') continue;
    let j = i;
    while (j < count && t[j] === 'ET') j++;
    if ((i > 0 && t[i - 1] === 'EN') || (j < count && t[j] === 'EN')) for (let k = i; k < j; k++) t[k] = 'EN';
    i = j - 1;
  }
  // W6
  for (let i = 0; i < count; i++) if (t[i] === 'ES' || t[i] === 'ET' || t[i] === 'CS') t[i] = 'ON';
  // W7: European digits after a left-to-right letter are left to right.
  last = e;
  for (let i = 0; i < count; i++) {
    if (t[i] === 'L' || t[i] === 'R') last = t[i];
    else if (t[i] === 'EN' && last === 'L') t[i] = 'L';
  }
  // N1, N2: neutrals between letters of one direction take it, the others the embedding's.
  const strong = (x: string) => (x === 'L' ? 'L' : 'R');
  for (let i = 0; i < count; i++) {
    if (!NEUTRAL.has(t[i])) continue;
    let j = i;
    while (j < count && NEUTRAL.has(t[j])) j++;
    const before = i > 0 ? strong(t[i - 1]) : e;
    const after = j < count ? strong(t[j]) : e;
    for (let k = i; k < j; k++) t[k] = before === after ? before : e;
    i = j - 1;
  }
  seq.forEach((n, i) => {
    if ('isolate' in n) {
      const dir = n.isolate === 'auto' ? (firstStrong(n.nodes) ?? 'ltr') : n.isolate;
      const inner = dir === 'rtl' ? (level % 2 ? level + 2 : level + 1) : level % 2 ? level + 1 : level + 2;
      resolve(n.nodes, inner, out);
      return;
    }
    // I1, I2
    const x = t[i];
    const lvl = level % 2 === 0 ? (x === 'R' ? level + 1 : x === 'AN' || x === 'EN' ? level + 2 : level) : x === 'R' ? level : level + 1;
    out.push({ cp: n.cp, level: lvl, silent: n.cls === 'BN' || n.cp === 0x200e || n.cp === 0x200f || n.cp === 0x061c });
  });
}

/** The brackets and quotes that mirror in a right-to-left run. */
const MIRROR = new Map<number, number>([
  [0x28, 0x29], [0x29, 0x28], [0x3c, 0x3e], [0x3e, 0x3c], [0x5b, 0x5d], [0x5d, 0x5b], [0x7b, 0x7d], [0x7d, 0x7b],
  [0xab, 0xbb], [0xbb, 0xab], [0x2039, 0x203a], [0x203a, 0x2039], [0x2264, 0x2265], [0x2265, 0x2264],
]);

/** The base direction of a line by its first strong letter outside isolates (as `dir="auto"` does), `fallback` without one. */
export function baseDirection(text: string, fallback: 'ltr' | 'rtl' = 'ltr'): 'ltr' | 'rtl' {
  return firstStrong(parse([...text].map((c) => c.codePointAt(0)!))) ?? fallback;
}

/**
 * A line in visual order, left to right, for a writer that draws characters in the order given: runs of
 * right-to-left text reversed, numbers and Latin words inside them kept left to right, brackets mirrored,
 * marks kept after their letter (the face draws them over the letter before them), isolates honoured and
 * every bidi control dropped. In a line with right-to-left letters, measurements (`3600 mm`, `12.5 m²`)
 * are left-to-right islands (`ltrIslands`), as the interface shows them. `direction` is the line's base
 * direction, by default its first strong letter's.
 */
export function visualOrder(text: string, direction?: 'ltr' | 'rtl'): string {
  const islanded = hasRtl(text)
    ? ltrIslands(text)
        .map((p) => (p.ltr ? `⁦${p.text}⁩` : p.text))
        .join('')
    : text;
  const nodes = parse([...islanded].map((c) => c.codePointAt(0)!));
  const base = direction ?? firstStrong(nodes) ?? 'ltr';
  const placed: Placed[] = [];
  resolve(nodes, base === 'rtl' ? 1 : 0, placed);
  // L1: trailing white space at the paragraph's level.
  for (let i = placed.length - 1; i >= 0 && bidiClass(placed[i].cp) === 'WS'; i--) placed[i].level = base === 'rtl' ? 1 : 0;
  // L2: reverse every run at or above each level, from the highest down to the lowest odd one.
  let max = 0;
  let min = Infinity;
  for (const p of placed) {
    if (p.level > max) max = p.level;
    if (p.level < min) min = p.level;
  }
  const lowestOdd = Math.min(min, max) | 1;
  const reverse = (from: number, to: number) => {
    for (let a = from, b = to - 1; a < b; a++, b--) [placed[a], placed[b]] = [placed[b], placed[a]];
  };
  for (let k = max; k >= lowestOdd; k--) {
    for (let i = 0; i < placed.length; i++) {
      if (placed[i].level < k) continue;
      let j = i;
      while (j < placed.length && placed[j].level >= k) j++;
      reverse(i, j);
      i = j - 1;
    }
  }
  // L3: marks of a right-to-left run now precede their letter; put them back after it.
  for (let i = 0; i < placed.length; i++) {
    if (placed[i].level % 2 === 0 || !MARK.test(String.fromCodePoint(placed[i].cp))) continue;
    let j = i;
    while (j < placed.length && placed[j].level === placed[i].level && MARK.test(String.fromCodePoint(placed[j].cp))) j++;
    if (j < placed.length && placed[j].level === placed[i].level) {
      // The letter first, then its marks in their logical order: the run [i, j] reversed.
      reverse(i, j + 1);
    }
    i = j;
  }
  // L4: mirrored brackets in right-to-left runs.
  return fromCodePoints(placed.filter((p) => !p.silent).map((p) => (p.level % 2 ? (MIRROR.get(p.cp) ?? p.cp) : p.cp)));
}

/** A line as a left-to-right writer draws it: shaped (`shapeArabic`), then in visual order (`visualOrder`). */
export function arabicVisual(text: string, direction?: 'ltr' | 'rtl'): string {
  return visualOrder(shapeArabic(text), direction ?? baseDirection(text));
}
