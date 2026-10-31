# 02 · Components

Every shared control and panel of the app in the identity decided in `00-decisions.md`, light and dark, with exact values. `components.html` is the living specimen: its `<style>` is the CSS this document quotes, its `:root` and `.dark` blocks hold the hex values (Craft §e verbatim plus the five `--ai*` of the decisions §4), and every component below is rendered there in both themes with its states side by side, followed by four full-size mocks. Where a Tailwind class list exists in the app today, the new list or the CSS it maps to is given; `05-implementation.md` says which file each change lands in.

Conventions in this document: sizes in CSS px; "sans" is Alegreya Sans, "mono" IBM Plex Mono, "display" Fraunces; `--x` is a variable of `styles.css`. Light and dark are given once, through the variables, and only called out where a value is not a variable. "Today" quotes the current class list so the engineer can diff.

## 0. Foundations

### 0.1 Variables added to `styles.css`

The full palette tables are in `01-brand.md`; this document only needs these additions:

```css
:root {
  color-scheme: light;                       /* native selects, scrollbars and popups follow the theme */
  --ai: #8a3f6f; --ai-hover: #733259; --ai-fg: #fbf6ee; --ai-tint: #f1e3ea; --plan-ai: #8a3f6f;
  --font-sans: 'Alegreya Sans', 'Segoe UI', system-ui, sans-serif;
  --font-mono: 'IBM Plex Mono', ui-monospace, Consolas, monospace;
  --font-display: 'Fraunces', Georgia, serif;
  /* derived, never a new hue */
  --scrim: color-mix(in srgb, var(--fg) 32%, transparent);                 /* under dialogs and the palette */
  --shadow-pop: 0 8px 24px color-mix(in srgb, var(--fg) 12%, transparent); /* the one soft shadow: ink at 12 % */
  --ring: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent);     /* text-field focus */
  --ring-danger: 0 0 0 3px color-mix(in srgb, var(--danger) 22%, transparent);
}
.dark {
  color-scheme: dark;
  --ai: #d892bd; --ai-hover: #e3a9cb; --ai-fg: #1d1a17; --ai-tint: #332631; --plan-ai: #d892bd;
  --scrim: color-mix(in srgb, var(--canvas) 55%, transparent);
  --shadow-pop: 0 8px 24px color-mix(in srgb, var(--canvas) 60%, transparent); /* a 12 % ink shadow is invisible on the desk */
}
@theme inline { --color-ai: var(--ai); --color-ai-hover: var(--ai-hover); --color-ai-fg: var(--ai-fg); --color-ai-tint: var(--ai-tint); --font-display: var(--font-display); }
```

Tailwind's default radii already match the decisions: `rounded` 4 px (chips, badges, key caps), `rounded-md` 6 px (controls), `rounded-lg` 8 px (cards, panels, menus, toasts); dialogs and the palette take `rounded-[10px]`.

### 0.2 Type scale

| Token | Face | Size / line | Use |
|---|---|---|---|
| page | display 600, `'SOFT' 60, 'opsz' 36`, tracking −.01 em | 28 / 34 | Home "Projects", Settings "Settings", the three empty moments |
| dialog | display 600, `'SOFT' 60, 'opsz' 24`, −.01 em | 20 / 26 | dialog titles, the project name in the header |
| panel | display 600, `'SOFT' 50, 'opsz' 20`, −.005 em | 18 / 24 | Properties title, Settings section headings, empty-state titles, the palette's command form title |
| body | sans 400 | 13 / 18 | controls, rows, panel text, menus' danger text |
| body-strong | sans 500 | 13 / 18 | button labels, selected rows, card names (15 / 20 on Home cards) |
| small | sans 400 / 500 | 12 / 16 | sm buttons, tab strips, layer rows, menu rows, status text |
| label | sans 500, `--muted` | 12 / 16 | field labels (`label[xLabel]`), 4 px under |
| caption | sans 400, `--muted` | 11 / 14 | hints, "One file, a page per level", counts |
| meta | sans 400 italic, `--muted` | 12 / 16 | times and states: "Saved just now", "Edited yesterday", "Trashed 2 days ago" |
| caps | sans 500, uppercase, tracking .08 em, `--muted` | 11 / 14 | LEVELS, LAYERS · GROUND FLOOR, FINISHES, palette group headings, layer kinds (10 px) |
| number | mono 400, `tabular-nums` | 13 (12 in rows, 11 in badges / key caps / ids) | every length, area, id, coordinate, port, shortcut; the unit in `--muted` |

Body is `font: 400 13px/18px var(--font-sans)` on `body`, `-webkit-font-smoothing: antialiased` kept. Decisions §3 say labels 11 / 14: Alegreya Sans has a smaller x-height than Segoe UI, so field labels are set at 12 / 16 here and 11 / 14 is kept for captions, meta and caps (see Problems found).

### 0.3 Icons, edges, focus, selection, scrollbars

