import type { ControlResponse } from '@shared/contracts/control'

type ControlTerminalToolsEventInput = {
  name: string
  category: string
  source?: string
  workspaceId?: string
  surfaceId?: string
  payload?: Record<string, unknown>
}

type ControlTerminalToolsRuntime = {
  writeTerminal?: (sessionId: string, data: string) => Promise<ControlResponse> | ControlResponse
  dispatchRendererControlRequest?: (method: string, params?: Record<string, unknown>, options?: { focus?: boolean }) => Promise<ControlResponse> | ControlResponse
  publishControlEvent?: (input: ControlTerminalToolsEventInput) => void
}

type TerminalBufferEntry = {
  name: string
  text: string
  size: number
  createdAt: number
  updatedAt: number
}

type TmuxCompatHookEntry = {
  event: string
  command: string
  createdAt: number
  updatedAt: number
}

let terminalToolsRuntime: ControlTerminalToolsRuntime = {}
let terminalBuffers = new Map<string, TerminalBufferEntry>()
let tmuxCompatHooks = new Map<string, TmuxCompatHookEntry>()

const maxTerminalBuffers = 100
const maxTerminalBufferBytes = 1024 * 1024
const maxTmuxCompatHooks = 100
const maxTmuxCompatHookCommandLength = 2000

const cleanControlText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
const controlOk = (data: Record<string, unknown> = {}): ControlResponse => ({ ok: true, data })
const controlFail = (errorCode: string, errorMessage: string, data?: Record<string, unknown>): ControlResponse => ({
  ok: false,
  errorCode,
  errorMessage,
  ...(data ? { data } : {})
})

export const configureControlSocketTerminalTools = (runtime: ControlTerminalToolsRuntime = {}) => {
  terminalToolsRuntime = { ...terminalToolsRuntime, ...runtime }
}

export const resetControlSocketTerminalTools = () => {
  terminalBuffers.clear()
  tmuxCompatHooks.clear()
}

export const listTerminalBuffers = () => [...terminalBuffers.values()].sort((left, right) => left.name.localeCompare(right.name))

export const listTmuxCompatHooks = () => [...tmuxCompatHooks.values()].sort((left, right) => left.event.localeCompare(right.event))

export const terminalPanelId = (params: Record<string, unknown>) => cleanControlText(params.panelId || params.panel_id || params.surfaceId || params.surface_id || params.panel || params.surface)

const terminalSessionId = (params: Record<string, unknown>) => cleanControlText(params.sessionId || params.terminalSessionId)

const terminalWriteData = (params: Record<string, unknown>) => {
  if (typeof params.text === 'string') return params.text
  if (typeof params.data === 'string') return params.data
  return ''
}

const cleanTerminalBufferName = (value: unknown) => {
  const text = cleanControlText(value) || 'default'
  if (text.length > 80) return ''
  return /^[A-Za-z0-9._:-]+$/.test(text) ? text : ''
}

const cleanTmuxCompatHookEvent = (value: unknown) => {
  const text = cleanControlText(value)
  if (!text || text.length > 120) return ''
  return /^[A-Za-z0-9._:-]+$/.test(text) ? text : ''
}

const cleanTmuxCompatHookCommand = (value: unknown) => {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text || Buffer.byteLength(text, 'utf8') > maxTmuxCompatHookCommandLength) return ''
  return text
}

const terminalBufferText = (params: Record<string, unknown>) => {
  const value = typeof params.text === 'string' ? params.text : typeof params.data === 'string' ? params.data : typeof params.value === 'string' ? params.value : ''
  const bytes = Buffer.byteLength(value, 'utf8')
  if (!value || bytes > maxTerminalBufferBytes) return { text: '', bytes }
  return { text: value, bytes }
}

const dispatchRendererControlRequest = (method: string, params: Record<string, unknown> = {}, options: { focus?: boolean } = {}) => {
  if (!terminalToolsRuntime.dispatchRendererControlRequest) {
    return Promise.resolve(controlFail('NO_APP_WINDOW', 'No aiopsterm window is available for this control request.'))
  }
  return terminalToolsRuntime.dispatchRendererControlRequest(method, params, options)
}

const publishControlEvent = (input: ControlTerminalToolsEventInput) => {
  terminalToolsRuntime.publishControlEvent?.(input)
}

