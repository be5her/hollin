# Changelog

Every notable change to the app, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the version numbers [Semantic Versioning](https://semver.org/spec/v2.0.0.html). A release's section is its notes on GitHub and in the app's Updates section (`docs/release.md`).

## [Unreleased]

## [0.2.0] - 2026-11-07

The first stable version: everything in 0.2.0-beta.1, and Otto now reads images you paste into the chat.

### Added
- Paste an image into Otto's message field (a screenshot, a photo of a sketch, a floor plan you found) or drop one on it: Otto sees it with your message. Up to 6 per message; large ones are shrunk to 1568 px on the long edge before they are sent. Works with the Claude API and with your Claude Code.
- Beta versions: *Get beta versions* in Settings > Updates offers pre-releases too. Off (the default), only stable versions are offered, and a beta you have stays until a newer stable version comes.
- A first-launch guide, an empty-project guide and a "Start with Otto" card on Home.
- Otto's recent edits are marked on the plan for a minute, and what it is about to delete is outlined until you answer; "Start with Otto" on Home drafts the ground floor from a sentence; Home cards show Otto's mark when it has worked on the project.
- History: click a change to select what it changed on the plan, double-click to undo down to it.
- The first-launch guide's Otto line takes a sentence: Enter starts a project with it and sends it to Otto.

### Changed
- The app is **Hollin**. The window, the installer, the title block of exported sheets and the About page carry the name. Three things follow it: the data folder is now `Hollin` (a library left under the old `Plan Studio` folder is not picked up by itself; move its contents, or point Settings > Library at it), project packages use the `.hollin` extension (a `.psp` package written before is the same format: rename it to `.hollin` to import it), and the MCP server is named `hollin`, so a `mcp__plan-studio__*` entry in a Claude Code, Claude Desktop, Cursor or VS Code allow-list must become `mcp__hollin__*`.
- The assistant is Otto: its tab, its voice, its edits signed Otto in History and on the status bar; outside MCP agents stay "MCP · <name>".
- Home cards without a thumbnail show a tinted sheet with the project's initials; About shows the icon, the wordmark and the fonts' licences.
- The look: a paper and ink palette with a terracotta accent, Alegreya Sans, IBM Plex Mono and Fraunces bundled, lighter icons; the plan, the 3D view and the exports' renders follow.
- A new app icon: two rooms, yours and the assistant's; the title bar shows the icon and the wordmark.
- SVG and PDF plans print in the paper palette's inks and carry a title block with the app's name, the project, the level, the scale and the date; DXF layers use matching AutoCAD colour indices.

## [0.2.0-beta.1] - 2026-11-01

The first beta: a preview of 0.2.0. Turn on Settings > Updates > *Get beta versions* to be offered the next betas as they come out.

### Added
- Beta versions: *Get beta versions* in Settings > Updates offers pre-releases too. Off (the default), only stable versions are offered, and a beta you have stays until a newer stable version comes.
- A first-launch guide, an empty-project guide and a "Start with Otto" card on Home.
- Otto's recent edits are marked on the plan for a minute, and what it is about to delete is outlined until you answer; "Start with Otto" on Home drafts the ground floor from a sentence; Home cards show Otto's mark when it has worked on the project.
- History: click a change to select what it changed on the plan, double-click to undo down to it.
- The first-launch guide's Otto line takes a sentence: Enter starts a project with it and sends it to Otto.

### Changed
- The app is **Hollin**. The window, the installer, the title block of exported sheets and the About page carry the name. Three things follow it: the data folder is now `Hollin` (a library left under the old `Plan Studio` folder is not picked up by itself; move its contents, or point Settings > Library at it), project packages use the `.hollin` extension (a `.psp` package written before is the same format: rename it to `.hollin` to import it), and the MCP server is named `hollin`, so a `mcp__plan-studio__*` entry in a Claude Code, Claude Desktop, Cursor or VS Code allow-list must become `mcp__hollin__*`.
- The assistant is Otto: its tab, its voice, its edits signed Otto in History and on the status bar; outside MCP agents stay "MCP · <name>".
- Home cards without a thumbnail show a tinted sheet with the project's initials; About shows the icon, the wordmark and the fonts' licences.
- The look: a paper and ink palette with a terracotta accent, Alegreya Sans, IBM Plex Mono and Fraunces bundled, lighter icons; the plan, the 3D view and the exports' renders follow.
- A new app icon: two rooms, yours and the assistant's; the title bar shows the icon and the wordmark.
- SVG and PDF plans print in the paper palette's inks and carry a title block with the app's name, the project, the level, the scale and the date; DXF layers use matching AutoCAD colour indices.

## [0.1.0] - 2026-10-28

The first release.

### Added
- Scaffold: monorepo, command registry, MCP server, host, shell, settings, smoke test, CI.
- Project library: storage, index, Home screen, tabs, autosave, snapshots, trash, packages.
- Document model: building, levels, layers, entities, connectors, transactions, undo, live mirror.
- 2D editor: plan view, walls and joins, snapping, exact input, openings, rooms, shapes, dimensions, thumbnails.
- Vertical circulation: stairs, ramps and elevators on the plan, slab openings, plan symbols, drawing tools, angle tracking, rule warnings.
- AI tools: `plan.describe`, `view.snapshot`, MCP resources and a prompt, the in-app assistant (the Claude API, or your own Claude Code).
- 3D view: stacked levels, extrusion, cut openings, slabs, connector geometry, isolate, cutaway and explode, orbit and walk cameras, 3D snapshots.
- Decor: a built-in and imported (glTF) furniture catalog, placing and editing items, materials and finishes, lights with day and night in 3D, door and window parts.
- Export and import: plans as DXF, SVG and PDF, the building as glTF, PNG renders of the plan or in 3D, DXF import to trace over, the Export dialog.
- In-app updates from GitHub Releases: check, download and install from Settings > Updates, a daily check at startup that can be turned off; nothing downloads or installs without you.
- Releases: signed and notarized installers when the certificates are set up (unsigned until then), built for Windows, macOS and Linux and published from a version tag.

### Fixed
- A review of milestones 1 to 9 fixed what they had skipped: storage and the library, the document model and the 2D editor, the assistant and MCP, the 3D view and decor, the export writers, glTF and DXF import, the exchange UI's safety, the theme and the shell; it also added the escalator tool (`docs/fixes-1.md`).
- The exports were read by programs the app did not write (ezdxf, pypdf, the Khronos glTF validator, Chromium for SVG); a level too large for the sheet at a fixed scale no longer runs past the margins in SVG and PDF.
