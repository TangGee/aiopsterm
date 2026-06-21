import { existsSync } from 'fs'
import { mkdir, readdir, readFile, readlink, writeFile } from 'fs/promises'
import { basename, dirname, join } from 'path'
import type { ControlResponse } from '@shared/contracts/control'

type AgentVaultControlEventInput = {
  name: string
  category: string
  source?: string
  workspaceId?: string
  surfaceId?: string
  payload: Record<string, unknown>
}

type AgentVaultRuntime = {
  userDataPath?: string
  dispatchRendererControlRequest?: (method: string, params: Record<string, unknown>) => Promise<ControlResponse> | ControlResponse
  publishControlEvent?: (input: AgentVaultControlEventInput) => void
}

let agentVaultRuntime: AgentVaultRuntime = {}

export const configureAgentVaultRuntime = (runtime: AgentVaultRuntime = {}) => {
  agentVaultRuntime = { ...agentVaultRuntime, ...runtime }
  if (runtime.userDataPath) {
    const nextPath = agentVaultPathFor(runtime.userDataPath)
    if (agentVaultLoadedPath && agentVaultLoadedPath !== nextPath) agentVaultLoadedPath = ''
    agentVaultStorePath = nextPath
  }
}

export const resetAgentVaultRuntimeState = () => {
  agentVaultEntries = new Map()
  agentVaultLoadedPath = ''
  agentVaultStorePath = ''
  agentVaultWriteQueue = Promise.resolve()
}

const maxAgentVaultEntries = 200
const maxAgentVaultCommandLength = 2000
const maxAgentVaultScanTerminals = 20
const maxAgentVaultScanProcessesPerTerminal = 512
let agentVaultStorePath = ''
let agentVaultLoadedPath = ''
let agentVaultEntries = new Map<string, AgentVaultEntry>()
let agentVaultWriteQueue: Promise<void> = Promise.resolve()

const cleanControlText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
const controlOk = (data: Record<string, unknown> = {}): ControlResponse => ({ ok: true, data })
const controlFail = (errorCode: string, errorMessage: string, data?: Record<string, unknown>): ControlResponse => ({
  ok: false,
  errorCode,
  errorMessage,
  ...(data ? { data } : {})
})

export const agentVaultPathFor = (userDataPath: string) => join(userDataPath, 'control', 'agent-vault.json')

export type AgentVaultEntry = {
  id: string
  name: string
  builtIn?: boolean
  description?: string
  executable?: string
  detect?: AgentVaultDetectRule
  sessionIdSource?: AgentVaultSessionIdSource
  launchCommand?: string
  resumeCommand?: string
  forkCommand?: string
  sessionDirectory?: string
  cwd?: 'preserve' | 'ignore'
  icon?: string
  createdAt: number
  updatedAt: number
}

type AgentVaultDetectRule = {
  processName?: string
  argvContains?: string[]
  executableContains?: string
  commandContains?: string[]
}

type AgentVaultSessionIdSource =
  | { type: 'provided' }
  | { type: 'argvOption'; argvOption: string }
  | { type: 'env'; envVar: string }
  | { type: 'fixed'; value: string }
  | { type: 'piSessionFile' }

type AgentVaultProcessSnapshot = {
  pid?: number
  ppid?: number
  pgid?: number
  processName?: string
  executable?: string
  argv: string[]
  commandLine?: string
  cwd?: string
  env?: Record<string, string>
  sessionId?: string
  sessionPath?: string
}

type AgentVaultScanTarget = {
  panelId: string
  sessionId?: string
  title: string
  cwd?: string
  processId: number
  processGroupId?: number
  shell?: string
}


export const normalizeAgentVaultId = (value: unknown) => cleanControlText(value).toLowerCase()

const isValidAgentVaultId = (value: string) => /^[a-z0-9][a-z0-9._-]{0,63}$/.test(value)

export const cleanAgentVaultCommand = (value: unknown) => {
  const text = cleanControlText(value)
  return text && text.length <= maxAgentVaultCommandLength ? text : ''
}

const cleanAgentVaultTextList = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(cleanControlText).filter(Boolean).slice(0, 20)
  const text = cleanControlText(value)
  if (!text) return []
  return text
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20)
}

const nestedRecord = (value: unknown) => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null)

