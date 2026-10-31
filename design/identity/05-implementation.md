# 05 · Implementation plan: the identity onto the code

The variable-by-variable map of `design/identity/00-decisions.md` (Craft's palette and type, Otto's presence, the mulberry variables) onto the app, with the font files' facts, the icon pipeline, branding, the components that change, the smoke checks that move, and a commit order. Nothing here is applied yet; every path and line number was read on 31 Oct 2026 at commit `089a70e`.

Conventions that bound everything below (CLAUDE.md): colours are the semantic variables of `src/renderer/src/styles.css`, `--titlebar` / `--titlebar-fg` stay `#rrggbb` (the renderer's `Theme.apply` only forwards them when they match `/^#[0-9a-f]{6}$/i`, `packages/ui/src/theme/theme.ts:28-33`), the 3D palette is mirrored in core (`SOLID_COLORS`, `packages/core/src/exchange/gltf.ts:17-28`) and in the viewport (`LIGHT_SCENE_THEME`, `DARK_SCENE_THEME`, `LIGHT_THEME`, `DARK_THEME`) and pinned by `packages/modules/plan/snapshot-theme.test.ts`; every change the UI shows is announced by a `HostEvents` event (`packages/core/src/types.ts:316-349`); names live in `branding.json`.

---

## 1. Variable map (`src/renderer/src/styles.css`)

The `:root` block is lines 11-52, `.dark` lines 54-91, `@theme inline` lines 93-108. The comment at lines 6-10 ("A placeholder neutral look until the visual design is decided") is replaced by one naming the identity (paper, ink, terracotta; Otto's mulberry) and keeping the `#rrggbb` warning.

### 1a. Shell colours

| Variable | Light old → new | Dark old → new | Role |
|---|---|---|---|
| `--canvas` | `#f7f7f5` → `#f6f1e8` | `#17181a` → `#1d1a17` | window and page: paper / the desk under the lamp |
| `--surface` | `#efefec` → `#efe8dc` | `#1e1f22` → `#262220` | panels, title bar, cards |
| `--elevated` | `#e5e5e1` → `#e6ddcd` | `#2a2b2f` → `#332d29` | hover, chips, badges |
| `--fg` | `#1d1f22` → `#2a2521` | `#e8e9eb` → `#ebe3d6` | ink |
| `--muted` | `#676b72` → `#7b7064` | `#9a9ca3` → `#a2968a` | graphite |
| `--edge` | `#dadad5` → `#dcd2c2` | `#313338` → `#3c3531` | 1 px borders |
| `--accent` | `#2f6fda` → `#b9552f` | `#5b9bf8` → `#e07c50` | terracotta |
| `--accent-hover` | `#2459b5` → `#9c4525` | `#7cb0fa` → `#ea9471` | |
| `--accent-fg` | `#ffffff` → `#fbf6ee` | `#0f1115` → `#1d1a17` | |
| `--danger` | `#d23434` → `#b5392c` | `#f27474` → `#e8705f` | |
| `--success` | `#1f8a4c` → `#4f7d3d` | `#4fcf86` → `#8fbf6e` | moss |
| `--warning` | `#b7791f` → `#b8841f` | `#f0b94a` → `#e2b24a` | ochre |
| `--titlebar` | `#efefec` → `#efe8dc` | `#1e1f22` → `#262220` | = `--surface`, `#rrggbb` |
| `--titlebar-fg` | `#1d1f22` → `#2a2521` | `#e8e9eb` → `#ebe3d6` | = `--fg`, `#rrggbb` |

Two more places hold the title-bar colours as literals and must change with them: `src/main/window.ts:13` (`initialColors()`: `'#1e1f22' / '#e8e9eb'` dark, `'#efefec' / '#1d1f22'` light, used for `backgroundColor` and the overlay before the renderer reports) and `src/main/smoke/scene-ui.ts:8-9` (`LIGHT_BACKGROUND = rgbOf('#f7f7f5')`, `DARK_BACKGROUND = rgbOf('#17181a')`, see §9).

### 1b. Plan canvas (`--plan-*`, read by `packages/viewport/src/plan2d/theme.ts:73-93` through `readPlanTheme`, alpha applied in code)

| Variable | Light old → new | Dark old → new |
|---|---|---|
| `--plan-grid` | `#e9e9e5` → `#ebe4d7` | `#202225` → `#272320` |
| `--plan-grid-major` | `#d6d6d1` → `#dbd1bf` | `#2b2d31` → `#352f2b` |
| `--plan-wall` | `#4a4e55` → `#3b3531` | `#c9cbd0` → `#d8cfc2` |
| `--plan-wall-line` | `#1d1f22` → `#231f1c` | `#f1f2f4` → `#f3ece1` |
| `--plan-room` | `#2f6fda` → `#8b9a6b` | `#5b9bf8` → `#a4b385` |
| `--plan-slab` | `#e2e2dd` → `#e9e1d2` | `#222427` → `#2a2623` |
| `--plan-dim` | `#2f6fda` → `#3f5390` | `#5b9bf8` → `#91a4e0` |
| `--plan-underlay` | `#9a9ca3` → `#a89c8c` | `#676b72` → `#7a7066` |
| `--plan-snap` | `#1f8a4c` → `#2f8a57` | `#4fcf86` → `#6fcf8a` |
| `--plan-selection` | `#2f6fda` → `#b9552f` | `#5b9bf8` → `#e07c50` |
| `--plan-warning` | `#b7791f` → `#b8841f` | `#f0b94a` → `#e2b24a` |
| `--plan-connector` | `#33363c` → `#4b433d` | `#d5d7db` → `#e3dacc` |
| `--plan-decor` | `#8a6a45` → `#8c6b4a` | `#d2ab7c` → `#d4a97a` |
| `--plan-ai` (new) | — → `#8a3f6f` | — → `#d892bd` |

The room wash is drawn at 0.04-0.1 alpha today (`packages/viewport/src/plan2d/render.ts:622-623`), not Craft's 18 %; raising it is a one-number change there if the mocks in `04-canvas.md` want it, otherwise leave it.

### 1c. 3D view (`--scene-*`, read by `packages/viewport/src/scene3d/theme.ts:48-59`)

| Variable | Light old → new | Dark old → new |
|---|---|---|
| `--scene-edge` | `#3b3e44` → `#3a332e` | `#121315` → `#141210` |
| `--scene-wall` | `#e9e6df` → `#efe6d6` | `#b9b6ae` → `#c4b9a8` |
| `--scene-slab` | `#c9c6bf` → `#cdbea7` | `#6d6b66` → `#6f6358` |
| `--scene-column` | `#d9d5cc` → `#ddd1bd` | `#a29e95` → `#a89c8c` |
| `--scene-glass` | `#8fb8de` → `#9bb9c7` | `#5b8fc4` → `#6e93ab` |
| `--scene-connector` | `#d8cfc0` → `#d5c2a3` | `#a39a8b` → `#a8947a` |
| `--scene-rail` | `#5a5e66` → `#5a4f45` | `#d5d7db` → `#d8cfc2` |
| `--scene-car` | `#2f6fda` → `#b9552f` | `#5b9bf8` → `#e07c50` |
| `--scene-stand-in` | `#9a9a9a` → `#a69b8e` | `#5c5b58` → `#5f574f` |

### 1d. Otto's variables (new, decisions §4)

Added inside `:root` after `--titlebar-fg` (line 25) and inside `.dark` after line 68, as `#rrggbb`:

```css
  --ai: #8a3f6f;        /* dark: #d892bd */
  --ai-hover: #733259;  /* dark: #e3a9cb */
  --ai-fg: #fbf6ee;     /* dark: #1d1a17 */
  --ai-tint: #f1e3ea;   /* dark: #332631 */
```

and `--plan-ai` in the `--plan-*` group (after `--plan-decor`, lines 41 / 81). They must sit inside the `:root { … }` / `.dark { … }` braces with no nested block: `snapshot-theme.test.ts:8-12` parses a block as the text from `${selector} {` to the first `}`.

The `@theme inline` block (lines 93-108) gets, after `--color-warning` (line 105):

```css
  --color-ai: var(--ai);
  --color-ai-hover: var(--ai-hover);
  --color-ai-fg: var(--ai-fg);
  --color-ai-tint: var(--ai-tint);
```

which gives Tailwind `bg-ai`, `text-ai`, `border-ai`, `bg-ai-tint`, `text-ai-fg`, `hover:bg-ai-hover` and the `/NN` alpha forms. `--plan-ai` is not exposed to Tailwind: only the canvas reads it (`PLAN_THEME_VARIABLES` gains `ai: '--plan-ai'`, `LIGHT_THEME.ai = '#8a3f6f'`, `DARK_THEME.ai = '#d892bd'`, `PlanTheme.ai: string`; the test at `snapshot-theme.test.ts:21-23, 34-36` then checks it against both blocks for free).

Also in `styles.css`: `::selection` (lines 155-157) stays on `--accent` (terracotta at 30 %); the scrollbar rule (130-133) stays.

---

## 2. Core mirrors

**`packages/core/src/exchange/gltf.ts:17-28`** (`SOLID_COLORS`, what the glTF export writes and what `LIGHT_SCENE_THEME` takes its kinds from):

```ts
export const SOLID_COLORS: Readonly<Record<SolidKind, string>> = {
  wall: '#efe6d6',
  slab: '#cdbea7',
  column: '#ddd1bd',
  glass: '#9bb9c7',
  connector: '#d5c2a3',
  rail: '#5a4f45',
  car: '#b9552f',
  frame: '#efe6d6',
  leaf: '#efe6d6',
  finish: '#efe6d6',
};
```

(`frame`, `leaf`, `finish` follow `wall`, per the comment at lines 13-16.)

**`packages/viewport/src/scene3d/theme.ts`**: `LIGHT_SCENE_THEME` (20-31) keeps taking its kinds from `SOLID_COLORS`; its own literals become `background: '#f6f1e8'`, `edge: '#3a332e'`, `standIn: '#a69b8e'`. `DARK_SCENE_THEME` (34-45) becomes `background '#1d1a17'`, `edge '#141210'`, `wall '#c4b9a8'`, `slab '#6f6358'`, `column '#a89c8c'`, `glass '#6e93ab'`, `connector '#a8947a'`, `rail '#d8cfc2'`, `car '#e07c50'`, `standIn '#5f574f'`.

**`packages/viewport/src/plan2d/theme.ts`**: `LIGHT_THEME` (27-47) and `DARK_THEME` (50-70) take the §1b values plus `background` = `--canvas`, `fg` = `--fg`, `muted` = `--muted`, `accent` = `--accent` of each block (the test maps `background → --canvas`, `fg → --fg`, `muted → --muted`, `accent → --accent`, lines 74-77). `fontSans` / `fontMono` are excluded from the test (`snapshot-theme.test.ts:22, 35`): set them to `"'Alegreya Sans', system-ui, sans-serif"` and `"'IBM Plex Mono', ui-monospace, monospace"` so renders made without the window's computed style (`view.snapshot`, `export.image`, which pass `LIGHT_THEME` / `DARK_THEME` directly, `packages/modules/plan/ui/snapshot-responder.ts:46-47`) use the bundled faces when they are loaded and fall back cleanly in node tests.

**What `snapshot-theme.test.ts` checks, so it keeps passing**: every key of `PLAN_THEME_VARIABLES` (except the two fonts) equals the matching variable in the `.dark` block for `DARK_THEME` and in `:root` for `LIGHT_THEME`; every key of `SCENE_THEME_VARIABLES` likewise for both scene themes; and `SOLID_COLORS[kind]` equals `:root`'s `--scene-<kind>` for `wall, slab, column, glass, connector, rail, car` (line 42). It also requires more than 20 variables per block (lines 20, 33), which the new ones only help. A typo in any one hex fails the test with the key named, so the test is the checklist for §1b-1d.

Other colour literals that are not under test but should move with the palette: `packages/viewport/src/scene3d/scene.ts:82-86` (materials seeded from `LIGHT_SCENE_THEME`, follow automatically) and `packages/core/src/exchange/colors.ts:9-…` (`PRINT_COLORS`, the SVG/PDF paper palette: "the plan theme's light colours mirrored, darkened"; see step 6 in §10).

---

## 3. Fonts

### 3a. Files

No variable build of Alegreya Sans exists: the upstream repository ships `fonts/otf`, `fonts/ttf` and `fonts/webfonts` only (checked through the GitHub contents API), its last release `v2.008` (2018-03-13) has no assets, and Google Fonts serves 14 static TTFs. IBM Plex Mono is static by design. Fraunces is variable with the four axes the decisions need.

| Family | Source (OFL 1.1, `OFL.txt` alongside) | Files to bundle | Size |
|---|---|---|---|
| Alegreya Sans (Huerta Tipográfica) | `https://github.com/huertatipografica/Alegreya-Sans`, `fonts/webfonts/` (same glyphs as `google/fonts/ofl/alegreyasans`, which has TTF only at ~264 KB each) | `AlegreyaSans-Regular.woff2` (92,948 B), `AlegreyaSans-Italic.woff2` (96,732 B), `AlegreyaSans-Medium.woff2` (92,728 B), `AlegreyaSans-Bold.woff2` (93,224 B) | ≈ 376 KB |
| IBM Plex Mono (IBM) | `https://github.com/IBM/plex`, release `v6.4.0` (2024-01-26), asset `IBM-Plex-Mono.zip` (15.6 MB), path `fonts/complete/woff2/` (identical to the npm package `@ibm/plex-mono`) | `IBMPlexMono-Regular.woff2` (45,640 B), `IBMPlexMono-Medium.woff2` (46,724 B) | ≈ 92 KB |
| Fraunces (Undercase Type) | `https://github.com/undercasetype/Fraunces`, `fonts/variable/` (release `1.000`, 2020-10-29, `UnderCaseType_Fraunces_1.000.zip`, 14.8 MB); Google Fonts' build in `google/fonts/ofl/fraunces` is the same design at 360,440 / 414,904 B | `Fraunces[SOFT,WONK,opsz,wght].ttf` (384,052 B), `Fraunces-Italic[SOFT,WONK,opsz,wght].ttf` (437,844 B) | ≈ 822 KB |

Total ≈ 1.29 MB (Craft §d hoped for under 1 MB; the Fraunces release notes mention WOFF2 "variable subsets for web" inside the zip, which would roughly halve its share: use them if their names and axes match when the zip is opened, else the TTFs). The Fraunces Italic is needed only for the Home cards' initials (decisions §3); dropping it saves 438 KB and the initials would fall back to the roman with `font-style: italic` synthesised, which the design should refuse, so keep it. Rename nothing: the bracketed names are the fonts' own and work in `url()` when quoted.

### 3b. Where they go and how they load

`src/renderer/angular.json` has no `assets` option (`architect.build.options`, lines 18-26), so static files are not copied by glob. The application builder does process `url()` references in the global stylesheet (`styles: ["src/styles.css"]`, line 25) and emits the files into `out/renderer/media/` with hashed names (`outputHashing: "all"`, line 37), rewriting the URL relative to the stylesheet. So:

- put the six files and the three `OFL.txt` copies (renamed `OFL-AlegreyaSans.txt`, `OFL-IBMPlexMono.txt`, `OFL-Fraunces.txt`) in `src/renderer/src/fonts/`;
- reference them from `styles.css` as `url('./fonts/AlegreyaSans-Regular.woff2')`.

The packaged app loads `out/renderer/index.html` over `file://` (`src/main/window.ts:58`) with `<base href="./">` (`src/renderer/src/index.html:7`), so the relative `media/` URLs resolve, and the CSP's `font-src 'self' data:` (`index.html:10`) allows them: nothing in the CSP changes. electron-builder ships them through `files: ['out/**']` (`electron-builder.cjs:30`). If the builder ever refuses to bundle a `url()` (it will say so at build time), the fallback is an `assets` entry `{ "glob": "**/*", "input": "src/fonts", "output": "fonts" }` and `url('fonts/…')`; either way the first `npm run smoke` with `SMOKE_SHOTS` shows whether the faces rendered. `optimization.fonts: false` (line 35) concerns inlining remote fonts and stays.

### 3c. `@font-face` (top of `styles.css`, after the `@import`/`@source` lines 1-4)

```css
@font-face { font-family: 'Alegreya Sans'; font-style: normal; font-weight: 400; font-display: swap; src: url('./fonts/AlegreyaSans-Regular.woff2') format('woff2'); }
@font-face { font-family: 'Alegreya Sans'; font-style: italic; font-weight: 400; font-display: swap; src: url('./fonts/AlegreyaSans-Italic.woff2') format('woff2'); }
@font-face { font-family: 'Alegreya Sans'; font-style: normal; font-weight: 500; font-display: swap; src: url('./fonts/AlegreyaSans-Medium.woff2') format('woff2'); }
@font-face { font-family: 'Alegreya Sans'; font-style: normal; font-weight: 700; font-display: swap; src: url('./fonts/AlegreyaSans-Bold.woff2') format('woff2'); }
@font-face { font-family: 'IBM Plex Mono'; font-style: normal; font-weight: 400; font-display: swap; src: url('./fonts/IBMPlexMono-Regular.woff2') format('woff2'); }
@font-face { font-family: 'IBM Plex Mono'; font-style: normal; font-weight: 500; font-display: swap; src: url('./fonts/IBMPlexMono-Medium.woff2') format('woff2'); }
@font-face { font-family: 'Fraunces'; font-style: normal; font-weight: 100 900; font-display: swap; src: url('./fonts/Fraunces[SOFT,WONK,opsz,wght].ttf') format('truetype'); }
@font-face { font-family: 'Fraunces'; font-style: italic; font-weight: 100 900; font-display: swap; src: url('./fonts/Fraunces-Italic[SOFT,WONK,opsz,wght].ttf') format('truetype'); }
```

(Chromium accepts `format('truetype')` for a variable TTF; `format('truetype-variations')` is not needed. Tailwind 4's `@import 'tailwindcss'` is a plain import, so the `@font-face` rules may follow it. A medium italic (times set in Medium) is not bundled: write times in 400 italic as Craft §d says.)

Variables (lines 26-27):

```css
  --font-sans: 'Alegreya Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --font-mono: 'IBM Plex Mono', ui-monospace, 'Cascadia Code', Consolas, monospace;
  --font-display: 'Fraunces', Georgia, 'Times New Roman', serif;
```

and in `@theme inline` (after line 107) `--font-display: var(--font-display);`, which gives the Tailwind utility `font-display`. Fraunces' axes are set where it is used, not in the face: a `.display` utility (or the heading classes) sets `font-variation-settings: 'opsz' 20, 'SOFT' 50` for panel headings, `'opsz' 24, 'SOFT' 60` for titles, `'opsz' 36, 'SOFT' 70` for the Home and empty-moment headings (Craft §d). Chromium applies `opsz` automatically from the font size (`font-optical-sizing: auto`), so only `SOFT` needs setting explicitly; `WONK` stays 0.

The body already sets `font-family: var(--font-sans)` and `13px` (`styles.css:121-128`), so Alegreya Sans takes over everywhere; the canvas reads `--font-sans` / `--font-mono` through `PLAN_THEME_VARIABLES` (`plan2d/theme.ts:91-92`) and draws labels with them (`render.ts:308, 836`), so plan labels follow too (see risks: load timing).

### 3d. The "no new dependency" rule

Fonts are static assets under `src/renderer/src/fonts/`, not npm packages: `package.json` and the lockfile do not change, so the CLAUDE.md rule ("No new dependency without a one-line reason, in the commit message and in the README") is met by a one-line note anyway. `src/renderer/README.md` gets a **Fonts** paragraph replacing the sentence "The palette is a placeholder until the visual design is decided" (line 30): the three families, the exact files, their licences and where the `OFL.txt` copies sit, that the CSP keeps `font-src 'self'`, and that nothing is fetched. About (§7) lists the same three names and "OFL 1.1".

---

## 4. Icons

- `packages/ui/src/icon/icon.ts:38`: `readonly strokeWidth = input(2, { transform: numberAttribute });` → default `1.6`. The directive binds it as `[attr.stroke-width]` (line 33), so every `svg[xIcon]` follows.
- Explicit overrides to remove (`grep -rn strokeWidth` over `packages`, `src/renderer/src`): `src/renderer/src/app/activity-bar/activity-bar.ts:26` (`strokeWidth="1.75"` on the module icons) and `src/renderer/src/app/title-bar/title-bar.html:77` (`strokeWidth="1.75"` on the Settings gear). Both drop the attribute.
- `packages/ui/src/controls/spinner.ts:14` sets `'stroke-width': '2'` on the spinner ring: set it to `1.6` for the same pencil weight (it is not a Lucide icon, so it does not follow the default).
- `packages/modules/building/ui/section-view.ts:44, 58, 66, 73, 78, 80` are drawing strokes of the section diagram, not icons: leave them.
- Sizes stay as the templates have them (`size-3.5` = 14 px in toolbars, `size-4` = 16 px). Craft's "18 px in chrome, 16 px in rows" is a size change the decisions call a skin, so only the activity bar (`size-[18px]`, already) is at 18; do not resize the rest.

---

## 5. App icon

- Source: `resources/icon.svg` (10 lines, the blue placeholder tile with a plan). Replace its contents with the chosen candidate (`design/identity/icon-a.svg` or `icon-b.svg`, decisions §6), keeping `viewBox="0 0 1024 1024"` and a transparent outside: `scripts/render-icon.cjs` draws it with Electron onto a 1024 × 1024 canvas (`SIZE`, lines 12, 26-30) and writes `resources/icon.png` (line 15).
- `npm run icon` (`package.json:26`) = `electron scripts/render-icon.cjs`. Commit the new PNG with the SVG (40,583 B today).
- electron-builder: `directories.buildResources: 'resources'` (`electron-builder.cjs:29`) makes `resources/icon.png` the icon for every target; the Windows `.ico`, macOS `.icns` and Linux set are derived from it at package time (the comment in `render-icon.cjs:2-4` says the same). No `win.icon`, `mac.icon` or `linux.icon` is set (lines 45-86), so **one file serves all platforms**. The Linux window and dev runs read the same PNG through `extraResources` (line 32) and `src/main/window.ts:6`.
- A separate Windows framing would need: a second SVG (`resources/icon-win.svg`), a second render target in the script (parametrise `source`/`target`, lines 14-15), and `win: { icon: 'resources/icon-win.png' }` in the config. The config does not need it today; the decision's "macOS and Windows framings" are for the owner to compare in `brand.html`, and the recommended build is one artwork whose paper tile already carries its own margin (Craft §g: the macOS inset is the system's). Only if the owner picks different framings does the second file exist.
- Also update `src/renderer/src/app/title-bar/title-bar.html:2` (the `P` on a `bg-accent` square standing in for the icon) with the real mark (§7).

---

## 6. Branding

`branding.json` (lines 3-10) when the owner confirms the name (working name **Hollin**, decisions §2):

| Field | Now | Then | Where it is read |
|---|---|---|---|
| `productName` | `Plan Studio` | `Hollin` | `BRANDING.productName` everywhere; `package.json:3` `productName` must match (electron-builder reads `branding.productName`, `electron-builder.cjs:28`) |
| `shortName` | `Studio` | `Hollin` | |
| `description` | unchanged | unchanged | `package.json:5` repeats it |
| `appId` | `app.planstudio.desktop` | `app.hollin.desktop` | `electron-builder.cjs:27`; changes the install identity (a new appId installs beside the old one on macOS/Windows) |
| `dataDirName` | `Plan Studio` | **keep** `Plan Studio` | the library folder; the `$comment` (line 2) says keep it so existing installs find their projects. 0.1.0 is the first release, so starting over is also defensible, but keeping it costs nothing and the dev folder is `<name> Dev` (CLAUDE.md) |
| `packageExtension` | `psp` | `hollin` (Craft §b) or keep `psp` | `electron-builder.cjs:36` (`fileAssociations`); packages already written as `.psp` would need the old extension kept in the association, so if there are any, keep `psp` |
| `mcpServerName` | `plan-studio` | `hollin` | the MCP server's name and the tool prefix `mcp__<name>__*` (Claude Code provider, `packages/modules/assistant/README.md:20, 25`) |
| `defaultMcpPort` | `7433` | unchanged | |

`package.json:2` `"name": "plan-studio"` is the npm workspace root name and can stay (the lockfile repeats it; renaming is cosmetic and churns `package-lock.json`).

Where "Plan Studio" / `plan-studio` / `planstudio` appear outside `branding.json` (ripgrep over the repository, excluding `node_modules`, `docs`, `design`, `out`, `release`, `.git`, `package-lock.json`):

- `src/renderer/src/index.html:5` `<title>Plan Studio</title>`: a literal, not from branding. Change it with the name (the window title itself comes from `BRANDING.productName`, `src/main/window.ts:25`, so only the `<title>` text is wrong).
- `README.md:1, 3, 28` (the heading, "a working name", the dev data folder `Plan Studio Dev`).
- `CLAUDE.md:1, 3`.
- `packages/modules/assistant/README.md:25` (`mcp__plan-studio__*` in the by-hand check note: becomes `mcp__<mcpServerName>__*`).
- `package.json:2-3` (see above).

Nothing else in the sources. A full-tree grep also hits `out/main/index.js` and `out/renderer/index.html` (build output, regenerated), `release/builder-debug.yml` (electron-builder's log: the `.psp` association text "Plan Studio project" comes from `fileAssociations`) and a stale copy under `.claude/worktrees/cool-mccarthy-eb42ce/` (an old worktree, not the source); none needs editing. The smoke's product-name check compares against `BRANDING.productName` (`src/main/smoke/shell.ts:9`), `app.info` returns it (`src/main/host-commands.ts:12, 17`), the PDF's `/Producer` and the glTF's `generator` take it (`packages/core/src/exchange/pdf.ts:194`, `packages/modules/exchange/main.ts:241`).

---

## 7. Components that change beyond variables

Only what the decisions say (§3 radii, edges, type; §5 Otto is in §8).

| Component | File | Change |
|---|---|---|
| Buttons, inputs, selects, textareas | `packages/ui/src/controls/button.ts:43`, `icon-button.ts:21`, `native-controls.ts:8, 19, 28` | `rounded-md` is 6 px in Tailwind 4: controls already match. Nothing to do but a check in the shots. |
| Badges, key caps, tags | `badge.ts:5`, `kbd.ts:5`, tags in `packages/modules/library/ui/library-home.html:90` | `rounded` is 4 px: matches. `kbd` already `font-mono` (Plex Mono). |
| Cards and panels | project cards `library-home.html:69` (`rounded-lg` = 8 px ✓, but `hover:shadow-md` → removed: edges, not shadows; hover becomes `hover:border-fg/30`) | |
| Dialogs, palette, menus, toasts | `packages/ui/src/dialogs/dialog-host.html:5, 18` (`rounded-lg shadow-xl`), `src/renderer/src/app/command-palette/command-palette.html:3` (`rounded-lg shadow-2xl`), `packages/ui/src/context-menu/context-menu-host.html:6` (`shadow-lg`), `packages/ui/src/toasts/toast-host.html:5` (`shadow-lg`) | Dialogs and the palette `rounded-[10px]`; the one allowed shadow everywhere: add `--shadow-soft: 0 8px 24px color-mix(in srgb, var(--fg) 12%, transparent);` to `@theme inline` and use `shadow-soft`. |
| Headings in Fraunces | Home `library-home.html:3` (`h1` "Projects"/"Trash"), the shell's fallback Home `src/renderer/src/app/home/home.ts:14`, Settings section `h2`s `packages/modules/settings/ui/settings-tab.html:5, 15, 22, 28, 81, 151`, dialog titles in `dialog-host.html`, the sidebar panel title `src/renderer/src/app/sidebar/sidebar.ts:12` (today uppercase 11 px: Craft keeps section caps for LEVELS/LAYERS, so the *module* title becomes Fraunces 18/24 and the section headers `packages/ui/src/controls/section-header.ts:10` stay caps), the project name `packages/modules/library/ui/project-tab.html:4` (Fraunces 600, 20/26), the Properties title `packages/modules/plan/ui/properties-panel.html:3, 13` | add `font-display` (+ the `SOFT` variation class) and drop `tracking-tight`. |
| Italic meta | "Edited … · N levels" `library-home.html:86`, "Trashed …" `:58`, "Saved just now" `src/renderer/src/app/status-bar/status-bar.ts:16`, History "You · 2 min ago" `packages/modules/edit/ui/history-panel.ts:34` | `italic` on the time span; the level count and ids `font-mono`. |
| Numbers in mono | the status bar's units (`status-bar.ts:31`), MCP port (`:36`), the level select's elevation (`packages/modules/plan/ui/plan-view.html:68`), card level counts | `font-mono` on the number spans only. |
| Home cards: tinted sheets | `library-home.ts:65-68` `placeholder()` (a `linear-gradient` from `hueOf(p.id)`) and `library-home.html:80-81` (white initials centred, `text-2xl`) | `placeholder()` returns a tint index `hueOf(p.id) % 4` and the initials; the template draws the sheet as `background: color-mix(in srgb, var(--canvas), var(--warning) 14%)` (straw), `var(--plan-room) 16%` (sage), `var(--accent) 12%` (clay), `var(--plan-dim) 12%` (slate) so both themes follow, an inline SVG house-footprint doodle stroked `--muted` at 35 %, and the initials bottom-left in `font-display italic text-sm text-fg/80`. `data-testid="project-placeholder"` for the smoke. `hueOf` and `initials` (`packages/ui/src/format.ts:31-42`) stay. |
| Empty states | `packages/ui/src/controls/empty-state.ts:6` (title `text-sm font-medium`) | title in `font-display text-lg`: this is what makes "Nothing selected" (`properties-panel.html:10`), "No project on screen" (`sidebar.ts:15`), "No projects yet" (`library-home.html:106`) and the assistant's empty states (`assistant-panel.html:4, 9, 17`) speak in Fraunces at once. |
| First launch | `library-home.html:106-108` (`No projects yet`) | becomes Craft §h: the room sketch (inline SVG in `--plan-*` colours), heading *Start with a room you know.*, the two lines, New project + Import…, the promise line; `data-testid="library-first-launch"`. |
| New empty project | `packages/modules/plan/ui/plan-view.html` has no overlay today; `plan-view.ts` mirrors `data-entities` | an absolutely positioned, `pointer-events-none` card over the canvas while the active level has no entities (the editable Otto sentence is the one `pointer-events-auto` element): the sketch, *Draw the first wall.*, the how-to sentence, four `kbd`s (W, D, N, Ctrl K), Otto's line (§8). Absolutely positioned, so the canvas height and the smoke's `view()` do not change. Hidden once `data-entities` > 0. |
| About | `settings-tab.html:150-159` (`data-section="about"`) | the mark at 112 px and the wordmark (SVG components, see below), the two-sentence description, one `font-mono text-xs` line: version (from `app.info`), "Alegreya Sans · IBM Plex Mono · Fraunces (OFL 1.1) · Lucide (ISC)", and a Licences… link that opens the renderer's `fonts/OFL-*.txt` through the existing shell-open path (or shows them in a dialog); then Otto's credit line (§8). |
| Title bar | `title-bar.html:2-3` | the `P` tile becomes `<x-app-mark class="size-5">`; the name becomes the wordmark SVG (`design/identity/wordmark.svg` outlined, decisions §8 / Craft §c) with `data-testid="product-name"` kept on a visually hidden span holding `productName`, so `shell.ts:9` keeps passing. |
| New shared pieces | `packages/ui/src/brand/app-mark.ts`, `wordmark.ts`, `otto-mark.ts` | three tiny standalone components with the SVG paths inline (`currentColor` for ink, `var(--accent)` for the full stop, `var(--ai)` / `var(--ai-fg)` for Otto's tile). No new dependency. |

---

## 8. Otto: code touchpoints per presence (decisions §5)

**Who is "Otto" in the code.** Edits made through the assistant run as `caller: 'assistant'` (`packages/modules/assistant/main.ts:261` for the API provider; `host.identifyAssistant` for Claude Code), and `authorFrom` (`packages/core/src/types.ts:55-58`) turns that into `Author { kind: 'assistant', name: <model id or 'claude-code <version>'> }`. Every transaction entry carries that author and an ISO `at` (`packages/core/src/doc/engine.ts:19-24, 147`), every `doc.patched` carries `tx: { id, label, author, kind }` plus the `ops` (engine.ts:32-38, 156). MCP agents are `kind: 'mcp'`. So: `kind === 'assistant'` is Otto; `kind === 'mcp'` stays neutral ("MCP · <name>").

| Presence | Touchpoints |
|---|---|
| **Panel header, cards, hint** | `packages/modules/assistant/ui/assistant-panel.html`: header (23-31) gets `<x-otto-mark size="28">`, "Otto" in `font-display`, and under it the existing `assistant-model` line (`modelLabel()` in `assistant-panel.ts:52-60`, which the smoke reads: keep `data-testid="assistant-model"` on that line) followed by " · asks before deleting". The `Sparkles` icon goes. User items (37): `bg-elevated` instead of `bg-accent/10`. Assistant items (40): `border-l-2 border-ai pl-3`. Tool cards (43-55): `border-l-[3px] border-l-ai`, title + `font-mono text-muted` command id (`item.command`), second line from `item.summary` plus "undoable, by Otto"; icon colours stay moss/ochre/danger. Confirm card (69-82): "Otto wants to run …", buttons stay terracotta/secondary (Allow / Keep it instead of Decline). Intro (62): the pencil hint. Composer placeholder (104): "Ask Otto… (Enter sends, Shift+Enter for a new line)"; a hint line under the form: "Edits land on your undo stack, signed Otto." |
| **Canvas halo and tag** | Data: in `packages/ui/src/state/project-docs.ts:72-88` (`patched`), when `patch.tx.author.kind === 'assistant'` and `patch.tx.kind === 'do'` (or `redo`), collect the entity ids of `patch.ops` (each op has `c` and `id`, engine.ts:196) into a per-project `recentEdits = signal<{ ids: Set<string>; label: string; at: number }[]>` kept on `DocState`; a `do` by `kind: 'user'` clears it ("fades on your next edit"); a timer drops entries older than 60 s. Viewport: `PlanTheme.ai` (§1d), `RenderFrame.highlights?: { ids: ReadonlySet<string>; label: string; ageMs: number }[]` (`packages/viewport/src/plan2d/render.ts:9-27`), a `drawAiHalo` next to `drawSelection` (render.ts:358) drawing each entity's outline with `withAlpha(theme.ai, 0.22 * fade)` at ~34 px line width, end nodes, and the tag ("Otto · <label> · now") in `theme.fontSans` 11 px on a short leader; `Plan2dEditor.setHighlights(...)` beside `select()` (`editor.ts:308`) and the frame built at `editor.ts:521`. `plan-view.ts` passes `recentEdits` to the editor the way it passes selection (its `editor.set*` calls). Selection (terracotta) draws after the halo so both show. **Pending destructive outline:** `ChatSnapshot.confirm` has `command` and `input` (`packages/core/src/assistant-types.ts:30`; built at `assistant/main.ts:88`); the assistant module's UI extracts entity ids from `input` (`ids`, `id`, `entityIds` when present) into the same highlight channel with `pending: true`, drawn dashed, until `confirm` is null. Best-effort: inputs without ids draw nothing. No new HostEvent: `doc.patched` and `assistant.event` already announce both. |
| **History rows** | `packages/modules/edit/ui/history-panel.ts`: `iconFor` (55-57) → user: a `size-2 rounded-full bg-muted` dot; assistant: `<x-otto-mark size="16">`; mcp: the same neutral dot. `authorName` (59-61) → `'You'`, `'Otto'`, `` `MCP · ${name}` ``. Row (30-31): `[class.bg-ai-tint]="entry.author.kind === 'assistant'"`; the second line (34) `Otto · <layer> · <command id>` needs the command id and layer, which `HistoryInfo` (engine.ts:19-24) does not carry: add optional `command?: string` to the entry at `transact()` (engine.ts:116, 147) from the edit context, or show "Otto · <label>" and defer the id. The `data-author` attribute (30) changes text, so update `src/main/smoke/building-ui.ts:32` (`via MCP: smoke-ui-architect 1.0` → `MCP · smoke-ui-architect 1.0`), `assistant-ui.ts:64` and `assistant-claude-code.ts:121` (`Assistant (…)` → `Otto`). The waiting entry "greyed at the bottom" is the pending confirmation (from the chat state, not the stack). |
| **Status bar** | `src/renderer/src/app/status-bar/status-bar.ts` is shell code and knows no module, so the assistant module's UI `setup()` (`ModuleUI.setup`, `packages/ui/src/module-ui.ts:29-30`) publishes into `AppState` (`packages/ui/src/state/app-state.ts:10-22`): a new `assistant = signal<{ projectId; status: 'idle' \| 'running' \| 'waiting'; activity: string \| null; present: boolean } \| null>`, fed from `assistant.event` (`HostEvents['assistant.event']`, types.ts:344; `ChatSnapshot.status`, assistant-types.ts:26; the running tool's `title`, :14) and from `assistant.state` for the active project on open. The bar shows, between units (30-32) and MCP (33-37): `<span class="size-1.5 rounded-full bg-ai">` and "Otto · ready" / "Otto · <tool title>…" / "Otto · waiting for your yes"; clicking opens the Assistant panel (`AppState.activeModule.set('assistant')`, app-state.ts:17). Hidden while the chat is empty and idle, or no project is on screen. No new event. |
| **Home composer** | `library-home.html`: the first grid slot (before `@for` at 66) is a card on `bg-ai-tint` with `font-display` "Start with Otto", a textarea, the rule line, and one `bg-ai text-ai-fg hover:bg-ai-hover` button "Draft it" (the one mulberry button). It calls `project.create` (`packages/modules/library/main.ts:69-78`, input `{ name, description?, tags?, open: true }`; the name from the sentence's first words or "New project"), then `assistant.send` (`assistant/main.ts:523-536`, hidden, project-scoped, `{ text }`) with the sentence, and sets `AppState.activeModule` to `'assistant'`. Before anything it reads `assistant.status` (as `assistant-panel.ts:32` does) and, if no provider is ready, shows the matching empty state's hint instead of the button. `project.create` with `open: true` opens the tab after the event round trip (CLAUDE.md: use the project's `project.changed` `opened` before expecting the tab). **Card corner mark:** `ProjectSummary` (`packages/core/src/projects.ts:2-14`) has no "Otto worked here" field and the chat lives in the per-machine view state (`assistant/main.ts:47, 345`), which Home cannot read in bulk. The honest way is one indexed field, `assistantEditedAt: string \| null`, in the library index schema (`packages/core/src/node/library.ts:28-40`, filled at 235 and 322), set from `ProjectService.edit()` (`packages/core/src/node/project-service.ts:443`) when `author.kind === 'assistant'`, announced by the existing `library.changed`. It is the one data-model change of the whole identity; if it is too much for step 5, the corner mark is deferred and the README says so. |
| **Empty project line** | the overlay card of §7: "Or tell Otto: 'a 5 by 7 m studio with a bathroom in the corner'" on `bg-ai-tint`, the quoted part a `contenteditable` span; Enter calls `assistant.send` for the project and switches the sidebar to Assistant. |
| **About** | `settings-tab.html:150-159`: after the licence line, "Hollin" (`text-fg`) "with Otto" (`text-ai`), then `modelLabel`-style text from `assistant.status` (model or "your Claude Code") and "asks before it deletes anything". |
| **Settings > Assistant** | `settings-tab.html:80-82`: heading "Otto", the first paragraph says Otto reaches Claude through…; the provider select and Claude Code fields keep their `data-testid`s (`settings-provider`, `settings-claude-code-*`), which `assistant-claude-code.ts` reads. |

**Events.** Existing and sufficient: `doc.patched` (author + ops, for the halo and History), `assistant.event` (chat status, running tool, pending confirmation, for the status bar, the outline and the panel), `library.changed` (for the card mark once indexed), `project.changed` (tab opened, for the composer). New: none required. If the History row's command id is added to `HistoryInfo`, it travels inside `doc.patched`'s `history` already.

---

## 9. Smoke and tests

**Pixel samples and colour comparisons** (`grep canvasPixel|screenPixel|setDark src/main/smoke`):

| File | What it samples | Needs new colours? |
|---|---|---|
| `src/main/smoke/harness.ts:256-280` | `canvasPixel` (2D `getImageData`), `screenPixel` (window capture, for WebGL), `setDark` (298-302, toggles `.dark` and waits 250 ms) | no (helpers) |
| `plan-canvas.ts:29`, `scene-canvas.ts:36` | `view().pixel`, `sceneView().pixel` | no |
| `plan-ui.ts:36-48, 94-112, 145-146, 475-476, 526-528, 551-560, 625-628, 725-735` | relative checks only: wall ≠ background, door ≠ wall, badge ≠ background, before/after a change | no literals; re-run to confirm the warm grid (`#ebe4d7`) still differs from paper (`#f6f1e8`) at the sampled points: it does by 11/13/17 per channel, and the checks compare `r,g,b` strings exactly, so any difference passes |
| `tracking-ui.ts:63-70` | the dashed guide beyond the cursor with and without Alt (moss on paper) | no |
| `decor-ui.ts:54, 72` | floor before/after an item | no |
| `scene-ui.ts:8-9` | **`LIGHT_BACKGROUND = rgbOf('#f7f7f5')`, `DARK_BACKGROUND = rgbOf('#17181a')`** compared with `colorDistance ≤ 3` (lines 61-63, 76, 126) | **yes: `#f6f1e8` and `#1d1a17`** (better: import `LIGHT_SCENE_THEME.background` / `DARK_SCENE_THEME.background` from `@studio/viewport` so they never drift again) |
| `decor-agent-ui.ts:76-81` | day vs night brightness | no |

**Unit tests that pin colours**: `packages/modules/plan/snapshot-theme.test.ts` (§2); `packages/viewport/src/plan2d/offscreen.test.ts:52-53` (the PNG's first op is `fillStyle ${DARK_THEME.background}`, follows the constant); `packages/viewport/src/scene3d/decor.test.ts:79-83` (stand-in colour follows the theme constants); any exchange test that pins `PRINT_COLORS` (grep `PRINT_COLORS` in `packages/core/src/exchange/*.test.ts` before step 6).

**Text the smoke expects that the copy changes** (grep results): `shell.ts:9` (`product-name` = `BRANDING.productName`, keep the hidden span), `building-ui.ts:32` (`data-author="via MCP: …"`), `assistant-ui.ts:64` and `assistant-claude-code.ts:121` (History text `Assistant (…)`), `assistant-ui.ts:44` and `assistant-claude-code.ts:91, 193` (`assistant-model` still names the model: keep the testid on the model line), `assistant-ui.ts:99, 138` and `assistant-claude-code.ts:200` (`assistant-intro` exists when the chat is empty: keep the testid on the pencil hint), `shell.ts:48` (`via MCP: smoke-` in Settings' call log, `settings-tab.html:66`: if the call log also says "MCP · …", update it).

**Screenshot numbers in use** (`grep shots?\('\d\d-` over `src/main/smoke`): 01-05 (`shell.ts`), 06-10 (`library-ui.ts`), 11-13 (`building-ui.ts`), 14-25 (`plan-ui.ts`), 20-26 (`connectors-ui.ts`, colliding with plan-ui's 20-25), 24 and 34 (`tracking-ui.ts`), 26 (`rules-ui.ts`), 27-29 (`assistant-ui.ts`), 30-33 (`assistant-claude-code.ts`), 35 (`snapshot-ui.ts`), 36-41 (`scene-ui.ts`), 42-46 (`exchange-ui.ts`), 50-52 (`decor-ui.ts`), 53-55 (`decor-scene-ui.ts`), 56-57 (`decor-finishes-ui.ts`), 58-59 (`decor-agent-ui.ts`), 61-63 (`updates-ui.ts`). Free: 47-49, 60, and 64 upwards. Use **64+** for the identity so nothing collides again: `64-home-cards`, `65-first-launch`, `66-empty-project`, `67-about`, `68-otto-panel`, `69-otto-history`, `70-otto-canvas`, `71-home-composer`. Each as `smoke.shots()` (light and dark).

**New smoke checks** (one file per area, through commands, MCP and the UI): step 1 none beyond the constants (the shots are the review); step 3 `identity-ui.ts`: a project without a thumbnail shows `project-placeholder` with a `color-mix` background and Fraunces initials, the first-launch state on an empty library, the empty-project overlay present on a new project and gone after `plan.wall.add` (wait on `data-entities`), About lists the three fonts; step 4 `otto-ui.ts`: a scripted run (the fake API, `assistant-ui.ts` already drives one) leaves a History row with `bg-ai-tint` and `data-author="Otto"`, the status bar shows `status-otto` with "waiting for your yes" while the confirm card is up and "ready" after; step 5: after the fake's `plan.apply`, sample a pixel just outside the new wall's outline and check it differs from the floor sampled before (the halo), then after a user edit through the UI it equals the floor again; the composer creates a project and the assistant panel receives the sentence (`assistant.state` items[0].text).

---

## 10. Build order

Each commit passes `npm run typecheck`, `npm test`, `npm run smoke`; the UI commits also run the smoke with `SMOKE_SHOTS=<dir>` and the light and dark shots are looked at. User-visible changes go under `## [Unreleased]` in `CHANGELOG.md` (the heading is at line 6; the first release's notes follow at line 8). The repository is local: commits on `main`, no push.

1. **The reskin: fonts, variables, icon stroke.** `styles.css` (§1, §3c), `window.ts:13`, viewport themes and `SOLID_COLORS` (§2), `icon.ts:38` + the two `strokeWidth` removals + spinner (§4), the six font files and three licences under `src/renderer/src/fonts/`, `scene-ui.ts:8-9`. Radii and shadows (§7 rows 1-4) belong here too, being CSS only. READMEs: `src/renderer/README.md:30` (palette no longer a placeholder; the Fonts paragraph), `packages/modules/building/README.md:10` and `decor/README.md:11, 13` only if they name colours (they name variables: no change). CHANGELOG: "Changed: the look: paper and ink palette with a terracotta accent, Alegreya Sans, IBM Plex Mono and Fraunces bundled, lighter icons; the plan, 3D view and exports' renders follow."
2. **App icon and branding.** `resources/icon.svg` + `npm run icon` + `resources/icon.png`; the three brand components (`app-mark`, `wordmark`, `otto-mark`) and the title bar (§5, §7 last rows); `branding.json`, `package.json:3`, `index.html:5`, `README.md`, `CLAUDE.md`, `assistant/README.md:25` (§6) **only once the owner confirms the name**; otherwise this commit ships the icon and components and the rename is its own later commit. CHANGELOG: "Changed: new app icon" (and the name).
3. **Home cards, the three empty moments, About.** `library-home.ts/html` placeholder sheets and first launch, the empty-project overlay in `plan-view`, `empty-state.ts` in Fraunces, About's licence line, the headings' `font-display` (§7). New smoke `identity-ui.ts` with shots 64-67. READMEs: `packages/modules/library/README.md:5` ("thumbnail or a coloured placeholder" → tinted sheet with initials), `packages/modules/plan/README.md` (the empty-project card), `src/renderer/README.md` (About). CHANGELOG: "Added: a first-launch and an empty-project guide; Changed: Home cards without a thumbnail show a tinted sheet with the project's initials."
4. **Otto in the panel, History and the status bar.** `assistant-panel.html/ts`, `history-panel.ts` (+ optional `HistoryInfo.command`), `AppState.assistant` + the assistant module's `setup()`, `status-bar.ts`, Settings > Assistant heading and About's credit (§8). Update the four smoke text expectations (§9) and add `otto-ui.ts` with shots 68-69. READMEs: `packages/modules/assistant/README.md:5` (the panel), `packages/modules/edit/README.md:6-7` (author names "Otto", "MCP · <name>"), `src/renderer/README.md:18` (status bar). CHANGELOG: "Changed: the assistant is Otto: its edits are signed Otto in History and on the status bar; outside MCP agents stay 'MCP · <name>'."
5. **Otto on the canvas and the Home composer.** `project-docs.ts` recent edits, `PlanTheme.ai` + `--plan-ai`, `RenderFrame.highlights`, `drawAiHalo`, `editor.setHighlights`, the pending dashed outline from `confirm.input`; the composer card and its two commands; the indexed `assistantEditedAt` for the card mark (or its deferral noted). Smoke: the halo pixel check and the composer flow, shots 70-71. READMEs: `packages/viewport/README.md` (highlights), `packages/modules/library/README.md` (composer, index field), `packages/core/README.md` (the index field). CHANGELOG: "Added: Otto's recent edits are marked on the plan for a minute; Home starts with 'Start with Otto'."
6. **Exports' title block and print palette.** `packages/core/src/exchange/colors.ts` `PRINT_COLORS` re-mirrored from the new light plan colours darkened for paper (wall `#3b3531`, wall line `#231f1c`, dim/room indigo `#3f5390`, slab `#e9e1d2`, muted graphite), and the title block (`paper.ts:105-128`, texts in Helvetica/Courier, `pdf.ts:11`, `svg.ts:147`) gaining the product name line from `BRANDING.productName` (already the PDF's `/Producer`, `pdf.ts:194`). The decisions are silent on exports beyond "exports … in the palette" (§8's `04-canvas.md`), so this commit follows that document and otherwise stays minimal. Check the exchange tests for pinned colours first. README: `packages/modules/exchange/README.md`. CHANGELOG: "Changed: SVG and PDF plans print in the paper palette and name the app in the title block."

---

## 11. Risks

- **Windows title bar.** `--titlebar` / `--titlebar-fg` are forwarded to `window.titleBarColors` only when they are literal `#rrggbb` (`theme.ts:31`); a `color-mix()` or `var()` there silently leaves the native buttons on the old colour. `window.ts:13` is a second copy of the same values for the first frame: a mismatch shows as a flash of the old grey behind the renderer's bar.
- **Fonts under `file://`.** The packaged renderer is loaded from disk (`window.ts:58`); font URLs must resolve relative to the stylesheet and pass `font-src 'self'`. If the build inlines a font as `data:` (it should not at these sizes) the CSP still allows it. Check the first packaged smoke (`release/win-unpacked/<productName>.exe --smoke`, CLAUDE.md) with shots, not only the dev build.
- **Variable fonts in Chromium.** Fraunces' `opsz` is applied automatically from `font-size` (`font-optical-sizing: auto`); `SOFT` and `WONK` need `font-variation-settings`, which overrides `opsz` when set in the same declaration unless `opsz` is repeated there. Set both in the one rule, or set only `SOFT` and leave `opsz` automatic. Electron 44's Chromium handles the bracketed file name in `url()` when quoted.
- **Fraunces at small sizes.** It is a display serif; the decisions use it from 18 px up and in italic for card initials (~14 px). Below 16 px the `WONK` details and soft terminals smudge on a 1× Windows screen: do not let it leak into labels, and check the dark-mode shots where thin serifs on `#1d1a17` lose weight (use 600, never 400, for headings).
- **1.6 px strokes on non-retina Windows.** Lucide paths are drawn at 24-unit coordinates scaled to 14-18 px, so a 1.6 unit stroke is about 1 physical pixel at 1×: anti-aliasing makes some icons look paler than the 2 px they replace, especially `text-muted` ones. Judge the shots at 100 % on a 1× screen before accepting; `1.75` is the fallback if 1.6 reads as broken (the title bar and activity bar used 1.75 for this reason).
- **Canvas text before the fonts load.** The plan draws labels with `--font-sans` / `--font-mono` (`render.ts:308, 836`); the first frames after launch can draw in the fallback until `document.fonts.ready`. The editor should request a redraw on `document.fonts.ready` (and `renderLevelToPng` for thumbnails/snapshots wait for it) or the first thumbnail is in Segoe UI.
- **Smoke flakiness from colour changes.** Pixel checks are relative, but two depend on a difference surviving: the room badge versus the floor (`plan-ui.ts:44, 48`) and the dashed guide versus paper (`tracking-ui.ts:63-70`); with sage at 18 % and moss on warm paper both still differ, but check the first run's logged `r,g,b` values. The 3D background constants (`scene-ui.ts:8-9`) fail deterministically until changed. Any CSS transition on the colours lengthens what `setDark` waits for (250 ms today).
- **The halo and the smoke's pixel probes.** A mulberry halo around what the fake assistant adds sits on the canvas for a minute: plan-ui sections that sample near an agent's wall right after `plan.apply` (`plan-ui.ts:107-112, 625-628`) only check "changed", so they pass, but a future exact check must sample away from the last assistant edit or make a user edit first.
- **`mcp__plan-studio__*` in users' configs.** Renaming `mcpServerName` changes the server name clients show and the tool prefix Claude Code sees; a user's `.mcp.json` or Claude Desktop entry named `plan-studio` keeps working (it holds the URL, not the name) but their allow-lists written as `mcp__plan-studio__*` stop matching. Note it in the CHANGELOG and `docs/` MCP page at the rename.
- **Renaming `appId`.** A different `appId` installs beside the old build on Windows (two Start-menu entries) and breaks the updater's continuity for 0.1.0 installs; acceptable before the first public release, otherwise keep `app.planstudio.desktop`.
- **Card mark needs an index field.** The only data-model change (§8); forgetting the `library.changed` emission or the schema's optional default breaks `library.test.ts`' index rebuild. Keep it optional in the zod schema so old `index.json` files load.
