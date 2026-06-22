import type { McpConfigFile, McpServerUserConfig, McpToolStatesUserConfig } from '@shared/contracts/mcp'

export type JsonRpcMessage = {
  jsonrpc?: string
  id?: number | string
  method?: string
  params?: unknown
  result?: unknown
  error?: {
    code?: number
    message?: string
  }
}

export type McpServerSnapshot = {
  mcpConfig: McpConfigFile
  mcpServers: McpServerUserConfig[]
  mcpToolStates: McpToolStatesUserConfig
}

export type McpDiscoveryOptions = {
  existingServers?: McpServerUserConfig[]
  toolStates?: McpToolStatesUserConfig
  clientName?: string
  clientVersion?: string
  runDiscovery?: boolean
  timeoutMs?: number
  maxTimeoutMs?: number
}

export type McpOperationOptions = {
  servers?: McpServerUserConfig[]
  toolStates?: McpToolStatesUserConfig
  clientName?: string
  clientVersion?: string
  timeoutMs?: number
  maxTimeoutMs?: number
}

export type McpStdioClient = {
  request(method: string, params?: unknown): Promise<unknown>
  notify(method: string, params?: unknown): void | Promise<void>
  close(): void
}

export type McpClient = McpStdioClient

export type HttpRequestHeaders = Record<string, string>
