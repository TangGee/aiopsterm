import { access, mkdir, readFile, stat } from 'fs/promises'
import { copyFileSync, existsSync, mkdirSync } from 'fs'
import { execFile as nodeExecFile } from 'child_process'
import { delimiter, dirname, isAbsolute, join } from 'path'
import type {
  ExportMcpBridgeStatus,
  ExportMcpCopyConfigInput,
  ExportMcpCopyConfigKind,
  ExportMcpClientSource,
  ExportMcpClientStatus,
  ExportMcpInstallerOperationInput,
  ExportMcpInstallerOperationResult,
  ExportMcpInstallerSnapshot,
  ExportMcpTokenResetResult
} from '@shared/contracts/exportMcp'
import { executableCandidateNames, type PlatformRuntime } from '../app/platformRuntime'
import { getExternalCodexMcpBridgeRuntimeStatus } from './externalCodexMcpBridge'
import { getEffectiveExportMcpToken, rotateStoredExportMcpToken } from './exportMcpTokenRuntime'

type ExportMcpClientDefinition = {
  source: ExportMcpClientSource
  label: string
  binaryName: string
  configPathFor: (env: NodeJS.ProcessEnv) => string
}

type ExecFileOptions = {
  env?: NodeJS.ProcessEnv
  cwd?: string
  timeout?: number
  windowsHide?: boolean
}

type ExecFileRuntime = (file: string, args: string[], options?: ExecFileOptions) => Promise<{ stdout: string; stderr: string }>

type ExportMcpInstallerRuntimeConfig = {
  getEnv?: () => NodeJS.ProcessEnv
  getHomeDir?: () => string
  getPlatform?: () => PlatformRuntime
  getExportMcpScriptPath?: () => string
  getJsRuntimeExecutable?: () => string
  readFile?: typeof readFile
  mkdir?: typeof mkdir
  access?: typeof access
  stat?: typeof stat
  execFile?: ExecFileRuntime
  getExportMcpToken?: () => string | Promise<string>
  resetExportMcpToken?: () => string | Promise<string>
}

export class ExportMcpInstallerError extends Error {
  constructor(
    public errorCode: string,
    message: string
  ) {
    super(message)
    this.name = 'ExportMcpInstallerError'
  }
}

export const exportMcpServerName = 'aiopsterm_hosts'
const externalMcpScriptName = 'aiopsterm-external-codex-mcp.js'

const runtimeConfig: ExportMcpInstallerRuntimeConfig = {}

export const configureExportMcpInstallerRuntime = (config: ExportMcpInstallerRuntimeConfig = {}) => {
  runtimeConfig.getEnv = config.getEnv
  runtimeConfig.getHomeDir = config.getHomeDir
  runtimeConfig.getPlatform = config.getPlatform
  runtimeConfig.getExportMcpScriptPath = config.getExportMcpScriptPath
  runtimeConfig.getJsRuntimeExecutable = config.getJsRuntimeExecutable
  runtimeConfig.readFile = config.readFile
  runtimeConfig.mkdir = config.mkdir
  runtimeConfig.access = config.access
  runtimeConfig.stat = config.stat
  runtimeConfig.execFile = config.execFile
  runtimeConfig.getExportMcpToken = config.getExportMcpToken
  runtimeConfig.resetExportMcpToken = config.resetExportMcpToken
}

const cleanText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
const getEnv = () => runtimeConfig.getEnv?.() || process.env
const getHomeDir = () => runtimeConfig.getHomeDir?.() || getEnv().HOME || process.env.HOME || process.cwd()
const getPlatform = () => runtimeConfig.getPlatform?.() || process.platform
const getReadFile = () => runtimeConfig.readFile || readFile
const getMkdir = () => runtimeConfig.mkdir || mkdir
const getAccess = () => runtimeConfig.access || access
const getStat = () => runtimeConfig.stat || stat
const getExportMcpToken = async () => cleanText((await runtimeConfig.getExportMcpToken?.()) || getEffectiveExportMcpToken())
const resetConfiguredExportMcpToken = async () => cleanText((await runtimeConfig.resetExportMcpToken?.()) || rotateStoredExportMcpToken())
const getJsRuntimeExecutable = () => cleanText(runtimeConfig.getJsRuntimeExecutable?.()) || cleanText(getEnv().APPIMAGE) || process.execPath
const electronRunAsNodeEnvKey = 'ELECTRON_RUN_AS_NODE'
const electronRunAsNodeEnvValue = '1'
const tomlString = (value: string) => JSON.stringify(value)

