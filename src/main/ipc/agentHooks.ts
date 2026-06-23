import type { IpcMain } from 'electron'
import { installAgentHook, listAgentHookInstallers, uninstallAgentHook } from '../backend/agent/agentHookInstaller'

export const registerAgentHooksIpc = (ipcMain: IpcMain) => {
  ipcMain.handle('agent-hooks:list', async () => ({ ok: true, data: await listAgentHookInstallers() }))
  ipcMain.handle('agent-hooks:install', (_event, input) => installAgentHook(input))
  ipcMain.handle('agent-hooks:uninstall', (_event, input) => uninstallAgentHook(input))
}
