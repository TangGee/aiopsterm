import type {
  McpConfigFile,
  McpConfigFileServer,
  McpResourceReadInput,
  McpResourceReadResult,
  McpServerUserConfig,
  McpToolCallInput,
  McpToolCallResult,
  McpToolStatesUserConfig
} from '@shared/contracts/mcp'
import {
  autoApproveSet,
  cleanText,
  cloneJsonRecord,
  cloneToolsWithAutoApprove,
  mcpOperationClientCacheKey,
  mutationError,
  normalizeResourceReadContents,
  normalizeResources,
  normalizeToolCallContent,
  normalizeTools,
  operationClientOptions,
  resolveMcpOperationServer
} from './mcpRuntimeNormalization'
import { closeMcpClient, initializeMcpClient } from './mcpTransportRuntime'
import type { McpClient, McpDiscoveryOptions, McpOperationOptions, McpServerSnapshot } from './mcpRuntimeTypes'

export type { McpServerSnapshot } from './mcpRuntimeTypes'

type McpOperationClientCacheEntry = {
  clientPromise: Promise<McpClient>
}

const mcpOperationClientCache = new Map<string, McpOperationClientCacheEntry>()

const closeMcpOperationCacheEntry = async (entry: McpOperationClientCacheEntry) => {
  try {
    closeMcpClient(await entry.clientPromise)
  } catch {
    // Failed initializations do not leave a usable client to close.
  }
}

export const clearMcpRuntimeClientCache = async () => {
  const entries = [...mcpOperationClientCache.values()]
  mcpOperationClientCache.clear()
  await Promise.all(entries.map(closeMcpOperationCacheEntry))
}

const getCachedMcpOperationClient = async (
  serverName: string,
  server: McpConfigFileServer,
  options: Pick<McpOperationOptions, 'clientName' | 'clientVersion' | 'timeoutMs' | 'maxTimeoutMs'>
) => {
  const cacheKey = mcpOperationClientCacheKey(serverName, server, options)
  const existing = mcpOperationClientCache.get(cacheKey)
  if (existing) {
    return { cacheKey, client: await existing.clientPromise }
  }

  const entry: McpOperationClientCacheEntry = {
    clientPromise: initializeMcpClient(server, options)
  }
  mcpOperationClientCache.set(cacheKey, entry)
  try {
    return { cacheKey, client: await entry.clientPromise }
  } catch (error) {
    if (mcpOperationClientCache.get(cacheKey) === entry) {
      mcpOperationClientCache.delete(cacheKey)
    }
    throw error
  }
}

const evictMcpOperationClient = async (cacheKey: string) => {
  const entry = mcpOperationClientCache.get(cacheKey)
  if (!entry) return
  mcpOperationClientCache.delete(cacheKey)
  await closeMcpOperationCacheEntry(entry)
}

const discoverMcpServer = async (
  name: string,
  config: McpConfigFileServer,
  existing: McpServerUserConfig | undefined,
  toolStates: McpToolStatesUserConfig,
  options: McpDiscoveryOptions
): Promise<McpServerUserConfig> => {
  const client = await initializeMcpClient(config, options)
  try {
    let toolResult: unknown = { tools: [] }
    let resourceResult: unknown = { resources: [] }
    try {
      toolResult = await client.request('tools/list', {})
    } catch {
      toolResult = { tools: [] }
    }
    try {
      resourceResult = await client.request('resources/list', {})
    } catch {
      resourceResult = { resources: [] }
    }

    return {
      name,
      status: 'connected',
      disabled: false,
      tools: normalizeTools(name, toolResult, existing, toolStates, autoApproveSet(config.autoApprove)),
      resources: normalizeResources(resourceResult)
    }
  } finally {
    client.close()
  }
}

