import { BRANDING, currentLanguage, t, type MessageKey } from '@studio/core';
import { BrowserWindow, Menu, app, type MenuItemConstructorOptions } from 'electron';

/**
 * The renderer draws its own title bar and owns the shortcuts (Ctrl+W closes a tab, not the window),
 * so Windows and Linux get no menu at all. macOS keeps a minimal one, because copy and paste go
 * through the Edit menu there; `buildMenu` makes it in the app's language (call it again on
 * `language.changed`). F12 opens the developer tools in development builds.
 */
export function installMenu(dev: boolean): void {
  buildMenu();
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

/**
 * Sets the application menu (macOS only) in the process's language. In English the roles keep
 * Electron's own labels, as they always had; in another language every item is labelled from the
 * catalog, the Edit menu spelled out (Electron's `editMenu` role brings English labels).
 */
export function buildMenu(): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  const english = currentLanguage() === 'en';
  const name = BRANDING.productName;
  const item = (role: MenuItemConstructorOptions['role'], key: MessageKey): MenuItemConstructorOptions => (english ? { role } : { role, label: t(key, { name }) });
  const separator: MenuItemConstructorOptions = { type: 'separator' };
  const edit: MenuItemConstructorOptions = english
    ? { role: 'editMenu' }
    : {
        label: t('shell.menu.edit'),
        submenu: [
          item('undo', 'shell.menu.undo'),
          item('redo', 'shell.menu.redo'),
          separator,
          item('cut', 'shell.menu.cut'),
          item('copy', 'shell.menu.copy'),
          item('paste', 'shell.menu.paste'),
          item('pasteAndMatchStyle', 'shell.menu.pasteAndMatchStyle'),
          item('delete', 'shell.menu.delete'),
          item('selectAll', 'shell.menu.selectAll'),
        ],
      };
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: name,
        submenu: [item('about', 'shell.menu.about'), separator, item('hide', 'shell.menu.hide'), item('hideOthers', 'shell.menu.hideOthers'), item('unhide', 'shell.menu.unhide'), separator, item('quit', 'shell.menu.quit')],
      },
      edit,
      { label: t('shell.menu.window'), submenu: [item('minimize', 'shell.menu.minimize'), item('zoom', 'shell.menu.zoom'), separator, item('front', 'shell.menu.front')] },
    ]),
  );
}