const normalizeAgentVaultDetectRule = (value: unknown, existing?: AgentVaultDetectRule): AgentVaultDetectRule | undefined => {
  const record = nestedRecord(value)
  const processName = cleanControlText(record?.processName || record?.process_name || record?.name || existing?.processName)
  const executableContains = cleanControlText(record?.executableContains || record?.executable_contains || existing?.executableContains)
  const argvContains = cleanAgentVaultTextList(record?.argvContains || record?.argv_contains)
  const commandContains = cleanAgentVaultTextList(record?.commandContains || record?.command_contains)
  const mergedArgvContains = argvContains.length ? argvContains : existing?.argvContains || []
  const mergedCommandContains = commandContains.length ? commandContains : existing?.commandContains || []
  const rule: AgentVaultDetectRule = {
    ...(processName ? { processName } : {}),
    ...(mergedArgvContains.length ? { argvContains: mergedArgvContains } : {}),
    ...(executableContains ? { executableContains } : {}),
    ...(mergedCommandContains.length ? { commandContains: mergedCommandContains } : {})
  }
  return Object.keys(rule).length ? rule : undefined
}

const normalizeAgentVaultSessionIdSource = (value: unknown, existing?: AgentVaultSessionIdSource): AgentVaultSessionIdSource | undefined => {
  const record = nestedRecord(value)
  const rawType = cleanControlText(record?.type || value || existing?.type)
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
  if (!rawType) return existing
  if (rawType === 'provided') return { type: 'provided' }
  if (rawType === 'argvoption' || rawType === 'argv') {
    const argvOption = cleanControlText(record?.argvOption || record?.argv_option || record?.option || (existing?.type === 'argvOption' ? existing.argvOption : ''))
    return argvOption ? { type: 'argvOption', argvOption } : existing
  }
  if (rawType === 'env' || rawType === 'environment') {
    const envVar = cleanControlText(record?.envVar || record?.env_var || record?.name || (existing?.type === 'env' ? existing.envVar : ''))
    return envVar ? { type: 'env', envVar } : existing
  }
  if (rawType === 'fixed' || rawType === 'constant') {
    const fixed = cleanControlText(record?.value || record?.sessionId || record?.session_id || (existing?.type === 'fixed' ? existing.value : ''))
    return fixed ? { type: 'fixed', value: fixed } : existing
  }
  if (rawType === 'pisessionfile') return { type: 'piSessionFile' }
  return existing
}

const normalizeAgentVaultCwdMode = (value: unknown, existing?: AgentVaultEntry['cwd']) => {
  const text = cleanControlText(value).toLowerCase()
  if (text === 'preserve' || text === 'keep') return 'preserve'
  if (text === 'ignore' || text === 'none') return 'ignore'
  return existing
}

const cloneAgentVaultEntry = (entry: AgentVaultEntry): AgentVaultEntry => JSON.parse(JSON.stringify(entry)) as AgentVaultEntry

export const sortedAgentVaultEntries = () => [...agentVaultEntries.values()].sort((left, right) => left.id.localeCompare(right.id)).map(cloneAgentVaultEntry)

const agentVaultPayload = (agent?: AgentVaultEntry | null) => ({
  agents: sortedAgentVaultEntries(),
  count: agentVaultEntries.size,
  ...(agent ? { agent: cloneAgentVaultEntry(agent) } : {})
})

const normalizeAgentVaultEntry = (value: unknown, existing?: AgentVaultEntry): AgentVaultEntry | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const id = normalizeAgentVaultId(record.id || existing?.id)
  if (!id || !isValidAgentVaultId(id)) return null
  const name = cleanControlText(record.name) || existing?.name || id
  const launchCommand = cleanAgentVaultCommand(record.launchCommand || record.launch_command || record.launch || record.command) || existing?.launchCommand
  const resumeCommand = cleanAgentVaultCommand(record.resumeCommand || record.resume_command || record.resume) || existing?.resumeCommand
  const forkCommand = cleanAgentVaultCommand(record.forkCommand || record.fork_command || record.fork) || existing?.forkCommand
  const flatDetect = {
    processName: record.processName || record.process_name,
    argvContains: record.argvContains || record.argv_contains,
    executableContains: record.executableContains || record.executable_contains,
    commandContains: record.commandContains || record.command_contains
  }
  const detect = normalizeAgentVaultDetectRule(record.detect || flatDetect, existing?.detect)
  const flatSessionSource = record.sessionIdSource || record.session_id_source
    ? record.sessionIdSource || record.session_id_source
    : record.argvOption || record.argv_option
      ? { type: 'argvOption', argvOption: record.argvOption || record.argv_option }
      : record.envVar || record.env_var
        ? { type: 'env', envVar: record.envVar || record.env_var }
        : undefined
  const sessionIdSource = normalizeAgentVaultSessionIdSource(flatSessionSource, existing?.sessionIdSource)
  const cwd = normalizeAgentVaultCwdMode(record.cwd || record.cwdMode || record.cwd_mode, existing?.cwd)
  if (!launchCommand && !resumeCommand && !forkCommand) return null
  const now = Date.now()
  return {
    id,
    name,
    ...(cleanControlText(record.description) || existing?.description ? { description: cleanControlText(record.description) || existing?.description } : {}),
    ...(cleanControlText(record.executable) || existing?.executable ? { executable: cleanControlText(record.executable) || existing?.executable } : {}),
    ...(detect ? { detect } : {}),
    ...(sessionIdSource ? { sessionIdSource } : {}),
    ...(launchCommand ? { launchCommand } : {}),
    ...(resumeCommand ? { resumeCommand } : {}),
    ...(forkCommand ? { forkCommand } : {}),
    ...(cleanControlText(record.sessionDirectory || record.session_directory || record.sessionDir) || existing?.sessionDirectory
      ? { sessionDirectory: cleanControlText(record.sessionDirectory || record.session_directory || record.sessionDir) || existing?.sessionDirectory }
      : {}),
    ...(cwd ? { cwd } : {}),
    ...(cleanControlText(record.icon || record.iconAssetName) || existing?.icon ? { icon: cleanControlText(record.icon || record.iconAssetName) || existing?.icon } : {}),
    createdAt: existing?.createdAt || now,
    updatedAt: now
  }
}

