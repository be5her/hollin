import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';
import { BrowserWindow } from 'electron';
import { currentLanguage, decodeDxfBytes, readDxf, sheetDate, type Entity } from '@studio/core';
import { wait, type Smoke } from './harness';
import { tab } from './plan-canvas';

type Exported = { format: string; files: { path: string; bytes: number }[]; levels: { levelId: string; name: string; scale: number }[] };

/** A PDF's objects through its xref: each object's dictionary and, for a stream, its bytes (inflated when it says FlateDecode). */
function pdfObjects(bytes: Buffer): Map<number, { dict: string; stream?: Buffer }> {
  const text = bytes.toString('latin1');
  const start = Number(/startxref\n(\d+)\n%%EOF\n?$/.exec(text)?.[1] ?? -1);
  const objects = new Map<number, { dict: string; stream?: Buffer }>();
  if (text.slice(start, start + 5) !== 'xref\n') return objects;
  const lines = text.slice(start).split('\n');
  const count = Number(lines[1].split(' ')[1]);
  for (let i = 1; i < count; i++) {
    const offset = Number(lines[2 + i].slice(0, 10));
    const header = `${i} 0 obj\n`;
    if (text.slice(offset, offset + header.length) !== header) return new Map();
    const body = offset + header.length;
    const streamAt = text.indexOf('>>\nstream\n', body);
    const end = text.indexOf('\nendobj\n', body);
    if (streamAt >= 0 && streamAt < end) {
      const dict = text.slice(body, streamAt + 2);
      const length = Number(/\/Length (\d+)/.exec(dict)?.[1] ?? 0);
      const raw = bytes.subarray(streamAt + 10, streamAt + 10 + length);
      objects.set(i, { dict, stream: dict.includes('/FlateDecode') ? inflateSync(raw) : raw });
    } else objects.set(i, { dict: text.slice(body, end) });
  }
  return objects;
}

/**
 * The texts a PDF writes in its embedded face, read the way a reader extracts them: each text's glyphs
 * (hex strings of the Type0 font) looked up in the ToUnicode map, then the glyphs put back in logical
 * order (a right-to-left text is drawn in visual order). Latin runs in Helvetica are left out.
 */
function embeddedTexts(objects: Map<number, { dict: string; stream?: Buffer }>): { texts: string[]; fontFile: boolean; toUnicode: boolean } {
  const type0 = [...objects.values()].find((o) => o.dict.includes('/Subtype /Type0'));
  if (!type0) return { texts: [], fontFile: false, toUnicode: false };
  const cmap = objects.get(Number(/\/ToUnicode (\d+) 0 R/.exec(type0.dict)?.[1]))?.stream?.toString('latin1') ?? '';
  const map = new Map<string, string>();
  for (const [, glyph, unicode] of cmap.matchAll(/<([0-9A-F]{4})> <([0-9A-F]+)>/g)) map.set(glyph, String.fromCharCode(...(unicode.match(/.{4}/g) ?? []).map((h) => Number.parseInt(h, 16))));
  const cid = objects.get(Number(/\/DescendantFonts \[(\d+) 0 R\]/.exec(type0.dict)?.[1]));
  const descriptor = objects.get(Number(/\/FontDescriptor (\d+) 0 R/.exec(cid?.dict ?? '')?.[1]));
  const file = objects.get(Number(/\/FontFile2 (\d+) 0 R/.exec(descriptor?.dict ?? '')?.[1]));
  const texts: string[] = [];
  for (const o of objects.values()) {
    if (!o.stream || !/^<< \/Length \d+( \/Filter \/FlateDecode)? >>$/.test(o.dict)) continue;
    for (const [block] of o.stream.toString('latin1').matchAll(/BT [^\n]*?\/F4 [^\n]*?ET/g)) {
      const glyphs = [...block.matchAll(/<([0-9A-F]+)> Tj/g)].flatMap(([, hex]) => hex.match(/.{4}/g) ?? []);
      // Glyph clusters (a letter and the marks drawn after it) in reverse: the logical order of a right-to-left text.
      const clusters: string[][] = [];
      for (const g of glyphs) {
        const text = map.get(g) ?? '�';
        if (/^\p{M}+$/u.test(text) && clusters.length) clusters[clusters.length - 1].push(text);
        else clusters.push([text]);
      }
      texts.push(clusters.reverse().flat().join(''));
    }
  }
  return { texts, fontFile: Boolean(file?.stream && /\/Length1 \d+/.test(file.dict)), toUnicode: map.size > 0 };
}