- **Icons:** `svg[xIcon]` default `strokeWidth` becomes 1.6 (today 2; the title bar and activity bar pass 1.75 explicitly, drop those). Sizes: 18 in the activity bar and tool strips, 16 in md buttons, rows, cards and panel headers, 14 in sm buttons, sm icon buttons and field adornments, 12 in the status bar and tab close crosses.
- **Edges, not shadows:** every border is `1px solid var(--edge)`. The only shadow is `--shadow-pop` on dialogs, the palette, context menus and toasts. `shadow-xl`, `shadow-2xl`, `shadow-lg`, `hover:shadow-md` are removed everywhere.
- **Focus-visible (everything but text fields):** `outline: 2px solid var(--accent); outline-offset: 1px`. Replaces `focus-visible:ring-2 focus-visible:ring-accent/50`. Never on a pointer click (`:focus-visible` only).
- **Focus (text fields and selects):** `border-color: var(--accent); box-shadow: var(--ring)`. Replaces `focus:border-accent focus:ring-2 focus:ring-accent/30`.
- **Text selection:** `::selection { background: color-mix(in srgb, var(--accent) 30%, transparent) }` (as today, with the new accent).
- **Scrollbars:** `scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--muted) 35%, transparent) transparent` (as today); WebKit: 8 px gutter, thumb radius 4 with a 2 px transparent inset, 55 % under the pointer, no track. `.no-scrollbar` unchanged.
- **Disabled:** controls at `opacity: .5` (icon buttons .4, activity-bar items .35), `pointer-events: none`.
- **Transitions:** `transition: background-color .12s, border-color .12s, color .12s` on buttons, chips, rows; nothing moves or scales.

## 1. Shell

### 1.1 Title bar and document tabs (`title-bar.html`)

Bar: `--titlebar` fill, `--titlebar-fg` text, `border-bottom: 1px solid var(--edge)`; height as today (40 px in the mocks); left padding 12 (`pl-3`, `pl-20` on macOS as today).

**Brand** replaces the letter tile: `<svg>` of the app icon at 22 px, then the wordmark `Hollin<span class="text-accent">.</span>` in `font: 600 16px/1 var(--font-display); font-variation-settings: 'SOFT' 80, 'opsz' 18; letter-spacing: -0.01em`, gap 8, right padding 12. (`data-testid="product-name"` stays on the name.)

**Tab** (today `app-no-drag group flex items-center gap-1.5 h-[30px] max-w-56 shrink-0 rounded-t-md border border-b-0 text-xs cursor-default` + `bg-canvas border-edge text-fg` / `border-transparent text-muted hover:text-fg hover:bg-elevated/60`):

| | value |
|---|---|
| box | `h-[30px] max-w-56 rounded-t-md border border-b-0`, padding `pl-3 pr-1` (`px-2.5` pinned), gap 6, body 13 |
| inactive | `border-transparent text-muted`; hover `text-fg bg-elevated/60` |
| active | `bg-canvas border-edge text-fg font-medium` |
| focus-visible | the outline ring |
| pinned Home | house icon 14 px, no label, no close |
| dirty dot | `size-1.5 rounded-full bg-warning` (6 px, ochre), title "Unsaved changes" |
| close | 18 px box `rounded` (4), icon 12 px, `text-muted`; hover `bg-elevated text-fg`; `opacity-0 group-hover:opacity-100`, always shown on the active tab |
| dragging | `opacity-50`; the drop marker is a 2 px `bg-accent` line (`x-drop-marker`) |

The strip keeps `items-end pt-1.5`, so tabs sit on the bar's bottom edge; the active tab's paper runs into the page below (no bottom border).

**Palette button** (today `h-7 px-2.5 rounded-md border border-edge bg-canvas text-xs text-muted hover:text-fg w-60`): keep; hover also `border-color: color-mix(in srgb, var(--muted) 45%, var(--edge))`; the search icon 14 px, the `kbd[xKbd]` key cap at the right. **Settings gear:** `button[xIconButton]` md with the gear at 16 px, 1.6 stroke.

### 1.2 Project header (`project-tab.html`)

`h-12 px-4 gap-3 border-b border-edge` as today.

- **Name:** `input` in `font: 600 20px/26px var(--font-display); font-variation-settings: 'SOFT' 60, 'opsz' 24; letter-spacing: -0.01em`, `flex: 0 1 288px; min-width: 120px`, transparent, `rounded px-1 -mx-1`; focus `box-shadow: var(--ring)` (no border). Replaces `text-[15px] font-semibold tracking-tight`.
- **Save state:** `font: italic 12px/16px var(--font-sans); color: var(--muted); white-space: nowrap` ("Saved just now", "Saving…"); failed: upright, `text-danger`, the alert icon 12 px.
- **Undo / redo:** `xIconButton` md, 16 px icons; disabled at .4.
- **Divider:** `w-px h-5 bg-edge`.
- **Save, Export project…, Duplicate:** `xButton size="sm" variant="ghost"`; **Trash:** `size="sm" variant="danger"`.

### 1.3 Activity bar (`activity-bar.ts`)

Host `w-12 py-1.5 gap-1 border-r border-edge bg-surface`. Button `size-9 rounded-md`: `text-muted`, hover `text-fg bg-elevated/60`; active `text-fg bg-elevated` with the `absolute left-0 top-2 bottom-2 w-0.5 rounded-r bg-accent` bar (unchanged, the terracotta mark the selected level row shares); unavailable `opacity-35 cursor-default`. Icons 18 px at 1.6 (drop `strokeWidth="1.75"`).

### 1.4 Status bar (`status-bar.ts`)

Host `h-6 px-3 gap-3 text-[11px] border-t border-edge bg-surface text-muted select-none` as today. Items are `flex items-center gap-1`, hover `text-fg`.

