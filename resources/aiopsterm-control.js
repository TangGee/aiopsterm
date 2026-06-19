#!/usr/bin/env node

const net = require('net')
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const args = process.argv.slice(2)

const usage = () => `aiopsterm-control [--socket <path>] [--json] <command>

Commands:
  ping
  capabilities
  identify
  rpc <method> [--params-json <json>]
  auth login
  settings open [--target <section>]
  feedback open
  sidebar snapshot
  system tree
  app focus-override active|inactive|clear
  app simulate-active
  window list|current|focus|create|close|displays|display
  hooks list|setup|install|uninstall [--agent <name>]
  feed list|mark-handled|clear-ended|clear [--yes]
  workspace snapshot
  workspace list|current
  workspace group <subcommand>
  workspace-group <subcommand>
  session save|list|show|restore|clear [--id <id>] [--name <name>]
  surface list
  surface resume set|show|get|clear|run|trust|preview|autorun [--panel <id>|--session <id>] [--shell <command>] [--kind <kind>] [--checkpoint <id>]
  agent-hibernation on|off|status|preview|sweep [--no-confirm]
  agent hibernate|resume --session <id> [--source <source>]
  agent session list|show|reply|approve|deny|handle|rename|clear [--session <id>] [--source <source>]
  agent vault register|list|get|remove|render|identify|scan
  agent team launch [--source codex|claude-code|custom] [--count <n>] [--cwd <path>] [--prompt <text>] [--command <shell>]
  events [--after <seq>] [--cursor-file <path>] [--name <event>] [--category <category>] [--limit <n>] [--no-ack] [--no-heartbeat]
  tree
  new-workspace [--name <title>] [--cwd <path>] [--no-focus]
  current-workspace
  select-workspace --workspace <panel-id>
  close-workspace --workspace <panel-id>
  list-panels
  list-pane-surfaces [--pane <panel-id>]
  close-surface [--surface <panel-id>]
  new-split [right|below|left|up] [--surface <panel-id>] [--focus <true|false>]
  new-pane [--direction right|below] [--focus <true|false>]
  move-surface --surface <panel-id> [--pane <panel-id>] [--before <panel-id>|--after <panel-id>|--index <n>] [--focus <true|false>]
  reorder-surface --surface <panel-id> [--before <panel-id>|--after <panel-id>|--index <n>] [--focus <true|false>]
  split-off --surface <panel-id> [right|below] [--focus <true|false>]
  refresh-surfaces
  surface-health
  trigger-flash [--surface <panel-id>]
  reorder-workspace --workspace <panel-id> [--before <panel-id>|--after <panel-id>|--index <n>] [--dry-run]
  reorder-workspaces --order <panel-id,panel-id,...> [--dry-run]
  move-workspace-to-window --workspace <panel-id> --window <id>
  list-windows
  current-window
  list-panes
  new-window [--name <title>] [--cwd <path>] [--no-focus]
  split-window [-h|-v] [--target <panel-id>] [--no-focus]
  rename-window [--target <panel-id>] <title>
  kill-window [--target <panel-id>]
  kill-pane [--target <panel-id>]
  has-session [--target <panel-id>]
  select-layout <name>
  terminal list
  terminal focus --panel <id>|--session <id>
  terminal read-screen [--panel <id>|--session <id>] [--lines <n>]
  capture-pane [--panel <id>|--session <id>] [--scrollback] [--lines <n>]
  pipe-pane [--panel <id>|--session <id>] --command <shell-command>
  resize-pane [--pane <id>|--panel <id>] [-L|-R|-U|-D] [--amount <n>]
  swap-pane --pane <id> --target-pane <id> [--focus <true|false>]
  break-pane [--pane <id>|--panel <id>] [--focus <true|false>] [--no-focus]
  join-pane --target-pane <id> [--pane <id>|--panel <id>] [--direction right|below] [--focus <true|false>] [--no-focus]
  next-window | previous-window | last-window
  select-window --target <panel-id>
  select-pane --target <panel-id>
  last-pane
  find-window [--content] [--select] <query>
  clear-history [--panel <id>|--session <id>]
  respawn-pane [--panel <id>|--session <id>] [--command <shell-command>]
  terminal send [--panel <id>|--session <id>] --text <text>
  terminal send-key [--panel <id>|--session <id>] <key>
  send-panel --panel <id> <text>
  send-key-panel --panel <id> <key>
  wait-for [-S|--signal] <name> [--timeout <seconds>]
  display-message [-p|--print] <text>
  set-buffer [--name <name>] <text>
  show-buffer [-b|--name <name>]
  save-buffer [-b|--name <name>] [path]
  paste-buffer [--name <name>] [--panel <id>|--session <id>]
  list-buffers
  show-options [-v] [extended-keys]
  set-hook [--list] [--unset <event>] | <event> <command>
  popup | bind-key | unbind-key | copy-mode
  set-status <key> <value> [--icon <name>] [--color <#hex>] [--priority <n>]
  clear-status <key>
  list-status
  set-progress <0.0-1.0> [--label <text>]
  clear-progress
  log [--level <level>] [--source <name>] <message>
  clear-log
  list-log [--limit <n>]
  sidebar-state
  notify --title <text> [--subtitle <text>] [--body <text>] [--panel <id>] [--session <id>]
  list-notifications
  open-notification --id <id>
  mark-notification-read (--id <id> | --all)
  dismiss-notification (--id <id> | --all-read)
  jump-to-unread
  clear-notifications
`

const readOption = (name) => {
  const index = args.indexOf(name)
  if (index < 0) return ''
  const value = args[index + 1] || ''
  args.splice(index, 2)
  return value
}

const hasFlag = (name) => {
  const index = args.indexOf(name)
  if (index < 0) return false
  args.splice(index, 1)
  return true
}

const unescapeTerminalText = (value) =>
  String(value || '').replace(/\\([nrt\\])/g, (_match, code) => {
    if (code === 'n') return '\n'
    if (code === 'r') return '\r'
    if (code === 't') return '\t'
    return '\\'
  })

const socketPath = readOption('--socket') || process.env.AIOPSTERM_CONTROL_SOCKET || process.env.AIOPSTERM_SOCKET_PATH || ''
const outputJson = hasFlag('--json')

if (args[0] === '--help' || args[0] === '-h') {
  process.stdout.write(usage())
  process.exit(0)
}

