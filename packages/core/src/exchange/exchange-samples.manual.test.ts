import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { DEFAULT_RULE_LIMITS } from '../config';
import { deriveLevels } from '../doc/derive';
import type { ProjectDoc } from '../doc/schema';
import { planDrawing, type PlanDrawing } from './drawing';
import { drawingToDxf } from './dxf';
import { buildingToGlb } from './gltf';
import { setLanguage, type Language } from '../i18n';
import { TABLE_REF, arabicHouse, drawingHouse, gltfHouse, tableGlb } from './house.fixture';
import { pdfLayouts, drawingToPdf } from './pdf';
import { drawingToSvg } from './svg';

/*
 * Not a unit test: writes sample exports of the test houses for readers outside the app (ezdxf,
 * pypdf, gltf-validator, a browser), with a manifest of what each file should hold. Excluded from
 * `npm test`; run it alone with the output folder in EXCHANGE_SAMPLES_DIR:
 *
 *   EXCHANGE_SAMPLES_DIR=<dir> npx vitest run packages/core/src/exchange/exchange-samples.manual.test.ts
 *
 * The exchange module's README says what was checked with these files and what was found.
 */

const DIR = process.env.EXCHANGE_SAMPLES_DIR;
const DATE = '2026-10-28';
/** The face the app embeds in a PDF for Arabic text. */
const ARABIC_FONT = new Uint8Array(readFileSync(new URL('../../../../resources/fonts/IBMPlexSansArabic-Regular.ttf', import.meta.url)));

/** What a reader should find in a drawing's files: per layer, the primitives in order (fills that a DXF does not hatch flagged), the texts, the arcs. */
function manifest(d: PlanDrawing) {
  return {
    levelId: d.levelId,
    levelName: d.levelName,
    bounds: d.bounds,
    layers: d.layers.map((l) => ({
      name: l.name,
      kind: l.kind,
      hatch: l.hatch,
      primitives: l.primitives.map((p) =>
        p.type === 'stroke'
          ? { type: 'stroke', closed: p.closed, dash: p.dash ?? null, segs: p.segs.map((s) => (s.k === 'line' ? { k: 'line', a: s.a, b: s.b } : { k: 'arc', a: s.a, b: s.b, center: s.center, radius: s.radius, sweep: s.sweep })) }
          : p.type === 'fill'
            ? { type: 'fill', hatched: (l.hatch || Boolean(p.mark)) && p.rings.some((r) => r.length >= 3), rings: p.rings.length }
            : { type: 'text', text: p.text, at: p.at, height: p.height, rotation: p.rotation },
      ),
    })),
  };
}

const safe = (name: string) => name.replace(/[^\p{L}\p{M}\p{N}_.-]+/gu, '_');

function writeSet(dir: string, prefix: string, doc: ProjectDoc, assetBytes?: (ref: string) => Uint8Array | undefined, date = DATE) {
  const levels = deriveLevels(doc);
  const drawings = levels.map((l) => planDrawing(doc, l.id, { limits: DEFAULT_RULE_LIMITS }));
  const files: string[] = [];
  const put = (name: string, data: string | Uint8Array) => {
    writeFileSync(path.join(dir, name), data);
    files.push(name);
  };
  for (const d of drawings) {
    put(`${prefix} - ${safe(d.levelName)}.dxf`, drawingToDxf(d));
    put(`${prefix} - ${safe(d.levelName)}.svg`, drawingToSvg(d, { page: 'A3', orientation: 'landscape', scale: 100, title: doc.meta.name, date }));
  }
  const pages = drawings.map((drawing) => ({ drawing, title: doc.meta.name }));
  const pdfs: Record<string, { scales: number[] }> = {};
  for (const [name, scale, deflate] of [
    [`${prefix} - A3 1-100.pdf`, 100, true],
    [`${prefix} - A3 fit.pdf`, 'fit', true],
    [`${prefix} - A3 1-100 raw.pdf`, 100, false],
  ] as const) {
    const options = { page: 'A3' as const, orientation: 'landscape' as const, scale, date, arabicFont: ARABIC_FONT, ...(deflate ? { deflate: (b: Uint8Array) => deflateSync(b) } : {}) };
    put(name, drawingToPdf(pages, options));
    pdfs[name] = { scales: pdfLayouts(pages, options).map((l) => l.scale) };
  }
  // Too large for the sheet at that scale: clipped to the drawing area, the title block clear.
  const big = { page: 'A4' as const, orientation: 'portrait' as const, scale: 20, date, arabicFont: ARABIC_FONT };
  put(`${prefix} - A4 1-20 clipped.svg`, drawingToSvg(drawings[0], { ...big, title: doc.meta.name }));
  put(`${prefix} - A4 1-20 clipped.pdf`, drawingToPdf(pages, big));
  pdfs[`${prefix} - A4 1-20 clipped.pdf`] = { scales: pdfLayouts(pages, big).map((l) => l.scale) };
  const glb = buildingToGlb(doc, { limits: DEFAULT_RULE_LIMITS, assetBytes, generator: 'exchange samples' });
  expect(glb.skipped).toEqual([]);
  put(`${prefix}.glb`, glb.glb);
  return { project: doc.meta.name, files, drawings: drawings.map(manifest), pdfs, glb: { nodes: glb.nodes, triangles: glb.triangles, levels: levels.map((l) => doc.levels[l.id]?.name) } };
}

/** Runs `write` with the process language set, then back to English. */
function inLanguage<T>(language: Language, write: () => T): T {
  setLanguage(language);
  try {
    return write();
  } finally {
    setLanguage('en');
  }
}

describe.runIf(DIR)('exchange samples', () => {
  it('writes the test houses as DXF, SVG, PDF and GLB with a manifest', () => {
    const dir = DIR!;
    mkdirSync(dir, { recursive: true });
    const table = tableGlb();
    const sets = {
      drawing: writeSet(dir, 'drawing-house', drawingHouse().doc),
      gltf: writeSet(dir, 'gltf-house', gltfHouse().doc, (ref) => (ref === TABLE_REF ? table : undefined)),
      // The house named in Arabic, its sheets written by an Arabic interface (the title block's words, its layout
      // and the date) and by an English one.
      arabic: inLanguage('ar', () => writeSet(dir, 'arabic-house', arabicHouse().doc, undefined, '17 نوفمبر 2026')),
      arabicInEnglish: inLanguage('en', () => writeSet(dir, 'arabic-house-en', arabicHouse().doc)),
    };
    writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ date: DATE, sets }, null, 1));
    expect(sets.drawing.files.length).toBeGreaterThan(0);
  });
});