const defaultAgentVaultEntries = (): AgentVaultEntry[] => {
  const now = Date.now()
  return [
    {
      id: 'omp',
      name: 'OMP',
      builtIn: true,
      executable: 'omp',
      detect: { processName: 'omp' },
      sessionIdSource: { type: 'piSessionFile' },
      resumeCommand: '{{executable}} --session {{sessionId}}',
      forkCommand: '{{executable}} --session {{sessionId}} --fork',
      sessionDirectory: '~/.omp/agent/sessions',
      cwd: 'preserve',
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'pi',
      name: 'Pi',
      builtIn: true,
      executable: 'pi',
      detect: { processName: 'pi', argvContains: ['pi'] },
      sessionIdSource: { type: 'piSessionFile' },
      resumeCommand: '{{executable}} --session {{sessionId}}',
      forkCommand: '{{executable}} --session {{sessionId}} --fork',
      sessionDirectory: '~/.pi/agent/sessions',
      cwd: 'preserve',
      createdAt: now,
      updatedAt: now
    }
  ]
}

const seedDefaultAgentVaultEntries = () => {
  for (const entry of defaultAgentVaultEntries()) {
    if (!agentVaultEntries.has(entry.id)) agentVaultEntries.set(entry.id, entry)
  }
}

export const loadAgentVaultStore = async (userDataPath?: string) => {
  if (userDataPath) agentVaultStorePath = agentVaultPathFor(userDataPath)
  if (!agentVaultStorePath || agentVaultLoadedPath === agentVaultStorePath) return
  agentVaultEntries = new Map()
  seedDefaultAgentVaultEntries()
  agentVaultLoadedPath = agentVaultStorePath
  if (!existsSync(agentVaultStorePath)) return
  try {
    const raw = await readFile(agentVaultStorePath, 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    const items = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).agents) ? ((parsed as Record<string, unknown>).agents as unknown[]) : []
    for (const item of items.slice(0, maxAgentVaultEntries)) {
      const entry = normalizeAgentVaultEntry(item)
      if (entry) agentVaultEntries.set(entry.id, entry)
    }
  } catch {
    agentVaultEntries = new Map()
    seedDefaultAgentVaultEntries()
  }
}

