import { describe, expect, it } from 'vitest'
import type { McpConfigFile, McpResourceReadInput, McpServerUserConfig, McpToolCallInput, McpToolStatesUserConfig } from '@shared/preload'

let backend: {
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
            parameters: [
              { name: 'name', description: 'Service name.', required: true },
              { name: 'namespace', description: 'Namespace.' }
            ]
          },
          {
            name: 'tail_logs',
            description: 'Tail recent service logs.',
            enabled: true,
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
        tools: previous.tools,
        resources: previous.resources
      }
    ])
  })

  it('fails closed for unsupported transports and failed stdio commands', async () => {
    const snapshot = await discover({
      mcpServers: {
        remote: {
          type: 'sse',
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
        error: 'MCP sse transport is not supported by aiopsterm yet.',
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
      errorCode: 'MCP_RESOURCE_TRANSPORT_UNSUPPORTED'
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
