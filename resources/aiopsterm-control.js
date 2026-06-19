#!/usr/bin/env node

const net = require('net')

const args = process.argv.slice(2)

const usage = () => `aiopsterm-control [--socket <path>] [--json] <command>

Commands:
  ping
  terminal list
  terminal focus --panel <id>|--session <id>
  terminal read-screen [--panel <id>|--session <id>] [--lines <n>]
  terminal send --session <id> --text <text>
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
  throw new Error(`Unknown command: ${command}`)
}

const printResponse = (response) => {
  if (outputJson || !response.ok) {
    process.stdout.write(`${JSON.stringify(response, null, 2)}\n`)
    return
  }
  const data = response.data || {}
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
