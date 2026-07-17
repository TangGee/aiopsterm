import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const CLASSIC_AGENT_SEARCH_KNOWLEDGE_TOOL = 'search_knowledge_base'
const CLASSIC_AGENT_TODO_READ_TOOL = 'todo_read'
const CLASSIC_AGENT_TODO_WRITE_TOOL = 'todo_write'
const CLASSIC_AGENT_READ_HOST_FILE_TOOL = 'read_host_file'
const CLASSIC_AGENT_SEARCH_HOST_FILES_TOOL = 'search_host_files'
const CLASSIC_AGENT_ACCESS_MCP_RESOURCE_TOOL = 'access_mcp_resource'
const CLASSIC_AGENT_READ_HOST_COMMAND_OUTPUT_TOOL = 'read_host_command_output'

let classicAgentControlledToolDefinitions: any
let createClassicAgentToolRuntime: any

const temporaryDirectories: string[] = []

const tempDirectory = () => {
  const directory = mkdtempSync(join(tmpdir(), 'aiopsterm-classic-tools-'))
  temporaryDirectories.push(directory)
  return directory
}

const target = {
  targetId: 'target-api',
  terminalSessionId: 'terminal-api',
  label: 'API production',
  kind: 'ssh' as const,
  cwd: '/srv/api'
}

const context = (sessionId = 'aiopsterm-classic-conversation-1') => ({
  sessionId,
  hostTargets: new Map([[target.targetId, target]]),
  hostCommandId: 'cline_read_fixed'
})