/** Bytes of a text in Windows-1256 (Arabic), each character looked up among the decoded bytes. */
function windows1256(text: string): Buffer {
  const decoder = new TextDecoder('windows-1256');
  const table = new Map<string, number>();
  for (let b = 0; b < 256; b++) table.set(decoder.decode(new Uint8Array([b])), b);
  return Buffer.from([...text].map((ch) => table.get(ch) ?? 0x3f));
}

/** A DXF as an Arabic AutoCAD before 2007 writes it: `$DWGCODEPAGE` ANSI_1256, a layer and a text named in Arabic, in that code page. */
const ansi1256Dxf = (layer: string, label: string) =>
  windows1256(
    ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1015', '9', '$DWGCODEPAGE', '3', 'ANSI_1256', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC', '0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '0', 'LAYER', '2', layer, '70', '0', '62', '3', '0', 'ENDTAB', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES', '0', 'TEXT', '8', layer, '10', '-2000', '20', '-3500', '40', '180', '1', label, '0', 'LWPOLYLINE', '8', layer, '90', '4', '70', '1', '10', '-3000', '20', '-4000', '10', '-1000', '20', '-4000', '10', '-1000', '20', '-3000', '10', '-3000', '20', '-3000', '0', 'ENDSEC', '0', 'EOF', ''].join('\r\n'),
  );

/** Dismisses every toast (their close buttons are named in the interface's language). */
const dismissToasts = (smoke: Smoke) => smoke.js(`[...document.querySelectorAll('x-toast-host button[aria-label]')].forEach((b) => b.click())`);

/**
 * Shows an exported SVG over the window, inline so it is drawn in the app's own faces (Alegreya Sans, IBM
 * Plex Sans Arabic), left to right as a file viewer would, on a grey ground; `viewBox` zooms into part of
 * the sheet (paper mm). Returns once the browser has laid it out with the faces loaded.
 */
async function showSheet(smoke: Smoke, svg: string, viewBox?: string): Promise<boolean> {
  const markup = svg.replace(/^<\?xml[^>]*>\s*/, '');
  return smoke.js<boolean>(`(async () => {
    document.getElementById('smoke-sheet')?.remove();
    const host = document.createElement('div');
    host.id = 'smoke-sheet';
    host.dir = 'ltr';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#8a8580;display:flex;align-items:center;justify-content:center;padding:16px';
    host.innerHTML = ${JSON.stringify(markup)};
    const svg = host.querySelector('svg');
    ${viewBox ? `svg.setAttribute('viewBox', ${JSON.stringify(viewBox)});` : ''}
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.style.background = '#fff';
    document.body.appendChild(host);
    await document.fonts.load('12px "IBM Plex Sans Arabic"', 'مخطط');
    await document.fonts.load('12px "Alegreya Sans"', 'Hollin');
    await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return svg.querySelectorAll('text').length > 0;
  })()`);
}

/**
 * Opens a PDF in Chromium's own viewer (PDFium) in a window of its own, the smoke window having no
 * plugins, and saves a capture once two captures in a row are the same (the viewer has drawn). Only with
 * SMOKE_SHOTS: it is for looking at, the structural checks above are the test.
 */
async function capturePdf(smoke: Smoke, file: string, name: string): Promise<boolean> {
  if (!smoke.shotsDir) return false;
  const win = new BrowserWindow({ width: 1440, height: 900, show: true, title: 'PDF', webPreferences: { plugins: true, sandbox: true } });
  try {
    await win.loadURL(`${pathToFileURL(file).href}#view=FitH`);
    let previous: Buffer | null = null;
    let png: Buffer | null = null;
    const started = Date.now();
    while (Date.now() - started < 20_000) {
      await wait(400);
      png = (await win.webContents.capturePage()).toPNG();
      if (previous && png.equals(previous) && Date.now() - started > 1500) break;
      previous = png;
    }
    if (!png) return false;
    await fs.writeFile(path.join(smoke.shotsDir, `${name}.png`), png);
    return true;
  } finally {
    win.destroy();
    smoke.window.focus();
  }
}

/**
 * Exports and imports in Arabic (milestone 12, step 7), on the Arabic project the earlier Arabic sections
 * drew (a ground floor named الطابق الأرضي with the room غرفة المعيشة, the label مطبخ مفتوح, a stair and a
 * sofa), a label with a measurement and brackets added here: a PDF through the Export dialog (the save
 * picker asked in Arabic with the project's name), whose Arabic texts are in an embedded Type0 face with a
 * ToUnicode map that gives the names back, its title block in Arabic; an SVG with the Arabic texts right to
 * left and the measurement a left-to-right span, drawn in the window and looked at; a DXF that reads back
 * with the names and English layer names; and a DXF from an Arabic AutoCAD (ANSI_1256) imported through
 * Import DXF… with its Arabic layer name and label.
 */
