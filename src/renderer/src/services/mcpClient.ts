import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'

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

const bridgeMethod = <Name extends keyof McpBridge>(name: Name): McpBridge[Name] | undefined => {
  const method = window.aiops?.[name]
  return typeof method === 'function' ? (method.bind(window.aiops) as McpBridge[Name]) : undefined
}

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