| item | spec |
|---|---|
| project | `text-fg` (today `text-fg/80`), `truncate max-w-80` |
| save state | italic ("Saved 2 minutes ago", "Saving…"); failed `text-danger` upright with the 12 px alert |
| units | ruler 12 px + the label in mono 11 (`mm`, `cm`, `ft-in, 1/16"`) |
| Otto | a 6 px `bg-ai` dot + "Otto · ready" / "Otto · adding a 3 m wall…" / "Otto · waiting for your yes" (decisions §5; states in `03-otto.md`); sits between units and MCP; click opens the Otto panel |
| MCP | plug 12 px, a 6 px dot `bg-success` / `bg-danger`, "MCP" + the port in mono (`:63282`) or "MCP off" |
| theme | moon / sun 12 px, icon only |

## 2. Controls (`packages/ui/src/controls`)

### 2.1 Buttons (`button.ts`)

Base (today `inline-flex items-center justify-center rounded-md border font-medium transition-colors select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-50 disabled:pointer-events-none`):

```
inline-flex items-center justify-center rounded-md border font-medium select-none whitespace-nowrap transition-colors
focus:outline-none focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1 disabled:opacity-50 disabled:pointer-events-none
```

Sizes (today sm `h-7 px-2 text-xs gap-1`, md `h-8 px-3 text-sm gap-1.5`): **md** `h-8 px-3 gap-1.5 text-[13px]/[18px]`, icon `size-4`; **sm** `h-7 px-2 gap-1 text-xs` (12 / 16), icon `size-3.5`. `iconClass` default becomes `size-4` for md, `size-3.5` for sm.

| variant | default | hover | active | notes |
|---|---|---|---|---|
| primary | `bg-accent text-accent-fg border-accent` | `bg-accent-hover border-accent-hover` | hover colours + `shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--fg)_12%,transparent)]` | the one terracotta button in a view |
| secondary | `bg-surface text-fg border-edge` | `bg-elevated` | `bg-elevated` + `border-color: color-mix(muted 50%, edge)` | paper with an edge |
| ghost | `bg-transparent text-fg border-transparent` | `bg-elevated` | `bg-elevated border-edge` | |
| danger | `bg-transparent text-danger border-transparent` | `bg-danger/10` | `bg-danger/16` | the confirm dialog's danger button adds `border-danger/40` as today |
| (ai) | `bg-ai text-ai-fg border-ai`, hover `bg-ai-hover` | | | not a `ButtonVariant`: a local class on the Home composer's "Draft it" only (`03-otto.md`) |

Loading: the `LoaderCircle` spinner at the icon size with `animate-spin`, button disabled (as today). Disabled: `opacity-50`.

### 2.2 Icon buttons (`icon-button.ts`)

Today `inline-flex items-center justify-center rounded-md text-muted hover:text-fg hover:bg-elevated transition-colors … size-6 | size-7`. New: same sizes (sm 24, md 28), icons `size-3.5` / `size-4`, hover `text-fg bg-elevated`, active and `aria-pressed="true"` `text-fg bg-elevated shadow-[inset_0_0_0_1px_var(--edge)]`, focus-visible outline, disabled `opacity-40`. Tooltip is the native `title` (as today).

### 2.3 Inputs (`native-controls.ts`: `Input`, `TextArea`)

Today `h-8 w-full rounded-md border border-edge bg-surface px-2.5 text-sm text-fg placeholder:text-muted/70 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:opacity-50`. New:

```
h-8 w-full rounded-md border border-edge bg-canvas px-2.5 text-[13px] text-fg placeholder:text-muted/70
hover:border-[color-mix(in_srgb,var(--muted)_45%,var(--edge))] focus:outline-none focus:border-accent focus:shadow-[var(--ring)] disabled:opacity-50
aria-invalid:border-danger aria-invalid:shadow-[var(--ring-danger)]
```

Fields sit on paper (`bg-canvas`), a well in a panel on `--surface`; in dark the well is darker than the panel. Small fields (`h-7 text-xs px-2`: the Catalog search, level rename, finish selects) stay 28 px. `xTextarea`: `px-2.5 py-2`, mono 12. Mono fields (`class="font-mono"` today) keep `font-mono tabular-nums` at 13. The invalid state replaces `!border-danger !ring-danger/30`; the length directive sets `aria-invalid` already. Error line under a field: caption size in `--danger`, 2 px gap.

### 2.4 The length input (`length.ts` + `x-length` wrapper)

The number in mono ink, the unit as a mono suffix in graphite over the field's right edge:

```css
.len { display: grid; }                     /* <div class="len"><input xInput xLength class="font-mono" …><span class="unit">mm</span></div> */
.len > input { grid-area: 1 / 1; padding-right: 38px; }
.len > .unit { grid-area: 1 / 1; justify-self: end; align-self: center; padding-right: 10px; font: 400 12px/16px var(--font-mono); color: var(--muted); pointer-events: none; }
```

The suffix is the current display unit from `Units` (`mm`, `cm`, `m`, `ft-in`, `in`; `°` for `xAngle`; `%` for the ramp rule). The field's text is the number without its unit (`Units.length(mm, { unit: false })`); `parseLength` already reads a bare number in the current unit, and a typed unit (`3.2m`, `10' 6"`) still wins. This is a small behaviour change for `properties-panel.html`, `levels-panel.html`, the rules settings and the smoke checks that read those fields (see Problems found). Small variant: `padding-right: 32px`, unit 11 px, 8 px inset.

### 2.5 Select (`Select`)

Today `h-8 rounded-md border border-edge bg-surface px-2 text-sm text-fg focus:…`. New: `h-8 rounded-md border border-edge bg-canvas pl-2 pr-7 text-[13px] text-fg hover:border-… focus:border-accent focus:shadow-[var(--ring)] disabled:opacity-50`. The native chevron stays (Chromium draws it in `color`, and `color-scheme` on `:root` / `.dark` makes the popup follow the theme); `option { background: var(--surface); color: var(--fg) }` stays. Small: `h-7 text-xs pl-1.5`.

