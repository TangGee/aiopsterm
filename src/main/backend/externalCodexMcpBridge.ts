import { createServer, type Server, type Socket } from 'net'
import { existsSync, rmSync } from 'fs'
import { dirname, join } from 'path'
import { mkdir } from 'fs/promises'
import { randomUUID } from 'crypto'
import type {
  AiopsAssetRecord,
  ExternalCodexMcpConnection,
  ExternalCodexMcpHost,
  ExternalCodexMcpResponse,
  ManagedAiSessionClearInput,
  ManagedAiSessionDecisionKind,
  ManagedAiSessionFocusRequest,
  ManagedAiSessionRecord,
  ManagedAiSessionReplyInput,
  TerminalLifecycleEvent
} from '@shared/preload'
import { clearManagedAiSession, listManagedAiSessions, replyManagedAiSession } from './agentSessions'
import { createSshTerminalSession, resolveSshTerminalTarget, type SshTerminalSession } from './sshTerminal'
import { listAssets } from './assets'

type ExternalCodexMcpRequest = {
  id?: string
  method?: string
  params?: Record<string, unknown>
  token?: string
}

type ExternalConnectionRecord = ExternalCodexMcpConnection & {
  session: SshTerminalSession | null
  output: string
  lifecycle?: TerminalLifecycleEvent
  readyPromise?: Promise<ExternalConnectionRecord>
  resolveReady?: (connection: ExternalConnectionRecord) => void
  rejectReady?: (error: Error) => void
}

type PendingCommand = {
  id: string
  connectionId: string
  startedAt: number
  markerStart: string
  markerEndPrefix: string
  output: string
  resolve: (value: ExternalCodexMcpResponse) => void
  timer: NodeJS.Timeout
}

type ExternalCodexMcpRuntimeConfig = {
  enabled?: boolean
  token?: string
  socketPath?: string
  userDataPath?: string
  focusManagedAiSession?: (request: ManagedAiSessionFocusRequest) => void
}

const connections = new Map<string, ExternalConnectionRecord>()
const pendingCommands = new Map<string, PendingCommand>()

let server: Server | null = null
let socketPath = ''
let runtimeConfig: ExternalCodexMcpRuntimeConfig = {}

const cleanText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const cleanOptionalText = (value: unknown) => {
  const text = cleanText(value)
  return text || undefined
}

const normalizeInteger = (value: unknown, fallback: number, min: number, max: number) => {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return fallback
  return Math.max(min, Math.min(max, Math.floor(numberValue)))
}

const normalizeTimeoutMs = (value: unknown) => {
  const timeout = Number(value)
  if (!Number.isFinite(timeout)) return 30000
  return Math.max(1000, Math.min(180000, Math.round(timeout)))
}

const normalizeConnectTimeoutMs = (value: unknown) => {
  const timeout = Number(value)
  if (!Number.isFinite(timeout)) return 120000
  return Math.max(1000, Math.min(180000, Math.round(timeout)))
}

const ok = <T extends Record<string, unknown>>(data: T, target?: Record<string, unknown>): ExternalCodexMcpResponse<T> => ({
  ok: true,
  data,
  ...(target ? { target } : {})
})

const fail = (errorCode: string, errorMessage: string, data?: Record<string, unknown>, target?: Record<string, unknown>): ExternalCodexMcpResponse => ({
  ok: false,
  errorCode,
  errorMessage,
  ...(data ? { data } : {}),
  ...(target ? { target } : {})
})

const configuredToken = () => cleanText(runtimeConfig.token) || cleanText(process.env.AIOPSTERM_EXTERNAL_CODEX_MCP_TOKEN)

const isEnabled = () => runtimeConfig.enabled === true || process.env.AIOPSTERM_EXTERNAL_CODEX_MCP_ENABLE === '1'

const defaultSocketPath = () => {
  if (process.platform === 'win32') return `\\\\.\\pipe\\aiopsterm-external-codex-${process.pid}`
  const base = cleanText(runtimeConfig.userDataPath) || process.cwd()
  return join(base, 'external-codex-mcp', `aiopsterm-external-codex-${process.pid}.sock`)
}

const bridgeSocketPath = () => cleanText(runtimeConfig.socketPath) || cleanText(process.env.AIOPSTERM_EXTERNAL_CODEX_MCP_SOCKET) || defaultSocketPath()

export const configureExternalCodexMcpBridgeRuntime = (config: ExternalCodexMcpRuntimeConfig = {}) => {
  runtimeConfig = { ...runtimeConfig, ...config }
}

export const getExternalCodexMcpBridgeSocketPath = () => socketPath || bridgeSocketPath()

