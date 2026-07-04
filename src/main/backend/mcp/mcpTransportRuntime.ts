import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import type { McpConfigFileServer } from '@shared/contracts/mcp'
import {
  cleanText,
  isRecord,
  mcpProtocolVersion,
  normalizeHttpHeaders,
  splitCommand,
  timeoutForServer
} from './mcpRuntimeNormalization'
import type { JsonRpcMessage, McpClient, McpDiscoveryOptions, McpStdioClient } from './mcpRuntimeTypes'

const fetchWithTimeout = async (url: string | URL, init: RequestInit, timeoutMs: number) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

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
    child.stdin.write(`${body}\n`)
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

const mcpTransportTypeForServer = (server: McpConfigFileServer): 'stdio' | 'streamableHttp' | 'sse' | string => {
  const rawType = cleanText((server as { type?: unknown }).type)
  if (rawType === 'stdio' || rawType === 'sse' || rawType === 'streamableHttp') return rawType
  if (rawType === 'http' || rawType === 'streamable_http' || rawType === 'streamable-http') return 'streamableHttp'

  const hasCommand = cleanText(server.command).length > 0
  const hasUrl = cleanText(server.url).length > 0
  return !hasCommand && hasUrl ? 'streamableHttp' : rawType || 'stdio'
}

const createMcpClient = async (server: McpConfigFileServer, timeoutMs: number): Promise<McpClient> => {
  const transportType = mcpTransportTypeForServer(server)
  if (transportType === 'stdio') return createMcpStdioClient(server, timeoutMs)
  if (transportType === 'streamableHttp') return createMcpStreamableHttpClient(server, timeoutMs)
  if (transportType === 'sse') return createMcpLegacySseClient(server, timeoutMs)
  throw new Error(`MCP ${transportType} transport is not supported by aiopsterm.`)
}

export const initializeMcpClient = async (server: McpConfigFileServer, options: Pick<McpDiscoveryOptions, 'clientName' | 'clientVersion' | 'timeoutMs' | 'maxTimeoutMs'>) => {
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

export const closeMcpClient = (client: McpClient) => {
  try {
    client.close()
  } catch {
    // Best effort close; callers are already handling the operation outcome.
  }
}