const persistAgentVaultStore = async () => {
  if (!agentVaultStorePath) return
  const payload = {
    version: 1,
    agents: sortedAgentVaultEntries().filter((entry) => entry.builtIn !== true)
  }
  agentVaultWriteQueue = agentVaultWriteQueue
    .catch(() => undefined)
    .then(async () => {
      await mkdir(dirname(agentVaultStorePath), { recursive: true })
      await writeFile(agentVaultStorePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8')
    })
  await agentVaultWriteQueue
}

export const agentVaultEntryFor = (value: unknown) => {
  const id = normalizeAgentVaultId(value)
  return id ? agentVaultEntries.get(id) || null : null
}

export const renderAgentVaultTemplate = (entry: AgentVaultEntry, template: string, params: Record<string, unknown>, options: { preserveDynamic?: boolean } = {}) => {
  const dynamic = new Set(['index', 'count', 'cwd', 'prompt', 'role', 'model'])
  const values: Record<string, string> = {
    agentId: entry.id,
    agentName: entry.name,
    executable: cleanControlText(params.executable) || entry.executable || entry.id,
    cwd: cleanControlText(params.cwd),
    prompt: cleanControlText(params.prompt || params.message || params.instruction),
    role: cleanControlText(params.role || params.agentRole),
    model: cleanControlText(params.model),
    index: cleanControlText(params.index) || '1',
    count: cleanControlText(params.count) || cleanControlText(params.n) || '1',
    sessionId: cleanControlText(params.sessionId || params.session_id),
    sessionPath: cleanControlText(params.sessionPath || params.session_path),
    sessionDir: cleanControlText(params.sessionDir || params.sessionDirectory || params.session_directory) || entry.sessionDirectory || ''
  }
  return template.replace(/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g, (match, key: string) => {
    if (options.preserveDynamic && dynamic.has(key)) return match
    return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match
  })
}

const cleanPositiveInteger = (value: unknown) => {
  const numberValue = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(numberValue)) return undefined
  const normalized = Math.floor(numberValue)
  return normalized > 0 ? normalized : undefined
}

const splitCommandLine = (value: string) => {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | '' = ''
  let escaped = false
  for (const char of value.trim()) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\' && quote !== "'") {
      escaped = true
      continue
    }
    if ((char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote ? '' : char
      continue
    }
    if (!quote && /\s/.test(char)) {
      if (current) tokens.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (current) tokens.push(current)
  return tokens
}

const normalizeAgentVaultProcessSnapshot = (value: unknown): AgentVaultProcessSnapshot | null => {
  const record = nestedRecord(value)
  if (!record) return null
  const commandLine = cleanControlText(record.commandLine || record.command_line || record.command)
  const argv = Array.isArray(record.argv)
    ? record.argv.map(cleanControlText).filter(Boolean).slice(0, 200)
    : Array.isArray(record.args)
      ? record.args.map(cleanControlText).filter(Boolean).slice(0, 200)
      : commandLine
        ? splitCommandLine(commandLine).slice(0, 200)
        : []
  const envRecord = nestedRecord(record.env || record.environment)
  const env = envRecord
    ? Object.fromEntries(
        Object.entries(envRecord)
          .map(([key, val]) => [cleanControlText(key), cleanControlText(val)] as const)
          .filter(([key, val]) => key && val)
          .slice(0, 200)
      )
    : undefined
  const executable = cleanControlText(record.executable || record.exe || record.path || argv[0])
  const processName = cleanControlText(record.processName || record.process_name || record.name || (executable ? basename(executable) : ''))
  return {
    ...(cleanPositiveInteger(record.pid || record.processId || record.process_id) ? { pid: cleanPositiveInteger(record.pid || record.processId || record.process_id) } : {}),
    ...(cleanPositiveInteger(record.ppid || record.parentProcessId || record.parent_process_id) ? { ppid: cleanPositiveInteger(record.ppid || record.parentProcessId || record.parent_process_id) } : {}),
    ...(cleanPositiveInteger(record.pgid || record.processGroupId || record.process_group_id) ? { pgid: cleanPositiveInteger(record.pgid || record.processGroupId || record.process_group_id) } : {}),
    ...(processName ? { processName } : {}),
    ...(executable ? { executable } : {}),
    argv,
    ...(commandLine ? { commandLine } : argv.length ? { commandLine: argv.join(' ') } : {}),
    ...(cleanControlText(record.cwd || record.workingDirectory || record.working_directory) ? { cwd: cleanControlText(record.cwd || record.workingDirectory || record.working_directory) } : {}),
    ...(env ? { env } : {}),
    ...(cleanControlText(record.sessionId || record.session_id) ? { sessionId: cleanControlText(record.sessionId || record.session_id) } : {}),
    ...(cleanControlText(record.sessionPath || record.session_path) ? { sessionPath: cleanControlText(record.sessionPath || record.session_path) } : {})
  }
}

const normalizedProcessName = (value?: string) => basename(cleanControlText(value)).toLowerCase()

const agentVaultProcessNameMatches = (candidate: string, expected: string) => {
  const left = normalizedProcessName(candidate)
  const right = normalizedProcessName(expected)
  return Boolean(left && right && (left === right || left.replace(/\.(exe|cmd|bat)$/i, '') === right.replace(/\.(exe|cmd|bat)$/i, '')))
}

const agentVaultEntryMatchesProcess = (entry: AgentVaultEntry, process: AgentVaultProcessSnapshot) => {
  const detect = entry.detect
  const argvText = process.argv.join('\n').toLowerCase()
  const commandText = cleanControlText(process.commandLine || process.argv.join(' ')).toLowerCase()
  const executableText = cleanControlText(process.executable).toLowerCase()
  if (detect) {
    if (detect.processName && !agentVaultProcessNameMatches(process.processName || process.executable || process.argv[0] || '', detect.processName)) return false
    if (detect.executableContains && !executableText.includes(detect.executableContains.toLowerCase())) return false
    if (detect.argvContains?.some((needle) => !argvText.includes(needle.toLowerCase()))) return false
    if (detect.commandContains?.some((needle) => !commandText.includes(needle.toLowerCase()))) return false
    return true
  }
  const fallbackNames = [entry.executable, entry.id].map(cleanControlText).filter(Boolean)
  return fallbackNames.some((name) => agentVaultProcessNameMatches(process.processName || process.executable || process.argv[0] || '', name))
}

const sessionIdFromArgvOption = (argv: string[], option: string) => {
  const optionText = cleanControlText(option)
  if (!optionText) return undefined
  const prefix = `${optionText}=`
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === optionText) return cleanControlText(argv[index + 1])
    if (arg.startsWith(prefix)) return cleanControlText(arg.slice(prefix.length))
  }
  return undefined
}

