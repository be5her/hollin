# Milestone 12: Arabic

The owner's ask: "full ar lang support for all parts of the app including the chat with otto make sure arabic conversation is fully supported."

Hollin gets a second language, Arabic, and with it a right-to-left interface. Every part of the app speaks it: the shell, every module's panels, dialogs, toasts and menus, the plan's tool hints and canvas text, the command palette, History, warnings, errors, exports, and Otto, who must hold a whole conversation in Arabic and write Arabic into the design.

`docs/i18n.md` is the convention this milestone introduces and every step follows: read it first. The work is on the branch `feat/arabic`, one commit per step, one pull request at the end.

## Decisions

- **Own runtime, no dependency.** A typed catalog in `packages/core/src/i18n` (already there: `translate`, `t`, `setLanguage`, plural forms, `resolveLanguage`, `textDirection`, `toLatinDigits`, `foldForSearch`, `commandTitle`, and its tests). `@angular/localize` builds one bundle per language and cannot switch at run time; a translation library would be a dependency for what is 100 lines.
- **Live switch.** The renderer's `I18n` service holds the language in a signal; `t()` reads it, so the app follows without a restart.
- **English text is frozen.** Moving a string into the catalog never changes its English wording (the smoke reads it). The smoke runs in English with the system locale pinned; one Arabic section at the end switches, checks and switches back.
- **Western digits and unit symbols** in both languages; Arabic-Indic digits are accepted wherever a number is typed.
- **Names stay Latin:** Hollin, Otto, Claude, Claude Code, MCP.
- **The canvases never mirror;** the chrome does.
- **Agents read English:** command descriptions, schemas, guidelines, `plan.describe`, error `message`s. The user reads Arabic: titles, labels, errors (through `i18n` on the error), warnings.
- **Fonts:** IBM Plex Sans Arabic (text) and Noto Naskh Arabic (headings), OFL, already in `src/renderer/src/fonts/` with their licences.

## Rules for every step

- Read `CLAUDE.md` and `docs/i18n.md` first. Follow the Angular conventions there.
- English strings move to `packages/core/src/i18n/en/<area>.ts` unchanged, with their Arabic in `ar/<area>.ts`, following the glossary. Write natural Arabic, not word-for-word.
- Convert every physical direction class in the files you touch to its logical one; add `dir="auto"`, `bidi-ltr` and `rtl:-scale-x-100` where `docs/i18n.md` says.
- Remove the files you finished from the pending lists of the guard tests (`packages/modules/i18n-templates.test.ts`, `packages/modules/commands-i18n.test.ts`); never add to them.
- Before the commit: `npm run typecheck`, `npm test`, `npm run smoke` (with `SMOKE_SHOTS=<dir>`, and look at the screenshots, light and dark; from step 1 on the smoke also takes Arabic ones). Two unit tests are timing-bound and can time out on a busy machine (`perf.test.ts`, the hostile packages in `library.test.ts`): rerun them alone before believing a failure. Stop stale Electron processes by PID before trusting a smoke failure; a smoke check that fails sometimes is a missing wait: fix the wait.
- Update the README of every module whose behaviour or smoke coverage changed.
- Commit on `feat/arabic` with a message that says what and why, ending with `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`. Stage your files by path: `docs/brief.md` shows as deleted in the working tree and is not yours to commit. Do not push.
- Leave notes for the next step at the end of this file under "Hand-over" (what the next step should know, in a few lines), in the same commit.

## Steps

### 1. Foundation, the shell and Settings

