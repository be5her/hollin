import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The template guard of `docs/i18n.md`: every template the app renders (`.html` files and inline
 * `template:` strings) must take its words from the catalog, and its classes must be logical, so a
 * right-to-left language gets a translated, mirrored interface. `PENDING` lists the files not
 * converted yet; each step of milestone 12 removes the ones it finished, and a pending file that has
 * become clean must leave the list, so it only ever shrinks.
 */

const ROOT = path.resolve(__dirname, '../..');
const SCANNED = ['packages/modules', 'packages/ui/src', 'src/renderer/src/app'];

/** Not converted yet: later steps of milestone 12 empty this list. Never add to it. */
const PENDING = new Set([
  'packages/modules/assistant/ui/assistant-panel.html',
  'packages/modules/building/ui/layers-panel.ts',
  'packages/modules/building/ui/levels-panel.html',
  'packages/modules/building/ui/rules-settings.ts',
  'packages/modules/building/ui/scene-view.html',
  'packages/modules/building/ui/section-view.ts',
  'packages/modules/decor/ui/catalog-panel.ts',
  'packages/modules/plan/ui/connector-properties.html',
  'packages/modules/plan/ui/item-properties.ts',
  'packages/modules/plan/ui/light-properties.ts',
  'packages/modules/plan/ui/material-picker.ts',
  'packages/modules/plan/ui/plan-view.html',
  'packages/modules/plan/ui/properties-panel.html',
  'packages/modules/rules/ui/warnings-panel.ts',
]);

/**
 * Words that stay as they are in every language (the names, key names, formats); a text or an
 * attribute made only of these, symbols and digits passes.
 */
const KEEP = new Set(['Hollin', 'Otto', 'Claude', 'Code', 'MCP', 'Ctrl', 'Shift', 'Alt', 'Enter', 'Esc', 'Tab', 'JSON', 'Electron', 'Chromium', 'mm', 'cm', 'ft', 'sk', 'ant']);

/**
 * Physical direction classes (with any variant prefix such as `hover:` or `!`), and the exceptions
 * `docs/i18n.md` allows: centring (`left-1/2` with `-translate-x-1/2`). The window buttons' space in the
 * title bar and overlays at canvas or pointer pixels are inline styles, which this does not read.
 */
/** A Tailwind value: a number or fraction, `px`, `full`, `auto` or an arbitrary `[…]` (so `right-click` and `left-to-right` in comments pass). */
const VALUE = String.raw`(?:\d[\w./%]*|px|full|auto|\[[^\]\s]*\])`;
const PHYSICAL = new RegExp(
  String.raw`(?<![\w-])(?:[\w-]+:)*!?(-?(?:m[lr]|p[lr]|scroll-m[lr]|scroll-p[lr]|left|right)-${VALUE}|(?:border|rounded)-[lr](?:-[\w./[\]%-]+)?|rounded-[tb][lr](?:-[\w./[\]%-]+)?|text-(?:left|right)|float-(?:left|right)|clear-(?:left|right))(?![\w-])`,
  'g',
);
const ALLOWED_PHYSICAL = new Set(['left-1/2']);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(html|ts)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(full);
  }
  return out;
}

