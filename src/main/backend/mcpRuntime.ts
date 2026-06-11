import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import type {
  AiopsMutationResult,
  McpConfigFile,
  McpConfigFileServer,
  McpResourceConfig,
  McpResourceReadContent,
  McpResourceReadInput,
  McpResourceReadResult,
  McpServerUserConfig,
  McpToolCallContent,
  McpToolCallInput,
  McpToolCallResult,
  McpToolConfig,
  McpToolStatesUserConfig
} from '@shared/preload'

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

type McpOperationOptions = {
  servers?: McpServerUserConfig[]
  toolStates?: McpToolStatesUserConfig
  clientName?: string
  clientVersion?: string
  timeoutMs?: number
  maxTimeoutMs?: number
}

type McpStdioClient = {
  request(method: string, params?: unknown): Promise<unknown>
  notify(method: string, params?: unknown): void | Promise<void>
  close(): void
}

type McpClient = McpStdioClient

type HttpRequestHeaders = Record<string, string>

const defaultDiscoveryTimeoutMs = 8000
const defaultOperationTimeoutMs = 60000
const defaultOperationMaxTimeoutMs = 120000
const minimumDiscoveryTimeoutMs = 1000
const mcpProtocolVersion = '2024-11-05'

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const cleanText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const cloneJsonRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (!isRecord(value)) return undefined
  try {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
  } catch {
    return undefined
  }
}

const mutationError = <T = never>(errorCode: string, errorMessage: string): AiopsMutationResult<T> => ({
  ok: false,
  errorCode,
  errorMessage
})

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

const timeoutForServer = (server: McpConfigFileServer, options: Pick<McpDiscoveryOptions, 'timeoutMs' | 'maxTimeoutMs'>) => {
  const configured = Number(server.timeout || 0) > 0 ? Number(server.timeout) * 1000 : options.timeoutMs || defaultDiscoveryTimeoutMs
  const cap = Math.max(minimumDiscoveryTimeoutMs, options.maxTimeoutMs || defaultDiscoveryTimeoutMs)
  return Math.max(minimumDiscoveryTimeoutMs, Math.min(configured, cap))
}

const operationClientOptions = (options: McpOperationOptions): Pick<McpOperationOptions, 'clientName' | 'clientVersion' | 'timeoutMs' | 'maxTimeoutMs'> => ({
  clientName: options.clientName,
  clientVersion: options.clientVersion,
  timeoutMs: options.timeoutMs || defaultOperationTimeoutMs,
  maxTimeoutMs: options.maxTimeoutMs || defaultOperationMaxTimeoutMs
})

const fetchWithTimeout = async (url: string | URL, init: RequestInit, timeoutMs: number) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

const normalizeHttpHeaders = (server: McpConfigFileServer, extra?: HttpRequestHeaders): HttpRequestHeaders => ({
  ...(server.headers || {}),
  ...(extra || {})
})

const parseSseEventsFromChunk = (state: { buffer: string }, chunk: string, onEvent: (event: { event: string; data: string }) => void) => {
  state.buffer += chunk.replace(/\r\n/g, '\n')
  while (state.buffer.includes('\n\n')) {
    const index = state.buffer.indexOf('\n\n')
    const raw = state.buffer.slice(0, index)
    state.buffer = state.buffer.slice(index + 2)
    let event = 'message'
    const data: string[] = []
    raw.split('\n').forEach((line) => {
      if (!line || line.startsWith(':')) return
      const separatorIndex = line.indexOf(':')
      const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex)
      const value = separatorIndex === -1 ? '' : line.slice(separatorIndex + 1).replace(/^ /, '')
      if (field === 'event') event = value || 'message'
      if (field === 'data') data.push(value)
    })
    if (data.length) onEvent({ event, data: data.join('\n') })
  }
}