beforeAll(async () => {
  const modulePath = '../src/main/backend/agent/classicAgentTools'
  ;({
    classicAgentControlledToolDefinitions,
    createClassicAgentToolRuntime
  } = await import(modulePath))
})

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('Classic Agent controlled tools', () => {
  it('exposes bounded analysis tools only and adds host inspection only with a frozen target', () => {
    expect(classicAgentControlledToolDefinitions(false).map((tool: any) => tool.name)).toEqual([
      CLASSIC_AGENT_SEARCH_KNOWLEDGE_TOOL,
      CLASSIC_AGENT_TODO_READ_TOOL,
      CLASSIC_AGENT_TODO_WRITE_TOOL,
      CLASSIC_AGENT_ACCESS_MCP_RESOURCE_TOOL,
      CLASSIC_AGENT_READ_HOST_COMMAND_OUTPUT_TOOL
    ])
    const hostTools = classicAgentControlledToolDefinitions(true)
    expect(hostTools.map((tool: any) => tool.name)).toEqual([
      CLASSIC_AGENT_SEARCH_KNOWLEDGE_TOOL,
      CLASSIC_AGENT_TODO_READ_TOOL,
      CLASSIC_AGENT_TODO_WRITE_TOOL,
      CLASSIC_AGENT_ACCESS_MCP_RESOURCE_TOOL,
      CLASSIC_AGENT_READ_HOST_COMMAND_OUTPUT_TOOL,
      CLASSIC_AGENT_READ_HOST_FILE_TOOL,
      CLASSIC_AGENT_SEARCH_HOST_FILES_TOOL
    ])
    expect(Object.fromEntries(hostTools.map((tool: any) => [tool.name, tool.autoApprove]))).toEqual({
      [CLASSIC_AGENT_SEARCH_KNOWLEDGE_TOOL]: true,
      [CLASSIC_AGENT_TODO_READ_TOOL]: true,
      [CLASSIC_AGENT_TODO_WRITE_TOOL]: true,
      [CLASSIC_AGENT_ACCESS_MCP_RESOURCE_TOOL]: false,
      [CLASSIC_AGENT_READ_HOST_COMMAND_OUTPUT_TOOL]: true,
      [CLASSIC_AGENT_READ_HOST_FILE_TOOL]: false,
      [CLASSIC_AGENT_SEARCH_HOST_FILES_TOOL]: false
    })
    expect(hostTools.map((tool: any) => tool.name)).not.toContain('use_mcp_tool')
    expect(hostTools.map((tool: any) => tool.name)).not.toContain('execute_command')
  })

  it('searches only through the injected knowledge runtime and bounds snippets', async () => {
    const searchKnowledgeBase = vi.fn(async () => [{
      path: 'Runbooks/API.md',
      startLine: 4,
      endLine: 8,
      score: 1.5,
      matchCount: 2,
      snippet: 'x'.repeat(80_000)
    }])
    const runtime = createClassicAgentToolRuntime({
      userDataPath: tempDirectory(),
      searchKnowledgeBase
    })

    const result = await runtime.execute(context(), CLASSIC_AGENT_SEARCH_KNOWLEDGE_TOOL, {
      query: 'api failure',
      maxResults: 3
    }) as any

    expect(searchKnowledgeBase).toHaveBeenCalledWith('api failure', { maxResults: 3, minScore: 0.15 })
    expect(result).toMatchObject({ query: 'api failure', count: 1, untrusted: true, truncated: true })
    expect(Buffer.byteLength(result.matches[0].snippet, 'utf8')).toBeLessThanOrEqual(8192)
    expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThanOrEqual(64 * 1024)
    await expect(runtime.execute(context(), CLASSIC_AGENT_SEARCH_KNOWLEDGE_TOOL, {
      query: 'x'.repeat(513)
    })).rejects.toThrow('query must contain between 2 and 512 characters')
  })

  it('keeps todo state durable and isolated by the internal Cline session', async () => {
    const userDataPath = tempDirectory()
    const runtime = createClassicAgentToolRuntime({ userDataPath })
    const first = context('aiopsterm-classic-first')
    const second = context('aiopsterm-classic-second')

    await runtime.execute(first, CLASSIC_AGENT_TODO_WRITE_TOOL, {
      todos: [{ id: 'inspect', content: 'Inspect logs', status: 'in_progress' }]
    })
    await runtime.execute(second, CLASSIC_AGENT_TODO_WRITE_TOOL, {
      todos: [{ id: 'report', content: 'Write report', status: 'pending' }]
    })

    expect(await runtime.execute(first, CLASSIC_AGENT_TODO_READ_TOOL, {})).toMatchObject({
      todos: [{ id: 'inspect', content: 'Inspect logs', status: 'in_progress' }]
    })
    expect(await runtime.execute(second, CLASSIC_AGENT_TODO_READ_TOOL, {})).toMatchObject({
      todos: [{ id: 'report', content: 'Write report', status: 'pending' }]
    })
    await expect(runtime.execute(first, CLASSIC_AGENT_TODO_READ_TOOL, {
      sessionId: second.sessionId
    })).rejects.toThrow('Unexpected Classic Agent tool input field: sessionId')

    const restored = createClassicAgentToolRuntime({ userDataPath })
    expect(await restored.execute(first, CLASSIC_AGENT_TODO_READ_TOOL, {})).toMatchObject({
      todos: [{ id: 'inspect', content: 'Inspect logs', status: 'in_progress' }]
    })
    const persisted = JSON.parse(readFileSync(runtime.stateFilePath, 'utf8'))
    expect(Object.keys(persisted.sessions)).toEqual(expect.arrayContaining([first.sessionId, second.sessionId]))
  })

  it('reads a host file through the exact frozen terminal mapping and caps output', async () => {
    const callTerminalTool = vi.fn(async () => ({
      ok: true,
      target: { kind: 'ssh' as const, sessionId: target.terminalSessionId },
      data: { content: 'y'.repeat(80_000), outputTruncated: false }
    }))
    const runtime = createClassicAgentToolRuntime({ userDataPath: tempDirectory(), callTerminalTool })

    const result = await runtime.execute(context(), CLASSIC_AGENT_READ_HOST_FILE_TOOL, {
      targetId: target.targetId,
      path: '/var/log/api.log',
      offset: 10,
      limit: 50
    }) as any

    expect(callTerminalTool).toHaveBeenCalledWith('read_file', expect.objectContaining({
      sessionId: target.terminalSessionId,
      commandId: 'cline_read_fixed',
      path: '/var/log/api.log',
      offset: 10,
      limit: 50
    }))
    expect(result).toMatchObject({
      targetId: target.targetId,
      targetLabel: target.label,
      path: '/var/log/api.log',
      truncated: true,
      untrusted: true
    })
    expect(Buffer.byteLength(result.content, 'utf8')).toBeLessThanOrEqual(64 * 1024)
    expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThanOrEqual(64 * 1024)
    expect(JSON.stringify(result)).not.toContain(target.terminalSessionId)

    await expect(runtime.execute(context(), CLASSIC_AGENT_READ_HOST_FILE_TOOL, {
      targetId: target.targetId,
      terminalSessionId: 'terminal-attacker',
      path: '/etc/passwd'
    })).rejects.toThrow('Unexpected Classic Agent tool input field: terminalSessionId')
    expect(callTerminalTool).toHaveBeenCalledTimes(1)
  })

  it('fails closed when a host result does not match the frozen terminal', async () => {
    const callTerminalTool = vi.fn(async () => ({
      ok: true,
      target: { kind: 'ssh' as const, sessionId: 'terminal-other' },
      data: { content: 'unexpected' }
    }))
    const runtime = createClassicAgentToolRuntime({ userDataPath: tempDirectory(), callTerminalTool })

    await expect(runtime.execute(context(), CLASSIC_AGENT_READ_HOST_FILE_TOOL, {
      targetId: target.targetId,
      path: '/etc/hosts'
    })).rejects.toThrow('different terminal session')
  })

  it('maps filename and content searches to fixed read-only bridge operations', async () => {
    const callTerminalTool = vi.fn(async (method: string) => method === 'glob_search'
      ? {
          ok: true,
          target: { kind: 'ssh' as const, sessionId: target.terminalSessionId },
          data: { entries: ['/srv/api/a.log', '/srv/api/b.log'], count: 2 }
        }
      : {
          ok: true,
          target: { kind: 'ssh' as const, sessionId: target.terminalSessionId },
          data: { output: '/srv/api/a.log:2:timeout', count: 1 }
        })
    const runtime = createClassicAgentToolRuntime({ userDataPath: tempDirectory(), callTerminalTool })

    const names = await runtime.execute(context(), CLASSIC_AGENT_SEARCH_HOST_FILES_TOOL, {
      targetId: target.targetId,
      kind: 'name',
      path: '/srv/api',
      pattern: '*.log',
      limit: 20
    }) as any
    expect(names.entries).toEqual(['/srv/api/a.log', '/srv/api/b.log'])
    expect(callTerminalTool).toHaveBeenNthCalledWith(1, 'glob_search', expect.objectContaining({
      sessionId: target.terminalSessionId,
      path: '/srv/api',
      pattern: '*.log',
      limit: 20
    }))

    const contents = await runtime.execute(context(), CLASSIC_AGENT_SEARCH_HOST_FILES_TOOL, {
      targetId: target.targetId,
      kind: 'content',
      path: '/srv/api',
      pattern: 'timeout|deadline',
      include: '*.log',
      caseSensitive: true,
      contextLines: 2,
      limit: 10
    }) as any
    expect(contents).toMatchObject({ content: '/srv/api/a.log:2:timeout', count: 1, untrusted: true })
    expect(callTerminalTool).toHaveBeenNthCalledWith(2, 'grep_search', expect.objectContaining({
      sessionId: target.terminalSessionId,
      pattern: 'timeout|deadline',
      include: '*.log',
      case_sensitive: true,
      context_lines: 2,
      max_matches: 10
    }))

    await expect(runtime.execute(context(), CLASSIC_AGENT_SEARCH_HOST_FILES_TOOL, {
      targetId: target.targetId,
      kind: 'name',
      path: '/srv/api\nrm -rf /',
      pattern: '*'
    })).rejects.toThrow('unsupported control characters')
  })

  it('allows only explicitly discovered MCP resources and omits binary payloads', async () => {
    const readMcpResource = vi.fn(async () => ({
      ok: true as const,
      data: {
        serverName: 'inventory',
        uri: 'inventory://hosts',
        contents: [
          { uri: 'inventory://hosts', mimeType: 'text/plain', text: 'host summary' },
          { uri: 'inventory://hosts/image', mimeType: 'image/png', blob: Buffer.alloc(4096).toString('base64') }
        ],
        durationMs: 4
      }
    }))
    const runtime = createClassicAgentToolRuntime({
      userDataPath: tempDirectory(),
      getMcpServers: () => [{
        name: 'inventory',
        status: 'connected',
        disabled: false,
        tools: [{ name: 'delete_host', description: 'write', enabled: true, parameters: [] }],
        resources: [{ name: 'hosts', description: 'inventory', uri: 'inventory://hosts' }]
      }],
      readMcpResource
    })

    const result = await runtime.execute(context(), CLASSIC_AGENT_ACCESS_MCP_RESOURCE_TOOL, {
      serverName: 'inventory',
      uri: 'inventory://hosts'
    }) as any
    expect(result.contents).toEqual([
      { uri: 'inventory://hosts', mimeType: 'text/plain', text: 'host summary' },
      { uri: 'inventory://hosts/image', mimeType: 'image/png', binary: true, bytes: 4096 }
    ])
    expect(JSON.stringify(result)).not.toContain(Buffer.alloc(32).toString('base64'))

    await expect(runtime.execute(context(), CLASSIC_AGENT_ACCESS_MCP_RESOURCE_TOOL, {
      serverName: 'inventory',
      uri: 'inventory://secrets'
    })).rejects.toThrow('not explicitly listed')
    expect(readMcpResource).toHaveBeenCalledTimes(1)
  })
})