const methodParams = () => {
  const command = args.shift() || 'ping'
  if (command === 'ping') return { method: 'ping', params: {} }
  if (command === 'capabilities' || command === 'system-capabilities') return { method: 'system.capabilities', params: {} }
  if (command === 'identify' || command === 'system-identify') return { method: 'system.identify', params: { caller: readCallerParams() } }
  if (command === 'auth') return authMethodParams(args.shift() || 'login')
  if (command === 'settings') return settingsMethodParams(args.shift() || 'open')
  if (command === 'feedback') return feedbackMethodParams(args.shift() || 'open')
  if (command === 'sidebar' && args[0] === 'snapshot') return sidebarSnapshotMethodParams()
  if (command === 'system') return systemMethodParams(args.shift() || 'tree')
  if (command === 'app') return appMethodParams(args.shift() || '')
  if (command === 'window') return windowMethodParams(args.shift() || 'list')
  if (command === 'rpc') {
    const method = args.shift() || ''
    if (!method) throw new Error('rpc requires a method name')
    return { method, params: readJsonParams() }
  }
  if (command === 'hooks' || command === 'hook') return agentHooksMethodParams(args.shift() || 'list')
  if (command === 'feed') return feedMethodParams(args.shift() || 'list')
  if (command === 'workspace') {
    const subcommand = args.shift() || 'snapshot'
    if (subcommand === 'snapshot') return { method: 'workspace.snapshot', params: {} }
    if (subcommand === 'list') return { method: 'workspace.list', params: {} }
    if (subcommand === 'current') return { method: 'workspace.current', params: {} }
    if (subcommand === 'group') return workspaceGroupMethodParams(args.shift() || 'list')
    throw new Error(`Unknown workspace command: ${subcommand}`)
  }
  if (command === 'workspace-group') return workspaceGroupMethodParams(args.shift() || 'list')
  if (command === 'session' || command === 'restore-session') return sessionMethodParams(command === 'restore-session' ? 'restore' : args.shift() || 'list')
  if (command === 'agent-session' || command === 'ai-session' || command === 'ai-sessions') return agentSessionMethodParams(args.shift() || 'list')
  if (command === 'surface') {
    const subcommand = args.shift() || 'list'
    if (subcommand === 'list') return { method: 'surface.list', params: {} }
    if (subcommand === 'current') return { method: 'surface.current', params: {} }
    if (subcommand === 'resume') return surfaceResumeMethodParams(args.shift() || 'show')
    throw new Error(`Unknown surface command: ${subcommand}`)
  }
  if (command === 'agent-hibernation') {
    const subcommand = args.shift() || 'status'
    if (subcommand === 'on' || subcommand === 'enable') return { method: 'agent-hibernation.on', params: {} }
    if (subcommand === 'off' || subcommand === 'disable') return { method: 'agent-hibernation.off', params: {} }
    if (subcommand === 'status') return { method: 'agent-hibernation.status', params: {} }
    if (subcommand === 'preview') return { method: 'agent-hibernation.preview', params: {} }
    if (subcommand === 'sweep' || subcommand === 'reap') {
      const confirm = !(hasFlag('--no-confirm') || hasFlag('--force'))
      return { method: 'agent-hibernation.sweep', params: { confirm, reason: readOption('--reason') } }
    }
    throw new Error(`Unknown agent-hibernation command: ${subcommand}`)
  }
  if (command === 'agent') {
    const subcommand = args.shift() || 'status'
    if (subcommand === 'status') return { method: 'agent.status', params: {} }
    if (subcommand === 'hooks' || subcommand === 'hook') return agentHooksMethodParams(args.shift() || 'list')
    if (subcommand === 'session' || subcommand === 'sessions' || subcommand === 'ai-session') return agentSessionMethodParams(args.shift() || 'list')
    if (subcommand === 'vault' || subcommand === 'agent-vault') return agentVaultMethodParams(args.shift() || 'list')
    if (subcommand === 'team' || subcommand === 'teams') {
      const action = args.shift() || 'launch'
      if (action === 'launch' || action === 'start') {
        const source = readOption('--source') || readOption('--agent') || 'codex'
        const count = Number(readOption('--count') || readOption('-n') || 2)
        const cwd = readOption('--cwd') || readOption('-C')
        const prompt = readOption('--prompt') || readOption('-p')
        const commandText = readOption('--command') || readOption('--shell')
        const name = readOption('--name') || readOption('--group-name')
        return {
          method: 'agent.team.launch',
          params: {
            source,
            count,
            cwd,
            prompt,
            command: commandText,
            name,
            groupName: name
          }
        }
      }
      throw new Error(`Unknown agent team command: ${action}`)
    }
    if (subcommand === 'preview' || subcommand === 'sweep' || subcommand === 'reap') {
      const action = subcommand === 'reap' ? 'sweep' : subcommand
      const confirm = !(hasFlag('--no-confirm') || hasFlag('--force'))
      return { method: `agent.${action}`, params: { confirm, reason: readOption('--reason') } }
    }
    if (subcommand === 'hibernate' || subcommand === 'resume') {
      const sessionId = readOption('--session') || readOption('--session-id') || args.find((arg) => !arg.startsWith('--')) || ''
      const source = readOption('--source') || readOption('--agent')
      const reason = readOption('--reason')
      return { method: `agent.${subcommand}`, params: { sessionId, session_id: sessionId, source, reason } }
    }
    throw new Error(`Unknown agent command: ${subcommand}`)
  }
  if (command === 'events' || command === 'event') return eventStreamMethodParams()
  if (command === 'wait-for' || command === 'wait_for') return waitForMethodParams()
  if (command === 'display-message' || command === 'display' || command === 'displayp') return displayMessageMethodParams()
  if (['set-buffer', 'paste-buffer', 'list-buffers', 'show-buffer', 'showb', 'save-buffer', 'saveb'].includes(command)) return terminalBufferMethodParams(command)
  if (['show-options', 'show-option', 'show', 'set-hook', 'set-option', 'set', 'set-window-option', 'setw', 'source-file', 'refresh-client', 'attach-session', 'detach-client', 'popup', 'bind-key', 'unbind-key', 'copy-mode'].includes(command)) {
    return tmuxCompatMethodParams(command)
  }
  if (['set-status', 'clear-status', 'list-status', 'set-progress', 'clear-progress', 'log', 'clear-log', 'list-log', 'sidebar-state'].includes(command)) return sidebarMetadataMethodParams(command)
  if (['resize-pane', 'resizep', 'swap-pane', 'swapp', 'break-pane', 'breakp', 'join-pane', 'joinp'].includes(command)) return paneLayoutMethodParams(command)
  if (
    [
      'move-surface',
      'reorder-surface',
      'split-off',
      'drag-surface-to-split',
      'refresh-surfaces',
      'surface-health',
      'trigger-flash',
      'reorder-workspace',
      'reorder-workspaces',
      'move-workspace-to-window'
    ].includes(command)
  ) {
    return surfaceOperationMethodParams(command)
  }
  if (['new-workspace', 'current-workspace', 'select-workspace', 'close-workspace', 'list-panels', 'list-pane-surfaces', 'close-surface', 'new-split', 'new-pane'].includes(command)) {
    return surfaceWorkspaceAliasMethodParams(command)
  }
  if (['next-window', 'nextw', 'previous-window', 'prev-window', 'previousw', 'prevw', 'last-window', 'lastw', 'select-window', 'selectw', 'select-pane', 'selectp', 'focus-pane', 'last-pane', 'lastp', 'find-window', 'findw'].includes(command)) {
    return paneNavigationMethodParams(command)
  }
  if (['list-windows', 'lsw', 'current-window', 'currentw', 'list-panes', 'lsp', 'new-window', 'neww', 'split-window', 'splitw', 'rename-window', 'renamew', 'rename-workspace', 'kill-window', 'killw', 'kill-pane', 'killp', 'has-session', 'has', 'select-layout'].includes(command)) {
    return paneManagementMethodParams(command)
  }
  if (command === 'tree') return { method: 'workspace.snapshot', params: { format: 'tree' } }
  if (command === 'list-workspaces') return { method: 'workspace.list', params: {} }
  if (command === 'list-surfaces') return { method: 'surface.list', params: {} }
  if (command === 'list-terminals' || (command === 'terminal' && args[0] === 'list')) {
    if (command === 'terminal') args.shift()
    return { method: 'terminal.list', params: {} }
  }
  if (command === 'focus-panel' || command === 'focus-terminal' || (command === 'terminal' && args[0] === 'focus')) {
    if (command === 'terminal') args.shift()
    const panelId = readOption('--panel') || readOption('--panel-id')
    const sessionId = readOption('--session') || readOption('--session-id')
    return { method: 'terminal.focus', params: { panelId, sessionId } }
  }
  if (command === 'read-screen' || command === 'capture-pane' || (command === 'terminal' && args[0] === 'read-screen')) {
    if (command === 'terminal') args.shift()
    const panelId = readOption('--panel') || readOption('--panel-id')
    const sessionId = readOption('--session') || readOption('--session-id')
    const lines = Number(readOption('--lines') || readOption('--tail-lines') || 0)
    const scrollback = command === 'capture-pane' && hasFlag('--scrollback')
    return { method: 'terminal.read_screen', params: { panelId, surfaceId: panelId, sessionId, scrollback, ...(Number.isFinite(lines) && lines > 0 ? { tailLines: lines, lines: Math.floor(lines) } : {}) } }
  }
  if (command === 'pipe-pane') {
    const panelId = readOption('--panel') || readOption('--panel-id') || readOption('--surface') || readOption('--surface-id')
    const sessionId = readOption('--session') || readOption('--session-id')
    const lines = Number(readOption('--lines') || 0)
    const pipeCommand = readOption('--command') || args.join(' ')
    return {
      method: 'terminal.read_screen',
      params: {
        panelId,
        surfaceId: panelId,
        sessionId,
        scrollback: true,
        ...(Number.isFinite(lines) && lines > 0 ? { tailLines: Math.floor(lines), lines: Math.floor(lines) } : {})
      },
      pipe: {
        command: pipeCommand
      }
    }
  }
  if (command === 'clear-history') {
    const panelId = readOption('--panel') || readOption('--panel-id') || readOption('--surface') || readOption('--surface-id')
    const sessionId = readOption('--session') || readOption('--session-id')
    return { method: 'surface.clear_history', params: { panelId, surfaceId: panelId, sessionId, terminalSessionId: sessionId } }
  }
  if (command === 'respawn-pane') {
    const panelId = readOption('--panel') || readOption('--panel-id') || readOption('--surface') || readOption('--surface-id')
    const sessionId = readOption('--session') || readOption('--session-id')
    const commandText = readOption('--command') || readOption('--shell') || args.filter((arg) => arg !== '--').join(' ')
    return { method: 'surface.respawn', params: { panelId, surfaceId: panelId, sessionId, terminalSessionId: sessionId, command: commandText, tmux_start_command: commandText } }
  }
  if (command === 'send' || command === 'send-panel' || (command === 'terminal' && args[0] === 'send')) {
    if (command === 'terminal') args.shift()
    const panelId = readOption('--panel') || readOption('--panel-id') || readOption('--surface') || readOption('--surface-id')
    const sessionId = readOption('--session') || readOption('--session-id')
    const text = unescapeTerminalText(readOption('--text') || args.join(' '))
    return { method: 'terminal.send_text', params: { panelId, surfaceId: panelId, sessionId, terminalSessionId: sessionId, text } }
  }
  if (command === 'send-key' || command === 'send-key-panel' || (command === 'terminal' && args[0] === 'send-key')) {
    if (command === 'terminal') args.shift()
    const panelId = readOption('--panel') || readOption('--panel-id') || readOption('--surface') || readOption('--surface-id')
    const sessionId = readOption('--session') || readOption('--session-id')
    const key = readOption('--key') || args.find((arg) => arg !== '--' && !arg.startsWith('--')) || ''
    return { method: 'terminal.send_key', params: { panelId, surfaceId: panelId, sessionId, terminalSessionId: sessionId, key } }
  }
  if (command === 'notify') {
    const title = readOption('--title') || 'Notification'
    const subtitle = readOption('--subtitle')
    const body = readOption('--body')
    const panelId = readOption('--panel') || readOption('--surface')
    const sessionId = readOption('--session') || readOption('--session-id')
    return { method: 'notification.create', params: { title, subtitle, body, panelId, sessionId } }
  }
  if (command === 'list-notifications') return { method: 'notification.list', params: {} }
  if (command === 'open-notification') return { method: 'notification.open', params: { id: readOption('--id') } }
  if (command === 'jump-to-unread') return { method: 'notification.jump_to_unread', params: {} }
  if (command === 'clear-notifications') return { method: 'notification.clear', params: {} }
  if (command === 'mark-notification-read') return { method: 'notification.mark_read', params: { id: readOption('--id'), all: hasFlag('--all') } }
  if (command === 'dismiss-notification') return { method: 'notification.dismiss', params: { id: readOption('--id'), allRead: hasFlag('--all-read') } }
  throw new Error(`Unknown command: ${command}`)
}

const agentVaultMethodParams = (subcommand) => {
  if (subcommand === 'list') return { method: 'agent.vault.list', params: {} }
  if (subcommand === 'register' || subcommand === 'set') {
    const id = readOption('--id') || readOption('--agent') || args.find((arg) => !arg.startsWith('--')) || ''
    const launchCommand = readOption('--launch-command') || readOption('--launch') || readOption('--command') || readOption('--shell')
    const resumeCommand = readOption('--resume-command') || readOption('--resume')
    const forkCommand = readOption('--fork-command') || readOption('--fork')
    const processName = readOption('--process-name')
    const argvContains = readRepeatOptions(['--argv-contains'])
    const commandContains = readRepeatOptions(['--command-contains'])
    const executableContains = readOption('--executable-contains')
    const sessionOption = readOption('--session-option')
    const sessionEnv = readOption('--session-env')
    const sessionSource = sessionOption
      ? { type: 'argvOption', argvOption: sessionOption }
      : sessionEnv
        ? { type: 'env', envVar: sessionEnv }
        : undefined
    return {
      method: 'agent.vault.register',
      params: {
        id,
        name: readOption('--name') || id,
        description: readOption('--description'),
        executable: readOption('--executable'),
        detect:
          processName || argvContains.length || commandContains.length || executableContains
            ? {
                processName,
                argvContains,
                commandContains,
                executableContains
              }
            : undefined,
        processName,
        process_name: processName,
        argvContains,
        argv_contains: argvContains,
        commandContains,
        command_contains: commandContains,
        executableContains,
        executable_contains: executableContains,
        sessionIdSource: sessionSource,
        session_id_source: sessionSource,
        launchCommand,
        launch_command: launchCommand,
        resumeCommand,
        resume_command: resumeCommand,
        forkCommand,
        fork_command: forkCommand,
        sessionDirectory: readOption('--session-directory') || readOption('--session-dir'),
        cwd: readOption('--cwd-mode') || readOption('--cwd'),
        icon: readOption('--icon')
      }
    }
  }
  if (subcommand === 'get' || subcommand === 'show') {
    const id = readOption('--id') || readOption('--agent') || args.find((arg) => !arg.startsWith('--')) || ''
    return { method: 'agent.vault.get', params: { id } }
  }
  if (subcommand === 'remove' || subcommand === 'delete' || subcommand === 'unset') {
    const id = readOption('--id') || readOption('--agent') || args.find((arg) => !arg.startsWith('--')) || ''
    return { method: 'agent.vault.remove', params: { id } }
  }
  if (subcommand === 'render') {
    const id = readOption('--id') || readOption('--agent') || args.find((arg) => !arg.startsWith('--')) || ''
    return {
      method: 'agent.vault.render',
      params: {
        id,
        kind: readOption('--kind') || 'launch',
        cwd: readOption('--cwd'),
        prompt: readOption('--prompt'),
        role: readOption('--role'),
        model: readOption('--model'),
        index: readOption('--index'),
        count: readOption('--count'),
        sessionId: readOption('--session') || readOption('--session-id'),
        sessionPath: readOption('--session-path'),
        sessionDir: readOption('--session-dir')
      }
    }
  }
  if (subcommand === 'identify' || subcommand === 'detect') {
    const id = readOption('--id') || readOption('--agent') || readOption('--source')
    const argvOptionValues = readRepeatOptions(['--argv'])
    const argvText = readOption('--argv-line') || readOption('--command-line')
    const envValues = readRepeatOptions(['--env'])
    const env = {}
    for (const item of envValues) {
      const index = item.indexOf('=')
      if (index > 0) env[item.slice(0, index)] = item.slice(index + 1)
    }
    return {
      method: 'agent.vault.identify',
      params: {
        id,
        process: {
          pid: Number(readOption('--pid') || 0) || undefined,
          ppid: Number(readOption('--ppid') || 0) || undefined,
          pgid: Number(readOption('--pgid') || 0) || undefined,
          processName: readOption('--process-name'),
          executable: readOption('--executable'),
          argv: argvOptionValues.length ? argvOptionValues : undefined,
          commandLine: argvText,
          cwd: readOption('--cwd'),
          env,
          sessionId: readOption('--session') || readOption('--session-id'),
          sessionPath: readOption('--session-path')
        }
      }
    }
  }
  if (subcommand === 'scan' || subcommand === 'scan-processes') {
    return {
      method: 'agent.vault.scan',
      params: {
        id: readOption('--id') || readOption('--agent') || readOption('--source'),
        panelId: readOption('--panel') || readOption('--surface'),
        sessionId: readOption('--session') || readOption('--session-id')
      }
    }
  }
  throw new Error(`Unknown agent vault command: ${subcommand}`)
}

