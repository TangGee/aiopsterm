import type { IpcMain } from 'electron'
import { checkModelProvider, listAiModels } from '../backend/modelProviders'
import type { AiModelCatalogInput, ModelProviderCheckInput, UserConfig } from '@shared/preload'

type RegisterModelsIpcInput = {
  getConfig: () => UserConfig
  isLocalChatBackendAvailable: () => boolean
}

export const registerModelsIpc = (ipcMain: IpcMain, input: RegisterModelsIpcInput) => {
  ipcMain.handle('models:list', (_event, catalogInput?: AiModelCatalogInput) =>
    listAiModels({
      modelSettings: catalogInput?.modelSettings || input.getConfig().modelSettings,
      localChatBackendAvailable: input.isLocalChatBackendAvailable()
    })
  )
  ipcMain.handle('models:check-provider', (_event, checkInput: ModelProviderCheckInput) => checkModelProvider(checkInput))
}
