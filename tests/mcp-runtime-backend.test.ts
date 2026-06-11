import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import type { McpConfigFile, McpResourceReadInput, McpServerUserConfig, McpToolCallInput, McpToolStatesUserConfig } from '@shared/preload'

let backend: {
  clearMcpRuntimeClientCache: () => Promise<void>
  discoverMcpServerSnapshot: (
    config: McpConfigFile,
    options?: {
      existingServers?: McpServerUserConfig[]
      toolStates?: McpToolStatesUserConfig
      clientName?: string
      clientVersion?: string
      runDiscovery?: boolean
      timeoutMs?: number
      maxTimeoutMs?: number
    }
  ) => Promise<{
    mcpConfig: McpConfigFile
    mcpServers: McpServerUserConfig[]
    mcpToolStates: McpToolStatesUserConfig
  }>
  callMcpTool: (
    config: McpConfigFile,
    input: McpToolCallInput,
    options?: {
      servers?: McpServerUserConfig[]
      toolStates?: McpToolStatesUserConfig
      clientName?: string
      clientVersion?: string
      timeoutMs?: number
      maxTimeoutMs?: number
    }
  ) => Promise<{
    ok: boolean
    data?: {
      serverName: string
      toolName: string
      arguments?: Record<string, unknown>
      content: Array<Record<string, unknown> & { type: string }>
      isError: boolean
      durationMs: number
    }
    errorCode?: string
    errorMessage?: string
  }>
  readMcpResource: (
    config: McpConfigFile,
    input: McpResourceReadInput,
    options?: {
      servers?: McpServerUserConfig[]
      toolStates?: McpToolStatesUserConfig
      clientName?: string
      clientVersion?: string
      timeoutMs?: number
      maxTimeoutMs?: number
    }
  ) => Promise<{
    ok: boolean
    data?: {
      serverName: string
      uri: string
      contents: Array<Record<string, unknown> & { uri: string }>
      durationMs: number
    }
    errorCode?: string
    errorMessage?: string
  }>
}

const loadBackend = async () => {
  const modulePath = '../src/main/backend/mcpRuntime'
  backend = await import(modulePath)
}

afterEach(async () => {
  if (backend) await backend.clearMcpRuntimeClientCache()
})

const mcpFixtureScript = `
let buffer = ''
const send = (message) => {
  const body = JSON.stringify({ jsonrpc: '2.0', ...message })
  process.stdout.write('Content-Length: ' + Buffer.byteLength(body, 'utf8') + '\\r\\n\\r\\n' + body)
}
const handle = (message) => {
  if (message.method === 'initialize') {
    send({ id: message.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'fixture', version: '1.0.0' } } })
    return
  }
  if (message.method === 'tools/list') {
    send({ id: message.id, result: { tools: [
      { name: 'inspect_service', description: 'Inspect a backend service.', inputSchema: { type: 'object', required: ['name'], properties: { name: { type: 'string', description: 'Service name.' }, namespace: { type: 'string', description: 'Namespace.' } } } },
      { name: 'tail_logs', description: 'Tail recent service logs.', inputSchema: { type: 'object', properties: { lines: { type: 'number', description: 'Line count.' } } } }
    ] } })
    return
  }
  if (message.method === 'resources/list') {
    send({ id: message.id, result: { resources: [{ name: 'runbook', description: 'Incident runbook.', uri: 'file:///runbook.md' }] } })
    return
  }
  if (message.method === 'tools/call') {
    const params = message.params || {}
    const args = params.arguments || {}
    if (params.name !== 'inspect_service') {
      send({ id: message.id, error: { code: -32602, message: 'unknown tool: ' + params.name } })
      return
    }
    send({ id: message.id, result: { content: [{ type: 'text', text: 'service=' + args.name + ';namespace=' + (args.namespace || 'default') }], isError: false } })
    return
  }
  if (message.method === 'resources/read') {
    const uri = message.params && message.params.uri
    if (uri !== 'file:///runbook.md') {
      send({ id: message.id, error: { code: -32002, message: 'resource not found: ' + uri } })
      return
    }
    send({ id: message.id, result: { contents: [{ uri, mimeType: 'text/markdown', text: '# Runbook\\nCheck service health.' }] } })
    return
  }
  if (message.id !== undefined) {
    send({ id: message.id, result: {} })
  }
}
process.stdin.on('data', (chunk) => {
  buffer += chunk.toString('utf8')
  while (buffer) {
    const headerEnd = buffer.indexOf('\\r\\n\\r\\n')
    if (headerEnd === -1) return
    const header = buffer.slice(0, headerEnd)
    const match = header.match(/Content-Length:\\s*(\\d+)/i)
    if (!match) process.exit(17)
    const bodyStart = headerEnd + 4
    const length = Number(match[1])
    if (buffer.length < bodyStart + length) return
    const body = buffer.slice(bodyStart, bodyStart + length)
    buffer = buffer.slice(bodyStart + length)
    handle(JSON.parse(body))
  }
})
`

