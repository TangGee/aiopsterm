import type { IpcMain, OpenDialogOptions } from 'electron'
import {
  closeZmodemStream,
  openZmodemStream,
  pickZmodemSavePath,
  pickZmodemUploadFiles,
  writeZmodemChunk
} from '../backend/terminal/zmodem'

type RegisterZmodemIpcInput = {
  showOpenDialog: (options: Pick<OpenDialogOptions, 'properties'>) => Promise<{ canceled?: boolean; filePaths?: string[] }>
  showSaveDialog: (options: { defaultPath: string }) => Promise<{ canceled?: boolean; filePath?: string }>
}

export const registerZmodemIpc = (ipcMain: IpcMain, input: RegisterZmodemIpcInput) => {
  ipcMain.handle('zmodem:pick-upload-files', async () =>
    pickZmodemUploadFiles({
      showOpenDialog: () => input.showOpenDialog({ properties: ['openFile', 'multiSelections'] })
    })
  )
  ipcMain.handle('zmodem:pick-save-path', async (_event, name: string) =>
    pickZmodemSavePath(name, {
      showSaveDialog: (defaultName) => input.showSaveDialog({ defaultPath: defaultName })
    })
  )
  ipcMain.handle('zmodem:open-stream', (_event, savePath: string) => openZmodemStream(savePath))
  ipcMain.handle('zmodem:write-chunk', (_event, streamId: string, chunk: unknown) => writeZmodemChunk(streamId, chunk))
  ipcMain.handle('zmodem:close-stream', (_event, streamId: string) => closeZmodemStream(streamId))
}
