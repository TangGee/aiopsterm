import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'
import { createBridgeMethod } from '@/services/common/preloadBridgeClient'

type ExportMcpBridge = Pick<AiopsPreloadApi, 'listExportMcpInstallers' | 'installExportMcp' | 'uninstallExportMcp' | 'copyExportMcpConfig' | 'resetExportMcpToken'>

const bridgeMethod = createBridgeMethod<ExportMcpBridge>()

export const exportMcpClient = {
  listExportMcpInstallers: () => bridgeMethod('listExportMcpInstallers'),
  installExportMcp: () => bridgeMethod('installExportMcp'),
  uninstallExportMcp: () => bridgeMethod('uninstallExportMcp'),
  copyExportMcpConfig: () => bridgeMethod('copyExportMcpConfig'),
  resetExportMcpToken: () => bridgeMethod('resetExportMcpToken')
}