const readSseMessages = async (response: Response, timeoutMs: number, onMessage: (message: JsonRpcMessage) => boolean) =>
  new Promise<void>((resolve, reject) => {
    const body = response.body
    if (!body) {
      reject(new Error('MCP SSE response body is empty.'))
      return
    }
    const reader = body.getReader()
    const decoder = new TextDecoder()
    const state = { buffer: '' }
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback()
    }
    const timer = setTimeout(async () => {
      try {
        await reader.cancel()
      } catch {
        // Best effort cancellation.
      }
      finish(() => reject(new Error('MCP SSE response timed out.')))
    }, timeoutMs)

    const read = (): void => {
      if (settled) return
      reader
        .read()
        .then(({ value, done }) => {
          if (settled) return
          if (done) {
            finish(resolve)
            return
          }
          parseSseEventsFromChunk(state, decoder.decode(value, { stream: true }), (event) => {
            if (settled) return
            if (event.event !== 'message') return
            try {
              const parsed = JSON.parse(event.data) as JsonRpcMessage
              if (onMessage(parsed)) {
                void reader.cancel().finally(() => finish(resolve))
              }
            } catch {
              // Ignore malformed SSE data frames from noisy servers.
            }
          })
          read()
        })
        .catch((error) => {
          finish(() => reject(error instanceof Error ? error : new Error(String(error))))
        })
    }
    read()
  })

const readSseResponseMessage = async (response: Response, id: number | string, timeoutMs: number) => {
  let found: JsonRpcMessage | null = null
  await readSseMessages(response, timeoutMs, (message) => {
    if (message.id !== id) return false
    found = message
    return true
  })
  if (!found) throw new Error(`MCP HTTP request ${id} did not return a response.`)
  return found
}

const parseJsonRpcResponsePayload = (payload: unknown): JsonRpcMessage[] => {
  const messages = Array.isArray(payload) ? payload : [payload]
  return messages.filter(isRecord).map((message) => message as JsonRpcMessage)
}

const parseHttpJsonRpcMessages = async (response: Response, timeoutMs: number): Promise<JsonRpcMessage[]> => {
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    return parseJsonRpcResponsePayload(await response.json())
  }
  if (contentType.includes('text/event-stream')) {
    const messages: JsonRpcMessage[] = []
    await readSseMessages(response, timeoutMs, (message) => {
      messages.push(message)
      return false
    })
    return messages
  }
  if (response.status === 202 || response.status === 204) return []
  const body = await response.text().catch(() => '')
  throw new Error(`Unexpected MCP HTTP response content type: ${contentType || 'unknown'}${body ? ` ${body.slice(0, 300)}` : ''}`)
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

const createMcpStreamableHttpClient = (server: McpConfigFileServer, timeoutMs: number): McpClient => {
  const url = cleanText(server.url)
  if (!url) throw new Error('MCP HTTP server url is required.')
  try {
    new URL(url)
  } catch {
    throw new Error(`MCP HTTP server url is invalid: ${url}`)
  }

  let nextId = 1
  let sessionId = ''
  let closed = false

  const request = async (method: string, params?: unknown): Promise<unknown> => {
    if (closed) throw new Error('MCP HTTP client is closed.')
    const id = nextId++
    const body = JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })
    const response = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: normalizeHttpHeaders(server, {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          ...(sessionId ? { 'mcp-session-id': sessionId } : {})
        }),
        body
      },
      timeoutMs
    )
    const nextSessionId = response.headers.get('mcp-session-id')
    if (nextSessionId) sessionId = nextSessionId
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`MCP HTTP ${method} failed with status ${response.status}${text ? `: ${text.slice(0, 500)}` : ''}`)
    }
    const contentType = response.headers.get('content-type') || ''
    let message: JsonRpcMessage | undefined
    if (contentType.includes('text/event-stream')) {
      message = await readSseResponseMessage(response, id, timeoutMs)
    } else {
      const messages = await parseHttpJsonRpcMessages(response, timeoutMs)
      message = messages.find((item) => item.id === id)
    }
    if (!message) throw new Error(`MCP HTTP request ${id} did not return a response.`)
    if (message.error) throw new Error(message.error.message || `MCP request ${id} failed.`)
    return message.result
  }

  const notify = async (method: string, params?: unknown) => {
    if (closed) throw new Error('MCP HTTP client is closed.')
    const body = JSON.stringify({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) })
    const response = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: normalizeHttpHeaders(server, {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          ...(sessionId ? { 'mcp-session-id': sessionId } : {})
        }),
        body
      },
      timeoutMs
    )
    const nextSessionId = response.headers.get('mcp-session-id')
    if (nextSessionId) sessionId = nextSessionId
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`MCP HTTP notification ${method} failed with status ${response.status}${text ? `: ${text.slice(0, 500)}` : ''}`)
    }
    await response.body?.cancel()
  }

  const close = () => {
    closed = true
  }

  return { request, notify, close }
}