const keyDataForTerminal = (value: unknown) => {
  const raw = cleanControlText(value)
  if (!raw) return null
  const normalized = raw.toLowerCase().replace(/[\s_-]+/g, '')
  const namedKeys: Record<string, string> = {
    enter: '\r',
    return: '\r',
    cr: '\r',
    tab: '\t',
    space: ' ',
    escape: '\x1b',
    esc: '\x1b',
    backspace: '\x7f',
    bs: '\x7f',
    delete: '\x1b[3~',
    del: '\x1b[3~',
    insert: '\x1b[2~',
    ins: '\x1b[2~',
    up: '\x1b[A',
    arrowup: '\x1b[A',
    down: '\x1b[B',
    arrowdown: '\x1b[B',
    right: '\x1b[C',
    arrowright: '\x1b[C',
    left: '\x1b[D',
    arrowleft: '\x1b[D',
    home: '\x1b[H',
    end: '\x1b[F',
    pageup: '\x1b[5~',
    pgup: '\x1b[5~',
    pagedown: '\x1b[6~',
    pgdn: '\x1b[6~',
    f1: '\x1bOP',
    f2: '\x1bOQ',
    f3: '\x1bOR',
    f4: '\x1bOS',
    f5: '\x1b[15~',
    f6: '\x1b[17~',
    f7: '\x1b[18~',
    f8: '\x1b[19~',
    f9: '\x1b[20~',
    f10: '\x1b[21~',
    f11: '\x1b[23~',
    f12: '\x1b[24~'
  }
  if (namedKeys[normalized]) return { key: raw, data: namedKeys[normalized] }
  const ctrlMatch = raw.match(/^(?:c|ctrl|control)[+-](.)$/i) || raw.match(/^\^(.)$/)
  if (ctrlMatch?.[1]) {
    const char = ctrlMatch[1].toUpperCase()
    if (char === '?') return { key: raw, data: '\x7f' }
    const code = char.charCodeAt(0)
    if (code >= 64 && code <= 95) return { key: raw, data: String.fromCharCode(code - 64) }
    if (code >= 65 && code <= 90) return { key: raw, data: String.fromCharCode(code - 64) }
  }
  if (raw.length === 1) return { key: raw, data: raw }
  return null
}

const resolveTerminalSessionForInput = async (params: Record<string, unknown>) => {
  const sessionId = terminalSessionId(params)
  if (sessionId) return { sessionId }
  const panelId = terminalPanelId(params)
  if (!panelId) return { error: controlFail('TERMINAL_SESSION_REQUIRED', 'sessionId is required.') }
  const response = await dispatchRendererControlRequest('terminal.focus', { ...params, panelId, surfaceId: panelId }, { focus: true })
  if (!response.ok) return { error: response }
  const terminal = response.data?.terminal && typeof response.data.terminal === 'object' ? (response.data.terminal as Record<string, unknown>) : null
  const resolvedSessionId = cleanControlText(terminal?.sessionId || terminal?.terminalSessionId)
  if (!resolvedSessionId) return { error: controlFail('TERMINAL_SESSION_NOT_FOUND', 'Selected terminal has no connected session id.', { panelId }) }
  return { sessionId: resolvedSessionId, panelId: cleanControlText(terminal?.panelId || panelId) }
}

export const sendTerminalText = async (params: Record<string, unknown>) => {
  const text = terminalWriteData(params)
  if (!text) return controlFail('TERMINAL_TEXT_REQUIRED', 'text is required.')
  const resolved = await resolveTerminalSessionForInput(params)
  if (resolved.error) return resolved.error
  const sessionId = resolved.sessionId!
  if (!terminalToolsRuntime.writeTerminal) return controlFail('TERMINAL_WRITE_UNAVAILABLE', 'Terminal write runtime is not available.')
  const response = await terminalToolsRuntime.writeTerminal(sessionId, text)
  if (response.ok) {
    publishControlEvent({
      name: 'terminal.text_sent',
      category: 'terminal',
      payload: {
        session_id: sessionId,
        sessionId,
        text_length: text.length,
        bytes: Buffer.byteLength(text, 'utf8')
      }
    })
  }
  return response
}

export const sendTerminalKey = async (params: Record<string, unknown>) => {
  const key = keyDataForTerminal(params.key || params.name || params.text || params.data)
  if (!key) return controlFail('TERMINAL_KEY_UNKNOWN', 'Unknown terminal key. Use names like enter, tab, esc, up, ctrl+c, or a single character.')
  const resolved = await resolveTerminalSessionForInput(params)
  if (resolved.error) return resolved.error
  const sessionId = resolved.sessionId!
  if (!terminalToolsRuntime.writeTerminal) return controlFail('TERMINAL_WRITE_UNAVAILABLE', 'Terminal write runtime is not available.')
  const response = await terminalToolsRuntime.writeTerminal(sessionId, key.data)
  if (response.ok) {
    publishControlEvent({
      name: 'terminal.key_sent',
      category: 'terminal',
      payload: {
        session_id: sessionId,
        sessionId,
        ...(resolved.panelId ? { panel_id: resolved.panelId, panelId: resolved.panelId } : {}),
        key: key.key,
        bytes: Buffer.byteLength(key.data, 'utf8')
      }
    })
    response.data = { ...(response.data || {}), key: key.key }
  }
  return response
}