- **Main:** `host.opts.systemLocale` (Electron's `app.getLocale()`; the smoke passes `en-US`; `STUDIO_LANG` overrides it in development). The host resolves the language from `appearance.language`, calls `setLanguage` at start and on every config change, and emits `language.changed` (`{ language, direction }`, added to `HostEvents`) when the resolved language changes. A read-only command `app.language` returns `{ language, direction, preference, systemLocale }`, so an agent can learn the user's language too.
- **Renderer:** `I18n` in `packages/ui` (`@Service()`): `language` and `direction` signals, `t(key, params)` reading the signal, `commandTitle(meta)`, `intlLocale`; it loads `app.language` in `ShellStartup.load`, follows `language.changed`, calls core's `setLanguage`, and sets `lang` and `dir` on `<html>`. `relativeTime` and every `toLocale*String` go through `intlLocale`.
- **Styles:** `@font-face` for the Arabic faces with an Arabic `unicode-range` (U+0600-06FF, U+0750-077F, U+0870-088E, U+0890-0891, U+0897-08E1, U+08E3-08FF, U+200C-200E, U+2010-2011, U+204F, U+2E41, U+FB50-FDFF, U+FE70-FE74, U+FE76-FEFC), added to `--font-sans`, `--font-mono` (the sans Arabic face, after the mono) and `--font-display`; `size-adjust` if Arabic reads small beside Alegreya Sans at 13 px (judge from screenshots); the `bidi-ltr` utility; for Arabic text no letter-spacing (the heading utilities, any `tracking-*`) and no synthesised italics (`font-synthesis-style: none`); a line-height check on the tight `leading-[14px]` rows. Check `out/renderer/media/` for the new font files after a build. Update the About line and the licences dialog with the two faces.
- **Settings:** a Language select in Appearance (`system`, English, العربية: each language under its own name), applied at once like the theme.
- **Translate and convert to logical classes:** `src/renderer/src/app/**` (title bar, tabs, status bar, command palette and its form, activity bar, sidebar, home shell, shell actions, startup's tab titles), all of `packages/ui/src` (dialogs, toasts, context menu, controls, empty state, section header, format helpers, `otto` state labels), and the whole settings module. Tab titles the shell owns (Home, Settings) follow the language. `drag-reorder`, the tab strip's wheel scroll and the drop marker work in both directions. The title bar keeps the physical space for the window buttons (right on Windows and Linux, left on macOS) in both directions.
- **Palette:** shows `commandTitle`, matches the query against the Arabic and the English title with `foldForSearch`.
- **Guards:** `packages/modules/i18n-templates.test.ts` scans every template (`.html` files and inline `template:` strings in `packages/modules/*/ui`, `packages/ui/src`, `src/renderer/src/app`) and fails on (a) a text node or a literal `placeholder`, `title`, `aria-label`, `alt` or `label` attribute holding words (a short allow-list for the names that stay Latin and for key names), (b) a physical direction class outside the exceptions `docs/i18n.md` lists. Files not converted yet sit in a `PENDING` list in the test, which later steps empty. `packages/modules/commands-i18n.test.ts` builds the registry with every module and fails when a command that is not hidden has no title in `ar/commands.ts`, with a `PENDING_MODULES` list the same way; this step adds the titles of the host's own commands and the settings module's.
- **Smoke:** `src/main/smoke/arabic-ui.ts`, run after the other UI sections and before `identity-ui.ts`: pick العربية in Settings through the UI, wait for `<html dir="rtl" lang="ar">`, check the Settings heading, the title bar's search field and a palette search in Arabic, take screenshots (numbers from 75 up; grep before taking one), switch back and check `dir="ltr"` and the English heading. Later steps add to this section.

### 2. Library, Home, the project tab, exchange, updates, edit

The `library`, `exchange`, `updates` and `edit` modules: their `ui/` (Home and its cards, first launch, the Otto composer's strings, the project tab's toolbar and panels frame, project details, the library's settings section, export and import dialogs, exchange actions and toasts, the Updates section and notices, the History panel) and the user-facing strings their `main.ts` produces (native dialog titles and filter names, toasts raised from results). Their command titles in Arabic. User text (project names, descriptions, tags, snapshot names) is `dir="auto"`; sizes, dates, paths and versions are `bidi-ltr`. Project search folds Arabic. The Arabic smoke section opens a project named in Arabic and screenshots Home and the project tab.

### 3. The plan and the viewport

The `plan` module's `ui/` (toolbar, tool options bars, properties panels, connector, item and light properties, the material picker, the empty guide, the snap and status footer) and `packages/viewport`: tool hints and prompts, snap labels, tool names, the coordinate entry, everything the canvas writes. `parseLength`, `parseAngle`, `parseCoordinate` and every numeric field accept Arabic-Indic digits (`toLatinDigits`, with unit tests). Canvas text sets `ctx.direction` per text (`textDirection`); measurements are always left to right; Arabic labels and room names are shaped and placed right (anchor, alignment, the readable-angle rule) in the plan, the offscreen renders and the thumbnails; the canvas waits for the Arabic faces. The length control and every measurement in the panels are left-to-right islands. The plan module's command titles. Smoke: a tool hint in Arabic, a length typed with Arabic-Indic digits lands as millimetres, a label in Arabic drawn on the canvas, screenshots of the plan in Arabic.

### 4. Building, rules, decor

The `building` module (levels and layers panels, the 3D view's toolbar and presets, the section view, the rules settings section), the `rules` module (the warnings panel; warnings carry a key and parameters and the panel translates them, agents keep the English text), the `decor` module (the catalog panel, categories and tags, the built-in furniture, materials and styles by id through `builtin.*` keys, catalog search matching Arabic names with `foldForSearch`). Their command titles. Smoke: the levels panel and the catalog in Arabic, a warning shown in Arabic, a catalog search in Arabic.

### 5. The main process

Everything the user reads that main writes: `StudioError.i18n` (`{ key, params }`, carried in `ErrorPayload` across IPC, ignored by MCP) on every error a person can meet through the UI or the assistant's chat, and a translated lead per error code for the rest (`Toasts.error` and the panels use them); History labels (`editProject` labels through `t`), default names in new documents (levels, layers, new projects, snapshots, duplicated names), author labels (`You`, `via MCP`), native dialogs, the macOS menu, the update notices, anything else `grep` finds. Empty the pending lists of both guard tests. Unit tests for the error payload and the translated defaults; the smoke checks an error toast and a History entry in Arabic.

### 6. Otto

The `assistant` module's `ui/` (the panel, its empty states, the composer, tool and confirm cards, the presence on the status bar) and what its `main.ts`, `loop.ts` and `claude-code.ts` say to the user (notes, errors with a translated lead for the known cases: no key, a refused key, rate limit, overload, no connection, Claude Code not found or not logged in). Arabic conversation, fully:

- Both providers tell the model, in the live context (not the cached prefix), the user's interface language, to answer in the language the user writes in, and to name what it draws (rooms, levels, labels, layers, History labels) in that language unless the project's names are in another.
- Chat text (the user's, Otto's, the composer, examples, Home's Otto line) is `dir="auto"` per message, so Arabic, English and mixed messages each read right; the streaming caret sits at the text's end in both directions; tool ids, commands and JSON previews stay left-to-right islands.
- Tool cards show `commandTitle`; the confirm card, the hints and the examples are translated (the Arabic examples are Arabic requests).
- The fake API and the fake Claude Code script Arabic turns. Smoke: an Arabic message, an Arabic streamed reply, a tool call that writes an Arabic room name which then shows on the plan and in the panel, a confirm card answered, the request the fake API received carrying the language instruction, screenshots of the conversation light and dark. Unit tests for the prompt.

### 7. Exports and imports

- **PDF:** Arabic text (names, labels, the title block) is embedded: a TrueType face read and embedded by `exchange/pdf.ts` itself (cmap, widths, `CIDFontType2` with `Identity-H` and a `ToUnicode` map), shaped to presentation forms with the lam-alef ligatures and reordered by a small bidi pass in core (`exchange/arabic-shape.ts`), Latin and numbers staying in Helvetica. No dependency. The face ships with the app as a resource main reads (IBM Plex Sans Arabic Regular, a TrueType file whose cmap has the presentation forms; check it). Unit tests for shaping, reordering and the PDF's structure; a manual sample for the exchange README's outside checks.
- **SVG:** the Arabic face in the font stack, `direction` and anchors right for Arabic text. **DXF:** export already writes `\U+XXXX`; import decodes `ANSI_1256` (and the other code pages `$DWGCODEPAGE` names) with `TextDecoder`. **PNG and snapshots:** wait for the Arabic faces.
- The title block and every string an export writes follow the language. Smoke: an Arabic-named level exported as PDF, SVG and DXF and checked.

### 8. The Arabic pass and the documents

Run the app in Arabic end to end (the smoke's Arabic section, widened to walk every panel, dialog and menu, light and dark) and fix what the screenshots show: clipped or overlapping text, wrong alignment, icons that should or should not mirror, `mm 3600`, stale English. Then the documents: `README.md`, module READMEs, `CHANGELOG.md` under Unreleased, `CLAUDE.md` (the i18n convention and its gotchas), `docs/i18n.md` kept true.

### 9. Review

A read-only review of `git diff origin/main..HEAD` (correctness, both directions, Arabic quality, agents still reading English, nothing mutating or hidden changed), fixes, `docs/milestone-12-review.md`, then the pull request.

## Hand-over

(Each step leaves its notes here.)

### Before step 1

- Done already: `packages/core/src/i18n/` (runtime, `text.ts`, the `common` and `settings` seed catalogs, `ar/commands.ts` empty, `i18n.test.ts`), `appearance.language` in the config schema and defaults, the font files and their OFL texts in `src/renderer/src/fonts/`, `docs/i18n.md`.
- The seed catalog's `settings.language.*` and `common.*` keys are there to be used and extended.

### After step 1

- **Main:** `HostOptions.systemLocale` (`app.getLocale()`, `en-US` in the smoke, `STUDIO_LANG` in `npm run dev`); `Host.applyLanguage` resolves `appearance.language` at construction, at start and on every config change, calls core's `setLanguage` and emits `language.changed` only when the resolved language changes. `app.language` (read-only) answers `Host.languageState()`. `src/main/host.test.ts` covers it.
- **Renderer:** `I18n` (`packages/ui/src/i18n/i18n.ts`): `language`, `direction`, `locale` signals, `t`, `label(keyOrText, params)` and `commandTitle`. `ShellStartup.load` awaits `I18n.load()`; the startup subscribes `I18n.follow()`. Components use `protected readonly t = inject(I18n).t;`. Beware a template variable named `t` (`@for (t of …)`, `#t="xLength"`): it shadows the function; rename it (the toast host's loop became `toast`).
- **Registries take keys:** `UIAction.title`/`group` (plus `titleParams`), `SettingsSection.title`, `ModuleUI.title` and `Tab.titleKey` are message keys shown through `I18n.label` (plain text still shows as it is, so unconverted modules keep working in English). Step 2 should give the library's, exchange's and edit's actions, sections, panels and module titles keys; `ProjectPanels` titles are not yet run through `label` (the project tab is step 2's).
- **Helpers in `@studio/ui` that translate** take an optional `Translate` (`providerLabel`, `effortLabel`, `ottoModelLabel({ t })`); without one they read core's process language, which does not follow a switch reactively. `OTTO_RULE` is now a key (`common.ottoRule`); the assistant panel translates it. `relativeTime(iso, now, language)`: pass `I18n.language()` in a `computed` so it follows a switch. `Toasts.copy` defaults to `common.copied`.
- **Guards:** `packages/modules/i18n-templates.test.ts` scans `.html` files and the `.ts` files with an inline `template:` (or a physical class anywhere) under `packages/modules/*/ui`, `packages/ui/src`, `src/renderer/src/app`. It fails on literal text or `placeholder`/`title`/`aria-label`/`alt`/`label` attributes with words (allow-list `KEEP`: the names, key names, `JSON`, `Electron`, `Chromium`, unit symbols) and on physical classes (`ml-*`, `pr-*`, `left-*`, `border-r`, `rounded-l*`, `text-left`, …; only `left-1/2` is allowed). A `PENDING` file that becomes clean fails the test until it is removed from the list. `commands-i18n.test.ts` builds the registry from the host's commands and every main module; `PENDING_MODULES` holds the modules that still have shown commands without an Arabic title (`updates` and `assistant` have only hidden commands, so they are not in it). Both lists only shrink.
- **Styles:** the Arabic faces have the Arabic `unicode-range`, follow the Latin faces in `--font-sans`, `--font-mono` and `--font-display`; `.bidi-ltr`; `:lang(ar)` resets letter-spacing (important, it beats the heading utilities and component styles) and synthetic italics. No `size-adjust` was needed (see the screenshots 77 to 81).
- **Title bar:** the window buttons' space is the header's own physical padding (`[style.padding-right]` with `env(titlebar-area-*)`, `68px` on the left on macOS); everything inside is logical. The context menu opens to the left of the pointer in RTL; `dragReorder` reads a right-to-left strip; the drop marker is placed by physical `left` (the same formula holds in both directions with Chromium's negative `scrollLeft`).
- **Opening Settings from a module** (the library's Otto composer and first launch, the assistant panel, the plan view, the update notices) now passes `titleKey: 'shell.tab.settings'` and sets the section on an already open tab too (it used not to scroll when Settings was open; the Arabic section exposed it). `<x-wordmark>` is `dir="ltr"`, so its full stop stays after the name.
- **Smoke:** `src/main/smoke/arabic-ui.ts` runs after the assistant sections and before `identity-ui.ts`, and switches back to `system` (English) at its end. Screenshots 77 to 81 are taken; the next step's start at 82. Add new Arabic checks before its "back to English" part.
- **Not done here, for later steps:** the native dialogs' titles and filters, toasts and errors raised from main (step 5), the macOS menu, `Units.parseLength`'s Arabic-Indic digits (`toLatinDigits`, step 3; the palette's number fields already take them), the canvases' text.
