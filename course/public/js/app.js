/**
 * The course's page: a home with the outline, and one lesson at a time (`#/lesson/<id>`), in English or
 * Arabic. No framework and no build step: the lessons are data (content/en.js, content/ar.js) turned
 * into HTML here; the reader's progress is in store.js.
 */
import { MINUTES, ORDER, PARTS, RELEASES, SOURCE } from '../content/course.js';
import { draw } from './diagrams.js';
import * as store from './store.js';
import { UI } from './ui-text.js';

const app = document.getElementById('app');
const lightbox = document.getElementById('lightbox');
const loaders = { en: () => import('../content/en.js'), ar: () => import('../content/ar.js') };
const loaded = {};
let lang = document.documentElement.lang === 'ar' ? 'ar' : 'en';
let content = null;
let shots = {};
let menuOpen = false;
let drawerOpen = false;
let toastTimer = 0;
let shownRoute = null;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const plain = (html) => String(html ?? '').replace(/<[^>]+>/g, '');
const fill = (s, vars = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : `{${k}}`));
const t = (key, vars) => fill(UI[lang][key], vars);
const save = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Blocked storage: the choice lasts for this visit.
  }
};

const ICON = {
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  google:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.5 12.2c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.5c2.1-1.9 3.3-4.7 3.3-8z"/><path fill="#34A853" d="M12 23c3 0 5.500-1 7.300-2.700l-3.500-2.700c-1 .700-2.300 1.100-3.800 1.100-2.900 0-5.300-1.900-6.200-4.600H2.200v2.800A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.800 14.100a6.600 6.600 0 0 1 0-4.200V7.100H2.200a11 11 0 0 0 0 9.800l3.600-2.800z"/><path fill="#EA4335" d="M12 5.400c1.600 0 3.100.6 4.200 1.600l3.100-3.100A11 11 0 0 0 2.200 7.100l3.600 2.800C6.700 7.200 9.100 5.400 12 5.400z"/></svg>',
};

const isDark = () => {
  const set = document.documentElement.dataset.theme;
  return set ? set === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
};
const route = () => {
  const m = /^#\/lesson\/([a-z0-9-]+)/.exec(location.hash);
  return m ? { page: 'lesson', id: m[1] } : { page: 'home' };
};
const lessonNumber = (id) => ORDER.indexOf(id) + 1;
const partOf = (id) => PARTS.findIndex((p) => p.lessons.includes(id)) + 1;
const nextUp = () => ORDER.find((id) => !store.isDone(id)) ?? null;

// ---------- the top bar ----------

function barHtml() {
  const done = store.doneCount(ORDER);
  const { cloud } = store;
  let account = '';
  if (cloud.available && cloud.user) {
    const initial = esc((cloud.user.name || cloud.user.email || '?').trim().charAt(0).toUpperCase());
    account = `<div class="account"><button class="avatar" type="button" data-action="menu" aria-haspopup="true" aria-expanded="${menuOpen}" aria-label="${esc(cloud.user.name || t('signedInAs'))}">${cloud.user.photo ? `<img src="${esc(cloud.user.photo)}" alt="" referrerpolicy="no-referrer" />` : initial}</button>${
      menuOpen
        ? `<div class="menu" role="menu"><div class="who" dir="auto">${esc(cloud.user.name)}</div><div class="mail">${esc(cloud.user.email)}</div><p class="sync">${cloud.syncing ? t('syncing') : cloud.error ? t('syncError') : t('synced')}</p><button class="btn small" type="button" data-action="signout">${t('signOut')}</button></div>`
        : ''
    }</div>`;
  } else if (cloud.available) {
    account = `<button class="btn small" type="button" data-action="signin">${ICON.google}<span>${t('signInShort')}</span></button>`;
  }
  return `<header class="bar">
    <a class="brand" href="#/" aria-label="${t('title')}"><img src="/icon.svg" alt="" width="28" height="28" /><span class="wordmark">Hollin<i>.</i></span><span class="tag">${t('tag')}</span></a>
    <span class="grow"></span>
    <div class="bar-progress" title="${t('progress')}"><span class="num">${done}/${ORDER.length}</span><div class="track" role="progressbar" aria-label="${t('progress')}" aria-valuemin="0" aria-valuemax="${ORDER.length}" aria-valuenow="${done}"><span style="width:${(done / ORDER.length) * 100}%"></span></div></div>
    <button class="btn small quiet" type="button" data-action="lang" lang="${lang === 'ar' ? 'en' : 'ar'}" aria-label="${t('languageLabel')}">${ICON.globe}<span>${t('language')}</span></button>
    <button class="btn icon quiet" type="button" data-action="theme" aria-label="${isDark() ? t('themeLight') : t('themeDark')}" title="${isDark() ? t('themeLight') : t('themeDark')}">${isDark() ? ICON.sun : ICON.moon}</button>
    ${account}
  </header>`;
}

