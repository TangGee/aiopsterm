import { existsSync } from 'fs'
import { join } from 'path'
import type { CodexSessionTargetContext } from '@shared/contracts/codexSessions'
import type { UserConfig } from '@shared/contracts/userConfig'
import { resolveModelProvider } from '../ai/modelProviderText'

const codexOpenAiProviderId = 'aiopsterm_openai_responses'
const codexOpenAiApiKeyEnv = 'AIOPSTERM_CODEX_API_KEY'
const codexSupportedBedrockModels = new Set(['openai.gpt-5.5', 'openai.gpt-5.4'])

const tomlString = (value: string) => JSON.stringify(value)

const normalizeText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const normalizePort = (value: unknown) => {
  const port = Number(value)
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : undefined
}

export type AiopstermCodexProviderConfig = {
  providerId: string
  model: string
  name?: string
  baseUrl?: string
  apiKeyEnv?: string
  apiKey?: string
  awsRegion?: string
  env?: Record<string, string>
}

const normalizeOpenAiBaseUrl = (baseUrl: string) => {
  if (!baseUrl) return ''
  const skipVersionPrefix = baseUrl.endsWith('#')
  const normalizedBaseUrl = skipVersionPrefix ? baseUrl.slice(0, -1) : baseUrl
  try {
    const parsed = new URL(normalizedBaseUrl)
    const hasVersionSegment = parsed.pathname.split('/').filter(Boolean).some((segment) => /^v\d+$/i.test(segment))
    if (!skipVersionPrefix && !hasVersionSegment) parsed.pathname = `${parsed.pathname.replace(/\/$/, '')}/v1`
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return normalizedBaseUrl
  }
}

export const normalizeCodexResponsesBaseUrl = (baseUrl: string) => {
  const normalized = normalizeOpenAiBaseUrl(baseUrl)
  if (!normalized) return ''
  try {
    const parsed = new URL(normalized)
    const segments = parsed.pathname.split('/').filter(Boolean)
    if (segments[segments.length - 1] === 'responses') {
      parsed.pathname = `/${segments.slice(0, -1).join('/')}`
      return parsed.toString().replace(/\/$/, '')
    }
    if (segments[segments.length - 2] === 'chat' && segments[segments.length - 1] === 'completions') {
      parsed.pathname = `/${segments.slice(0, -2).join('/')}`
      return parsed.toString().replace(/\/$/, '')
    }
  } catch {
    // Keep the normalized raw value if URL parsing failed above.
  }
  return normalized
}

const normalizeCodexOssBaseUrl = (baseUrl: string, fallback: string) => {
  const normalized = normalizeCodexResponsesBaseUrl(normalizeText(baseUrl) || fallback)
  return normalized || fallback
}

const hasAwsAuthConfig = (providerConfig: NonNullable<ReturnType<typeof resolveModelProvider>>['config']) =>
  Boolean(
    normalizeText(providerConfig.apiKey) ||
      normalizeText(providerConfig.awsAccessKey) ||
      normalizeText(providerConfig.awsSecretKey) ||
      normalizeText(providerConfig.awsSessionToken)
  )

const resolveBedrockCodexProviderConfig = (
  providerConfig: NonNullable<ReturnType<typeof resolveModelProvider>>['config'],
  modelName: string
): AiopstermCodexProviderConfig | null => {
  const model = normalizeText(providerConfig.modelId) || normalizeText(modelName)
  if (!codexSupportedBedrockModels.has(model)) return null
  const awsRegion = normalizeText(providerConfig.awsRegion) || 'us-east-1'
  const env: Record<string, string> = {
    AWS_REGION: awsRegion,
    AWS_DEFAULT_REGION: awsRegion
  }
  const bedrockApiKey = normalizeText(providerConfig.apiKey)
  const accessKey = normalizeText(providerConfig.awsAccessKey)
  const secretKey = normalizeText(providerConfig.awsSecretKey)
  const sessionToken = normalizeText(providerConfig.awsSessionToken)
  if (bedrockApiKey) env.AWS_BEARER_TOKEN_BEDROCK = bedrockApiKey
  if (accessKey) env.AWS_ACCESS_KEY_ID = accessKey
  if (secretKey) env.AWS_SECRET_ACCESS_KEY = secretKey
  if (sessionToken) env.AWS_SESSION_TOKEN = sessionToken
  return {
    providerId: 'amazon-bedrock',
    model,
    awsRegion,
    ...(hasAwsAuthConfig(providerConfig) ? { env } : { env: { AWS_REGION: awsRegion, AWS_DEFAULT_REGION: awsRegion } })
  }
}

