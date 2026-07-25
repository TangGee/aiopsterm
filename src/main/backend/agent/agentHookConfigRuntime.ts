import { createHash } from 'crypto'
import type { AgentHookInstallerSource } from '@shared/contracts/agentHooks'
import { isWindowsPlatform, type PlatformRuntime } from '../app/platformRuntime'

export type HookCommandEvent = {
  agentEvent: string
  hookEvent: string
  timeout: number
}

export type AgentHookDefinition = {
  source: AgentHookInstallerSource
  label: string
  binaryName: string
  configDirName: string
  configFileName: string
  configDirEnv?: string
  configDirEnvSubpath?: string
  flatHooks?: boolean
  fileTemplate?: 'opencode' | 'amp' | 'pi' | 'omp'
  kiroAgentJson?: boolean
  yamlTemplate?: 'rovodev'
  createConfigDirIfMissing?: boolean
  events: HookCommandEvent[]
  configToml?: boolean
}

export class AgentHookInstallerError extends Error {
  constructor(
    public errorCode: string,
    message: string
  ) {
    super(message)
    this.name = 'AgentHookInstallerError'
  }
}

export const ownedMarker = 'aiopsterm-agent-hook-v1'
const codexFeatureBegin = '# aiopsterm-codex-hooks-feature begin'
const codexFeatureEnd = '# aiopsterm-codex-hooks-feature end'
const codexFeaturePreviousPrefix = '# aiopsterm-codex-hooks-feature previous line: '
const codexTrustBegin = '# aiopsterm-codex-hook-trust begin'
const codexTrustEnd = '# aiopsterm-codex-hook-trust end'
export const fileHookMarker = 'aiopsterm-agent-plugin-v1'
export const rovoYamlBegin = '# aiopsterm-rovodev-hooks begin'
export const rovoYamlEnd = '# aiopsterm-rovodev-hooks end'
const openCodePluginSpec = './plugins/aiopsterm-session.js'

export const hookDefinitions: AgentHookDefinition[] = [
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
      { agentEvent: 'PostToolUse', hookEvent: 'PostToolUse', timeout: 5 },
      { agentEvent: 'PermissionRequest', hookEvent: 'PermissionRequest', timeout: 5 },
      { agentEvent: 'AskUserQuestion', hookEvent: 'AskUserQuestion', timeout: 5 }
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
      { agentEvent: 'PostToolUse', hookEvent: 'PostToolUse', timeout: 5 },
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
    source: 'opencode',
    label: 'OpenCode',
    binaryName: 'opencode',
    configDirName: '.config/opencode',
    configFileName: 'plugins/aiopsterm-session.js',
    configDirEnv: 'OPENCODE_CONFIG_DIR',
    fileTemplate: 'opencode',
    events: []
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
  },
  {
    source: 'amp',
    label: 'Amp',
    binaryName: 'amp',
    configDirName: '.config/amp',
    configFileName: 'plugins/aiopsterm-session.ts',
    fileTemplate: 'amp',
    events: []
  },
  {
    source: 'pi',
    label: 'Pi',
    binaryName: 'pi',
    configDirName: '.pi/agent',
    configFileName: 'extensions/aiopsterm-session.ts',
    configDirEnv: 'PI_CODING_AGENT_DIR',
    fileTemplate: 'pi',
    events: []
  },
  {
    source: 'omp',
    label: 'OMP',
    binaryName: 'omp',
    configDirName: '.omp/agent',
    configFileName: 'extensions/aiopsterm-omp-session.ts',
    configDirEnv: 'PI_CODING_AGENT_DIR',
    fileTemplate: 'omp',
    createConfigDirIfMissing: true,
    events: []
  },
  {
    source: 'kiro',
    label: 'Kiro',
    binaryName: 'kiro-cli',
    configDirName: '.kiro/agents',
    configFileName: 'aiopsterm.json',
    configDirEnv: 'KIRO_HOME',
    configDirEnvSubpath: 'agents',
    kiroAgentJson: true,
    events: [
      { agentEvent: 'agentSpawn', hookEvent: 'SessionStart', timeout: 5 },
      { agentEvent: 'userPromptSubmit', hookEvent: 'prompt_submit', timeout: 5 },
      { agentEvent: 'stop', hookEvent: 'stop', timeout: 5 },
      { agentEvent: 'preToolUse', hookEvent: 'PreToolUse', timeout: 5 },
      { agentEvent: 'postToolUse', hookEvent: 'PostToolUse', timeout: 5 }
    ]
  },
  {
    source: 'rovodev',
    label: 'Rovo Dev',
    binaryName: 'acli',
    configDirName: '.rovodev',
    configFileName: 'config.yml',
    yamlTemplate: 'rovodev',
    events: [
      { agentEvent: 'SessionStart', hookEvent: 'SessionStart', timeout: 5 },
      { agentEvent: 'Stop', hookEvent: 'Stop', timeout: 5 },
      { agentEvent: 'SessionEnd', hookEvent: 'SessionEnd', timeout: 5 }
    ]
  }
]