const authMethodsForAsset = (asset: AiopsAssetRecord) =>
  [
    asset.hasPassword ? 'password' : '',
    asset.hasPrivateKey || asset.keychainId ? 'privateKey' : '',
    asset.auth_type === 'keyBased' ? 'keyBased' : '',
    asset.auth_type === 'password' ? 'password' : ''
  ]
    .filter(Boolean)
    .filter((item, index, source) => source.indexOf(item) === index)

const safeHostFromAsset = (asset: AiopsAssetRecord, jumpHost?: AiopsAssetRecord): ExternalCodexMcpHost => ({
  assetId: asset.id,
  name: asset.name,
  title: asset.title || asset.name || asset.host,
  host: asset.host || asset.ip,
  port: asset.port || 22,
  username: asset.username,
  ...(asset.group_name || asset.group ? { group: asset.group_name || asset.group } : {}),
  tags: Array.isArray(asset.tags) ? [...asset.tags] : [],
  authType: asset.auth_type,
  authMethods: authMethodsForAsset(asset),
  ...(asset.needProxy ? { needProxy: true } : {}),
  ...(asset.proxyName ? { proxyName: asset.proxyName } : {}),
  ...(asset.jumpHostId ? { jumpHostId: asset.jumpHostId } : {}),
  ...(jumpHost ? { jumpHostName: jumpHost.title || jumpHost.name || jumpHost.host } : {}),
  status: asset.status
})

const hostAssets = () => {
  const snapshot = listAssets()
  const byId = new Map(snapshot.assets.map((asset) => [asset.id, asset]))
  return snapshot.assets
    .filter((asset) => !asset.isLocalShell && Boolean(asset.id && (asset.host || asset.ip) && asset.username))
    .map((asset) => safeHostFromAsset(asset, asset.jumpHostId ? byId.get(asset.jumpHostId) : undefined))
}

const listHosts = (params: Record<string, unknown>) => {
  const query = cleanText(params.query).toLowerCase()
  const hosts = hostAssets().filter((host) => {
    if (!query) return true
    return [host.assetId, host.name, host.title, host.host, host.username, host.group || '', ...host.tags].some((value) => value.toLowerCase().includes(query))
  })
  return ok({ hosts, count: hosts.length })
}

const connectionSnapshot = (connection: ExternalConnectionRecord): ExternalCodexMcpConnection => ({
  connectionId: connection.connectionId,
  assetId: connection.assetId,
  owner: 'external_codex',
  visible: false,
  status: connection.status,
  host: connection.host,
  port: connection.port,
  username: connection.username,
  title: connection.title,
  ...(connection.cwd ? { cwd: connection.cwd } : {}),
  createdAt: connection.createdAt,
  lastUsedAt: connection.lastUsedAt,
  ...(connection.errorMessage ? { errorMessage: connection.errorMessage } : {})
})

const targetContextForConnection = (connection: ExternalConnectionRecord) => ({
  connectionId: connection.connectionId,
  assetId: connection.assetId,
  owner: connection.owner,
  visible: connection.visible,
  status: connection.status,
  host: connection.host,
  port: connection.port,
  username: connection.username,
  title: connection.title,
  ...(connection.cwd ? { cwd: connection.cwd } : {})
})

const resolveAssetById = (assetId: string) => listAssets().assets.find((asset) => asset.id === assetId && !asset.isLocalShell) || null

const resolveConnection = (params: Record<string, unknown>) => {
  const connectionId = cleanText(params.connectionId)
  if (connectionId) return connections.get(connectionId) || null
  const assetId = cleanText(params.assetId)
  if (assetId) return [...connections.values()].find((connection) => connection.assetId === assetId && connection.status === 'connected') || null
  return null
}

const listConnections = () => {
  const items = [...connections.values()].map(connectionSnapshot)
  return ok({ connections: items, count: items.length })
}

const remoteBasePattern = (basePath: string, pattern: string) => {
  if (pattern.startsWith('/')) return pattern
  const cleanBase = basePath.replace(/\/+$/g, '') || '.'
  if (cleanBase === '.') return `./${pattern}`
  return `${cleanBase}/${pattern}`
}

const rejectConnectionReady = (connection: ExternalConnectionRecord, error: Error) => {
  connection.rejectReady?.(error)
  connection.resolveReady = undefined
  connection.rejectReady = undefined
}

const resolveConnectionReady = (connection: ExternalConnectionRecord) => {
  connection.resolveReady?.(connection)
  connection.resolveReady = undefined
  connection.rejectReady = undefined
}

const waitForConnectionReady = async (connection: ExternalConnectionRecord, timeoutMs: number) => {
  if (connection.status === 'connected' && connection.session) return connection
  if (connection.status === 'error' || connection.status === 'closed') throw new Error(connection.errorMessage || 'External MCP connection is not available.')
  if (!connection.readyPromise) throw new Error('External MCP connection did not expose a readiness signal.')
  let timer: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      connection.readyPromise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`SSH shell was not ready within ${timeoutMs}ms.`)), timeoutMs)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
  if (connection.status !== 'connected' || !connection.session) throw new Error(connection.errorMessage || 'External MCP connection is not ready.')
  return connection
}