const discover = async (config: McpConfigFile, options: { existingServers?: McpServerUserConfig[]; toolStates?: McpToolStatesUserConfig } = {}) => {
  await loadBackend()
  return backend.discoverMcpServerSnapshot(config, {
    ...options,
    runDiscovery: true,
    timeoutMs: 1000,
    maxTimeoutMs: 1000,
    clientName: 'aiopsterm-test',
    clientVersion: '0.1.0-test'
  })
}

const fixtureConfig = (): McpConfigFile => ({
  mcpServers: {
    fixture: {
      type: 'stdio',
      command: process.execPath,
      args: ['-e', mcpFixtureScript],
      timeout: 1
    }
  }
})

const operationOptions = (options: { servers?: McpServerUserConfig[]; toolStates?: McpToolStatesUserConfig } = {}) => ({
  ...options,
  timeoutMs: 1000,
  maxTimeoutMs: 1000,
  clientName: 'aiopsterm-test',
  clientVersion: '0.1.0-test'
})

const readJsonBody = async (request: IncomingMessage) =>
  new Promise<Record<string, unknown>>((resolve, reject) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}') as Record<string, unknown>)
      } catch (error) {
        reject(error)
      }
    })
    request.on('error', reject)
  })

const mcpFixtureResultForMessage = (message: Record<string, unknown>) => {
  const id = message.id
  const method = message.method
  if (method === 'initialize') {
    return { jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'http-fixture', version: '1.0.0' } } }
  }
  if (method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools: [
          {
            name: 'inspect_service',
            description: 'Inspect an HTTP-backed service.',
            inputSchema: {
              type: 'object',
              required: ['name'],
              properties: {
                name: { type: 'string', description: 'Service name.' },
                namespace: { type: 'string', description: 'Namespace.' }
              }
            }
          }
        ]
      }
    }
  }
  if (method === 'resources/list') {
    return { jsonrpc: '2.0', id, result: { resources: [{ name: 'http-runbook', description: 'HTTP incident runbook.', uri: 'https://runbook.local/http.md' }] } }
  }
  if (method === 'tools/call') {
    const params = (message.params || {}) as Record<string, unknown>
    const args = (params.arguments || {}) as Record<string, unknown>
    if (params.name !== 'inspect_service') {
      return { jsonrpc: '2.0', id, error: { code: -32602, message: `unknown tool: ${String(params.name || '')}` } }
    }
    return {
      jsonrpc: '2.0',
      id,
      result: { content: [{ type: 'text', text: `http-service=${String(args.name || '')};namespace=${String(args.namespace || 'default')}` }], isError: false }
    }
  }
  if (method === 'resources/read') {
    const params = (message.params || {}) as Record<string, unknown>
    if (params.uri !== 'https://runbook.local/http.md') {
      return { jsonrpc: '2.0', id, error: { code: -32002, message: `resource not found: ${String(params.uri || '')}` } }
    }
    return { jsonrpc: '2.0', id, result: { contents: [{ uri: params.uri, mimeType: 'text/markdown', text: '# HTTP Runbook\nCheck remote service health.' }] } }
  }
  if (id !== undefined) return { jsonrpc: '2.0', id, result: {} }
  return null
}

const writeJsonRpcResponse = (response: ServerResponse, message: Record<string, unknown>, options: { sse?: boolean; sessionId?: string } = {}) => {
  const body = JSON.stringify(message)
  if (options.sse) {
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      ...(options.sessionId ? { 'mcp-session-id': options.sessionId } : {})
    })
    response.end(`event: message\ndata: ${body}\n\n`)
    return
  }
  response.writeHead(200, {
    'content-type': 'application/json',
    ...(options.sessionId ? { 'mcp-session-id': options.sessionId } : {})
  })
  response.end(body)
}

