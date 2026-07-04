import { BrowserWindow, app, type IpcMain } from 'electron'

type WindowIpcDeps = {
  createWindow?: () => BrowserWindow
}

export const registerWindowIpc = (ipcMain: IpcMain, deps: WindowIpcDeps = {}) => {
  ipcMain.handle('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })
  ipcMain.handle('window:maximize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.maximize()
  })
  ipcMain.handle('window:unmaximize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.unmaximize()
  })
  ipcMain.handle('window:is-maximized', (event) => BrowserWindow.fromWebContents(event.sender)?.isMaximized() || false)
  ipcMain.handle('window:new', () => {
    deps.createWindow?.()
  })
  ipcMain.handle('window:toggle-fullscreen', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return false
    const next = !window.isFullScreen()
    window.setFullScreen(next)
    return next
  })
  ipcMain.handle('window:set-badge-count', (_event, count: unknown) => {
    const normalized = typeof count === 'number' && Number.isFinite(count) ? Math.max(0, Math.min(999, Math.floor(count))) : 0
    return app.setBadgeCount(normalized)
  })
  ipcMain.handle('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })
}
