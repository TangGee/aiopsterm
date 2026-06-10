import { describe, expect, it } from 'vitest'
import type { McpConfigFile, McpServerUserConfig, McpToolStatesUserConfig } from '@shared/preload'

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

describe('mcp runtime backend boundary', () => {
  it('discovers tools and resources from a real stdio MCP server process', async () => {
    const snapshot = await discover({
      mcpServers: {
        fixture: {
          type: 'stdio',
          command: process.execPath,
          args: ['-e', mcpFixtureScript],
          timeout: 1
        }
      }
    })

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
      {
        mcpServers: {
          fixture: {
            type: 'stdio',
            command: process.execPath,
            args: ['-e', mcpFixtureScript],
            timeout: 1
          }
        }
      },
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
})