### 2.6 Checkbox and radio (`Checkbox`; the export dialog's radios)

Drawn, not `accent-accent`:

```css
input[xCheckbox], input[type=radio].x-radio { appearance: none; width: 14px; height: 14px; margin: 0; border: 1px solid var(--muted); background: var(--canvas); display: inline-grid; place-items: center; }
input[xCheckbox] { border-radius: 3px; }   .x-radio { border-radius: 50%; }
:hover { border-color: var(--fg); }
input[xCheckbox]:checked { background: var(--accent); border-color: var(--accent); }
input[xCheckbox]:checked::after { content: ''; width: 4px; height: 8px; border: solid var(--accent-fg); border-width: 0 1.6px 1.6px 0; transform: translateY(-1px) rotate(45deg); }
.x-radio:checked { border-color: var(--accent); }
.x-radio:checked::after { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }
:disabled { opacity: .5; }   :focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
```

A labelled checkbox is `label.flex.items-center.gap-2.text-[13px]` (`text-xs` for the small ones in Properties). Keep `type="checkbox"` in templates (Signal Forms gotcha).

### 2.7 Segmented control (`segmented.ts`) and choice group (`units-editor.ts`)

`x-segmented` host `flex items-center gap-0.5 border-b border-edge` (unchanged). `button[xSegment]`: `px-3 h-8 text-xs font-medium border-b-2 -mb-px transition-colors`; selected `border-accent text-fg`, else `border-transparent text-muted hover:text-fg` (unchanged values, new type). The centre and right-panel tab strips use the same look (§4.1).