const readRepeatOptions = (names) => {
  const values = []
  for (;;) {
    const index = args.findIndex((arg) => names.includes(arg))
    if (index < 0) break
    const value = args[index + 1] || ''
    args.splice(index, 2)
    if (value) values.push(value)
  }
  return values
}

const readPositional = () => {
  const index = args.findIndex((arg) => !arg.startsWith('--'))
  if (index < 0) return ''
  const value = args[index]
  args.splice(index, 1)
  return value
}

const readJsonParams = () => {
  const text = readOption('--params-json') || readOption('--json-params') || readOption('--params') || args.join(' ')
  if (!text) return {}
  const parsed = JSON.parse(text)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('rpc params must be a JSON object')
  return parsed
}

const readCallerParams = () => {
  const caller = {}
  const panelId = readOption('--panel') || readOption('--surface')
  const sessionId = readOption('--session') || readOption('--session-id')
  const workspaceId = readOption('--workspace') || readOption('--workspace-id')
  const cwd = readOption('--cwd')
  if (panelId) caller.panelId = panelId
  if (sessionId) caller.sessionId = sessionId
  if (workspaceId) caller.workspaceId = workspaceId
  if (cwd) caller.cwd = cwd
  return caller
}

const authMethodParams = (subcommand) => {
  if (subcommand !== 'login') throw new Error(`Unknown auth command: ${subcommand}`)
  return { method: 'auth.login', params: {} }
}

const settingsMethodParams = (subcommand) => {
  if (subcommand !== 'open') throw new Error(`Unknown settings command: ${subcommand}`)
  const target = readOption('--target') || readOption('--section') || readOption('--page') || readPositional() || 'general'
  const activate = !hasFlag('--no-activate')
  return { method: 'settings.open', params: { target, section: target, activate } }
}

const feedbackMethodParams = (subcommand) => {
  if (subcommand !== 'open') throw new Error(`Unknown feedback command: ${subcommand}`)
  return { method: 'feedback.open', params: { activate: !hasFlag('--no-activate') } }
}

const sidebarSnapshotMethodParams = () => {
  args.shift()
  return {
    method: 'extension.sidebar.snapshot',
    params: {
      windowId: readOption('--window') || readOption('--window-id'),
      workspaceId: readOption('--workspace') || readOption('--workspace-id')
    }
  }
}

const systemMethodParams = (subcommand) => {
  if (subcommand === 'tree') {
    return {
      method: 'system.tree',
      params: {
        windowId: readOption('--window') || readOption('--window-id'),
        workspaceId: readOption('--workspace') || readOption('--workspace-id')
      }
    }
  }
  if (subcommand === 'identify') return { method: 'system.identify', params: { caller: readCallerParams() } }
  if (subcommand === 'capabilities') return { method: 'system.capabilities', params: {} }
  throw new Error(`Unknown system command: ${subcommand}`)
}

const appMethodParams = (subcommand) => {
  if (subcommand === 'focus-override' || subcommand === 'focus_override') {
    const state = readOption('--state') || readPositional() || 'clear'
    return { method: 'app.focus_override.set', params: { state } }
  }
  if (subcommand === 'simulate-active' || subcommand === 'simulate_active') return { method: 'app.simulate_active', params: {} }
  throw new Error(`Unknown app command: ${subcommand}`)
}

const windowSelectorParams = () => {
  const windowId = readOption('--window') || readOption('--window-id') || readOption('--id') || readPositional()
  return { windowId, window_id: windowId }
}

const windowMethodParams = (subcommand) => {
  if (subcommand === 'list' || subcommand === 'ls') return { method: 'window.list', params: {} }
  if (subcommand === 'current') return { method: 'window.current', params: windowSelectorParams() }
  if (subcommand === 'focus') return { method: 'window.focus', params: windowSelectorParams() }
  if (subcommand === 'create' || subcommand === 'new') return { method: 'window.create', params: {} }
  if (subcommand === 'close') return { method: 'window.close', params: windowSelectorParams() }
  if (subcommand === 'displays') return { method: 'window.displays', params: {} }
  if (subcommand === 'display') {
    const selector = windowSelectorParams()
    const display = readOption('--display') || readOption('--name') || readPositional()
    return { method: 'window.display', params: { ...selector, display } }
  }
  throw new Error(`Unknown window command: ${subcommand}`)
}

const waitForMethodParams = () => {
  const signal = hasFlag('-S') || hasFlag('--signal')
  const timeout = Number(readOption('--timeout') || 0)
  const name = args.find((arg) => arg !== '--' && !arg.startsWith('-')) || ''
  return {
    method: 'sync.wait_for',
    params: {
      name,
      signal,
      ...(Number.isFinite(timeout) && timeout > 0 ? { timeout, timeoutMs: Math.round(timeout * 1000) } : {})
    }
  }
}

const displayMessageMethodParams = () => {
  const printOnly = hasFlag('-p') || hasFlag('--print')
  const text = args.filter((arg) => arg !== '--' && !arg.startsWith('-')).join(' ').trim()
  if (printOnly) {
    return {
      localPrint: text
    }
  }
  return {
    method: 'notification.create',
    params: {
      title: 'aiopsterm',
      body: text || 'Message'
    },
    displayMessageText: text || 'Message'
  }
}

const terminalBufferMethodParams = (command) => {
  if (command === 'list-buffers') return { method: 'terminal.buffer.list', params: {} }
  const name = readOption('--name') || readOption('--buffer') || readOption('-b') || 'default'
  if (command === 'set-buffer') {
    const text = args.filter((arg) => arg !== '--' && !arg.startsWith('--')).join(' ')
    return { method: 'terminal.buffer.set', params: { name, text } }
  }
  if (command === 'show-buffer' || command === 'showb') return { method: 'terminal.buffer.show', params: { name } }
  if (command === 'save-buffer' || command === 'saveb') {
    const outputPath = args.find((arg) => arg !== '--' && !arg.startsWith('--')) || ''
    return {
      method: 'terminal.buffer.save',
      params: { name, path: outputPath },
      saveBufferPath: outputPath
    }
  }
  const panelId = readOption('--panel') || readOption('--panel-id') || readOption('--surface') || readOption('--surface-id')
  const sessionId = readOption('--session') || readOption('--session-id')
  return { method: 'terminal.buffer.paste', params: { name, panelId, surfaceId: panelId, sessionId, terminalSessionId: sessionId } }
}

const tmuxCompatMethodParams = (command) => {
  if (command === 'set-hook') {
    if (hasFlag('--list') || hasFlag('-l')) return { method: 'tmux.hook.list', params: {} }
    const unset = hasFlag('--unset') || hasFlag('-u')
    const event = readPositional()
    if (unset) return { method: 'tmux.hook.unset', params: { event, unset: true } }
    const commandText = args.filter((arg) => arg !== '--').join(' ').trim()
    return { method: 'tmux.hook.set', params: { event, command: commandText } }
  }
  if (command === 'show-options' || command === 'show-option' || command === 'show') {
    const valueOnly = hasFlag('-v') || hasFlag('--value') || hasFlag('--value-only')
    hasFlag('-g')
    hasFlag('-q')
    hasFlag('-s')
    hasFlag('-w')
    const option = args.find((arg) => arg !== '--' && !arg.startsWith('-')) || 'extended-keys'
    return { method: 'tmux.option.show', params: { option, name: option, valueOnly, v: valueOnly } }
  }
  if (command === 'popup' || command === 'bind-key' || command === 'unbind-key' || command === 'copy-mode') return { method: command, params: { command } }
  return { method: command, params: { command, accepted: true } }
}

const readPaneTarget = (fallbackFlag = '--pane') => {
  const paneId =
    readOption(fallbackFlag) ||
    readOption('--pane') ||
    readOption('--pane-id') ||
    readOption('--panel') ||
    readOption('--panel-id') ||
    readOption('--surface') ||
    readOption('--surface-id') ||
    readOption('-t')
  const sessionId = readOption('--session') || readOption('--session-id')
  return { paneId, pane_id: paneId, panelId: paneId, surfaceId: paneId, sessionId, terminalSessionId: sessionId }
}

const readFocusOption = () => {
  const focusRaw = readOption('--focus')
  const noFocus = hasFlag('--no-focus')
  if (noFocus) return false
  if (!focusRaw) return false
  return !['false', '0', 'no', 'off'].includes(focusRaw.trim().toLowerCase())
}

const readPaneDirection = () => {
  const explicit = (readOption('--direction') || readOption('--split') || '').trim().toLowerCase()
  if (explicit === 'below' || explicit === 'down' || explicit === 'vertical') return 'below'
  if (explicit === 'right' || explicit === 'horizontal') return 'right'
  if (hasFlag('--below') || hasFlag('-v')) return 'below'
  if (hasFlag('--right') || hasFlag('-h')) return 'right'
  return 'right'
}

