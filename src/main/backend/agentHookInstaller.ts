import { createHash } from 'crypto'
import { access, mkdir, readFile, stat, writeFile } from 'fs/promises'
import { delimiter, dirname, isAbsolute, join } from 'path'
import type {
  AgentHookInstallerOperationInput,
  AgentHookInstallerOperationResult,
  AgentHookInstallerSnapshot,
  AgentHookInstallerStatus,
  AgentHookInstallerSource
} from '@shared/preload'

type AgentHookInstallerRuntimeConfig = {
  getEnv?: () => NodeJS.ProcessEnv
  getHomeDir?: () => string
  getAgentHookScriptPath?: () => string
  readFile?: typeof readFile
  writeFile?: typeof writeFile
  mkdir?: typeof mkdir
  access?: typeof access
  stat?: typeof stat
}

type HookCommandEvent = {
  agentEvent: string
  hookEvent: string
  timeout: number
}

type AgentHookDefinition = {
  source: AgentHookInstallerSource
  label: string
  binaryName: string
  configDirName: string
  configFileName: string
  configDirEnv?: string
  configDirEnvSubpath?: string
  flatHooks?: boolean
  events: HookCommandEvent[]
  configToml?: boolean
}

class AgentHookInstallerError extends Error {
  constructor(
    public errorCode: string,
    message: string
  ) {
    super(message)
    this.name = 'AgentHookInstallerError'
  }
}

const runtimeConfig: AgentHookInstallerRuntimeConfig = {}

const ownedMarker = 'aiopsterm-agent-hook-v1'
const codexFeatureBegin = '# aiopsterm-codex-hooks-feature begin'
const codexFeatureEnd = '# aiopsterm-codex-hooks-feature end'
const codexFeaturePreviousPrefix = '# aiopsterm-codex-hooks-feature previous line: '
const codexTrustBegin = '# aiopsterm-codex-hook-trust begin'
const codexTrustEnd = '# aiopsterm-codex-hook-trust end'