const defaultExecFile: ExecFileRuntime = (file, args, options = {}) =>
  new Promise((resolve, reject) => {
    nodeExecFile(file, args, { ...options, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) {
        const wrapped = error as Error & { stdout?: string; stderr?: string }
        wrapped.stdout = typeof stdout === 'string' ? stdout : String(stdout || '')
        wrapped.stderr = typeof stderr === 'string' ? stderr : String(stderr || '')
        reject(wrapped)
        return
      }
      resolve({
        stdout: typeof stdout === 'string' ? stdout : String(stdout || ''),
        stderr: typeof stderr === 'string' ? stderr : String(stderr || '')
      })
    })
  })

const getExecFile = () => runtimeConfig.execFile || defaultExecFile

const resolveHomePath = (value: string) => {
  const path = cleanText(value)
  if (!path) return getHomeDir()
  return isAbsolute(path) ? path : join(getHomeDir(), path)
}

const codexConfigDirFor = (env: NodeJS.ProcessEnv) => resolveHomePath(cleanText(env.CODEX_HOME) || '.codex')

const clientDefinitions: ExportMcpClientDefinition[] = [
  {
    source: 'codex',
    label: 'Codex',
    binaryName: 'codex',
    configPathFor: (env) => join(codexConfigDirFor(env), 'config.toml')
  },
  {
    source: 'claude-code',
    label: 'Claude Code',
    binaryName: 'claude',
    configPathFor: () => join(getHomeDir(), '.claude.json')
  }
]

const definitionFor = (source: ExportMcpClientSource) => clientDefinitions.find((definition) => definition.source === source)

const normalizeSource = (value: unknown): ExportMcpClientSource | null => {
  const raw = cleanText(value).toLowerCase().replace(/_/g, '-')
  if (raw === 'codex') return 'codex'
  if (raw === 'claude' || raw === 'claude-code') return 'claude-code'
  return null
}

const pathExists = async (path: string) => {
  try {
    await getAccess()(path)
    return true
  } catch {
    return false
  }
}

const findBinary = async (binaryName: string, env: NodeJS.ProcessEnv = getEnv()) => {
  const pathValue = cleanText(env.PATH)
  if (!pathValue) return ''
  const names = executableCandidateNames(binaryName, env, getPlatform())
  for (const entry of pathValue.split(delimiter)) {
    const dir = cleanText(entry)
    if (!dir) continue
    for (const name of names) {
      const candidate = join(dir, name)
      try {
        await getAccess()(candidate)
        const metadata = await getStat()(candidate)
        if (metadata.isFile()) return candidate
      } catch {
        // Continue searching PATH.
      }
    }
  }
  return ''
}

export const externalMcpScriptResourcePathFor = (appPath: string, resourcesPath: string) => {
  const candidates = [
    join(resourcesPath, externalMcpScriptName),
    join(resourcesPath, 'resources', externalMcpScriptName),
    join(appPath, 'resources', externalMcpScriptName)
  ]
  return candidates.find((candidate) => existsSync(candidate)) || candidates[0]
}

export const exportMcpScriptPathFor = (appPath: string, resourcesPath: string, userDataPath?: string) => {
  const source = externalMcpScriptResourcePathFor(appPath, resourcesPath)
  const userData = cleanText(userDataPath)
  if (!userData) return source
  const stablePath = join(userData, 'export-mcp', externalMcpScriptName)
  try {
    mkdirSync(dirname(stablePath), { recursive: true })
    copyFileSync(source, stablePath)
    return stablePath
  } catch {
    return source
  }
}

const exportMcpScriptPath = () => cleanText(runtimeConfig.getExportMcpScriptPath?.())

