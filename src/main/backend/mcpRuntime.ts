import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import type { McpConfigFile, McpConfigFileServer, McpResourceConfig, McpServerUserConfig, McpToolConfig, McpToolStatesUserConfig } from '@shared/preload'

type JsonRpcMessage = {
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

type McpDiscoveryOptions = {
  existingServers?: McpServerUserConfig[]
  toolStates?: McpToolStatesUserConfig
  clientName?: string
  clientVersion?: string
  runDiscovery?: boolean
  timeoutMs?: number
  maxTimeoutMs?: number
}

type McpStdioClient = {
  request(method: string, params?: unknown): Promise<unknown>
  notify(method: string, params?: unknown): void
  close(): void
}

const defaultDiscoveryTimeoutMs = 8000
const minimumDiscoveryTimeoutMs = 1000

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const cleanText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const splitCommand = (command: string) => {
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

const timeoutForServer = (server: McpConfigFileServer, options: McpDiscoveryOptions) => {
  const configured = Number(server.timeout || 0) > 0 ? Number(server.timeout) * 1000 : options.timeoutMs || defaultDiscoveryTimeoutMs
  const cap = Math.max(minimumDiscoveryTimeoutMs, options.maxTimeoutMs || defaultDiscoveryTimeoutMs)
  return Math.max(minimumDiscoveryTimeoutMs, Math.min(configured, cap))
}

const parseMessagesFromBuffer = (state: { buffer: Buffer }, chunk: Buffer, onMessage: (message: JsonRpcMessage) => void) => {
  state.buffer = Buffer.concat([state.buffer, chunk])
  while (state.buffer.byteLength) {
    const start = state.buffer.slice(0, Math.min(state.buffer.byteLength, 32)).toString('utf8')
    if (/^Content-Length:/i.test(start)) {
      const text = state.buffer.toString('utf8')
      const headerEnd = text.indexOf('\r\n\r\n') === -1 ? text.indexOf('\n\n') : text.indexOf('\r\n\r\n')
      if (headerEnd === -1) return
      const header = text.slice(0, headerEnd)
      const lengthMatch = header.match(/Content-Length:\s*(\d+)/i)
      if (!lengthMatch) {
        state.buffer = Buffer.alloc(0)
        return
      }
      const delimiterLength = text.slice(headerEnd, headerEnd + 4) === '\r\n\r\n' ? 4 : 2
      const bodyStart = headerEnd + delimiterLength
      const bodyLength = Number(lengthMatch[1])
      if (state.buffer.byteLength < bodyStart + bodyLength) return
      const body = state.buffer.slice(bodyStart, bodyStart + bodyLength).toString('utf8')
      state.buffer = state.buffer.slice(bodyStart + bodyLength)
      try {
        onMessage(JSON.parse(body))
      } catch {
        // MCP servers should only write protocol JSON to stdout; ignore malformed stdout lines.
      }
      continue
    }

    const newline = state.buffer.indexOf(0x0a)
    if (newline === -1) return
    const line = state.buffer.slice(0, newline).toString('utf8').trim()
    state.buffer = state.buffer.slice(newline + 1)
    if (!line) continue
    try {
      onMessage(JSON.parse(line))
    } catch {
      // Non-protocol stdout is ignored so a noisy server cannot crash Settings.
    }
  }
}

const createMcpStdioClient = (server: McpConfigFileServer, timeoutMs: number): McpStdioClient => {
  const parsed = splitCommand(server.command || '')
  const command = parsed.command
  const args = [...parsed.args, ...(server.args || [])]
  if (!command) {
    throw new Error('MCP stdio server command is required.')
  }

  const child = spawn(command, args, {
    cwd: server.cwd || undefined,
    env: { ...process.env, ...(server.env || {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  }) as ChildProcessWithoutNullStreams

  let nextId = 1
  let closed = false
  let stderr = ''
  const bufferState = { buffer: Buffer.alloc(0) }
  const pending = new Map<
    number,
    {
      resolve: (value: unknown) => void
      reject: (error: Error) => void
      timer: NodeJS.Timeout
    }
  >()

  const failPending = (error: Error) => {
    for (const item of pending.values()) {
      clearTimeout(item.timer)
      item.reject(error)
    }
    pending.clear()
  }

  child.stdout.on('data', (chunk: Buffer) => {
    parseMessagesFromBuffer(bufferState, chunk, (message) => {
      const id = typeof message.id === 'number' ? message.id : Number(message.id)
      if (!Number.isFinite(id)) return
      const request = pending.get(id)
      if (!request) return
      pending.delete(id)
      clearTimeout(request.timer)
      if (message.error) {
        request.reject(new Error(message.error.message || `MCP request ${id} failed.`))
        return
      }
      request.resolve(message.result)
    })
  })
  child.stderr.on('data', (chunk: Buffer) => {
    stderr = `${stderr}${chunk.toString('utf8')}`.slice(-2000)
  })
  child.once('error', (error) => {
    closed = true
    failPending(error)
  })
  child.once('exit', (code) => {
    closed = true
    if (pending.size) {
      const message = stderr.trim() || `MCP server exited with code ${code ?? 'unknown'}.`
      failPending(new Error(message))
    }
  })

  const send = (message: JsonRpcMessage) => {
    if (closed || child.killed) throw new Error('MCP server process is not available.')
    const body = JSON.stringify({ jsonrpc: '2.0', ...message })
    child.stdin.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`)
  }

  const request = (method: string, params?: unknown) =>
    new Promise<unknown>((resolve, reject) => {
      const id = nextId++
      const timer = setTimeout(() => {
        pending.delete(id)
        const suffix = stderr.trim() ? ` ${stderr.trim()}` : ''
        reject(new Error(`MCP ${method} timed out.${suffix}`))
      }, timeoutMs)
      pending.set(id, { resolve, reject, timer })
      try {
        send({ id, method, ...(params === undefined ? {} : { params }) })
      } catch (error) {
        clearTimeout(timer)
        pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })

  const notify = (method: string, params?: unknown) => {
    send({ method, ...(params === undefined ? {} : { params }) })
  }

  const close = () => {
    closed = true
    failPending(new Error('MCP server process closed.'))
    child.stdin.end()
    if (!child.killed) child.kill()
  }

  return { request, notify, close }
}

const toolParameters = (schema: unknown): McpToolConfig['parameters'] => {
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

const normalizeTools = (serverName: string, result: unknown, existing: McpServerUserConfig | undefined, toolStates: McpToolStatesUserConfig): McpToolConfig[] => {
  const existingTools = new Map((existing?.tools || []).map((tool) => [tool.name, tool]))
  const tools = isRecord(result) && Array.isArray(result.tools) ? result.tools : []
  return tools
    .filter(isRecord)
    .map((tool) => {
      const name = cleanText(tool.name)
      if (!name) return null
      const stateKey = `${serverName}:${name}`
      return {
        name,
        description: cleanText(tool.description),
        enabled: typeof toolStates[stateKey] === 'boolean' ? toolStates[stateKey] : existingTools.get(name)?.enabled ?? true,
        parameters: toolParameters(tool.inputSchema)
      }
    })
    .filter((tool): tool is McpToolConfig => Boolean(tool))
}

const normalizeResources = (result: unknown): McpResourceConfig[] => {
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

const discoverStdioServer = async (
  name: string,
  config: McpConfigFileServer,
  existing: McpServerUserConfig | undefined,
  toolStates: McpToolStatesUserConfig,
  options: McpDiscoveryOptions
): Promise<McpServerUserConfig> => {
  const client = createMcpStdioClient(config, timeoutForServer(config, options))
  try {
    await client.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: options.clientName || 'aiopsterm',
        version: options.clientVersion || '0.1.0'
      }
    })
    client.notify('notifications/initialized', {})

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
      tools: normalizeTools(name, toolResult, existing, toolStates),
      resources: normalizeResources(resourceResult)
    }
  } finally {
    client.close()
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
        tools: existing?.tools || [],
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
        tools: existing?.tools || [],
        resources: existing?.resources || []
      })
      continue
    }
    if (serverConfig.type !== 'stdio') {
      mcpServers.push({
        name,
        status: 'error',
        disabled: false,
        error: `MCP ${serverConfig.type} transport is not supported by aiopsterm yet.`,
        tools: [],
        resources: []
      })
      continue
    }
    try {
      mcpServers.push(await discoverStdioServer(name, serverConfig, existing, toolStates, options))
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
