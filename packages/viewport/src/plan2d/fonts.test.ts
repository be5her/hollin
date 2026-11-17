import { describe, expect, it } from 'vitest';
import { loadPlanFonts } from './theme';

const theme = { fontSans: "'Alegreya Sans'", fontMono: "'IBM Plex Mono'" };
const fontSet = (load: () => Promise<unknown>) => ({ load }) as unknown as FontFaceSet;

describe('loadPlanFonts', () => {
  it('settles when the faces have loaded, Latin and Arabic', async () => {
    const asked: string[] = [];
    await loadPlanFonts({ load: (font: string, text?: string) => (asked.push(`${font}|${text ?? ''}`), Promise.resolve([])) } as unknown as FontFaceSet, theme);
    expect(asked).toHaveLength(6);
    expect(asked.some((a) => a.endsWith('|مخطط'))).toBe(true);
  });

  it('never rejects', async () => {
    await expect(loadPlanFonts(fontSet(() => Promise.reject(new Error('no font'))), theme)).resolves.toBeUndefined();
    await expect(
      loadPlanFonts(
        fontSet(() => {
          throw new Error('bad font string');
        }),
        theme,
      ),
    ).resolves.toBeUndefined();
  });

  it('gives up waiting on a load that never settles', async () => {
    const started = Date.now();
    await loadPlanFonts(fontSet(() => new Promise(() => undefined)), theme, 50);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