const readSplitDirectionValue = () => {
  const direction = (readOption('--direction') || readOption('--split') || args.find((arg) => arg !== '--' && !arg.startsWith('-')) || '').trim().toLowerCase()
  if (direction === 'left' || direction === 'right' || direction === 'up' || direction === 'down' || direction === 'below') return direction === 'down' ? 'below' : direction
  if (hasFlag('-v')) return 'below'
  if (hasFlag('-h')) return 'right'
  return 'right'
}

const surfaceWorkspaceAliasMethodParams = (command) => {
  if (command === 'new-workspace') {
    const title = readOption('--name') || readOption('-n') || readOption('--title')
    const cwd = readOption('--cwd') || readOption('-c')
    const focus = !(hasFlag('--no-focus') || hasFlag('-d'))
    return { method: 'workspace.create', params: { title, name: title, cwd, focus } }
  }
  if (command === 'current-workspace') return { method: 'workspace.current', params: {} }
  if (command === 'select-workspace') {
    const target = readOption('--workspace') || readOption('--target') || readOption('--panel') || args.find((arg) => arg !== '--' && !arg.startsWith('--')) || ''
    return { method: 'workspace.select', params: { workspaceId: target, workspace_id: target, panelId: target, surfaceId: target } }
  }
  if (command === 'close-workspace') {
    const target = readOption('--workspace') || readOption('--target') || readOption('--panel') || args.find((arg) => arg !== '--' && !arg.startsWith('--')) || ''
    return { method: 'workspace.close', params: { workspaceId: target, workspace_id: target, panelId: target, surfaceId: target } }
  }
  if (command === 'list-panels') return { method: 'surface.list', params: {} }
  if (command === 'list-pane-surfaces') return { method: 'pane.surfaces', params: readPaneTarget() }
  if (command === 'close-surface') {
    const target = readOption('--surface') || readOption('--panel') || readOption('--target') || readOption('-t') || args.find((arg) => arg !== '--' && !arg.startsWith('--')) || ''
    return { method: 'surface.close', params: { paneId: target, pane_id: target, panelId: target, surfaceId: target } }
  }
  const target = readOption('--surface') || readOption('--panel') || readOption('--target') || readOption('-t')
  return {
    method: 'surface.split',
    params: {
      paneId: target,
      panelId: target,
      surfaceId: target,
      targetPaneId: target,
      direction: readSplitDirectionValue(),
      focus: readFocusOption()
    }
  }
}

const surfaceOperationTargetParams = () => {
  const surfaceId = readOption('--surface') || readOption('--panel') || readOption('--tab') || readOption('--target') || args.find((arg) => arg !== '--' && !arg.startsWith('--')) || ''
  const paneId = readOption('--pane') || readOption('--pane-id')
  const beforeSurfaceId = readOption('--before') || readOption('--before-surface') || readOption('--before-panel')
  const afterSurfaceId = readOption('--after') || readOption('--after-surface') || readOption('--after-panel')
  const indexRaw = readOption('--index')
  const index = indexRaw === '' ? undefined : Number(indexRaw)
  return {
    surfaceId,
    surface_id: surfaceId,
    panelId: surfaceId,
    paneId,
    pane_id: paneId,
    beforeSurfaceId,
    before_surface_id: beforeSurfaceId,
    afterSurfaceId,
    after_surface_id: afterSurfaceId,
    ...(Number.isFinite(index) ? { index: Math.floor(index) } : {}),
    focus: readFocusOption()
  }
}

const surfaceOperationMethodParams = (command) => {
  if (command === 'refresh-surfaces') return { method: 'surface.refresh', params: {} }
  if (command === 'surface-health') return { method: 'surface.health', params: {} }
  if (command === 'trigger-flash') {
    const surfaceId = readOption('--surface') || readOption('--panel') || readOption('--target') || args.find((arg) => arg !== '--' && !arg.startsWith('--')) || ''
    return { method: 'surface.trigger_flash', params: { surfaceId, surface_id: surfaceId, panelId: surfaceId } }
  }
  if (command === 'move-surface') return { method: 'surface.move', params: surfaceOperationTargetParams() }
  if (command === 'reorder-surface') return { method: 'surface.reorder', params: surfaceOperationTargetParams() }
  if (command === 'split-off' || command === 'drag-surface-to-split') {
    const explicitSurface = readOption('--surface') || readOption('--panel') || readOption('--tab') || readOption('--target')
    const firstPositional = readPositional()
    const secondPositional = readPositional()
    const surfaceId = explicitSurface || firstPositional
    const directionRaw = readOption('--direction') || readOption('--split') || (explicitSurface ? firstPositional : secondPositional) || (!explicitSurface && ['left', 'right', 'up', 'down', 'below'].includes(firstPositional) ? firstPositional : '')
    const direction = ['left', 'right', 'up', 'down', 'below'].includes(directionRaw.trim().toLowerCase()) ? directionRaw.trim().toLowerCase().replace('down', 'below') : readSplitDirectionValue()
    return {
      method: 'surface.split_off',
      params: {
        surfaceId,
        surface_id: surfaceId,
        panelId: surfaceId,
        direction,
        focus: readFocusOption()
      }
    }
  }
  if (command === 'reorder-workspace') {
    const workspaceId = readOption('--workspace') || readOption('--target') || readOption('--panel') || args.find((arg) => arg !== '--' && !arg.startsWith('--')) || ''
    const beforeWorkspaceId = readOption('--before') || readOption('--before-workspace')
    const afterWorkspaceId = readOption('--after') || readOption('--after-workspace')
    const indexRaw = readOption('--index')
    const index = indexRaw === '' ? undefined : Number(indexRaw)
    const dryRun = hasFlag('--dry-run')
    return {
      method: 'workspace.reorder',
      params: {
        workspaceId,
        workspace_id: workspaceId,
        panelId: workspaceId,
        surfaceId: workspaceId,
        beforeWorkspaceId,
        before_workspace_id: beforeWorkspaceId,
        beforeSurfaceId: beforeWorkspaceId,
        before_surface_id: beforeWorkspaceId,
        afterWorkspaceId,
        after_workspace_id: afterWorkspaceId,
        afterSurfaceId: afterWorkspaceId,
        after_surface_id: afterWorkspaceId,
        ...(Number.isFinite(index) ? { index: Math.floor(index) } : {}),
        dryRun,
        dry_run: dryRun
      }
    }
  }
  if (command === 'reorder-workspaces') {
    const order = readOption('--order') || args.find((arg) => arg !== '--' && !arg.startsWith('--')) || ''
    const dryRun = hasFlag('--dry-run')
    const workspaceIds = order
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
    return { method: 'workspace.reorder_many', params: { order, workspaceIds, workspace_ids: workspaceIds, dryRun, dry_run: dryRun } }
  }
  const workspaceId = readOption('--workspace') || readOption('--target') || readOption('--panel') || ''
  const windowId = readOption('--window') || ''
  return { method: 'workspace.move_to_window', params: { workspaceId, workspace_id: workspaceId, panelId: workspaceId, surfaceId: workspaceId, windowId, window_id: windowId } }
}

const paneLayoutMethodParams = (command) => {
  if (command === 'resize-pane' || command === 'resizep') {
    const direction = hasFlag('-L') ? 'left' : hasFlag('-U') ? 'up' : hasFlag('-D') ? 'down' : 'right'
    const target = readPaneTarget()
    const amount = Number(readOption('--amount') || readOption('-x') || readOption('-y') || 1)
    return {
      method: 'pane.resize',
      params: {
        ...target,
        direction,
        ...(Number.isFinite(amount) && amount > 0 ? { amount: Math.floor(amount) } : {})
      }
    }
  }
  if (command === 'swap-pane' || command === 'swapp') {
    const targetPaneId = readOption('--target-pane') || readOption('--target') || readOption('--target-panel')
    const sourcePaneId = readOption('--pane') || readOption('--pane-id') || readOption('--panel') || readOption('--panel-id') || readOption('--surface') || readOption('--surface-id') || readOption('-s')
    return {
      method: 'pane.swap',
      params: {
        paneId: sourcePaneId,
        pane_id: sourcePaneId,
        panelId: sourcePaneId,
        surfaceId: sourcePaneId,
        targetPaneId,
        target_pane_id: targetPaneId,
        targetPanelId: targetPaneId,
        targetSurfaceId: targetPaneId,
        focus: readFocusOption()
      }
    }
  }
  if (command === 'break-pane' || command === 'breakp') {
    return { method: 'pane.break', params: { ...readPaneTarget(), focus: readFocusOption() } }
  }
  const targetPaneId = readOption('--target-pane') || readOption('--target') || readOption('--target-panel')
  return {
    method: 'pane.join',
    params: {
      ...readPaneTarget(),
      targetPaneId,
      target_pane_id: targetPaneId,
      targetPanelId: targetPaneId,
      targetSurfaceId: targetPaneId,
      direction: readPaneDirection(),
      focus: readFocusOption()
    }
  }
}

const paneNavigationMethodParams = (command) => {
  if (command === 'next-window' || command === 'nextw') return { method: 'workspace.next', params: {} }
  if (command === 'previous-window' || command === 'prev-window' || command === 'previousw' || command === 'prevw') return { method: 'workspace.previous', params: {} }
  if (command === 'last-window' || command === 'lastw') return { method: 'workspace.last', params: {} }
  if (command === 'last-pane' || command === 'lastp') return { method: 'pane.last', params: {} }
  if (command === 'select-window' || command === 'selectw') {
    const target = readOption('--target') || readOption('--window') || readOption('--workspace') || readOption('--panel') || readOption('-t') || args.find((arg) => arg !== '--' && !arg.startsWith('--')) || ''
    return { method: 'workspace.select', params: { workspaceId: target, workspace_id: target, panelId: target, surfaceId: target } }
  }
  if (command === 'select-pane' || command === 'selectp' || command === 'focus-pane') {
    const target = readOption('--target') || readOption('--pane') || readOption('--panel') || readOption('--surface') || readOption('-t') || args.find((arg) => arg !== '--' && !arg.startsWith('--')) || ''
    return { method: 'pane.focus', params: { paneId: target, pane_id: target, panelId: target, surfaceId: target } }
  }
  const includeContent = hasFlag('--content')
  const select = hasFlag('--select')
  const windowId = readOption('--window')
  const query = args.filter((arg) => arg !== '--' && !arg.startsWith('--')).join(' ').trim()
  return { method: 'workspace.find', params: { query, content: includeContent, includeContent, select, windowId, window_id: windowId } }
}

