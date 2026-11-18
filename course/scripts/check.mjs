/**
 * `node course/scripts/check.mjs`: the course's content checked against itself, before a deploy.
 * Every lesson of the outline exists in both languages with the same shape (sections, steps, pictures,
 * drawings), every picture a lesson shows is in `public/shots/` for both languages, every drawing
 * draws, and no picture is left unused. Exits non-zero with what is wrong.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const load = async (file) => import(pathToFileURL(path.join(root, file)).href);
const { MINUTES, ORDER, PARTS } = await load('content/course.js');
const { draw } = await load('js/diagrams.js');
const { UI } = await load('js/ui-text.js');
const content = { en: (await load('content/en.js')).default, ar: (await load('content/ar.js')).default };
const shots = JSON.parse(readFileSync(path.join(root, 'shots', 'shots.json'), 'utf8'));

const problems = [];
const fail = (message) => problems.push(message);

/** What a lesson is made of, as a list comparable across languages: block kinds in order, pictures, drawings, step counts. */
function shape(lesson) {
  const out = [];
  const figs = [];
  const visit = (blocks) => {
    for (const b of blocks) {
      if (typeof b === 'string') out.push('p');
      else if (b.steps) {
        out.push(`steps:${b.steps.length}`);
        for (const s of b.steps) {
          if (typeof s === 'object' && s.fig) figs.push(s.fig);
          if (typeof s === 'object' && s.typed) out.push(`typed:${s.typed.join(',')}`);
        }
      } else if (b.fig) {
        out.push(`fig:${b.fig}`);
        figs.push(b.fig);
        if (b.legend) out.push(`legend:${b.legend.length}`);
      } else if (b.draw) out.push(`draw:${b.draw}:${Object.keys(b.words ?? {}).sort().join(',')}`);
      else if (b.table) out.push(`table:${b.table.head.length}x${b.table.rows.length}`);
      else out.push(Object.keys(b)[0] + (Array.isArray(Object.values(b)[0]) ? `:${Object.values(b)[0].length}` : ''));
    }
  };
  for (const s of lesson.sections) {
    out.push(`[${s.kind}]`);
    visit(s.blocks);
  }
  return { out, figs };
}

const used = new Set(['b-render']);
for (const lang of ['en', 'ar']) {
  for (const part of PARTS) if (!content[lang].parts[part.id]?.title) fail(`${lang}: part ${part.id} has no title`);
  for (const id of ORDER) {
    const lesson = content[lang].lessons[id];
    if (!lesson) {
      fail(`${lang}: lesson ${id} is missing`);
      continue;
    }
    if (!MINUTES[id]) fail(`lesson ${id} has no minutes`);
    for (const key of ['title', 'lead', 'card']) if (!lesson[key]) fail(`${lang}: lesson ${id} has no ${key}`);
    const { figs } = shape(lesson);
    for (const fig of figs) {
      used.add(fig);
      if (!shots[lang]?.[fig]) fail(`${lang}: lesson ${id} shows ${fig}, which shots.json does not list`);
      if (!existsSync(path.join(root, 'shots', lang, `${fig}.webp`))) fail(`${lang}: shots/${lang}/${fig}.webp is missing`);
    }
    for (const section of lesson.sections) {
      for (const b of section.blocks) {
        if (b.draw && !draw(b.draw, b.words).includes('<svg')) fail(`${lang}: lesson ${id} draws ${b.draw}, which does not exist`);
        if (b.fig && b.legend && (shots[lang]?.[b.fig]?.marks?.length ?? 0) !== b.legend.length) fail(`${lang}: ${b.fig} has ${shots[lang]?.[b.fig]?.marks?.length ?? 0} marks and a legend of ${b.legend.length}`);
      }
    }
  }
  for (const id of Object.keys(content[lang].lessons)) if (!ORDER.includes(id)) fail(`${lang}: lesson ${id} is not in the outline`);
}
for (const id of ORDER) {
  const en = content.en.lessons[id];
  const ar = content.ar.lessons[id];
  if (!en || !ar) continue;
  const a = shape(en).out;
  const b = shape(ar).out;
  if (a.join('|') !== b.join('|')) {
    const at = a.findIndex((x, i) => x !== b[i]);
    fail(`lesson ${id} differs between the languages at block ${at}: en "${a[at]}", ar "${b[at]}"`);
  }
}
for (const lang of ['en', 'ar']) {
  for (const file of readdirSync(path.join(root, 'shots', lang))) {
    const name = file.replace(/\.webp$/, '');
    if (!used.has(name)) fail(`shots/${lang}/${file} is shown by no lesson`);
  }
}
const keys = (o, prefix = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
const enKeys = keys(UI.en).sort().join();
if (enKeys !== keys(UI.ar).sort().join()) fail('the page words (js/ui-text.js) differ between the languages');

if (problems.length) {
  console.error(problems.map((p) => `- ${p}`).join('\n'));
  console.error(`\n${problems.length} problem(s)`);
  process.exit(1);
}
const steps = ORDER.reduce((sum, id) => sum + shape(content.en.lessons[id]).out.filter((x) => x.startsWith('steps:')).reduce((n, x) => n + Number(x.slice(6)), 0), 0);
console.log(`course content: ${ORDER.length} lessons, ${steps} steps, ${used.size} pictures per language, both languages in step`);
