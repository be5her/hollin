import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DARK_SCENE_THEME, DARK_THEME, PLAN_THEME_VARIABLES, SCENE_THEME_VARIABLES } from '@studio/viewport';

/** The variables a block of styles.css sets (`:root` or `.dark`). */
function block(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

describe('the dark render palettes', () => {
  const css = readFileSync(fileURLToPath(new URL('../../../src/renderer/src/styles.css', import.meta.url)), 'utf8');
  const dark = block(css, '.dark');

  it('are the colours of the .dark block of styles.css', () => {
    expect(Object.keys(dark).length).toBeGreaterThan(20);
    for (const [key, variable] of Object.entries(PLAN_THEME_VARIABLES)) {
      if (key === 'fontSans' || key === 'fontMono') continue;
      expect([key, DARK_THEME[key as keyof typeof DARK_THEME]]).toEqual([key, dark[variable]]);
    }
    for (const [key, variable] of Object.entries(SCENE_THEME_VARIABLES)) expect([key, DARK_SCENE_THEME[key as keyof typeof DARK_SCENE_THEME]]).toEqual([key, dark[variable]]);
  });
});