/** The files that render something: every `.html` file, and the `.ts` files with an inline template, under the scanned folders (for modules, their `ui/`). */
function files(): string[] {
  return SCANNED.flatMap((dir) => walk(path.join(ROOT, dir)))
    .map((file) => path.relative(ROOT, file).split(path.sep).join('/'))
    .filter((file) => !file.startsWith('packages/modules/') || /^packages\/modules\/[^/]+\/ui\//.test(file));
}

/** The inline templates of a component file: the string after `template:`, in backticks or quotes. */
export function inlineTemplates(source: string): string[] {
  const out: string[] = [];
  for (const match of source.matchAll(/\btemplate:\s*(`|'|")/g)) {
    const quote = match[1];
    let i = match.index + match[0].length;
    let text = '';
    while (i < source.length && source[i] !== quote) {
      if (source[i] === '\\') i++;
      text += source[i++];
    }
    out.push(text);
  }
  return out;
}

/** Skips a balanced `(…)` starting at `i` (an opening parenthesis); returns the index after it. */
function skipParens(text: string, i: number): number {
  let depth = 0;
  for (; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return i + 1;
  }
  return i;
}

/** The template without interpolations, control flow (`@if (…) {`, `@let x = …;`, `}`) and comments: what is left is markup and literal text. */
function stripAngular(template: string): string {
  let text = template.replace(/<!--[\s\S]*?-->/g, '').replace(/\{\{[\s\S]*?\}\}/g, ' ');
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '@' && /[a-z]/.test(text[i + 1] ?? '')) {
      const word = /^@([a-z]+)(\s+if)?/.exec(text.slice(i))!;
      i += word[0].length;
      if (word[1] === 'let') {
        while (i < text.length && text[i] !== ';') i++;
        continue;
      }
      while (/\s/.test(text[i] ?? '')) i++;
      if (text[i] === '(') i = skipParens(text, i);
      while (/\s/.test(text[i] ?? '')) i++;
      if (text[i] !== '{') i--;
      continue;
    }
    out += ch === '{' || ch === '}' ? ' ' : ch;
  }
  text = out;
  return text;
}

interface Problem {
  file: string;
  what: string;
}

const hasWords = (text: string) => (text.match(/[A-Za-z]{2,}/g) ?? []).some((word) => !KEEP.has(word));

/** Literal text and labelled attributes in a template (after `stripAngular`): text nodes and `placeholder`, `title`, `aria-label`, `alt`, `label` written as plain attributes. */
export function wordsIn(template: string): string[] {
  const markup = stripAngular(template);
  const found: string[] = [];
  let i = 0;
  let textStart = 0;
  const flushText = (end: number) => {
    const text = markup.slice(textStart, end).replace(/&[a-z]+;|&#\d+;/g, ' ').trim();
    if (text && hasWords(text)) found.push(`text "${text.replace(/\s+/g, ' ')}"`);
  };
  while (i < markup.length) {
    if (markup[i] === '<' && /[A-Za-z/!]/.test(markup[i + 1] ?? '')) {
      flushText(i);
      // Read the tag to its closing `>`, past quoted attribute values.
      let j = i + 1;
      let quote = '';
      for (; j < markup.length; j++) {
        const ch = markup[j];
        if (quote) {
          if (ch === quote) quote = '';
        } else if (ch === '"' || ch === "'") quote = ch;
        else if (ch === '>') break;
      }
      const tag = markup.slice(i, j + 1);
      const name = /^<\/?([\w-]+)/.exec(tag)?.[1]?.toLowerCase();
      for (const attr of tag.matchAll(/(?<![\w.\-[(])(placeholder|title|aria-label|alt|label)="([^"]*)"/g)) {
        if (hasWords(attr[2])) found.push(`${attr[1]}="${attr[2]}"`);
      }
      i = j + 1;
      // Code and styles hold no words for people.
      if (name === 'style' || name === 'script') {
        const close = markup.indexOf(`</${name}`, i);
        i = close < 0 ? markup.length : close;
      }
      textStart = i;
      continue;
    }
    i++;
  }
  flushText(markup.length);
  return found;
}

/** Physical direction classes anywhere in a file: templates, host classes and class strings built in code. */
export function physicalClasses(source: string): string[] {
  return [...source.matchAll(PHYSICAL)].map((m) => m[1]).filter((c) => !ALLOWED_PHYSICAL.has(c.replace(/^-/, '')));
}

function problems(file: string): Problem[] {
  const source = readFileSync(path.join(ROOT, file), 'utf8');
  const templates = file.endsWith('.html') ? [source] : inlineTemplates(source);
  return [
    ...templates.flatMap((template) => wordsIn(template)).map((what) => ({ file, what: `untranslated ${what}` })),
    ...physicalClasses(source).map((what) => ({ file, what: `physical class ${what}` })),
  ];
}

describe('templates speak through the catalog and lay out logically', () => {
  const all = files().filter((file) => file.endsWith('.html') || inlineTemplates(readFileSync(path.join(ROOT, file), 'utf8')).length > 0 || physicalClasses(readFileSync(path.join(ROOT, file), 'utf8')).length > 0);

  it('finds the templates', () => {
    expect(all).toContain('src/renderer/src/app/title-bar/title-bar.html');
    expect(all).toContain('packages/modules/settings/ui/settings-tab.html');
    expect(all).toContain('packages/ui/src/controls/empty-state.ts');
  });

  it('has no raw English text or physical direction class outside the pending files', () => {
    const found = all.filter((file) => !PENDING.has(file)).flatMap(problems);
    expect(found).toEqual([]);
  });

  it('keeps the pending list to files that exist and still need work', () => {
    for (const file of PENDING) {
      expect(all, `${file} is pending but was not found`).toContain(file);
      expect(problems(file).length, `${file} is clean: remove it from PENDING`).toBeGreaterThan(0);
    }
  });
});

describe('the guard itself', () => {
  it('sees words in text and labelled attributes, and not in bindings or names', () => {
    expect(wordsIn('<p>Save the project</p>')).toEqual(['text "Save the project"']);
    expect(wordsIn('<input placeholder="Search projects" />')).toEqual(['placeholder="Search projects"']);
    expect(wordsIn('<button aria-label="Close">x</button>')).toEqual(['aria-label="Close"']);
    expect(wordsIn('@if (open()) {<span>Not saved</span>}')).toEqual(['text "Not saved"']);
    expect(wordsIn('<p>{{ t(\'a.b\') }}</p><x-a [title]="t(\'a.c\')" [attr.aria-label]="name" data-title="Raw" />')).toEqual([]);
    expect(wordsIn('@for (x of list(); track x.id) {<kbd>Ctrl K</kbd>} @let y = z(); <span>Otto · MCP</span>')).toEqual([]);
    expect(wordsIn('<input placeholder="sk-ant-…" /><textarea placeholder="JSON"></textarea>')).toEqual([]);
  });

  it('sees physical classes and lets logical ones and centring pass', () => {
    expect(physicalClasses('class="ml-2 pr-3 text-left hover:border-r rounded-tl-md !right-0 -ml-px"')).toEqual(['ml-2', 'pr-3', 'text-left', 'border-r', 'rounded-tl-md', 'right-0', '-ml-px']);
    expect(physicalClasses('class="ms-2 pe-3 text-start border-e rounded-s start-0 left-1/2 -translate-x-1/2 inset-x-1"')).toEqual([]);
    expect(physicalClasses("const side = 'left'; el.style.left = r.left + 'px'; '[style.padding-right]'")).toEqual([]);
  });
});
