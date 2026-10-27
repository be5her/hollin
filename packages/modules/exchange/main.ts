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
  pdfLayouts,
  planDrawing,
  readPngHeader,
  svgLayout,
  today,
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
 * Exports and imports. `export.plan` writes levels' plans as DXF, SVG or PDF from the pure writers in
 * `@studio/core` (`planDrawing`, `drawingToDxf`, `drawingToSvg`, `drawingToPdf`); `export.building`
 * writes the building in 3D as a GLB (`buildingToGlb`); `export.image` has the window draw a PNG
 * render the way `view.snapshot` does (`requestSnapshot` from the plan module) and writes it.
 * Writing files outside the library is gated for agents.
 */
export const exchangeModule = defineModule({
  id: 'exchange',
  commands: [
    defineCommand({
      id: 'export.plan',
      title: 'Export plan drawing',
      description:
        'Writes levels of the open project as plan drawings to `path` (a full file path), as DXF (AutoCAD R2000, millimetres, one CAD layer per drawing layer), SVG or PDF (vector, on a paper sheet at a drawing scale, with a title block). DXF and SVG write one file per level: with several levels the level name is put before the extension (`Plan - Ground floor.svg`); PDF writes one file with a page per level. `levelIds` defaults to every level, bottom to top; `scale` is the 1:N denominator (default 100); `page` and `orientation` set the SVG/PDF sheet (default A3 landscape); `fit` picks, per level, the largest of 1:20 ... 1:1000 that fits the sheet; `layers` limits the drawing to some layer kinds. Writes outside the library, so it is gated. Returns the files written (path, bytes, level) and the scale used for each level.',
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
      }),
      handler: async (input, ctx) => {
        if (!nodePath.isAbsolute(input.path)) throw new StudioError('INVALID_INPUT', 'path must be a full (absolute) file path.');
        const project = ctx.project!;
        const doc = project.doc;
        const levelIds = input.levelIds ?? doc.building.stack;
        const missing = levelIds.filter((id) => !doc.levels[id]);
        if (missing.length) throw new StudioError('NOT_FOUND', `No level ${missing.join(', ')} in this project. building_get lists the levels.`);
        const { units, rules } = ctx.host.config.get();
        const drawings: PlanDrawing[] = levelIds.map((id) => planDrawing(doc, id, { units, limits: rules, layers: input.layers }));
        const scale = input.fit ? ('fit' as const) : input.scale;
        const title = input.title ? project.name : undefined;
        const date = today();
        const files: { path: string; levelId?: string; bytes: number }[] = [];
        const levels: { levelId: string; name: string; scale: number }[] = [];

        if (input.format === 'pdf') {
          const pages = drawings.map((drawing) => ({ drawing, title }));
          const options = { page: input.page, orientation: input.orientation, scale, date, deflate: (bytes: Uint8Array) => deflateSync(bytes) };
          const data = drawingToPdf(pages, options);
          await writeFileAtomic(input.path, data);
          files.push({ path: input.path, bytes: data.length });
          pdfLayouts(pages, options).forEach((l, i) => levels.push({ levelId: drawings[i].levelId, name: drawings[i].levelName, scale: l.scale }));
        } else {
          const paths = levelPaths(input.path, drawings.map((d) => d.levelName));
          for (const [i, drawing] of drawings.entries()) {
            let data: string;
            let used = input.scale;
            if (input.format === 'dxf') data = drawingToDxf(drawing, { scale: input.scale });
            else {
              const options = { page: input.page, orientation: input.orientation, scale, title, date };
              used = svgLayout(drawing, options).scale;
              data = drawingToSvg(drawing, options);
            }
            const bytes = Buffer.from(data, 'utf8');
            await writeFileAtomic(paths[i], bytes);
            files.push({ path: paths[i], levelId: drawing.levelId, bytes: bytes.length });
            levels.push({ levelId: drawing.levelId, name: drawing.levelName, scale: used });
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
  ],
});