const paneManagementMethodParams = (command) => {
  if (command === 'list-windows' || command === 'lsw') return { method: 'workspace.list', params: { tmuxCompat: true } }
  if (command === 'current-window' || command === 'currentw') return { method: 'workspace.current', params: { tmuxCompat: true } }
  if (command === 'list-panes' || command === 'lsp') return { method: 'pane.list', params: { tmuxCompat: true } }
  if (command === 'new-window' || command === 'neww') {
    const title = readOption('--name') || readOption('-n') || readOption('--title')
    const cwd = readOption('--cwd') || readOption('-c')
    const focus = !(hasFlag('--no-focus') || hasFlag('-d'))
    return { method: 'workspace.create', params: { title, name: title, cwd, focus } }
  }
  if (command === 'split-window' || command === 'splitw') {
    const target = readOption('--target') || readOption('--pane') || readOption('--panel') || readOption('-t')
    const cwd = readOption('--cwd') || readOption('-c')
    const direction = hasFlag('-h') ? 'right' : hasFlag('-v') ? 'below' : readPaneDirection()
    const focus = !(hasFlag('--no-focus') || hasFlag('-d'))
    return { method: 'surface.split', params: { paneId: target, panelId: target, surfaceId: target, targetPaneId: target, direction, cwd, focus } }
  }
  if (command === 'rename-window' || command === 'renamew' || command === 'rename-workspace') {
    const target = readOption('--target') || readOption('--workspace') || readOption('--panel') || readOption('-t')
    const title = args.filter((arg) => arg !== '--' && !arg.startsWith('--')).join(' ').trim()
    return { method: 'workspace.rename', params: { workspaceId: target, workspace_id: target, panelId: target, surfaceId: target, title, name: title } }
  }
  if (command === 'kill-window' || command === 'killw') {
    const target = readOption('--target') || readOption('--workspace') || readOption('--panel') || readOption('-t')
    return { method: 'workspace.close', params: { workspaceId: target, workspace_id: target, panelId: target, surfaceId: target } }
  }
  if (command === 'kill-pane' || command === 'killp') {
    const target = readOption('--target') || readOption('--pane') || readOption('--panel') || readOption('--surface') || readOption('-t')
    return { method: 'surface.close', params: { paneId: target, pane_id: target, panelId: target, surfaceId: target } }
  }
  if (command === 'has-session' || command === 'has') {
    const target = readOption('--target') || readOption('--workspace') || readOption('--panel') || readOption('-t') || args.find((arg) => arg !== '--' && !arg.startsWith('--')) || ''
    return { method: 'workspace.has_session', params: { workspaceId: target, workspace_id: target, panelId: target, surfaceId: target } }
  }
  const layout = args.find((arg) => arg !== '--' && !arg.startsWith('--')) || readOption('--layout') || ''
  const target = readOption('--target') || readOption('--workspace') || readOption('--pane') || readOption('-t')
  return { method: 'workspace.select_layout', params: { layout, name: layout, workspaceId: target, paneId: target, panelId: target, surfaceId: target } }
}

const sidebarTargetParams = () => {
  const workspaceId = readOption('--workspace') || readOption('--workspace-id') || readOption('--tab') || readOption('--tab-id') || 'main'
  const panelId = readOption('--panel') || readOption('--panel-id') || readOption('--surface') || readOption('--surface-id')
  return { workspaceId, workspace_id: workspaceId, workspace: workspaceId, panelId, panel_id: panelId, surfaceId: panelId }
}

const sidebarMetadataMethodParams = (command) => {
  if (command === 'set-status') {
    const target = sidebarTargetParams()
    const icon = readOption('--icon')
    const color = readOption('--color')
    const priority = Number(readOption('--priority') || 0)
    const key = readPositional()
    const value = args.filter((arg) => arg !== '--' && !arg.startsWith('--')).join(' ')
    return {
      method: 'sidebar.status.set',
      params: {
        ...target,
        key,
        value,
        icon,
        color,
        ...(Number.isFinite(priority) ? { priority } : {})
      }
    }
  }
  if (command === 'clear-status') return { method: 'sidebar.status.clear', params: { ...sidebarTargetParams(), key: readPositional() } }
  if (command === 'list-status') return { method: 'sidebar.status.list', params: sidebarTargetParams() }
  if (command === 'set-progress') {
    const target = sidebarTargetParams()
    const value = Number(readPositional())
    return { method: 'sidebar.progress.set', params: { ...target, value, label: readOption('--label') } }
  }
  if (command === 'clear-progress') return { method: 'sidebar.progress.clear', params: sidebarTargetParams() }
  if (command === 'log') {
    const target = sidebarTargetParams()
    const level = readOption('--level') || 'info'
    const source = readOption('--source')
    const message = args.filter((arg) => arg !== '--' && !arg.startsWith('--')).join(' ')
    return { method: 'sidebar.log.append', params: { ...target, level, source, message } }
  }
  if (command === 'clear-log') return { method: 'sidebar.log.clear', params: sidebarTargetParams() }
  if (command === 'list-log') {
    const limit = Number(readOption('--limit') || 0)
    return { method: 'sidebar.log.list', params: { ...sidebarTargetParams(), ...(Number.isFinite(limit) && limit > 0 ? { limit: Math.floor(limit) } : {}) } }
  }
  return { method: 'sidebar.state', params: sidebarTargetParams() }
}

const readCursorFile = (cursorFile) => {
  if (!cursorFile) return undefined
  try {
    if (!fs.existsSync(cursorFile)) return undefined
    const value = Number(fs.readFileSync(cursorFile, 'utf8').trim())
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined
  } catch {
    return undefined
  }
}

const writeCursorFile = (cursorFile, seq) => {
  if (!cursorFile || !Number.isFinite(seq)) return
  fs.mkdirSync(path.dirname(cursorFile), { recursive: true })
  fs.writeFileSync(cursorFile, `${seq}\n`)
}

const eventStreamMethodParams = () => {
  const cursorFile = readOption('--cursor-file')
  const afterOption = readOption('--after') || readOption('--after-seq')
  const after = afterOption ? Number(afterOption) : readCursorFile(cursorFile)
  const names = readRepeatOptions(['--name'])
  const categories = readRepeatOptions(['--category'])
  const limit = Number(readOption('--limit') || 0)
  const printAck = !hasFlag('--no-ack')
  const printHeartbeats = !(hasFlag('--no-heartbeat') || hasFlag('--no-heartbeats'))
  return {
    method: 'events.stream',
    params: {
      include_heartbeats: printHeartbeats,
      ...(Number.isFinite(after) && after >= 0 ? { after_seq: Math.floor(after), after: Math.floor(after) } : {}),
      ...(names.length ? { names } : {}),
      ...(categories.length ? { categories } : {})
    },
    stream: {
      cursorFile,
      printAck,
      printHeartbeats,
      limit: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0
    }
  }
}

const groupIdParams = () => {
  const groupId = readOption('--group') || readOption('--group-id') || args.find((arg) => !arg.startsWith('--')) || ''
  return { groupId, group_id: groupId }
}

const sessionMethodParams = (subcommand) => {
  if (subcommand === 'reopen') subcommand = 'restore'
  if (subcommand === 'delete' || subcommand === 'remove') subcommand = 'clear'
  const id = readOption('--id') || readOption('--snapshot') || args.find((arg) => !arg.startsWith('--')) || ''
  const name = readOption('--name')
  if (subcommand === 'list') return { method: 'session.list', params: {} }
  if (subcommand === 'save') return { method: 'session.save', params: { id: id || 'latest', name } }
  if (subcommand === 'show' || subcommand === 'get') return { method: 'session.show', params: { id: id || 'latest', name } }
  if (subcommand === 'restore') return { method: 'session.restore', params: { id: id || 'latest', name } }
  if (subcommand === 'clear') return { method: 'session.clear', params: { id: id || 'latest', name } }
  throw new Error(`Unknown session command: ${subcommand}`)
}

const agentSessionSelectorParams = () => {
  const sessionId = readOption('--session') || readOption('--session-id') || readOption('--id') || readPositional()
  const source = readOption('--source') || readOption('--agent')
  return { sessionId, session_id: sessionId, id: sessionId, source, agent: source }
}

const agentSessionMethodParams = (subcommand) => {
  if (subcommand === 'ls') subcommand = 'list'
  if (subcommand === 'get') subcommand = 'show'
  if (subcommand === 'done') subcommand = 'handle'
  if (subcommand === 'delete' || subcommand === 'remove') subcommand = 'clear'
  if (subcommand === 'list') {
    const limit = Number(readOption('--limit') || 0)
    const eventLimit = Number(readOption('--event-limit') || 0)
    const decisionLimit = Number(readOption('--decision-limit') || 0)
    const needsInput = hasFlag('--needs-input') || hasFlag('--needs_input') || hasFlag('--unread')
    const includeEvents = hasFlag('--include-events')
    const includeDecisions = hasFlag('--include-decisions')
    return {
      method: 'agent.session.list',
      params: {
        source: readOption('--source') || readOption('--agent'),
        state: readOption('--state'),
        query: readOption('--query') || readOption('-q'),
        needsInput,
        needs_input: needsInput,
        includeEvents,
        include_events: includeEvents,
        includeDecisions,
        include_decisions: includeDecisions,
        ...(Number.isFinite(limit) && limit > 0 ? { limit: Math.floor(limit) } : {}),
        ...(Number.isFinite(eventLimit) && eventLimit > 0 ? { eventLimit: Math.floor(eventLimit), event_limit: Math.floor(eventLimit) } : {}),
        ...(Number.isFinite(decisionLimit) && decisionLimit > 0 ? { decisionLimit: Math.floor(decisionLimit), decision_limit: Math.floor(decisionLimit) } : {})
      }
    }
  }
  if (subcommand === 'show') {
    const eventLimit = Number(readOption('--event-limit') || 0)
    const decisionLimit = Number(readOption('--decision-limit') || 0)
    const noEvents = hasFlag('--no-events')
    const noDecisions = hasFlag('--no-decisions')
    return {
      method: 'agent.session.show',
      params: {
        ...agentSessionSelectorParams(),
        includeEvents: !noEvents,
        include_events: !noEvents,
        includeDecisions: !noDecisions,
        include_decisions: !noDecisions,
        ...(Number.isFinite(eventLimit) && eventLimit > 0 ? { eventLimit: Math.floor(eventLimit), event_limit: Math.floor(eventLimit) } : {}),
        ...(Number.isFinite(decisionLimit) && decisionLimit > 0 ? { decisionLimit: Math.floor(decisionLimit), decision_limit: Math.floor(decisionLimit) } : {})
      }
    }
  }
  if (subcommand === 'reply' || subcommand === 'approve' || subcommand === 'deny' || subcommand === 'handle') {
    const selector = agentSessionSelectorParams()
    const reason = readOption('--reason')
    const answer = readOption('--answer')
    return {
      method: `agent.session.${subcommand}`,
      params: {
        ...selector,
        kind: readOption('--kind') || readOption('--decision'),
        message: readOption('--message') || reason || answer || readOption('--reply') || args.join(' '),
        reason,
        answer
      }
    }
  }
  if (subcommand === 'rename') {
    return {
      method: 'agent.session.rename',
      params: {
        ...agentSessionSelectorParams(),
        title: readOption('--title') || readOption('--name') || args.join(' '),
        name: readOption('--name')
      }
    }
  }
  if (subcommand === 'clear') return { method: 'agent.session.clear', params: agentSessionSelectorParams() }
  if (subcommand === 'bulk' || subcommand === 'mark-handled' || subcommand === 'clear-ended' || subcommand === 'clear-all') {
    const operation = subcommand === 'bulk' ? readOption('--operation') || readOption('--op') || 'mark-handled' : subcommand
    const source = readOption('--source') || readOption('--agent')
    const sessionId = readOption('--session') || readOption('--session-id') || readOption('--id')
    const confirm = hasFlag('--yes') || hasFlag('--confirm')
    return {
      method: 'agent.session.bulk',
      params: {
        operation,
        source,
        sources: source ? source.split(',').map((item) => item.trim()).filter(Boolean) : undefined,
        sessionId,
        sessionIds: sessionId ? sessionId.split(',').map((item) => item.trim()).filter(Boolean) : undefined,
        confirm,
        yes: confirm
      }
    }
  }
  throw new Error(`Unknown agent session command: ${subcommand}`)
}

