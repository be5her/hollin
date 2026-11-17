import fs from 'node:fs';
import path from 'node:path';
import { textDirection, type Entity, type HistoryInfo } from '@studio/core';
import { FakeClaude } from '@studio/modules/assistant/fake-api';
import fakeClaudeSource from '@studio/modules/assistant/fake-claude.cjs?raw';
import { STABLE_PROMPT, languagePrompt } from '@studio/modules/assistant/prompt';
import { wait, type Smoke } from './harness';
import { lookArabic } from './arabic-audit';
import { canvas, tab, view } from './plan-canvas';

/** The Arabic message typed into the composer, and the label and room name Otto's batch writes. */
const MESSAGE = 'أضف غرفة نوم بجانب غرفة المعيشة';
const LABEL = 'إضافة غرفة النوم';
const ROOM = 'غرفة النوم';
/**
 * Otto's reply: an Arabic paragraph with a measurement, one with a Latin name, an English line and a short
 * list. Each line must read in its own direction, the numbers and the name in place.
 */
const REPLY = [
  'أضفت غرفة النوم بجانب غرفة المعيشة، بعرض 3000 mm وعمق 3000 mm.',
  '',
  'وضعت فيها Sofa 3 seats مؤقتًا؛ يمكنك تغييرها من الكتالوج.',
  '',
  'The door opens into the hall and is 900 mm wide.',
  '- الباب: 900 mm',
  '- النافذة: 1200 mm',
].join('\n');
const ENGLISH_MESSAGE = 'Can you also add a window to the bedroom?';
const ENGLISH_REPLY = 'Added a 1200 mm window on the north wall of غرفة النوم. It opens inward.';

type LogEntry = { type: string; pid: number; text?: string; systemPrompt?: string };

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

interface BlockInfo {
  text: string;
  dir: string;
  /** The first line's start sits at the block's own start edge (right for rtl, left for ltr). */
  aligned: boolean;
}

/** The lines of the last item of `kind` in the chat, with their computed direction and alignment. */
const blocksOf = (smoke: Smoke, panel: string, kind: 'assistant' | 'user', fromEnd = 1) =>
  smoke.js<BlockInfo[]>(`(() => {
    const items = [...document.querySelectorAll(${JSON.stringify(`${panel} [data-testid=assistant-item][data-kind=${kind}]`)})];
    const item = items[items.length - ${fromEnd}];
    if (!item) return [];

    const lines = (block) => {
      const rects = [];
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const r of range.getClientRects()) if (r.width > 0) rects.push(r);
      }
      const top = Math.min(...rects.map((r) => r.top));
      const bottom = Math.max(...rects.map((r) => r.top));
      const first = rects.filter((r) => Math.abs(r.top - top) < 4);
      const last = rects.filter((r) => Math.abs(r.top - bottom) < 4);
      const span = (rs) => [Math.min(...rs.map((r) => r.left)), Math.max(...rs.map((r) => r.right))];
      return { first: span(first), last: span(last) };
    };
    return [...item.querySelectorAll('[data-testid=assistant-block]')].map((block) => {
      const dir = getComputedStyle(block).direction;
      const { first } = lines(block);
      const box = block.getBoundingClientRect();
      const aligned = dir === 'rtl' ? Math.abs(first[1] - box.right) < 3 : Math.abs(first[0] - box.left) < 3;
      return { text: block.textContent, dir, aligned };
    });
  })()`);

/** The x of characters in a block of the last reply: `needles` each found by their first occurrence after `from` in the line. */
const charX = (smoke: Smoke, panel: string, line: number, needles: { text: string; last?: boolean }[]) =>
  smoke.js<number[]>(`(() => {
    const items = [...document.querySelectorAll(${JSON.stringify(`${panel} [data-testid=assistant-item][data-kind=assistant]`)})];
    const block = items[items.length - 1]?.querySelectorAll('[data-testid=assistant-block]')[${line}];
    if (!block) return [];
    const nodes = [];
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) nodes.push(node);
    return ${JSON.stringify(needles)}.map((n) => {
      // The first (or last) text node holding the needle, and the needle's first character in it.
      const found = n.last ? [...nodes].reverse().find((t) => t.textContent.includes(n.text)) : nodes.find((t) => t.textContent.includes(n.text));
      if (!found) return NaN;
      const i = n.last ? found.textContent.lastIndexOf(n.text) : found.textContent.indexOf(n.text);
      const range = document.createRange();
      range.setStart(found, i);
      range.setEnd(found, i + 1);
      return range.getBoundingClientRect().x;
    });
  })()`);