const agentVaultSessionIdFromProcess = (entry: AgentVaultEntry, process: AgentVaultProcessSnapshot, params: Record<string, unknown>) => {
  const explicit = cleanControlText(params.sessionId || params.session_id || process.sessionId)
  const source = entry.sessionIdSource || (explicit ? { type: 'provided' as const } : undefined)
  if (!source) return explicit
  if (source.type === 'provided') return explicit
  if (source.type === 'fixed') return source.value
  if (source.type === 'env') return cleanControlText(process.env?.[source.envVar])
  if (source.type === 'argvOption') return sessionIdFromArgvOption(process.argv, source.argvOption)
  if (source.type === 'piSessionFile') return explicit || cleanControlText(process.sessionPath)
  return explicit
}

const agentVaultMatchForProcess = (entry: AgentVaultEntry, process: AgentVaultProcessSnapshot, params: Record<string, unknown> = {}, terminal?: AgentVaultScanTarget) => {
  const sessionId = agentVaultSessionIdFromProcess(entry, process, params)
  const sessionPath = cleanControlText(params.sessionPath || params.session_path || process.sessionPath || sessionId)
  const cwd = entry.cwd === 'ignore' ? '' : cleanControlText(params.cwd || process.cwd || terminal?.cwd)
  const renderParams = {
    ...params,
    executable: process.executable || entry.executable,
    cwd,
    sessionId,
    session_id: sessionId,
    sessionPath,
    session_path: sessionPath,
    sessionDir: params.sessionDir || params.sessionDirectory || params.session_directory || entry.sessionDirectory
  }
  return {
    agent: cloneAgentVaultEntry(entry),
    matched: true,
    sessionId: sessionId || '',
    ...(sessionPath ? { sessionPath } : {}),
    ...(cwd ? { cwd } : {}),
    ...(terminal
      ? {
          panelId: terminal.panelId,
          ...(terminal.sessionId ? { terminalSessionId: terminal.sessionId } : {}),
          terminalTitle: terminal.title,
          terminalProcessId: terminal.processId
        }
      : {}),
    process: {
      ...(process.pid ? { pid: process.pid } : {}),
      ...(process.ppid ? { ppid: process.ppid } : {}),
      ...(process.pgid ? { pgid: process.pgid } : {}),
      ...(process.processName ? { processName: process.processName } : {}),
      ...(process.executable ? { executable: process.executable } : {}),
      argv: process.argv
    },
    canResume: Boolean(entry.resumeCommand && sessionId),
    canFork: Boolean(entry.forkCommand && sessionId),
    ...(entry.resumeCommand && sessionId ? { resumeCommand: renderAgentVaultTemplate(entry, entry.resumeCommand, renderParams) } : {}),
    ...(entry.forkCommand && sessionId ? { forkCommand: renderAgentVaultTemplate(entry, entry.forkCommand, renderParams) } : {})
  }
}