type StreamableHttpFixtureStats = {
  methods: Record<string, number>
  sessionHeaders: Array<string | undefined>
}

const withStreamableHttpFixture = async <T>(run: (url: string, stats: StreamableHttpFixtureStats) => Promise<T>) => {
  const stats: StreamableHttpFixtureStats = {
    methods: {},
    sessionHeaders: []
  }
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST') {
      response.writeHead(405)
      response.end('method not allowed')
      return
    }
    try {
      const message = await readJsonBody(request)
      const method = typeof message.method === 'string' ? message.method : '<missing>'
      stats.methods[method] = (stats.methods[method] || 0) + 1
      stats.sessionHeaders.push(Array.isArray(request.headers['mcp-session-id']) ? request.headers['mcp-session-id'][0] : request.headers['mcp-session-id'])
      const result = mcpFixtureResultForMessage(message)
      if (!result) {
        response.writeHead(202)
        response.end()
        return
      }
      writeJsonRpcResponse(response, result, { sse: request.headers.accept?.includes('text/event-stream'), sessionId: 'session-http-fixture' })
    } catch (error) {
      response.writeHead(500, { 'content-type': 'text/plain' })
      response.end(error instanceof Error ? error.message : String(error))
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('fixture server did not bind')
  try {
    return await run(`http://127.0.0.1:${address.port}/mcp`, stats)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
}

const withLegacySseFixture = async <T>(run: (url: string) => Promise<T>) => {
  const clients = new Set<ServerResponse>()
  const server = createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/sse') {
      clients.add(response)
      response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive', 'cache-control': 'no-cache' })
      response.write('event: endpoint\ndata: /messages\n\n')
      request.on('close', () => {
        clients.delete(response)
      })
      return
    }
    if (request.method === 'POST' && request.url === '/messages') {
      try {
        const message = await readJsonBody(request)
        const result = mcpFixtureResultForMessage(message)
        response.writeHead(202)
        response.end()
        if (result) {
          for (const client of clients) {
            client.write(`event: message\ndata: ${JSON.stringify(result)}\n\n`)
          }
        }
      } catch (error) {
        response.writeHead(500, { 'content-type': 'text/plain' })
        response.end(error instanceof Error ? error.message : String(error))
      }
      return
    }
    response.writeHead(404)
    response.end('not found')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('fixture server did not bind')
  try {
    return await run(`http://127.0.0.1:${address.port}/sse`)
  } finally {
    for (const client of clients) client.end()
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
}

describe('mcp runtime backend boundary', () => {
  it('discovers tools and resources from a real stdio MCP server process', async () => {
    const snapshot = await discover(fixtureConfig())

    expect(snapshot.mcpServers).toEqual([
      {
        name: 'fixture',
        status: 'connected',
        disabled: false,
        tools: [
          {
            name: 'inspect_service',
            description: 'Inspect a backend service.',
            enabled: true,
            autoApprove: false,
            parameters: [
              { name: 'name', description: 'Service name.', required: true },
              { name: 'namespace', description: 'Namespace.' }
            ]
          },
          {
            name: 'tail_logs',
            description: 'Tail recent service logs.',
            enabled: true,
            autoApprove: false,
            parameters: [{ name: 'lines', description: 'Line count.' }]
          }
        ],
        resources: [{ name: 'runbook', description: 'Incident runbook.', uri: 'file:///runbook.md' }]
      }
    ])
    expect(snapshot.mcpToolStates).toEqual({
      'fixture:inspect_service': true,
      'fixture:tail_logs': true
    })
  })

  it('maps config-file auto approve entries onto discovered tool rows', async () => {
    const config = fixtureConfig()
    config.mcpServers.fixture.autoApprove = ['tail_logs']
    const snapshot = await discover(config)

    expect(snapshot.mcpServers[0].tools.map((tool) => [tool.name, tool.autoApprove])).toEqual([
      ['inspect_service', false],
      ['tail_logs', true]
    ])
  })

  it('preserves backend-owned tool enable state across rediscovery', async () => {
    const snapshot = await discover(
      fixtureConfig(),
      {
        toolStates: {
          'fixture:inspect_service': false
        }
      }
    )

    expect(snapshot.mcpServers[0].tools.map((tool) => [tool.name, tool.enabled])).toEqual([
      ['inspect_service', false],
      ['tail_logs', true]
    ])
    expect(snapshot.mcpToolStates).toEqual({
      'fixture:inspect_service': false,
      'fixture:tail_logs': true
    })
  })

  it('keeps disabled servers from starting while preserving previous discovered rows', async () => {
    const previous: McpServerUserConfig = {
      name: 'fixture',
      status: 'connected',
      disabled: false,
      tools: [{ name: 'cached_tool', description: 'Cached tool.', enabled: true, parameters: [] }],
      resources: [{ name: 'cached-resource', description: 'Cached resource.', uri: 'file:///cached' }]
    }

    const snapshot = await discover(
      {
        mcpServers: {
          fixture: {
            type: 'stdio',
            disabled: true,
            command: 'missing-command-that-should-not-run',
            timeout: 1
          }
        }
      },
      { existingServers: [previous] }
    )

    expect(snapshot.mcpServers).toEqual([
      {
        name: 'fixture',
        status: 'disabled',
        disabled: true,
        tools: [{ ...previous.tools[0], autoApprove: false, parameters: [] }],
        resources: previous.resources
      }
    ])
  })

  it('overlays auto approve onto cached rows when discovery is skipped', async () => {
    await loadBackend()
    const previous: McpServerUserConfig = {
      name: 'fixture',
      status: 'connected',
      disabled: false,
      tools: [
        { name: 'inspect_service', description: 'Inspect a backend service.', enabled: true, autoApprove: false, parameters: [] },
        { name: 'tail_logs', description: 'Tail recent service logs.', enabled: true, autoApprove: false, parameters: [] }
      ],
      resources: []
    }

    const snapshot = await backend.discoverMcpServerSnapshot(
      {
        mcpServers: {
          fixture: {
            type: 'stdio',
            command: 'missing-command-that-should-not-run',
            autoApprove: ['inspect_service']
          }
        }
      },
      { existingServers: [previous], runDiscovery: false }
    )

    expect(snapshot.mcpServers[0].tools.map((tool) => [tool.name, tool.autoApprove])).toEqual([
      ['inspect_service', true],
      ['tail_logs', false]
    ])
  })

  it('discovers tools and resources from streamable HTTP and legacy SSE MCP servers', async () => {
    await withStreamableHttpFixture(async (httpUrl) => {
      await withLegacySseFixture(async (sseUrl) => {
        const snapshot = await discover({
          mcpServers: {
            remoteHttp: {
              type: 'streamableHttp',
              url: httpUrl,
              timeout: 1,
              autoApprove: ['inspect_service']
            },
            remoteSse: {
              type: 'sse',
              url: sseUrl,
              timeout: 1
            }
          }
        })

        expect(snapshot.mcpServers).toEqual([
          {
            name: 'remoteHttp',
            status: 'connected',
            disabled: false,
            tools: [
              {
                name: 'inspect_service',
                description: 'Inspect an HTTP-backed service.',
                enabled: true,
                autoApprove: true,
                parameters: [
                  { name: 'name', description: 'Service name.', required: true },
                  { name: 'namespace', description: 'Namespace.' }
                ]
              }
            ],
            resources: [{ name: 'http-runbook', description: 'HTTP incident runbook.', uri: 'https://runbook.local/http.md' }]
          },
          {
            name: 'remoteSse',
            status: 'connected',
            disabled: false,
            tools: [
              {
                name: 'inspect_service',
                description: 'Inspect an HTTP-backed service.',
                enabled: true,
                autoApprove: false,
                parameters: [
                  { name: 'name', description: 'Service name.', required: true },
                  { name: 'namespace', description: 'Namespace.' }
                ]
              }
            ],
            resources: [{ name: 'http-runbook', description: 'HTTP incident runbook.', uri: 'https://runbook.local/http.md' }]
          }
        ])
        expect(snapshot.mcpToolStates).toEqual({
          'remoteHttp:inspect_service': true,
          'remoteSse:inspect_service': true
        })
      })
    })
  })

  it('fails closed for failed remote and stdio MCP discovery', async () => {
    const snapshot = await discover({
      mcpServers: {
        remote: {
          type: 'streamableHttp',
          url: 'http://127.0.0.1:65535/mcp',
          timeout: 1
        },
        broken: {
          type: 'stdio',
          command: process.execPath,
          args: ['-e', "process.stderr.write('fixture failed'); process.exit(9)"],
          timeout: 1
        }
      }
    })

    expect(snapshot.mcpServers).toEqual([
      {
        name: 'remote',
        status: 'error',
        disabled: false,
        error: expect.any(String),
        tools: [],
        resources: []
      },
      {
        name: 'broken',
        status: 'error',
        disabled: false,
        error: expect.stringContaining('fixture failed'),
        tools: [],
        resources: []
      }
    ])
    expect(snapshot.mcpServers[0].error).not.toContain('not supported')
    expect(snapshot.mcpToolStates).toEqual({})
  })

  it('calls stdio MCP tools through the backend boundary', async () => {
    await loadBackend()

    const result = await backend.callMcpTool(
      fixtureConfig(),
      {
        serverName: 'fixture',
        toolName: 'inspect_service',
        arguments: { name: 'api', namespace: 'prod' }
      },
      operationOptions()
    )

    expect(result).toEqual({
      ok: true,
      data: {
        serverName: 'fixture',
        toolName: 'inspect_service',
        arguments: { name: 'api', namespace: 'prod' },
        content: [{ type: 'text', text: 'service=api;namespace=prod' }],
        isError: false,
        durationMs: expect.any(Number)
      }
    })
  })

  it('reads stdio MCP resources through the backend boundary', async () => {
    await loadBackend()

    const result = await backend.readMcpResource(
      fixtureConfig(),
      {
        serverName: 'fixture',
        uri: 'file:///runbook.md'
      },
      operationOptions()
    )

    expect(result).toEqual({
      ok: true,
      data: {
        serverName: 'fixture',
        uri: 'file:///runbook.md',
        contents: [{ uri: 'file:///runbook.md', mimeType: 'text/markdown', text: '# Runbook\nCheck service health.' }],
        durationMs: expect.any(Number)
      }
    })
  })

  it('calls streamable HTTP MCP tools and reads resources through the backend boundary', async () => {
    await loadBackend()

    await withStreamableHttpFixture(async (url, stats) => {
      const config: McpConfigFile = {
        mcpServers: {
          remote: {
            type: 'streamableHttp',
            url,
            timeout: 1
          }
        }
      }

      await expect(
        backend.callMcpTool(
          config,
          {
            serverName: 'remote',
            toolName: 'inspect_service',
            arguments: { name: 'api', namespace: 'prod' }
          },
          operationOptions()
        )
      ).resolves.toEqual({
        ok: true,
        data: {
          serverName: 'remote',
          toolName: 'inspect_service',
          arguments: { name: 'api', namespace: 'prod' },
          content: [{ type: 'text', text: 'http-service=api;namespace=prod' }],
          isError: false,
          durationMs: expect.any(Number)
        }
      })

      await expect(
        backend.readMcpResource(
          config,
          {
            serverName: 'remote',
            uri: 'https://runbook.local/http.md'
          },
          operationOptions()
        )
      ).resolves.toEqual({
        ok: true,
        data: {
          serverName: 'remote',
          uri: 'https://runbook.local/http.md',
          contents: [{ uri: 'https://runbook.local/http.md', mimeType: 'text/markdown', text: '# HTTP Runbook\nCheck remote service health.' }],
          durationMs: expect.any(Number)
        }
      })

      expect(stats.methods.initialize).toBe(1)
      expect(stats.methods['notifications/initialized']).toBe(1)
      expect(stats.methods['tools/call']).toBe(1)
      expect(stats.methods['resources/read']).toBe(1)
    })
  })

  it('reinitializes cached MCP operation clients after explicit runtime cleanup', async () => {
    await loadBackend()

    await withStreamableHttpFixture(async (url, stats) => {
      const config: McpConfigFile = {
        mcpServers: {
          remote: {
            type: 'streamableHttp',
            url,
            timeout: 1
          }
        }
      }

      await expect(
        backend.callMcpTool(
          config,
          {
            serverName: 'remote',
            toolName: 'inspect_service',
            arguments: { name: 'api' }
          },
          operationOptions()
        )
      ).resolves.toMatchObject({ ok: true })

      expect(stats.methods.initialize).toBe(1)

      await backend.clearMcpRuntimeClientCache()

      await expect(
        backend.readMcpResource(
          config,
          {
            serverName: 'remote',
            uri: 'https://runbook.local/http.md'
          },
          operationOptions()
        )
      ).resolves.toMatchObject({ ok: true })

      expect(stats.methods.initialize).toBe(2)
      expect(stats.methods['resources/read']).toBe(1)
    })
  })

  it('evicts failed cached MCP operation clients before the next operation', async () => {
    await loadBackend()

    await withStreamableHttpFixture(async (url, stats) => {
      const config: McpConfigFile = {
        mcpServers: {
          remote: {
            type: 'streamableHttp',
            url,
            timeout: 1
          }
        }
      }

      await expect(
        backend.callMcpTool(
          config,
          {
            serverName: 'remote',
            toolName: 'missing_tool',
            arguments: { name: 'api' }
          },
          operationOptions()
        )
      ).resolves.toMatchObject({
        ok: false,
        errorCode: 'MCP_TOOL_CALL_FAILED',
        errorMessage: expect.stringContaining('unknown tool')
      })

      await expect(
        backend.callMcpTool(
          config,
          {
            serverName: 'remote',
            toolName: 'inspect_service',
            arguments: { name: 'api' }
          },
          operationOptions()
        )
      ).resolves.toMatchObject({ ok: true })

      expect(stats.methods.initialize).toBe(2)
      expect(stats.methods['tools/call']).toBe(2)
    })
  })

  it('calls legacy SSE MCP tools through the backend boundary', async () => {
    await loadBackend()

    await withLegacySseFixture(async (url) => {
      await expect(
        backend.callMcpTool(
          {
            mcpServers: {
              remote: {
                type: 'sse',
                url,
                timeout: 1
              }
            }
          },
          {
            serverName: 'remote',
            toolName: 'inspect_service',
            arguments: { name: 'api' }
          },
          operationOptions()
        )
      ).resolves.toEqual({
        ok: true,
        data: {
          serverName: 'remote',
          toolName: 'inspect_service',
          arguments: { name: 'api' },
          content: [{ type: 'text', text: 'http-service=api;namespace=default' }],
          isError: false,
          durationMs: expect.any(Number)
        }
      })
    })
  })

  it('fails closed for disabled MCP servers and tools during operations', async () => {
    await loadBackend()

    await expect(
      backend.callMcpTool(
        {
          mcpServers: {
            fixture: {
              type: 'stdio',
              disabled: true,
              command: process.execPath,
              args: ['-e', mcpFixtureScript]
            }
          }
        },
        { serverName: 'fixture', toolName: 'inspect_service', arguments: { name: 'api' } },
        operationOptions()
      )
    ).resolves.toMatchObject({
      ok: false,
      errorCode: 'MCP_TOOL_SERVER_DISABLED'
    })

    await expect(
      backend.callMcpTool(
        fixtureConfig(),
        { serverName: 'fixture', toolName: 'inspect_service', arguments: { name: 'api' } },
        operationOptions({ toolStates: { 'fixture:inspect_service': false } })
      )
    ).resolves.toMatchObject({
      ok: false,
      errorCode: 'MCP_TOOL_DISABLED'
    })
  })

  it('returns structured MCP operation failures instead of throwing IPC errors', async () => {
    await loadBackend()

    await expect(backend.callMcpTool({ mcpServers: {} }, { serverName: 'missing', toolName: 'inspect_service' }, operationOptions())).resolves.toMatchObject({
      ok: false,
      errorCode: 'MCP_TOOL_SERVER_NOT_FOUND'
    })

    await expect(
      backend.readMcpResource(
        {
          mcpServers: {
            remote: {
              type: 'streamableHttp',
              url: 'http://127.0.0.1:65535/mcp'
            }
          }
        },
        { serverName: 'remote', uri: 'file:///runbook.md' },
        operationOptions()
      )
    ).resolves.toMatchObject({
      ok: false,
      errorCode: 'MCP_RESOURCE_READ_FAILED'
    })

    await expect(
      backend.callMcpTool(fixtureConfig(), { serverName: 'fixture', toolName: 'missing_tool' }, operationOptions())
    ).resolves.toMatchObject({
      ok: false,
      errorCode: 'MCP_TOOL_CALL_FAILED',
      errorMessage: expect.stringContaining('unknown tool')
    })
  })
})
