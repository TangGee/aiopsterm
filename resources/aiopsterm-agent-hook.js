#!/usr/bin/env node
'use strict'

const net = require('net')

const args = process.argv.slice(2)

const parseArgs = (items) => {
  const out = {}
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    if (!item.startsWith('--')) continue
    const raw = item.slice(2)
    const equalsIndex = raw.indexOf('=')
    if (equalsIndex >= 0) {
      out[raw.slice(0, equalsIndex)] = raw.slice(equalsIndex + 1)
      continue
    }
    const next = items[index + 1]
    if (next && !next.startsWith('--')) {
      out[raw] = next
      index += 1
    } else {
      out[raw] = 'true'
    }
  }
  return out
}

const options = parseArgs(args)
const strict = options.strict === 'true'
const printResponse = options['print-response'] === 'true'
const waitDecision = options['wait-decision'] === 'true'

const cleanText = (value) => (typeof value === 'string' ? value.trim() : '')

const firstText = (record, keys) => {
  for (const key of keys) {
    const text = cleanText(record[key])
    if (text) return text
  }
  return ''
}

const compactObjectString = (value, maxLength = 240) => {
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
  if (!value || typeof value !== 'object') return ''
  try {
    return JSON.stringify(value).replace(/\s+/g, ' ').trim().slice(0, maxLength)
  } catch {
    return ''
  }
}

const readStdin = () =>
  new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve('')
      return
    }
    let input = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => {
      input += chunk
    })
    process.stdin.on('end', () => resolve(input))
    process.stdin.resume()
  })

const parsePayload = (rawInput) => {
  const trimmed = cleanText(rawInput)
  if (!trimmed) return {}
  try {
    const parsed = JSON.parse(trimmed)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return { text: trimmed }
  }
}

const nestedRecord = (record, key) => {
  const value = record[key]
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

const baseNameFromPath = (value) => {
  const text = cleanText(value).replace(/[\\/]+$/, '')
  if (!text) return ''
  return text.split(/[\\/]/).filter(Boolean).pop() || text
}

const sourceLabel = (source) => {
  if (source === 'claude-code' || source === 'claude') return 'Claude Code'
  if (source === 'codex') return 'Codex'
  if (source === 'codebuddy') return 'CodeBuddy'
  if (source === 'copilot') return 'Copilot'
  if (source === 'cursor') return 'Cursor'
  if (source === 'gemini') return 'Gemini'
  if (source === 'grok') return 'Grok'
  if (source === 'opencode') return 'OpenCode'
  if (source === 'hermes-agent' || source === 'hermes') return 'Hermes Agent'
  if (source === 'rovodev' || source === 'rovo') return 'Rovo Dev'
  if (source === 'qoder') return 'Qoder'
  return source
}

const buildTitle = (source, cwd, payload) => {
  const direct = firstText(payload, ['title', 'projectTitle', 'project_title', 'workspaceTitle', 'workspace_title'])
  if (direct) return direct
  const projectName = firstText(payload, ['projectName', 'project_name', 'workspaceName', 'workspace_name']) || baseNameFromPath(cwd)
  return projectName && source ? `${sourceLabel(source)} · ${projectName}` : projectName
}

const buildSummary = (payload) => {
  const direct = firstText(payload, ['summary', 'message', 'body', 'text', 'prompt', 'lastAssistantMessage', 'last_assistant_message'])
  if (direct) return direct
  const toolName = firstText(payload, ['tool_name', 'toolName'])
  const toolInput = nestedRecord(payload, 'tool_input')
  const command = firstText(toolInput, ['command', 'description', 'query', 'pattern', 'file_path'])
  const questions = Array.isArray(toolInput.questions) ? toolInput.questions : []
  const question = questions.find((item) => item && typeof item === 'object' && !Array.isArray(item))
  if (question) {
    const questionText = firstText(question, ['question', 'header', 'prompt'])
    if (questionText) return questionText
  }
  if (toolName && command) return `${toolName}: ${command}`
  if (toolName) return toolName
  return compactObjectString(nestedRecord(payload, 'data')) || compactObjectString(nestedRecord(payload, 'notification'))
}

const createEvent = (payload) => {
  const source = cleanText(options.source || payload.source || payload.agent || payload.agentName || payload.agent_name)
  const event = cleanText(options.event || options['hook-event-name'] || payload.event || payload.hookEventName || payload.hook_event_name || payload.type || payload.kind)
  const sessionId =
    cleanText(options['session-id'] || payload.sessionId || payload.session_id || payload.conversationId || payload.conversation_id || payload.id) ||
    cleanText(process.env.AIOPSTERM_AGENT_SESSION_ID) ||
    cleanText(process.env.AIOPSTERM_TERMINAL_SESSION_ID)
  const panelId =
    cleanText(options['panel-id'] || payload.panelId || payload.panel_id || payload.surfaceId || payload.surface_id) ||
    cleanText(process.env.AIOPSTERM_PANEL_ID || process.env.AIOPSTERM_SURFACE_ID)
  const terminalSessionId =
    cleanText(options['terminal-session-id'] || payload.terminalSessionId || payload.terminal_session_id || payload.terminalId || payload.terminal_id) ||
    cleanText(process.env.AIOPSTERM_TERMINAL_SESSION_ID)
  const cwd =
    cleanText(options.cwd || payload.cwd || payload.workingDirectory || payload.working_directory || payload.project_dir || payload.projectDir) ||
    cleanText(process.cwd())
  const requestId = cleanText(options['request-id'] || payload.requestId || payload.request_id || payload.tool_use_id || payload.toolUseID)
  const launchCommand = cleanText(options['launch-command'] || payload.launchCommand || payload.launch_command || process.env.AIOPSTERM_AGENT_LAUNCH_COMMAND)
  const resumeCommand = cleanText(options['resume-command'] || payload.resumeCommand || payload.resume_command)
  return {
    source,
    event,
    sessionId,
    title: cleanText(options.title) || buildTitle(source, cwd, payload) || undefined,
    summary: cleanText(options.summary) || buildSummary(payload) || undefined,
    panelId: panelId || undefined,
    terminalSessionId: terminalSessionId || undefined,
    workspaceId: cleanText(options['workspace-id'] || payload.workspaceId || payload.workspace_id || process.env.AIOPSTERM_WORKSPACE_ID) || undefined,
    cwd: cwd || undefined,
    transcriptPath: cleanText(options['transcript-path'] || payload.transcriptPath || payload.transcript_path) || undefined,
    requestId: requestId || undefined,
    actionable: waitDecision || undefined,
    waitForDecision: waitDecision || undefined,
    waitTimeoutMs: waitDecision ? Number(options['wait-timeout-ms'] || 120000) : undefined,
    launchCommand: launchCommand || undefined,
    resumeCommand: resumeCommand || undefined
  }
}

const removeEmpty = (record) => {
  const out = {}
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined && value !== '') out[key] = value
  }
  return out
}