const agentVaultIdentify = async (params: Record<string, unknown>) => {
  await loadAgentVaultStore(agentVaultRuntime.userDataPath)
  const process = normalizeAgentVaultProcessSnapshot(params.process || params)
  if (!process) return controlFail('AGENT_VAULT_PROCESS_INVALID', 'Agent vault identify requires a process snapshot.')
  const source = normalizeAgentVaultId(params.id || params.agent || params.source)
  const candidates = (source ? [agentVaultEntryFor(source)].filter(Boolean) : sortedAgentVaultEntries()) as AgentVaultEntry[]
  const matches = candidates
    .filter((entry) => agentVaultEntryMatchesProcess(entry, process))
    .map((entry) => agentVaultMatchForProcess(entry, process, params))
  return controlOk({
    matches,
    count: matches.length,
    matched: matches.length > 0,
    process
  })
}

const normalizeAgentVaultScanTarget = (value: unknown): AgentVaultScanTarget | null => {
  const record = nestedRecord(value)
  if (!record) return null
  const kind = cleanControlText(record.kind).toLowerCase()
  const panelId = cleanControlText(record.panelId || record.panel_id || record.surfaceId || record.surface_id)
  const processId = cleanPositiveInteger(record.processId || record.process_id || record.pid)
  if (!panelId || !processId || (kind && kind !== 'local')) return null
  return {
    panelId,
    ...(cleanControlText(record.sessionId || record.session_id) ? { sessionId: cleanControlText(record.sessionId || record.session_id) } : {}),
    title: cleanControlText(record.title) || panelId,
    ...(cleanControlText(record.cwd) ? { cwd: cleanControlText(record.cwd) } : {}),
    processId,
    ...(cleanPositiveInteger(record.processGroupId || record.process_group_id || record.pgid) ? { processGroupId: cleanPositiveInteger(record.processGroupId || record.process_group_id || record.pgid) } : {}),
    ...(cleanControlText(record.shell) ? { shell: cleanControlText(record.shell) } : {})
  }
}

const extractProcStatFields = (stat: string) => {
  const end = stat.lastIndexOf(')')
  if (end < 0) return null
  const processName = stat.slice(stat.indexOf('(') + 1, end)
  const fields = stat.slice(end + 2).trim().split(/\s+/)
  const ppid = cleanPositiveInteger(fields[1])
  const pgid = cleanPositiveInteger(fields[2])
  return {
    processName,
    ...(ppid ? { ppid } : {}),
    ...(pgid ? { pgid } : {})
  }
}

const procText = async (path: string) => {
  try {
    return await readFile(path, 'utf-8')
  } catch {
    return ''
  }
}

const procLink = async (path: string) => {
  try {
    return await readlink(path)
  } catch {
    return ''
  }
}

const expandHomePath = (value: string) => {
  const text = cleanControlText(value)
  if (!text.startsWith('~/')) return text
  const home = cleanControlText(process.env.HOME)
  return home ? join(home, text.slice(2)) : text
}

const agentVaultSessionPathFromOpenFiles = async (pid: number, entry: AgentVaultEntry) => {
  const sessionDir = expandHomePath(entry.sessionDirectory || '')
  if (!sessionDir) return ''
  let names: string[] = []
  try {
    names = await readdir(`/proc/${pid}/fd`)
  } catch {
    return ''
  }
  for (const name of names.slice(0, 256)) {
    const target = await procLink(`/proc/${pid}/fd/${name}`)
    if (target && target.startsWith(sessionDir)) return target
  }
  return ''
}

const agentVaultSnapshotFromProc = async (pid: number, entries: AgentVaultEntry[]): Promise<AgentVaultProcessSnapshot | null> => {
  const statText = await procText(`/proc/${pid}/stat`)
  const stat = extractProcStatFields(statText)
  if (!stat) return null
  const rawCmdline = await procText(`/proc/${pid}/cmdline`)
  const argv = rawCmdline
    .split('\u0000')
    .map(cleanControlText)
    .filter(Boolean)
    .slice(0, 200)
  const executable = await procLink(`/proc/${pid}/exe`)
  const cwd = await procLink(`/proc/${pid}/cwd`)
  const commandLine = argv.length ? argv.join(' ') : stat.processName
  const snapshot: AgentVaultProcessSnapshot = {
    pid,
    ...(stat.ppid ? { ppid: stat.ppid } : {}),
    ...(stat.pgid ? { pgid: stat.pgid } : {}),
    processName: stat.processName,
    ...(executable ? { executable } : argv[0] ? { executable: argv[0] } : {}),
    argv,
    ...(commandLine ? { commandLine } : {}),
    ...(cwd ? { cwd } : {})
  }
  for (const entry of entries) {
    if (entry.sessionIdSource?.type !== 'piSessionFile' || !agentVaultEntryMatchesProcess(entry, snapshot)) continue
    const sessionPath = await agentVaultSessionPathFromOpenFiles(pid, entry)
    if (sessionPath) return { ...snapshot, sessionPath }
  }
  return snapshot
}

