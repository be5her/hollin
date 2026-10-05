import { describe, expect, it } from 'vitest';
import { BRANDING } from './branding';
import { ConfigPatchSchema, defaultConfig, mergeConfig } from './config';
import { isId, newId } from './ids';

describe('config', () => {
  it('has defaults for every section', () => {
    const config = defaultConfig();
    expect(config.appearance.theme).toBe('system');
    expect(config.units).toEqual({ system: 'metric', metricUnit: 'mm', imperialStyle: 'ft-in', precision: 0, fraction: 16 });
    expect(config.mcp).toEqual({ enabled: true, port: BRANDING.defaultMcpPort, allowMutations: false });
    expect(config.ai.model).toBe('claude-opus-5-5');
    expect(config.session).toEqual({ openProjects: [], activeProjectId: null });
  });

  it('merges a patch one level deep, keeping the other keys of a section', () => {
    const next = mergeConfig(defaultConfig(), { mcp: { port: 9000 } });
    expect(next.mcp).toEqual({ enabled: true, port: 9000, allowMutations: false });
  });

  it('normalises an old or hand-edited file field by field', () => {
    const loaded = mergeConfig(defaultConfig(), {
      appearance: { theme: 'purple' },
      units: { system: 'imperial', precision: 99, fraction: 3 },
      mcp: 'yes',
      legacySection: { a: 1 },
      session: { openProjects: ['prj_1', 2] },
    });
    expect(loaded.appearance.theme).toBe('system');
    expect(loaded.units).toMatchObject({ system: 'imperial', precision: 0, fraction: 16 });
    expect(loaded.mcp).toEqual(defaultConfig().mcp);
    expect(loaded).not.toHaveProperty('legacySection');
    expect(loaded.session.openProjects).toEqual([]);
    expect(mergeConfig(null, 'garbage')).toEqual(defaultConfig());
  });

  it('validates patches strictly', () => {
    expect(ConfigPatchSchema.safeParse({ mcp: { port: 9000 } }).success).toBe(true);
    expect(ConfigPatchSchema.safeParse({ mcp: { port: 'x' } }).success).toBe(false);
    expect(ConfigPatchSchema.safeParse({ nope: {} }).success).toBe(false);
  });
});

describe('ids', () => {
  it('makes prefixed, lowercase, unambiguous ids', () => {
    const id = newId('lvl');
    expect(id).toMatch(/^lvl_[0-9a-hjkmnp-tv-z]{16}$/);
    expect(isId(id)).toBe(true);
    expect(isId(newId())).toBe(true);
    expect(isId('lvl_ABC')).toBe(false);
    expect(new Set(Array.from({ length: 2000 }, () => newId())).size).toBe(2000);
  });
});