const finish = (code, output) => {
  const agentOutput = output && output.agentOutput && typeof output.agentOutput === 'object' ? output.agentOutput : undefined
  if (agentOutput) {
    process.stdout.write(`${JSON.stringify(agentOutput)}\n`)
  } else if (printResponse && output) {
    const visible = { ...output }
    delete visible.agentOutput
    process.stdout.write(`${JSON.stringify(visible)}\n`)
  } else {
    process.stdout.write('{}\n')
  }
  process.exit(code)
}

const publishEvent = (socketPath, event) =>
  new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath)
    let buffer = ''
    let settled = false
    const settle = (result, error) => {
      if (settled) return
      settled = true
      socket.destroy()
      if (error) reject(error)
      else resolve(result)
    }
    socket.setEncoding('utf8')
    socket.setTimeout(Number(options.timeout || (waitDecision ? 125000 : 1500)))
    socket.on('connect', () => {
      socket.write(`${JSON.stringify(event)}\n`)
    })
    socket.on('data', (chunk) => {
      buffer += chunk
      const newlineIndex = buffer.indexOf('\n')
      if (newlineIndex < 0) return
      const line = buffer.slice(0, newlineIndex).trim()
      try {
        settle(line ? JSON.parse(line) : { ok: true })
      } catch (error) {
        settle(undefined, error)
      }
    })
    socket.on('timeout', () => settle(undefined, new Error('aiopsterm agent hook timed out.')))
    socket.on('error', (error) => settle(undefined, error))
    socket.on('end', () => {
      if (!settled) settle({ ok: true })
    })
  })

const main = async () => {
  if (process.env.AIOPSTERM_AGENT_HOOK_DISABLED === '1') finish(0)
  const socketPath = cleanText(options.socket || process.env.AIOPSTERM_AGENT_SOCKET_PATH)
  if (!socketPath || process.env.AIOPSTERM_MANAGED_TERMINAL !== '1') finish(strict ? 1 : 0, { ok: false, error: 'missing managed aiopsterm terminal socket' })
  const payload = parsePayload(await readStdin())
  const event = removeEmpty(createEvent(payload))
  if (!event.source || !event.event || !event.sessionId) {
    finish(strict ? 1 : 0, { ok: false, error: 'source, event, and sessionId are required' })
  }
  try {
    const response = await publishEvent(socketPath, event)
    finish(strict && response && response.ok === false ? 1 : 0, response)
  } catch (error) {
    finish(strict ? 1 : 0, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

void main()