const connectHost = async (params: Record<string, unknown>) => {
  const assetId = cleanText(params.assetId)
  if (!assetId) return fail('ASSET_ID_REQUIRED', 'assetId is required.')
  const connectTimeoutMs = normalizeConnectTimeoutMs(params.timeoutMs)
  const existing = [...connections.values()].find((connection) => connection.assetId === assetId && connection.status !== 'closed' && connection.status !== 'error')
  if (existing) {
    try {
      await waitForConnectionReady(existing, connectTimeoutMs)
      existing.lastUsedAt = Date.now()
      return ok({ connection: connectionSnapshot(existing), reused: true }, targetContextForConnection(existing))
    } catch (error) {
      existing.status = 'error'
      existing.errorMessage = error instanceof Error ? error.message : String(error)
      try {
        existing.session?.kill('error')
      } catch {}
      connections.delete(existing.connectionId)
      return fail('CONNECT_HOST_FAILED', existing.errorMessage, { connection: connectionSnapshot(existing), reused: true }, targetContextForConnection(existing))
    }
  }
  const asset = resolveAssetById(assetId)
  if (!asset) return fail('HOST_NOT_FOUND', `Host asset was not found: ${assetId}`)

  const connectionId = `mcp-${randomUUID()}`
  const target = resolveSshTerminalTarget({ kind: 'ssh', assetId, cols: 100, rows: 30, terminalType: 'xterm-256color' })
  const createdAt = Date.now()
  const record: ExternalConnectionRecord = {
    connectionId,
    assetId,
    owner: 'external_codex',
    visible: false,
    status: 'connecting',
    host: target.host,
    port: target.port,
    username: target.username,
    title: target.title || asset.title || asset.name || target.host,
    cwd: target.username === 'root' ? '/root' : target.username ? `/home/${target.username}` : '~',
    createdAt,
    lastUsedAt: createdAt,
    session: null,
    output: ''
  }
  record.readyPromise = new Promise<ExternalConnectionRecord>((resolve, reject) => {
    record.resolveReady = resolve
    record.rejectReady = reject
  })
  connections.set(connectionId, record)

  const result = createSshTerminalSession(
    connectionId,
    { kind: 'ssh', assetId, cols: 100, rows: 30, terminalType: 'xterm-256color' },
    {
      lifecycle: (event) => {
        record.lifecycle = event
        record.cwd = event.cwd || record.cwd
        if (event.stage === 'shell-ready') {
          record.status = 'connected'
          record.errorMessage = undefined
          resolveConnectionReady(record)
        } else if (event.stage === 'connected') {
          record.status = 'connecting'
        } else if (event.stage === 'error') {
          record.status = 'error'
          record.errorMessage = event.errorMessage || event.message
          rejectConnectionReady(record, new Error(record.errorMessage || 'SSH connection failed.'))
        }
      },
      exit: (event) => {
        record.lifecycle = event
        record.status = event.stage === 'error' ? 'error' : 'closed'
        record.errorMessage = event.errorMessage || event.message
        rejectConnectionReady(record, new Error(record.errorMessage || 'SSH connection closed before shell was ready.'))
      },
      data: (chunk) => appendExternalConnectionData(connectionId, chunk),
      closed: () => {
        record.status = record.status === 'error' ? 'error' : 'closed'
        rejectConnectionReady(record, new Error(record.errorMessage || 'SSH connection closed before shell was ready.'))
      }
    }
  )
  record.session = result.session
  record.cwd = result.cwd || record.cwd
  if (!result.session || result.lifecycle.stage === 'error') {
    record.status = 'error'
    record.errorMessage = result.lifecycle.errorMessage || result.lifecycle.message || 'SSH connection failed.'
    rejectConnectionReady(record, new Error(record.errorMessage))
    return fail('CONNECT_HOST_FAILED', record.errorMessage, { connection: connectionSnapshot(record) }, targetContextForConnection(record))
  }
  if (result.lifecycle.stage === 'shell-ready') {
    record.status = 'connected'
    resolveConnectionReady(record)
  }
  try {
    await waitForConnectionReady(record, connectTimeoutMs)
  } catch (error) {
    record.status = 'error'
    record.errorMessage = error instanceof Error ? error.message : String(error)
    try {
      record.session?.kill('error')
    } catch {}
    connections.delete(connectionId)
    return fail('CONNECT_HOST_FAILED', record.errorMessage, { connection: connectionSnapshot(record) }, targetContextForConnection(record))
  }
  return ok({ connection: connectionSnapshot(record), reused: false }, targetContextForConnection(record))
}

