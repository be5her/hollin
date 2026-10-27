import { promises as fs } from 'node:fs';
import os from 'node:os';
import nodePath from 'node:path';
import { CommandRegistry, testHost, type HostApi } from '@studio/core';
import { ProjectService } from '@studio/core/node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mainModules } from '../main';
import { checkedPng, existingFiles, fileSafe, isInside, levelPaths, readDxfFile } from './main';

/** The signature and an IHDR chunk saying width × height, RGBA: all `checkedPng` reads. */
function pngHead(width: number, height: number): string {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  b[24] = 8;
  b[25] = 6;
  return b.toString('base64');
}

describe('export file names', () => {
  it('keeps the path for one level and puts each level name before the extension for several', () => {
    expect(levelPaths('C:/out/Plan.dxf', ['Ground floor'])).toEqual(['C:/out/Plan.dxf']);
    expect(levelPaths('C:/out/Plan.dxf', ['Ground floor', 'Upper'])).toEqual(['C:/out/Plan - Ground floor.dxf', 'C:/out/Plan - Upper.dxf']);
  });

  it('replaces the characters Windows forbids and numbers clashing names', () => {
    expect(fileSafe('A/B: "C"?. ')).toBe('A_B_ _C__');
    expect(fileSafe('...')).toBe('Level');
    expect(levelPaths('/x/p.svg', ['Floor', 'floor', 'Floor'])).toEqual(['/x/p - Floor.svg', '/x/p - floor 2.svg', '/x/p - Floor 3.svg']);
  });
});

describe('export.image: the PNG the window drew', () => {
  it('is taken at the size asked for', () => {
    expect(checkedPng(pngHead(1600, 1200), 1600, 1200).length).toBe(33);
  });

  it('is refused, never written smaller, when the window could not draw that large, or answered no PNG', () => {
    expect(() => checkedPng(pngHead(4096, 2048), 4096, 4096)).toThrow(expect.objectContaining({ code: 'UNAVAILABLE', message: expect.stringContaining('4096 × 2048') }));
    expect(() => checkedPng(Buffer.from('not a png at all, not even close to one').toString('base64'), 64, 64)).toThrow(expect.objectContaining({ code: 'UNAVAILABLE' }));
  });
});

describe('export paths', () => {
  it('are inside a folder when equal to it or below it, without case on Windows only', () => {
    expect(isInside('C:\\Lib\\Projects\\a.pdf', 'c:\\lib', 'win32')).toBe(true);
    expect(isInside('C:/LIB', 'C:\\Lib\\', 'win32')).toBe(true);
    expect(isInside('C:\\Library2\\a.pdf', 'C:\\Lib', 'win32')).toBe(false);
    expect(isInside('/lib/x/a.pdf', '/lib', 'linux')).toBe(true);
    expect(isInside('/LIB/x/a.pdf', '/lib', 'linux')).toBe(false);
    expect(isInside('/lib2/a.pdf', '/lib', 'linux')).toBe(false);
  });
});

describe('the export and import commands', () => {
  let root: string;
  let out: string;
  let service: ProjectService;
  let registry: CommandRegistry;
  let host: HostApi;
  let projectId: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(nodePath.join(os.tmpdir(), 'studio-exchange-lib-'));
    out = await fs.mkdtemp(nodePath.join(os.tmpdir(), 'studio-exchange-out-'));
    registry = new CommandRegistry();
    for (const mod of mainModules) registry.registerModule(mod);
    const base = testHost();
    host = { ...base, execute: (id, input, ctx) => registry.execute(id, input, ctx), meta: (id) => registry.meta(id) } as typeof base;
    service = new ProjectService({ libraryRoot: root, defaultLibraryRoot: root, appVersion: 'test', emit: host.emit, rememberSession: async () => {}, rememberLibrary: async () => {}, session: { debounceMs: 20, maxWaitMs: 100 } });
    Object.defineProperty(host, 'projects', { value: service });
    await service.start({ openProjects: [], activeProjectId: null });
    projectId = (await service.open((await service.create({ name: 'House' })).id)).id;
  });
  afterEach(async () => {
    await service.stop();
    await fs.rm(root, { recursive: true, force: true, maxRetries: 3 });
    await fs.rm(out, { recursive: true, force: true, maxRetries: 3 });
  });

  const run = async <T = unknown>(id: string, input: unknown) => registry.execute<T>(id, input, { caller: 'ui', host, project: await service.resolve(projectId) });
  type Exported = { files: { path: string }[] };

  it('refuses to replace the files of several levels unless asked to, naming them, and replaces a single file', async () => {
    await run('building.level.add', { name: 'Upper' });
    const target = nodePath.join(out, 'Plan.dxf');
    const first = await run<Exported>('export.plan', { path: target, format: 'dxf' });
    expect(first.files.map((f) => nodePath.basename(f.path))).toEqual(['Plan - Ground floor.dxf', 'Plan - Upper.dxf']);
    await fs.writeFile(first.files[1].path, 'mine');
    const refused = run('export.plan', { path: target, format: 'dxf' });
    await expect(refused).rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringContaining('Plan - Ground floor.dxf, Plan - Upper.dxf'), details: { existing: first.files.map((f) => f.path) } });
    expect(await fs.readFile(first.files[1].path, 'utf8')).toBe('mine');
    await run('export.plan', { path: target, format: 'dxf', overwrite: true });
    expect(await fs.readFile(first.files[1].path, 'utf8')).toContain('SECTION');
    const single = nodePath.join(out, 'One.svg');
    await fs.writeFile(single, 'old');
    await run('export.plan', { path: single, format: 'svg', levelIds: [service.session(projectId)!.doc.building.groundLevelId] });
    expect(await fs.readFile(single, 'utf8')).toContain('<svg ');
  });

  it('refuses every export into the project library, in any letter case on Windows', async () => {
    const inside = nodePath.join(process.platform === 'win32' ? root.toUpperCase() : root, 'projects', 'x');
    const refused = expect.objectContaining({ code: 'INVALID_INPUT', message: expect.stringContaining('inside the project library') });
    await expect(run('export.plan', { path: `${inside}.pdf`, format: 'pdf' })).rejects.toThrow(refused);
    await expect(run('export.building', { path: `${inside}.glb` })).rejects.toThrow(refused);
    await expect(run('export.image', { path: `${inside}.png` })).rejects.toThrow(refused);
    await expect(run('export.plan', { path: root, format: 'svg' })).rejects.toThrow(refused);
    expect((await run<{ path: string }>('export.building', { path: nodePath.join(out, 'House.glb') })).path).toBe(nodePath.join(out, 'House.glb'));
  });

  it('refuses a DXF larger than the limit before reading it', async () => {
    const file = nodePath.join(out, 'big.dxf');
    await fs.writeFile(file, '0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n');
    await expect(readDxfFile(file, 10)).rejects.toThrow(expect.objectContaining({ code: 'INVALID_INPUT', message: expect.stringContaining('are not imported') }));
    await expect(readDxfFile(file)).resolves.toBeTruthy();
    expect(await existingFiles([file])).toEqual([]);
  });
});