// ---------- the pieces of a lesson ----------

function figureHtml(b) {
  const meta = shots[lang]?.[b.fig] ?? shots.en?.[b.fig] ?? { w: 1092, h: 876 };
  const src = `/shots/${lang}/${b.fig}.webp`;
  const marks = b.legend && meta.marks ? meta.marks.map((m) => `<span class="mark" style="left:${m.x}%;top:${m.y}%">${m.n}</span>`).join('') : '';
  const legend = b.legend ? `<ol class="legend">${b.legend.map((item, i) => `<li><span class="mk">${i + 1}</span><span>${item}</span></li>`).join('')}</ol>` : '';
  return `<figure><div class="shot ${b.size ?? ''}"><button type="button" data-zoom="${src}" aria-label="${t('zoom')}"><img src="${src}" width="${meta.w}" height="${meta.h}" loading="lazy" decoding="async" alt="${esc(plain(b.alt ?? b.cap ?? ''))}" /></button>${marks}</div>${b.cap ? `<figcaption>${b.cap}</figcaption>` : ''}${legend}</figure>`;
}

function noteHtml(kind, body) {
  return `<div class="note ${kind}"><span class="ico" aria-hidden="true">${UI[lang].marks[kind]}</span><div><b class="t">${UI[lang].notes[kind]}</b><p>${body}</p></div></div>`;
}

const typedHtml = (values) => `<div class="typed" aria-label="${t('typeHint')}">${values.map((v) => `<code>${esc(v)}</code><span class="ent num">Enter</span>`).join('<span class="then" aria-hidden="true">›</span>')}</div>`;

function stepHtml(step, index, ticked) {
  const s = typeof step === 'string' ? { t: step } : step;
  return `<li class="${ticked ? 'ticked' : ''}"><label class="stepbox"><input type="checkbox" data-step="${index}" ${ticked ? 'checked' : ''} aria-label="${esc(plain(s.t)).slice(0, 80)}" /><span aria-hidden="true"></span></label><div class="stepbody"><p>${s.t}</p>${s.typed ? typedHtml(s.typed) : ''}${s.sub ? `<p class="sub">${s.sub}</p>` : ''}${s.fig ? figureHtml(s) : ''}${s.tip ? noteHtml('tip', s.tip) : ''}${s.warn ? noteHtml('warn', s.warn) : ''}</div></li>`;
}

/** A key combination (Ctrl+Z) reads left to right as one piece, in Arabic too, as the app writes its shortcuts. */
const combos = (html) => html.replace(/<kbd>[^<]*<\/kbd>(?:\+<kbd>[^<]*<\/kbd>)+/g, (m) => `<span class="ltr combo">${m}</span>`);

