# Releases

A release is a version tag. Pushing `vX.Y.Z` runs `.github/workflows/release.yml`, which checks the version, builds the installers on Windows, macOS and Linux, and uploads them with the update feed to a **draft** GitHub Release. Nothing is public until you publish the draft; once you do, installed copies of the app find the new version in Settings > Updates.

The repository is `be5her/hollin` on GitHub. The workflow names no owner or repository: electron-builder takes them from `GITHUB_REPOSITORY`, which GitHub sets in every workflow run, and a build made anywhere else has no update feed (`electron-builder.cjs`).

## Cutting a release

1. **Pick the version.** Semantic versioning: a fix is `0.1.1`, a feature `0.2.0`. Set `version` in `package.json` (and the root entry of `package-lock.json`, which `npm version 0.2.0 --no-git-tag-version` does for both).
2. **Write the changelog.** In `CHANGELOG.md`, rename `## [Unreleased]` to `## [0.2.0] - YYYY-MM-DD` with the changes under it, and start a new empty `## [Unreleased]` above it. That section becomes the release's notes on GitHub and in the app.
3. **Check it:** `npm run release:check -- v0.2.0` fails when the changelog has no section for the version, the section is empty, or the tag does not match `package.json`. The workflow runs the same check first.
4. **Commit** (`Release 0.2.0`), and push `main` through its pull request as usual.
5. **Tag and push the tag** from the merged `main`: `git tag v0.2.0` then `git push origin v0.2.0`.
6. **Watch the run** (Actions > Release). The first job checks the version and the changelog and runs the typecheck and the unit tests, with read access only; a small second job (write access, nothing installed) creates the draft release with the changelog section as its notes, and stops the run if a release for the tag is already published; then one job per platform builds and uploads, and the Linux one checks that the AppImage carries no `package-type` (the deb's, which electron-builder writes into the folder the AppImage is packed from, in parallel). Every checkout keeps no credentials (`persist-credentials: false`), and only the packaging step gets the token. The smoke test is not run again here: CI runs it on every push to `main`.
7. **Review the draft** (Releases): it should hold
   - Windows: `Hollin-0.2.0-setup.exe`, its `.blockmap`, and `latest.yml`;
   - macOS: a `.dmg` and a `.zip` for x64 and for arm64, their `.blockmap`s, and `latest-mac.yml`;
   - Linux: `Hollin-0.2.0-x86_64.AppImage`, `Hollin-0.2.0-amd64.deb`, and `latest-linux.yml`.

   (GitHub turns the spaces of the product name into dashes.) Download one or two and try them.
8. **Publish the draft.** From then on the release is public and the update feed points at it: electron-updater reads the latest published (not draft, not pre-release) release of the repository and its `latest*.yml`. For a beta, leave *Set as a pre-release* ticked (see below).

## Beta versions

A beta is a release whose version has a pre-release part: `0.2.0-beta.1`, `0.2.0-beta.2`, and so on, before `0.2.0` itself. It is cut exactly like a release (the changelog section is `## [0.2.0-beta.1] - YYYY-MM-DD`, the tag `v0.2.0-beta.1`); the workflow sees the `-` in the tag and creates the draft as a **pre-release**, which it stays when published.

- **Who gets it:** apps with *Get beta versions* on in Settings > Updates (`config.updates.beta`, off by default). The app then sets electron-updater's `allowPrerelease`, so the GitHub provider reads the repository's releases feed and offers the newest published release, beta or stable. With it off the app asks for the latest *stable* release only, so a beta is never offered to someone who did not ask for one.
- **Leaving the beta:** turning the switch off never downgrades. A beta installed stays until a stable version newer than it is out: `0.2.0` replaces `0.2.0-beta.3`, `0.1.0` does not.
- **Testers** download the beta's installer from its release page, then turn the switch on to be offered the next betas (it is off in every new install, a beta's included).
- Use `beta` (or `alpha`) as the pre-release name: electron-updater skips releases on any other channel name. Each platform's feed file is still `latest*.yml` (`generateUpdatesFilesForAllChannels` is off); on GitHub the release it sits in is what makes it a beta.

If a build fails, fix it on `main`, delete the draft release and the tag (`git push --delete origin v0.2.0`, `git tag -d v0.2.0`), and tag again. A run by hand (Actions > Release > Run workflow) builds the installers on all three systems and keeps them as workflow artifacts without creating or touching a release: a way to try the packaging before tagging. Its builds carry the repository's feed, so an installed one updates like a release would.

## What users then see

In **Settings > Updates** of an installed earlier version: `Version 0.2.0 is available` after a check (the app checks by itself 10 s after start and then once a day while it runs, unless *Check for updates when the app starts* is off; a version such a check finds shows a toast with **Settings**), the release notes under *What's new in 0.2.0* as plain text, **Download** with its progress, then `Ready to install version 0.2.0` and **Restart and install**, which saves the open projects, installs and starts the new version. A downloaded update the user does not install now installs when the app quits. Nothing downloads or installs without the user.

A build that cannot update says so there instead: `Updates are not available in this build: <reason>` (a local build, a development run, an unsigned macOS build, a Linux copy not run from its AppImage or package). `packages/modules/updates/README.md` has the rules.

## Signing and notarization

The workflow builds **unsigned** until the secrets below exist, and signs as soon as they do; nothing else changes. Add them under the repository's Settings > Secrets and variables > Actions > New repository secret. A secret that is not set reaches the build as an empty string. On Windows electron-builder itself treats an empty `WIN_CSC_LINK` as unset; on macOS it does not (an empty `CSC_LINK` counts as a certificate), so `electron-builder.cjs` maps a blank one to `identity: null` (do not sign) and a blank `APPLE_ID` to no notarization. Each is passed only to the job of its platform.

