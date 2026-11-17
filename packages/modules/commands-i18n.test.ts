import { CommandRegistry, arCommandTitles, commandTitle } from '@studio/core';
import { describe, expect, it } from 'vitest';
import { hostCommands } from '../../src/main/host-commands';
import type { Host } from '../../src/main/host';
import { mainModules } from './main';

/**
 * Every command the palette shows (or the assistant's tool cards name) has an Arabic title in
 * `packages/core/src/i18n/ar/commands.ts`. `PENDING_MODULES` lists the modules whose titles are not
 * written yet; each step of milestone 12 removes the ones it finished, and never adds to it.
 */
const PENDING_MODULES = new Set(['building', 'plan', 'decor', 'rules']);

function registry(): CommandRegistry {
  const registry = new CommandRegistry();
  // The handlers are never run here, so the host they close over is not needed.
  registry.registerModule({ id: 'host', commands: hostCommands({} as Host) });
  for (const mod of mainModules) registry.registerModule(mod);
  return registry;
}

describe('command titles in Arabic', () => {
  const reg = registry();
  const modules = reg.listModules();

  it('cover every shown command of the finished modules', () => {
    const missing = modules
      .filter((mod) => !PENDING_MODULES.has(mod.id))
      .flatMap((mod) => mod.commands.filter((c) => !c.hidden && !arCommandTitles[c.id]).map((c) => `${mod.id}: ${c.id}`));
    expect(missing).toEqual([]);
  });

  it('name only commands that exist, never empty', () => {
    const ids = new Set(modules.flatMap((mod) => mod.commands.map((c) => c.id)));
    for (const [id, title] of Object.entries(arCommandTitles)) {
      expect(ids.has(id), `${id} is not a command`).toBe(true);
      expect(title.trim().length, id).toBeGreaterThan(0);
    }
  });

  it('keep the pending list to modules that exist and still lack titles', () => {
    for (const id of PENDING_MODULES) {
      const mod = modules.find((m) => m.id === id);
      expect(mod, `${id} is pending but is not a module`).toBeDefined();
      expect(
        mod!.commands.some((c) => !c.hidden && !arCommandTitles[c.id]),
        `${id} has all its titles: remove it from PENDING_MODULES`,
      ).toBe(true);
    }
  });

  it('are what the palette shows in Arabic, and English stays the definition', () => {
    const info = reg.meta('app.language')!;
    expect(commandTitle(info, 'ar')).toBe(arCommandTitles['app.language']);
    expect(commandTitle(info, 'en')).toBe('App language');
  });
});