export const resolveAiopstermCodexProviderConfig = (config?: UserConfig | null): AiopstermCodexProviderConfig | null => {
  if (!config) return null
  const resolved = resolveModelProvider(config)
  if (resolved?.provider === 'ollama') {
    const model = normalizeText(resolved.config.modelId) || normalizeText(resolved.modelName)
    if (model) {
      return {
        providerId: 'ollama',
        model,
        env: {
          CODEX_OSS_BASE_URL: normalizeCodexOssBaseUrl(resolved.config.baseUrl, 'http://localhost:11434/v1')
        }
      }
    }
  }
  if (resolved?.provider === 'lmstudio') {
    const model = normalizeText(resolved.config.modelId) || normalizeText(resolved.modelName)
    if (model) {
      return {
        providerId: 'lmstudio',
        model,
        env: {
          CODEX_OSS_BASE_URL: normalizeCodexOssBaseUrl(resolved.config.baseUrl, 'http://localhost:1234/v1')
        }
      }
    }
  }
  if (resolved?.provider === 'bedrock') {
    const provider = resolveBedrockCodexProviderConfig(resolved.config, resolved.modelName)
    if (provider) return provider
  }
  const fallbackOpenAi = config.modelSettings?.providers?.openai
  const providerConfig = resolved?.provider === 'openai' ? resolved.config : fallbackOpenAi
  if (!providerConfig || providerConfig.apiFormat !== 'responses') return null
  const model = normalizeText(providerConfig.modelId) || (resolved?.provider === 'openai' ? normalizeText(resolved.modelName) : '')
  const apiKey = normalizeText(providerConfig.apiKey)
  const baseUrl = normalizeCodexResponsesBaseUrl(normalizeText(providerConfig.baseUrl) || 'https://api.openai.com')
  if (!model || !apiKey || !baseUrl) return null
  return {
    providerId: codexOpenAiProviderId,
    name: 'aiopsterm OpenAI-compatible Responses',
    model,
    baseUrl,
    apiKeyEnv: codexOpenAiApiKeyEnv,
    apiKey,
    env: {
      [codexOpenAiApiKeyEnv]: apiKey
    }
  }
}

export const normalizeCodexTargetContext = (target?: CodexSessionTargetContext | null): CodexSessionTargetContext => {
  const kind = target?.kind === 'local' || target?.kind === 'ssh' ? target.kind : 'unknown'
  const panelId = normalizeText(target?.panelId)
  const sessionId = normalizeText(target?.sessionId)
  const host = normalizeText(target?.host)
  const username = normalizeText(target?.username)
  const assetName = normalizeText(target?.assetName)
  const cwd = normalizeText(target?.cwd)
  const label = normalizeText(target?.label) || assetName || (host && username ? `${username}@${host}` : host) || (kind === 'local' ? 'Local terminal' : 'Selected terminal')
  return {
    kind,
    ...(panelId ? { panelId } : {}),
    ...(sessionId ? { sessionId } : {}),
    label,
    ...(host ? { host } : {}),
    ...(normalizePort(target?.port) ? { port: normalizePort(target?.port) } : {}),
    ...(username ? { username } : {}),
    ...(normalizeText(target?.assetId) ? { assetId: normalizeText(target?.assetId) } : {}),
    ...(assetName ? { assetName } : {}),
    ...(cwd ? { cwd } : {})
  }
}

export const renderCodexTargetContext = (target?: CodexSessionTargetContext | null) => {
  const normalized = normalizeCodexTargetContext(target)
  const lines = [
    '<aiopsterm_target_context>',
    `kind: ${normalized.kind || 'unknown'}`,
    `label: ${normalized.label || 'Selected terminal'}`
  ]
  if (normalized.sessionId) lines.push(`terminal_session_id: ${normalized.sessionId}`)
  if (normalized.panelId) lines.push(`workspace_unit_id: ${normalized.panelId}`)
  if (normalized.host) lines.push(`host: ${normalized.host}`)
  if (normalized.port) lines.push(`port: ${normalized.port}`)
  if (normalized.username) lines.push(`username: ${normalized.username}`)
  if (normalized.assetName) lines.push(`asset_name: ${normalized.assetName}`)
  if (normalized.cwd) lines.push(`cwd_hint: ${normalized.cwd}`)
  lines.push('</aiopsterm_target_context>')
  return lines.join('\n')
}

