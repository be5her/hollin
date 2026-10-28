# Updates

In-app updates (milestone 10): the app finds a new version on its GitHub Releases, downloads it when the user asks and installs it when the user restarts. Nothing is downloaded or installed without the user.

## What it does

- **The updater is a host service**, like the dialogs. `src/main/updater.ts` wraps `electron-updater`'s `autoUpdater` (`autoDownload: false`, `autoInstallOnAppQuit: true`) behind the host's `Updater` (`src/main/update-state.ts`); the host takes it in its options (`HostOptions.updater`), hands it to commands as `host.updater` and announces each change as `update.changed`. The smoke passes a scripted one instead (`src/main/smoke/updater.ts`), so no smoke run reaches the network or quits.
- **One state record** (`UpdateState` in core): `idle`, `checking`, `available` (with `version` and `notes`), `up-to-date`, `downloading` (`progress`, 0 to 100, announced once per whole percent), `ready`, `error` (`message`: the error's first line) or `unsupported` (`message`: why), with `checkedAt` (the last check that reached the feed) and `scheduled` (that check was the startup one). What may follow what lives in `UpdaterBase`, shared by the real and the scripted updater: a check while one runs, while downloading, after a download is ready or in an unsupported build does nothing; a download needs a version found; an install needs a download ready. Failures of the feed, the download or the installer become `state: 'error'`, never a thrown error or a crash.
- **Release notes** are kept as plain text: the GitHub provider gives the release body as HTML, so `plainNotes` drops the tags (scripts and styles with their content), turns `<br>`, block ends and list items into lines (`- ` for an item), decodes entities and squeezes blank runs. The UI shows them as text, never as HTML.
- **When this build cannot update** (`unsupported`), read from electron-updater 6's own rules (`updateSupport`, unit-tested):
  - a development run (not packaged), unless a `dev-app-update.yml` sits in the app path, electron-updater's own way to test updates in development (`forceDevUpdateConfig`);
  - no `app-update.yml` under `process.resourcesPath`: electron-builder writes it only when the build has a `publish` feed, which only the release workflow sets, so a local `npm run package` has none;
  - Linux, when the app runs neither from its AppImage (`APPIMAGE` is not set) nor as an installed package: electron-updater 6 updates a deb, rpm or pacman install too (`DebUpdater` and the others, chosen by the `package-type` file electron-builder writes into a package's resources; it installs with `pkexec`/`sudo` and `dpkg`), so the `.deb` is supported, not excluded;
  - macOS, when the app is not signed with a Developer ID (`codesign -dv` shows no `TeamIdentifier`, or `Signature=adhoc`): Squirrel.Mac installs only into a signed app.
- **The startup check:** 10 s after the window has loaded, only in a packaged run (never in development or the smoke), only when `config.updates.check` is on (the default), and at most once a day: the time of the last check that reached the feed is kept in `updates.json` in the app's data folder (not in config, written atomically), and a failed check does not count, so the next start tries again. It only announces what it found: a toast `Version x is available` with **Settings**, which opens Settings at Updates.
- **Installing** goes through the same orderly stop as quitting (`stopForQuit` in `src/main/index.ts`): the host saves the projects and lets queued writes finish (`Host.stop`, idempotent), then `quitAndInstall(true, true)` installs silently and starts the new version; `before-quit` then lets the quit through. Should the installer fail after the host stopped, the app restarts into the version it has. A downloaded update the user did not install now installs when the app quits (`autoInstallOnAppQuit`).

## UI (`ui/`)

- **Settings > Updates**, after the Assistant and just before About (`SettingsSections` with `order: SETTINGS_LATE`): the state as one line (`data-testid=updates-status`, its `data-state` the state): `Not checked yet` or `Last checked …`, `Checking…`, `Version 1.2.3 is available`, `You have the latest version (checked …)`, `Downloading 42 %`, `Ready to install version 1.2.3. It also installs when you quit.`, the error's message, or `Updates are not available in this build: <reason>`. Then **Check for updates** (`updates-check`; enabled when idle, available, up to date or after an error), **Download** (`updates-download`; enabled only when a version is available) and **Restart and install** (`updates-install`; enabled only when ready), the release notes under `What's new in <version>` as plain text (`updates-notes`), and the checkbox **Check for updates when the app starts** (`updates-auto`, `config.updates.check`). The section follows `update.changed` through `invokeResource(..., { refreshOnEvents })`.
- **Toasts** (`UpdateNotices`, started at setup): a version found by the startup check (`Version 1.2.3 is available`, action **Settings**), and a download that is ready (`Version 1.2.3 is ready to install`, action **Restart and install**). A check the user started shows its outcome in Settings and gets no toast. Toasts with an action stay 6 s.

## Storage

`updates.json` in the app's data folder holds `{ checkedAt }`. `config.updates.check` is in `config.json`. electron-updater keeps its download in its own cache folder (`<name>-updater` under the OS cache) and removes it after installing.

## Agents

None. Every command here is **hidden**: an agent must never be able to download or install code, so none reaches the palette, the MCP server or the assistant's tools (the UI and the smoke call them; `execute` runs hidden commands for any caller, and `install` is also `mutating`, so an MCP caller naming it is refused with `MUTATION_BLOCKED`).

- `app.update.status`: the `UpdateState`.
- `app.update.check`: asks the feed; returns the outcome (`up-to-date`, `available`, `error`, or the state unchanged when a check cannot run).
- `app.update.download`: starts the download and returns at once (`downloading`); progress and the end follow as `update.changed`. `CONFLICT` when no version was found.
- `app.update.install`: stops the app, installs and restarts. `CONFLICT` when no download is ready.

`app.info` (visible) carries `updates: boolean`: whether this build can update itself.

## Dependency

`electron-updater` (`^6.8.11`, a runtime `dependency`: main requires it when the app runs): in-app updates from GitHub Releases, asked for by the brief. It stays **external** to the main bundle (listed in `external` in `electron.vite.config.ts`, which electron-vite 5 would also do by itself for a `dependency`): a build with it bundled works (about 570 kB more in `out/main/index.js`, no warnings), but electron-builder packages every `dependency` from `node_modules` anyway, so bundling would ship it twice, and every other runtime dependency is loaded the same way. electron-updater loads `electron` itself, which is never bundled.

## Verified by

`src/main/update-state.test.ts` (the startup schedule, the plain-text notes, the support rules for each platform, the `codesign` reading, the state machine with its stamp file, failures as state, an unsupported build, `update.changed` from the host and `app.info.updates`), `src/main/smoke/updates.ts` (the commands hidden, not MCP tools, install refused to MCP; a check that finds nothing, fails or finds 1.2.3 with notes; the check time in the data folder; the download's progress to ready; install reaching the updater; an unsupported build) and `src/main/smoke/updates-ui.ts` (the section before About; the states in order with the buttons enabled for each; the notes as text; no toast for a user's check; the ready toast and its Restart and install; the startup check's toast opening Settings at Updates; an error and an unsupported build; the checkbox writing config; no update command in the palette), with screenshots `58-settings-updates-downloading`, `59-settings-updates-ready` and `60-settings-updates-unsupported`, light and dark.

The real `electron-updater` path (a packaged build against a published release) cannot run before the repository and a release exist; `docs/release.md` (step 3) says how to try it with a `dev-app-update.yml`.