const hookDefinitions: AgentHookDefinition[] = [
  {
    source: 'codex',
    label: 'Codex',
    binaryName: 'codex',
    configDirName: '.codex',
    configFileName: 'hooks.json',
    configDirEnv: 'CODEX_HOME',
    configToml: true,
    events: [
      { agentEvent: 'SessionStart', hookEvent: 'SessionStart', timeout: 5 },
      { agentEvent: 'UserPromptSubmit', hookEvent: 'UserPromptSubmit', timeout: 5 },
      { agentEvent: 'Stop', hookEvent: 'Stop', timeout: 5 },
      { agentEvent: 'PreToolUse', hookEvent: 'PreToolUse', timeout: 5 },
      { agentEvent: 'PermissionRequest', hookEvent: 'PermissionRequest', timeout: 5 }
    ]
  },
  {
    source: 'claude-code',
    label: 'Claude Code',
    binaryName: 'claude',
    configDirName: '.claude',
    configFileName: 'settings.json',
    events: [
      { agentEvent: 'SessionStart', hookEvent: 'SessionStart', timeout: 5 },
      { agentEvent: 'UserPromptSubmit', hookEvent: 'UserPromptSubmit', timeout: 5 },
      { agentEvent: 'Stop', hookEvent: 'Stop', timeout: 5 },
      { agentEvent: 'Notification', hookEvent: 'Notification', timeout: 5 },
      { agentEvent: 'PreToolUse', hookEvent: 'PreToolUse', timeout: 5 },
      { agentEvent: 'PermissionRequest', hookEvent: 'PermissionRequest', timeout: 125 },
      { agentEvent: 'AskUserQuestion', hookEvent: 'AskUserQuestion', timeout: 125 }
    ]
  },
  {
    source: 'cursor',
    label: 'Cursor',
    binaryName: 'cursor-agent',
    configDirName: '.cursor',
    configFileName: 'hooks.json',
    flatHooks: true,
    events: [
      { agentEvent: 'beforeSubmitPrompt', hookEvent: 'prompt_submit', timeout: 5 },
      { agentEvent: 'stop', hookEvent: 'stop', timeout: 5 },
      { agentEvent: 'afterAgentResponse', hookEvent: 'stop', timeout: 5 },
      { agentEvent: 'beforeShellExecution', hookEvent: 'pre_tool_use', timeout: 5 }
    ]
  },
  {
    source: 'gemini',
    label: 'Gemini',
    binaryName: 'gemini',
    configDirName: '.gemini',
    configFileName: 'settings.json',
    events: [
      { agentEvent: 'SessionStart', hookEvent: 'SessionStart', timeout: 10 },
      { agentEvent: 'BeforeAgent', hookEvent: 'prompt_submit', timeout: 10 },
      { agentEvent: 'AfterAgent', hookEvent: 'stop', timeout: 10 },
      { agentEvent: 'SessionEnd', hookEvent: 'SessionEnd', timeout: 10 },
      { agentEvent: 'PreToolUse', hookEvent: 'PreToolUse', timeout: 10 }
    ]
  },
  {
    source: 'copilot',
    label: 'Copilot',
    binaryName: 'copilot',
    configDirName: '.copilot',
    configFileName: 'config.json',
    configDirEnv: 'COPILOT_HOME',
    events: [
      { agentEvent: 'SessionStart', hookEvent: 'SessionStart', timeout: 5 },
      { agentEvent: 'Stop', hookEvent: 'Stop', timeout: 5 },
      { agentEvent: 'Notification', hookEvent: 'Notification', timeout: 5 },
      { agentEvent: 'SessionEnd', hookEvent: 'SessionEnd', timeout: 5 },
      { agentEvent: 'PreToolUse', hookEvent: 'PreToolUse', timeout: 5 }
    ]
  },
  {
    source: 'grok',
    label: 'Grok',
    binaryName: 'grok',
    configDirName: '.grok/hooks',
    configFileName: 'aiopsterm-session.json',
    configDirEnv: 'GROK_HOME',
    configDirEnvSubpath: 'hooks',
    events: [
      { agentEvent: 'SessionStart', hookEvent: 'SessionStart', timeout: 5 },
      { agentEvent: 'UserPromptSubmit', hookEvent: 'UserPromptSubmit', timeout: 5 },
      { agentEvent: 'Stop', hookEvent: 'Stop', timeout: 5 },
      { agentEvent: 'Notification', hookEvent: 'Notification', timeout: 5 },
      { agentEvent: 'SessionEnd', hookEvent: 'SessionEnd', timeout: 5 },
      { agentEvent: 'PreToolUse', hookEvent: 'PreToolUse', timeout: 5 }
    ]
  },
  {
    source: 'codebuddy',
    label: 'CodeBuddy',
    binaryName: 'codebuddy',
    configDirName: '.codebuddy',
    configFileName: 'settings.json',
    configDirEnv: 'CODEBUDDY_CONFIG_DIR',
    events: [
      { agentEvent: 'SessionStart', hookEvent: 'SessionStart', timeout: 5 },
      { agentEvent: 'Stop', hookEvent: 'Stop', timeout: 5 },
      { agentEvent: 'Notification', hookEvent: 'Notification', timeout: 5 },
      { agentEvent: 'SessionEnd', hookEvent: 'SessionEnd', timeout: 5 },
      { agentEvent: 'PreToolUse', hookEvent: 'PreToolUse', timeout: 5 }
    ]
  },
  {
    source: 'factory',
    label: 'Factory',
    binaryName: 'droid',
    configDirName: '.factory',
    configFileName: 'settings.json',
    events: [
      { agentEvent: 'SessionStart', hookEvent: 'SessionStart', timeout: 5 },
      { agentEvent: 'Stop', hookEvent: 'Stop', timeout: 5 },
      { agentEvent: 'Notification', hookEvent: 'Notification', timeout: 5 },
      { agentEvent: 'SessionEnd', hookEvent: 'SessionEnd', timeout: 5 },
      { agentEvent: 'PreToolUse', hookEvent: 'PreToolUse', timeout: 5 }
    ]
  },
  {
    source: 'qoder',
    label: 'Qoder',
    binaryName: 'qodercli',
    configDirName: '.qoder',
    configFileName: 'settings.json',
    configDirEnv: 'QODER_CONFIG_DIR',
    events: [
      { agentEvent: 'SessionStart', hookEvent: 'SessionStart', timeout: 5 },
      { agentEvent: 'Stop', hookEvent: 'Stop', timeout: 5 },
      { agentEvent: 'SessionEnd', hookEvent: 'SessionEnd', timeout: 5 },
      { agentEvent: 'PreToolUse', hookEvent: 'PreToolUse', timeout: 5 }
    ]
  }
]

