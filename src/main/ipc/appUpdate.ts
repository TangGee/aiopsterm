import type { IpcMain } from 'electron'
import { join } from 'path'
import { checkAppUpdate, downloadAppUpdate, installAppUpdate } from '../backend/app/appUpdate'
import { checkStableReleaseUpdate } from '../backend/app/updateCheck'
import { sendWebContentsEvent } from '@shared/windowEvents'
import type { AppUpdateProgressEvent } from '@shared/contracts/appRuntime'

type RegisterAppUpdateIpcInput = {
  getVersion: () => string
  getUserDataPath: () => string
  getPlatform?: () => string
  getArch?: () => string
}

export const registerAppUpdateIpc = (ipcMain: IpcMain, input: RegisterAppUpdateIpcInput) => {
  ipcMain.handle('app:check-update', () => checkAppUpdate(input.getVersion()))
  ipcMain.handle('app:check-for-updates', () =>
    checkStableReleaseUpdate({
      currentVersion: input.getVersion(),
      platform: input.getPlatform?.() || process.platform,
      arch: input.getArch?.() || process.arch
    })
  )
  ipcMain.handle('app:download-update', (event, version: string) => {
    const emit = (progress: AppUpdateProgressEvent) => sendWebContentsEvent(event.sender, 'app:update-progress', progress)
    return downloadAppUpdate({ version }, emit, { cacheDir: join(input.getUserDataPath(), 'updates') })
  })
  ipcMain.handle('app:install-update', (_event, version?: string) => installAppUpdate({ version }))
}