function blocksHtml(list, ctx) {
  return list
    .map((b) => {
      if (typeof b === 'string') return `<p>${b}</p>`;
      if (b.h) return `<h3>${b.h}</h3>`;
      if (b.ul) return `<ul>${b.ul.map((i) => `<li>${i}</li>`).join('')}</ul>`;
      if (b.ol) return `<ol class="plain">${b.ol.map((i) => `<li>${i}</li>`).join('')}</ol>`;
      if (b.fig) return figureHtml(b);
      if (b.draw) return `<figure><div class="diagram">${draw(b.draw, b.words ?? {})}</div>${b.cap ? `<figcaption>${b.cap}</figcaption>` : ''}</figure>`;
      if (b.tip) return noteHtml('tip', b.tip);
      if (b.rule) return noteHtml('rule', b.rule);
      if (b.warn) return noteHtml('warn', b.warn);
      if (b.otto) return noteHtml('otto', b.otto);
      if (b.table) return `<div class="tablewrap"><table><thead><tr>${b.table.head.map((h) => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${b.table.rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      if (b.keys) return `<dl class="keys">${b.keys.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
      if (b.check) return `<ul class="checklist">${b.check.map((i) => `<li><span>${i}</span></li>`).join('')}</ul>`;
      if (b.steps) {
        const html = b.steps.map((step) => {
          const index = ctx.steps++;
          return stepHtml(step, index, ctx.ticked.has(index));
        });
        return `<ol class="steps" style="counter-reset: step ${ctx.steps - b.steps.length}">${html.join('')}</ol>`;
      }
      return '';
    })
    .join('');
}

function outlineHtml(current) {
  return PARTS.map((part, i) => {
    const info = content.parts[part.id];
    return `<h2>${t('part', { n: i + 1 })} · ${info.title}</h2>${part.lessons
      .map((id) => {
        const done = store.isDone(id);
        return `<a href="#/lesson/${id}" class="${done ? 'done' : ''}" ${id === current ? 'aria-current="page"' : ''}><span class="tick">${done ? '✓' : lessonNumber(id)}</span><span>${content.lessons[id].title}</span></a>`;
      })
      .join('')}`;
  }).join('');
}

function finishHtml(id, total) {
  const done = store.isDone(id);
  const ticked = store.checksOf(id).filter((i) => i < total).length;
  const index = ORDER.indexOf(id);
  const prev = ORDER[index - 1];
  const next = ORDER[index + 1];
  const steps = total ? `<small>${ticked >= total ? t('stepsAll') : t('stepsLeft', { done: ticked, total })}</small>` : '';
  return `<div class="finish"><div class="row"><div><div class="state ${done ? 'ok' : ''}">${done ? `✓ ${t('marked')}` : t('markDone')}</div>${steps}</div>
    <button class="btn ${done ? '' : 'primary'}" type="button" data-action="done">${done ? t('unmark') : `✓ ${t('markDone')}`}</button></div>
    ${!next && done ? `<p style="margin:0">${t('finishedAll')}</p>` : ''}</div>
    <nav class="pager" aria-label="${t('outline')}">${prev ? `<a class="prevl" href="#/lesson/${prev}"><small>${t('prev')}</small><b>${content.lessons[prev].title}</b></a>` : '<span></span>'}${
      next ? `<a class="nextl" href="#/lesson/${next}"><small>${t('nextLesson')}</small><b>${content.lessons[next].title}</b></a>` : `<a class="nextl" href="#/"><small>${t('home')}</small><b>${t('backHome')}</b></a>`
    }</nav>`;
}

function lessonHtml(id) {
  const lesson = content.lessons[id];
  if (!lesson) return `<main id="main" class="wrap empty"><h1>${t('notFound')}</h1><p><a class="btn" href="#/">${t('backHome')}</a></p></main>`;
  const ctx = { steps: 0, ticked: new Set(store.checksOf(id)) };
  const sections = lesson.sections
    .map((s) => `<section class="sec ${s.kind}"><h2><span class="badge">${UI[lang].kinds[s.kind]}</span>${s.title ? `<span>${s.title}</span>` : ''}</h2>${combos(blocksHtml(s.blocks, ctx))}</section>`)
    .join('');
  const partIndex = partOf(id);
  return `<div class="lesson-layout">
    <aside class="side"><nav class="outline" aria-label="${t('outline')}" data-bind="outline">${outlineHtml(id)}</nav></aside>
    <main id="main" class="lesson" data-lesson="${id}" data-steps="${ctx.steps}">
      <div class="crumbs"><button class="btn small outline-toggle" type="button" data-action="drawer">${ICON.list}<span>${t('outline')}</span></button><a href="#/">${t('home')}</a><span class="pill">${t('part', { n: partIndex })} · ${content.parts[PARTS[partIndex - 1].id].title}</span><span class="pill">${t('lesson', { n: lessonNumber(id) })}</span><span class="num">${t('minutes', { n: MINUTES[id] })}</span></div>
      <header><h1 tabindex="-1">${lesson.title}</h1><p class="lead">${lesson.lead}</p></header>
      ${lesson.learn ? `<div class="learn"><h2>${t('learnTitle')}</h2><ul>${lesson.learn.map((i) => `<li>${i}</li>`).join('')}</ul></div>` : ''}
      ${sections}
      <div data-bind="finish">${finishHtml(id, ctx.steps)}</div>
    </main>
  </div>
  ${drawerOpen ? `<div class="drawer" data-action="drawer-close"><nav class="outline" aria-label="${t('outline')}">${outlineHtml(id)}</nav></div>` : ''}`;
}

// ---------- the home page ----------

function homeHtml() {
  const u = UI[lang];
  const { cloud } = store;
  const started = store.doneCount(ORDER) > 0 || Boolean(store.lastLesson());
  const target = (started && store.lastLesson() && !store.isDone(store.lastLesson()) ? store.lastLesson() : nextUp()) ?? ORDER[0];
  const upNext = nextUp();
  const hero = shots[lang]?.['b-render'] ?? { w: 1320, h: 720 };
  const parts = PARTS.map((part, i) => {
    const info = content.parts[part.id];
    const cards = part.lessons
      .map((id) => {
        const lesson = content.lessons[id];
        const done = store.isDone(id);
        return `<a class="card ${done ? 'done' : id === upNext ? 'next' : ''}" href="#/lesson/${id}"><span class="n">${done ? '✓' : lessonNumber(id)}</span><span><h3>${lesson.title}</h3><p>${lesson.card ?? lesson.lead}</p></span><span class="meta num">${t('minutes', { n: MINUTES[id] })}</span></a>`;
      })
      .join('');
    return `<section class="part"><div class="part-head"><h2>${t('part', { n: i + 1 })} · ${info.title}</h2><span class="count">${t('lessonsCount', { done: store.doneCount(part.lessons), total: part.lessons.length })}</span></div><p>${info.lead}</p><div class="cards">${cards}</div></section>`;
  }).join('');
  let account = '';
  if (cloud.available && cloud.user) account = `<div class="signin-card"><div><h2>${u.saveTitle}</h2><p>${t('saveSigned', { name: `<b dir="auto">${esc(cloud.user.name || cloud.user.email)}</b>` })}</p></div><button class="btn" type="button" data-action="signout">${u.signOut}</button></div>`;
  else if (cloud.available) account = `<div class="signin-card"><div><h2>${u.saveTitle}</h2><p>${u.saveLead}</p></div><button class="btn" type="button" data-action="signin">${ICON.google}<span>${u.signIn}</span></button></div>`;
  else if (cloud.available === false) account = `<div class="signin-card"><div><h2>${u.saveTitle}</h2><p>${u.saveLocal}</p></div></div>`;
  return `<main id="main">
    <div class="wrap">
      <section class="hero">
        <div><div class="eyebrow">${u.heroEyebrow}</div><h1 tabindex="-1">${u.heroTitle}</h1><p class="lead">${u.heroLead}</p>
          <div class="actions"><a class="btn primary" href="#/lesson/${target}">${started ? u.resume : u.start} <span class="arrow" aria-hidden="true">→</span></a><a class="btn" href="${RELEASES}" target="_blank" rel="noopener">${u.getApp}</a></div>
          <p class="hero-note">${u.heroNote}</p></div>
        <div class="hero-art"><img src="/shots/${lang}/b-render.webp" width="${hero.w}" height="${hero.h}" alt="${esc(u.heroAlt)}" fetchpriority="high" /></div>
      </section>
      <div class="facts">${u.facts.map(([n, label]) => `<div class="fact"><b class="num">${n}</b><span>${label}</span></div>`).join('')}</div>
      <h2 class="section-title">${u.howTitle}</h2>
      <div class="how" style="margin-top:14px">${u.how.map(([title, body], i) => `<div><h3><span class="dot">${i + 1}</span>${title}</h3><p>${body}</p></div>`).join('')}</div>
      <h2 class="section-title">${u.outlineTitle}</h2><p class="section-lead">${u.outlineLead}</p>
      ${parts}
      ${account}
    </div>
  </main>`;
}

function footHtml() {
  return `<footer class="foot"><div class="wrap"><span>${t('footer')} <a href="${SOURCE}" target="_blank" rel="noopener">${t('footerSource')}</a></span>${store.doneCount(ORDER) || store.lastLesson() ? `<button class="btn small quiet" type="button" data-action="reset">${t('reset')}</button>` : ''}</div></footer>`;
}

// ---------- drawing the page ----------

function render({ top = false } = {}) {
  const r = route();
  const key = `${r.page}:${r.id ?? ''}`;
  const moved = key !== shownRoute;
  const first = shownRoute === null;
  if (moved) {
    drawerOpen = false;
    menuOpen = false;
  }
  shownRoute = key;
  const title = r.page === 'lesson' && content.lessons[r.id] ? `${content.lessons[r.id].title} · ${t('title')}` : t('title');
  document.title = plain(title);
  app.innerHTML = `<div data-bind="bar">${barHtml()}</div>${r.page === 'lesson' ? lessonHtml(r.id) : homeHtml()}${footHtml()}`;
  if (r.page === 'lesson' && content.lessons[r.id]) store.visit(r.id);
  if (moved || top) {
    window.scrollTo(0, 0);
    if (moved && !first) app.querySelector('h1')?.focus({ preventScroll: true });
  }
}

/** After a tick or a sign-in: the bar, the outline and the lesson's finish box, without redrawing the lesson (the reader's place stays). */
function refresh() {
  const r = route();
  if (r.page !== 'lesson') {
    render();
    return;
  }
  const bar = app.querySelector('[data-bind=bar]');
  if (bar) bar.innerHTML = barHtml();
  const main = app.querySelector('main[data-lesson]');
  if (!main) return;
  for (const nav of app.querySelectorAll('nav.outline')) nav.innerHTML = outlineHtml(r.id);
  const finish = app.querySelector('[data-bind=finish]');
  if (finish) finish.innerHTML = finishHtml(r.id, Number(main.dataset.steps));
  const ticked = new Set(store.checksOf(r.id));
  for (const box of main.querySelectorAll('input[data-step]')) {
    const on = ticked.has(Number(box.dataset.step));
    box.checked = on;
    box.closest('li')?.classList.toggle('ticked', on);
  }
}

function toast(message) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = message;
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 4200);
}

