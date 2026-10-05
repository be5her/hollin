// Packaging for Windows (NSIS), macOS (dmg + zip) and Linux (AppImage + deb). Names come from
// branding.json so a rename touches one file. Builds are unsigned until signing secrets are added.
const branding = require('./branding.json');

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
  win: {
    target: ['nsis'],
    artifactName: '${productName}-${version}-setup.${ext}',
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
  },
  mac: {
    category: 'public.app-category.graphics-design',
    target: [
      { target: 'dmg', arch: ['x64', 'arm64'] },
      { target: 'zip', arch: ['x64', 'arm64'] },
    ],
    identity: null,
  },
  linux: {
    category: 'Graphics',
    target: ['AppImage', 'deb'],
  },
};
