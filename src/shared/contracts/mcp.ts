import type { AiopsMutationResult } from './common'

export type McpServerStatus = 'connected' | 'connecting' | 'disconnected' | 'disabled' | 'error'

export type McpToolConfig = {
  name: string
  description: string
  enabled: boolean
  autoApprove?: boolean
  parameters: Array<{
    name: string
    description: string
    required?: boolean
  }>
}

export type McpResourceConfig = {
  name: string
  description: string
  uri: string
}

export type McpServerUserConfig = {
  name: string
  status: McpServerStatus
  disabled: boolean
  error?: string
  tools: McpToolConfig[]
  resources: McpResourceConfig[]
}

export type McpToolStatesUserConfig = Record<string, boolean>

export type McpConfigFileServer = {
  type: 'stdio' | 'sse' | 'streamableHttp'
  disabled?: boolean
  autoApprove?: string[]
  timeout?: number
  command?: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
}

export type McpConfigFile = {
  mcpServers: Record<string, McpConfigFileServer>
}

export type McpConfigWriteResult = AiopsMutationResult<{
  mcpConfig: McpConfigFile
  mcpServers: McpServerUserConfig[]
  mcpToolStates: McpToolStatesUserConfig
}>

export type McpToolCallContent = Record<string, unknown> & {
  type: string
  text?: string
  data?: string
  mimeType?: string
}

export type McpResourceReadContent = Record<string, unknown> & {
  uri: string
  mimeType?: string
  text?: string
  blob?: string
}

export type McpToolCallInput = {
  serverName: string
  toolName: string
  arguments?: Record<string, unknown>
}

export type McpResourceReadInput = {
  serverName: string
  uri: string
}

export type McpToolCallResult = AiopsMutationResult<{
  serverName: string
  toolName: string
  arguments?: Record<string, unknown>
  content: McpToolCallContent[]
  isError: boolean
  durationMs: number
}>

export type McpResourceReadResult = AiopsMutationResult<{
  serverName: string
  uri: string
  contents: McpResourceReadContent[]
  durationMs: number
}>