Choice group (the units editor's `chip()`; today `h-7 px-2.5 rounded-md border text-xs … border-accent bg-accent/10 text-fg | border-edge text-muted hover:text-fg hover:bg-elevated`): keep the values, add `font-medium` when chosen and `font-mono` on the unit, precision and fraction choices (`mm`, `0.01`, `1/16"`). Focus-visible outline, disabled .5.

### 2.8 Slider (`input[type=range]` in `layers-panel.ts`, `scene-view.html`)

Today `accent-accent h-1`. New, Chromium only:

```css
.x-range { appearance: none; width: 100%; height: 12px; background: transparent; --pct: 100%; }
.x-range::-webkit-slider-runnable-track { height: 3px; border-radius: 2px; background: linear-gradient(var(--accent), var(--accent)) 0 0 / var(--pct) 100% no-repeat var(--edge); }
.x-range::-webkit-slider-thumb { appearance: none; width: 12px; height: 12px; margin-top: -4.5px; border-radius: 50%; background: var(--accent); border: 2px solid var(--canvas); box-shadow: 0 0 0 1px var(--edge); }
.x-range:focus-visible { outline: none; }
.x-range:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 2px var(--canvas), 0 0 0 4px var(--accent); }
```

The filled part needs one binding, `[style.--pct.%]="layer.opacity * 100"`. The opacity row: `flex items-center gap-2 pl-14 text-[11px] text-muted`, the percentage `w-8 text-right font-mono tabular-nums`. The Explode slider is `w-24`.

### 2.9 Chips, tags, badges, key caps (`badge.ts`, `kbd.ts`, `library-home.html`, `catalog-panel.ts`)

| | today | new |
|---|---|---|
| tag on a card | `px-1.5 rounded bg-elevated text-[10px] text-muted` | `inline-flex items-center h-[18px] px-1.5 rounded bg-elevated text-[11px] text-muted` |
| Home filter chip | `h-6 px-2 rounded-full border text-[11px]` + `border-accent bg-accent/10 text-fg` / `border-edge text-muted hover:text-fg` | `h-6 px-2 gap-1 rounded border text-[11px]` (4 px, not a pill), hover also `bg-elevated`, the count `font-mono text-muted`; pressed as today |
| Catalog category chip | `.chip` 22 px, `border-radius: 999px`, `.chip-on` filled accent | `.chip { height: 22px; padding: 0 8px; border-radius: 4px; border: 1px solid var(--edge); font: 400 11px/14px var(--font-sans); color: var(--muted) }`, hover `color: var(--fg); background: var(--elevated)`, `.chip-on { background: var(--accent); border-color: var(--accent); color: var(--accent-fg) }` (the only filled chip) |
| `span[xBadge]` | `inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium bg-elevated text-muted` | `inline-flex items-center h-[18px] px-1.5 rounded bg-elevated text-[11px] font-medium font-mono tabular-nums text-muted`; the Warnings count adds `text-warning`; an error code `text-danger`; Otto's `bg-ai-tint text-ai` |
| `kbd[xKbd]` | `inline-flex items-center rounded border border-edge bg-elevated px-1.5 text-[10px] font-mono text-muted leading-4` | same at `text-[11px] h-[18px] whitespace-nowrap` |

### 2.10 Section header (`section-header.ts`)

Host today `flex items-center justify-between px-3 h-7 text-[11px] font-semibold uppercase tracking-wide text-muted` → `… text-[11px] font-medium uppercase tracking-[.08em] text-muted`. The actions on the right are sm icon buttons.

### 2.11 Spinner, empty state

`svg[xSpinner]`: 16 px, `stroke-width` 1.6, `text-muted` (`text-accent` while Otto's provider works, as today's `text-accent`). `x-empty-state` (today `text-sm font-medium` title, `text-xs text-muted max-w-xs` hint): title in the panel display style (`font-display font-semibold text-lg leading-6`, SOFT 50 / opsz 20), hint `text-[13px] text-muted max-w-xs`, the call to action 8 px under; the warnings panel's own empty block (shield in `--success` at 24 px) follows the same.

### 2.12 Tooltip

Native `title` today, unchanged. If a custom tooltip is built: `bg-fg text-canvas text-[11px]/[14px] px-[7px] py-1 rounded shadow-[var(--shadow-pop)]`, mono for the shortcut at 70 % paper, 500 ms delay, 6 px from the control.

## 3. Panels and rows

### 3.1 Levels panel (`levels-panel.html`)

Row today `group flex items-center gap-2 h-9 pr-2 rounded-md text-xs cursor-default select-none` + `bg-accent/12 text-fg ring-1 ring-accent/40` / `text-fg/85 hover:bg-elevated`:

```
group flex items-center gap-2 h-9 pr-2 pl-1 rounded-md border border-transparent text-[13px] text-fg select-none
hover:bg-elevated
aria-selected:bg-canvas aria-selected:border-edge aria-selected:shadow-[inset_2px_0_0_var(--accent)] aria-selected:font-medium
```

- grip `size-3.5 text-muted/60 group-hover:text-muted`; offset levels `pl-6`, no grip.
- name `flex-1 truncate` (Medium only when selected; today always `font-medium`).
- G `text-[11px] font-mono text-muted`.
- elevation `font-mono text-xs tabular-nums text-muted` (12 px; today 11), `text-warning` below ground, `text-fg` on the selected row.
- rename: the small input (`h-6 text-xs`) inside the row.
- dragging `opacity-50`; the drop marker 2 px `bg-accent`.

The selected level is a sheet of paper lifted off the panel: canvas fill, an edge and the 2 px terracotta bar at its left, the same mark the activity bar uses, so the selection never depends on a tint alone (in dark the canvas is darker than the panel).

**Level editor card** (today `mx-2 mb-3 p-2.5 rounded-md border border-edge bg-canvas/60 grid grid-cols-2 gap-x-2 gap-y-2`): `mx-2 mb-3 p-2.5 rounded-lg border border-edge bg-canvas grid grid-cols-2 gap-2` (8 px radius, full paper). Name full width; Elevation, Floor to floor, Slab are length fields with the unit suffix; Placed from a select; the two sm icon buttons bottom-right.

### 3.2 Layers panel (`layers-panel.ts`)

Row `flex flex-col gap-1 px-2 py-1.5 rounded-md hover:bg-elevated text-xs` (unchanged box). Top line: eye and lock as sm icon buttons (14 px icons; a locked lock `text-warning`), name `flex-1 truncate text-[13px]` (`text-muted` when hidden), kind `text-[10px] font-medium uppercase tracking-[.08em] text-muted`, count `w-6 text-right text-xs font-mono tabular-nums text-muted`. The opacity row as §2.8. Section header "Layers · Ground floor" as §2.10.

### 3.3 Properties panel (`properties-panel.html`, `connector-properties.html`)

- Title block `px-4 py-3 border-b border-edge`; the title (today `text-sm font-semibold`) in the panel display style: `font-display font-semibold text-lg leading-6` with `font-variation-settings: 'SOFT' 50, 'opsz' 20` ("Room", "Wall", "Stair", "3 walls"); the multi-selection summary `text-xs text-muted mt-0.5` (plain, not italic: a count, not a time).
- Editor `px-4 py-3 flex flex-col gap-2.5`; pairs `grid grid-cols-2 gap-2`.
- Field labels (`span.block.text-xs.font-medium.text-muted.mb-1` today) → `label[xLabel]` style: 12 / 16 Medium `--muted`, 4 px under.
- Lengths and angles through `.len` (§2.4); read-only numbers ("Area 17.5 m² · Perimeter 16 880 mm", "Reads 6 000 mm") `text-xs text-muted` with the values `font-mono text-fg`.
- FINISHES: caps header (`text-[11px] font-medium uppercase tracking-[.08em] text-muted mt-1`); each row `flex items-center gap-2`: label `w-16 text-xs text-muted`, `x-material-picker` with its small select `flex-1 h-7 text-xs` and the colour input as a 28 px swatch `size-7 rounded border border-edge` (today `rounded`: 4 px stays), empty swatch on `--elevated`.
- Warnings in the panel ("Not enclosed…") `text-xs text-warning`; hints `text-[11px] text-muted`.
- Connector summary blocks (`16 risers of 188 mm …`) are `pre` in the code style (§5.3), mono 12 on `--surface`.
- "Nothing selected": `x-empty-state` (§2.11) with the hint "Pick a wall, a room or a door to see its numbers here." and the key caps line.

### 3.4 Right-panel tab strip and centre tabs (`project-tab.html`)

Right strip host `flex flex-wrap items-center gap-x-0.5 px-2 border-b border-edge` (wraps to two rows as today). Tab (today `px-2.5 h-9 text-xs font-medium border-b-2 -mb-px` + `border-accent text-fg` / `border-transparent text-muted hover:text-fg`): unchanged values, `inline-flex items-center gap-1.5` so the badge and Otto's 16 px mark sit inline; the Otto tab shows the mark before its name (`03-otto.md`). Centre strip (`Plan · Section · 3D`): `h-8` tabs on `bg-surface`, Export… and Import DXF… as sm ghost buttons, the divider `w-px h-4 bg-edge mx-1`, the side-by-side sm icon button with `aria-pressed`.

### 3.5 Catalog panel (`catalog-panel.ts`)

- `x-segmented` Furniture / Materials (§2.7), `px-2`.
- Search `h-7 text-xs pl-7` with the 14 px icon at 8 px; Import… `xButton size="sm"` (secondary).
- Category chips §2.9, `flex flex-wrap gap-1 px-3 pt-2`.
- Grid `grid grid-cols-2 gap-2 p-3`. Card (today `w-full flex flex-col rounded-md border bg-canvas text-left overflow-hidden transition-colors hover:border-accent` + `border-accent` armed): `rounded-lg border border-edge bg-canvas hover:border-accent/60`; armed `border-accent shadow-[inset_0_0_0_1px_var(--accent)]` (a 2 px terracotta edge); picture `aspect-square bg-surface` (`p-1` for items), name `px-2 pt-1 text-xs leading-[15px] line-clamp-2` with the 12 px lamp icon, caption `px-2 pb-1.5 text-[11px] font-mono text-muted truncate` (today 10 px). "Nothing matches." `px-4 py-8 text-center text-xs text-muted`.

### 3.6 Home (`library-home.html`)

- Heading "Projects" / "Trash" in the page display style (`font-display font-semibold text-[28px] leading-[34px]`, SOFT 60 / opsz 36, tracking −.01 em); New project primary, Import… secondary, Trash ghost with the count in mono graphite.
- Search `relative w-80` with the 14 px icon at 10 px and `pl-8`; sort `xSelect`; chips §2.9.
- Grid `grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4`. The first slot is Otto's composer card on `bg-ai-tint` (`03-otto.md`).
- **Card** (today `group flex flex-col justify-start text-left rounded-lg border border-edge bg-surface hover:border-accent/60 hover:shadow-md transition overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50`): `… rounded-lg border border-edge bg-surface hover:border-accent/60 transition-colors overflow-hidden relative` (no shadow); selected `outline outline-2 outline-accent -outline-offset-1`; focus-visible the usual outline.
- Thumbnail `aspect-[4/3] bg-canvas border-b border-edge`; the image as today (drawn in the plan colours on paper by `renderLevelToPng`, `04-canvas.md`).
- **Placeholder** (today a gradient with big initials): a tinted sheet picked from the project id (hash mod 4): straw `color-mix(in srgb, var(--warning) 14%, var(--canvas))`, sage `color-mix(in srgb, var(--plan-room) 18%, var(--canvas))`, clay `color-mix(in srgb, var(--accent) 12%, var(--canvas))`, slate `color-mix(in srgb, var(--plan-dim) 10%, var(--canvas))`; an inline SVG doodle (one of four footprints, `stroke: var(--fg)` 1.1 px at .55 opacity, a dimension tick in `--plan-dim` at .7) and the two initials bottom-left in `font: italic 500 22px/1 var(--font-display); font-variation-settings: 'SOFT' 100, 'opsz' 36; color: var(--fg); opacity: .78`.
- Body `px-3 py-2.5`: name `text-[15px] leading-5 font-medium truncate`, meta line `flex gap-1.5 items-baseline mt-0.5` with "Edited …" italic 12 `--muted`, a `·`, the level count `font-mono text-[11px] text-muted`; tags `flex flex-wrap gap-1 mt-1.5`.
- Otto's 14 px mark `absolute right-2 top-2` on a card Otto has worked on.
- Trash list: rows `px-3 py-2 text-[13px]`, "Trashed 2 days ago" italic, Restore sm secondary, Delete sm danger; the locked-library notice `rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs` (unchanged).

## 4. Overlays

### 4.1 Dialogs (`dialog-host.html`, `export-dialog.html`, `import-dxf-dialog.html`)

Scrim today `bg-black/40` → `bg-[var(--scrim)]` (ink at 32 % on paper; the desk at 55 % in dark), `pt-[18vh]` / `pt-[6vh]` as today.

Frame today `w-[440px] max-w-[90vw] rounded-lg border border-edge bg-canvas shadow-xl p-4` → `w-[440px] max-w-[90vw] rounded-[10px] border border-edge bg-canvas shadow-[var(--shadow-pop)] p-4` (component dialogs `w-[560px]`, `max-h-[88vh] overflow-y-auto` as today).

- Title (today `text-sm font-semibold`): the dialog display style `font-display font-semibold text-xl leading-[26px]` with `font-variation-settings: 'SOFT' 60, 'opsz' 24; letter-spacing: -0.01em`.
- Message `text-[13px] text-muted mt-1`; details list `mt-2 ml-4 list-disc text-[13px] text-fg/85`.
- Fields: `label[xLabel]` + `xInput` / `xSelect`; a prompt's choice row `flex items-center gap-2 mt-3` with the caption hint.
- Footer `flex justify-end gap-2 mt-5`: Cancel `variant="ghost"`, the confirm `variant="primary"`, or `variant="danger"` with `border-danger/40` for a destructive one.

**Export dialog:** title "Export" and the project name as `text-xs text-muted mb-3 truncate` (a name, upright). Format cards (today `flex h-full flex-col gap-0.5 rounded-md border border-edge bg-surface px-2 py-1.5 transition-colors hover:bg-elevated peer-checked:border-accent peer-checked:bg-accent/10 peer-focus-visible:ring-2 peer-focus-visible:ring-accent/30`): same box, `peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-accent peer-focus-visible:outline-offset-1`; label `text-[13px] font-medium text-fg` (today `text-sm font-semibold`), hint `text-[11px] leading-tight text-muted`. Levels radios (§2.6) `flex flex-wrap gap-x-4 gap-y-1 text-[13px]` with the level name in `--muted`; the caption under ("One file, a page per level (2)"). Page / Orientation / Scale `grid grid-cols-3 gap-3`, `xSelect class="w-full"`. PNG's Width / Height are mono fields with a `px` suffix. Footer: Cancel ghost, Export… primary (disabled while invalid).

### 4.2 Command palette (`command-palette.html`, `.css`)

Frame today `w-[580px] max-w-[92vw] rounded-lg border border-edge bg-canvas shadow-2xl overflow-hidden` → `rounded-[10px] … shadow-[var(--shadow-pop)]`; scrim as dialogs, `pt-[12vh]`.

```css
.palette-input { height: 44px; padding: 0 14px; border: 0; border-bottom: 1px solid var(--edge); background: transparent; font: 400 14px/20px var(--font-sans); color: var(--fg); }
.palette-input::placeholder { color: color-mix(in srgb, var(--muted) 70%, transparent); }
.palette-list { max-height: 360px; overflow: auto; padding: 6px; }
.palette-heading { padding: 8px 8px 4px; font: 500 11px/14px var(--font-sans); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }   /* today 600 / .04em */
.palette-item { display: flex; align-items: center; gap: 10px; padding: 7px 10px; border-radius: 6px; font: 400 13px/18px var(--font-sans); color: var(--fg); }
.palette-item[data-selected='true'] { background: var(--elevated); }
.palette-empty { padding: 16px; font-size: 13px; color: var(--muted); text-align: center; }
```

In a row: the title `flex-1`, the shortcut as `kbd[xKbd]`, the command id `text-[11px] font-mono text-muted` (today 10 px). The command form (`palette-form`): `p-4 flex flex-col gap-3`, the title in the panel display style (18 / 24), description caption, fields as everywhere (lengths with their suffix, a required mark `text-danger`), Back ghost and Run primary with `[loading]`.

### 4.3 Context menu (`context-menu-host.html`)

Panel today `fixed z-50 min-w-52 max-w-80 rounded-md border border-edge bg-elevated shadow-lg py-1 text-xs select-none` → `… rounded-lg border border-edge bg-surface shadow-[var(--shadow-pop)] py-1 text-xs select-none`. Row today `w-full flex items-center gap-6 py-1.5 text-left outline-none hover:bg-surface focus-visible:bg-surface disabled:opacity-40` → `… py-1.5 hover:bg-elevated focus-visible:bg-elevated disabled:opacity-40` with `px-3` (`pl-1.5 pr-3` with the check gutter, 16 px, as today); `text-fg`, danger rows `text-danger`; the shortcut `text-[11px] font-mono text-muted`; separator `my-1 h-px bg-edge`. 28 px rows, 12 px text, 8 px radius.

### 4.4 Toasts (`toast-host.html`)

Stack `fixed bottom-8 right-3 flex flex-col gap-2 w-80` (unchanged). Toast today `flex items-start gap-2 rounded-md border bg-canvas shadow-lg px-3 py-2 text-sm` + `border-danger/50` / `border-success/50` / `border-edge` → `flex items-start gap-2 rounded-lg border bg-surface shadow-[var(--shadow-pop)] px-3 py-2 text-[13px]` with the same edge colours; icon `size-4 mt-0.5` in `text-muted` / `text-danger` / `text-success`; the action `text-xs font-medium text-accent hover:text-accent-hover`; the cross `text-muted hover:text-fg` at 14 px. Times as today (3 s; 6 s for errors and toasts with an action).

## 5. Settings (`settings-tab.html` and the section components)

### 5.1 Page and headings

Column `max-w-3xl mx-auto px-8 py-8 flex flex-col gap-10` (unchanged). `h1` "Settings" in the page display style (28 / 34); each section's `h2` (today `text-sm font-semibold mb-1 pb-1 border-b border-edge`) in the panel display style `font-display font-semibold text-lg leading-6 mb-1 pb-1 border-b border-edge`; the description `text-[13px] text-muted mb-3` (today 12 px); sub-headings (`h3`: "Recent agent calls", "What's new in …") `text-xs font-medium text-muted mt-5 mb-1.5`.

### 5.2 Units

The editor's grid `grid-cols-[9rem_1fr] gap-x-4 gap-y-2.5`; row labels `text-xs text-muted`; the choice groups §2.7 (mono on the unit, precision and fraction rows); the Example `font-mono text-[13px]` with the units in `--muted`.

### 5.3 Library path and the MCP snippets (`library-settings.ts`, `settings-tab.html`)

Code block (the path `code`, the snippet `pre`, the update notes, the connector summaries): `text-xs font-mono bg-surface border border-edge rounded-md px-2 py-1.5` (unchanged values); the path `truncate` with its `title`, snippets `overflow-x-auto whitespace-pre`, each with its sm secondary Copy button beside it; the snippet label `label[xLabel]` with the "· where" part at weight 400. Move… sm secondary, Rescan sm ghost; the count line caption; a warning `text-xs text-warning` with the 14 px triangle.

MCP row: the Enabled checkbox (§2.6), Port as a 96 px mono field, the state `text-xs` in `text-success` / `text-danger`, Try again sm secondary; the mutations checkbox with its caption under. Recent calls: `border border-edge rounded-md divide-y divide-edge text-xs`, rows `flex items-center gap-3 px-2.5 py-1.5`: a 6 px `bg-success` / `bg-danger` dot, the tool `font-mono`, "via MCP: Claude Code" in `--muted` (`truncate`), an error as `xBadge` in `text-danger`, the time right-aligned in italic `--muted`.

### 5.4 Assistant and Updates (`updates-settings.ts`)

Assistant: provider select `w-72`, the Claude Code command as a mono field `w-96` with Check again (sm secondary, loading), the state line `text-xs` in `text-success` / `text-warning`, the model a mono field `w-56`. Updates: the status line `text-[13px] mb-3` coloured by `tone()` (`text-muted` idle, `text-success` ready / up to date, `text-warning` unsupported, `text-danger` failed); Check for updates and Download sm secondary (loading while checking / downloading), Restart and install sm primary (disabled until ready); the notes block as §5.3 (`whitespace-pre-line max-h-48 overflow-auto`); the startup checkbox `text-[13px] mt-4`. Sections registered with `order ≥ SETTINGS_LATE` keep rendering after the Assistant.

## 6. Otto: base styles (full treatment in `03-otto.md` / `otto.html`)

- **Mark:** `otto-mark.svg` at 28 (panel header), 24, 20 (Home composer title), 16 (tab strip, History rows, tool cards), 14 (Home cards): a `--ai` tile with `rx` 22 %, Otto's room outlined in `--ai-fg` at 1.6 px, the pen dot `r` 2.1 on its top-right corner.
- **Otto's paragraphs:** `pl-3 border-l-2 border-ai` on body 13.
- **Tool card:** `rounded-md border border-edge border-l-[3px] border-l-ai bg-canvas px-2.5 py-1.5 text-xs`: a 16 px moss check / ochre shield / red alert / terracotta spinner, the human title Medium, then `command id · level · layer · undoable, by Otto` as a caption with the id in mono.
- **History row:** `bg-ai-tint` with the 16 px mark where yours have a 6 px `bg-muted` dot; the signature caption "Otto · Structure · plan.apply · just now" (time italic).
- **Composer (Home):** `rounded-lg border border-edge bg-ai-tint p-3.5`: the title with the 20 px mark in the panel display style, an `xTextarea` on paper, the rule line as a caption and the one `bg-ai text-ai-fg hover:bg-ai-hover` sm button "Draft it".
- **Status bar:** §1.4. **Badge:** `bg-ai-tint text-ai`.

## 7. The mocks in `components.html`

Four 1512 × 816 CSS px mocks (the smoke window at 125 % = 1890 × 1020), scaled to the page: Settings (light), the Export dialog over the Duplex project (dark), the command palette over Home (light, with the composer card in the first slot), and the Catalog panel on Materials (light). They are built from the same classes as the specimens.

## Problems found

1. **Labels at 11 px (decisions §3).** Alegreya Sans's x-height is about 12 % smaller than Segoe UI's, so 11 px reads like 10 px today. This document keeps 11 / 14 for captions, meta and caps and sets field labels at 12 / 16; body stays 13 / 18 as decided. If the owner wants 11 everywhere, `label[xLabel]` is one class.
2. **`--muted` on `--surface` in light** (`#7b7064` on `#efe8dc`) is 4.1 : 1, just at AA for normal text; on `--elevated` (`#e6ddcd`) it is 3.7 : 1, under AA. Graphite text is therefore never put on the elevated tint in this spec (chips and badges on `--elevated` use 11 px Medium, where it is a hint, and the hovered row's name is in ink). In dark the pair is 6.5 : 1. Reported, not changed.
3. **`--accent-fg` on `--accent` in dark** (`#1d1a17` on `#e07c50`) is 7.6 : 1 and fine; in light `#fbf6ee` on `#b9552f` is 4.6 : 1 at 13 px Medium: AA, not AAA. Primary buttons never use 11 px text.
4. **`--ai` on `--ai-tint` in light** (`#8a3f6f` on `#f1e3ea`) is 5.5 : 1, in dark (`#d892bd` on `#332631`) 7.1 : 1: fine for the Otto badge and composer text. `--ai` on `--canvas` light is 6.4 : 1.
5. **The native select chevron** cannot be given the 1.6 px stroke without `appearance: none` and an SVG that repeats `--muted`'s hex per theme, which would break the single-source rule; the native chevron is kept and `color-scheme` makes the popup follow the theme. If a drawn chevron is wanted later, it goes through a `mask-image` with `background-color: var(--muted)`.
6. **The length suffix** moves the unit out of the field's value (§2.4): `properties-panel.html`, `levels-panel.html`, the rules settings, the export dialog's px fields and the smoke checks that read those inputs (`prop-thickness`, `level-elevation-input`, …) change together. The alternative, keeping "200 mm" in the input, cannot colour the unit.
7. **Fraunces in Settings section headings** is an extension of "panel and dialog titles": each Settings section reads as a panel. If the owner prefers the strict list, the `h2`s fall back to sans 500 at 13 px with the same rule under.
8. **The selected level row** adds a 2 px terracotta inset bar to Craft's canvas-and-edge treatment (concept.html's `.lvl.active`), because in both themes the fill alone was too quiet next to the hover tint; it is the activity bar's own mark, not a new element.
9. **`focus-visible:ring-*` → outline.** Tailwind's ring is a box-shadow, which the length wrapper's and the invalid state's shadows would overwrite; the outline keeps focus visible on every control. `04-canvas.md` should check the plan canvas's own focus treatment against it.
