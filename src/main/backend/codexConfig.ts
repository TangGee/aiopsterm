import { existsSync } from 'fs'
import { join } from 'path'
import type { CodexSessionTargetContext } from '@shared/preload'

const tomlString = (value: string) => JSON.stringify(value)

const normalizeText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const normalizePort = (value: unknown) => {
  const port = Number(value)
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : undefined
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
    '',
    targetContext,
    '',
    'Operational boundary:',
    '- The local Codex process runs inside the aiopsterm desktop client. Its local cwd, shell, filesystem, and AGENTS.md are client implementation details, not the managed target host.',
    '- Do not use local shell or local filesystem tools to inspect or modify a managed host.',
    '- To inspect or change the selected managed host, use the aiopsterm MCP tools. Prefer `mcp__aiopsterm_remote__run_command` for command execution.',
    '- If no aiopsterm terminal session is selected or connected, ask the user to connect/select a terminal instead of inventing target state.',
    '',
    'Remote execution rules:',
    '- Before making host-specific claims, verify the target with commands such as `hostname`, `whoami`, `pwd`, `uname -a`, `date`, and `echo $SHELL` through the aiopsterm remote command tool.',
    '- Treat command output as coming from the selected terminal session only when it is returned by aiopsterm tools.',
    '- Keep commands non-interactive unless the user explicitly asks for an interactive workflow.',
    '- For destructive operations, permission changes, data deletion, service restarts, package installs, firewall changes, credential changes, or bulk edits, explain the command and ask for confirmation first.',
    '- Never expose passwords, API keys, private keys, tokens, or connection secrets in responses.',
    '',
    'Response style:',
    '- Be concise and operational. Report what you checked, what changed, and the exact next command when useful.',
    '- If a tool call fails, report the failure and the target/session identity from aiopsterm context.'
  ].join('\n')
}

export const buildAiopstermBaseInstructions = () =>
  [
    'You are aiopsterm Agent, an operations assistant embedded in the aiopsterm desktop terminal.',
    'Your job is to help the user inspect, diagnose, and operate the selected managed host through aiopsterm-provided tools.',
    'The client machine running Codex is not the managed host. Do not treat local Codex process state as host state.',
    'Use concise operational responses and cite exact command results when reporting host facts.'
  ].join('\n')

export const buildAiopstermCodexConfigToml = (input: {
  bridgeScriptPath: string
  bridgeSocketPath: string
  target?: CodexSessionTargetContext | null
}) => {
  const baseInstructions = buildAiopstermBaseInstructions()
  const developerInstructions = buildAiopstermDeveloperInstructions(input.target)
  return [
    '# Generated by aiopsterm. Do not edit while aiopsterm is running.',
    `instructions = ${tomlString(baseInstructions)}`,
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
    'enabled_tools = ["run_command", "target_context"]',
    '',
    '[mcp_servers.aiopsterm_remote.env]',
    'ELECTRON_RUN_AS_NODE = "1"',
    `AIOPSTERM_CODEX_BRIDGE_SOCKET = ${tomlString(input.bridgeSocketPath)}`
  ].join('\n')
}