const feedMethodParams = (subcommand) => {
  if (subcommand === 'status') subcommand = 'list'
  if (subcommand === 'done' || subcommand === 'mark-read') subcommand = 'mark-handled'
  if (subcommand === 'list') return { method: 'feed.list', params: { needsInput: true } }
  if (subcommand === 'mark-handled' || subcommand === 'clear-ended') return { method: `feed.${subcommand}`, params: {} }
  if (subcommand === 'clear') {
    const confirm = hasFlag('--yes') || hasFlag('--confirm')
    return { method: 'feed.clear', params: { confirm, yes: confirm } }
  }
  throw new Error(`Unknown feed command: ${subcommand}`)
}

const agentHooksMethodParams = (subcommand) => {
  if (subcommand === 'status') subcommand = 'list'
  if (subcommand === 'setup') subcommand = 'setup'
  if (subcommand === 'add') subcommand = 'install'
  if (subcommand === 'remove') subcommand = 'uninstall'
  const source = readOption('--agent') || readOption('--source') || readPositional()
  const sources = source ? source.split(',').map((item) => item.trim()).filter(Boolean) : undefined
  if (subcommand === 'list') return { method: 'agent.hooks.list', params: { source, sources } }
  if (subcommand === 'setup' || subcommand === 'install' || subcommand === 'uninstall') return { method: `agent.hooks.${subcommand}`, params: { source, sources } }
  throw new Error(`Unknown hooks command: ${subcommand}`)
}

const workspaceGroupMethodParams = (subcommand) => {
  if (subcommand === 'list') return { method: 'workspace.group.list', params: {} }
  if (subcommand === 'create') {
    const name = readOption('--name') || args.find((arg) => !arg.startsWith('--')) || ''
    const cwd = readOption('--cwd')
    const from = readOption('--from')
    return { method: 'workspace.group.create', params: { name, cwd, from, childWorkspaceIds: from } }
  }
  if (subcommand === 'ungroup') return { method: 'workspace.group.ungroup', params: groupIdParams() }
  if (subcommand === 'delete') return { method: 'workspace.group.delete', params: { ...groupIdParams(), confirm: hasFlag('--confirm') || hasFlag('--force') } }
  if (subcommand === 'rename') {
    const name = readOption('--name') || args.slice(1).find((arg) => !arg.startsWith('--')) || ''
    return { method: 'workspace.group.rename', params: { ...groupIdParams(), name } }
  }
  if (subcommand === 'collapse' || subcommand === 'expand' || subcommand === 'pin' || subcommand === 'unpin' || subcommand === 'focus') {
    return { method: `workspace.group.${subcommand}`, params: groupIdParams() }
  }
  if (subcommand === 'add') {
    return { method: 'workspace.group.add', params: { ...groupIdParams(), workspaceId: readOption('--workspace') || readOption('--panel') || readOption('--surface') } }
  }
  if (subcommand === 'remove') {
    const workspaceId = readOption('--workspace') || readOption('--panel') || readOption('--surface') || args.find((arg) => !arg.startsWith('--')) || ''
    return { method: 'workspace.group.remove', params: { workspaceId, workspace_id: workspaceId } }
  }
  if (subcommand === 'set-anchor') {
    const workspaceId = readOption('--workspace') || readOption('--panel') || readOption('--surface')
    return { method: 'workspace.group.set_anchor', params: { ...groupIdParams(), workspaceId, workspace_id: workspaceId } }
  }
  if (subcommand === 'new-workspace') {
    const placement = readOption('--placement')
    return { method: 'workspace.group.new_workspace', params: { ...groupIdParams(), placement } }
  }
  if (subcommand === 'set-color') return { method: 'workspace.group.set_color', params: { ...groupIdParams(), hex: readOption('--hex') || readOption('--color') } }
  if (subcommand === 'set-icon') return { method: 'workspace.group.set_icon', params: { ...groupIdParams(), symbol: readOption('--symbol') || readOption('--icon') } }
  throw new Error(`Unknown workspace-group command: ${subcommand}`)
}

const surfaceTargetParams = () => {
  const panelId = readOption('--panel') || readOption('--surface') || readOption('--surface-id') || readOption('--tab') || readOption('--tab-id')
  const sessionId = readOption('--session') || readOption('--session-id') || readOption('--terminal') || readOption('--terminal-id')
  return { panelId, surfaceId: panelId, surface_id: panelId, sessionId, terminalSessionId: sessionId }
}

const surfaceResumeMethodParams = (subcommand) => {
  if (subcommand === 'show') subcommand = 'get'
  const target = surfaceTargetParams()
  if (subcommand === 'set') {
    const command = readOption('--shell') || readOption('--command') || args.join(' ')
    const checkpointId = readOption('--checkpoint') || readOption('--checkpoint-id')
    const autoResume = hasFlag('--auto-resume')
    return {
      method: 'surface.resume.set',
      params: {
        ...target,
        name: readOption('--name'),
        kind: readOption('--kind'),
        command,
        shell: command,
        cwd: readOption('--cwd'),
        checkpointId,
        checkpoint_id: checkpointId,
        source: readOption('--source') || 'manual',
        autoResume,
        auto_resume: autoResume
      }
    }
  }
  if (subcommand === 'get') return { method: 'surface.resume.get', params: target }
  if (subcommand === 'trust' || subcommand === 'approve') {
    return {
      method: 'surface.resume.trust',
      params: {
        ...target,
        policy: readOption('--policy') || (hasFlag('--manual') ? 'manual' : 'auto'),
        reason: readOption('--reason')
      }
    }
  }
  if (subcommand === 'preview' || subcommand === 'autorun-preview') return { method: 'surface.resume.preview', params: target }
  if (subcommand === 'autorun' || subcommand === 'run-auto') return { method: 'surface.resume.autorun', params: target }
  if (subcommand === 'clear') {
    const checkpointId = readOption('--checkpoint') || readOption('--checkpoint-id')
    return {
      method: 'surface.resume.clear',
      params: {
        ...target,
        checkpointId,
        checkpoint_id: checkpointId,
        source: readOption('--source')
      }
    }
  }
  if (subcommand === 'run') return { method: 'surface.resume.run', params: target }
  throw new Error(`Unknown surface resume command: ${subcommand}`)
}

const isManagedAiSessionLike = (session) =>
  session && typeof session === 'object' && (typeof session.sessionId === 'string' || typeof session.id === 'string') && typeof session.source === 'string' && typeof session.state === 'string'

const printAgentSessionLine = (session, prefix = 'agent-session') => {
  process.stdout.write(
    [
      prefix,
      session.needsInput ? '!' : session.actionable ? '?' : ' ',
      session.source || '-',
      session.sessionId || session.id || '-',
      session.state || '-',
      session.requestKind || '-',
      session.panelId || session.terminalSessionId || '-',
      session.title || session.summary || ''
    ].join('\t') + '\n'
  )
}

