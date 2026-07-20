import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExportMcpClientSource, ExportMcpServerId } from '../src/shared/contracts/exportMcp'

type ExportMcpInstallerBackend = {
  configureExportMcpInstallerRuntime: (config?: {
    getHomeDir?: () => string
    getEnv?: () => NodeJS.ProcessEnv
    getExportMcpScriptPath?: () => string
    getJsRuntimeExecutable?: () => string
    getExportMcpToken?: () => string
    resetExportMcpToken?: () => string
    execFile?: (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>
  }) => void
  listExportMcpInstallers: () => Promise<{
    clients: Array<{ source: ExportMcpClientSource; serverId: ExportMcpServerId; installed: boolean; warnings: string[] }>
  }>
  installExportMcp: (input: { source: ExportMcpClientSource; serverId: ExportMcpServerId }) => Promise<{ ok: boolean; errorCode?: string }>
  uninstallExportMcp: (input: { source: ExportMcpClientSource; serverId: ExportMcpServerId }) => Promise<{ ok: boolean; errorCode?: string }>
  resetExportMcpToken: () => Promise<{ ok: boolean }>
  buildExportMcpManualConfig: (input: { kind: 'json' | 'command'; serverId: ExportMcpServerId }) => Promise<{ kind: 'json' | 'command'; text: string }>
}

const bridgeStatusMock = vi.hoisted(() => ({
  enabled: true,
  listening: false,
  tokenConfigured: true,
  socketPath: ''
}))

vi.mock('../src/main/backend/codex/externalCodexMcpBridge', () => ({
  getExternalCodexMcpBridgeRuntimeStatus: () => ({ ...bridgeStatusMock })
}))

const cleanupDirs: string[] = []

const loadBackend = async () => {
  const modulePath = '../src/main/backend/codex/exportMcpInstaller'
  const installer = (await import(modulePath)) as ExportMcpInstallerBackend
  return { installer }
}

const prepareRuntime = async (options: { token?: string; managedToken?: string } = {}) => {
  const { installer } = await loadBackend()
  const home = await mkdtemp(join(tmpdir(), 'aiopsterm-export-mcp-'))
  cleanupDirs.push(home)
  const binDir = join(home, 'bin')
  const codexHome = join(home, '.codex')
  const scriptPath = join(home, 'resources', 'aiopsterm-external-codex-mcp.js')
  const runtimePath = join(home, 'aiopsterm-runtime')
  await mkdir(binDir, { recursive: true })
  await mkdir(codexHome, { recursive: true })
  await mkdir(join(home, 'resources'), { recursive: true })
  await writeFile(join(binDir, 'codex'), '#!/bin/sh\n', 'utf-8')
  await writeFile(join(binDir, 'claude'), '#!/bin/sh\n', 'utf-8')
  await writeFile(scriptPath, 'process.exit(0)\n', 'utf-8')
  await writeFile(runtimePath, '#!/bin/sh\n', 'utf-8')
  const socketPath = join(home, 'aiopsterm-external-codex.sock')
  const token = options.token ?? 'unit-token'
  const managedToken = options.managedToken ?? token
  bridgeStatusMock.enabled = true
  bridgeStatusMock.listening = false
  bridgeStatusMock.tokenConfigured = Boolean(managedToken)
  bridgeStatusMock.socketPath = socketPath
  installer.configureExportMcpInstallerRuntime({
    getHomeDir: () => home,
    getEnv: () => ({
      HOME: home,
      CODEX_HOME: codexHome,
      PATH: binDir,
      AIOPSTERM_EXTERNAL_CODEX_MCP_TOKEN: token
    }),
    getExportMcpScriptPath: () => scriptPath,
    getJsRuntimeExecutable: () => runtimePath,
    getExportMcpToken: () => managedToken,
    resetExportMcpToken: () => 'rotated-token'
  })
  return { installer, home, binDir, codexHome, scriptPath, runtimePath, socketPath, token, managedToken }
}

afterEach(async () => {
  const { installer } = await loadBackend()
  installer.configureExportMcpInstallerRuntime()
  bridgeStatusMock.enabled = true
  bridgeStatusMock.listening = false
  bridgeStatusMock.tokenConfigured = true
  bridgeStatusMock.socketPath = ''
  await Promise.all(cleanupDirs.map((dir) => rm(dir, { recursive: true, force: true })))
  cleanupDirs.length = 0
})

describe('Export MCP installer backend', () => {
  it('detects Codex TOML and Claude JSON aiopsterm export MCP entries', async () => {
    const { installer, home, codexHome, scriptPath, runtimePath, socketPath, token } = await prepareRuntime()
    await writeFile(
      join(codexHome, 'config.toml'),
      `[mcp_servers.aiopsterm_hosts]
command = "${runtimePath}"
args = ["${scriptPath}"]

[mcp_servers.aiopsterm_hosts.env]
ELECTRON_RUN_AS_NODE = "1"
AIOPSTERM_EXTERNAL_CODEX_MCP_SOCKET = "${socketPath}"
AIOPSTERM_EXTERNAL_CODEX_MCP_TOKEN = "${token}"
AIOPSTERM_EXTERNAL_CODEX_MCP_SCOPE = "hosts"
`,
      'utf-8'
    )
    await writeFile(
      join(home, '.claude.json'),
      JSON.stringify(
        {
          mcpServers: {
            aiopsterm_hosts: {
              type: 'stdio',
              command: runtimePath,
              args: [scriptPath],
              env: {
                ELECTRON_RUN_AS_NODE: '1',
                AIOPSTERM_EXTERNAL_CODEX_MCP_SOCKET: socketPath,
                AIOPSTERM_EXTERNAL_CODEX_MCP_TOKEN: token,
                AIOPSTERM_EXTERNAL_CODEX_MCP_SCOPE: 'hosts'
              }
            }
          }
        },
        null,
        2
      ),
      'utf-8'
    )

    const snapshot = await installer.listExportMcpInstallers()

    expect(snapshot.clients).toHaveLength(6)
    expect(snapshot.clients.find((client) => client.source === 'codex' && client.serverId === 'hosts')?.installed).toBe(true)
    expect(snapshot.clients.find((client) => client.source === 'claude-code' && client.serverId === 'hosts')?.installed).toBe(true)
    expect(snapshot.clients.find((client) => client.serverId === 'ai-sessions')?.installed).toBe(false)
  })

  it('marks export MCP entries with stale socket paths as conflicts', async () => {
    const { installer, home, codexHome, scriptPath, runtimePath, token } = await prepareRuntime()
    const staleSocketPath = join(home, 'external-codex-mcp', 'aiopsterm-external-codex-12345.sock')
    await writeFile(
      join(codexHome, 'config.toml'),
      `[mcp_servers.aiopsterm_hosts]
command = "${runtimePath}"
args = ["${scriptPath}"]

[mcp_servers.aiopsterm_hosts.env]
ELECTRON_RUN_AS_NODE = "1"
AIOPSTERM_EXTERNAL_CODEX_MCP_SOCKET = "${staleSocketPath}"
AIOPSTERM_EXTERNAL_CODEX_MCP_TOKEN = "${token}"
AIOPSTERM_EXTERNAL_CODEX_MCP_SCOPE = "hosts"
`,
      'utf-8'
    )
    await writeFile(
      join(home, '.claude.json'),
      JSON.stringify(
        {
          mcpServers: {
            aiopsterm_hosts: {
              type: 'stdio',
              command: runtimePath,
              args: [scriptPath],
              env: {
                ELECTRON_RUN_AS_NODE: '1',
                AIOPSTERM_EXTERNAL_CODEX_MCP_SOCKET: staleSocketPath,
                AIOPSTERM_EXTERNAL_CODEX_MCP_TOKEN: token,
                AIOPSTERM_EXTERNAL_CODEX_MCP_SCOPE: 'hosts'
              }
            }
          }
        },
        null,
        2
      ),
      'utf-8'
    )

    const snapshot = await installer.listExportMcpInstallers()
    const codex = snapshot.clients.find((client) => client.source === 'codex' && client.serverId === 'hosts')!
    const claude = snapshot.clients.find((client) => client.source === 'claude-code' && client.serverId === 'hosts')!

    expect(codex.installed).toBe(false)
    expect(claude.installed).toBe(false)
    expect(codex.warnings).toContain('aiopsterm_hosts exists but does not match the current aiopsterm export MCP settings')
    expect(claude.warnings).toContain('aiopsterm_hosts exists but does not match the current aiopsterm export MCP settings')
  })

  it('installs Codex and Claude Code through their MCP CLI commands', async () => {
    const { installer, home, binDir, codexHome, scriptPath, runtimePath, socketPath, token } = await prepareRuntime()
    const calls: Array<{ file: string; args: string[] }> = []
    installer.configureExportMcpInstallerRuntime({
      getHomeDir: () => home,
      getEnv: () => ({
        HOME: home,
        CODEX_HOME: codexHome,
        PATH: binDir,
        AIOPSTERM_EXTERNAL_CODEX_MCP_TOKEN: token
      }),
      getExportMcpScriptPath: () => scriptPath,
      getJsRuntimeExecutable: () => runtimePath,
      getExportMcpToken: () => token,
      resetExportMcpToken: () => 'rotated-token',
      execFile: async (file, args) => {
        calls.push({ file, args })
        return { stdout: '', stderr: '' }
      }
    })

    await expect(installer.installExportMcp({ source: 'codex', serverId: 'hosts' })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(installer.installExportMcp({ source: 'claude-code', serverId: 'ai-sessions' })).resolves.toEqual(expect.objectContaining({ ok: true }))

    expect(calls.map((call) => call.args)).toEqual([
      ['mcp', 'remove', 'aiopsterm_hosts'],
      [
        'mcp',
        'add',
        'aiopsterm_hosts',
        '--env',
        `AIOPSTERM_EXTERNAL_CODEX_MCP_SOCKET=${socketPath}`,
        '--env',
        `AIOPSTERM_EXTERNAL_CODEX_MCP_TOKEN=${token}`,
        '--env',
        'AIOPSTERM_EXTERNAL_CODEX_MCP_SCOPE=hosts',
        '--env',
        'ELECTRON_RUN_AS_NODE=1',
        '--',
        runtimePath,
        scriptPath
      ],
      ['mcp', 'remove', '-s', 'user', 'aiopsterm_ai_sessions'],
      [
        'mcp',
        'add',
        '-s',
        'user',
        'aiopsterm_ai_sessions',
        '-e',
        `AIOPSTERM_EXTERNAL_CODEX_MCP_SOCKET=${socketPath}`,
        '-e',
        `AIOPSTERM_EXTERNAL_CODEX_MCP_TOKEN=${token}`,
        '-e',
        'AIOPSTERM_EXTERNAL_CODEX_MCP_SCOPE=ai-sessions',
        '-e',
        'ELECTRON_RUN_AS_NODE=1',
        '--',
        runtimePath,
        scriptPath
      ]
    ])
    expect(calls[0].file).toContain('/codex')
    expect(calls[2].file).toContain('/claude')

    await expect(installer.uninstallExportMcp({ source: 'codex', serverId: 'databases' })).resolves.toEqual(expect.objectContaining({ ok: true }))
    expect(calls.at(-1)?.args).toEqual(['mcp', 'remove', 'aiopsterm_databases'])
  })

  it('installs clients with the app-managed token when the environment token is missing', async () => {
    const { installer, home, binDir, codexHome, scriptPath, runtimePath, socketPath } = await prepareRuntime({ token: '', managedToken: 'managed-token' })
    const calls: Array<{ file: string; args: string[] }> = []
    installer.configureExportMcpInstallerRuntime({
      getHomeDir: () => home,
      getEnv: () => ({
        HOME: home,
        CODEX_HOME: codexHome,
        PATH: binDir
      }),
      getExportMcpScriptPath: () => scriptPath,
      getJsRuntimeExecutable: () => runtimePath,
      getExportMcpToken: () => 'managed-token',
      execFile: async (file, args) => {
        calls.push({ file, args })
        return { stdout: '', stderr: '' }
      }
    })

    await expect(installer.installExportMcp({ source: 'codex', serverId: 'databases' })).resolves.toEqual(expect.objectContaining({ ok: true }))
    expect(calls.at(-1)?.args).toContain(`AIOPSTERM_EXTERNAL_CODEX_MCP_SOCKET=${socketPath}`)
    expect(calls.at(-1)?.args).toContain('AIOPSTERM_EXTERNAL_CODEX_MCP_TOKEN=managed-token')
    expect(calls.at(-1)?.args).toContain('AIOPSTERM_EXTERNAL_CODEX_MCP_SCOPE=databases')
  })

  it('copies manual MCP config with the current token and rotates token snapshots', async () => {
    const { installer, managedToken, socketPath, scriptPath, runtimePath } = await prepareRuntime()

    await expect(installer.buildExportMcpManualConfig({ kind: 'json', serverId: 'databases' })).resolves.toEqual(
      expect.objectContaining({
        kind: 'json',
        serverId: 'databases',
        text: expect.stringContaining('"aiopsterm_databases"')
      })
    )
    await expect(installer.buildExportMcpManualConfig({ kind: 'command', serverId: 'ai-sessions' })).resolves.toEqual(
      expect.objectContaining({
        kind: 'command',
        text: expect.stringContaining("AIOPSTERM_EXTERNAL_CODEX_MCP_SCOPE='ai-sessions'")
      })
    )
    await expect(installer.buildExportMcpManualConfig({ kind: 'command', serverId: 'hosts' })).resolves.toEqual(
      expect.objectContaining({
        text: expect.stringContaining(`'${runtimePath}' '${scriptPath}'`)
      })
    )
    await expect(installer.resetExportMcpToken()).resolves.toEqual(expect.objectContaining({ ok: true }))
  })
})