export const configureAgentHookInstallerRuntime = (config: AgentHookInstallerRuntimeConfig = {}) => {
  runtimeConfig.getEnv = config.getEnv
  runtimeConfig.getHomeDir = config.getHomeDir
  runtimeConfig.getAgentHookScriptPath = config.getAgentHookScriptPath
  runtimeConfig.readFile = config.readFile
  runtimeConfig.writeFile = config.writeFile
  runtimeConfig.mkdir = config.mkdir
  runtimeConfig.access = config.access
  runtimeConfig.stat = config.stat
}

const getEnv = () => runtimeConfig.getEnv?.() || process.env
const getHomeDir = () => runtimeConfig.getHomeDir?.() || getEnv().HOME || process.env.HOME || process.cwd()
const getReadFile = () => runtimeConfig.readFile || readFile
const getWriteFile = () => runtimeConfig.writeFile || writeFile
const getMkdir = () => runtimeConfig.mkdir || mkdir
const getAccess = () => runtimeConfig.access || access
const getStat = () => runtimeConfig.stat || stat

const cleanText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const shellSingleQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`

const normalizeSource = (value: unknown): AgentHookInstallerSource | null => {
  const raw = cleanText(value).toLowerCase().replace(/_/g, '-')
  if (raw === 'codex') return 'codex'
  if (raw === 'claude' || raw === 'claude-code' || raw === 'claude_code') return 'claude-code'
  if (raw === 'cursor' || raw === 'cursor-agent') return 'cursor'
  if (raw === 'gemini' || raw === 'gemini-cli') return 'gemini'
  if (raw === 'copilot' || raw === 'github-copilot') return 'copilot'
  if (raw === 'grok') return 'grok'
  if (raw === 'codebuddy') return 'codebuddy'
  if (raw === 'factory') return 'factory'
  if (raw === 'qoder') return 'qoder'
  return null
}

const definitionFor = (source: AgentHookInstallerSource) => hookDefinitions.find((definition) => definition.source === source)

const configDirFor = (definition: AgentHookDefinition, env: NodeJS.ProcessEnv = getEnv()) => {
  const override = definition.configDirEnv ? cleanText(env[definition.configDirEnv]) : ''
  if (override) {
    const resolved = isAbsolute(override) ? override : join(getHomeDir(), override)
    return definition.configDirEnvSubpath ? join(resolved, definition.configDirEnvSubpath) : resolved
  }
  return join(getHomeDir(), definition.configDirName)
}

const configPathFor = (definition: AgentHookDefinition, env: NodeJS.ProcessEnv = getEnv()) => join(configDirFor(definition, env), definition.configFileName)

const codexConfigTomlPathFor = (definition: AgentHookDefinition, env: NodeJS.ProcessEnv = getEnv()) => join(configDirFor(definition, env), 'config.toml')

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
  for (const entry of pathValue.split(delimiter)) {
    const dir = cleanText(entry)
    if (!dir) continue
    const candidate = join(dir, binaryName)
    try {
      await getAccess()(candidate)
      const metadata = await getStat()(candidate)
      if (metadata.isFile()) return candidate
    } catch {
      // Continue searching PATH.
    }
  }
  return ''
}

const hookScriptPath = () => cleanText(runtimeConfig.getAgentHookScriptPath?.())

export const agentHookCommandFor = (source: AgentHookInstallerSource, hookEvent: string, scriptPath = hookScriptPath()) => {
  const script = cleanText(scriptPath)
  if (!script) throw new AgentHookInstallerError('AGENT_HOOK_SCRIPT_MISSING', 'Agent hook helper path is unavailable.')
  const normalizedSource = normalizeSource(source) || source
  const waitDecision = normalizedSource === 'claude-code' && (hookEvent === 'PermissionRequest' || hookEvent === 'AskUserQuestion')
  const dispatch = [
    `AIOPSTERM_AGENT_HOOK_MARKER=${ownedMarker}`,
    'node',
    shellSingleQuote(script),
    `--source ${shellSingleQuote(normalizedSource)}`,
    `--event ${shellSingleQuote(hookEvent)}`,
    ...(waitDecision ? ['--wait-decision', '--wait-timeout-ms 120000'] : [])
  ].join(' ')
  return `command -v node >/dev/null 2>&1 && ${dispatch} || echo '{}'`
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))

const parseConfigJson = (raw: string, path: string): Record<string, unknown> => {
  if (!cleanText(raw)) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!isPlainObject(parsed)) throw new Error('JSON root must be an object.')
    return parsed
  } catch (error) {
    throw new AgentHookInstallerError('AGENT_HOOK_CONFIG_JSON_INVALID', `${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const prettyJson = (value: Record<string, unknown>) => `${JSON.stringify(value, null, 2)}\n`

const isOwnedHookCommand = (command: unknown) => typeof command === 'string' && command.includes(ownedMarker)

const hookEntry = (definition: AgentHookDefinition, event: HookCommandEvent, scriptPath: string) => ({
  type: 'command',
  command: agentHookCommandFor(definition.source, event.hookEvent, scriptPath),
  timeout: event.timeout
})

const groupedHookEntry = (definition: AgentHookDefinition, event: HookCommandEvent, scriptPath: string) => ({
  ...(definition.source === 'codex' ? {} : { matcher: '' }),
  hooks: [hookEntry(definition, event, scriptPath)]
})

const flatHookEntry = (definition: AgentHookDefinition, event: HookCommandEvent, scriptPath: string) => ({
  command: agentHookCommandFor(definition.source, event.hookEvent, scriptPath),
  timeout: event.timeout
})

const removeOwnedHooksFromGroups = (value: unknown) => {
  if (!Array.isArray(value)) return { value, removed: 0 }
  let removed = 0
  const groups: unknown[] = []
  for (const groupValue of value) {
    if (!isPlainObject(groupValue)) {
      groups.push(groupValue)
      continue
    }
    const rawHooks = groupValue.hooks
    if (!Array.isArray(rawHooks)) {
      if (isOwnedHookCommand(groupValue.command)) {
        removed += 1
        continue
      }
      groups.push(groupValue)
      continue
    }
    const hooks = rawHooks.filter((hook) => {
      const owned = isPlainObject(hook) && isOwnedHookCommand(hook.command)
      if (owned) removed += 1
      return !owned
    })
    if (!hooks.length) continue
    groups.push({ ...groupValue, hooks })
  }
  return { value: groups, removed }
}

const removeOwnedHooksFromFlatEntries = (value: unknown) => {
  if (!Array.isArray(value)) return { value, removed: 0 }
  let removed = 0
  const entries = value.filter((entry) => {
    const owned = isPlainObject(entry) && isOwnedHookCommand(entry.command)
    if (owned) removed += 1
    return !owned
  })
  return { value: entries, removed }
}

export const mergeAgentHookJson = (
  existing: Record<string, unknown>,
  definition: AgentHookDefinition,
  scriptPath: string,
  install: boolean
): { config: Record<string, unknown>; removed: number } => {
  const next: Record<string, unknown> = { ...existing }
  const rawHooks = isPlainObject(next.hooks) ? next.hooks : {}
  const hooks: Record<string, unknown> = { ...rawHooks }
  let removed = 0

  for (const eventName of Object.keys(hooks)) {
    const result = definition.flatHooks ? removeOwnedHooksFromFlatEntries(hooks[eventName]) : removeOwnedHooksFromGroups(hooks[eventName])
    removed += result.removed
    if (Array.isArray(result.value) && result.value.length === 0) {
      delete hooks[eventName]
    } else {
      hooks[eventName] = result.value
    }
  }

  if (install) {
    for (const event of definition.events) {
      const existingGroups = Array.isArray(hooks[event.agentEvent]) ? (hooks[event.agentEvent] as unknown[]) : []
      hooks[event.agentEvent] = [...existingGroups, definition.flatHooks ? flatHookEntry(definition, event, scriptPath) : groupedHookEntry(definition, event, scriptPath)]
    }
  }

  if (Object.keys(hooks).length) next.hooks = hooks
  else delete next.hooks
  return { config: next, removed }
}

const removeMarkedBlock = (content: string, begin: string, end: string) => {
  const lines = content.split(/\r?\n/)
  const next: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] !== begin) {
      next.push(lines[index])
      continue
    }
    while (index < lines.length && lines[index] !== end) index += 1
  }
  return next.join('\n').replace(/\n{3,}/g, '\n\n')
}

