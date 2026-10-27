import { describe, expect, it } from 'vitest';
import { TITLE_BLOCK, fitText, textWidthEm, titleBlock, winAnsi } from './paper';

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

  it('fits the project and the level name inside the frame', () => {
    const block = titleBlock(420, { title: 'X'.repeat(80), levelName: 'Y'.repeat(80), scale: 100, date: '2026-10-27' });
    const [left, right] = [420 - 10 - TITLE_BLOCK.width, 420 - 10];
    for (const t of block.texts) expect(t.at[0] + (t.align === 'left' ? widthMm(t) : 0)).toBeLessThanOrEqual(right - 3 + 1e-9);
    expect(block.texts.every((t) => t.at[0] >= left)).toBe(true);
  });
});