### Windows

| Secret | What it is | Where it comes from |
|---|---|---|
| `WIN_CSC_LINK` | The code signing certificate with its private key, as a `.pfx` (PKCS #12) file encoded in base64 (`base64 -w0 cert.pfx`, or `[Convert]::ToBase64String([IO.File]::ReadAllBytes('cert.pfx'))` in PowerShell). | An OV or EV code signing certificate from a certificate authority (DigiCert, Sectigo, SSL.com and others). EV and most new OV certificates come on a hardware token or in the CA's cloud signing service and cannot be exported to a `.pfx`; for those, use the CA's own signing tool, or Azure Trusted Signing, which electron-builder 26 supports through `win.azureSignOptions` (not configured here: it needs its endpoint, account and profile names in `electron-builder.cjs` and the `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` and `AZURE_CLIENT_SECRET` secrets). |
| `WIN_CSC_KEY_PASSWORD` | The `.pfx` file's password. | Chosen when the `.pfx` was exported. |

electron-builder signs the app's executables and the installer with signtool. Once a signed version is out, the app checks that an update is signed by the same publisher before installing it (electron-updater compares the installer's signature with the `publisherName` the build recorded), so renew with the same subject name.

### macOS

| Secret | What it is | Where it comes from |
|---|---|---|
| `MAC_CSC_LINK` | A **Developer ID Application** certificate with its private key, exported from Keychain Access as a `.p12` and encoded in base64. | The Apple Developer Program (paid membership): developer.apple.com > Certificates > `+` > Developer ID Application, from a certificate signing request made in Keychain Access. |
| `MAC_CSC_KEY_PASSWORD` | The `.p12` file's password. | Chosen when exporting it. |
| `APPLE_ID` | The Apple Account email of the developer account. | The account itself. Notarization runs only when this is set. |
| `APPLE_APP_SPECIFIC_PASSWORD` | An app-specific password for that account (not the account's password). | account.apple.com > Sign-In and Security > App-Specific Passwords. |
| `APPLE_TEAM_ID` | The team's ten-character identifier. | developer.apple.com > Account > Membership details. |

With `MAC_CSC_LINK` set, electron-builder imports the certificate into a temporary keychain on the runner and signs the app with the hardened runtime and `resources/entitlements.mac.plist` (JIT and unsigned executable memory for V8, library validation off for Electron's frameworks, outgoing network). With `APPLE_ID` also set it then sends the app to Apple's notary service (`notarytool`) and staples the ticket. All three Apple secrets must be set together: electron-builder stops with an error when only some are. Notarization only happens for a signed build.

### Linux

Nothing to sign: AppImage and deb are distributed as they are.

## What works unsigned

- **Windows:** the installer runs, but SmartScreen shows *Windows protected your PC* for an unknown publisher; *More info* > *Run anyway* installs it. In-app updates work unsigned (there is no signature to compare).
- **macOS:** Gatekeeper refuses to open an app from the internet that is not signed and notarized (*cannot be opened because Apple cannot check it for malicious software*). On macOS 14 and earlier, right-click (or Control-click) the app > *Open* > *Open*; on macOS 15 and later, try to open it once, then System Settings > Privacy & Security > *Open Anyway*. An unsigned Apple silicon build may be reported as *damaged*; then `xattr -dr com.apple.quarantine "/Applications/Hollin.app"` clears the download flag. **In-app updates do not work unsigned on macOS:** Squirrel.Mac installs only into a signed app, so such a build reports updates as unavailable and has to be updated by downloading the new dmg.
- **Linux:** everything works: the AppImage updates itself in place, and an installed deb downloads the new `.deb` and installs it with `pkexec` (asking for the password).

## Trying an update locally

electron-updater's own development mode reads a `dev-app-update.yml` from the app's folder instead of the `app-update.yml` a release build carries; the app honours it (`src/main/update-state.ts`). It needs a published release of the repository whose version is newer than `package.json`'s.

1. In the repository's root, create `dev-app-update.yml` (git ignores it, so the repository's name stays out of the source):

   ```yaml
   provider: github
   owner: <owner>
   repo: <repository>
   updaterCacheDirName: plan-studio-updater
   ```

2. Run `npm run dev` (its own data folder, `Hollin Dev`) and open Settings > Updates: it shows `Not checked yet` instead of `Updates are not available in this build: this is a development run`. The startup check never runs in development; press **Check for updates**.
3. It should show `Version X.Y.Z is available` with the release's notes; **Download** shows the progress, then `Ready to install version X.Y.Z`.
4. **Restart and install** runs the real installer: on Windows that installs the release (as if from its setup), not the development copy. Stop at step 3 unless that is what you want.

Delete `dev-app-update.yml` afterwards. To try the packaged path instead, build with the feed (`GITHUB_REPOSITORY=<owner>/<repository> npm run package`; `--publish never` still uploads nothing), install that older build, and check from it: the installed app then updates from the published release like any user's copy.

`npm run package` without `GITHUB_REPOSITORY` makes a build with no feed: `release/win-unpacked/resources` has no `app-update.yml`, and its Settings > Updates says `Updates are not available in this build: this build has no update feed (only release builds have one)`. On Linux such a build makes the AppImage only: the deb needs a homepage (electron-builder's fpm target refuses to build without one), which comes from the feed's repository, or from `package.json`'s `homepage` once the owner adds one.