const removeCodexFeatureBlock = (content: string, restorePrevious: boolean) => {
  const lines = content.split(/\r?\n/)
  const next: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] !== codexFeatureBegin) {
      next.push(lines[index])
      continue
    }
    let previousLine = ''
    while (index < lines.length && lines[index] !== codexFeatureEnd) {
      const line = lines[index]
      if (line.startsWith(codexFeaturePreviousPrefix)) previousLine = line.slice(codexFeaturePreviousPrefix.length)
      index += 1
    }
    if (restorePrevious && previousLine.trim()) next.push(previousLine)
  }
  return next.join('\n').replace(/\n{3,}/g, '\n\n')
}

const tomlLineDefinesKey = (line: string, key: string) => new RegExp(`^\\s*${key}\\s*=`).test(line)

const tomlLineDefinesTrueKey = (line: string, key: string) => new RegExp(`^\\s*${key}\\s*=\\s*true\\s*(#.*)?$`).test(line)

const tomlLineDefinesDottedFeaturesKey = (line: string, key: string) => new RegExp(`^\\s*features\\s*\\.\\s*${key}\\s*=`).test(line)

const tomlLineDefinesDottedFeaturesTrueKey = (line: string, key: string) => new RegExp(`^\\s*features\\s*\\.\\s*${key}\\s*=\\s*true\\s*(#.*)?$`).test(line)

