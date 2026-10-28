# Changelog

Every notable change to the app, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the version numbers [Semantic Versioning](https://semver.org/spec/v2.0.0.html). A release's section is its notes on GitHub and in the app's Updates section (`docs/release.md`).

## [Unreleased]

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