const terminalBufferSummary = (entry: TerminalBufferEntry) => ({
  name: entry.name,
  size: entry.size,
  createdAt: entry.createdAt,
  created_at: entry.createdAt,
  updatedAt: entry.updatedAt,
  updated_at: entry.updatedAt
})

const terminalBufferPayload = (buffer?: TerminalBufferEntry | null) => {
  const buffers = listTerminalBuffers().map(terminalBufferSummary)
  return {
    buffers,
    count: buffers.length,
    ...(buffer ? { buffer: terminalBufferSummary(buffer) } : {})
  }
}

const terminalBufferReadPayload = (entry: TerminalBufferEntry) => ({
  buffer: terminalBufferSummary(entry),
  name: entry.name,
  text: entry.text,
  size: entry.size
})

export const handleTerminalBufferControlRequest = async (method: string, params: Record<string, unknown>) => {
  const action = method.startsWith('terminal.buffer.')
    ? method.slice('terminal.buffer.'.length)
    : method.startsWith('buffer.')
      ? method.slice('buffer.'.length)
      : method
  if (action === 'list' || action === 'list-buffers') return controlOk(terminalBufferPayload())
  if (action === 'set' || action === 'set-buffer') {
    const name = cleanTerminalBufferName(params.name || params.buffer || params.bufferName || params.buffer_name)
    if (!name) return controlFail('TERMINAL_BUFFER_NAME_INVALID', 'Buffer name must use letters, numbers, dot, underscore, colon, or dash.')
    const { text, bytes } = terminalBufferText(params)
    if (!text) {
      return controlFail(
        bytes > maxTerminalBufferBytes ? 'TERMINAL_BUFFER_TOO_LARGE' : 'TERMINAL_BUFFER_TEXT_REQUIRED',
        bytes > maxTerminalBufferBytes ? `Buffer text exceeds ${maxTerminalBufferBytes} bytes.` : 'set-buffer requires text.'
      )
    }
    const now = Date.now()
    const existing = terminalBuffers.get(name)
    const entry: TerminalBufferEntry = {
      name,
      text,
      size: bytes,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    }
    terminalBuffers.set(name, entry)
    if (terminalBuffers.size > maxTerminalBuffers) {
      const oldest = listTerminalBuffers().sort((left, right) => left.updatedAt - right.updatedAt)[0]
      if (oldest) terminalBuffers.delete(oldest.name)
    }
    publishControlEvent({
      name: 'terminal.buffer.set',
      category: 'terminal',
      source: 'control.socket',
      payload: { buffer_name: name, size: bytes }
    })
    return controlOk(terminalBufferPayload(entry))
  }
  if (action === 'show' || action === 'show-buffer' || action === 'showb' || action === 'save' || action === 'save-buffer' || action === 'saveb') {
    const name = cleanTerminalBufferName(params.name || params.buffer || params.bufferName || params.buffer_name)
    if (!name) return controlFail('TERMINAL_BUFFER_NAME_INVALID', 'Buffer name must use letters, numbers, dot, underscore, colon, or dash.')
    const entry = terminalBuffers.get(name)
    if (!entry) return controlFail('TERMINAL_BUFFER_NOT_FOUND', `Buffer not found: ${name}`)
    return controlOk({
      ...terminalBufferReadPayload(entry),
      action,
      ...(action === 'save' || action === 'save-buffer' || action === 'saveb' ? { path: cleanControlText(params.path || params.output || params.file) } : {})
    })
  }
  if (action === 'paste' || action === 'paste-buffer') {
    const name = cleanTerminalBufferName(params.name || params.buffer || params.bufferName || params.buffer_name)
    if (!name) return controlFail('TERMINAL_BUFFER_NAME_INVALID', 'Buffer name must use letters, numbers, dot, underscore, colon, or dash.')
    const entry = terminalBuffers.get(name)
    if (!entry) return controlFail('TERMINAL_BUFFER_NOT_FOUND', `Buffer not found: ${name}`)
    const response = await sendTerminalText({ ...params, text: entry.text })
    if (response.ok) {
      response.data = { ...(response.data || {}), buffer: terminalBufferSummary(entry), bufferName: name, buffer_name: name }
      publishControlEvent({
        name: 'terminal.buffer.pasted',
        category: 'terminal',
        source: 'control.socket',
        surfaceId: terminalPanelId(params),
        payload: {
          buffer_name: name,
          size: entry.size,
          session_id: cleanControlText(response.data.id || response.data.sessionId || params.sessionId || params.terminalSessionId),
          panel_id: terminalPanelId(params)
        }
      })
    }
    return response
  }
  return controlFail('UNKNOWN_CONTROL_METHOD', `Unknown aiopsterm terminal buffer method: ${method}`)
}