export const callMcpTool = async (config: McpConfigFile, input: McpToolCallInput, options: McpOperationOptions = {}): Promise<McpToolCallResult> => {
  const startedAt = Date.now()
  const resolved = resolveMcpOperationServer<NonNullable<McpToolCallResult['data']>>(
    config,
    input.serverName,
    'MCP_TOOL_SERVER_DISABLED',
    'MCP_TOOL_SERVER_NOT_FOUND'
  )
  if (!resolved.ok) return resolved.result

  const toolName = cleanText(input.toolName)
  if (!toolName) return mutationError('MCP_TOOL_REQUIRED', 'MCP tool name is required.')
  const stateKey = `${resolved.name}:${toolName}`
  const configuredTool = options.servers?.find((server) => server.name === resolved.name)?.tools.find((tool) => tool.name === toolName)
  const configuredEnabled = typeof options.toolStates?.[stateKey] === 'boolean' ? options.toolStates[stateKey] : configuredTool?.enabled
  if (configuredEnabled === false) {
    return mutationError('MCP_TOOL_DISABLED', `MCP tool "${resolved.name}:${toolName}" is disabled.`)
  }

  let cacheKey = ''
  try {
    const cached = await getCachedMcpOperationClient(resolved.name, resolved.config, operationClientOptions(options))
    cacheKey = cached.cacheKey
    const argumentsRecord = cloneJsonRecord(input.arguments)
    const result = await cached.client.request('tools/call', {
      name: toolName,
      arguments: argumentsRecord || {}
    })
    const normalized = normalizeToolCallContent(result)
    return {
      ok: true,
      data: {
        serverName: resolved.name,
        toolName,
        ...(argumentsRecord ? { arguments: argumentsRecord } : {}),
        content: normalized.content,
        isError: normalized.isError,
        durationMs: Date.now() - startedAt
      }
    }
  } catch (error) {
    if (cacheKey) await evictMcpOperationClient(cacheKey)
    return mutationError('MCP_TOOL_CALL_FAILED', error instanceof Error ? error.message : 'MCP tool call failed.')
  }
}

export const readMcpResource = async (config: McpConfigFile, input: McpResourceReadInput, options: McpOperationOptions = {}): Promise<McpResourceReadResult> => {
  const startedAt = Date.now()
  const resolved = resolveMcpOperationServer<NonNullable<McpResourceReadResult['data']>>(
    config,
    input.serverName,
    'MCP_RESOURCE_SERVER_DISABLED',
    'MCP_RESOURCE_SERVER_NOT_FOUND'
  )
  if (!resolved.ok) return resolved.result

  const uri = cleanText(input.uri)
  if (!uri) return mutationError('MCP_RESOURCE_URI_REQUIRED', 'MCP resource uri is required.')

  let cacheKey = ''
  try {
    const cached = await getCachedMcpOperationClient(resolved.name, resolved.config, operationClientOptions(options))
    cacheKey = cached.cacheKey
    const result = await cached.client.request('resources/read', { uri })
    return {
      ok: true,
      data: {
        serverName: resolved.name,
        uri,
        contents: normalizeResourceReadContents(result),
        durationMs: Date.now() - startedAt
      }
    }
  } catch (error) {
    if (cacheKey) await evictMcpOperationClient(cacheKey)
    return mutationError('MCP_RESOURCE_READ_FAILED', error instanceof Error ? error.message : 'MCP resource read failed.')
  }
}

export const discoverMcpServerSnapshot = async (config: McpConfigFile, options: McpDiscoveryOptions = {}): Promise<McpServerSnapshot> => {
  const existingByName = new Map((options.existingServers || []).map((server) => [server.name, server]))
  const toolStates = options.toolStates || {}
  const mcpServers: McpServerUserConfig[] = []

  for (const [name, serverConfig] of Object.entries(config.mcpServers || {})) {
    const existing = existingByName.get(name)
    if (serverConfig.disabled) {
      mcpServers.push({
        name,
        status: 'disabled',
        disabled: true,
        tools: cloneToolsWithAutoApprove(existing?.tools, serverConfig.autoApprove),
        resources: existing?.resources || []
      })
      continue
    }
    if (!options.runDiscovery) {
      mcpServers.push({
        name,
        status: existing?.status && existing.status !== 'disabled' ? existing.status : 'connected',
        disabled: false,
        ...(existing?.error ? { error: existing.error } : {}),
        tools: cloneToolsWithAutoApprove(existing?.tools, serverConfig.autoApprove),
        resources: existing?.resources || []
      })
      continue
    }
    try {
      mcpServers.push(await discoverMcpServer(name, serverConfig, existing, toolStates, options))
    } catch (error) {
      mcpServers.push({
        name,
        status: 'error',
        disabled: false,
        error: error instanceof Error ? error.message : 'MCP server discovery failed.',
        tools: [],
        resources: []
      })
    }
  }

  const nextToolStates: McpToolStatesUserConfig = {}
  mcpServers.forEach((server) => {
    server.tools.forEach((tool) => {
      nextToolStates[`${server.name}:${tool.name}`] = tool.enabled
    })
  })
  return {
    mcpConfig: config,
    mcpServers,
    mcpToolStates: nextToolStates
  }
}
