import type { AiopsMutationResult } from '@shared/contracts/common'
import type {
  McpConfigFile,
  McpConfigFileServer,
  McpResourceConfig,
  McpResourceReadContent,
  McpServerUserConfig,
  McpToolCallContent,
  McpToolConfig,
  McpToolStatesUserConfig
} from '@shared/contracts/mcp'
import type { HttpRequestHeaders, McpDiscoveryOptions, McpOperationOptions } from './mcpRuntimeTypes'

export const defaultDiscoveryTimeoutMs = 8000
export const defaultOperationTimeoutMs = 60000
export const defaultOperationMaxTimeoutMs = 120000
export const minimumDiscoveryTimeoutMs = 1000
export const mcpProtocolVersion = '2024-11-05'

export const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export const cleanText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

export const stableJsonValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableJsonValue)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, stableJsonValue(value[key])])
  )
}

export const stableJsonStringify = (value: unknown) => JSON.stringify(stableJsonValue(value))

export const cloneJsonRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (!isRecord(value)) return undefined
  try {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
  } catch {
    return undefined
  }
}

export const mutationError = <T = never>(errorCode: string, errorMessage: string): AiopsMutationResult<T> => ({
  ok: false,
  errorCode,
  errorMessage
})

export const splitCommand = (command: string) => {
  const parts: string[] = []
  let current = ''
  let quote: string | null = null
  let escaped = false
  for (const char of command.trim()) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '"' || char === "'") {
      quote = quote === char ? null : quote || char
      continue
    }
    if (/\s/.test(char) && !quote) {
      if (current) {
        parts.push(current)
        current = ''
      }
      continue
    }
    current += char
  }
  if (current) parts.push(current)
  return {
    command: parts[0] || '',
    args: parts.slice(1)
  }
}

export const timeoutForServer = (server: McpConfigFileServer, options: Pick<McpDiscoveryOptions, 'timeoutMs' | 'maxTimeoutMs'>) => {
  const configured = Number(server.timeout || 0) > 0 ? Number(server.timeout) * 1000 : options.timeoutMs || defaultDiscoveryTimeoutMs
  const cap = Math.max(minimumDiscoveryTimeoutMs, options.maxTimeoutMs || defaultDiscoveryTimeoutMs)
  return Math.max(minimumDiscoveryTimeoutMs, Math.min(configured, cap))
}

export const operationClientOptions = (options: McpOperationOptions): Pick<McpOperationOptions, 'clientName' | 'clientVersion' | 'timeoutMs' | 'maxTimeoutMs'> => ({
  clientName: options.clientName,
  clientVersion: options.clientVersion,
  timeoutMs: options.timeoutMs || defaultOperationTimeoutMs,
  maxTimeoutMs: options.maxTimeoutMs || defaultOperationMaxTimeoutMs
})

export const mcpOperationClientCacheKey = (
  serverName: string,
  server: McpConfigFileServer,
  options: Pick<McpOperationOptions, 'clientName' | 'clientVersion' | 'timeoutMs' | 'maxTimeoutMs'>
) =>
  stableJsonStringify({
    serverName,
    protocolVersion: mcpProtocolVersion,
    clientName: options.clientName || 'aiopsterm',
    clientVersion: options.clientVersion || '0.1.0',
    timeoutMs: timeoutForServer(server, options),
    server: {
      type: server.type,
      command: server.command,
      args: server.args || [],
      cwd: server.cwd,
      env: server.env || {},
      url: server.url,
      headers: server.headers || {}
    }
  })

export const normalizeHttpHeaders = (server: McpConfigFileServer, extra?: HttpRequestHeaders): HttpRequestHeaders => ({
  ...(server.headers || {}),
  ...(extra || {})
})

export const toolParameters = (schema: unknown): McpToolConfig['parameters'] => {
  if (!isRecord(schema) || !isRecord(schema.properties)) return []
  const required = Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === 'string') : []
  return Object.entries(schema.properties).map(([name, value]) => {
    const prop = isRecord(value) ? value : {}
    const description = cleanText(prop.description) || cleanText(prop.title) || cleanText(prop.type)
    return {
      name,
      description,
      ...(required.includes(name) ? { required: true } : {})
    }
  })
}