async function setLanguage(next) {
  lang = next;
  save('hollin-course.lang', lang);
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  content = loaded[lang] ??= (await loaders[lang]()).default;
  if (new URLSearchParams(location.search).has('lang')) history.replaceState(null, '', location.pathname + location.hash);
  render();
}

function openLightbox(src, alt) {
  lightbox.innerHTML = `<button class="btn icon close" type="button" data-action="lightbox-close" aria-label="${t('close')}">${ICON.x}</button><div class="inner fit"><img src="${esc(src)}" alt="${esc(alt)}" /></div>`;
  lightbox.showModal();
}

// ---------- what the reader does ----------

app.addEventListener('click', async (event) => {
  const zoom = event.target.closest('[data-zoom]');
  if (zoom) {
    openLightbox(zoom.dataset.zoom, zoom.querySelector('img')?.alt ?? '');
    return;
  }
  const el = event.target.closest('[data-action]');
  if (!el) {
    if (menuOpen && !event.target.closest('.account')) {
      menuOpen = false;
      refreshBar();
    }
    return;
  }
  const action = el.dataset.action;
  if (action === 'lang') await setLanguage(lang === 'ar' ? 'en' : 'ar');
  else if (action === 'theme') {
    const next = isDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    save('hollin-course.theme', next);
    refreshBar();
  } else if (action === 'menu') {
    menuOpen = !menuOpen;
    refreshBar();
  } else if (action === 'signin') {
    const problem = await store.signIn();
    if (problem === null) toast(t('signedIn'));
    else toast(problem === 'cancelled' ? t('signInCancelled') : problem === 'blocked' ? t('signInBlocked') : t('signInFailed'));
  } else if (action === 'signout') {
    menuOpen = false;
    await store.signOut();
    toast(t('signedOut'));
  } else if (action === 'done') {
    const id = route().id;
    store.setDone(id, !store.isDone(id));
  } else if (action === 'drawer') {
    drawerOpen = true;
    render();
  } else if (action === 'drawer-close') {
    if (event.target === el || event.target.closest('a')) {
      drawerOpen = false;
      if (!event.target.closest('a')) render();
    }
  } else if (action === 'reset') {
    if (confirm(t('resetConfirm'))) {
      store.reset();
      toast(t('resetDone'));
      render({ top: true });
    }
  }
});

function refreshBar() {
  const bar = app.querySelector('[data-bind=bar]');
  if (bar) bar.innerHTML = barHtml();
}

app.addEventListener('change', (event) => {
  const box = event.target.closest('input[data-step]');
  if (!box) return;
  store.setCheck(route().id, Number(box.dataset.step), box.checked);
});

lightbox.addEventListener('click', (event) => {
  if (event.target.closest('[data-action=lightbox-close]') || !event.target.closest('img')) lightbox.close();
  else event.target.closest('.inner')?.classList.toggle('fit');
});
lightbox.addEventListener('close', () => (lightbox.innerHTML = ''));

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (drawerOpen) {
    drawerOpen = false;
    render();
  } else if (menuOpen) {
    menuOpen = false;
    refreshBar();
  }
});

window.addEventListener('hashchange', () => render());
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => refreshBar());

// ---------- start ----------

const [first, index] = await Promise.all([
  loaders[lang](),
  fetch('/shots/shots.json')
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({})),
]);
content = loaded[lang] = first.default;
shots = index;
render();
store.onChange(refresh);
void store.initCloud();