const openLegacySseEndpoint = async (server: McpConfigFileServer, timeoutMs: number) => {
  const url = cleanText(server.url)
  if (!url) throw new Error('MCP SSE server url is required.')
  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    throw new Error(`MCP SSE server url is invalid: ${url}`)
  }
  const response = await fetchWithTimeout(
    parsedUrl,
    {
      method: 'GET',
      headers: normalizeHttpHeaders(server, { accept: 'text/event-stream' })
    },
    timeoutMs
  )
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`MCP SSE connection failed with status ${response.status}${text ? `: ${text.slice(0, 500)}` : ''}`)
  }
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('text/event-stream')) {
    await response.body?.cancel()
    throw new Error(`MCP SSE server returned unexpected content type: ${contentType || 'unknown'}`)
  }
  const body = response.body
  if (!body) throw new Error('MCP SSE response body is empty.')
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const state = { buffer: '' }
  const pending = new Map<
    number | string,
    {
      resolve: (message: JsonRpcMessage) => void
      reject: (error: Error) => void
      timer: NodeJS.Timeout
    }
  >()

  let endpoint = ''
  let closed = false
  let endpointResolved = false
  let endpointResolve: (value: { endpoint: string; reader: ReadableStreamDefaultReader<Uint8Array>; pending: typeof pending; close: () => void }) => void = () => {}
  let endpointReject: (error: Error) => void = () => {}

  const failPending = (error: Error) => {
    for (const item of pending.values()) {
      clearTimeout(item.timer)
      item.reject(error)
    }
    pending.clear()
  }

  const close = () => {
    closed = true
    failPending(new Error('MCP SSE client closed.'))
    void reader.cancel()
  }

  const endpointPromise = new Promise<{ endpoint: string; reader: ReadableStreamDefaultReader<Uint8Array>; pending: typeof pending; close: () => void }>((resolve, reject) => {
    endpointResolve = resolve
    endpointReject = reject
  })
  const endpointTimer = setTimeout(() => {
    if (!endpointResolved) {
      close()
      endpointReject(new Error('MCP SSE endpoint timed out.'))
    }
  }, timeoutMs)

  const read = (): void => {
    reader
      .read()
      .then(({ value, done }) => {
        if (done) {
          if (!endpointResolved) {
            clearTimeout(endpointTimer)
            endpointReject(new Error('MCP SSE stream closed before endpoint was announced.'))
          }
          failPending(new Error('MCP SSE stream closed.'))
          return
        }
        parseSseEventsFromChunk(state, decoder.decode(value, { stream: true }), (event) => {
          if (event.event === 'endpoint') {
            try {
              const nextEndpoint = new URL(event.data, parsedUrl)
              if (nextEndpoint.origin !== parsedUrl.origin) throw new Error(`Endpoint origin does not match connection origin: ${nextEndpoint.origin}`)
              endpoint = nextEndpoint.toString()
              if (!endpointResolved) {
                endpointResolved = true
                clearTimeout(endpointTimer)
                endpointResolve({ endpoint, reader, pending, close })
              }
            } catch (error) {
              clearTimeout(endpointTimer)
              endpointReject(error instanceof Error ? error : new Error(String(error)))
              close()
            }
            return
          }
          if (event.event !== 'message') return
          try {
            const message = JSON.parse(event.data) as JsonRpcMessage
            const request = pending.get(message.id || '')
            if (!request) return
            pending.delete(message.id || '')
            clearTimeout(request.timer)
            request.resolve(message)
          } catch {
            // Ignore malformed server messages so the stream can keep running.
          }
        })
        if (!closed) read()
      })
      .catch((error) => {
        const normalized = error instanceof Error ? error : new Error(String(error))
        if (!endpointResolved) {
          clearTimeout(endpointTimer)
          endpointReject(normalized)
        }
        failPending(normalized)
      })
  }
  read()
  return endpointPromise
}

