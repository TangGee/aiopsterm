import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMain } from 'electron'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { UserConfig } from '../src/shared/preload'
import type { KeywordHighlightUserConfig, SecurityUserConfig } from '../src/shared/contracts/appRuntime'
import type { McpConfigFile } from '../src/shared/contracts/mcp'

type IpcHandler = (event: unknown, ...args: any[]) => unknown

type McpConfigIpcBackend = {
  registerMcpConfigIpc: (ipcMain: IpcMain, input: any) => void
}

const tempDirs: string[] = []

const loadBackend = async () => {
  const modulePath = '../src/main/ipc/mcpConfig'
  return (await import(modulePath)) as McpConfigIpcBackend
}

const createIpcHarness = () => {
  const handlers = new Map<string, IpcHandler>()
  const ipcMain = {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      handlers.set(channel, handler)
    })
  } as unknown as IpcMain
  return { ipcMain, handlers }
}

const createTempDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-mcp-config-ipc-'))
  tempDirs.push(dir)
  return dir
}

const normalizeSecurityConfig = (source?: unknown): SecurityUserConfig => {
  const root = (source && typeof source === 'object' ? source : {}) as Partial<SecurityUserConfig>
  return {
    security: {
      enableCommandSecurity: Boolean(root.security?.enableCommandSecurity),
      enableStrictMode: Boolean(root.security?.enableStrictMode),
      blacklistPatterns: root.security?.blacklistPatterns || [],
      whitelistPatterns: root.security?.whitelistPatterns || [],
      dangerousCommands: root.security?.dangerousCommands || [],
      maxCommandLength: root.security?.maxCommandLength || 2000,
      securityPolicy: {
        blockCritical: Boolean(root.security?.securityPolicy?.blockCritical),
        askForMedium: Boolean(root.security?.securityPolicy?.askForMedium),
        askForHigh: Boolean(root.security?.securityPolicy?.askForHigh),
        askForBlacklist: Boolean(root.security?.securityPolicy?.askForBlacklist)
      }
    }
  }
}

const normalizeKeywordHighlightConfig = (source?: unknown): KeywordHighlightUserConfig => {
  const root = (source && typeof source === 'object' ? source : {}) as Partial<KeywordHighlightUserConfig>
  return {
    'keyword-highlight': {
      enabled: Boolean(root['keyword-highlight']?.enabled),
      applyTo: {
        output: root['keyword-highlight']?.applyTo?.output !== false,
        input: Boolean(root['keyword-highlight']?.applyTo?.input)
      },
      rules: root['keyword-highlight']?.rules || []
    }
  }
}

const normalizeMcpConfigFile = (source?: unknown): McpConfigFile => {
  const root = (source && typeof source === 'object' ? source : {}) as Partial<McpConfigFile>
  return { mcpServers: { ...(root.mcpServers || {}) } }
}

