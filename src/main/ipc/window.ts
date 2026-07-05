import { BrowserWindow, app, type IpcMain } from 'electron'
import { syncNativeNotificationKeys } from '../backend/app/nativeNotificationRuntime'

type WindowIpcDeps = {
  createWindow?: () => BrowserWindow
}

const normalizeBadgeCount = (count: unknown) => (typeof count === 'number' && Number.isFinite(count) ? Math.max(0, Math.min(999, Math.floor(count))) : 0)

const normalizeBadgeKeys = (keys: unknown) =>
  Array.isArray(keys)
    ? [...new Set(keys.map((key) => (typeof key === 'string' ? key.trim() : '')).filter(Boolean))].slice(0, 999)
    : []

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
  ipcMain.handle('window:set-badge-count', (_event, count: unknown) => app.setBadgeCount(normalizeBadgeCount(count)))
  ipcMain.handle('window:set-badge-state', (_event, input: unknown) => {
    const record = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {}
    const activeKeys = normalizeBadgeKeys(record.activeKeys)
    syncNativeNotificationKeys(activeKeys)
    return app.setBadgeCount(activeKeys.length)
  })
  ipcMain.handle('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })
}
