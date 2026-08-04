import { describe, expect, it } from 'vitest'
import type { McpConfigFile, McpConfigFileServer, McpServerUserConfig } from '../src/shared/contracts/mcp'

type McpRuntimeNormalization = {
  autoApproveSet: (source?: string[]) => Set<string>
  cloneJsonRecord: (value: unknown) => Record<string, unknown> | undefined
  cloneToolsWithAutoApprove: (tools: McpServerUserConfig['tools'] | undefined, autoApprove?: string[]) => McpServerUserConfig['tools']
  mcpOperationClientCacheKey: (
    serverName: string,
    server: McpConfigFileServer,
    options: { clientName?: string; clientVersion?: string; timeoutMs?: number; maxTimeoutMs?: number }
  ) => string
  normalizeHttpHeaders: (server: McpConfigFileServer, extra?: Record<string, string>) => Record<string, string>
  normalizeResourceReadContents: (result: unknown) => Array<Record<string, unknown> & { uri: string }>
  normalizeResources: (result: unknown) => Array<{ name: string; description: string; uri: string }>
  normalizeToolCallContent: (result: unknown) => { content: Array<Record<string, unknown> & { type: string }>; isError: boolean }
  normalizeTools: (
    serverName: string,
    result: unknown,
    existing: McpServerUserConfig | undefined,
    toolStates: Record<string, boolean>,
    autoApproveTools?: Set<string>
  ) => McpServerUserConfig['tools']
  operationClientOptions: (options: { clientName?: string; clientVersion?: string; timeoutMs?: number; maxTimeoutMs?: number }) => {
    clientName?: string
    clientVersion?: string
    timeoutMs?: number
    maxTimeoutMs?: number
  }
  resolveMcpOperationServer: (
    config: McpConfigFile,
    serverName: string,
    disabledCode: string,
    missingCode: string
  ) => { ok: true; name: string; config: McpConfigFileServer } | { ok: false; result: { ok: false; errorCode: string; errorMessage: string } }
  splitCommand: (command: string) => { command: string; args: string[] }
  timeoutForServer: (server: McpConfigFileServer, options: { timeoutMs?: number; maxTimeoutMs?: number }) => number
  toolParameters: (schema: unknown) => McpServerUserConfig['tools'][number]['parameters']
}

const loadNormalization = async () => {
  const modulePath = '../src/main/backend/mcp/mcpRuntimeNormalization'
  return (await import(modulePath)) as unknown as McpRuntimeNormalization
}

const serverConfig = (overrides: Partial<McpConfigFileServer> = {}): McpConfigFileServer => ({
  type: 'stdio',
  command: 'node',
  args: ['server.js'],
  timeout: 2,
  ...overrides
})