export const cleanText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const cleanOptionalString = (value: unknown) => cleanText(value) || undefined

const shellSingleQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`
const windowsCommandDoubleQuote = (value: string) => `"${value.replace(/"/g, '\\"')}"`
const defaultJsRuntimeExecutable = () => cleanText(process.env.APPIMAGE) || process.execPath

export const normalizeSource = (value: unknown): AgentHookInstallerSource | null => {
  const raw = cleanText(value).toLowerCase().replace(/_/g, '-')
  if (raw === 'codex') return 'codex'
  if (raw === 'claude' || raw === 'claude-code' || raw === 'claude_code') return 'claude-code'
  if (raw === 'cursor' || raw === 'cursor-agent') return 'cursor'
  if (raw === 'gemini' || raw === 'gemini-cli') return 'gemini'
  if (raw === 'copilot' || raw === 'github-copilot') return 'copilot'
  if (raw === 'grok') return 'grok'
  if (raw === 'opencode' || raw === 'open-code') return 'opencode'
  if (raw === 'codebuddy') return 'codebuddy'
  if (raw === 'factory') return 'factory'
  if (raw === 'qoder') return 'qoder'
  if (raw === 'amp') return 'amp'
  if (raw === 'pi') return 'pi'
  if (raw === 'omp') return 'omp'
  if (raw === 'kiro' || raw === 'kiro-cli') return 'kiro'
  if (raw === 'rovodev' || raw === 'rovo' || raw === 'rovo-dev') return 'rovodev'
  return null
}

export const agentHookCommandFor = (
  source: AgentHookInstallerSource,
  hookEvent: string,
  scriptPath: string,
  platform: PlatformRuntime = process.platform,
  jsRuntimeExecutable = defaultJsRuntimeExecutable()
) => {
  const script = cleanText(scriptPath)
  if (!script) throw new AgentHookInstallerError('AGENT_HOOK_SCRIPT_MISSING', 'Agent hook helper path is unavailable.')
  const runtime = cleanText(jsRuntimeExecutable)
  if (!runtime) throw new AgentHookInstallerError('AGENT_HOOK_RUNTIME_MISSING', 'aiopsterm JavaScript runtime path is unavailable.')
  const normalizedSource = normalizeSource(source) || source
  const waitDecision = normalizedSource === 'claude-code' && (hookEvent === 'PermissionRequest' || hookEvent === 'AskUserQuestion')
  if (isWindowsPlatform(platform)) {
    const dispatch = [
      windowsCommandDoubleQuote(runtime),
      windowsCommandDoubleQuote(script),
      '--source',
      windowsCommandDoubleQuote(normalizedSource),
      '--event',
      windowsCommandDoubleQuote(hookEvent),
      ...(waitDecision ? ['--wait-decision', '--wait-timeout-ms', '120000'] : [])
    ].join(' ')
    return `set ELECTRON_RUN_AS_NODE=1&& set AIOPSTERM_AGENT_HOOK_MARKER=${ownedMarker}&& ${dispatch} || echo {}`
  }
  const dispatch = [
    'ELECTRON_RUN_AS_NODE=1',
    `AIOPSTERM_AGENT_HOOK_MARKER=${ownedMarker}`,
    shellSingleQuote(runtime),
    shellSingleQuote(script),
    `--source ${shellSingleQuote(normalizedSource)}`,
    `--event ${shellSingleQuote(hookEvent)}`,
    ...(waitDecision ? ['--wait-decision', '--wait-timeout-ms 120000'] : [])
  ].join(' ')
  return `${dispatch} || echo '{}'`
}

export const isPlainObject = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))

