import { promises as fs } from 'node:fs';
import { deflateSync } from 'node:zlib';
import nodePath from 'node:path';
import {
  BRANDING,
  DRAWING_LAYER_KINDS,
  PAPER_SIZES,
  StudioError,
  assetFileOf,
  buildingToGlb,
  defineCommand,
  defineModule,
  drawingToDxf,
  drawingToPdf,
  drawingToSvg,
  dxfExtents,
  dxfLayerSummary,
  dxfToOps,
  dxfUnitScale,
  DXF_UNIT_NAMES,
  editProject,
  pdfLayouts,
  planDrawing,
  readDxf,
  readPngHeader,
  svgLayout,
  today,
  UnitSettingsSchema,
  type DxfFile,
  type PlanDrawing,
} from '@studio/core';
import { writeFileAtomic } from '@studio/core/node';
import { z } from 'zod';
import { requestSnapshot } from '../plan/main';

/** How long a render may take in the window: a 4096 px building on software GL is slow. */
const RENDER_TIMEOUT = 60_000;

/**
 * The PNG the window drew, checked against the size asked for: its IHDR must say exactly
 * `width` × `height`, so a render WebGL had to shrink is refused (UNAVAILABLE), never written smaller.
 */
export function checkedPng(base64: string, width: number, height: number): Buffer {
  const bytes = Buffer.from(base64, 'base64');
  const header = readPngHeader(bytes);
  if (!header) throw new StudioError('UNAVAILABLE', 'The window did not answer with a PNG image.');
  if (header.width !== width || header.height !== height) throw new StudioError('UNAVAILABLE', `The window could draw only ${header.width} × ${header.height} px, not the ${width} × ${height} asked for; ask for a smaller image.`);
  return bytes;
}

/** A file name made of a level's name: the characters Windows forbids replaced, trimmed of dots and spaces. */
export function fileSafe(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .trim()
    .replace(/[. ]+$/, '');
  return cleaned || 'Level';
}