describe('mcpRuntimeNormalization', () => {
  it('splits stdio commands with quotes and escapes without touching configured args', async () => {
    const { splitCommand } = await loadNormalization()

    expect(splitCommand('node "/tmp/server file.js" --flag test\\ value')).toEqual({
      command: 'node',
      args: ['/tmp/server file.js', '--flag', 'test value']
    })
    expect(splitCommand("  'custom command' --name=\"ops api\"  ")).toEqual({
      command: 'custom command',
      args: ['--name=ops api']
    })
    expect(splitCommand('D:\\build\\cline-sidecar\\node.exe')).toEqual({
      command: 'D:\\build\\cline-sidecar\\node.exe',
      args: []
    })
    expect(splitCommand('"C:\\Program Files\\nodejs\\node.exe" --version')).toEqual({
      command: 'C:\\Program Files\\nodejs\\node.exe',
      args: ['--version']
    })
    expect(splitCommand('\\\\server\\share\\node.exe')).toEqual({
      command: '\\\\server\\share\\node.exe',
      args: []
    })
    expect(splitCommand('')).toEqual({ command: '', args: [] })
  })

  it('normalizes timeout and operation options with discovery minimum and operation defaults', async () => {
    const { operationClientOptions, timeoutForServer } = await loadNormalization()

    expect(timeoutForServer(serverConfig({ timeout: 5 }), { timeoutMs: 2000, maxTimeoutMs: 3000 })).toBe(3000)
    expect(timeoutForServer(serverConfig({ timeout: 0 }), { timeoutMs: 500, maxTimeoutMs: 500 })).toBe(1000)
    expect(timeoutForServer(serverConfig({ timeout: 1 }), { timeoutMs: 2500 })).toBe(1000)
    expect(operationClientOptions({ clientName: 'ops', clientVersion: '1.2.3' })).toEqual({
      clientName: 'ops',
      clientVersion: '1.2.3',
      timeoutMs: 60000,
      maxTimeoutMs: 120000
    })
  })

  it('builds stable operation cache keys across env/header key order', async () => {
    const { mcpOperationClientCacheKey } = await loadNormalization()

    const first = mcpOperationClientCacheKey(
      'filesystem',
      serverConfig({
        env: { B: '2', A: '1' },
        headers: { 'x-b': '2', 'x-a': '1' }
      }),
      { clientName: 'ops', clientVersion: '1', timeoutMs: 2000, maxTimeoutMs: 3000 }
    )
    const second = mcpOperationClientCacheKey(
      'filesystem',
      serverConfig({
        headers: { 'x-a': '1', 'x-b': '2' },
        env: { A: '1', B: '2' }
      }),
      { maxTimeoutMs: 3000, timeoutMs: 2000, clientVersion: '1', clientName: 'ops' }
    )
    expect(first).toBe(second)
    expect(first).toContain('"protocolVersion":"2024-11-05"')
  })

  it('normalizes headers with request headers taking precedence', async () => {
    const { normalizeHttpHeaders } = await loadNormalization()

    expect(normalizeHttpHeaders(serverConfig({ headers: { accept: 'application/json', authorization: 'Bearer configured' } }), { accept: 'text/event-stream' })).toEqual({
      accept: 'text/event-stream',
      authorization: 'Bearer configured'
    })
  })

  it('derives tool parameters, enable state, and auto approve from discovery payloads', async () => {
    const { autoApproveSet, normalizeTools, toolParameters } = await loadNormalization()

    const existing: McpServerUserConfig = {
      name: 'filesystem',
      status: 'connected',
      disabled: false,
      tools: [
        {
          name: 'read_file',
          description: 'old',
          enabled: false,
          autoApprove: false,
          parameters: []
        }
      ],
      resources: []
    }

    expect(
      toolParameters({
        required: ['path'],
        properties: {
          path: { description: 'File path' },
          format: { title: 'Output format' },
          depth: { type: 'number' }
        }
      })
    ).toEqual([
      { name: 'path', description: 'File path', required: true },
      { name: 'format', description: 'Output format' },
      { name: 'depth', description: 'number' }
    ])

    expect(
      normalizeTools(
        'filesystem',
        {
          tools: [
            { name: ' read_file ', description: 'Read file', inputSchema: { required: ['path'], properties: { path: { description: 'File path' } } } },
            { name: 'write_file', description: 'Write file', inputSchema: { properties: {} } },
            { name: '' },
            'bad'
          ]
        },
        existing,
        { 'filesystem:write_file': false },
        autoApproveSet(['read_file', '', 'missing'])
      )
    ).toEqual([
      {
        name: 'read_file',
        description: 'Read file',
        enabled: false,
        autoApprove: true,
        parameters: [{ name: 'path', description: 'File path', required: true }]
      },
      {
        name: 'write_file',
        description: 'Write file',
        enabled: false,
        autoApprove: false,
        parameters: []
      }
    ])
  })

  it('clones cached tools while overlaying current auto approve entries', async () => {
    const { cloneToolsWithAutoApprove } = await loadNormalization()

    const tools = [
      {
        name: 'read_file',
        description: 'Read',
        enabled: true,
        autoApprove: false,
        parameters: [{ name: 'path', description: 'Path' }]
      }
    ]
    const cloned = cloneToolsWithAutoApprove(tools, ['read_file'])
    expect(cloned).toEqual([{ ...tools[0], autoApprove: true }])
    expect(cloned[0]).not.toBe(tools[0])
    expect(cloned[0].parameters[0]).not.toBe(tools[0].parameters[0])
  })

  it('normalizes resources, tool content, and resource read contents defensively', async () => {
    const { normalizeResourceReadContents, normalizeResources, normalizeToolCallContent } = await loadNormalization()

    expect(
      normalizeResources({
        resources: [
          { name: ' Runbook ', description: ' Ops ', uri: ' file:///runbook.md ' },
          { description: 'No name', uri: 'file:///fallback.md' },
          { name: 'missing-uri' },
          null
        ]
      })
    ).toEqual([
      { name: 'Runbook', description: 'Ops', uri: 'file:///runbook.md' },
      { name: 'file:///fallback.md', description: 'No name', uri: 'file:///fallback.md' }
    ])

    expect(
      normalizeToolCallContent({
        content: [
          { type: ' text ', text: 'ok', extra: true },
          { data: 'abc', mimeType: 'image/png' },
          { type: 1, text: 2 },
          'bad'
        ],
        isError: true
      })
    ).toEqual({
      content: [
        { type: 'text', text: 'ok', extra: true },
        { type: 'unknown', data: 'abc', mimeType: 'image/png' },
        { type: 'unknown', text: 2 }
      ],
      isError: true
    })

    expect(
      normalizeResourceReadContents({
        contents: [
          { uri: ' file:///a.txt ', text: 'A', mimeType: 'text/plain' },
          { uri: 'file:///b.bin', blob: '0102' },
          { text: 'missing uri' }
        ]
      })
    ).toEqual([
      { uri: 'file:///a.txt', text: 'A', mimeType: 'text/plain' },
      { uri: 'file:///b.bin', blob: '0102' }
    ])
  })

  it('clones JSON records and fails closed for unserializable or non-record input', async () => {
    const { cloneJsonRecord } = await loadNormalization()

    expect(cloneJsonRecord({ b: 2, a: { nested: true } })).toEqual({ b: 2, a: { nested: true } })
    expect(cloneJsonRecord(['not-record'])).toBeUndefined()
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(cloneJsonRecord(cyclic)).toBeUndefined()
  })

  it('resolves operation servers with structured failure results', async () => {
    const { resolveMcpOperationServer } = await loadNormalization()

    const config: McpConfigFile = {
      mcpServers: {
        enabled: serverConfig(),
        disabled: serverConfig({ disabled: true })
      }
    }

    expect(resolveMcpOperationServer(config, ' enabled ', 'DISABLED', 'MISSING')).toEqual({
      ok: true,
      name: 'enabled',
      config: config.mcpServers.enabled
    })
    expect(resolveMcpOperationServer(config, '', 'DISABLED', 'MISSING')).toEqual({
      ok: false,
      result: { ok: false, errorCode: 'MCP_SERVER_REQUIRED', errorMessage: 'MCP server name is required.' }
    })
    expect(resolveMcpOperationServer(config, 'missing', 'DISABLED', 'MISSING')).toEqual({
      ok: false,
      result: { ok: false, errorCode: 'MISSING', errorMessage: 'MCP server not found: missing' }
    })
    expect(resolveMcpOperationServer(config, 'disabled', 'DISABLED', 'MISSING')).toEqual({
      ok: false,
      result: { ok: false, errorCode: 'DISABLED', errorMessage: 'MCP server "disabled" is disabled.' }
    })
  })
})