export const codexBridgeScriptPath = (appPath: string, resourcesPath: string) => {
  const scriptName = 'codex-aiopsterm-mcp.js'
  const candidates = [
    join(appPath, 'resources', scriptName),
    join(resourcesPath, scriptName),
    join(resourcesPath, 'resources', scriptName)
  ]
  return candidates.find((candidate) => existsSync(candidate)) || candidates[0]
}

export const buildAiopstermDeveloperInstructions = (target?: CodexSessionTargetContext | null) => {
  const targetContext = renderCodexTargetContext(target)
  return [
    'You are the embedded aiopsterm operations agent. aiopsterm manages real terminal sessions to local or remote hosts.',
    'You act like a senior production systems administrator: protect data, minimize service disruption, and verify facts from the selected host before making host-specific claims.',
    '',
    targetContext,
    '',
    'Operational boundary:',
    '- The local Codex process runs inside the aiopsterm desktop client. Its local cwd, shell, filesystem, and AGENTS.md are client implementation details, not the managed target host.',
    '- aiopsterm disables Codex environment-context injection for this embedded mode. If you need the target cwd, shell, current date/time, timezone, hostname, network state, or filesystem facts, obtain them from `target_context` and remote read-only commands in the selected terminal.',
    '- Do not use local shell or local filesystem tools to inspect or modify a managed host.',
    '- To inspect or change the selected managed host, use only the aiopsterm MCP tools. `list_terminals` lists visible aiopsterm terminal targets; `target_context` reads the current selected terminal; `run_command` executes in that selected terminal; `read_file`, `glob_search`, and `grep_search` perform bounded read-only file inspection through that terminal.',
    '- The selected terminal can change while this Codex session is running. Call `target_context` before the first command in a task and whenever the target may be ambiguous. Use `list_terminals` when you need to understand available aiopsterm terminal targets.',
    '- If no aiopsterm terminal session is selected or connected, continue in analysis/Q&A mode, provide safe command suggestions when useful, and ask the user to connect or select a terminal before execution.',
    '- Never invent command output, host identity, file contents, process lists, service status, or success/failure state.',
    '',
    'Remote execution rules:',
    '- Before making host-specific claims, verify the target with small read-only commands such as `hostname`, `whoami`, `pwd`, `uname -a`, `date`, and `echo $SHELL` through the aiopsterm remote command tool.',
    '- Treat command output as coming from the selected terminal session only when it is returned by aiopsterm tools.',
    '- Prefer non-interactive commands with bounded output. Use explicit timeouts for commands that may run longer than normal diagnostics.',
    '- Prefer read-only diagnostics first. Use `ps`, `df`, `free`, `uptime`, `systemctl status`, `journalctl -n`, `tail`, `ss`, and similar inspection commands before proposing changes.',
    '- For destructive operations, permission changes, data deletion, service restarts, package installs, firewall changes, credential changes, network/firewall changes, or bulk edits, explain the risk and wait for explicit user confirmation before running the command.',
    '- If aiopsterm reports `command_blocked`, `SECURITY_BLOCKED`, or a message saying the command was blocked by security policy, stop that operation, acknowledge the block, and do not suggest bypasses or equivalent alternate commands.',
    '- Never expose passwords, API keys, private keys, tokens, or connection secrets in responses.',
    '- If a command returns output that looks like an authentication prompt, password prompt, full-screen program, editor, pager, or other interactive state, stop and ask the user how to proceed instead of sending blind input.',
    '',
    'Response style:',
    '- Be concise and operational. Report what you checked, what changed, and the exact next command when useful.',
    '- Distinguish verified command output from inference. State the selected target label/session when it matters.',
    '- If a tool call fails, report the failure and the target/session identity from aiopsterm context.'
  ].join('\n')
}

export const buildAiopstermBaseInstructions = () =>
  [
    'You are aiopsterm Agent, an operations assistant embedded in the aiopsterm desktop terminal.',
    'Your job is to help the user inspect, diagnose, and safely operate the selected managed host through aiopsterm-provided tools.',
    'The client machine running Codex is not the managed host. Do not treat local Codex process state as host state.',
    'Use concise operational responses and cite exact command results when reporting host facts.',
    'Do not fabricate terminal output or host state when aiopsterm has not returned it.'
  ].join('\n')

