import { afterEach, describe, expect, it } from 'vitest';
import { ar } from '../i18n/ar';
import { en, type MessageKey } from '../i18n/en';
import { setLanguage } from '../i18n';
import { addLayerOps, addLevelOps, duplicateLevelOps } from './builders';
import { newProjectDoc, nextNumberedName } from './defaults';
import { applyPatch } from './ops';

afterEach(() => setLanguage('en'));

const names = (doc: ReturnType<typeof newProjectDoc>) => ({
  levels: Object.values(doc.levels).map((l) => l.name),
  layers: Object.values(doc.layers).map((l) => l.name),
});

describe('default names', () => {
  it('are the English ones in English, byte for byte', () => {
    const doc = newProjectDoc({ name: 'House' });
    expect(names(doc)).toEqual({ levels: ['Ground floor'], layers: ['Structure', 'Interior', 'Decor'] });
    const { ops } = addLevelOps(doc);
    expect(ops.find((o) => o.c === 'level')).toMatchObject({ v: { name: 'Level 1' } });
  });

  it('are written in the language of the moment and stay as written', () => {
    setLanguage('ar');
    let doc = newProjectDoc({ name: 'بيت' });
    expect(names(doc)).toEqual({ levels: ['الطابق الأرضي'], layers: ['إنشائية', 'داخلية', 'ديكور'] });
    const level = addLevelOps(doc);
    doc = applyPatch(doc, level.ops);
    expect(doc.levels[level.levelId].name).toBe('الطابق 1');
    const basement = addLevelOps(doc, { position: 'bottom' });
    expect(basement.ops.find((o) => o.c === 'level')).toMatchObject({ v: { name: 'القبو 1' } });
    const layer = addLayerOps(doc, { levelId: level.levelId, kind: 'interior' });
    expect(layer.ops[0]).toMatchObject({ v: { name: 'داخلية 2' } });
    const copy = duplicateLevelOps(doc, level.levelId);
    expect(copy.ops.find((o) => o.c === 'level')).toMatchObject({ v: { name: 'الطابق 1 (نسخة)' } });
    // A switch back to English keeps what was written.
    setLanguage('en');
    expect(doc.levels[level.levelId].name).toBe('الطابق 1');
  });

  it('number on from the names of every language', () => {
    expect(nextNumberedName('defaults.level.numbered', ['Level 1'])).toBe('Level 2');
    setLanguage('ar');
    // "Level 1" (made in English) takes 1, so Arabic adds the second level as 2, not as another 1.
    expect(nextNumberedName('defaults.level.numbered', ['Ground floor', 'Level 1'])).toBe('الطابق 2');
    expect(nextNumberedName('defaults.room', ['غرفة 1', 'room 2'])).toBe('غرفة 3');
    setLanguage('en');
    expect(nextNumberedName('defaults.room', ['غرفة 1'])).toBe('Room 2');
  });

  it('and History labels have their own Arabic', () => {
    // The catalog types require every key; this catches an Arabic text left in English by mistake.
    const same = new Set<MessageKey>(['defaults.layer.numbered']);
    for (const key of Object.keys(en) as MessageKey[]) {
      if (!/^(defaults|labels)\./.test(key) || same.has(key)) continue;
      expect(ar[key], key).not.toEqual(en[key]);
    }
  });
});
