import { BRANDING } from '@studio/core';
import { BrowserWindow, Menu, app } from 'electron';

/**
 * The renderer draws its own title bar and owns the shortcuts (Ctrl+W closes a tab, not the window),
 * so Windows and Linux get no menu at all. macOS keeps a minimal one, because copy and paste go
 * through the Edit menu there. F12 opens the developer tools in development builds.
 */
export function installMenu(dev: boolean): void {
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: BRANDING.productName,
          submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }],
        },
        { role: 'editMenu' },
        { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }] },
      ]),
    );
  } else {
    Menu.setApplicationMenu(null);
  }
  if (dev) {
    app.on('browser-window-created', (_event, win: BrowserWindow) => {
      win.webContents.on('before-input-event', (event, input) => {
        if (input.type === 'keyDown' && input.key === 'F12') {
          win.webContents.toggleDevTools();
          event.preventDefault();
        }
      });
    });
  }
}
