import { clipboard, type IpcMain } from 'electron'
import {
  buildExportMcpManualConfig,
  installExportMcp,
  listExportMcpInstallers,
  resetExportMcpToken,
  uninstallExportMcp
} from '../backend/codex/exportMcpInstaller'
import type { ExportMcpCopyConfigResult } from '@shared/contracts/exportMcp'

const copyConfigErrorResult = (error: unknown): ExportMcpCopyConfigResult => ({
  ok: false,
  errorCode: 'EXPORT_MCP_COPY_CONFIG_FAILED',
  errorMessage: error instanceof Error ? error.message : String(error || 'Export MCP config copy failed.')
})

export const registerExportMcpIpc = (ipcMain: IpcMain) => {
  ipcMain.handle('export-mcp:list', async () => ({ ok: true, data: await listExportMcpInstallers() }))
  ipcMain.handle('export-mcp:install', (_event, input) => installExportMcp(input))
  ipcMain.handle('export-mcp:uninstall', (_event, input) => uninstallExportMcp(input))
  ipcMain.handle('export-mcp:copy-config', async (_event, input): Promise<ExportMcpCopyConfigResult> => {
    try {
      const config = await buildExportMcpManualConfig(input)
      clipboard.writeText(config.text)
      return { ok: true, data: { kind: config.kind } }
    } catch (error) {
      return copyConfigErrorResult(error)
    }
  })
  ipcMain.handle('export-mcp:reset-token', async () => resetExportMcpToken())
}