export const parseConfigJson = (raw: string, path: string): Record<string, unknown> => {
  if (!cleanText(raw)) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!isPlainObject(parsed)) throw new Error('JSON root must be an object.')
    return parsed
  } catch (error) {
    throw new AgentHookInstallerError('AGENT_HOOK_CONFIG_JSON_INVALID', `${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export const prettyJson = (value: Record<string, unknown>) => `${JSON.stringify(value, null, 2)}\n`

export const isOwnedHookCommand = (command: unknown) => typeof command === 'string' && command.includes(ownedMarker)

export const isOwnedFileHook = (content: unknown) => typeof content === 'string' && content.includes(fileHookMarker)

const commandRuntimeSnippet = (source: AgentHookInstallerSource, eventExpression: string, extraArgs = '[]') => `
const { spawnSync } = require('node:child_process')

const marker = ${JSON.stringify(fileHookMarker)}
const source = ${JSON.stringify(source)}
const cleanText = (value) => (typeof value === 'string' ? value.trim() : '')
const helper = () => cleanText(process.env.AIOPSTERM_AGENT_HOOK_PATH)
const runtime = () => cleanText(process.env.AIOPSTERM_JS_RUNTIME) || process.execPath
const canReport = () => process.env.AIOPSTERM_MANAGED_TERMINAL === '1' && cleanText(process.env.AIOPSTERM_AGENT_SOCKET_PATH) && helper()
const report = (event, payload = {}) => {
  if (!canReport()) return
  const args = [helper(), '--source', source, '--event', event, ...${extraArgs}]
  spawnSync(runtime(), args, {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', AIOPSTERM_AGENT_HOOK_MARKER: marker },
    timeout: 2000,
    stdio: ['pipe', 'ignore', 'ignore']
  })
}
`

export const pluginFileContentFor = (definition: AgentHookDefinition) => {
  const header = `// ${fileHookMarker}\n// Installed by aiopsterm Agent Hook installer. Do not edit manually.\n`
  if (definition.fileTemplate === 'opencode') {
    return `${header}${commandRuntimeSnippet('opencode', 'event')}

module.exports = async function aiopstermOpenCodePlugin(app) {
  const on = app && typeof app.on === 'function' ? app.on.bind(app) : null
  if (!on) return
  on('session.start', (event) => report('SessionStart', event || {}))
  on('message.part.updated', (event) => report('lifecycle', { ...(event || {}), status: 'running' }))
  on('tool.execute.before', (event) => report('PreToolUse', event || {}))
  on('tool.execute.after', (event) => report('PostToolUse', event || {}))
  on('session.idle', (event) => report('lifecycle', { ...(event || {}), status: 'idle' }))
}
`
  }
  if (definition.fileTemplate === 'amp') {
    return `${header}import type { PluginAPI } from '@ampcode/plugin'
${commandRuntimeSnippet('amp', 'event').replace("const { spawnSync } = require('node:child_process')", "import { spawnSync } from 'node:child_process'")}

export default function aiopstermAmpPlugin(amp: PluginAPI) {
  amp.on('session.start', async (event: unknown) => report('SessionStart', event || {}))
  amp.on('agent.start', async (event: unknown) => report('lifecycle', { ...(event as object || {}), status: 'running' }))
  amp.on('tool.call', async (event: unknown) => report('PreToolUse', event || {}))
  amp.on('agent.end', async (event: unknown) => report('stop', event || {}))
}
`
  }
  if (definition.fileTemplate === 'pi' || definition.fileTemplate === 'omp') {
    const source = definition.fileTemplate
    return `${header}import { spawnSync } from 'node:child_process'
${commandRuntimeSnippet(source, 'event').replace("const { spawnSync } = require('node:child_process')", '')}

export default function aiopstermExtension(agent: { on?: (event: string, handler: (payload: unknown) => void) => void }) {
  if (!agent || typeof agent.on !== 'function') return
  agent.on('session.start', (event: unknown) => report('SessionStart', event || {}))
  agent.on('agent.start', (event: unknown) => report('lifecycle', { ...(event as object || {}), status: 'running' }))
  agent.on('tool.call', (event: unknown) => report('PreToolUse', event || {}))
  agent.on('agent.end', (event: unknown) => report('stop', event || {}))
}
`
  }
  throw new AgentHookInstallerError('AGENT_HOOK_TEMPLATE_UNSUPPORTED', `Agent hook template for ${definition.source} is not supported.`)
}

const hookEntry = (
  definition: AgentHookDefinition,
  event: HookCommandEvent,
  scriptPath: string,
  platform: PlatformRuntime = process.platform,
  jsRuntimeExecutable = defaultJsRuntimeExecutable()
) => ({
  type: 'command',
  command: agentHookCommandFor(definition.source, event.hookEvent, scriptPath, platform, jsRuntimeExecutable),
  timeout: event.timeout
})

const groupedHookEntry = (
  definition: AgentHookDefinition,
  event: HookCommandEvent,
  scriptPath: string,
  platform: PlatformRuntime = process.platform,
  jsRuntimeExecutable = defaultJsRuntimeExecutable()
) => ({
  ...(definition.source === 'codex' ? {} : { matcher: '' }),
  hooks: [hookEntry(definition, event, scriptPath, platform, jsRuntimeExecutable)]
})

const flatHookEntry = (
  definition: AgentHookDefinition,
  event: HookCommandEvent,
  scriptPath: string,
  platform: PlatformRuntime = process.platform,
  jsRuntimeExecutable = defaultJsRuntimeExecutable()
) => ({
  command: agentHookCommandFor(definition.source, event.hookEvent, scriptPath, platform, jsRuntimeExecutable),
  timeout: event.timeout
})

const kiroHookEntry = (
  definition: AgentHookDefinition,
  event: HookCommandEvent,
  scriptPath: string,
  platform: PlatformRuntime = process.platform,
  jsRuntimeExecutable = defaultJsRuntimeExecutable()
) => ({
  command: agentHookCommandFor(definition.source, event.hookEvent, scriptPath, platform, jsRuntimeExecutable),
  timeout_ms: Math.max(1, event.timeout * 1000)
})

export const removeOwnedHooksFromGroups = (value: unknown) => {
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
  install: boolean,
  platform: PlatformRuntime = process.platform,
  jsRuntimeExecutable = defaultJsRuntimeExecutable()
): { config: Record<string, unknown>; removed: number } => {
  const next: Record<string, unknown> = { ...existing }
  const rawHooks = isPlainObject(next.hooks) ? next.hooks : {}
  const hooks: Record<string, unknown> = { ...rawHooks }
  let removed = 0

  for (const eventName of Object.keys(hooks)) {
    const result = definition.flatHooks || definition.kiroAgentJson ? removeOwnedHooksFromFlatEntries(hooks[eventName]) : removeOwnedHooksFromGroups(hooks[eventName])
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
      hooks[event.agentEvent] = [
        ...existingGroups,
        definition.kiroAgentJson
          ? kiroHookEntry(definition, event, scriptPath, platform, jsRuntimeExecutable)
          : definition.flatHooks
            ? flatHookEntry(definition, event, scriptPath, platform, jsRuntimeExecutable)
            : groupedHookEntry(definition, event, scriptPath, platform, jsRuntimeExecutable)
      ]
    }
  }

  if (Object.keys(hooks).length) next.hooks = hooks
  else delete next.hooks
  if (definition.flatHooks && install) next.version = typeof next.version === 'number' ? next.version : 1
  if (definition.kiroAgentJson && install) {
    next.name = cleanOptionalString(next.name) || 'aiopsterm'
    next.description = cleanOptionalString(next.description) || 'aiopsterm notification and managed AI session hooks.'
    if (!Array.isArray(next.tools)) next.tools = ['*']
  }
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
    AskUserQuestion: 'ask_user_question',
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

export const installCodexHookTrust = (content: string, configPath: string, hooks: Record<string, unknown>) => {
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

export const configHasOwnedHooks = (config: Record<string, unknown>) => {
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

export const configHasOwnedOpenCodePlugin = (config: Record<string, unknown>) =>
  Array.isArray(config.plugin) && config.plugin.some((entry) => cleanText(entry) === openCodePluginSpec || cleanText(entry).endsWith('/plugins/aiopsterm-session.js'))

export const mergeOpenCodePluginRegistration = (existing: Record<string, unknown>, install: boolean) => {
  const next = { ...existing }
  const plugin = (Array.isArray(next.plugin) ? next.plugin : []).filter((entry) => cleanText(entry) !== openCodePluginSpec && !cleanText(entry).endsWith('/plugins/aiopsterm-session.js'))
  if (install) plugin.push(openCodePluginSpec)
  if (plugin.length) next.plugin = plugin
  else delete next.plugin
  return next
}

const yamlScalar = (value: string) => JSON.stringify(value)

export const rovoDevYamlHooksBlock = (
  definition: AgentHookDefinition,
  scriptPath: string,
  platform: PlatformRuntime = process.platform,
  jsRuntimeExecutable = defaultJsRuntimeExecutable()
) => {
  const lines = [rovoYamlBegin, 'hooks:']
  for (const event of definition.events) {
    lines.push(`  ${event.agentEvent}:`)
    lines.push(`    - command: ${yamlScalar(agentHookCommandFor(definition.source, event.hookEvent, scriptPath, platform, jsRuntimeExecutable))}`)
    lines.push(`      timeout: ${Math.max(1, event.timeout)}`)
  }
  lines.push(rovoYamlEnd)
  return `${lines.join('\n')}\n`
}

export const installRovoDevYaml = (
  content: string,
  definition: AgentHookDefinition,
  scriptPath: string,
  platform: PlatformRuntime = process.platform,
  jsRuntimeExecutable = defaultJsRuntimeExecutable()
) => {
  const stripped = removeMarkedBlock(content || '', rovoYamlBegin, rovoYamlEnd).replace(/\s+$/, '')
  const block = rovoDevYamlHooksBlock(definition, scriptPath, platform, jsRuntimeExecutable).replace(/\s+$/, '')
  return `${stripped}${stripped ? '\n\n' : ''}${block}\n`
}

export const uninstallRovoDevYaml = (content: string) => `${removeMarkedBlock(content || '', rovoYamlBegin, rovoYamlEnd).replace(/\s+$/, '')}\n`