/**
 * Otto in Arabic (milestone 12, step 6), on the Arabic project, against the fake Claude API and then the
 * fake Claude Code: the setup state and the empty conversation in Arabic, an example put into the composer,
 * an Arabic message typed and sent with Enter (not while an input method composes, nor with Shift), a held
 * turn (the status bar thinking, the busy line, Stop), a batch that names a room in Arabic (its card, the
 * plan, History signed Otto), a reply of several paragraphs held mid-stream (the caret at the end of the
 * last line) and checked line by line for direction, alignment and the order of its numbers and names, the
 * language instruction and the unchanged stable prompt in what the model received, a gated call answered
 * "keep it" and another allowed, a failed run with its Arabic lead over the API's English words and Send
 * again, Stop, the conversation continued in English, and one turn through Claude Code. Leaves the API
 * provider, no key, an empty chat and the fakes stopped.
 */
export async function smokeArabicOtto(smoke: Smoke, projectId: string): Promise<void> {
  const { host } = smoke;
  smoke.section('arabic: Otto');
  const fake = new FakeClaude();
  process.env.STUDIO_AI_BASE_URL = await fake.start();
  const run = <T = unknown>(id: string, input: unknown = {}) => smoke.run<T>(id, input, { projectId });
  const doc = () => host.projects.session(projectId)!.doc;
  const ground = doc().building.groundLevelId;
  const panel = `${tab} [data-testid=assistant-panel]`;
  const input = `${panel} [data-testid=assistant-input]`;
  const status = '[data-testid=status-otto]';
  const statusIs = (state: string, text: string, timeoutMs = 5000) => smoke.waitFor(`${status}[data-state=${state}]`, timeoutMs, text);
  const direction = (selector: string) => smoke.js<string | null>(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? getComputedStyle(el).direction : null; })()`);
  const idle = (timeoutMs = 10_000) =>
    smoke.until(async () => {
      const state = await run<{ status: string; stopping: boolean }>('assistant.state');
      return state.status === 'idle' && !state.stopping;
    }, timeoutMs);
  const send = async (text: string) => {
    smoke.check(`Otto is idle before "${text}"`, await idle(30_000));
    await smoke.gone(`${panel} [data-testid=assistant-stop]`, 3000);
    await smoke.fill(input, text);
    await smoke.click(`${panel} [data-testid=assistant-send]`);
  };

  try {
    await smoke.click(`${tab} [data-testid=right-tab-assistant]`);
    smoke.check('the Otto tab keeps its name', await smoke.waitFor(`${tab} [data-testid=right-tab-assistant]`, 3000, 'Otto'));
    smoke.check(
      'without a key, the panel and the status bar say so in Arabic',
      (await smoke.waitFor(`${panel} [data-testid=assistant-empty][data-reason=key]`, 5000, 'يحتاج Otto إلى مفتاح')) && (await smoke.waitFor(`${panel} [data-testid=assistant-open-settings]`, 3000, 'إعداد Otto')) && (await statusIs('needs-key', 'Otto · يحتاج إلى مفتاح')),
      await smoke.text(status),
    );
    await run('ai.key.set', { key: 'sk-ant-smoke-key-0000' });
    smoke.check('with a key, the status bar says Otto is ready, right to left', (await statusIs('ready', 'Otto · جاهز')) && (await direction(`${status} span.truncate`)) === 'rtl', await smoke.text(status));

    smoke.section('arabic: Otto, the empty conversation');
    smoke.check(
      'the intro and the header speak Arabic',
      (await smoke.waitFor(`${panel} [data-testid=assistant-intro]`, 5000, 'أخبر Otto عن المكان.')) && (await smoke.waitFor(`${panel} [data-testid=assistant-header]`, 3000, 'يستأذن قبل الحذف')) && (await smoke.waitFor(`${panel} [data-testid=assistant-clear]`, 3000, 'مسح')),
    );
    const examples = await smoke.js<{ text: string; dir: string }[]>(`[...document.querySelectorAll('${panel} [data-testid=assistant-example]')].map((e) => ({ text: e.textContent.trim(), dir: getComputedStyle(e).direction }))`);
    smoke.check('its two examples are Arabic requests, read right to left', examples.length === 2 && examples.every((e) => /[؀-ۿ]/.test(e.text) && e.dir === 'rtl') && examples[0].text.startsWith('أضف غرفة نوم'), examples);
    smoke.check(
      'the composer and its hints speak Arabic, the key names in Latin',
      (await smoke.js<string>(`document.querySelector('${input}').placeholder`)) === 'اسأل Otto…' && (await smoke.waitFor(`${panel} [data-testid=assistant-hint]`, 3000, 'تُضاف التعديلات إلى سجل التراجع')) && (await smoke.waitFor(`${panel} [data-testid=assistant-hint] kbd`, 3000, 'Enter')) && (await smoke.text(`${panel} [data-testid=assistant-send]`)) === 'إرسال',
    );
    smoke.check('the empty composer follows the interface, right to left', (await direction(input)) === 'rtl');
    smoke.check('the Send arrow points the Arabic way', await smoke.js<boolean>(`getComputedStyle(document.querySelector('${panel} [data-testid=assistant-send] svg')).scale.startsWith('-1')`));
    await lookArabic(smoke, '103-otto-empty-arabic');
    await smoke.click(`${panel} [data-testid=assistant-example]`);
    smoke.check('an example goes into the composer as it is written, unsent', (await smoke.js<string>(`document.querySelector('${input}').value`)) === examples[0]?.text && fake.requests.length === 0);
    smoke.check('and the composer reads it right to left', (await direction(input)) === 'rtl');

    smoke.section('arabic: Otto, an Arabic message');
    // The edit Otto will make: a room east of the living room, sharing its east wall, named in Arabic.
    const walls = Object.values(doc().levelData[ground].entities).filter((e: Entity) => e.type === 'wall') as Extract<Entity, { type: 'wall' }>[];
    const xs = walls.flatMap((w) => w.path.v.map((v) => v.p[0]));
    const ys = walls.flatMap((w) => w.path.v.map((v) => v.p[1]));
    const [maxX, minY] = [Math.max(...xs), Math.min(...ys.filter((y) => y > Math.min(...ys)))];
    const corner = (dx: number, dy: number): [number, number] => [maxX + dx, minY + dy];
    fake.script(
      {
        hold: true,
        text: 'سأضيف الغرفة الآن.',
        tools: [
          {
            name: 'plan_apply',
            input: {
              label: LABEL,
              steps: [
                { command: 'plan.wall.add', input: { levelId: ground, points: [{ p: corner(0, 0) }, { p: corner(3000, 0) }, { p: corner(3000, 3000) }, { p: corner(0, 3000) }] } },
                { command: 'plan.room.add', input: { levelId: ground, seed: corner(1500, 1500), name: ROOM } },
              ],
            },
          },
        ],
      },
      { holdMidway: true, text: REPLY },
    );
    await smoke.fill(input, '');
    await smoke.js(`document.querySelector('${input}').focus()`);
    await wait(150);
    await smoke.typeText(MESSAGE);
    const typed = () => smoke.js<string>(`document.querySelector('${input}').value`);
    smoke.check('an Arabic message is typed into the composer', await smoke.until(async () => (await typed()) === MESSAGE), await typed());
    smoke.check('which then reads right to left by its own text', (await smoke.js<string | null>(`document.querySelector('${input}').getAttribute('dir')`)) === 'auto' && (await direction(input)) === 'rtl');
    // Enter while an input method composes confirms the composition: it must not send.
    await smoke.js(`document.querySelector('${input}').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }))`);
    await smoke.key('Return', ['shift']);
    await wait(300);
    smoke.check('Enter during composition and Shift+Enter do not send', fake.requests.length === 0 && (await typed()).startsWith(MESSAGE), { requests: fake.requests.length, value: await typed() });
    await smoke.js(`document.querySelector('${input}').focus()`);
    await smoke.key('Return');
    smoke.check('Enter sends it, and the model is held thinking', await smoke.until(() => fake.held === 1, 5000));
    smoke.check('the message shows as written, right to left, in a bubble at the inline end', (await smoke.waitFor(`${panel} [data-testid=assistant-item][data-kind=user]`, 3000, MESSAGE)) && (await blocksOf(smoke, panel, 'user'))[0]?.dir === 'rtl');
    const bubble = await smoke.js<{ left: number; logLeft: number; corner: string; otherCorner: string }>(`(() => {
      const b = [...document.querySelectorAll('${panel} [data-testid=assistant-item][data-kind=user]')].pop().getBoundingClientRect();
      const el = [...document.querySelectorAll('${panel} [data-testid=assistant-item][data-kind=user]')].pop();
      const logEl = document.querySelector('${panel} [data-testid=assistant-log]');
      // Right to left, the log's scrollbar is on its left: its content starts after it (clientLeft).
      return { left: b.left, logLeft: logEl.getBoundingClientRect().left + logEl.clientLeft, corner: getComputedStyle(el).borderBottomLeftRadius, otherCorner: getComputedStyle(el).borderBottomRightRadius };
    })()`);
    smoke.check('right to left, the bubble sits at the left with its small corner there', Math.abs(bubble.left - bubble.logLeft - 12) < 2 && bubble.corner === '2px' && bubble.otherCorner !== '2px', bubble);
    smoke.check('the status bar says Otto is thinking, in Arabic', await statusIs('thinking', 'Otto · يفكّر…'));
    smoke.check('the panel shows it is working, and Stop in place of Send', (await smoke.waitFor(`${panel} [data-testid=assistant-busy]`, 3000, 'يعمل…')) && (await smoke.text(`${panel} [data-testid=assistant-stop]`)) === 'إيقاف');
    const firstSystem = fake.system(0);
    smoke.check(
      'the model was told the interface is Arabic, in the live context after the cache breakpoint',
      firstSystem.length === 2 && firstSystem[1].text.endsWith(languagePrompt('ar')) && firstSystem[1].text.includes("The user's interface language is Arabic."),
      firstSystem.map((b) => b.text.slice(-400)),
    );
    smoke.check('the stable prompt it was sent is the English one, byte for byte, with its cache breakpoint', firstSystem[0]?.text === STABLE_PROMPT && JSON.stringify(firstSystem[0]?.cache_control) === '{"type":"ephemeral"}');
    smoke.check('and the message went as written', JSON.stringify(fake.requests[0]?.body.messages.at(-1)) === JSON.stringify({ role: 'user', content: MESSAGE }));
    fake.release();

    // The batch runs, and the reply is held halfway through its words.
    smoke.check('the reply is caught mid-stream', await smoke.until(() => fake.held === 1 && fake.requests.length === 2, 8000));
    const pieces = REPLY.match(/\S+\s*|\s+/g) ?? [];
    const shown = pieces.slice(0, Math.ceil(pieces.length / 2)).join('');
    const lastLine = shown.split('\n').filter((l) => l.trim()).pop() ?? '';
    const caret = () =>
      smoke.js<{ inLast: boolean; caret: number[]; line: number[] } | null>(`(() => {
        const items = [...document.querySelectorAll('${panel} [data-testid=assistant-item][data-kind=assistant]')];
        const item = items[items.length - 1];
        const blocks = item ? item.querySelectorAll('[data-testid=assistant-block]') : [];
        const last = blocks[blocks.length - 1];
        const mark = item?.querySelector('[data-testid=assistant-caret]');
        if (!last || !mark) return null;

    const lines = (block) => {
      const rects = [];
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const r of range.getClientRects()) if (r.width > 0) rects.push(r);
      }
      const top = Math.min(...rects.map((r) => r.top));
      const bottom = Math.max(...rects.map((r) => r.top));
      const first = rects.filter((r) => Math.abs(r.top - top) < 4);
      const last = rects.filter((r) => Math.abs(r.top - bottom) < 4);
      const span = (rs) => [Math.min(...rs.map((r) => r.left)), Math.max(...rs.map((r) => r.right))];
      return { first: span(first), last: span(last) };
    };
        const c = mark.getBoundingClientRect();
        return { inLast: last.contains(mark), caret: [c.left, c.right], line: lines(last).last };
      })()`);
    smoke.check('the reply streams with its caret in its last line', await smoke.until(async () => (await caret())?.inLast === true, 5000), await caret());
    const at = await caret();
    const rtlLast = textDirection(lastLine) === 'rtl';
    smoke.check(
      `the caret sits at the end of that line (${rtlLast ? 'its left, right to left' : 'its right'})`,
      !!at && (rtlLast ? at.caret[1] <= at.line[0] + 3 : at.caret[0] >= at.line[1] - 3),
      { lastLine, at },
    );
    smoke.check('the status bar says Otto is writing', await statusIs('writing', 'Otto · يكتب…'));
    fake.release();
    smoke.check('the whole reply arrives', await smoke.waitFor(`${panel} [data-testid=assistant-item][data-kind=assistant]`, 8000, '1200 mm'));
    smoke.check('and Otto is idle again', await idle());

    smoke.section('arabic: Otto, a reply in mixed directions');
    const blocks = await blocksOf(smoke, panel, 'assistant');
    smoke.check(
      'each line of the reply reads in its own direction: Arabic right to left, the English line left to right',
      blocks.map((b) => b.dir).join(',') === 'rtl,rtl,ltr,rtl,rtl' && blocks.map((b) => b.text).join('\n') === REPLY.split('\n').filter((l) => l).join('\n'),
      blocks,
    );
    smoke.check('and is aligned to its own start', blocks.length === 5 && blocks.every((b) => b.aligned), blocks);
    const [three, unit, stop, firstLetter] = await charX(smoke, panel, 0, [{ text: '3', last: true }, { text: 'mm', last: true }, { text: '.', last: true }, { text: 'أ' }]);
    smoke.check('a measurement inside Arabic keeps its number left of its unit', three < unit, { three, unit });
    smoke.check("the Arabic sentence's full stop stays at its end, the far left", stop < three && stop < firstLetter, { stop, three, firstLetter });
    const [s, digit, seats, wa] = await charX(smoke, panel, 1, [{ text: 'Sofa' }, { text: '3' }, { text: 'seats' }, { text: 'و' }]);
    smoke.check('a Latin name inside Arabic reads left to right, whole and in place', s < digit && digit < seats && wa > seats, { s, digit, seats, wa });
    const rule = await smoke.js<{ right: string; left: string }>(`(() => { const items = [...document.querySelectorAll('${panel} [data-testid=assistant-item][data-kind=assistant]')]; const st = getComputedStyle(items[items.length - 1]); return { right: st.borderRightWidth, left: st.borderLeftWidth }; })()`);
    smoke.check("Otto's rule is on the inline start, the right", parseFloat(rule.right) > 1 && rule.left === '0px', rule);
    const copied = await smoke.js<string>(`(() => {
      const items = [...document.querySelectorAll('${panel} [data-testid=assistant-item][data-kind=assistant]')];
      const range = document.createRange();
      range.selectNodeContents(items[items.length - 1]);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      const text = selection.toString();
      selection.removeAllRanges();
      return text;
    })()`);
    smoke.check('copying the reply gives its lines as written, its blank lines too', copied.replace(/\r/g, '').replace(/\n+$/, '') === REPLY, JSON.stringify(copied));
    const blanks = await smoke.js<number[]>(
      `[...[...document.querySelectorAll('${panel} [data-testid=assistant-item][data-kind=assistant]')].pop().querySelectorAll('[data-testid=assistant-blank]')].map((b) => b.getBoundingClientRect().height)`,
    );
    smoke.check('and each blank line shows as an empty line of one line’s height', blanks.length === 2 && blanks.every((h) => Math.abs(h - 18) < 1), blanks);

    smoke.section('arabic: Otto, the edit it made');
    const card = `${panel} [data-testid=assistant-tool][data-command="plan.apply"]`;
    smoke.check("the batch's card is titled by its Arabic label, right to left", (await smoke.waitFor(`${card}[data-status=ok] [data-testid=assistant-tool-title]`, 3000, LABEL)) && (await direction(`${card} [data-testid=assistant-tool-title]`)) === 'rtl');
    const titleBox = await smoke.rect(`${card} [data-testid=assistant-tool-title]`);
    const commandBox = await smoke.rect(`${card} [data-testid=assistant-tool-command]`);
    smoke.check('its title at the start (right), the command id at the end (left), left to right', !!titleBox && !!commandBox && titleBox.x > commandBox.x && (await direction(`${card} [data-testid=assistant-tool-command]`)) === 'ltr' && (await smoke.text(`${card} [data-testid=assistant-tool-command]`)) === 'plan.apply', { titleBox, commandBox });
    const meta = (await smoke.text(`${card} [data-testid=assistant-tool-meta]`)) ?? '';
    smoke.check('its second line names the level, the two edits and the undo step in Arabic', meta.includes('الطابق الأرضي') && meta.includes('تعديلان') && meta.includes('خطوة تراجع واحدة، باسم Otto'), meta);
    const rooms = await run<{ name: string; enclosed: boolean; labelAt: [number, number] }[]>('plan.rooms', { levelId: ground });
    const room = rooms.find((r) => r.name === ROOM);
    smoke.check('the room Otto named in Arabic is on the plan, enclosed', room?.enclosed === true, rooms.map((r) => r.name));
    const history = await run<{ undo: HistoryInfo[] }>('edit.history');
    smoke.check('as one undo step labelled in Arabic, by the assistant', history.undo[0]?.label === LABEL && history.undo[0].author.kind === 'assistant', history.undo[0]);
    await smoke.click(`${tab} [data-testid=plan-zoom-fit]`);
    await wait(200);
    if (room) {
      const v = await view(smoke);
      const name = v.at(room.labelAt);
      const ink = await smoke.js<number>(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
        const c = document.querySelector(${JSON.stringify(canvas)});
        const r = c.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const d = c.getContext('2d').getImageData(Math.round((${name.x} - 40 - r.x) * dpr), Math.round((${name.y} - 14 - r.y) * dpr), Math.round(80 * dpr), Math.round(14 * dpr)).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && d[i] + d[i + 1] + d[i + 2] < 300) n++;
        resolve(n);
      })))`);
      smoke.check("its Arabic name is drawn on the plan", ink > 15, ink);
    }
    await smoke.click(`${tab} [data-testid=right-tab-history]`);
    const row = `${tab} [data-testid=history-item][data-label="${LABEL}"][data-author="Otto"]`;
    smoke.check('History lists it by its Arabic label, signed Otto', (await smoke.waitFor(row, 3000)) && ((await smoke.text(`${row} [data-testid=history-signature]`)) ?? '').startsWith('Otto') && ((await smoke.text(`${row} [data-testid=history-signature]`)) ?? '').includes('plan.apply'), await smoke.text(`${row} [data-testid=history-signature]`));
    await smoke.click(`${tab} [data-testid=right-tab-assistant]`);
    await smoke.waitFor(input);
    await smoke.js(`document.querySelector('${panel} [data-testid=assistant-log]').scrollTop = 1e6`);
    await lookArabic(smoke, '104-otto-conversation-arabic');

    smoke.section('arabic: Otto asks first');
    const newWall = Object.values(doc().levelData[ground].entities).find((e: Entity) => e.type === 'wall' && !walls.some((w) => w.id === e.id))!;
    fake.reset();
    fake.script({ tools: [{ name: 'catalog_remove', input: { ref: 'asset:0000000000000000000000000000000000000000000000000000000000000000.glb' } }] }, { text: 'أبقيت النموذج في الكتالوج كما هو.' });
    await send('احذف النموذج القديم من الكتالوج');
    const confirm = `${panel} [data-testid=assistant-confirm]`;
    smoke.check('a gated call waits in a card titled in Arabic', (await smoke.waitFor(`${confirm}[data-command="catalog.remove"]`, 5000)) && (await smoke.text(`${confirm} [data-testid=assistant-confirm-title]`)) === 'إزالة نموذج من الكتالوج', await smoke.text(`${confirm} [data-testid=assistant-confirm-title]`));
    smoke.check(
      'its question and buttons in Arabic, its input left to right',
      (await smoke.text(`${confirm} [data-testid=assistant-confirm-asks]`)) === 'يستأذن Otto قبل الحذف.' && (await smoke.text(`${panel} [data-testid=assistant-allow]`)) === 'اسمح' && (await smoke.text(`${panel} [data-testid=assistant-decline]`)) === 'أبقِه' && (await direction(`${confirm} [data-testid=assistant-tool-summary]`)) === 'ltr',
    );
    smoke.check('the card names the call in Arabic for screen readers', ((await smoke.js<string>(`document.querySelector('${confirm}').getAttribute('aria-label')`)) ?? '').startsWith('يريد Otto تنفيذ «إزالة نموذج من الكتالوج»'));
    smoke.check('the status bar says Otto waits for your yes', await statusIs('waiting', 'Otto · ينتظر موافقتك'));
    smoke.check('the composer says so too', (await smoke.js<string>(`document.querySelector('${input}').placeholder`)) === 'ينتظر Otto جوابك أعلاه');
    await lookArabic(smoke, '105-otto-confirm-arabic');
    await smoke.click(`${panel} [data-testid=assistant-decline]`);
    smoke.check('"Keep it" declines it, said in Arabic', await smoke.waitFor(`${panel} [data-testid=assistant-tool][data-command="catalog.remove"][data-status=declined]`, 5000, 'بقي كما هو. أُبلغ Otto بالرفض.'));
    smoke.check('the model was told no, in English', (await fake.received(2)) && JSON.stringify(fake.requests[1].body.messages.at(-1)).includes('MUTATION_DECLINED'));
    await smoke.waitFor(`${panel} [data-testid=assistant-item][data-kind=assistant]`, 5000, 'أبقيت النموذج');

    fake.reset();
    fake.script({ tools: [{ name: 'smoke_destroy', input: { ids: [newWall.id] } }] }, { text: 'تمّ.' });
    await send('نعم، احذف الجدار الجديد');
    smoke.check('a second gated call names its target, left to right', (await smoke.waitFor(`${confirm}[data-command="smoke.destroy"] [data-testid=assistant-confirm-targets]`, 5000, newWall.id)) && (await direction(`${confirm} [data-testid=assistant-confirm-targets]`)) === 'ltr');
    await smoke.click(`${panel} [data-testid=assistant-allow]`);
    smoke.check('"Allow" runs it', await smoke.waitFor(`${panel} [data-testid=assistant-tool][data-command="smoke.destroy"][data-status=ok]`, 5000));
    await smoke.waitFor(`${panel} [data-testid=assistant-item][data-kind=assistant]`, 5000, 'تمّ.');

    smoke.section('arabic: Otto, a failed run');
    fake.reset();
    // The SDK retries an overloaded API once: both answers fail.
    const overloaded = { error: { status: 529, type: 'overloaded_error', message: 'Overloaded' } };
    fake.script(overloaded, overloaded);
    await send('هل انتهيت؟');
    smoke.check('the error is said in Arabic', await smoke.waitFor(`${panel} [data-testid=assistant-error-text]`, 15_000, 'خوادم Claude مشغولة بطلبات كثيرة الآن.'), await smoke.text(`${panel} [data-testid=assistant-error]`));
    smoke.check('with the API\'s own English words under it, left to right', ((await smoke.text(`${panel} [data-testid=assistant-error-detail]`)) ?? '').startsWith('The Claude API answered 529') && (await direction(`${panel} [data-testid=assistant-error-detail]`)) === 'ltr');
    smoke.check('the status bar says Otto could not reach Claude', await statusIs('failed', 'Otto · تعذّر الوصول إلى Claude'));
    smoke.check('and Send again is offered in Arabic', (await smoke.text(`${panel} [data-testid=assistant-retry]`)) === 'إعادة الإرسال');
    await lookArabic(smoke, '106-otto-error-arabic');
    fake.script({ text: 'نعم، انتهيت.' });
    await smoke.click(`${panel} [data-testid=assistant-retry]`);
    smoke.check('Send again sends the Arabic message again and the error goes', (await smoke.waitFor(`${panel} [data-testid=assistant-item][data-kind=assistant]`, 8000, 'نعم، انتهيت.')) && (await smoke.gone(`${panel} [data-testid=assistant-error]`, 3000)) && JSON.stringify(fake.requests.at(-1)?.body.messages.at(-1)) === JSON.stringify({ role: 'user', content: 'هل انتهيت؟' }));

    smoke.section('arabic: Otto stopped');
    fake.reset();
    fake.script({ hold: true, text: 'لن يصل هذا.' });
    await send('ارسم الطابق العلوي');
    await smoke.until(() => fake.held === 1, 5000);
    await smoke.click(`${panel} [data-testid=assistant-stop]`);
    smoke.check('Stop stops Otto, and the status bar says so in Arabic', await statusIs('stopped', 'Otto · توقّف'));
    fake.release();

    smoke.section('arabic: Otto, the conversation goes on in English');
    fake.reset();
    fake.script({ text: ENGLISH_REPLY });
    await send(ENGLISH_MESSAGE);
    smoke.check('the English reply arrives', await smoke.waitFor(`${panel} [data-testid=assistant-item][data-kind=assistant]`, 8000, 'It opens inward.'));
    await idle();
    const englishUser = await blocksOf(smoke, panel, 'user');
    const englishReply = await blocksOf(smoke, panel, 'assistant');
    smoke.check('your English message reads left to right, aligned left', englishUser[0]?.dir === 'ltr' && englishUser[0].aligned, englishUser);
    smoke.check("Otto's English reply too, its Arabic room name inside it in place", englishReply[0]?.dir === 'ltr' && englishReply[0].aligned && englishReply[0].text === ENGLISH_REPLY, englishReply);
    const bubbles = await smoke.js<{ lefts: number[]; logLeft: number }>(`(() => ({ lefts: [...document.querySelectorAll('${panel} [data-testid=assistant-item][data-kind=user]')].map((e) => e.getBoundingClientRect().left), logLeft: (() => { const l = document.querySelector('${panel} [data-testid=assistant-log]'); return l.getBoundingClientRect().left + l.clientLeft; })() }))()`);
    smoke.check('every bubble, Arabic or English, sits at the inline end', bubbles.lefts.length >= 5 && bubbles.lefts.every((l) => Math.abs(l - bubbles.logLeft - 12) < 2), bubbles);
    const earlier = await blocksOf(smoke, panel, 'assistant', 5);
    smoke.check('while the Arabic reply above still reads right to left', earlier[0]?.dir === 'rtl' && earlier[0].text.startsWith('أضفت غرفة النوم'), earlier[0]);
    smoke.check('the model was still told the interface is Arabic', fake.system(0)[1]?.text.endsWith(languagePrompt('ar')) === true);
    smoke.check('the status bar is ready again once the stop has passed', await statusIs('ready', 'Otto · جاهز', 8000), await smoke.text(status));
    await lookArabic(smoke, '107-otto-mixed-arabic');

    smoke.section('arabic: Otto with Claude Code');
    await smoke.click(`${panel} [data-testid=assistant-clear]`);
    await smoke.waitFor(`${panel} [data-testid=assistant-intro]`, 3000);
    const dataDir = host.api.dataDir!;
    const fakePath = path.join(dataDir, 'fake-claude.cjs');
    const scriptFile = path.join(dataDir, 'fake-claude-arabic.json');
    const logFile = path.join(dataDir, 'fake-claude-arabic.jsonl');
    fs.writeFileSync(fakePath, fakeClaudeSource);
    fs.rmSync(logFile, { force: true });
    process.env.FAKE_CLAUDE_SCRIPT = scriptFile;
    process.env.FAKE_CLAUDE_LOG = logFile;
    const readLog = (): LogEntry[] => (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as LogEntry) : []);
    const ccReply = 'مرحبًا، أعمل الآن عبر Claude Code. لم أغيّر شيئًا في المخطط.';
    fs.writeFileSync(scriptFile, JSON.stringify({ sessionId: 'smoke-arabic', messages: [[{ text: ccReply }]] }));
    try {
      await run('config.update', { patch: { ai: { provider: 'claude-code', claudeCodePath: fakePath } } });
      const probed = await smoke.until(async () => {
        const s = await smoke.run<{ claudeCode: { found: boolean; loggedIn: boolean | null } | null }>('assistant.status');
        return s.claudeCode?.found === true && s.claudeCode.loggedIn === true;
      }, 30_000, 200);
      smoke.check('the fake Claude Code is found and logged in', probed);
      smoke.check('the chat opens, naming Claude Code left to right', (await smoke.waitFor(`${panel} [data-testid=assistant-model]`, 5000, 'Claude Code 9.9.9')) && (await direction(`${panel} [data-testid=assistant-model]`)) === 'ltr');
      await send('هل تسمعني؟');
      smoke.check("Claude Code's Arabic reply shows, right to left", (await smoke.waitFor(`${panel} [data-testid=assistant-item][data-kind=assistant]`, 30_000, 'أعمل الآن عبر Claude Code')) && (await blocksOf(smoke, panel, 'assistant'))[0]?.dir === 'rtl');
      const start = readLog().find((e) => e.type === 'start');
      smoke.check('Claude Code was told the interface is Arabic, after the unchanged stable prompt', !!start?.systemPrompt?.startsWith(STABLE_PROMPT) && start.systemPrompt.endsWith(languagePrompt('ar')), start?.systemPrompt?.slice(-300));
      smoke.check('and got the message as written', readLog().some((e) => e.type === 'message' && e.text === 'هل تسمعني؟'));
      await idle(30_000);
      smoke.check('the status bar says Otto is ready with Claude Code', await statusIs('ready', 'Otto · جاهز', 8000), await smoke.text(status));
      smoke.check('the header keeps the rule whole beside the Claude Code label', await smoke.js<boolean>(`(() => { const el = document.querySelector('${panel} [data-testid=assistant-model]').nextElementSibling; return el.scrollWidth <= el.clientWidth + 1; })()`));
      await lookArabic(smoke, '108-otto-claude-code-arabic');
      await smoke.click(`${panel} [data-testid=assistant-clear]`);
      smoke.check('Clear ends the Claude Code process', !start || (await smoke.until(() => !alive(start.pid), 30_000)));
    } finally {
      delete process.env.FAKE_CLAUDE_SCRIPT;
      delete process.env.FAKE_CLAUDE_LOG;
      await smoke.run('config.update', { patch: { ai: { provider: 'api', claudeCodePath: '' } } });
    }
  } finally {
    await idle();
    if (await smoke.count(`${panel} [data-testid=assistant-clear]:not([disabled])`)) await smoke.click(`${panel} [data-testid=assistant-clear]`);
    delete process.env.STUDIO_AI_BASE_URL;
    await fake.close();
    await smoke.run('ai.key.clear');
  }
}