const bridgeStatus = (): ExportMcpBridgeStatus => {
  const status = getExternalCodexMcpBridgeRuntimeStatus()
  return {
    enabled: status.enabled,
    listening: status.listening,
    tokenConfigured: status.tokenConfigured,
    socketPath: status.socketPath,
    serverName: exportMcpServerName
  }
}

const extractTomlTable = (content: string, tableName: string) => {
  const lines = content.split(/\r?\n/)
  const tableHeaderFor = (line: string) => {
    const match = line.match(/^\s*\[([^\]]+)\]\s*(#.*)?$/)
    return match ? match[1].replace(/\s+/g, '') : ''
  }
  const ownsTable = (header: string) => header === tableName || header.startsWith(`${tableName}.`)
  const start = lines.findIndex((line) => ownsTable(tableHeaderFor(line)))
  if (start < 0) return ''
  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    const header = tableHeaderFor(lines[index])
    if (header && !ownsTable(header)) {
      end = index
      break
    }
  }
  return lines.slice(start, end).join('\n')
}

const codexConfigHasExportMcp = async (configPath: string, scriptPath: string, socketPath: string, token: string, runtimePath: string) => {
  if (!(await pathExists(configPath))) return { exists: false, installed: false, conflict: false }
  const raw = String(await getReadFile()(configPath, 'utf-8'))
  const block = extractTomlTable(raw, `mcp_servers.${exportMcpServerName}`)
  if (!block) return { exists: true, installed: false, conflict: false }
  const scriptNamePresent = block.includes(externalMcpScriptName) || Boolean(scriptPath && block.includes(scriptPath))
  const socketPathPresent = !socketPath || block.includes(socketPath)
  const tokenPresent = Boolean(token) && block.includes(token)
  const runtimePathPresent = Boolean(runtimePath) && block.includes(`command = ${tomlString(runtimePath)}`)
  const installed =
    runtimePathPresent &&
    scriptNamePresent &&
    socketPathPresent &&
    block.includes('AIOPSTERM_EXTERNAL_CODEX_MCP_SOCKET') &&
    block.includes('AIOPSTERM_EXTERNAL_CODEX_MCP_TOKEN') &&
    block.includes(electronRunAsNodeEnvKey) &&
    block.includes(electronRunAsNodeEnvValue) &&
    tokenPresent
  return { exists: true, installed, conflict: !installed }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))