const tomlLineDefinesAnyDottedFeaturesKey = (line: string) => /^\s*features\s*\.\s*[^=\s]+\s*=/.test(line)

const tomlLineIsTable = (line: string, tableName: string) => new RegExp(`^\\s*\\[\\s*${tableName}\\s*\\]\\s*(#.*)?$`).test(line)

const tomlLineIsAnyTable = (line: string) => /^\s*\[[^\]]+\]\s*(#.*)?$/.test(line)

const tomlContent = (lines: string[]) => `${lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '')}\n`

export const installCodexHooksFeature = (content: string) => {
  const stripped = removeCodexFeatureBlock(content || '', false)
  const lines = stripped.replace(/\s+$/, '').split(/\r?\n/)
  if (lines.length === 1 && lines[0] === '') lines.pop()
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (tomlLineDefinesKey(lines[index], 'codex_hooks') || tomlLineDefinesDottedFeaturesKey(lines[index], 'codex_hooks')) {
      lines.splice(index, 1)
    }
  }

  const featuresIndex = lines.findIndex((line) => tomlLineIsTable(line, 'features'))
  if (featuresIndex >= 0) {
    let end = lines.length
    for (let index = featuresIndex + 1; index < lines.length; index += 1) {
      if (tomlLineIsAnyTable(lines[index])) {
        end = index
        break
      }
    }
    const existingHooksIndex = lines.slice(featuresIndex + 1, end).findIndex((line) => tomlLineDefinesKey(line, 'hooks'))
    if (existingHooksIndex >= 0) {
      const lineIndex = featuresIndex + 1 + existingHooksIndex
      if (tomlLineDefinesTrueKey(lines[lineIndex], 'hooks')) return tomlContent(lines)
      lines.splice(lineIndex, 1, codexFeatureBegin, `${codexFeaturePreviousPrefix}${lines[lineIndex]}`, 'hooks = true', codexFeatureEnd)
      return tomlContent(lines)
    }
    lines.splice(featuresIndex + 1, 0, codexFeatureBegin, 'hooks = true', codexFeatureEnd)
    return tomlContent(lines)
  }

  const dottedHooksIndex = lines.findIndex((line) => tomlLineDefinesDottedFeaturesKey(line, 'hooks'))
  if (dottedHooksIndex >= 0) {
    if (tomlLineDefinesDottedFeaturesTrueKey(lines[dottedHooksIndex], 'hooks')) return tomlContent(lines)
    lines.splice(dottedHooksIndex, 1, codexFeatureBegin, `${codexFeaturePreviousPrefix}${lines[dottedHooksIndex]}`, 'features.hooks = true', codexFeatureEnd)
    return tomlContent(lines)
  }

  const firstDottedFeaturesIndex = lines.findIndex(tomlLineDefinesAnyDottedFeaturesKey)
  if (firstDottedFeaturesIndex >= 0) {
    lines.splice(firstDottedFeaturesIndex, 0, codexFeatureBegin, 'features.hooks = true', codexFeatureEnd)
    return tomlContent(lines)
  }

  if (lines.length) lines.push('')
  lines.push('[features]', codexFeatureBegin, 'hooks = true', codexFeatureEnd)
  return tomlContent(lines)
}

