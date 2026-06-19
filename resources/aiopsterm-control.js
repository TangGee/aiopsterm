#!/usr/bin/env node

const net = require('net')

const args = process.argv.slice(2)

const usage = () => `aiopsterm-control [--socket <path>] [--json] <command>

Commands:
  ping
  workspace snapshot
  workspace list
  surface list
  tree
  terminal list
  terminal focus --panel <id>|--session <id>
  terminal read-screen [--panel <id>|--session <id>] [--lines <n>]
  terminal send --session <id> --text <text>
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

const socketPath = readOption('--socket') || process.env.AIOPSTERM_CONTROL_SOCKET || process.env.AIOPSTERM_SOCKET_PATH || ''
const outputJson = hasFlag('--json')

if (hasFlag('--help') || hasFlag('-h')) {
  process.stdout.write(usage())
  process.exit(0)
}

const methodParams = () => {
  const command = args.shift() || 'ping'
  if (command === 'ping') return { method: 'ping', params: {} }
  if (command === 'workspace') {
    const subcommand = args.shift() || 'snapshot'
    if (subcommand === 'snapshot') return { method: 'workspace.snapshot', params: {} }
    if (subcommand === 'list') return { method: 'workspace.list', params: {} }
    if (subcommand === 'current') return { method: 'workspace.current', params: {} }
    throw new Error(`Unknown workspace command: ${subcommand}`)
  }
  if (command === 'surface') {
    const subcommand = args.shift() || 'list'
    if (subcommand === 'list') return { method: 'surface.list', params: {} }
    if (subcommand === 'current') return { method: 'surface.current', params: {} }
    throw new Error(`Unknown surface command: ${subcommand}`)
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
  if (command === 'read-screen' || (command === 'terminal' && args[0] === 'read-screen')) {
    if (command === 'terminal') args.shift()
    const panelId = readOption('--panel') || readOption('--panel-id')
    const sessionId = readOption('--session') || readOption('--session-id')
    const lines = Number(readOption('--lines') || readOption('--tail-lines') || 0)
    return { method: 'terminal.read_screen', params: { panelId, sessionId, ...(Number.isFinite(lines) && lines > 0 ? { tailLines: lines } : {}) } }
  }
  if (command === 'send' || (command === 'terminal' && args[0] === 'send')) {
    if (command === 'terminal') args.shift()
    const sessionId = readOption('--session') || readOption('--session-id')
    const text = readOption('--text') || args.join(' ')
    return { method: 'terminal.send_text', params: { sessionId, text } }
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

const printResponse = (response) => {
  if (outputJson || !response.ok) {
    process.stdout.write(`${JSON.stringify(response, null, 2)}\n`)
    return
  }
  const data = response.data || {}
  const snapshot = data.snapshot
  if (snapshot && typeof snapshot === 'object') {
    const counts = snapshot.counts || {}
    process.stdout.write(`workspace\t${snapshot.mode || '-'}\t${snapshot.activeModule || '-'}\tactive=${snapshot.activePanelId || '-'}\n`)
    process.stdout.write(
      `counts\tterminals=${counts.terminals || 0}\tsurfaces=${counts.surfaces || 0}\tsplits=${counts.splitGroups || 0}\tai=${counts.managedAiSessions || 0}\tattention=${counts.attentionItems || 0}\n`
    )
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

if (!socketPath) {
  process.stderr.write('AIOPSTERM_CONTROL_SOCKET is not set. Start this CLI inside an aiopsterm managed local terminal or pass --socket.\n')
  process.exit(2)
}

const socket = net.createConnection(socketPath)
let buffer = ''
let completed = false

socket.on('connect', () => {
  socket.write(`${JSON.stringify({ id: `cli-${Date.now()}`, ...request })}\n`)
})

socket.on('data', (chunk) => {
  buffer += chunk.toString('utf8')
  const newline = buffer.indexOf('\n')
  if (newline < 0) return
  completed = true
  socket.end()
  const line = buffer.slice(0, newline)
  try {
    const response = JSON.parse(line)
    printResponse(response)
    process.exit(response.ok ? 0 : 1)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
})

socket.on('error', (error) => {
  process.stderr.write(`${error.message}\n`)
  process.exit(1)
})

socket.on('close', () => {
  if (!completed) {
    process.stderr.write('aiopsterm control socket closed without a response.\n')
    process.exit(1)
  }
})
