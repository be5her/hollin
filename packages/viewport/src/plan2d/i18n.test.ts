import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage, type Vec2 } from '@studio/core';
import { highlightTag } from './highlights';
import { DEFAULT_SNAP_SETTINGS, SnapIndex, snapPoint } from './snap';
import { WallTool } from './tools/wall';
import type { ToolHost } from './tools/tool';

/** What the canvas says follows the process language, which the renderer's I18n keeps in step. */
describe('the canvas in Arabic', () => {
  afterEach(() => setLanguage('en'));

  it('names snaps and tracked directions in the language of the moment', () => {
    const idx = new SnapIndex();
    idx.build({}, null);
    const from: Vec2 = [0, 0];
    const cursor: Vec2 = [2000 * Math.cos((128 * Math.PI) / 180), 2000 * Math.sin((128 * Math.PI) / 180)];
    const previous = [{ direction: [Math.cos((37 * Math.PI) / 180), Math.sin((37 * Math.PI) / 180)] as Vec2, name: 'previous' }];
    expect(snapPoint(idx, cursor, 100, DEFAULT_SNAP_SETTINGS, { from, relativeTo: previous })?.label).toBe('Perpendicular to previous');
    setLanguage('ar');
    expect(snapPoint(idx, cursor, 100, DEFAULT_SNAP_SETTINGS, { from, relativeTo: previous })?.label).toBe('عمودي على الضلع السابق');
    expect(snapPoint(idx, [480, 520], 100, { ...DEFAULT_SNAP_SETTINGS, grid: true, gridSpacing: 500 })?.label).toBe('الشبكة');
  });

  it("writes Otto's tag in Arabic, the label kept between isolates", () => {
    expect(highlightTag('Add a 3 m wall', 0)).toBe('Otto · Add a 3 m wall · now');
    expect(highlightTag('Add a 3 m wall', 25_000)).toBe('Otto · Add a 3 m wall · 20 s ago');
    setLanguage('ar');
    expect(highlightTag('إضافة جدار', 0)).toBe('Otto · ⁨إضافة جدار⁩ · الآن');
    expect(highlightTag('', 65_000)).toBe('Otto · ⁨تعديل⁩ · قبل دقيقة');
  });

  it("gives a tool's hint in the language asked for, key names in Latin", () => {
    const tool = new WallTool({} as ToolHost);
    expect(tool.hint()).toBe('Click the start of a wall · V: select');
    setLanguage('ar');
    expect(tool.hint()).toBe('انقر بداية الجدار · V: تحديد');
  });
});