export async function smokeArabicExchange(smoke: Smoke, projectId: string, projectName: string): Promise<void> {
  const { host } = smoke;
  const run = <T = unknown>(id: string, input: unknown = {}) => smoke.run<T>(id, input, { projectId });
  const doc = () => host.projects.session(projectId)!.doc;
  const ground = doc().building.groundLevelId;
  const out = path.join(host.opts.userDataDir, 'exports-arabic');
  await fs.mkdir(out, { recursive: true });
  const ROOM = 'غرفة المعيشة';
  const LABEL = 'مطبخ مفتوح';
  const ENTRANCE = 'المدخل (الرئيسي) · 3600 mm';
  const groundName = doc().levels[ground].name;

  smoke.section('arabic: a PDF with Arabic names');
  const walls = Object.values(doc().levelData[ground].entities).filter((e): e is Extract<Entity, { type: 'wall' }> => e.type === 'wall');
  const xs = walls.flatMap((w) => w.path.v.map((v) => v.p[0]));
  const ys = walls.flatMap((w) => w.path.v.map((v) => v.p[1]));
  await run('plan.entity.add', { levelId: ground, entity: { type: 'label', text: ENTRANCE, at: [(Math.min(...xs) + Math.max(...xs)) / 2, Math.min(...ys) - 1000], size: 250 } });
  await dismissToasts(smoke);
  await smoke.click(`${tab} [data-testid=exchange-export]`);
  await smoke.waitFor('[data-testid=export-format-pdf]');
  await smoke.click('[data-testid=export-format-pdf]');
  await smoke.waitFor('[data-testid=export-levels-all]', 2000);
  await smoke.click('[data-testid=export-levels-all]');
  const pdfPath = path.join(out, `${projectName}.pdf`);
  await fs.rm(pdfPath, { force: true });
  const asked = smoke.dialogs.asked.length;
  smoke.nextDialogPath(pdfPath);
  await smoke.click('[data-testid=export-confirm]');
  const written = await smoke.until(() => fs.stat(pdfPath).then(() => true, () => false), 30_000);
  const save = smoke.dialogs.asked[asked];
  smoke.check('the save picker suggests the Arabic project name', save?.kind === 'pickSavePath' && save.options.defaultPath === `${projectName}.pdf`, save);
  smoke.check('the PDF is written, with an Arabic toast', written && (await smoke.waitFor('[data-testid=toast-message]', 10_000, 'تم تصدير')), await smoke.text('[data-testid=toast-message]'));
  const pdf = written ? await fs.readFile(pdfPath) : Buffer.alloc(0);
  const objects = pdfObjects(pdf);
  const dicts = [...objects.values()].map((o) => o.dict);
  smoke.check('every xref offset points at its object', objects.size > 0, pdf.length);
  smoke.check(
    'the Arabic face is embedded: a Type0 font over a CIDFontType2 (Identity-H), its font file and a ToUnicode map',
    dicts.some((d) => /\/Subtype \/Type0 \/BaseFont \/[A-Z]{6}\+IBMPlexSansArabic \/Encoding \/Identity-H/.test(d)) && dicts.some((d) => d.includes('/Subtype /CIDFontType2') && d.includes('/CIDToGIDMap /Identity')) && dicts.some((d) => d.includes('/FontFile2')),
    dicts.filter((d) => d.includes('/Font')),
  );
  const extracted = embeddedTexts(objects);
  console.log(`arabic PDF: ${pdf.length} bytes; texts through ToUnicode: ${JSON.stringify(extracted.texts)}`);
  smoke.check('its font file is there, with its length, and the map is not empty', extracted.fontFile && extracted.toUnicode, extracted);
  smoke.check(
    'text read through the ToUnicode map gives back the room, the label and the level, in Arabic letters',
    extracted.texts.includes(ROOM) && extracted.texts.includes(LABEL) && extracted.texts.includes(groundName) && extracted.texts.some((t) => t.includes('المدخل') && t.includes('الرئيسي')),
    extracted.texts,
  );
  const month = sheetDate(new Date(), currentLanguage()).replace(/[\d\s]/g, '');
  smoke.check(
    "the title block's words are Arabic: the project, the scale and the date",
    currentLanguage() === 'ar' && extracted.texts.includes(projectName) && extracted.texts.includes('المقياس') && extracted.texts.includes(month),
    { texts: extracted.texts, month },
  );
  const contents = [...objects.values()].filter((o) => o.stream && !o.dict.includes('/Length1') && !o.dict.includes('/Subtype')).map((o) => o.stream!.toString('latin1')).join('\n');
  smoke.check('the measurement stays in Helvetica, at the left of the Arabic, and each Arabic text carries its logical text', contents.includes('(3600 mm \\267 ') && contents.includes('/ActualText <FEFF'), contents.match(/BT [^\n]*3600 mm[^\n]*ET/)?.[0]);
  if (written) smoke.check('Chromium’s PDF viewer draws its first page (capture 112)', !smoke.shotsDir || (await capturePdf(smoke, pdfPath, '112-export-pdf-arabic')));

  smoke.section('arabic: an SVG with Arabic names');
  const svgResult = await run<Exported>('export.plan', { path: path.join(out, 'plan.svg'), format: 'svg', levelIds: [ground], fit: true });
  const svg = await fs.readFile(svgResult.files[0].path, 'utf8');
  smoke.check(
    'the SVG has the Arabic room and label, right to left, in the Arabic face',
    /<text [^>]*direction="rtl"[^>]*>غرفة المعيشة<\/text>/.test(svg) && svg.includes(`>${LABEL}</text>`) && svg.includes("'IBM Plex Sans Arabic'"),
    svg.match(/<text [^>]*direction="rtl"[^>]*>[^<]*<\/text>/g)?.slice(0, 4),
  );
  smoke.check('the measurement is a left-to-right span inside it, and no bidi control is written', svg.includes('<tspan direction="ltr" unicode-bidi="embed">3600 mm</tspan>') && !/[⁦-⁩‎‏]/.test(svg));
  smoke.check('its title block is Arabic and laid out right to left', /<text [^>]*text-anchor="start" direction="rtl"[^>]*>المقياس 1:\d+<\/text>/.test(svg) && svg.includes(`>${groundName}</text>`), svg.slice(svg.indexOf('<g id="title-block"')));
  smoke.check('the exported sheet draws in the window', await showSheet(smoke, svg));
  await smoke.shot('109-export-svg-arabic');
  // The stair and the rooms, and the title block, closer (paper mm of an A3 landscape sheet).
  await showSheet(smoke, svg, '40 4 250 135');
  await smoke.shot('110-export-svg-arabic-plan');
  await showSheet(smoke, svg, '310 252 110 45');
  await smoke.shot('111-export-svg-arabic-title-block');
  await smoke.js(`document.getElementById('smoke-sheet')?.remove()`);

  smoke.section('arabic: a DXF with Arabic names');
  const dxfResult = await run<Exported>('export.plan', { path: path.join(out, 'plan.dxf'), format: 'dxf', levelIds: [ground] });
  const dxfBytes = await fs.readFile(dxfResult.files[0].path);
  const back = readDxf(decodeDxfBytes(dxfBytes).text);
  const dxfTexts = back.entities.flatMap((e) => (e.type === 'TEXT' ? [e.text] : []));
  smoke.check('the DXF is ASCII and reads back with the Arabic names', !/[^\x00-\x7f]/.test(dxfBytes.toString('latin1')) && dxfTexts.includes(ROOM) && dxfTexts.includes(LABEL) && dxfTexts.includes(ENTRANCE), dxfTexts);
  smoke.check('its CAD layers keep their English names', back.layers.some((l) => l.name === 'Rooms') && back.layers.some((l) => l.name === 'Labels'), back.layers.map((l) => l.name));

  smoke.section('arabic: an ANSI_1256 DXF imported');
  const layer = 'مخطط قديم';
  const label = 'غرفة الطعام';
  const legacy = path.join(out, 'legacy-1256.dxf');
  await fs.writeFile(legacy, ansi1256Dxf(layer, label));
  await dismissToasts(smoke);
  smoke.nextDialogPath(legacy);
  await smoke.click(`${tab} [data-testid=exchange-import-dxf]`);
  smoke.check('Import DXF… probes it and shows its Arabic layer', await smoke.waitFor(`[data-testid=import-dxf-layer][data-name="${layer}"]`, 10_000), await smoke.text('[data-testid=import-dxf-layers]'));
  await smoke.shots('113-import-dxf-arabic');
  await smoke.click('[data-testid=import-dxf-confirm]');
  smoke.check('the import says in Arabic what it brought in', await smoke.waitFor('[data-testid=toast-message]', 15_000, 'تم استيراد'), await smoke.text('[data-testid=toast-message]'));
  smoke.check('the Layers panel lists the Arabic layer', await smoke.waitFor(`${tab} [data-testid=layer-row][data-name="DXF ${layer}"]`, 5000));
  smoke.check('and the label came in as written', await smoke.until(() => Object.values(doc().levelData[ground].entities).some((e) => e.type === 'label' && e.text === label)));
  await dismissToasts(smoke);
  await smoke.click(`${tab} [data-testid=project-undo]`);
  smoke.check('one undo takes the import back', await smoke.gone(`${tab} [data-testid=layer-row][data-name="DXF ${layer}"]`));
}
