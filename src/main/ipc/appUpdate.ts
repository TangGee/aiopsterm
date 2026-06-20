import type { IpcMain } from 'electron'
import { join } from 'path'
import { checkAppUpdate, downloadAppUpdate, installAppUpdate } from '../backend/appUpdate'
import { sendWebContentsEvent } from '@shared/windowEvents'
import type { AppUpdateProgressEvent } from '@shared/contracts/appRuntime'

type RegisterAppUpdateIpcInput = {
  getVersion: () => string
  getUserDataPath: () => string
}

export const registerAppUpdateIpc = (ipcMain: IpcMain, input: RegisterAppUpdateIpcInput) => {
  ipcMain.handle('app:check-update', () => checkAppUpdate(input.getVersion()))
  ipcMain.handle('app:download-update', (event, version: string) => {
    const emit = (progress: AppUpdateProgressEvent) => sendWebContentsEvent(event.sender, 'app:update-progress', progress)
    return downloadAppUpdate({ version }, emit, { cacheDir: join(input.getUserDataPath(), 'updates') })
  })
  ipcMain.handle('app:install-update', (_event, version?: string) => installAppUpdate({ version }))
}