const scanDescendantProcesses = async (rootPid: number) => {
  const children = new Map<number, number[]>()
  const pids: number[] = []
  let procEntries: string[] = []
  try {
    procEntries = await readdir('/proc')
  } catch {
    return []
  }
  await Promise.all(
    procEntries
      .filter((name) => /^\d+$/.test(name))
      .map(async (name) => {
        const pid = Number(name)
        const stat = extractProcStatFields(await procText(`/proc/${pid}/stat`))
        if (!stat?.ppid) return
        pids.push(pid)
        children.set(stat.ppid, [...(children.get(stat.ppid) || []), pid])
      })
  )
  const descendants: number[] = []
  const queue = [...(children.get(rootPid) || [])]
  const seen = new Set<number>([rootPid])
  while (queue.length && descendants.length < maxAgentVaultScanProcessesPerTerminal) {
    const pid = queue.shift()
    if (!pid || seen.has(pid)) continue
    seen.add(pid)
    descendants.push(pid)
    queue.push(...(children.get(pid) || []))
  }
  return descendants.filter((pid) => pids.includes(pid))
}

const dispatchAgentVaultRendererControlRequest = (method: string, params: Record<string, unknown>) => {
  if (!agentVaultRuntime.dispatchRendererControlRequest) {
    return Promise.resolve(controlFail('NO_APP_WINDOW', 'No aiopsterm window is available for this control request.'))
  }
  return agentVaultRuntime.dispatchRendererControlRequest(method, params)
}

const agentVaultScanProcesses = async (params: Record<string, unknown>) => {
  if (process.platform !== 'linux') {
    return controlOk({
      matches: [],
      count: 0,
      matched: false,
      terminals: [],
      scannedProcessCount: 0,
      unsupported: true,
      platform: process.platform,
      message: 'Agent Vault process scanning is currently implemented for Linux /proc only.'
    })
  }
  const snapshotResponse = await dispatchAgentVaultRendererControlRequest('terminal.list', params)
  if (!snapshotResponse.ok) return snapshotResponse
  const terminals = Array.isArray(snapshotResponse.data?.terminals)
    ? (snapshotResponse.data.terminals as unknown[])
        .map(normalizeAgentVaultScanTarget)
        .filter((item): item is AgentVaultScanTarget => Boolean(item))
        .slice(0, maxAgentVaultScanTerminals)
    : []
  const requestedPanelId = cleanControlText(params.panelId || params.panel_id || params.surfaceId || params.surface_id || params.panel)
  const requestedSessionId = cleanControlText(params.sessionId || params.session_id || params.terminalSessionId || params.terminal_session_id || params.session)
  const selectedTerminals = terminals.filter((terminal) => {
    if (requestedPanelId && terminal.panelId !== requestedPanelId) return false
    if (requestedSessionId && terminal.sessionId !== requestedSessionId) return false
    return true
  })
  const source = normalizeAgentVaultId(params.id || params.agent || params.source)
  const candidates = (source ? [agentVaultEntryFor(source)].filter(Boolean) : sortedAgentVaultEntries()) as AgentVaultEntry[]
  const matches: ReturnType<typeof agentVaultMatchForProcess>[] = []
  const scannedProcesses: AgentVaultProcessSnapshot[] = []
  for (const terminal of selectedTerminals) {
    const pids = await scanDescendantProcesses(terminal.processId)
    for (const pid of pids) {
      const processSnapshot = await agentVaultSnapshotFromProc(pid, candidates)
      if (!processSnapshot) continue
      scannedProcesses.push(processSnapshot)
      for (const entry of candidates) {
        if (!agentVaultEntryMatchesProcess(entry, processSnapshot)) continue
        matches.push(agentVaultMatchForProcess(entry, processSnapshot, params, terminal))
      }
    }
  }
  const uniqueMatches = [...new Map(matches.map((match) => [`${match.agent.id}:${match.process.pid || ''}:${match.sessionId}:${match.panelId || ''}`, match])).values()]
  return controlOk({
    matches: uniqueMatches,
    count: uniqueMatches.length,
    matched: uniqueMatches.length > 0,
    terminals: selectedTerminals,
    scannedProcessCount: scannedProcesses.length,
    scannedProcesses,
    platform: process.platform
  })
}