const createRegistrationInput = async () => {
  const dir = await createTempDir()
  const securityPath = join(dir, 'security-config.json')
  const keywordPath = join(dir, 'keyword-highlight-config.json')
  const mcpPath = join(dir, 'mcp.json')
  await mkdir(dir, { recursive: true })
  await writeFile(
    securityPath,
    JSON.stringify({
      security: {
        enableCommandSecurity: true,
        enableStrictMode: false,
        blacklistPatterns: ['rm -rf'],
        whitelistPatterns: [],
        dangerousCommands: [],
        maxCommandLength: 2000,
        securityPolicy: { blockCritical: true, askForMedium: true, askForHigh: true, askForBlacklist: true }
      }
    }),
    'utf-8'
  )
  await writeFile(keywordPath, JSON.stringify({ 'keyword-highlight': { enabled: true, applyTo: { output: true, input: false }, rules: [] } }), 'utf-8')
  await writeFile(
    mcpPath,
    JSON.stringify({
      mcpServers: {
        filesystem: { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'], timeout: 60 }
      }
    }),
    'utf-8'
  )

  return {
    ensureSecurityConfigFile: vi.fn(async () => securityPath),
    ensureKeywordHighlightConfigFile: vi.fn(async () => keywordPath),
    ensureMcpConfigFile: vi.fn(async () => mcpPath),
    removeJsonComments: vi.fn((content: string) => content.replace(/\/\/.*$/gm, '').trim()),
    normalizeSecurityConfig: vi.fn(normalizeSecurityConfig),
    normalizeKeywordHighlightConfig: vi.fn(normalizeKeywordHighlightConfig),
    normalizeMcpConfigFile: vi.fn(normalizeMcpConfigFile),
    saveConfigPatch: vi.fn((patch: Partial<UserConfig>) => patch),
    getMcpServers: vi.fn(() => [{ name: 'filesystem', status: 'connected', disabled: false, tools: [], resources: [] }]),
    applyMcpConfigFileSnapshot: vi.fn(async (mcpConfig: McpConfigFile) => ({
      mcpConfig,
      mcpServers: [{ name: 'filesystem', status: 'connected', disabled: Boolean(mcpConfig.mcpServers.filesystem?.disabled), tools: [], resources: [] }],
      mcpToolStates: {}
    })),
    syncMcpConfigFromContent: vi.fn(async () => undefined),
    setMcpToolState: vi.fn(async () => ({ ok: true, data: { mcpConfig: { mcpServers: {} }, mcpServers: [], mcpToolStates: { 'filesystem:read_file': false } } })),
    setMcpToolAutoApprove: vi.fn(async () => ({ ok: true, data: { mcpConfig: { mcpServers: {} }, mcpServers: [], mcpToolStates: {} } })),
    callMcpTool: vi.fn(async () => ({ ok: true, data: { serverName: 'filesystem', toolName: 'read_file', arguments: {}, content: [], isError: false, durationMs: 3 } })),
    readMcpResource: vi.fn(async () => ({ ok: true, data: { serverName: 'filesystem', uri: 'file:///tmp/a.md', contents: [], durationMs: 2 } })),
    broadcastSecurityConfigChanged: vi.fn(),
    broadcastKeywordHighlightConfigChanged: vi.fn(),
    broadcastMcpConfigChanged: vi.fn(),
    paths: { securityPath, keywordPath, mcpPath }
  }
}

describe('MCP and config IPC registrar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('registers stable security, keyword-highlight, and MCP config channels', async () => {
    const { registerMcpConfigIpc } = await loadBackend()
    const { ipcMain, handlers } = createIpcHarness()

    registerMcpConfigIpc(ipcMain, await createRegistrationInput())

    expect([...handlers.keys()]).toEqual([
      'security-config:path',
      'security-config:read',
      'security-config:write',
      'keyword-highlight-config:path',
      'keyword-highlight-config:read',
      'keyword-highlight-config:write',
      'mcp-config:path',
      'mcp:get-servers',
      'mcp-config:read',
      'mcp-config:write',
      'mcp-config:toggle-server',
      'mcp-config:delete-server',
      'mcp:set-tool-state',
      'mcp:set-tool-auto-approve',
      'mcp:tool-call',
      'mcp:resource-read'
    ])
  })

  it('reads and writes security and keyword-highlight config files through injected config boundaries', async () => {
    const { registerMcpConfigIpc } = await loadBackend()
    const { ipcMain, handlers } = createIpcHarness()
    const input = await createRegistrationInput()

    registerMcpConfigIpc(ipcMain, input)

    await expect(handlers.get('security-config:path')?.({})).resolves.toBe(input.paths.securityPath)
    await expect(handlers.get('security-config:read')?.({})).resolves.toContain('enableCommandSecurity')

    const securityContent = JSON.stringify({ security: { enableCommandSecurity: true, maxCommandLength: 1200 } })
    await expect(handlers.get('security-config:write')?.({}, securityContent)).resolves.toEqual({
      ok: true,
      data: { securityConfig: expect.objectContaining({ security: expect.objectContaining({ enableCommandSecurity: true }) }) }
    })
    expect(await readFile(input.paths.securityPath, 'utf-8')).toBe(securityContent)
    expect(input.saveConfigPatch).toHaveBeenCalledWith({ securityConfig: expect.objectContaining({ security: expect.any(Object) }) })
    expect(input.broadcastSecurityConfigChanged).toHaveBeenCalledWith(securityContent)

    await expect(handlers.get('security-config:write')?.({}, JSON.stringify({ modelName: 'ignored' }))).resolves.toEqual({
      ok: false,
      errorCode: 'SECURITY_CONFIG_INVALID',
      errorMessage: 'Security config content is missing the security root.'
    })

    await expect(handlers.get('keyword-highlight-config:path')?.({})).resolves.toBe(input.paths.keywordPath)
    const keywordContent = JSON.stringify({ 'keyword-highlight': { enabled: true, applyTo: { output: true, input: true }, rules: [] } })
    await expect(handlers.get('keyword-highlight-config:write')?.({}, keywordContent)).resolves.toEqual({
      ok: true,
      data: { keywordHighlight: expect.objectContaining({ 'keyword-highlight': expect.objectContaining({ enabled: true }) }) }
    })
    expect(input.broadcastKeywordHighlightConfigChanged).toHaveBeenCalledWith(keywordContent)
  })

  it('normalizes MCP config writes, toggles and deletes servers, and broadcasts persisted content', async () => {
    const { registerMcpConfigIpc } = await loadBackend()
    const { ipcMain, handlers } = createIpcHarness()
    const input = await createRegistrationInput()

    registerMcpConfigIpc(ipcMain, input)

    await expect(handlers.get('mcp:get-servers')?.({})).resolves.toEqual([{ name: 'filesystem', status: 'connected', disabled: false, tools: [], resources: [] }])
    expect(input.syncMcpConfigFromContent).toHaveBeenCalledWith(expect.stringContaining('filesystem'))

    const writeContent = JSON.stringify({ mcpServers: { filesystem: { type: 'stdio', command: 'node', args: ['server.js'] } } })
    await expect(handlers.get('mcp-config:write')?.({}, writeContent)).resolves.toMatchObject({
      ok: true,
      data: { mcpConfig: { mcpServers: { filesystem: { type: 'stdio', command: 'node', args: ['server.js'] } } } }
    })
    expect(await readFile(input.paths.mcpPath, 'utf-8')).toBe(JSON.stringify({ mcpServers: { filesystem: { type: 'stdio', command: 'node', args: ['server.js'] } } }, null, 2))
    expect(input.broadcastMcpConfigChanged).toHaveBeenLastCalledWith(expect.stringContaining('"filesystem"'))

    await expect(handlers.get('mcp-config:toggle-server')?.({}, 'filesystem', true)).resolves.toMatchObject({
      ok: true,
      data: { mcpConfig: { mcpServers: { filesystem: { disabled: true } } } }
    })

    await expect(handlers.get('mcp-config:delete-server')?.({}, 'filesystem')).resolves.toMatchObject({
      ok: true,
      data: { mcpConfig: { mcpServers: {} } }
    })

    await expect(handlers.get('mcp-config:delete-server')?.({}, 'missing')).resolves.toEqual({
      ok: false,
      errorCode: 'MCP_SERVER_DELETE_FAILED',
      errorMessage: 'MCP server not found: missing'
    })
  })

  it('forwards MCP tool/resource operations and converts thrown runtime failures to config-invalid envelopes', async () => {
    const { registerMcpConfigIpc } = await loadBackend()
    const { ipcMain, handlers } = createIpcHarness()
    const input = await createRegistrationInput()

    registerMcpConfigIpc(ipcMain, input)

    await expect(handlers.get('mcp:set-tool-state')?.({}, 'filesystem', 'read_file', false)).resolves.toMatchObject({ ok: true })
    expect(input.setMcpToolState).toHaveBeenCalledWith('filesystem', 'read_file', false)

    await expect(handlers.get('mcp:set-tool-auto-approve')?.({}, 'filesystem', 'read_file', true)).resolves.toMatchObject({ ok: true })
    expect(input.setMcpToolAutoApprove).toHaveBeenCalledWith('filesystem', 'read_file', true)

    const toolInput = { serverName: 'filesystem', toolName: 'read_file', arguments: { path: '/tmp/a.md' } }
    await expect(handlers.get('mcp:tool-call')?.({}, toolInput)).resolves.toMatchObject({ ok: true, data: { toolName: 'read_file' } })
    expect(input.callMcpTool).toHaveBeenCalledWith(toolInput)

    const resourceInput = { serverName: 'filesystem', uri: 'file:///tmp/a.md' }
    await expect(handlers.get('mcp:resource-read')?.({}, resourceInput)).resolves.toMatchObject({ ok: true, data: { uri: 'file:///tmp/a.md' } })
    expect(input.readMcpResource).toHaveBeenCalledWith(resourceInput)

    input.callMcpTool.mockRejectedValueOnce(new Error('bad mcp file'))
    await expect(handlers.get('mcp:tool-call')?.({}, toolInput)).resolves.toEqual({
      ok: false,
      errorCode: 'MCP_CONFIG_INVALID',
      errorMessage: 'bad mcp file'
    })

    input.readMcpResource.mockRejectedValueOnce(new Error('bad resource config'))
    await expect(handlers.get('mcp:resource-read')?.({}, resourceInput)).resolves.toEqual({
      ok: false,
      errorCode: 'MCP_CONFIG_INVALID',
      errorMessage: 'bad resource config'
    })
  })
})