const disconnectHost = (params: Record<string, unknown>) => {
  const connectionId = cleanText(params.connectionId)
  if (!connectionId) return fail('CONNECTION_ID_REQUIRED', 'connectionId is required.')
  if (!connectionId.startsWith('mcp-')) {
    return fail('TERMINAL_OWNED_CONNECTION', 'disconnect_host can only close external MCP-owned connections.')
  }
  const connection = connections.get(connectionId)
  if (!connection) return fail('CONNECTION_NOT_FOUND', `External MCP connection was not found: ${connectionId}`)
  for (const [commandId, pending] of pendingCommands.entries()) {
    if (pending.connectionId !== connectionId) continue
    clearTimeout(pending.timer)
    pendingCommands.delete(commandId)
    pending.resolve(fail('CONNECTION_CLOSED', 'Connection closed before command output completed.', undefined, targetContextForConnection(connection)))
  }
  try {
    connection.session?.kill('manual')
  } catch {}
  connection.status = 'closed'
  connection.lastUsedAt = Date.now()
  connections.delete(connectionId)
  return ok({ connectionId, disconnected: true })
}

const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`

const stripTerminalControl = (value: string) =>
  value
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\r/g, '')

const extractMarkedOutput = (value: string, markerStart: string) => {
  const cleaned = stripTerminalControl(value)
  const lines = cleaned.split('\n')
  let startLineIndex = -1
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() === markerStart) startLineIndex = index
  }
  if (startLineIndex >= 0) return lines.slice(startLineIndex + 1).join('\n')
  const fallbackIndex = cleaned.lastIndexOf(markerStart)
  return fallbackIndex >= 0 ? cleaned.slice(fallbackIndex + markerStart.length) : cleaned
}

const extractCompletedMarkedOutput = (value: string, markerStart: string, markerEndPrefix: string) => {
  const cleaned = stripTerminalControl(value)
  const lines = cleaned.split('\n')
  let endLineIndex = -1
  let exitCode: number | null = null
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (!line.startsWith(markerEndPrefix)) continue
    const rawCode = line.slice(markerEndPrefix.length).trim()
    if (!/^-?\d+$/.test(rawCode)) continue
    endLineIndex = index
    exitCode = Number(rawCode)
    break
  }
  if (endLineIndex < 0) return null
  const beforeEnd = lines.slice(0, endLineIndex).join('\n')
  return {
    output: extractMarkedOutput(beforeEnd, markerStart),
    exitCode
  }
}

const buildWrappedCommand = (command: string, markerStart: string, markerEnd: string) =>
  ['echo ', shellQuote(markerStart), '; ', command, '; __aiopsterm_status=$?; echo ', shellQuote(markerEnd), ':$__aiopsterm_status', '\n'].join('')

export const appendExternalConnectionData = (connectionId: string, chunk: string | Buffer) => {
  const connection = connections.get(connectionId)
  if (!connection) return
  const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || '')
  if (!text) return
  connection.output += text
  for (const [commandId, pending] of pendingCommands.entries()) {
    if (pending.connectionId !== connectionId) continue
    pending.output += text
    const completed = extractCompletedMarkedOutput(pending.output, pending.markerStart, pending.markerEndPrefix)
    if (!completed) continue
    clearTimeout(pending.timer)
    pendingCommands.delete(commandId)
    connection.lastUsedAt = Date.now()
    pending.resolve(
      ok(
        {
          commandId,
          output: completed.output.trim(),
          exitCode: completed.exitCode,
          durationMs: Date.now() - pending.startedAt
        },
        targetContextForConnection(connection)
      )
    )
  }
}

const runCommand = async (params: Record<string, unknown>): Promise<ExternalCodexMcpResponse> => {
  let connection = resolveConnection(params)
  if (!connection && cleanText(params.assetId) && params.autoConnect === true) {
    const connected = await connectHost({ assetId: cleanText(params.assetId), timeoutMs: params.timeoutMs })
    if (!connected.ok) return connected
    connection = resolveConnection({ connectionId: (connected.data as { connection?: ExternalCodexMcpConnection })?.connection?.connectionId })
  }
  if (!connection || connection.status !== 'connected' || !connection.session) {
    return fail('NO_EXTERNAL_CONNECTION', 'No connected external MCP host connection is available. Call connect_host first.')
  }
  const command = cleanText(params.command)
  if (!command) return fail('EMPTY_COMMAND', 'Command must not be empty.', undefined, targetContextForConnection(connection))
  const requestedCommandId = (cleanText(params.commandId) || `aiopsterm-${Date.now()}-${Math.random().toString(16).slice(2)}`).replace(/[^a-zA-Z0-9_-]/g, '_')
  let commandId = requestedCommandId
  for (let index = 2; pendingCommands.has(commandId); index += 1) commandId = `${requestedCommandId}_${index}`
  const markerStart = `__AIOPSTERM_EXT_CODEX_START_${commandId}__`
  const markerEndPrefix = `__AIOPSTERM_EXT_CODEX_END_${commandId}__:`
  const timeoutMs = normalizeTimeoutMs(params.timeoutMs)
  const startedAt = Date.now()
  const wrapped = buildWrappedCommand(command, markerStart, `__AIOPSTERM_EXT_CODEX_END_${commandId}__`)

  return new Promise<ExternalCodexMcpResponse>((resolve) => {
    const timer = setTimeout(() => {
      const pending = pendingCommands.get(commandId)
      pendingCommands.delete(commandId)
      resolve(
        fail(
          'COMMAND_TIMEOUT',
          `Command timed out after ${timeoutMs}ms.`,
          {
            commandId,
            command,
            output: stripTerminalControl(pending?.output || '').trim(),
            exitCode: null,
            durationMs: Date.now() - startedAt
          },
          targetContextForConnection(connection)
        )
      )
    }, timeoutMs)
    pendingCommands.set(commandId, {
      id: commandId,
      connectionId: connection.connectionId,
      startedAt,
      markerStart,
      markerEndPrefix,
      output: '',
      resolve,
      timer
    })
    try {
      connection.session?.write(wrapped)
    } catch (error) {
      clearTimeout(timer)
      pendingCommands.delete(commandId)
      resolve(fail('COMMAND_WRITE_FAILED', error instanceof Error ? error.message : String(error), undefined, targetContextForConnection(connection)))
    }
  }).then((response) => ({
    ...response,
    target: response.target || targetContextForConnection(connection),
    data: response.data ? { ...response.data, commandId, command } : response.data
  }))
}

const outputLines = (output: unknown) =>
  String(output || '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)

const parseGrepMatches = (output: string) =>
  outputLines(output)
    .map((line) => {
      const match = line.match(/^(.+):(\d+):(.*)$/)
      if (!match) return null
      return {
        path: match[1],
        line: Number(match[2]),
        text: match[3]
      }
    })
    .filter((match): match is { path: string; line: number; text: string } => Boolean(match))

const runReadOnlyCommand = async (
  params: Record<string, unknown>,
  command: string,
  transform: (responseData: Record<string, unknown>) => Record<string, unknown>,
  options: { okExitCodes?: number[]; errorCode: string; errorMessage: string }
) => {
  const response = await runCommand({ ...params, command })
  if (!response.ok) return response
  const responseData = response.data || {}
  const exitCode = typeof responseData.exitCode === 'number' ? responseData.exitCode : null
  const okExitCodes = options.okExitCodes || [0]
  if (exitCode !== null && !okExitCodes.includes(exitCode)) {
    return fail(options.errorCode, options.errorMessage, { ...responseData, ...transform(responseData) }, response.target)
  }
  return ok({ ...responseData, ...transform(responseData) }, response.target)
}

const readFile = (params: Record<string, unknown>) => {
  const filePath = cleanText(params.path)
  if (!filePath) return Promise.resolve(fail('FILE_PATH_REQUIRED', 'File path is required.'))
  const offset = normalizeInteger(params.offset, 0, 0, 10_000_000)
  const limit = normalizeInteger(params.limit, 200, 1, 1000)
  const startLine = offset + 1
  const endLine = offset + limit
  const command = `LC_ALL=C sed -n ${shellQuote(`${startLine},${endLine}p`)} ${shellQuote(filePath)}`
  return runReadOnlyCommand(
    params,
    command,
    (data) => ({
      path: filePath,
      offset,
      limit,
      content: String(data.output || '')
    }),
    {
      errorCode: 'READ_FILE_FAILED',
      errorMessage: `Failed to read remote file: ${filePath}`
    }
  )
}

const globSearch = (params: Record<string, unknown>) => {
  const pattern = cleanText(params.pattern)
  if (!pattern) return Promise.resolve(fail('GLOB_PATTERN_REQUIRED', 'Glob pattern is required.'))
  const basePath = cleanText(params.path) || '.'
  const limit = normalizeInteger(params.limit, 200, 1, 2000)
  const sort = cleanText(params.sort) === 'none' ? 'none' : 'path'
  const hasPathPattern = pattern.includes('/') || pattern.includes('*') || pattern.includes('?') || pattern.includes('[')
  const matchExpression = hasPathPattern ? `-path ${shellQuote(remoteBasePattern(basePath, pattern))}` : `-name ${shellQuote(pattern)}`
  const sortPipe = sort === 'none' ? '' : ' | LC_ALL=C sort'
  const command = `test -e ${shellQuote(basePath)} && LC_ALL=C find ${shellQuote(basePath)} ${matchExpression} -print${sortPipe} | head -n ${limit}`
  return runReadOnlyCommand(
    params,
    command,
    (data) => {
      const entries = outputLines(data.output)
      return {
        pattern,
        path: basePath,
        limit,
        sort,
        entries,
        count: entries.length
      }
    },
    {
      errorCode: 'GLOB_SEARCH_FAILED',
      errorMessage: `Failed to search remote files for pattern: ${pattern}`
    }
  )
}

const grepSearch = (params: Record<string, unknown>) => {
  const pattern = cleanText(params.pattern)
  if (!pattern) return Promise.resolve(fail('GREP_PATTERN_REQUIRED', 'Search pattern is required.'))
  const basePath = cleanText(params.path) || '.'
  const include = cleanText(params.include)
  const caseSensitive = params.case_sensitive === true
  const contextLines = normalizeInteger(params.context_lines, 0, 0, 5)
  const maxMatches = normalizeInteger(params.max_matches, 100, 1, 1000)
  const flags = ['-R', '-n', '-I', '-E', '-m', String(maxMatches)]
  if (!caseSensitive) flags.push('-i')
  if (contextLines > 0) flags.push('-C', String(contextLines))
  const includeArg = include ? `${shellQuote(`--include=${include}`)} ` : ''
  const command = `test -e ${shellQuote(basePath)} || exit 2; LC_ALL=C grep ${flags.join(' ')} ${includeArg}-- ${shellQuote(pattern)} ${shellQuote(basePath)}`
  return runReadOnlyCommand(
    params,
    command,
    (data) => {
      const output = String(data.output || '')
      const matches = contextLines === 0 ? parseGrepMatches(output) : []
      return {
        pattern,
        path: basePath,
        ...(include ? { include } : {}),
        caseSensitive,
        contextLines,
        maxMatches,
        output,
        matches,
        count: matches.length || outputLines(output).length
      }
    },
    {
      okExitCodes: [0, 1],
      errorCode: 'GREP_SEARCH_FAILED',
      errorMessage: `Failed to search remote file contents for pattern: ${pattern}`
    }
  )
}

const targetContext = (params: Record<string, unknown>) => {
  const connection = resolveConnection(params)
  if (connection) return ok({ context: targetContextForConnection(connection) }, targetContextForConnection(connection))
  const assetId = cleanText(params.assetId)
  if (!assetId) return fail('TARGET_REQUIRED', 'connectionId or assetId is required.')
  const host = hostAssets().find((item) => item.assetId === assetId)
  if (!host) return fail('HOST_NOT_FOUND', `Host asset was not found: ${assetId}`)
  return ok({ context: { assetId: host.assetId, host: host.host, port: host.port, username: host.username, title: host.title, status: 'disconnected' } })
}

const managedAiSessionSummary = (session: ManagedAiSessionRecord, options: { includeEvents?: boolean; eventLimit?: number } = {}) => {
  const eventLimit = normalizeInteger(options.eventLimit, 5, 1, 50)
  return {
    source: session.source,
    sessionId: session.id,
    title: session.title,
    summary: session.summary,
    state: session.state,
    needsInput: session.state === 'needsInput',
    lastEvent: session.lastEvent,
    actionable: session.actionable === true,
    ...(session.pendingRequestId ? { pendingRequestId: session.pendingRequestId } : {}),
    ...(session.panelId ? { panelId: session.panelId } : {}),
    ...(session.terminalSessionId ? { terminalSessionId: session.terminalSessionId } : {}),
    ...(session.workspaceId ? { workspaceId: session.workspaceId } : {}),
    ...(session.cwd ? { cwd: session.cwd } : {}),
    ...(session.transcriptPath ? { transcriptPath: session.transcriptPath } : {}),
    ...(session.launchCommand ? { launchCommand: session.launchCommand } : {}),
    ...(session.resumeCommand ? { resumeCommand: session.resumeCommand } : {}),
    ...(session.processId ? { processId: session.processId } : {}),
    ...(session.parentProcessId ? { parentProcessId: session.parentProcessId } : {}),
    ...(session.processGroupId ? { processGroupId: session.processGroupId } : {}),
    ...(session.agentLifecycle ? { agentLifecycle: session.agentLifecycle } : {}),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastActivityAt: session.lastActivityAt,
    ...(session.handledAt ? { handledAt: session.handledAt } : {}),
    eventCount: session.events.length,
    decisionCount: session.decisions.length,
    ...(options.includeEvents
      ? {
          events: session.events.slice(-eventLimit).map((event) => ({
            id: event.id,
            source: event.source,
            event: event.event,
            sessionId: event.sessionId,
            title: event.title,
            summary: event.summary,
            receivedAt: event.receivedAt,
            ...(event.requestId ? { requestId: event.requestId } : {}),
            ...(typeof event.actionable === 'boolean' ? { actionable: event.actionable } : {}),
            ...(event.cwd ? { cwd: event.cwd } : {}),
            ...(event.transcriptPath ? { transcriptPath: event.transcriptPath } : {}),
            ...(event.agentLifecycle ? { agentLifecycle: event.agentLifecycle } : {})
          }))
        }
      : {})
  }
}

const listAiSessions = async (params: Record<string, unknown>) => {
  const snapshot = await listManagedAiSessions()
  if (!snapshot.ok || !snapshot.data) return fail(snapshot.errorCode || 'MANAGED_AI_SESSIONS_UNAVAILABLE', snapshot.errorMessage || 'Managed AI sessions are unavailable.')
  const query = cleanText(params.query).toLowerCase()
  const source = cleanOptionalText(params.source)
  const state = cleanOptionalText(params.state)
  const needsInput = params.needsInput === true
  const includeEvents = params.includeEvents === true || params.include_events === true
  const eventLimit = normalizeInteger(params.eventLimit || params.event_limit, 5, 1, 50)
  const limit = normalizeInteger(params.limit, 50, 1, 200)
  const filtered = snapshot.data.sessions.filter((session) => {
    if (source && session.source !== source) return false
    if (state && session.state !== state) return false
    if (needsInput && session.state !== 'needsInput') return false
    if (!query) return true
    return [session.source, session.id, session.title, session.summary, session.cwd || '', session.panelId || '', session.terminalSessionId || ''].some((value) =>
      value.toLowerCase().includes(query)
    )
  })
  return ok({
    sessions: filtered.slice(0, limit).map((session) => managedAiSessionSummary(session, { includeEvents, eventLimit })),
    count: filtered.length,
    total: snapshot.data.sessions.length,
    needsInputCount: snapshot.data.sessions.filter((session) => session.state === 'needsInput').length
  })
}

const resolveManagedAiSession = async (params: Record<string, unknown>) => {
  const sessionId = cleanText(params.sessionId || params.session_id)
  if (!sessionId) return { error: fail('AI_SESSION_ID_REQUIRED', 'sessionId is required.') }
  const source = cleanOptionalText(params.source)
  const snapshot = await listManagedAiSessions()
  if (!snapshot.ok || !snapshot.data) {
    return { error: fail(snapshot.errorCode || 'MANAGED_AI_SESSIONS_UNAVAILABLE', snapshot.errorMessage || 'Managed AI sessions are unavailable.') }
  }
  const matches = snapshot.data.sessions.filter((session) => session.id === sessionId && (!source || session.source === source))
  if (!matches.length) return { error: fail('AI_SESSION_NOT_FOUND', `Managed AI session was not found: ${source ? `${source}:` : ''}${sessionId}`) }
  if (matches.length > 1) return { error: fail('AI_SESSION_SOURCE_REQUIRED', `Multiple managed AI sessions match ${sessionId}; pass source.`) }
  return { session: matches[0] }
}

const focusAiSession = async (params: Record<string, unknown>) => {
  const resolved = await resolveManagedAiSession(params)
  if (resolved.error) return resolved.error
  const session = resolved.session!
  const request: ManagedAiSessionFocusRequest = {
    source: session.source,
    sessionId: session.id,
    ...(session.panelId ? { panelId: session.panelId } : {}),
    ...(session.terminalSessionId ? { terminalSessionId: session.terminalSessionId } : {})
  }
  runtimeConfig.focusManagedAiSession?.(request)
  return ok({
    focusRequested: typeof runtimeConfig.focusManagedAiSession === 'function',
    session: managedAiSessionSummary(session)
  })
}

const replyAiSession = async (params: Record<string, unknown>) => {
  const resolved = await resolveManagedAiSession(params)
  if (resolved.error) return resolved.error
  const session = resolved.session!
  const kind = cleanText(params.kind) as ManagedAiSessionDecisionKind
  const input: ManagedAiSessionReplyInput = {
    source: session.source,
    sessionId: session.id,
    kind,
    ...(cleanOptionalText(params.message) ? { message: cleanOptionalText(params.message) } : {})
  }
  const result = await replyManagedAiSession(input)
  if (!result.ok || !result.data) return fail(result.errorCode || 'AI_SESSION_REPLY_FAILED', result.errorMessage || 'Managed AI session reply failed.')
  return ok({
    session: result.data.session ? managedAiSessionSummary(result.data.session) : managedAiSessionSummary(session),
    count: result.data.snapshot.sessions.length,
    needsInputCount: result.data.snapshot.sessions.filter((item) => item.state === 'needsInput').length
  })
}

const clearAiSession = async (params: Record<string, unknown>) => {
  const resolved = await resolveManagedAiSession(params)
  if (resolved.error) return resolved.error
  const session = resolved.session!
  const input: ManagedAiSessionClearInput = {
    source: session.source,
    sessionId: session.id
  }
  const result = await clearManagedAiSession(input)
  if (!result.ok || !result.data) return fail(result.errorCode || 'AI_SESSION_CLEAR_FAILED', result.errorMessage || 'Managed AI session clear failed.')
  return ok({
    cleared: true,
    session: managedAiSessionSummary(session),
    count: result.data.snapshot.sessions.length,
    needsInputCount: result.data.snapshot.sessions.filter((item) => item.state === 'needsInput').length
  })
}

export const handleExternalCodexMcpBridgeRequest = async (request: ExternalCodexMcpRequest): Promise<ExternalCodexMcpResponse> => {
  const token = configuredToken()
  if (!isEnabled()) return fail('EXTERNAL_CODEX_MCP_DISABLED', 'External Codex MCP is disabled.')
  if (!token) return fail('EXTERNAL_CODEX_MCP_TOKEN_REQUIRED', 'External Codex MCP token is not configured.')
  if (cleanText(request.token) !== token) return fail('EXTERNAL_CODEX_MCP_UNAUTHORIZED', 'External Codex MCP token is invalid.')
  const params = request.params || {}
  if (request.method === 'list_hosts') return listHosts(params)
  if (request.method === 'connect_host') return connectHost(params)
  if (request.method === 'list_connections') return listConnections()
  if (request.method === 'disconnect_host') return disconnectHost(params)
  if (request.method === 'target_context') return targetContext(params)
  if (request.method === 'run_command') return runCommand(params)
  if (request.method === 'read_file') return readFile(params)
  if (request.method === 'glob_search') return globSearch(params)
  if (request.method === 'grep_search') return grepSearch(params)
  if (request.method === 'list_ai_sessions') return listAiSessions(params)
  if (request.method === 'focus_ai_session') return focusAiSession(params)
  if (request.method === 'reply_ai_session') return replyAiSession(params)
  if (request.method === 'clear_ai_session') return clearAiSession(params)
  return fail('UNKNOWN_METHOD', `Unknown external Codex MCP bridge method: ${request.method || ''}`)
}

const writeSocketResponse = (socket: Socket, id: string | undefined, response: ExternalCodexMcpResponse) => {
  socket.write(`${JSON.stringify({ id, ...response })}\n`)
}

export const ensureExternalCodexMcpBridgeServer = async (config: ExternalCodexMcpRuntimeConfig = {}) => {
  configureExternalCodexMcpBridgeRuntime(config)
  if (!isEnabled()) return ''
  if (server && socketPath) return socketPath
  socketPath = bridgeSocketPath()
  if (process.platform !== 'win32') {
    await mkdir(dirname(socketPath), { recursive: true })
    if (existsSync(socketPath)) rmSync(socketPath, { force: true })
  }
  server = createServer((socket) => {
    let buffer = ''
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      for (;;) {
        const newlineIndex = buffer.indexOf('\n')
        if (newlineIndex < 0) return
        const line = buffer.slice(0, newlineIndex).trim()
        buffer = buffer.slice(newlineIndex + 1)
        if (!line) continue
        let request: ExternalCodexMcpRequest
        try {
          request = JSON.parse(line) as ExternalCodexMcpRequest
        } catch (error) {
          writeSocketResponse(socket, undefined, fail('INVALID_JSON', error instanceof Error ? error.message : String(error)))
          continue
        }
        void handleExternalCodexMcpBridgeRequest(request)
          .then((response) => writeSocketResponse(socket, request.id, response))
          .catch((error) => writeSocketResponse(socket, request.id, fail('BRIDGE_REQUEST_FAILED', error instanceof Error ? error.message : String(error))))
      }
    })
  })
  await new Promise<void>((resolve, reject) => {
    const failListen = (error: Error) => {
      server?.off('listening', done)
      reject(error)
    }
    const done = () => {
      server?.off('error', failListen)
      resolve()
    }
    server?.once('error', failListen)
    server?.once('listening', done)
    server?.listen(socketPath)
  })
  return socketPath
}

export const closeExternalCodexMcpBridgeServer = () => {
  for (const pending of pendingCommands.values()) clearTimeout(pending.timer)
  pendingCommands.clear()
  for (const connection of connections.values()) {
    try {
      connection.session?.kill('manual')
    } catch {}
  }
  connections.clear()
  server?.close()
  server = null
  if (socketPath && process.platform !== 'win32' && existsSync(socketPath)) rmSync(socketPath, { force: true })
  socketPath = ''
}

export const __getExternalCodexMcpConnectionCountForTests = () => connections.size
