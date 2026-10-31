import { describe, expect, it } from 'vitest';
import { BRANDING } from '../branding';
import { PAGE_MARGIN, TITLE_BLOCK, TITLE_BLOCK_ACCENT, drawingArea, fitText, textWidthEm, titleBlock, winAnsi } from './paper';

const widthMm = (t: { text: string; size: number }) => textWidthEm(winAnsi(t.text)) * t.size;
const room = TITLE_BLOCK.width - 6;

describe('the title block', () => {
  it('keeps a name that fits at its size', () => {
    expect(fitText('House', 4, room)).toEqual({ text: 'House', size: 4 });
  });

  it('shrinks a long name to fit, down to 70 % of its size', () => {
    const name = 'Community centre and library, east wing extension';
    expect(widthMm({ text: name, size: 4 })).toBeGreaterThan(room);
    const fitted = fitText(name, 4, room);
    expect(fitted.text).toBe(name);
    expect(fitted.size).toBeLessThan(4);
    expect(fitted.size).toBeGreaterThanOrEqual(2.8);
    expect(widthMm(fitted)).toBeCloseTo(room, 9);
  });

  it('cuts a name too long even then short with an ellipsis', () => {
    const name = 'The very long name of a project that nobody would ever fit in a title block';
    const fitted = fitText(name, 4, room);
    expect(fitted.size).toBeCloseTo(2.8, 9);
    expect(fitted.text.endsWith('…')).toBe(true);
    expect(name.startsWith(fitted.text.slice(0, -1))).toBe(true);
    expect(widthMm(fitted)).toBeLessThanOrEqual(room);
    expect(widthMm({ text: name.slice(0, fitted.text.length) + '…', size: 2.8 })).toBeGreaterThan(room);
  });

  it('lays the wordmark, project, level, scale and date out in three rows of 8 mm', () => {
    const block = titleBlock(420, { title: 'Kitchen extension', levelName: 'Ground floor', scale: 50, date: '2026-10-31' });
    const [x0, x1, y0, y1] = [320, 410, 10, 34];
    expect(block.lines).toContainEqual([[x0, y1 - 8], [x1, y1 - 8]]);
    expect(block.lines).toHaveLength(5);
    const [name, stop, project, level, scale, date] = block.texts;
    expect(name).toMatchObject({ text: BRANDING.productName, at: [x0 + 3, y1 - 6], bold: true, align: 'left' });
    expect(name.size * 0.72).toBeCloseTo(3.2, 9);
    expect(stop).toMatchObject({ text: '.', bold: true, color: TITLE_BLOCK_ACCENT });
    expect(stop.at[0]).toBeGreaterThan(x0 + 3 + 10);
    expect(project).toMatchObject({ text: 'Kitchen extension', at: [x1 - 3, y1 - 6], size: 4, align: 'right' });
    expect(level).toMatchObject({ text: 'Ground floor', at: [x0 + 3, y1 - 13], size: 3 });
    expect(scale).toMatchObject({ text: 'Scale 1:50', at: [x0 + 3, y0 + 2.8], size: 2.8 });
    expect(date).toMatchObject({ text: '2026-10-31', at: [x1 - 3, y0 + 2.8], align: 'right' });
  });

  it('keeps a long project name clear of the wordmark', () => {
    const block = titleBlock(420, { title: 'Z'.repeat(80), levelName: 'L', scale: 100 });
    const stop = block.texts[1];
    const project = block.texts[2];
    expect(project.at[0] - widthMm(project)).toBeGreaterThan(stop.at[0] + stop.size * 0.3);
  });

  it('is reserved below the drawing area, never overlapping it', () => {
    expect(drawingArea(420, 297, true).minY).toBe(PAGE_MARGIN + TITLE_BLOCK.height + 4);
    expect(drawingArea(420, 297, false).minY).toBe(PAGE_MARGIN);
  });

  it('fits the project and the level name inside the frame', () => {
    const block = titleBlock(420, { title: 'X'.repeat(80), levelName: 'Y'.repeat(80), scale: 100, date: '2026-10-27' });
    const [left, right] = [420 - 10 - TITLE_BLOCK.width, 420 - 10];
    for (const t of block.texts) expect(t.at[0] + (t.align === 'left' ? widthMm(t) : 0)).toBeLessThanOrEqual(right - 3 + 1e-9);
    expect(block.texts.every((t) => t.at[0] >= left)).toBe(true);
  });
});