const parseJsonObject = (raw: string, path: string) => {
  if (!cleanText(raw)) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!isPlainObject(parsed)) throw new Error('JSON root must be an object.')
    return parsed
  } catch (error) {
    throw new ExportMcpInstallerError('EXPORT_MCP_CONFIG_JSON_INVALID', `${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const claudeConfigHasExportMcp = async (configPath: string, scriptPath: string, socketPath: string, token: string, runtimePath: string) => {
  if (!(await pathExists(configPath))) return { exists: false, installed: false, conflict: false }
  const config = parseJsonObject(String(await getReadFile()(configPath, 'utf-8')), configPath)
  const mcpServers = isPlainObject(config.mcpServers) ? config.mcpServers : {}
  const server = isPlainObject(mcpServers[exportMcpServerName]) ? (mcpServers[exportMcpServerName] as Record<string, unknown>) : null
  if (!server) return { exists: true, installed: false, conflict: false }
  const args = Array.isArray(server.args) ? server.args : []
  const env = isPlainObject(server.env) ? server.env : {}
  const scriptNamePresent = args.some((item) => cleanText(item).includes(externalMcpScriptName) || Boolean(scriptPath && cleanText(item) === scriptPath))
  const installed =
    cleanText(server.type) === 'stdio' &&
    cleanText(server.command) === runtimePath &&
    scriptNamePresent &&
    cleanText(env[electronRunAsNodeEnvKey]) === electronRunAsNodeEnvValue &&
    typeof env.AIOPSTERM_EXTERNAL_CODEX_MCP_SOCKET === 'string' &&
    (!socketPath || cleanText(env.AIOPSTERM_EXTERNAL_CODEX_MCP_SOCKET) === socketPath) &&
    cleanText(env.AIOPSTERM_EXTERNAL_CODEX_MCP_TOKEN) === token
  return { exists: true, installed, conflict: !installed }
}

const statusForDefinition = async (definition: ExportMcpClientDefinition): Promise<ExportMcpClientStatus> => {
  const env = getEnv()
  const configPath = definition.configPathFor(env)
  const scriptPath = exportMcpScriptPath()
  const runtimePath = getJsRuntimeExecutable()
  const bridge = bridgeStatus()
  const token = await getExportMcpToken()
  const status: ExportMcpClientStatus = {
    source: definition.source,
    label: definition.label,
    binaryName: definition.binaryName,
    binaryPath: await findBinary(definition.binaryName, env),
    configPath,
    configExists: await pathExists(configPath),
    installed: false,
    scriptPath,
    runtimePath,
    serverName: exportMcpServerName,
    bridge,
    warnings: []
  }

  if (!status.binaryPath) status.warnings.push(`${definition.binaryName} not found on PATH`)
  if (!scriptPath || !(await pathExists(scriptPath))) status.warnings.push('aiopsterm external MCP helper path is unavailable')
  if (!runtimePath || !(await pathExists(runtimePath))) status.warnings.push('aiopsterm JavaScript runtime path is unavailable')
  if (!bridge.enabled) status.warnings.push('External MCP bridge is disabled; relaunch aiopsterm with AIOPSTERM_EXTERNAL_CODEX_MCP_ENABLE=1')
  if (!bridge.tokenConfigured || !token) status.warnings.push('Export MCP token is not configured')
  if (bridge.enabled && !bridge.listening) status.warnings.push('External MCP bridge is enabled but not listening yet')

  try {
    const probe =
      definition.source === 'codex'
        ? await codexConfigHasExportMcp(configPath, scriptPath, bridge.socketPath, token, runtimePath)
        : await claudeConfigHasExportMcp(configPath, scriptPath, bridge.socketPath, token, runtimePath)
    status.installed = probe.installed
    if (probe.conflict) status.warnings.push(`${exportMcpServerName} exists but does not match the current aiopsterm export MCP settings`)
  } catch (error) {
    status.error = error instanceof Error ? error.message : String(error)
  }

  return status
}

export const listExportMcpInstallers = async (): Promise<ExportMcpInstallerSnapshot> => {
  const bridge = bridgeStatus()
  const clients = await Promise.all(clientDefinitions.map((definition) => statusForDefinition(definition)))
  return { bridge, clients }
}

const runClientCommand = async (binaryPath: string, args: string[], options: { ignoreFailure?: boolean } = {}) => {
  try {
    await getExecFile()(binaryPath, args, {
      env: getEnv(),
      timeout: 30000,
      windowsHide: true
    })
  } catch (error) {
    if (options.ignoreFailure) return
    const details = error as Error & { stderr?: string; stdout?: string }
    const stderr = cleanText(details.stderr)
    const stdout = cleanText(details.stdout)
    throw new ExportMcpInstallerError('EXPORT_MCP_CLIENT_COMMAND_FAILED', stderr || stdout || details.message || 'External MCP client command failed.')
  }
}

const assertInstallReady = async (status: ExportMcpClientStatus, token: string) => {
  if (!status.binaryPath) throw new ExportMcpInstallerError('EXPORT_MCP_CLIENT_MISSING', `${status.label} CLI was not found on PATH.`)
  if (!status.scriptPath || !(await pathExists(status.scriptPath))) {
    throw new ExportMcpInstallerError('EXPORT_MCP_SCRIPT_MISSING', 'aiopsterm external MCP helper path is unavailable.')
  }
  if (!status.runtimePath || !(await pathExists(status.runtimePath))) {
    throw new ExportMcpInstallerError('EXPORT_MCP_RUNTIME_MISSING', 'aiopsterm JavaScript runtime path is unavailable.')
  }
  if (!status.bridge.tokenConfigured || !token) {
    throw new ExportMcpInstallerError('EXPORT_MCP_TOKEN_MISSING', 'Export MCP token is required before installing external MCP clients.')
  }
}

const installDefinition = async (definition: ExportMcpClientDefinition): Promise<ExportMcpInstallerOperationResult> => {
  const status = await statusForDefinition(definition)
  const token = await getExportMcpToken()
  await assertInstallReady(status, token)
  await getMkdir()(dirname(status.configPath), { recursive: true })
  const socketPath = status.bridge.socketPath

  if (definition.source === 'codex') {
    await runClientCommand(status.binaryPath, ['mcp', 'remove', exportMcpServerName], { ignoreFailure: true })
    await runClientCommand(status.binaryPath, [
      'mcp',
      'add',
      exportMcpServerName,
      '--env',
      `AIOPSTERM_EXTERNAL_CODEX_MCP_SOCKET=${socketPath}`,
      '--env',
      `AIOPSTERM_EXTERNAL_CODEX_MCP_TOKEN=${token}`,
      '--env',
      `${electronRunAsNodeEnvKey}=${electronRunAsNodeEnvValue}`,
      '--',
      status.runtimePath,
      status.scriptPath
    ])
  } else {
    await runClientCommand(status.binaryPath, ['mcp', 'remove', '-s', 'user', exportMcpServerName], { ignoreFailure: true })
    await runClientCommand(status.binaryPath, [
      'mcp',
      'add',
      '-s',
      'user',
      exportMcpServerName,
      '-e',
      `AIOPSTERM_EXTERNAL_CODEX_MCP_SOCKET=${socketPath}`,
      '-e',
      `AIOPSTERM_EXTERNAL_CODEX_MCP_TOKEN=${token}`,
      '-e',
      `${electronRunAsNodeEnvKey}=${electronRunAsNodeEnvValue}`,
      '--',
      status.runtimePath,
      status.scriptPath
    ])
  }

  const snapshot = await listExportMcpInstallers()
  return {
    ok: true,
    data: {
      operation: 'install',
      source: definition.source,
      status: snapshot.clients.find((item) => item.source === definition.source)!,
      snapshot
    }
  }
}

const normalizeCopyConfigKind = (value: unknown): ExportMcpCopyConfigKind | null => {
  const raw = cleanText(value).toLowerCase()
  if (raw === 'json') return 'json'
  if (raw === 'command' || raw === 'stdio') return 'command'
  return null
}

const shellQuote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`

export const buildExportMcpManualConfig = async (input: ExportMcpCopyConfigInput): Promise<{ kind: ExportMcpCopyConfigKind; text: string }> => {
  const kind = normalizeCopyConfigKind(input?.kind)
  if (!kind) throw new ExportMcpInstallerError('EXPORT_MCP_COPY_KIND_INVALID', 'Export MCP copy config kind is not supported.')
  const scriptPath = exportMcpScriptPath()
  if (!scriptPath || !(await pathExists(scriptPath))) {
    throw new ExportMcpInstallerError('EXPORT_MCP_SCRIPT_MISSING', 'aiopsterm external MCP helper path is unavailable.')
  }
  const bridge = bridgeStatus()
  const token = await getExportMcpToken()
  const runtimePath = getJsRuntimeExecutable()
  if (!runtimePath || !(await pathExists(runtimePath))) {
    throw new ExportMcpInstallerError('EXPORT_MCP_RUNTIME_MISSING', 'aiopsterm JavaScript runtime path is unavailable.')
  }
  if (!bridge.tokenConfigured || !token) {
    throw new ExportMcpInstallerError('EXPORT_MCP_TOKEN_MISSING', 'Export MCP token is required before copying external MCP config.')
  }
  if (kind === 'json') {
    return {
      kind,
      text: JSON.stringify(
        {
          mcpServers: {
            [exportMcpServerName]: {
              type: 'stdio',
              command: runtimePath,
              args: [scriptPath],
              env: {
                [electronRunAsNodeEnvKey]: electronRunAsNodeEnvValue,
                AIOPSTERM_EXTERNAL_CODEX_MCP_SOCKET: bridge.socketPath,
                AIOPSTERM_EXTERNAL_CODEX_MCP_TOKEN: token
              }
            }
          }
        },
        null,
        2
      )
    }
  }
  return {
    kind,
    text: [
      `${electronRunAsNodeEnvKey}=${shellQuote(electronRunAsNodeEnvValue)}`,
      `AIOPSTERM_EXTERNAL_CODEX_MCP_SOCKET=${shellQuote(bridge.socketPath)}`,
      `AIOPSTERM_EXTERNAL_CODEX_MCP_TOKEN=${shellQuote(token)}`,
      shellQuote(runtimePath),
      shellQuote(scriptPath)
    ].join(' ')
  }
}

const uninstallDefinition = async (definition: ExportMcpClientDefinition): Promise<ExportMcpInstallerOperationResult> => {
  const status = await statusForDefinition(definition)
  if (!status.binaryPath) throw new ExportMcpInstallerError('EXPORT_MCP_CLIENT_MISSING', `${status.label} CLI was not found on PATH.`)
  if (definition.source === 'codex') {
    await runClientCommand(status.binaryPath, ['mcp', 'remove', exportMcpServerName])
  } else {
    await runClientCommand(status.binaryPath, ['mcp', 'remove', '-s', 'user', exportMcpServerName])
  }
  const snapshot = await listExportMcpInstallers()
  return {
    ok: true,
    data: {
      operation: 'uninstall',
      source: definition.source,
      status: snapshot.clients.find((item) => item.source === definition.source)!,
      snapshot
    }
  }
}

const operationErrorResult = (error: unknown): ExportMcpInstallerOperationResult => ({
  ok: false,
  errorCode: error instanceof ExportMcpInstallerError ? error.errorCode : 'EXPORT_MCP_OPERATION_FAILED',
  errorMessage: error instanceof Error ? error.message : String(error || 'Export MCP operation failed.')
})

const resetTokenErrorResult = (error: unknown): ExportMcpTokenResetResult => ({
  ok: false,
  errorCode: error instanceof ExportMcpInstallerError ? error.errorCode : 'EXPORT_MCP_TOKEN_RESET_FAILED',
  errorMessage: error instanceof Error ? error.message : String(error || 'Export MCP token reset failed.')
})

export const installExportMcp = async (input: ExportMcpInstallerOperationInput): Promise<ExportMcpInstallerOperationResult> => {
  try {
    const source = normalizeSource(input?.source)
    if (!source) throw new ExportMcpInstallerError('EXPORT_MCP_SOURCE_INVALID', 'Export MCP client source is not supported.')
    const definition = definitionFor(source)
    if (!definition) throw new ExportMcpInstallerError('EXPORT_MCP_SOURCE_UNSUPPORTED', `Export MCP client source ${source} is not supported.`)
    return await installDefinition(definition)
  } catch (error) {
    return operationErrorResult(error)
  }
}

export const uninstallExportMcp = async (input: ExportMcpInstallerOperationInput): Promise<ExportMcpInstallerOperationResult> => {
  try {
    const source = normalizeSource(input?.source)
    if (!source) throw new ExportMcpInstallerError('EXPORT_MCP_SOURCE_INVALID', 'Export MCP client source is not supported.')
    const definition = definitionFor(source)
    if (!definition) throw new ExportMcpInstallerError('EXPORT_MCP_SOURCE_UNSUPPORTED', `Export MCP client source ${source} is not supported.`)
    return await uninstallDefinition(definition)
  } catch (error) {
    return operationErrorResult(error)
  }
}

export const resetExportMcpToken = async (): Promise<ExportMcpTokenResetResult> => {
  try {
    const token = await resetConfiguredExportMcpToken()
    if (!token) throw new ExportMcpInstallerError('EXPORT_MCP_TOKEN_RESET_FAILED', 'Export MCP token reset did not produce a token.')
    const snapshot = await listExportMcpInstallers()
    return {
      ok: true,
      data: {
        snapshot
      }
    }
  } catch (error) {
    return resetTokenErrorResult(error)
  }
}

export const __testing = {
  clientDefinitions,
  exportMcpServerName,
  extractTomlTable,
  codexConfigHasExportMcp,
  claudeConfigHasExportMcp,
  normalizeCopyConfigKind,
  buildExportMcpManualConfig
}
