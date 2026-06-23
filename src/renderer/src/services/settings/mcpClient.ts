import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'
import { createBridgeMethod } from '@/services/common/preloadBridgeClient'

type McpBridge = Pick<
  AiopsPreloadApi,
  | 'getMcpConfigPath'
  | 'getMcpServers'
  | 'readMcpConfig'
  | 'writeMcpConfig'
  | 'toggleMcpServer'
  | 'deleteMcpServer'
  | 'setMcpToolState'
  | 'setMcpToolAutoApprove'
  | 'callMcpTool'
  | 'readMcpResource'
  | 'onMcpConfigFileChanged'
>

const bridgeMethod = createBridgeMethod<McpBridge>()

export const mcpClient = {
  getMcpConfigPath: () => bridgeMethod('getMcpConfigPath'),
  getMcpServers: () => bridgeMethod('getMcpServers'),
  readMcpConfig: () => bridgeMethod('readMcpConfig'),
  writeMcpConfig: () => bridgeMethod('writeMcpConfig'),
  toggleMcpServer: () => bridgeMethod('toggleMcpServer'),
  deleteMcpServer: () => bridgeMethod('deleteMcpServer'),
  setMcpToolState: () => bridgeMethod('setMcpToolState'),
  setMcpToolAutoApprove: () => bridgeMethod('setMcpToolAutoApprove'),
  callMcpTool: () => bridgeMethod('callMcpTool'),
  readMcpResource: () => bridgeMethod('readMcpResource'),
  onMcpConfigFileChanged: () => bridgeMethod('onMcpConfigFileChanged')
}
