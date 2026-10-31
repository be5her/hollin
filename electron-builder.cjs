// Packaging for Windows (NSIS), macOS (dmg + zip) and Linux (AppImage + deb). Names come from
// branding.json so a rename touches one file. Signing and notarization switch on when their secrets are
// in the environment (see docs/release.md); without them the build is unsigned and still completes.
const branding = require('./branding.json');
const pkg = require('./package.json');

/** An environment variable with a value: GitHub Actions passes a missing secret as an empty string. */
const env = (name) => {
  const value = process.env[name];
  return value != null && value.trim() !== '' ? value : undefined;
};

// The update feed. electron-builder writes `app-update.yml` (what electron-updater reads) into a build
// only when the build has a `publish` configuration, so the feed exists only in builds made by the
// release workflow, where GitHub sets GITHUB_REPOSITORY ("owner/repo"). Everywhere else `publish` is
// `null`, not left out: left out, electron-builder would guess a GitHub feed from a GH_TOKEN in the
// environment. A local `npm run package` therefore has no feed and the app reports updates as
// unsupported (src/main/update-state.ts). No owner or repository is named in the source.
const repository = env('GITHUB_REPOSITORY');
const [owner, repo] = repository ? repository.split('/') : [];
const publish = owner && repo ? { provider: 'github', owner, repo, releaseType: 'draft' } : null;
// The project's homepage: package.json's, should the owner add one, else the feed's repository.
const homepage = pkg.homepage || (publish ? `https://github.com/${owner}/${repo}` : undefined);

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: branding.appId,
  productName: branding.productName,
  directories: { output: 'release', buildResources: 'resources' },
  files: ['out/**', '!out/renderer-tsc/**', 'package.json', '!**/*.map'],
  // The window icon on Linux and in dev runs; Windows and macOS take theirs from the executable and bundle.
  extraResources: [{ from: 'resources/icon.png', to: 'icon.png' }],
  asar: true,
  // No native modules.
  npmRebuild: false,
  fileAssociations: [{ ext: branding.packageExtension, name: `${branding.productName} project`, role: 'Editor' }],
  publish,
  // The deb needs a homepage (electron-builder's FpmTarget refuses to build without one): package.json's,
  // else the release workflow's repository (see `homepage` above).
  ...(publish && !pkg.homepage ? { extraMetadata: { homepage } } : {}),
  // One `latest*.yml` per platform, never alpha/beta copies (GitHub releases have one channel anyway).
  // The targets below that electron-updater can install write it: NSIS (`latest.yml`), the macOS zip,
  // with the dmg listed beside it (`latest-mac.yml`), AppImage and deb (`latest-linux.yml`).
  generateUpdatesFilesForAllChannels: false,
  win: {
    // NSIS only: it is the Windows target electron-updater installs (a portable exe would write no feed file).
    // Signed when WIN_CSC_LINK (or CSC_LINK: a base64 .pfx or a path) and WIN_CSC_KEY_PASSWORD (or
    // CSC_KEY_PASSWORD) are set; on Windows electron-builder itself treats an empty link as unset and
    // builds unsigned (macOS does not: see `identity` below).
    target: ['nsis'],
    artifactName: '${productName}-${version}-setup.${ext}',
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
  },
  mac: {
    category: 'public.app-category.graphics-design',
    // dmg for people, zip for the updater (Squirrel.Mac installs from the zip).
    target: [
      { target: 'dmg', arch: ['x64', 'arm64'] },
      { target: 'zip', arch: ['x64', 'arm64'] },
    ],
    // With a certificate (CSC_LINK, CSC_KEY_PASSWORD) electron-builder imports it into a temporary
    // keychain and finds the Developer ID identity itself; without one, `null` skips signing rather than
    // searching the machine's keychain. On macOS electron-builder takes an empty CSC_LINK (a secret that
    // is not set) as a certificate and treats only `null` as "do not sign", so a blank one becomes `null` here.
    identity: env('CSC_LINK') ? undefined : null,
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'resources/entitlements.mac.plist',
    entitlementsInherit: 'resources/entitlements.mac.plist',
    // electron-builder 26's option is a boolean; the credentials come from APPLE_ID,
    // APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID (it stops with an error when only some are set).
    // It runs after signing, so an unsigned build is never notarized.
    notarize: Boolean(env('APPLE_ID')),
  },
  linux: {
    // The desktop entry's Categories: the main category and an additional one (freedesktop's menu spec).
    category: 'Graphics;Engineering',
    // The deb only when a homepage is known (its fpm target refuses to build without one): so a local
    // `npm run package` on Linux, with no GITHUB_REPOSITORY, makes the AppImage only.
    target: ['AppImage', ...(homepage ? ['deb'] : [])],
    artifactName: '${productName}-${version}-${arch}.${ext}',
    maintainer: `${pkg.author.name} <${pkg.author.email}>`,
  },
};
