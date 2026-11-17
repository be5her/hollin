/** In-app updates: Settings > Updates and the toasts that announce a version. */
export const updates = {
  'updates.title': 'Updates',
  'updates.note': "New versions come from the app's releases. Nothing is downloaded or installed until you ask.",
  'updates.check': 'Check for updates',
  'updates.download': 'Download',
  'updates.install': 'Restart and install',
  'updates.notes': "What's new in {version}",
  'updates.auto': 'Check for updates when the app starts',
  'updates.beta': 'Get beta versions',
  'updates.betaNote': 'Betas are previews of the next version, out before it is finished. Turned off, a beta you have stays until a newer stable version comes.',

  /** The line under Updates, per state. */
  'updates.state.lastChecked': 'Last checked {at}',
  'updates.state.notChecked': 'Not checked yet',
  'updates.state.checking': 'Checking…',
  'updates.state.available': 'Version {version} is available',
  'updates.state.upToDate': 'You have the latest version (checked {at})',
  'updates.state.downloading': 'Downloading {progress} %',
  'updates.state.ready': 'Ready to install version {version}. It also installs when you quit.',
  'updates.state.error': 'Something went wrong.',
  'updates.state.unsupported': 'Updates are not available in this build: {reason}',
  'updates.state.noFeed': 'no update feed',

  'updates.toast.ready': 'Version {version} is ready to install',
  'updates.toast.settings': 'Settings',
} as const;