const printResponse = (response) => {
  if (!outputJson && !response.ok && response.errorCode === 'TMUX_COMPAT_UNSUPPORTED') {
    const data = response.data || {}
    process.stdout.write(['unsupported', data.command || '-', data.unsupportedReason || response.errorMessage || ''].join('\t') + '\n')
    return
  }
  if (outputJson || !response.ok) {
    process.stdout.write(`${JSON.stringify(response, null, 2)}\n`)
    return
  }
  const data = response.data || {}
  if (Array.isArray(data.capabilities) && data.protocol === 'aiopsterm-control') {
    const app = data.app || {}
    const processInfo = data.process || {}
    process.stdout.write(`aiopsterm-control\tv${data.version || 1}\t${app.name || 'aiopsterm'}@${app.version || '-'}\n`)
    process.stdout.write(`process\tpid=${processInfo.pid || '-'}\tplatform=${processInfo.platform || '-'}\tarch=${processInfo.arch || '-'}\n`)
    if (data.socketPath) process.stdout.write(`socket\t${data.socketPath}\n`)
    if (data.runtime) {
      process.stdout.write(
        `runtime\twindows=${data.runtime.windowCount || 0}\tnotifications=${data.runtime.notificationCount || 0}\tunread=${data.runtime.unreadNotificationCount || 0}\tevents=${data.runtime.eventCount || 0}\n`
      )
    }
    process.stdout.write(`capabilities\t${data.capabilities.join(',')}\n`)
    return
  }
  const snapshot = data.snapshot
  if (snapshot && typeof snapshot === 'object') {
    const counts = snapshot.counts || {}
    process.stdout.write(`workspace\t${snapshot.mode || '-'}\t${snapshot.activeModule || '-'}\tactive=${snapshot.activePanelId || '-'}\n`)
    process.stdout.write(
      `counts\tterminals=${counts.terminals || 0}\tsurfaces=${counts.surfaces || 0}\tgroups=${counts.workspaceGroups || 0}\tsplits=${counts.splitGroups || 0}\tai=${counts.managedAiSessions || 0}\tattention=${counts.attentionItems || 0}\n`
    )
    if (Array.isArray(snapshot.workspaceGroups) && snapshot.workspaceGroups.length) {
      for (const group of snapshot.workspaceGroups) {
        process.stdout.write(
          [
            group.active ? '*' : ' ',
            group.ref || group.id || '-',
            group.pinned ? 'pinned' : '-',
            group.collapsed ? 'collapsed' : 'expanded',
            `${group.memberCount || 0} members`,
            group.name || ''
          ].join('\t') + '\n'
        )
      }
    }
    if (snapshot.agentHibernation) {
      process.stdout.write(`agent-hibernation\t${snapshot.agentHibernation.enabled ? 'on' : 'off'}\tmax=${snapshot.agentHibernation.maxLiveTerminals}\tidle=${snapshot.agentHibernation.idleSeconds}\n`)
    }
    if (Array.isArray(snapshot.surfaces)) {
      for (const surface of snapshot.surfaces) {
        process.stdout.write(
          [
            surface.active ? '*' : ' ',
            surface.panelId || '-',
            surface.surfaceKind || '-',
            surface.connected === true ? 'connected' : surface.connected === false ? 'disconnected' : '-',
            surface.splitGroupId || '-',
            surface.title || ''
          ].join('\t') + '\n'
        )
      }
    }
    if (snapshot.attention && Array.isArray(snapshot.attention.items) && snapshot.attention.items.length) {
      process.stdout.write(`attention\t${snapshot.attention.unreadCount || snapshot.attention.items.length}\n`)
      for (const item of snapshot.attention.items) {
        process.stdout.write(['!', item.id || '-', item.source || '-', item.kind || '-', item.title || ''].join('\t') + '\n')
      }
    }
    return
  }
  if (data.group) {
    const group = data.group
    process.stdout.write(`OK\t${group.ref || group.id || '-'}\t${group.name || ''}\t${group.memberCount || 0} members\n`)
    return
  }
  if (data.snapshot && Array.isArray(data.snapshot.panels) && data.snapshot.version === 1) {
    const snapshot = data.snapshot
    process.stdout.write(`session\t${snapshot.id || '-'}\t${snapshot.name || '-'}\tpanels=${snapshot.panels.length}\tgroups=${(snapshot.workspaceGroups || []).length}\n`)
    return
  }
  if (typeof data.bytes === 'number' && (data.id || data.sessionId || data.key)) {
    process.stdout.write(['terminal-write', data.id || data.sessionId || '-', `bytes=${data.bytes}`, data.key || ''].filter(Boolean).join('\t') + '\n')
    return
  }
  if (data.name && (data.status === 'signaled' || data.status === 'waiting' || data.status === 'timeout')) {
    process.stdout.write(['wait-for', data.status, data.name, `waited=${data.waitedMs || data.waited_ms || 0}`].join('\t') + '\n')
    return
  }
  if (typeof data.text === 'string' && data.buffer) {
    process.stdout.write(`${data.text}${data.text.endsWith('\n') ? '' : '\n'}`)
    return
  }
  if (Array.isArray(data.buffers)) {
    if (data.buffer) {
      process.stdout.write(['buffer', data.buffer.name || '-', data.buffer.size ?? 0].join('\t') + '\n')
      return
    }
    for (const buffer of data.buffers) process.stdout.write(['buffer', buffer.name || '-', buffer.size ?? 0].join('\t') + '\n')
    if (data.buffers.length === 0) process.stdout.write('No buffers\n')
    return
  }
  if (Array.isArray(data.hooks)) {
    if (data.hook) {
      process.stdout.write(['hook', data.hook.event || '-', data.hook.command || ''].join('\t') + '\n')
      return
    }
    if (data.hooks.length === 0) process.stdout.write('No hooks configured\n')
    for (const hook of data.hooks) process.stdout.write(['hook', hook.event || '-', hook.command || ''].join('\t') + '\n')
    return
  }
  if (data.option && data.option.name) {
    process.stdout.write(data.valueOnly ? `${data.option.value || ''}\n` : `${data.option.name} ${data.option.value || ''}\n`)
    return
  }
  if (data.noop && data.command) {
    process.stdout.write('OK\n')
    return
  }
  if (data.command && data.decision) {
    const decision = data.decision || {}
    const surface = data.surface || {}
    const terminal = data.terminal || {}
    process.stdout.write(['respawn', decision.status || '-', surface.panelId || terminal.panelId || data.surfaceId || '-', terminal.sessionId || '-', data.command].join('\t') + '\n')
    return
  }
  if (data.pane || data.targetPane || data.unsupportedReason) {
    const pane = data.pane || data.surface || {}
    const target = data.targetPane || data.targetSurface || {}
    const status = data.unsupported ? 'unsupported' : data.changed || data.joined || data.broken || data.swapped ? 'ok' : 'unchanged'
    process.stdout.write(
      [
        'pane',
        status,
        pane.panelId || data.surfaceId || data.paneId || '-',
        target.panelId || data.targetPaneId || '-',
        data.direction || '-',
        data.unsupportedReason || ''
      ].join('\t') + '\n'
    )
    return
  }
  if (data.selectedPane || data.selectedSurface || data.workspace) {
    const pane = data.selectedPane || data.selectedSurface || data.workspace || {}
    process.stdout.write(['selected', pane.panelId || pane.id || data.activePanelId || '-', pane.title || '', data.action || ''].join('\t') + '\n')
    return
  }
  if (data.createdPane || data.createdSurface || data.createdWorkspace) {
    const pane = data.createdPane || data.createdSurface || data.createdWorkspace || {}
    process.stdout.write(['created', pane.panelId || pane.id || data.panelId || '-', pane.title || '', data.action || ''].join('\t') + '\n')
    return
  }
  if (data.closedPane || data.closedSurface || data.closedWorkspace) {
    const pane = data.closedPane || data.closedSurface || data.closedWorkspace || {}
    process.stdout.write(['closed', pane.panelId || pane.id || data.panelId || '-', pane.title || '', data.action || ''].join('\t') + '\n')
    return
  }
  if (data.renamedPane || data.renamedWorkspace) {
    const pane = data.renamedPane || data.renamedWorkspace || {}
    process.stdout.write(['renamed', pane.panelId || pane.id || data.panelId || '-', pane.title || data.title || '', data.action || ''].join('\t') + '\n')
    return
  }
  if (data.movedSurface || data.reordered || data.moved || data.splitOff || data.flashed || data.refreshed !== undefined || data.equalized !== undefined) {
    const surface = data.movedSurface || data.surface || data.pane || {}
    const status = data.unsupported ? 'unsupported' : data.changed === false ? 'unchanged' : 'ok'
    process.stdout.write(
      [
        'surface',
        status,
        surface.panelId || data.surfaceId || data.panelId || '-',
        data.action || '-',
        data.toIndex ?? data.to_index ?? data.index ?? '-',
        data.unsupportedReason || ''
      ].join('\t') + '\n'
    )
    return
  }
  if (data.layout) {
    process.stdout.write(['layout', data.layout, data.applied ? 'applied' : data.unsupported ? 'unsupported' : 'ok', data.unsupportedReason || ''].join('\t') + '\n')
    return
  }
  if (data.exists !== undefined && data.target) {
    process.stdout.write(['session', data.exists ? 'exists' : 'missing', data.target || '-'].join('\t') + '\n')
    return
  }
  if (Array.isArray(data.matches) && data.matches.some((match) => match.agent)) {
    if (data.matches.length === 0) {
      process.stdout.write('No agent vault matches\n')
      return
    }
    for (const match of data.matches) {
      const agent = match.agent || {}
      process.stdout.write(
        [
          'agent-match',
          agent.id || '-',
          agent.name || '-',
          match.sessionId || '-',
          match.canResume ? 'resume' : '-',
          match.canFork ? 'fork' : '-'
        ].join('\t') + '\n'
      )
      if (match.resumeCommand) process.stdout.write(`${match.resumeCommand}\n`)
    }
    return
  }
  if (Array.isArray(data.matches)) {
    for (const match of data.matches) {
      process.stdout.write([match.active ? '*' : ' ', match.panelId || match.id || '-', match.kind || match.surfaceKind || '-', match.title || '', match.reason || ''].join('\t') + '\n')
    }
    if (data.matches.length === 0) process.stdout.write('No matches\n')
    return
  }
  if (Array.isArray(data.snapshots)) {
    for (const snapshot of data.snapshots) {
      process.stdout.write([snapshot.id || '-', snapshot.name || '-', `panels=${(snapshot.panels || []).length}`, `groups=${(snapshot.workspaceGroups || []).length}`, snapshot.updatedAt || '-'].join('\t') + '\n')
    }
    if (data.snapshots.length === 0) process.stdout.write('No session snapshots\n')
    return
  }
  if (data.restoredSnapshot) {
    const restored = data.restoredSnapshot
    process.stdout.write(
      `restored\t${restored.id || '-'}\tpanels=${data.restoredPanels || 0}\tlocal=${data.launchedLocalTerminals || 0}\tremote_skipped=${data.skippedRemoteTerminals || 0}\n`
    )
    return
  }
  if (Array.isArray(data.installers)) {
    process.stdout.write(`agent-hooks\tinstalled=${data.installedCount || 0}\tready=${data.readyCount || 0}\tmissing=${data.missingCount || 0}\ttotal=${data.count || data.installers.length}\n`)
    if (Array.isArray(data.results) && data.results.length) {
      for (const result of data.results) {
        process.stdout.write(['hook-result', result.ok ? 'ok' : 'failed', result.source || '-', result.errorMessage || ''].join('\t') + '\n')
      }
    }
    if (Array.isArray(data.skipped) && data.skipped.length) {
      for (const skipped of data.skipped) process.stdout.write(['hook-skipped', skipped.source || '-', skipped.reason || ''].join('\t') + '\n')
    }
    for (const installer of data.installers) {
      process.stdout.write(
        [
          'hook',
          installer.installed ? 'installed' : installer.error ? 'error' : installer.binaryPath ? 'ready' : 'missing',
          installer.source || '-',
          installer.binaryName || '-',
          installer.configPath || '-',
          installer.error || (Array.isArray(installer.warnings) ? installer.warnings.join('; ') : '')
        ].join('\t') + '\n'
      )
    }
    return
  }
  if (Array.isArray(data.sessions) && data.sessions.every(isManagedAiSessionLike)) {
    if (data.operation || typeof data.changed === 'number') process.stdout.write(`agent-session-bulk\t${data.operation || '-'}\tchanged=${data.changed || 0}\n`)
    process.stdout.write(`agent-sessions\t${data.count || data.sessions.length}/${data.total || data.sessions.length}\tneeds_input=${data.needsInputCount || 0}\n`)
    for (const session of data.sessions) printAgentSessionLine(session)
    if (data.sessions.length === 0) process.stdout.write('No agent sessions\n')
    return
  }
  if (Array.isArray(data.statuses) || data.progress || Array.isArray(data.logs)) {
    if (Array.isArray(data.statuses)) {
      for (const status of data.statuses) {
        process.stdout.write(['status', status.workspaceId || status.workspace_id || '-', status.key || '-', status.value || '', status.icon || '-', status.color || '-', status.priority ?? 0].join('\t') + '\n')
      }
    }
    if (data.status && !Array.isArray(data.statuses)) {
      const status = data.status
      process.stdout.write(['status', status.workspaceId || status.workspace_id || '-', status.key || '-', status.value || '', status.icon || '-', status.color || '-', status.priority ?? 0].join('\t') + '\n')
    }
    if (data.progress) {
      const progress = data.progress
      process.stdout.write(['progress', progress.workspaceId || progress.workspace_id || '-', progress.value ?? 0, progress.label || ''].join('\t') + '\n')
    }
    if (Array.isArray(data.logs)) {
      for (const log of data.logs) {
        process.stdout.write(['log', log.workspaceId || log.workspace_id || '-', log.level || 'info', log.source || '-', log.message || ''].join('\t') + '\n')
      }
    }
    if (data.log && !Array.isArray(data.logs)) {
      const log = data.log
      process.stdout.write(['log', log.workspaceId || log.workspace_id || '-', log.level || 'info', log.source || '-', log.message || ''].join('\t') + '\n')
    }
    if (data.removed !== undefined || data.changed !== undefined) process.stdout.write(`changed\t${data.changed ?? (data.removed ? 1 : 0)}\n`)
    return
  }
  if (!data.config && isManagedAiSessionLike(data.session)) {
    printAgentSessionLine(data.session)
    if (Array.isArray(data.session.events) && data.session.events.length) {
      for (const event of data.session.events) {
        process.stdout.write(
          [
            'event',
            event.event || '-',
            event.requestKind || '-',
            event.actionable ? 'actionable' : '-',
            event.receivedAt || '-',
            event.summary || event.title || ''
          ].join('\t') + '\n'
        )
      }
    }
    if (Array.isArray(data.session.decisions) && data.session.decisions.length) {
      for (const decision of data.session.decisions) {
        process.stdout.write(['decision', decision.kind || '-', decision.createdAt || '-', decision.message || ''].join('\t') + '\n')
      }
    }
    if (data.cleared) process.stdout.write('cleared\ttrue\n')
    return
  }
  if (Array.isArray(data.candidates)) {
    process.stdout.write(`resume-candidates\t${data.readyCount || 0}/${data.count || data.candidates.length}\ttrusted=${data.trustedCount || 0}\tran=${data.ranCount || 0}\n`)
    for (const item of data.candidates) {
      const surface = item.surface || {}
      const binding = item.resumeBinding || item.resume_binding || {}
      process.stdout.write(
        ['resume-candidate', surface.panelId || '-', item.ready ? 'ready' : item.reason || '-', item.trusted ? 'trusted' : 'untrusted', binding.command || ''].join('\t') + '\n'
      )
    }
    return
  }
  if ('resumeBinding' in data || 'resume_binding' in data) {
    const binding = data.resumeBinding || data.resume_binding
    const surfaceId = data.surfaceId || data.surface_id || data.surface?.panelId || '-'
    if (!binding) {
      process.stdout.write(`resume\t${surfaceId}\t-\n`)
      return
    }
    process.stdout.write(
      [
        'resume',
        surfaceId,
        binding.kind || '-',
        binding.checkpointId || binding.checkpoint_id || '-',
        binding.autoResume || binding.auto_resume ? 'auto' : 'manual',
        binding.command || ''
      ].join('\t') + '\n'
    )
    return
  }
  if (data.config) {
    process.stdout.write(`agent-hibernation\t${data.config.enabled ? 'on' : 'off'}\tmax=${data.config.maxLiveTerminals}\tidle=${data.config.idleSeconds}\n`)
    if ('liveRestorableCount' in data || 'hibernatedCount' in data || 'pendingCount' in data) {
      process.stdout.write(
        `reaper\tlive=${data.liveRestorableCount || 0}\teligible=${data.eligibleCount || 0}\tselected=${data.selectedCount || 0}\tpending=${data.pendingCount || 0}\thibernated=${data.hibernatedCount || 0}\n`
      )
      const candidates = Array.isArray(data.candidates) ? data.candidates : []
      for (const candidate of candidates) {
        const session = candidate.session || {}
        process.stdout.write(
          [
            'candidate',
            session.source || '-',
            session.id || '-',
            candidate.terminalSessionId || '-',
            `idle=${candidate.idleSeconds || 0}`
          ].join('\t') + '\n'
        )
      }
    }
    return
  }
  if (data.team) {
    const team = data.team
    process.stdout.write(`agent-team\t${team.source || '-'}\tlaunched=${team.launchedCount || 0}\tapproval=${team.approvalCount || 0}\tfailed=${team.failedCount || 0}\n`)
    if (team.group) process.stdout.write(`group\t${team.group.ref || team.group.id || '-'}\t${team.group.name || ''}\t${team.group.memberCount || 0} members\n`)
    if (Array.isArray(team.members)) {
      for (const member of team.members) {
        process.stdout.write(
          [
            member.status === 'launched' ? '*' : member.status === 'needs-approval' ? '?' : '!',
            member.index ?? '-',
            member.panel?.panelId || '-',
            member.terminal?.sessionId || '-',
            member.status || '-',
            member.errorMessage || member.command || ''
          ].join('\t') + '\n'
        )
      }
    }
    return
  }
  if (data.agent) {
    const agent = data.agent
    process.stdout.write(
      [
        'agent-vault',
        agent.id || '-',
        agent.name || '-',
        agent.launchCommand ? 'launch' : '-',
        agent.resumeCommand ? 'resume' : '-',
        agent.forkCommand ? 'fork' : '-'
      ].join('\t') + '\n'
    )
    if (data.command) process.stdout.write(`${data.command}\n`)
    return
  }
  if (Array.isArray(data.agents)) {
    for (const agent of data.agents) {
      process.stdout.write(
        [
          agent.id || '-',
          agent.name || '-',
          agent.launchCommand ? 'launch' : '-',
          agent.resumeCommand ? 'resume' : '-',
          agent.forkCommand ? 'fork' : '-'
        ].join('\t') + '\n'
      )
    }
    if (data.agents.length === 0) process.stdout.write('No agent vault entries\n')
    return
  }
  if (Array.isArray(data.groups)) {
    for (const group of data.groups) {
      process.stdout.write(
        [
          group.active ? '*' : ' ',
          group.ref || group.id || '-',
          group.pinned ? 'pinned' : '-',
          group.collapsed ? 'collapsed' : 'expanded',
          `${group.memberCount || group.member_count || 0} members`,
          group.name || ''
        ].join('\t') + '\n'
      )
    }
    if (data.groups.length === 0) process.stdout.write('No groups\n')
    return
  }
  if (Array.isArray(data.workspaces)) {
    for (const workspace of data.workspaces) {
      process.stdout.write([workspace.active ? '*' : ' ', workspace.id || '-', workspace.mode || '-', workspace.activeModule || '-', workspace.title || ''].join('\t') + '\n')
    }
    return
  }
  if (Array.isArray(data.surfaces)) {
    for (const surface of data.surfaces) {
      process.stdout.write(
        [
          surface.active ? '*' : ' ',
          surface.panelId || '-',
          surface.surfaceKind || '-',
          surface.connected === true ? 'connected' : surface.connected === false ? 'disconnected' : '-',
          surface.splitGroupId || '-',
          surface.title || ''
        ].join('\t') + '\n'
      )
    }
    return
  }
  if (Array.isArray(data.terminals)) {
    for (const terminal of data.terminals) {
      process.stdout.write(
        [
          terminal.active ? '*' : ' ',
          terminal.panelId || '-',
          terminal.sessionId || '-',
          terminal.kind || 'unknown',
          terminal.connected ? 'connected' : 'disconnected',
          terminal.title || ''
        ].join('\t') + '\n'
      )
    }
    return
  }
  if (typeof data.text === 'string') {
    process.stdout.write(`${data.text}${data.text.endsWith('\n') ? '' : '\n'}`)
    return
  }
  if (Array.isArray(data.notifications)) {
    for (const notification of data.notifications) {
      process.stdout.write(
        [
          notification.read ? ' ' : '*',
          notification.id || '-',
          notification.panelId || notification.sessionId || '-',
          notification.title || '',
          notification.subtitle || '',
          notification.body || ''
        ].join('\t') + '\n'
      )
    }
    return
  }
  if (data.notification) {
    process.stdout.write(`${JSON.stringify(data.notification)}\n`)
    return
  }
  process.stdout.write(`${JSON.stringify(data)}\n`)
}

