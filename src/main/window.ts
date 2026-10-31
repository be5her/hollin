import { join } from 'node:path';
import { BRANDING } from '@studio/core';
import { BrowserWindow, app, nativeTheme, shell } from 'electron';

/** Windows and macOS take the window icon from the executable and the bundle; Linux and dev runs need it here. */
const iconPath = app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(app.getAppPath(), 'resources', 'icon.png');

/** Height of the title bar the renderer draws; the native window controls are overlaid on its right end. */
export const TITLE_BAR_HEIGHT = 40;

/** Initial title bar colours, before the renderer reports its theme. Match the defaults in styles.css. */
function initialColors(): { color: string; symbolColor: string } {
  return nativeTheme.shouldUseDarkColors ? { color: '#262220', symbolColor: '#ebe3d6' } : { color: '#efe8dc', symbolColor: '#2a2521' };
}

export function createMainWindow(options: { show?: boolean } = {}): BrowserWindow {
  const isMac = process.platform === 'darwin';
  const colors = initialColors();
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: BRANDING.productName,
    backgroundColor: colors.color,
    icon: isMac ? undefined : iconPath,
    // The renderer draws the title bar; the OS keeps its own window buttons on top of it.
    titleBarStyle: 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 14, y: 13 } } : { titleBarOverlay: { ...colors, height: TITLE_BAR_HEIGHT } }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => {
    if (options.show !== false) win.show();
  });

  // Links open in the system browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault();
  });

  if (process.env.ELECTRON_RENDERER_URL || process.argv.includes('--smoke')) {
    win.webContents.on('console-message', (event) => console.log(`[renderer:${event.level}] ${event.message}`));
  }

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
  return win;
}

/** Recolours the native window buttons on Windows and Linux to match the theme. */
export function setTitleBarColors(colors: { color: string; symbolColor: string }): void {
  if (process.platform === 'darwin') return;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.setTitleBarOverlay({ ...colors, height: TITLE_BAR_HEIGHT });
  }
}