const createMcpLegacySseClient = async (server: McpConfigFileServer, timeoutMs: number): Promise<McpClient> => {
  const connection = await openLegacySseEndpoint(server, timeoutMs)
  let nextId = 1
  let closed = false

  const request = async (method: string, params?: unknown): Promise<unknown> => {
    if (closed) throw new Error('MCP SSE client is closed.')
    const id = nextId++
    const body = JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })
    const responsePromise = new Promise<JsonRpcMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        connection.pending.delete(id)
        reject(new Error(`MCP ${method} timed out.`))
      }, timeoutMs)
      connection.pending.set(id, { resolve, reject, timer })
    })
    let response: Response
    try {
      response = await fetchWithTimeout(
        connection.endpoint,
        {
          method: 'POST',
          headers: normalizeHttpHeaders(server, {
            'content-type': 'application/json'
          }),
          body
        },
        timeoutMs
      )
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(`MCP SSE ${method} failed with status ${response.status}${text ? `: ${text.slice(0, 500)}` : ''}`)
      }
    } catch (error) {
      const pending = connection.pending.get(id)
      if (pending) {
        clearTimeout(pending.timer)
        connection.pending.delete(id)
      }
      throw error
    }
    await response.body?.cancel()
    const message = await responsePromise
    if (message.error) throw new Error(message.error.message || `MCP request ${id} failed.`)
    return message.result
  }

  const notify = async (method: string, params?: unknown) => {
    if (closed) throw new Error('MCP SSE client is closed.')
    const body = JSON.stringify({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) })
    const response = await fetchWithTimeout(
      connection.endpoint,
      {
        method: 'POST',
        headers: normalizeHttpHeaders(server, {
          'content-type': 'application/json'
        }),
        body
      },
      timeoutMs
    )
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`MCP SSE notification ${method} failed with status ${response.status}${text ? `: ${text.slice(0, 500)}` : ''}`)
    }
    await response.body?.cancel()
  }

  const close = () => {
    closed = true
    connection.close()
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

const autoApproveSet = (source?: string[]) => new Set((source || []).map(cleanText).filter(Boolean))

const cloneToolsWithAutoApprove = (tools: McpToolConfig[] | undefined, autoApprove?: string[]): McpToolConfig[] => {
  const approved = autoApproveSet(autoApprove)
  return (tools || []).map((tool) => ({
    ...tool,
    autoApprove: approved.has(tool.name),
    parameters: tool.parameters.map((parameter) => ({ ...parameter }))
  }))
}

const normalizeTools = (
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

const createMcpClient = async (server: McpConfigFileServer, timeoutMs: number): Promise<McpClient> => {
  if (server.type === 'stdio') return createMcpStdioClient(server, timeoutMs)
  if (server.type === 'streamableHttp') return createMcpStreamableHttpClient(server, timeoutMs)
  if (server.type === 'sse') return createMcpLegacySseClient(server, timeoutMs)
  throw new Error(`MCP ${server.type} transport is not supported by aiopsterm.`)
}

const initializeMcpClient = async (server: McpConfigFileServer, options: Pick<McpDiscoveryOptions, 'clientName' | 'clientVersion' | 'timeoutMs' | 'maxTimeoutMs'>) => {
  const client = await createMcpClient(server, timeoutForServer(server, options))
  try {
    await client.request('initialize', {
      protocolVersion: mcpProtocolVersion,
      capabilities: {},
      clientInfo: {
        name: options.clientName || 'aiopsterm',
        version: options.clientVersion || '0.1.0'
      }
    })
    await client.notify('notifications/initialized', {})
    return client
  } catch (error) {
    client.close()
    throw error
  }
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

const normalizeToolCallContent = (result: unknown): { content: McpToolCallContent[]; isError: boolean } => {
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

const normalizeResourceReadContents = (result: unknown): McpResourceReadContent[] => {
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

const resolveMcpOperationServer = <T>(
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

  let client: McpClient | null = null
  try {
    client = await initializeMcpClient(resolved.config, operationClientOptions(options))
    const result = await client.request('tools/call', {
      name: toolName,
      arguments: cloneJsonRecord(input.arguments) || {}
    })
    const normalized = normalizeToolCallContent(result)
    return {
      ok: true,
      data: {
        serverName: resolved.name,
        toolName,
        ...(cloneJsonRecord(input.arguments) ? { arguments: cloneJsonRecord(input.arguments) } : {}),
        content: normalized.content,
        isError: normalized.isError,
        durationMs: Date.now() - startedAt
      }
    }
  } catch (error) {
    return mutationError('MCP_TOOL_CALL_FAILED', error instanceof Error ? error.message : 'MCP tool call failed.')
  } finally {
    client?.close()
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

  let client: McpClient | null = null
  try {
    client = await initializeMcpClient(resolved.config, operationClientOptions(options))
    const result = await client.request('resources/read', { uri })
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
    return mutationError('MCP_RESOURCE_READ_FAILED', error instanceof Error ? error.message : 'MCP resource read failed.')
  } finally {
    client?.close()
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