export const uninstallCodexHooksFeature = (content: string) => {
  let next = removeCodexFeatureBlock(content || '', true)
  next = removeMarkedBlock(next, codexTrustBegin, codexTrustEnd)
  return tomlContent(
    next
      .replace(/\s+$/, '')
      .split(/\r?\n/)
      .filter((line) => !tomlLineDefinesKey(line, 'codex_hooks') && !tomlLineDefinesDottedFeaturesKey(line, 'codex_hooks'))
  )
}

const codexHookEventLabel = (eventName: string) => {
  const labels: Record<string, string> = {
    PreToolUse: 'pre_tool_use',
    PermissionRequest: 'permission_request',
    SessionStart: 'session_start',
    UserPromptSubmit: 'user_prompt_submit',
    Stop: 'stop'
  }
  return labels[eventName] || eventName
}

const stableJsonStringify = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJsonStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJsonStringify(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export const codexHookHash = (eventName: string, command: string, timeout: number, matcher = '') => {
  const identity: Record<string, unknown> = {
    event_name: codexHookEventLabel(eventName),
    hooks: [{ async: false, command, timeout: Math.max(timeout, 1), type: 'command' }]
  }
  if (matcher) identity.matcher = matcher
  const payload = stableJsonStringify(identity)
  return `sha256:${createHash('sha256').update(payload).digest('hex')}`
}

const installCodexHookTrust = (content: string, configPath: string, hooks: Record<string, unknown>) => {
  const stripped = removeMarkedBlock(content || '', codexTrustBegin, codexTrustEnd).replace(/\s+$/, '')
  const entries: string[] = []
  for (const [eventName, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue
    groups.forEach((group, groupIndex) => {
      if (!isPlainObject(group) || !Array.isArray(group.hooks)) return
      const matcher = cleanText(group.matcher)
      group.hooks.forEach((hook, hookIndex) => {
        if (!isPlainObject(hook) || !isOwnedHookCommand(hook.command)) return
        const command = cleanText(hook.command)
        const timeout = typeof hook.timeout === 'number' ? hook.timeout : 5
        const key = `${configPath}:${codexHookEventLabel(eventName)}:${groupIndex}:${hookIndex}`
        entries.push(`[hooks.state.${JSON.stringify(key)}]`)
        entries.push(`trusted_hash = ${JSON.stringify(codexHookHash(eventName, command, timeout, matcher))}`)
      })
    })
  }
  if (!entries.length) return stripped ? `${stripped}\n` : ''
  return `${stripped}${stripped ? '\n\n' : ''}${codexTrustBegin}\n${entries.join('\n')}\n${codexTrustEnd}\n`
}

const configHasOwnedHooks = (config: Record<string, unknown>) => {
  const hooks = isPlainObject(config.hooks) ? config.hooks : {}
  return Object.values(hooks).some((value) => {
    if (!Array.isArray(value)) return false
    return value.some((group) => {
      if (!isPlainObject(group)) return false
      if (isOwnedHookCommand(group.command)) return true
      return Array.isArray(group.hooks) && group.hooks.some((hook) => isPlainObject(hook) && isOwnedHookCommand(hook.command))
    })
  })
}

const statusForDefinition = async (definition: AgentHookDefinition): Promise<AgentHookInstallerStatus> => {
  const env = getEnv()
  const configPath = configPathFor(definition, env)
  const configDir = dirname(configPath)
  const binaryPath = await findBinary(definition.binaryName, env)
  const status: AgentHookInstallerStatus = {
    source: definition.source,
    label: definition.label,
    binaryName: definition.binaryName,
    binaryPath,
    configPath,
    configExists: await pathExists(configPath),
    installed: false,
    scriptPath: hookScriptPath(),
    warnings: []
  }

  if (!binaryPath) status.warnings.push(`${definition.binaryName} not found on PATH`)
  if (!status.scriptPath) status.warnings.push('aiopsterm agent hook helper path is unavailable')

  try {
    const configRaw = status.configExists ? String(await getReadFile()(configPath, 'utf-8')) : ''
    const config = parseConfigJson(configRaw, configPath)
    status.installed = configHasOwnedHooks(config)
  } catch (error) {
    status.error = error instanceof Error ? error.message : String(error)
  }

  if (definition.configToml) {
    status.extraConfigPath = codexConfigTomlPathFor(definition, env)
    try {
      const extraConfigExists = await pathExists(status.extraConfigPath)
      if (!extraConfigExists && status.installed) status.warnings.push('Codex config.toml was not found; hooks.json is installed but feature enablement is unknown')
    } catch {
      // Ignore status-only probing failures.
    }
  }

  try {
    const configDirExists = await pathExists(configDir)
    if (!configDirExists) status.warnings.push(`${configDir} does not exist yet`)
  } catch {
    // Ignore status-only probing failures.
  }

  return status
}

export const listAgentHookInstallers = async (): Promise<AgentHookInstallerSnapshot> => {
  const installers = await Promise.all(hookDefinitions.map((definition) => statusForDefinition(definition)))
  return { installers }
}

const installDefinition = async (definition: AgentHookDefinition): Promise<AgentHookInstallerOperationResult> => {
  const scriptPath = hookScriptPath()
  if (!scriptPath) throw new AgentHookInstallerError('AGENT_HOOK_SCRIPT_MISSING', 'Agent hook helper path is unavailable.')
  const configPath = configPathFor(definition)
  await getMkdir()(dirname(configPath), { recursive: true })
  const existingRaw = (await pathExists(configPath)) ? String(await getReadFile()(configPath, 'utf-8')) : ''
  const existing = parseConfigJson(existingRaw, configPath)
  const merged = mergeAgentHookJson(existing, definition, scriptPath, true)
  await getWriteFile()(configPath, prettyJson(merged.config), 'utf-8')

  if (definition.configToml) {
    const configTomlPath = codexConfigTomlPathFor(definition)
    const tomlRaw = (await pathExists(configTomlPath)) ? String(await getReadFile()(configTomlPath, 'utf-8')) : ''
    const withFeature = installCodexHooksFeature(tomlRaw)
    const hooks = isPlainObject(merged.config.hooks) ? merged.config.hooks : {}
    await getWriteFile()(configTomlPath, installCodexHookTrust(withFeature, configPath, hooks), 'utf-8')
  }

  const snapshot = await listAgentHookInstallers()
  return { ok: true, data: { operation: 'install', source: definition.source, status: snapshot.installers.find((item) => item.source === definition.source)!, snapshot } }
}

const uninstallDefinition = async (definition: AgentHookDefinition): Promise<AgentHookInstallerOperationResult> => {
  const configPath = configPathFor(definition)
  if (await pathExists(configPath)) {
    const existingRaw = String(await getReadFile()(configPath, 'utf-8'))
    const existing = parseConfigJson(existingRaw, configPath)
    const merged = mergeAgentHookJson(existing, definition, hookScriptPath() || 'aiopsterm-agent-hook', false)
    await getWriteFile()(configPath, prettyJson(merged.config), 'utf-8')
  }

  if (definition.configToml) {
    const configTomlPath = codexConfigTomlPathFor(definition)
    if (await pathExists(configTomlPath)) {
      const tomlRaw = String(await getReadFile()(configTomlPath, 'utf-8'))
      await getWriteFile()(configTomlPath, uninstallCodexHooksFeature(tomlRaw), 'utf-8')
    }
  }

  const snapshot = await listAgentHookInstallers()
  return { ok: true, data: { operation: 'uninstall', source: definition.source, status: snapshot.installers.find((item) => item.source === definition.source)!, snapshot } }
}

const operationErrorResult = (error: unknown): AgentHookInstallerOperationResult => ({
  ok: false,
  errorCode: error instanceof AgentHookInstallerError ? error.errorCode : 'AGENT_HOOK_OPERATION_FAILED',
  errorMessage: error instanceof Error ? error.message : String(error || 'Agent hook operation failed.')
})

export const installAgentHook = async (input: AgentHookInstallerOperationInput): Promise<AgentHookInstallerOperationResult> => {
  try {
    const source = normalizeSource(input?.source)
    if (!source) throw new AgentHookInstallerError('AGENT_HOOK_SOURCE_INVALID', 'Agent hook source is not supported.')
    const definition = definitionFor(source)
    if (!definition) throw new AgentHookInstallerError('AGENT_HOOK_SOURCE_UNSUPPORTED', `Agent hook source ${source} is not supported.`)
    return await installDefinition(definition)
  } catch (error) {
    return operationErrorResult(error)
  }
}

export const uninstallAgentHook = async (input: AgentHookInstallerOperationInput): Promise<AgentHookInstallerOperationResult> => {
  try {
    const source = normalizeSource(input?.source)
    if (!source) throw new AgentHookInstallerError('AGENT_HOOK_SOURCE_INVALID', 'Agent hook source is not supported.')
    const definition = definitionFor(source)
    if (!definition) throw new AgentHookInstallerError('AGENT_HOOK_SOURCE_UNSUPPORTED', `Agent hook source ${source} is not supported.`)
    return await uninstallDefinition(definition)
  } catch (error) {
    return operationErrorResult(error)
  }
}

export const __testing = {
  ownedMarker,
  hookDefinitions,
  configPathFor,
  configDirFor,
  isOwnedHookCommand,
  removeOwnedHooksFromGroups,
  installCodexHookTrust
}
