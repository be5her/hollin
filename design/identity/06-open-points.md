# Open points after the detail round (31 Oct 2026)

What the five detail documents (`01` to `05`) agree on is in `00-decisions.md`. This file lists what they found that still needs a decision or a fix before the build starts. Full-page captures of the four specimen pages are in `shots/` (`brand-NN`, `components-NN`, `otto-NN`, `canvas-NN`).

## Decisions for the owner

All six below were resolved on 31 Oct 2026 and are recorded in `00-decisions.md` §6 and §6a: icon **B** (the owner's final choice, after first picking A); name stays Hollin (working) pending the owner's check; tab label **Otto**; field labels 12 px; night background `#0f0d0b`; title block accepted. Kept here for the reasoning.

1. **App icon: A or B.** `01-brand.md` recommends **A (one room)**: at 16 and 32 px B's terracotta vanishes and it reads as two generic tiles, while A stays one room with one warm mark, the only paper-coloured icon in a dark dock. Otto's mulberry room lives in Otto's own mark instead (`otto-mark.svg`). Both are drawn in `brand.html`.
2. **The name.** Hollin is the working name on every page; Penrow and Bothy are shown as alternates. Needs the owner's own check (domains, stores, trademark) before it goes into `branding.json`.
3. **The right-panel tab's label.** `01-brand.md` keeps it **Assistant**; `02-components.md` renders it **Otto** with the 16 px mark. Pick one. (Recommendation: "Otto" with the mark, since the panel header already says Otto and the status bar does too.)
4. **Field labels at 12 px, not 11.** `02-components.md` found Alegreya Sans reads a size small, so field labels are set at 12/16 while captions, meta and section caps stay 11/14. Accept or hold to 11.
5. **The night background.** `04-canvas.md` proposes a constant `#0f0d0b` (warm near-black) for the 3D night scene in both themes, replacing today's hardcoded cool `#0b0e14`. Accept.
6. **The PDF title block.** `04-canvas.md` proposes a 90 × 24 mm block with the wordmark, project name, level, scale and date on the sheet's bottom-right. Accept or keep sheets unbranded.

## Problems the documents found, to be fixed in the build

- **`--ai-tint` is nearly invisible against `--surface` in light** (1.02:1). Otto's History rows and cards must rely on the mark and the 3 px mulberry edge, which the specs already do. If the tint should be visible, it needs to move one step away from paper (the detail documents were told not to change it).
- **`--muted` on `--ai-tint` in light is 3.9:1** (fails AA for meta text). Rule for the build: on the tint, meta text uses `--fg` at 70 % rather than `--muted`.
- **`--muted` on `--elevated` in light is 3.7:1**: no graphite body text on the elevated tint; use it only for 11 px captions that are not the main content, or use `--fg`.
- **Mulberry vs terracotta** is 1.5:1 and 1.2:1 (light / dark): they are told apart by hue only. The shapes already differ (Otto's halo is a wide soft band with round end nodes; selection is a 2 px outline with square grips), which is the redundancy a colour-blind user needs; keep it that way.
- **The room wash is 0.10 alpha in code and in the exports**; the decision says ~18 %. Set it to 0.18 in both.
- **The 3D night background and `PRINT_COLORS`, `standIn`, `FALLBACK` are old hardcoded constants** in the viewport and exchange code; they become palette reads.
- **Off-screen renders (thumbnails, snapshots, exports) draw labels in system fonts**: wait for `document.fonts.ready` and use the bundled faces, or they will not match the canvas.
- **`scene-ui.ts` hardcodes the old 3D backgrounds**, a deterministic smoke failure once the palette changes.
- **The length input's unit suffix** moves the unit out of the input's value: templates and the smoke checks that read the value change together.
- **History is newest-first**: a call waiting for your yes sits greyed at the top, not the bottom as `00-decisions.md` §5 says.
- **Renaming `mcpServerName`** breaks users' `mcp__plan-studio__*` allow-lists in their Claude Code / Cursor configs; the release note must say so.
- ~~**`wordmark.svg` is a hand-drawn serif after Fraunces**; outline the real font before anything ships with it.~~ Resolved: the app draws the wordmark as live text in the bundled Fraunces (`00-decisions.md` §6a).
- **Alegreya Sans has no variable build**: four static WOFF2 files (Regular, Italic, Medium, Bold, ~376 KB); IBM Plex Mono two statics (~92 KB); Fraunces two variable TTFs (~820 KB). About 1.3 MB in all.

## Where the build starts

`05-implementation.md` §10 orders it in six verifiable commits: (1) fonts, variables and the 1.6 px icon stroke; (2) app icon and branding; (3) Home cards, empty moments and About; (4) Otto in the panel, History and status bar; (5) Otto on the canvas and the Home composer; (6) the exports' title block. Each passes `npm run typecheck`, `npm test` and `npm run smoke` and updates the module READMEs and `CHANGELOG.md`'s `[Unreleased]`.