/** One path per level: the path itself for one level, else the level's name before the extension (`Plan - Ground floor.dxf`), numbered when two names clash. */
export function levelPaths(path: string, names: readonly string[]): string[] {
  if (names.length === 1) return [path];
  const ext = nodePath.extname(path);
  const base = path.slice(0, path.length - ext.length);
  const used = new Set<string>();
  return names.map((name) => {
    const safe = fileSafe(name);
    let candidate = `${base} - ${safe}${ext}`;
    for (let i = 2; used.has(candidate.toLowerCase()); i++) candidate = `${base} - ${safe} ${i}${ext}`;
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

/**
 * Reads a DXF file for import: an absolute path (INVALID_INPUT otherwise), NOT_FOUND when missing,
 * decoded as UTF-8 (a BOM dropped by the reader), or as Latin-1 when it is not valid UTF-8 (older
 * ANSI files); a binary DXF or a file without sections is refused.
 */
export async function readDxfFile(path: string): Promise<DxfFile> {
  if (!nodePath.isAbsolute(path)) throw new StudioError('INVALID_INPUT', 'path must be a full (absolute) file path.');
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(path);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') throw new StudioError('NOT_FOUND', `No file at ${path}.`);
    if (code === 'EISDIR') throw new StudioError('INVALID_INPUT', `${path} is a folder, not a DXF file.`);
    throw err;
  }
  if (bytes.subarray(0, 18).toString('latin1') === 'AutoCAD Binary DXF') throw new StudioError('INVALID_INPUT', 'This is a binary DXF; save it as an ASCII DXF and import that.');
  let text = bytes.toString('utf8');
  if (text.includes('\uFFFD')) text = bytes.toString('latin1');
  if (!/^\s*0\s*\r?\n\s*SECTION\s*$/m.test(text.slice(0, 4096).replace(/^\uFEFF/, ''))) throw new StudioError('INVALID_INPUT', `${nodePath.basename(path)} is not a DXF file (no SECTION at its start).`);
  return readDxf(text);
}

/**
 * Exports and imports. `export.plan` writes levels' plans as DXF, SVG or PDF from the pure writers in
 * `@studio/core` (`planDrawing`, `drawingToDxf`, `drawingToSvg`, `drawingToPdf`); `export.building`
 * writes the building in 3D as a GLB (`buildingToGlb`); `export.image` has the window draw a PNG
 * render the way `view.snapshot` does (`requestSnapshot` from the plan module) and writes it.
 * Writing files outside the library is gated for agents. `import.dxf` reads a DXF (`readDxf`) and adds
 * its drawing to a level as shapes, separators and labels on `DXF <layer>` layers (`dxfToOps`), one
 * undoable transaction; `import.dxf.probe` reads a file's units and layers without touching anything.
 */
export const exchangeModule = defineModule({
  id: 'exchange',
  commands: [
    defineCommand({
      id: 'export.plan',
      title: 'Export plan drawing',
      description:
        'Writes levels of the open project as plan drawings to `path` (a full file path), as DXF (AutoCAD R2000, millimetres, one CAD layer per drawing layer), SVG or PDF (vector, on a paper sheet at a drawing scale, with a title block). DXF and SVG write one file per level: with several levels the level name is put before the extension (`Plan - Ground floor.svg`); PDF writes one file with a page per level. `levelIds` defaults to every level, bottom to top; `scale` is the 1:N denominator (default 100); `page` and `orientation` set the SVG/PDF sheet (default A3 landscape); `fit` picks, per level, the largest of 1:20 ... 1:1000 that fits the sheet; `layers` limits the drawing to some layer kinds; `units` sets how lengths and areas are written (any of the Settings fields; the rest from Settings). Writes outside the library, so it is gated. Returns the files written (path, bytes, level) and, per level, the scale used and `fits`: false when the level is larger than the sheet at a fixed scale (it is cut off at the margins; use `fit` or a smaller scale).',
      scope: 'project',
      mutating: true,
      input: z.object({
        path: z.string().min(1).describe('A full file path; for several levels in DXF or SVG the level name is inserted before the extension'),
        format: z.enum(['dxf', 'svg', 'pdf']),
        levelIds: z.array(z.string()).min(1).optional().describe('Levels to export, from building_get; every level, bottom to top, by default'),
        scale: z.number().positive().max(100000).default(100).describe('The drawing scale denominator: 100 for 1:100'),
        page: z.enum(PAPER_SIZES).default('A3').describe('Paper size for SVG and PDF'),
        orientation: z.enum(['portrait', 'landscape']).default('landscape'),
        fit: z.boolean().default(false).describe('SVG and PDF: pick the largest standard scale (1:20 to 1:1000) that fits the sheet, instead of `scale`'),
        layers: z.array(z.enum(DRAWING_LAYER_KINDS)).optional().describe('Which layer kinds to draw; all by default'),
        title: z.boolean().default(true).describe('SVG and PDF: a title block with the project, the level, the scale and the date'),
        units: UnitSettingsSchema.partial().strict().optional().describe("The units lengths and areas are written in, e.g. { system: 'imperial' }; the fields left out come from Settings"),
      }),
      handler: async (input, ctx) => {
        if (!nodePath.isAbsolute(input.path)) throw new StudioError('INVALID_INPUT', 'path must be a full (absolute) file path.');
        const project = ctx.project!;
        const doc = project.doc;
        const levelIds = input.levelIds ?? doc.building.stack;
        const missing = levelIds.filter((id) => !doc.levels[id]);
        if (missing.length) throw new StudioError('NOT_FOUND', `No level ${missing.join(', ')} in this project. building_get lists the levels.`);
        const config = ctx.host.config.get();
        const units = { ...config.units, ...input.units };
        const rules = config.rules;
        const drawings: PlanDrawing[] = levelIds.map((id) => planDrawing(doc, id, { units, limits: rules, layers: input.layers }));
        const scale = input.fit ? ('fit' as const) : input.scale;
        const title = input.title ? project.name : undefined;
        const date = today();
        const files: { path: string; levelId?: string; bytes: number }[] = [];
        const levels: { levelId: string; name: string; scale: number; fits: boolean }[] = [];

        if (input.format === 'pdf') {
          const pages = drawings.map((drawing) => ({ drawing, title }));
          const options = { page: input.page, orientation: input.orientation, scale, date, deflate: (bytes: Uint8Array) => deflateSync(bytes) };
          const data = drawingToPdf(pages, options);
          await writeFileAtomic(input.path, data);
          files.push({ path: input.path, bytes: data.length });
          pdfLayouts(pages, options).forEach((l, i) => levels.push({ levelId: drawings[i].levelId, name: drawings[i].levelName, scale: l.scale, fits: l.fits }));
        } else {
          const paths = levelPaths(input.path, drawings.map((d) => d.levelName));
          for (const [i, drawing] of drawings.entries()) {
            let data: string;
            let used = input.scale;
            let fits = true;
            if (input.format === 'dxf') data = drawingToDxf(drawing, { scale: input.scale });
            else {
              const options = { page: input.page, orientation: input.orientation, scale, title, date };
              ({ scale: used, fits } = svgLayout(drawing, options));
              data = drawingToSvg(drawing, options);
            }
            const bytes = Buffer.from(data, 'utf8');
            await writeFileAtomic(paths[i], bytes);
            files.push({ path: paths[i], levelId: drawing.levelId, bytes: bytes.length });
            levels.push({ levelId: drawing.levelId, name: drawing.levelName, scale: used, fits });
          }
        }
        ctx.host.emit('exchange.exported', { projectId: project.id, format: input.format, files: files.map((f) => f.path) });
        return { format: input.format, files, levels };
      },
    }),
    defineCommand({
      id: 'export.building',
      title: 'Export building as glTF',
      description:
        "Writes the open project's building in 3D to `path` (a full file path, usually ending in .glb) as one self-contained glTF 2.0 binary (GLB): geometry, materials and imported furniture models are all inside the file, in metres with y up as glTF requires, so Blender, SketchUp, game engines and web viewers open it as it is. The node tree is a root named after the project, a node per level named after it holding a node per kind of solid (Walls, Slabs, Columns, Glass, Frames, Leaves, Finishes, ...), a node per stair, ramp, ladder, escalator or elevator starting on that level (named by its type), and a node per furniture item named after its model. Colours are those of the 3D view (materials' colour, roughness and metalness, paints, see-through glass); patterns are written as their material's plain colour and lights are not written. `levelIds` defaults to every level; `includeItems` (default true) adds the furniture; `includeFinishes` (default true) the floor, wall and ceiling finishes. Writes outside the library, so it is gated. Returns { path, bytes, nodes, triangles, skipped }, where `skipped` lists the items left out (an imported model whose file is missing).",
      scope: 'project',
      mutating: true,
      input: z.object({
        path: z.string().min(1).describe('A full file path for the .glb file'),
        levelIds: z.array(z.string()).min(1).optional().describe('Levels to export, from building_get; every level by default. A connector goes with the level it starts on'),
        includeItems: z.boolean().default(true).describe('Include the furniture'),
        includeFinishes: z.boolean().default(true).describe('Include floor, wall and ceiling finishes'),
      }),
      handler: async (input, ctx) => {
        if (!nodePath.isAbsolute(input.path)) throw new StudioError('INVALID_INPUT', 'path must be a full (absolute) file path.');
        const project = ctx.project!;
        const doc = project.doc;
        const missing = (input.levelIds ?? []).filter((id) => !doc.levels[id]);
        if (missing.length) throw new StudioError('NOT_FOUND', `No level ${missing.join(', ')} in this project. building_get lists the levels.`);
        // The imported models the items use, read from the project's assets/ before the (synchronous) build.
        const assets = new Map<string, Uint8Array>();
        if (input.includeItems) {
          const refs = new Set<string>();
          for (const level of Object.values(doc.levelData)) for (const e of Object.values(level.entities)) if (e.type === 'item' && e.asset.startsWith('asset:')) refs.add(e.asset);
          for (const ref of refs) {
            const file = assetFileOf(ref);
            const bytes = file && doc.assets[file] ? await ctx.host.projects.readAsset(project.id, file) : undefined;
            if (bytes) assets.set(ref, bytes);
          }
        }
        const { rules } = ctx.host.config.get();
        const built = buildingToGlb(doc, { limits: rules, levelIds: input.levelIds, includeItems: input.includeItems, includeFinishes: input.includeFinishes, assetBytes: (ref) => assets.get(ref), generator: BRANDING.productName });
        await writeFileAtomic(input.path, built.glb);
        ctx.host.emit('exchange.exported', { projectId: project.id, format: 'glb', files: [input.path] });
        return { path: input.path, bytes: built.glb.length, nodes: built.nodes, triangles: built.triangles, skipped: built.skipped };
      },
    }),
    defineCommand({
      id: 'export.image',
      title: 'Export image (PNG)',
      description:
        "Renders a picture of the open project and writes it to `path` (a full file path, usually ending in .png) as a PNG of exactly `width` × `height` pixels (64 to 4096 a side, 1600 × 1200 by default). It draws what `view_snapshot` draws, larger and to a file: `view: 'plan'` (the default) one level's plan from above, `view: '3d'` the whole building in 3D seen from `azimuth` and `elevation` with `display` (every level, one isolated, or cut away at `levelId`), `explode` and `lighting` (day or night). `theme` picks the light palette (the default) or the dark one; `transparent` leaves the background out (no paper colour on the plan, no sky in 3D), for laying the picture over something else. `levelId` defaults to the ground level. Needs the app window, like view_snapshot: fails with UNAVAILABLE when no window draws it in time or when the window cannot draw that large (WebGL caps the 3D size at the GPU's limit; ask for a smaller image then), and with NOT_FOUND when there is nothing to draw yet. Writes outside the library, so it is gated. Returns { path, bytes, width, height, view, levelId, levelName }; it does not return the image itself (use view_snapshot to look).",
      scope: 'project',
      mutating: true,
      input: z.object({
        path: z.string().min(1).describe('A full file path for the .png file'),
        levelId: z.string().optional().describe('Default: the ground level'),
        view: z.enum(['plan', '3d']).default('plan').describe('The plan of a level, or the building in 3D'),
        width: z.number().int().min(64).max(4096).default(1600).describe('Pixels'),
        height: z.number().int().min(64).max(4096).default(1200).describe('Pixels'),
        azimuth: z.number().min(-360).max(360).default(225).describe('3D: degrees counter-clockwise from east the building is seen from (0 east, 90 north, 180 west, 270 south)'),
        elevation: z.number().min(-89).max(89).default(30).describe('3D: degrees above the horizon (89 is from straight above)'),
        display: z.enum(['all', 'isolate', 'cutaway']).default('all').describe('3D: every level, the level alone, or the level and those below it with its walls cut'),
        explode: z.number().min(0).max(1).default(0).describe('3D: 0 as built, 1 spreads each level 4 m above the one below'),
        lighting: z.enum(['day', 'night']).default('day').describe("3D: the sky and the sun, or night with the design's own lights"),
        theme: z.enum(['light', 'dark']).default('light').describe('The light palette (the default) or the dark one'),
        transparent: z.boolean().default(false).describe('Leave the background transparent (no paper colour, no sky)'),
      }),
      handler: async ({ path, levelId: lv, ...render }, ctx) => {
        if (!nodePath.isAbsolute(path)) throw new StudioError('INVALID_INPUT', 'path must be a full (absolute) file path.');
        const project = ctx.project!;
        const doc = project.doc;
        const levelId = lv ?? doc.building.groundLevelId;
        if (!doc.levels[levelId]) throw new StudioError('NOT_FOUND', `No level ${levelId} in this project. building_get lists the levels.`);
        const base64 = await requestSnapshot(ctx.host, { projectId: project.id, levelId, ...render }, RENDER_TIMEOUT);
        const bytes = checkedPng(base64, render.width, render.height);
        await writeFileAtomic(path, bytes);
        ctx.host.emit('exchange.exported', { projectId: project.id, format: 'png', files: [path] });
        return { path, bytes: bytes.length, width: render.width, height: render.height, view: render.view, levelId, levelName: doc.levels[levelId].name };
      },
    }),
    defineCommand({
      id: 'import.dxf.probe',
      title: 'Inspect a DXF file',
      description:
        "Reads a DXF file at `path` (a full file path) without importing anything, so its units and layers can be checked first. Returns { insUnits, units, scale, layers, skipped, paperSpace, extents }: `insUnits` is the file's $INSUNITS code (null when it does not say), `units` its name, `scale` the millimetres per drawing unit import_dxf would use by default (1 when unitless or unknown), `layers` every DXF layer with how many model-space entities it holds (block references expanded), its colour index and whether it is off or frozen (`hidden`: it would be imported hidden), `skipped` the entity types import_dxf would leave out with their counts, `paperSpace` how many paper-space entities it ignores, `extents` the drawing's extent in drawing units ({ min, max }, null when empty; multiply by `scale` for mm).",
      scope: 'global',
      readOnly: true,
      input: z.object({ path: z.string().min(1).describe('A full file path to a .dxf file') }),
      handler: async ({ path }) => {
        const file = await readDxfFile(path);
        return {
          insUnits: file.insUnits,
          units: file.insUnits === null ? null : (DXF_UNIT_NAMES[file.insUnits] ?? null),
          scale: dxfUnitScale(file.insUnits),
          layers: dxfLayerSummary(file),
          skipped: file.skipped,
          paperSpace: file.paperSpace,
          extents: dxfExtents(file),
        };
      },
    }),
    defineCommand({
      id: 'import.dxf',
      title: 'Import DXF',
      description:
        "Imports the model space of a DXF file at `path` (a full file path) onto a level of the open project as a drawing to trace over: one new interior layer per DXF layer that has something to import, named `layerPrefix` + the DXF layer's name (`DXF Walls`; a layer of that exact name already on the level is reused; DXF layers that are off or frozen come in hidden), closed polylines, circles, closed ellipses and splines as unfilled `shape`s keeping their arcs, lines, open polylines and arcs as room dividers (`separator`s, which also split rooms), texts and MTEXT (formatting stripped) as `label`s. Block references are expanded (one nesting deep); hatches, dimensions, points, solids, images and other entities are skipped and counted. `scale` is millimetres per drawing unit (default from the file's $INSUNITS: 25.4 for inches, 1000 for metres, 1 when unitless), `origin` an offset in mm added after scaling, `layers` limits the import to some DXF layers, `levelId` defaults to the ground level. One undoable change named `Import <file name>`; it does not change existing walls or rooms. Afterwards use plan_query with the returned layer ids to find the shapes, then trace walls over them with plan_wall_add or plan_apply (and remove or hide the DXF layers with plan_layer_remove or plan_layer_update). Returns { levelId, scale, counts: { shapes, separators, labels, layers }, skipped, layers: [{ id, name, dxfLayer, created, visible }] }.",
      scope: 'project',
      input: z.object({
        path: z.string().min(1).describe('A full file path to a .dxf file'),
        levelId: z.string().optional().describe('Default: the ground level'),
        scale: z.number().positive().max(1e9).optional().describe('Millimetres per drawing unit; default from the file\'s $INSUNITS (import_dxf_probe reports it)'),
        origin: z.tuple([z.number(), z.number()]).optional().describe('An offset in mm added to every point after scaling'),
        layerPrefix: z.string().max(60).default('DXF ').describe('Put before each DXF layer\'s name to name its project layer'),
        layers: z.array(z.string().min(1)).min(1).optional().describe('Only these DXF layers (names as import_dxf_probe lists them); all by default'),
        textHeight: z.number().positive().max(100000).optional().describe('Every label\'s height in mm instead of the texts\' own'),
      }),
      handler: async ({ path, levelId: lv, ...options }, ctx) => {
        const file = await readDxfFile(path);
        const project = ctx.project!;
        const levelId = lv ?? project.doc.building.groundLevelId;
        if (!project.doc.levels[levelId]) throw new StudioError('NOT_FOUND', `No level ${levelId} in this project. building_get lists the levels.`);
        const { result } = await editProject(ctx, `Import ${nodePath.basename(path)}`, (tx) => {
          const imported = dxfToOps(file, tx.doc, levelId, options);
          if (imported.ops.length) tx.apply(imported.ops);
          return imported;
        });
        return { levelId, scale: result.scale, counts: result.counts, skipped: result.skipped, layers: result.layers };
      },
    }),
  ],
});