export const handleAgentVaultControlRequest = async (method: string, params: Record<string, unknown>) => {
  await loadAgentVaultStore(agentVaultRuntime.userDataPath)
  const action = method.startsWith('agent-vault.') ? method.slice('agent-vault.'.length) : method.slice('agent.vault.'.length)
  if (action === 'list') return controlOk(agentVaultPayload())
  if (action === 'register' || action === 'set') {
    if (agentVaultEntries.size >= maxAgentVaultEntries && !agentVaultEntryFor(params.id)) {
      return controlFail('AGENT_VAULT_LIMIT_REACHED', `Agent vault supports at most ${maxAgentVaultEntries} entries.`)
    }
    const existing = agentVaultEntryFor(params.id)
    const entry = normalizeAgentVaultEntry(params, existing || undefined)
    if (!entry) return controlFail('AGENT_VAULT_ENTRY_INVALID', 'Agent vault entry needs a valid id and at least one launch/resume/fork command template.')
    agentVaultEntries.set(entry.id, entry)
    await persistAgentVaultStore()
    agentVaultRuntime.publishControlEvent?.({
      name: existing ? 'agent_vault.updated' : 'agent_vault.registered',
      category: 'agent',
      payload: { agent_id: entry.id, agent_name: entry.name, has_launch: Boolean(entry.launchCommand), has_resume: Boolean(entry.resumeCommand), has_fork: Boolean(entry.forkCommand) }
    })
    return controlOk(agentVaultPayload(entry))
  }
  if (action === 'get') {
    const entry = agentVaultEntryFor(params.id || params.agent || params.source)
    if (!entry) return controlFail('AGENT_VAULT_ENTRY_NOT_FOUND', 'Agent vault entry was not found.')
    return controlOk(agentVaultPayload(entry))
  }
  if (action === 'remove' || action === 'delete' || action === 'unset') {
    const entry = agentVaultEntryFor(params.id || params.agent || params.source)
    if (!entry) return controlFail('AGENT_VAULT_ENTRY_NOT_FOUND', 'Agent vault entry was not found.')
    agentVaultEntries.delete(entry.id)
    await persistAgentVaultStore()
    agentVaultRuntime.publishControlEvent?.({ name: 'agent_vault.removed', category: 'agent', payload: { agent_id: entry.id, agent_name: entry.name } })
    return controlOk({ removed: true, removedId: entry.id, ...agentVaultPayload() })
  }
  if (action === 'render') {
    const entry = agentVaultEntryFor(params.id || params.agent || params.source)
    if (!entry) return controlFail('AGENT_VAULT_ENTRY_NOT_FOUND', 'Agent vault entry was not found.')
    const kind = cleanControlText(params.kind || params.commandKind || params.command_kind || 'launch') || 'launch'
    const template = kind === 'resume' ? entry.resumeCommand : kind === 'fork' ? entry.forkCommand : entry.launchCommand
    if (!template) return controlFail('AGENT_VAULT_TEMPLATE_NOT_FOUND', `Agent vault entry has no ${kind} command template.`)
    return controlOk({ agent: cloneAgentVaultEntry(entry), kind, command: renderAgentVaultTemplate(entry, template, params) })
  }
  if (action === 'identify' || action === 'detect') return agentVaultIdentify(params)
  if (action === 'scan' || action === 'scan-processes') return agentVaultScanProcesses(params)
  return controlFail('UNKNOWN_CONTROL_METHOD', `Unknown aiopsterm agent vault method: ${method}`)
}

export const prepareAgentVaultTeamLaunchParams = async (params: Record<string, unknown>): Promise<Record<string, unknown> | ControlResponse> => {
  await loadAgentVaultStore(agentVaultRuntime.userDataPath)
  const source = normalizeAgentVaultId(params.source || params.agent)
  const explicitCommand = cleanAgentVaultCommand(params.command || params.shell || params.commandText)
  if (!source || explicitCommand || source === 'codex' || source === 'claude' || source === 'claude-code' || source === 'claude_code' || source === 'custom') return params
  const entry = agentVaultEntryFor(source)
  if (!entry) return params
  if (!entry.launchCommand) return controlFail('AGENT_VAULT_LAUNCH_UNAVAILABLE', `Agent vault entry ${entry.id} has no launch command template.`)
  return {
    ...params,
    source: 'custom',
    agentVaultId: entry.id,
    agentVaultName: entry.name,
    command: renderAgentVaultTemplate(entry, entry.launchCommand, params, { preserveDynamic: true }),
    name: cleanControlText(params.name || params.groupName || params.title) || `${entry.name} Team`,
    groupName: cleanControlText(params.groupName || params.name || params.title) || `${entry.name} Team`
  }
}