export const buildAiopstermCodexConfigToml = (input: {
  bridgeScriptPath: string
  bridgeSocketPath: string
  target?: CodexSessionTargetContext | null
  provider?: AiopstermCodexProviderConfig | null
}) => {
  const baseInstructions = buildAiopstermBaseInstructions()
  const developerInstructions = buildAiopstermDeveloperInstructions(input.target)
  const providerSelection = input.provider ? [`model = ${tomlString(input.provider.model)}`, `model_provider = ${tomlString(input.provider.providerId)}`] : []
  const providerTable = input.provider?.baseUrl && input.provider.apiKeyEnv
    ? [
        `[model_providers.${input.provider.providerId}]`,
        `name = ${tomlString(input.provider.name || input.provider.providerId)}`,
        `base_url = ${tomlString(input.provider.baseUrl)}`,
        `env_key = ${tomlString(input.provider.apiKeyEnv)}`,
        'wire_api = "responses"',
        ''
      ]
    : []
  const bedrockTable =
    input.provider?.providerId === 'amazon-bedrock' && input.provider.awsRegion
      ? ['[model_providers.amazon-bedrock.aws]', `region = ${tomlString(input.provider.awsRegion)}`, '']
      : []
  return [
    '# Generated by aiopsterm. Do not edit while aiopsterm is running.',
    `instructions = ${tomlString(baseInstructions)}`,
    ...providerSelection,
    'project_doc_max_bytes = 0',
    'web_search = "disabled"',
    'check_for_update_on_startup = false',
    'include_environment_context = false',
    'include_permissions_instructions = false',
    'include_apps_instructions = false',
    'include_collaboration_mode_instructions = false',
    `developer_instructions = ${tomlString(developerInstructions)}`,
    'approval_policy = "on-request"',
    'sandbox_mode = "read-only"',
    '',
    ...providerTable,
    ...bedrockTable,
    '[features]',
    'shell_tool = false',
    'unified_exec = false',
    'shell_snapshot = false',
    'code_mode = false',
    'apps = false',
    'enable_mcp_apps = false',
    'plugins = false',
    'multi_agent = false',
    'multi_agent_v2 = false',
    'enable_fanout = false',
    'hooks = false',
    'image_generation = false',
    'in_app_browser = false',
    'browser_use = false',
    'browser_use_external = false',
    'computer_use = false',
    'tool_suggest = false',
    'skill_mcp_dependency_install = false',
    'goals = false',
    'workspace_dependencies = false',
    'web_search_request = false',
    'standalone_web_search = false',
    '',
    '[tools.experimental_request_user_input]',
    'enabled = false',
    '',
    '[skills]',
    'include_instructions = false',
    '',
    '[mcp_servers.aiopsterm_remote]',
    `command = ${tomlString(process.execPath)}`,
    `args = [${tomlString(input.bridgeScriptPath)}]`,
    'required = true',
    'startup_timeout_sec = 10',
    'tool_timeout_sec = 180',
    'default_tools_approval_mode = "prompt"',
    'enabled_tools = ["list_terminals", "run_command", "read_file", "glob_search", "grep_search", "target_context"]',
    '',
    '[mcp_servers.aiopsterm_remote.tools.list_terminals]',
    'approval_mode = "approve"',
    '',
    '[mcp_servers.aiopsterm_remote.tools.target_context]',
    'approval_mode = "approve"',
    '',
    '[mcp_servers.aiopsterm_remote.tools.read_file]',
    'approval_mode = "approve"',
    '',
    '[mcp_servers.aiopsterm_remote.tools.glob_search]',
    'approval_mode = "approve"',
    '',
    '[mcp_servers.aiopsterm_remote.tools.grep_search]',
    'approval_mode = "approve"',
    '',
    '[mcp_servers.aiopsterm_remote.tools.run_command]',
    'approval_mode = "prompt"',
    '',
    '[mcp_servers.aiopsterm_remote.env]',
    'ELECTRON_RUN_AS_NODE = "1"',
    `AIOPSTERM_CODEX_BRIDGE_SOCKET = ${tomlString(input.bridgeSocketPath)}`
  ].join('\n')
}