const tmuxCompatHookSummary = (entry: TmuxCompatHookEntry) => ({
  event: entry.event,
  command: entry.command,
  createdAt: entry.createdAt,
  created_at: entry.createdAt,
  updatedAt: entry.updatedAt,
  updated_at: entry.updatedAt
})

const tmuxCompatHooksPayload = (hook?: TmuxCompatHookEntry | null) => {
  const hooks = listTmuxCompatHooks().map(tmuxCompatHookSummary)
  return {
    hooks,
    count: hooks.length,
    ...(hook ? { hook: tmuxCompatHookSummary(hook) } : {})
  }
}

const tmuxCompatOptionPayload = (name: string, value: string) => ({
  option: { name, value },
  name,
  value,
  text: `${name} ${value}`
})

export const handleTmuxCompatControlRequest = (method: string, params: Record<string, unknown>): ControlResponse => {
  const action = method.startsWith('tmux.') ? method.slice('tmux.'.length) : method
  if (action === 'hook.list' || action === 'hooks.list' || action === 'show-hooks') return controlOk(tmuxCompatHooksPayload())
  if (action === 'hook.unset' || action === 'set-hook.unset') {
    const event = cleanTmuxCompatHookEvent(params.event || params.name || params.hook)
    if (!event) return controlFail('TMUX_HOOK_EVENT_INVALID', 'set-hook --unset requires a valid event name.')
    const existing = tmuxCompatHooks.get(event) || null
    tmuxCompatHooks.delete(event)
    publishControlEvent({
      name: 'tmux.hook.unset',
      category: 'tmux',
      source: 'control.socket',
      payload: { event, removed: Boolean(existing) }
    })
    return controlOk({ ...tmuxCompatHooksPayload(), event, removed: Boolean(existing) })
  }
  if (action === 'hook.set' || action === 'set-hook' || action === 'set_hook') {
    const list = Boolean(params.list || params.show || params.ls)
    if (list) return controlOk(tmuxCompatHooksPayload())
    const unset = Boolean(params.unset || params.remove || params.delete)
    if (unset) return handleTmuxCompatControlRequest('tmux.hook.unset', params)
    const event = cleanTmuxCompatHookEvent(params.event || params.name || params.hook)
    if (!event) return controlFail('TMUX_HOOK_EVENT_INVALID', 'set-hook requires a valid event name.')
    const command = cleanTmuxCompatHookCommand(params.command || params.text || params.value)
    if (!command) return controlFail('TMUX_HOOK_COMMAND_REQUIRED', `set-hook requires a command no larger than ${maxTmuxCompatHookCommandLength} bytes.`)
    const now = Date.now()
    const existing = tmuxCompatHooks.get(event)
    const entry: TmuxCompatHookEntry = {
      event,
      command,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    }
    tmuxCompatHooks.set(event, entry)
    if (tmuxCompatHooks.size > maxTmuxCompatHooks) {
      const oldest = listTmuxCompatHooks().sort((left, right) => left.updatedAt - right.updatedAt)[0]
      if (oldest) tmuxCompatHooks.delete(oldest.event)
    }
    publishControlEvent({
      name: 'tmux.hook.set',
      category: 'tmux',
      source: 'control.socket',
      payload: { event }
    })
    return controlOk(tmuxCompatHooksPayload(entry))
  }
  if (action === 'option.show' || action === 'show-options' || action === 'show-option' || action === 'show') {
    const optionName = cleanControlText(params.option || params.name || params.optionName || params.option_name) || 'extended-keys'
    if (optionName !== 'extended-keys') return controlFail('TMUX_OPTION_UNSUPPORTED', `Unsupported tmux compatibility option: ${optionName}`, { option: optionName, unsupported: true })
    return controlOk({
      ...tmuxCompatOptionPayload(optionName, 'on'),
      valueOnly: Boolean(params.valueOnly || params.value_only || params.v)
    })
  }
  if (['set-option', 'set', 'set-window-option', 'setw', 'source-file', 'refresh-client', 'attach-session', 'detach-client'].includes(action)) {
    return controlOk({
      command: action,
      accepted: true,
      noop: true,
      reason: 'Accepted as a tmux compatibility no-op.'
    })
  }
  if (['popup', 'bind-key', 'unbind-key', 'copy-mode'].includes(action)) {
    return controlFail('TMUX_COMPAT_UNSUPPORTED', `${action} is not supported yet in aiopsterm tmux compatibility mode.`, {
      command: action,
      unsupported: true,
      unsupportedReason: `${action} is a recognized tmux compatibility placeholder but is not supported yet.`
    })
  }
  return controlFail('UNKNOWN_CONTROL_METHOD', `Unknown aiopsterm tmux compatibility method: ${method}`)
}