const request = methodParams()

if ('localPrint' in request) {
  process.stdout.write(`${request.localPrint || ''}\n`)
  process.exit(0)
}

if (!socketPath) {
  process.stderr.write('AIOPSTERM_CONTROL_SOCKET is not set. Start this CLI inside an aiopsterm managed local terminal or pass --socket.\n')
  process.exit(2)
}

const socket = net.createConnection(socketPath)
let buffer = ''
let completed = false
let streamEventCount = 0

socket.on('connect', () => {
  socket.write(`${JSON.stringify({ id: `cli-${Date.now()}`, method: request.method, params: request.params || {} })}\n`)
})

socket.on('data', (chunk) => {
  buffer += chunk.toString('utf8')
  for (;;) {
    const newline = buffer.indexOf('\n')
    if (newline < 0) return
    const line = buffer.slice(0, newline)
    buffer = buffer.slice(newline + 1)
    if (!request.stream) {
      completed = true
      socket.end()
      try {
        const response = JSON.parse(line)
        if (request.pipe) {
          if (!response.ok) {
            printResponse(response)
            process.exit(1)
          }
          const command = String(request.pipe.command || '').trim()
          if (!command) {
            process.stderr.write('pipe-pane requires --command <shell-command>\n')
            process.exit(2)
          }
          const child = spawnSync(process.env.SHELL || '/bin/sh', ['-lc', command], {
            input: typeof response.data?.text === 'string' ? response.data.text : '',
            encoding: 'utf8'
          })
          if (child.stdout) process.stdout.write(child.stdout)
          if (child.stderr) process.stderr.write(child.stderr)
          if (child.error) {
            process.stderr.write(`${child.error.message}\n`)
            process.exit(1)
          }
          process.exit(child.status === null ? 1 : child.status)
        }
        if (request.displayMessageText && response.ok && !outputJson) {
          process.stdout.write(`${request.displayMessageText}\n`)
          process.exit(0)
        }
        if (request.saveBufferPath && response.ok) {
          const text = typeof response.data?.text === 'string' ? response.data.text : ''
          if (request.saveBufferPath) {
            fs.writeFileSync(path.resolve(request.saveBufferPath), text)
            process.stdout.write(`saved\t${path.resolve(request.saveBufferPath)}\tbytes=${Buffer.byteLength(text, 'utf8')}\n`)
          } else {
            process.stdout.write(`${text}${text.endsWith('\n') ? '' : '\n'}`)
          }
          process.exit(0)
        }
        printResponse(response)
        process.exit(response.ok ? 0 : 1)
      } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
        process.exit(1)
      }
      return
    }
    try {
      const frame = JSON.parse(line)
      if (frame.type === 'ack' && !request.stream.printAck) continue
      if (frame.type === 'heartbeat' && !request.stream.printHeartbeats) continue
      process.stdout.write(`${line}\n`)
      if (frame.type === 'event' && Number.isFinite(frame.seq)) {
        writeCursorFile(request.stream.cursorFile, frame.seq)
        streamEventCount += 1
        if (request.stream.limit && streamEventCount >= request.stream.limit) {
          completed = true
          socket.end()
          process.exit(0)
        }
      }
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
      process.exit(1)
    }
  }
})

socket.on('error', (error) => {
  process.stderr.write(`${error.message}\n`)
  process.exit(1)
})

socket.on('close', () => {
  if (!completed && !request.stream) {
    process.stderr.write('aiopsterm control socket closed without a response.\n')
    process.exit(1)
  }
})