export const autoApproveSet = (source?: string[]) => new Set((source || []).map(cleanText).filter(Boolean))

export const cloneToolsWithAutoApprove = (tools: McpToolConfig[] | undefined, autoApprove?: string[]): McpToolConfig[] => {
  const approved = autoApproveSet(autoApprove)
  return (tools || []).map((tool) => ({
    ...tool,
    autoApprove: approved.has(tool.name),
    parameters: tool.parameters.map((parameter) => ({ ...parameter }))
  }))
}

export const normalizeTools = (
  serverName: string,
  result: unknown,
  existing: McpServerUserConfig | undefined,
  toolStates: McpToolStatesUserConfig,
  autoApproveTools = new Set<string>()
): McpToolConfig[] => {
  const existingTools = new Map((existing?.tools || []).map((tool) => [tool.name, tool]))
  const tools = isRecord(result) && Array.isArray(result.tools) ? result.tools : []
  return tools
    .filter(isRecord)
    .map((tool): McpToolConfig | null => {
      const name = cleanText(tool.name)
      if (!name) return null
      const stateKey = `${serverName}:${name}`
      return {
        name,
        description: cleanText(tool.description),
        enabled: typeof toolStates[stateKey] === 'boolean' ? toolStates[stateKey] : existingTools.get(name)?.enabled ?? true,
        autoApprove: autoApproveTools.has(name),
        parameters: toolParameters(tool.inputSchema)
      }
    })
    .filter((tool): tool is McpToolConfig => Boolean(tool))
}

export const normalizeResources = (result: unknown): McpResourceConfig[] => {
  const resources = isRecord(result) && Array.isArray(result.resources) ? result.resources : []
  return resources
    .filter(isRecord)
    .map((resource) => {
      const uri = cleanText(resource.uri)
      if (!uri) return null
      return {
        name: cleanText(resource.name) || uri,
        description: cleanText(resource.description),
        uri
      }
    })
    .filter((resource): resource is McpResourceConfig => Boolean(resource))
}

export const normalizeToolCallContent = (result: unknown): { content: McpToolCallContent[]; isError: boolean } => {
  if (!isRecord(result)) return { content: [], isError: false }
  const content = Array.isArray(result.content) ? result.content : []
  return {
    content: content
      .filter(isRecord)
      .map((item) => {
        const type = cleanText(item.type) || 'unknown'
        const normalized: McpToolCallContent = { ...item, type }
        if (typeof item.text === 'string') normalized.text = item.text
        if (typeof item.data === 'string') normalized.data = item.data
        if (typeof item.mimeType === 'string') normalized.mimeType = item.mimeType
        return normalized
      }),
    isError: result.isError === true
  }
}

export const normalizeResourceReadContents = (result: unknown): McpResourceReadContent[] => {
  const contents = isRecord(result) && Array.isArray(result.contents) ? result.contents : []
  return contents
    .filter(isRecord)
    .map((item) => {
      const uri = cleanText(item.uri)
      if (!uri) return null
      const normalized: McpResourceReadContent = { ...item, uri }
      if (typeof item.mimeType === 'string') normalized.mimeType = item.mimeType
      if (typeof item.text === 'string') normalized.text = item.text
      if (typeof item.blob === 'string') normalized.blob = item.blob
      return normalized
    })
    .filter((item): item is McpResourceReadContent => Boolean(item))
}

export const resolveMcpOperationServer = <T>(
  config: McpConfigFile,
  serverName: string,
  disabledCode: string,
  missingCode: string
):
  | { ok: true; name: string; config: McpConfigFileServer }
  | {
      ok: false
      result: AiopsMutationResult<T>
    } => {
  const name = cleanText(serverName)
  if (!name) {
    return { ok: false, result: mutationError<T>('MCP_SERVER_REQUIRED', 'MCP server name is required.') }
  }
  const server = config.mcpServers?.[name]
  if (!server) {
    return { ok: false, result: mutationError<T>(missingCode, `MCP server not found: ${name}`) }
  }
  if (server.disabled) {
    return { ok: false, result: mutationError<T>(disabledCode, `MCP server "${name}" is disabled.`) }
  }
  return { ok: true, name, config: server }
}
