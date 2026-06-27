import type {
  ThreadedTerminalCellRun,
  ThreadedTerminalCoreRequest,
  ThreadedTerminalCoreResponse,
  ThreadedTerminalCreateOptions,
  ThreadedTerminalExportedState,
  ThreadedTerminalPerfSample,
  ThreadedTerminalPriority,
  ThreadedTerminalScreenLine,
  ThreadedTerminalScreenSnapshot,
  ThreadedTerminalSettings,
  ThreadedTerminalTheme
} from '@/services/terminal/threadedTerminalProtocol'

type DedicatedWorkerScopeLike = {
  onmessage: ((event: MessageEvent<ThreadedTerminalCoreRequest>) => void) | null
  postMessage: (message: ThreadedTerminalCoreResponse) => void
  setTimeout: typeof setTimeout
  clearTimeout: typeof clearTimeout
}

type HeadlessTerminalClass = typeof import('@xterm/headless').Terminal
type HeadlessTerminalLike = InstanceType<HeadlessTerminalClass>
type HeadlessTerminalOptionsWithTermName = HeadlessTerminalLike['options'] & { termName?: string }

type CoreTerminalRecord = {
  terminal: HeadlessTerminalLike
  terminalId: string
  sessionId?: string
  groupId: string
  surface: ThreadedTerminalCreateOptions['surface']
  visible: boolean
  priority: ThreadedTerminalPriority
  settings: ThreadedTerminalSettings
  theme: ThreadedTerminalTheme
  seq: number
  pendingChunks: string[]
  pendingBytes: number
  scheduled: boolean
  flushTimer: ReturnType<typeof setTimeout> | null
  flushDueAt: number
  disposed: boolean
  pendingFullSnapshot: boolean
  dirtyRows: Set<number>
  snapshotScheduled: boolean
  snapshotTimer: ReturnType<typeof setTimeout> | null
  snapshotDueAt: number
  lastSnapshotAt: number
  perf: ThreadedTerminalPerfSample
  lastPerfAt: number
}

const encoder = new TextEncoder()
const terminals = new Map<string, CoreTerminalRecord>()
const workerScope = self as unknown as DedicatedWorkerScopeLike
const defaultBatchBytes = 64 * 1024
const perfIntervalMs = 1000
const maxSnapshotRows = 500
let HeadlessTerminal: HeadlessTerminalClass | null = null
let initialized = false
const pendingMessages: ThreadedTerminalCoreRequest[] = []

const nowMs = () => globalThis.performance?.now?.() ?? Date.now()

const post = (message: ThreadedTerminalCoreResponse) => workerScope.postMessage(message)

const textByteLength = (value: string) => encoder.encode(value).length

const installHeadlessRuntimeGlobals = () => {
  const globalLike = globalThis as typeof globalThis & {
    window?: typeof globalThis
    global?: typeof globalThis
    requestIdleCallback?: (callback: (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void) => number
    cancelIdleCallback?: (handle: number) => void
  }
  globalLike.window = globalLike.window || globalLike
  globalLike.global = globalLike.global || globalLike
  globalLike.requestIdleCallback =
    globalLike.requestIdleCallback ||
    ((callback) =>
      setTimeout(() => {
        callback({
          didTimeout: false,
          timeRemaining: () => 0
        })
      }, 1) as unknown as number)
  globalLike.cancelIdleCallback =
    globalLike.cancelIdleCallback ||
    ((handle) => {
      clearTimeout(handle as unknown as ReturnType<typeof setTimeout>)
    })
}

const loadHeadlessTerminal = async () => {
  if (HeadlessTerminal) return HeadlessTerminal
  installHeadlessRuntimeGlobals()
  const module = await import('@xterm/headless')
  HeadlessTerminal = module.Terminal
  return HeadlessTerminal
}

const priorityDelayMs = (priority: ThreadedTerminalPriority, visible: boolean) => {
  if (!visible) return 50
  if (priority === 'active') return 0
  if (priority === 'visible') return 8
  return 50
}

const priorityRank = (priority: ThreadedTerminalPriority, visible: boolean) => {
  if (!visible) return 0
  if (priority === 'active') return 3
  if (priority === 'visible') return 2
  return 1
}

const snapshotDelayMs = (priority: ThreadedTerminalPriority, visible: boolean, forceFull: boolean) => {
  if (!visible) return 50
  if (forceFull && priority === 'active') return 16
  if (forceFull) return 16
  if (priority === 'active') return 16
  if (priority === 'visible') return 16
  return 50
}

const newPerfSample = (record: Pick<CoreTerminalRecord, 'terminalId' | 'priority' | 'visible'>): ThreadedTerminalPerfSample => ({
  terminalId: record.terminalId,
  priority: record.priority,
  visible: record.visible,
  chunks: 0,
  bytes: 0,
  parseMs: 0,
  snapshotMs: 0,
  flushMs: 0,
  pendingBytes: 0,
  pendingChunks: 0,
  maxPendingBytes: 0,
  droppedPaints: 0
})

const ansiPalette = [
  '#151820',
  '#f7768e',
  '#9ece6a',
  '#e0af68',
  '#7aa2f7',
  '#bb9af7',
  '#7dcfff',
  '#c0caf5',
  '#414868',
  '#ff9e64',
  '#73daca',
  '#e0af68',
  '#7dcfff',
  '#bb9af7',
  '#2ac3de',
  '#d7dae3'
]

const colorFromPalette = (value: number, fallback: string) => {
  if (value < 16) return ansiPalette[value] || fallback
  if (value >= 16 && value <= 231) {
    const index = value - 16
    const r = Math.floor(index / 36)
    const g = Math.floor((index % 36) / 6)
    const b = index % 6
    const scale = (item: number) => (item === 0 ? 0 : 55 + item * 40)
    return `rgb(${scale(r)}, ${scale(g)}, ${scale(b)})`
  }
  if (value >= 232 && value <= 255) {
    const level = 8 + (value - 232) * 10
    return `rgb(${level}, ${level}, ${level})`
  }
  return fallback
}

const rgbNumberToCss = (value: number) => `#${value.toString(16).padStart(6, '0').slice(-6)}`

const cellColor = (
  cell: NonNullable<ReturnType<NonNullable<ReturnType<HeadlessTerminalLike['buffer']['active']['getLine']>>['getCell']>>,
  kind: 'fg' | 'bg',
  theme: ThreadedTerminalTheme
) => {
  const fallback = kind === 'fg' ? theme.foreground : theme.background
  const isRgb = kind === 'fg' ? cell.isFgRGB() : cell.isBgRGB()
  const isPalette = kind === 'fg' ? cell.isFgPalette() : cell.isBgPalette()
  const value = kind === 'fg' ? cell.getFgColor() : cell.getBgColor()
  if (isRgb) return rgbNumberToCss(value)
  if (isPalette) return colorFromPalette(value, fallback)
  return fallback
}

const extractLineRuns = (record: CoreTerminalRecord, lineIndex: number) => {
  const line = record.terminal.buffer.active.getLine(lineIndex)
  if (!line) return []
  const cell = record.terminal.buffer.active.getNullCell()
  const runs: ThreadedTerminalCellRun[] = []
  let current: ThreadedTerminalCellRun | null = null
  for (let x = 0; x < record.terminal.cols; x += 1) {
    const nextCell = line.getCell(x, cell)
    if (!nextCell || nextCell.getWidth() === 0) continue
    const chars = nextCell.getChars() || ' '
    const inverse = Boolean(nextCell.isInverse())
    const fg = inverse ? cellColor(nextCell, 'bg', record.theme) : cellColor(nextCell, 'fg', record.theme)
    const bg = inverse ? cellColor(nextCell, 'fg', record.theme) : cellColor(nextCell, 'bg', record.theme)
    const hasCustomStyle =
      fg !== record.theme.foreground ||
      bg !== record.theme.background ||
      Boolean(nextCell.isBold()) ||
      Boolean(nextCell.isItalic()) ||
      Boolean(nextCell.isUnderline()) ||
      inverse
    const style = {
      fg: fg === record.theme.foreground ? undefined : fg,
      bg: bg === record.theme.background ? undefined : bg,
      bold: Boolean(nextCell.isBold()) || undefined,
      italic: Boolean(nextCell.isItalic()) || undefined,
      underline: Boolean(nextCell.isUnderline()) || undefined,
      inverse: inverse || undefined
    }
    if (
      hasCustomStyle &&
      current &&
      current.x + current.text.length === x &&
      current.fg === style.fg &&
      current.bg === style.bg &&
      current.bold === style.bold &&
      current.italic === style.italic &&
      current.underline === style.underline &&
      current.inverse === style.inverse
    ) {
      current.text += chars
    } else if (hasCustomStyle) {
      current = { x, text: chars, ...style }
      runs.push(current)
    } else {
      current = null
    }
  }
  return runs
}

const visibleLineIndexes = (record: CoreTerminalRecord) => {
  const buffer = record.terminal.buffer.active
  const rows = Math.max(1, record.terminal.rows)
  const start = Math.max(0, buffer.viewportY)
  const end = Math.min(buffer.length, start + rows)
  const indexes: number[] = []
  for (let index = start; index < end; index += 1) indexes.push(index)
  return indexes
}

const buildSnapshot = (record: CoreTerminalRecord, forceFull = false): ThreadedTerminalScreenSnapshot => {
  const startedAt = nowMs()
  const buffer = record.terminal.buffer.active
  const visibleIndexes = visibleLineIndexes(record)
  const dirtyRows = forceFull
    ? visibleIndexes.map((_lineIndex, row) => row)
    : Array.from(record.dirtyRows)
        .filter((row) => row >= 0 && row < record.terminal.rows)
        .sort((a, b) => a - b)
  const rowsToRead = forceFull || !dirtyRows.length ? visibleIndexes.map((_lineIndex, row) => row) : dirtyRows
  const limitedRows = rowsToRead.slice(-maxSnapshotRows)
  const lines: ThreadedTerminalScreenLine[] = limitedRows.map((row) => {
    const lineIndex = buffer.viewportY + row
    const line = buffer.getLine(lineIndex)
    return {
      y: row,
      text: line?.translateToString(false, 0, record.terminal.cols) || '',
      cells: extractLineRuns(record, lineIndex),
      wrapped: Boolean(line?.isWrapped)
    }
  })
  record.dirtyRows.clear()
  record.pendingFullSnapshot = false
  record.perf.snapshotMs += nowMs() - startedAt
  return {
    terminalId: record.terminalId,
    seq: ++record.seq,
    cols: record.terminal.cols,
    rows: record.terminal.rows,
    cursorX: buffer.cursorX,
    cursorY: buffer.cursorY,
    viewportY: buffer.viewportY,
    baseY: buffer.baseY,
    lines,
    dirtyRows: limitedRows,
    full: forceFull || !dirtyRows.length,
    visible: record.visible,
    priority: record.priority
  }
}

const emitPerfIfDue = (record: CoreTerminalRecord, force = false) => {
  const now = nowMs()
  if (!force && now - record.lastPerfAt < perfIntervalMs && record.perf.chunks < 50) return
  if (!record.perf.chunks && !record.perf.droppedPaints && !force) return
  record.perf.pendingBytes = record.pendingBytes
  record.perf.pendingChunks = record.pendingChunks.length
  record.perf.priority = record.priority
  record.perf.visible = record.visible
  post({ type: 'perf', sample: { ...record.perf } })
  record.perf = newPerfSample(record)
  record.lastPerfAt = now
}

const emitSnapshotNow = (record: CoreTerminalRecord, forceFull = false) => {
  if (record.disposed) return
  if (!record.visible) {
    record.perf.droppedPaints += 1
    record.dirtyRows.clear()
    record.pendingFullSnapshot = true
    emitPerfIfDue(record)
    return
  }
  const snapshot = buildSnapshot(record, forceFull || record.pendingFullSnapshot)
  record.lastSnapshotAt = nowMs()
  post({ type: 'screen', snapshot })
  emitPerfIfDue(record)
}

const scheduleSnapshot = (record: CoreTerminalRecord, forceFull = false) => {
  if (record.disposed) return
  if (forceFull) record.pendingFullSnapshot = true
  if (!record.visible) {
    emitSnapshotNow(record, forceFull)
    return
  }
  const now = nowMs()
  const targetDelay = snapshotDelayMs(record.priority, record.visible, forceFull)
  const elapsedSinceLastSnapshot = record.lastSnapshotAt ? now - record.lastSnapshotAt : targetDelay
  const delay = Math.max(0, targetDelay - elapsedSinceLastSnapshot)
  const dueAt = now + delay
  if (record.snapshotScheduled && record.snapshotTimer) {
    if (!forceFull && dueAt >= record.snapshotDueAt) return
    workerScope.clearTimeout(record.snapshotTimer)
  }
  record.snapshotScheduled = true
  record.snapshotDueAt = dueAt
  record.snapshotTimer = workerScope.setTimeout(() => {
    record.snapshotScheduled = false
    record.snapshotTimer = null
    record.snapshotDueAt = 0
    emitSnapshotNow(record, record.pendingFullSnapshot)
  }, delay)
}

const installTerminalEvents = (record: CoreTerminalRecord) => {
  record.terminal.onCursorMove(() => {
    record.dirtyRows.add(record.terminal.buffer.active.cursorY)
  })
  record.terminal.onLineFeed(() => {
    record.dirtyRows.add(record.terminal.buffer.active.cursorY)
  })
  record.terminal.onScroll(() => {
    record.pendingFullSnapshot = true
  })
  record.terminal.onResize(({ cols, rows }) => {
    record.pendingFullSnapshot = true
    post({ type: 'resize', terminalId: record.terminalId, cols, rows })
  })
  record.terminal.onData((data) => {
    post({ type: 'data', terminalId: record.terminalId, data })
  })
}

const createRecord = (options: ThreadedTerminalCreateOptions): CoreTerminalRecord => {
  const TerminalConstructor = HeadlessTerminal
  if (!TerminalConstructor) throw new Error('Headless terminal runtime is not initialized.')
  const terminal = new TerminalConstructor({
    allowProposedApi: true,
    cols: options.cols,
    rows: options.rows,
    convertEol: true,
    cursorBlink: options.settings.cursorBlink,
    cursorStyle: options.settings.cursorStyle,
    scrollback: options.settings.scrollBack
  })
  ;(terminal.options as HeadlessTerminalOptionsWithTermName).termName = options.settings.terminalType || 'xterm-256color'
  const record: CoreTerminalRecord = {
    terminal,
    terminalId: options.terminalId,
    sessionId: options.sessionId,
    groupId: options.groupId,
    surface: options.surface,
    visible: options.visible,
    priority: options.priority,
    settings: options.settings,
    theme: options.theme,
    seq: 0,
    pendingChunks: [],
    pendingBytes: 0,
    scheduled: false,
    flushTimer: null,
    flushDueAt: 0,
    disposed: false,
    pendingFullSnapshot: true,
    dirtyRows: new Set(),
    snapshotScheduled: false,
    snapshotTimer: null,
    snapshotDueAt: 0,
    lastSnapshotAt: 0,
    perf: newPerfSample({ terminalId: options.terminalId, priority: options.priority, visible: options.visible }),
    lastPerfAt: nowMs()
  }
  installTerminalEvents(record)
  return record
}

const applySettings = (record: CoreTerminalRecord, settings: ThreadedTerminalSettings, theme: ThreadedTerminalTheme) => {
  record.settings = settings
  record.theme = theme
  ;(record.terminal.options as HeadlessTerminalOptionsWithTermName).termName = settings.terminalType || 'xterm-256color'
  record.terminal.options.cursorBlink = settings.cursorBlink
  record.terminal.options.cursorStyle = settings.cursorStyle
  record.terminal.options.scrollback = settings.scrollBack
  record.pendingFullSnapshot = true
  scheduleSnapshot(record, true)
}

const takeBatch = (record: CoreTerminalRecord) => {
  const chunks: string[] = []
  let bytes = 0
  while (record.pendingChunks.length) {
    const chunk = record.pendingChunks[0]
    const chunkBytes = textByteLength(chunk)
    if (chunks.length && bytes + chunkBytes > defaultBatchBytes) break
    chunks.push(chunk)
    bytes += chunkBytes
    record.pendingChunks.shift()
    record.pendingBytes = Math.max(0, record.pendingBytes - chunkBytes)
    if (bytes >= defaultBatchBytes) break
  }
  return chunks.join('')
}

const scheduleFlush = (record: CoreTerminalRecord) => {
  if (record.disposed) return
  const delay = priorityDelayMs(record.priority, record.visible)
  const dueAt = nowMs() + delay
  if (record.scheduled && record.flushTimer) {
    if (dueAt >= record.flushDueAt) return
    workerScope.clearTimeout(record.flushTimer)
  }
  record.scheduled = true
  record.flushDueAt = dueAt
  record.flushTimer = workerScope.setTimeout(() => flushRecord(record), delay)
}

const flushRecord = (record: CoreTerminalRecord) => {
  record.scheduled = false
  record.flushTimer = null
  record.flushDueAt = 0
  if (record.disposed || !record.pendingChunks.length) {
    emitPerfIfDue(record)
    return
  }
  const flushStartedAt = nowMs()
  const data = takeBatch(record)
  const bytes = textByteLength(data)
  const beforeCursorY = record.terminal.buffer.active.cursorY
  const beforeViewportY = record.terminal.buffer.active.viewportY
  record.perf.chunks += 1
  record.perf.bytes += bytes
  record.perf.pendingBytes = record.pendingBytes
  record.perf.pendingChunks = record.pendingChunks.length
  record.perf.maxPendingBytes = Math.max(record.perf.maxPendingBytes, record.pendingBytes)
  const parseStartedAt = nowMs()
  record.terminal.write(data, () => {
    record.perf.parseMs += nowMs() - parseStartedAt
    record.perf.flushMs += nowMs() - flushStartedAt
    if (!record.pendingFullSnapshot && beforeViewportY === record.terminal.buffer.active.viewportY) {
      record.dirtyRows.add(beforeCursorY)
      record.dirtyRows.add(record.terminal.buffer.active.cursorY)
    }
    scheduleSnapshot(record)
    if (record.pendingChunks.length) scheduleFlush(record)
  })
}

const readScreenText = (record: CoreTerminalRecord, tailLines = record.terminal.rows) => {
  const buffer = record.terminal.buffer.active
  const start = Math.max(0, buffer.length - Math.max(1, tailLines))
  const lines: string[] = []
  for (let index = start; index < buffer.length; index += 1) {
    lines.push(buffer.getLine(index)?.translateToString(true) || '')
  }
  return lines.join('\n').replace(/\s+$/g, '')
}

const exportState = (record: CoreTerminalRecord): ThreadedTerminalExportedState => ({
  terminalId: record.terminalId,
  sessionId: record.sessionId,
  groupId: record.groupId,
  surface: record.surface,
  cols: record.terminal.cols,
  rows: record.terminal.rows,
  visible: record.visible,
  priority: record.priority,
  settings: record.settings,
  theme: record.theme,
  scrollbackText: readScreenText(record, Math.max(record.terminal.rows, record.settings.scrollBack || 1000))
})

const importState = (state: ThreadedTerminalExportedState) => {
  const record = createRecord({
    terminalId: state.terminalId,
    sessionId: state.sessionId,
    groupId: state.groupId,
    surface: state.surface,
    cols: state.cols,
    rows: state.rows,
    visible: state.visible,
    priority: state.priority,
    settings: state.settings,
    theme: state.theme
  })
  terminals.set(state.terminalId, record)
  if (state.scrollbackText) {
    record.pendingChunks.push(state.scrollbackText)
    record.pendingBytes += textByteLength(state.scrollbackText)
    flushRecord(record)
  } else {
    scheduleSnapshot(record, true)
  }
  return record
}

const handleMessage = (message: ThreadedTerminalCoreRequest) => {
  try {
    if (message.type === 'ping') {
      post({ type: 'pong', requestId: message.requestId })
      return
    }
    if (message.type === 'create') {
      const existing = terminals.get(message.options.terminalId)
      if (existing) {
        post({ type: 'created', requestId: message.requestId, terminalId: message.options.terminalId })
        return
      }
      const record = createRecord(message.options)
      terminals.set(message.options.terminalId, record)
      post({ type: 'created', requestId: message.requestId, terminalId: message.options.terminalId })
      if (message.initialData) {
        record.pendingChunks.push(message.initialData)
        record.pendingBytes += textByteLength(message.initialData)
        scheduleFlush(record)
      } else {
        scheduleSnapshot(record, true)
      }
      return
    }
    if (message.type === 'import') {
      const record = importState(message.state)
      post({ type: 'created', requestId: message.requestId, terminalId: record.terminalId })
      return
    }
    const record = 'terminalId' in message ? terminals.get(message.terminalId) : undefined
    if (!record) {
      post({ type: 'error', requestId: 'requestId' in message ? message.requestId : undefined, terminalId: 'terminalId' in message ? message.terminalId : undefined, message: 'Terminal not found.' })
      return
    }
    if (message.type === 'data') {
      if (!message.data) return
      record.pendingChunks.push(message.data)
      record.pendingBytes += textByteLength(message.data)
      record.perf.maxPendingBytes = Math.max(record.perf.maxPendingBytes, record.pendingBytes)
      scheduleFlush(record)
      return
    }
    if (message.type === 'input') {
      record.terminal.input(message.data)
      return
    }
    if (message.type === 'resize') {
      const cols = Math.max(2, Math.floor(message.cols))
      const rows = Math.max(1, Math.floor(message.rows))
      if (cols !== record.terminal.cols || rows !== record.terminal.rows) {
        record.terminal.resize(cols, rows)
      }
      record.pendingFullSnapshot = true
      scheduleSnapshot(record, true)
      return
    }
    if (message.type === 'settings') {
      applySettings(record, message.settings, message.theme)
      return
    }
    if (message.type === 'visibility') {
      const wasVisible = record.visible
      const wasPriority = record.priority
      record.visible = message.visible
      record.priority = message.priority
      if (record.pendingChunks.length && priorityRank(record.priority, record.visible) > priorityRank(wasPriority, wasVisible)) scheduleFlush(record)
      if (record.visible && (!wasVisible || wasPriority !== record.priority)) scheduleSnapshot(record, true)
      return
    }
    if (message.type === 'priority') {
      const wasPriority = record.priority
      record.priority = message.priority
      if (record.pendingChunks.length && priorityRank(record.priority, record.visible) > priorityRank(wasPriority, record.visible)) scheduleFlush(record)
      return
    }
    if (message.type === 'clear') {
      record.pendingChunks = []
      record.pendingBytes = 0
      record.terminal.clear()
      record.pendingFullSnapshot = true
      scheduleSnapshot(record, true)
      return
    }
    if (message.type === 'scroll-to-bottom') {
      record.terminal.scrollToBottom()
      scheduleSnapshot(record, true)
      return
    }
    if (message.type === 'read-screen') {
      post({
        type: 'read-screen-result',
        requestId: message.requestId,
        terminalId: record.terminalId,
        text: readScreenText(record, message.tailLines),
        cols: record.terminal.cols,
        rows: record.terminal.rows
      })
      return
    }
    if (message.type === 'export') {
      post({ type: 'export-result', requestId: message.requestId, state: exportState(record) })
      return
    }
    if (message.type === 'dispose') {
      record.disposed = true
      if (record.flushTimer) {
        workerScope.clearTimeout(record.flushTimer)
        record.flushTimer = null
      }
      record.scheduled = false
      record.flushDueAt = 0
      if (record.snapshotTimer) {
        workerScope.clearTimeout(record.snapshotTimer)
        record.snapshotTimer = null
      }
      record.snapshotScheduled = false
      record.snapshotDueAt = 0
      emitPerfIfDue(record, true)
      record.terminal.dispose()
      terminals.delete(record.terminalId)
    }
  } catch (error) {
    post({
      type: 'error',
      requestId: 'requestId' in message ? message.requestId : undefined,
      terminalId: 'terminalId' in message ? message.terminalId : undefined,
      message: error instanceof Error ? error.message : String(error)
    })
  }
}

const handleOrQueueMessage = (message: ThreadedTerminalCoreRequest) => {
  if (!initialized) {
    pendingMessages.push(message)
    return
  }
  handleMessage(message)
}

workerScope.onmessage = (event: MessageEvent<ThreadedTerminalCoreRequest>) => handleOrQueueMessage(event.data)

void loadHeadlessTerminal()
  .then(() => {
    initialized = true
    post({ type: 'ready' })
    while (pendingMessages.length) handleMessage(pendingMessages.shift()!)
  })
  .catch((error) => {
    initialized = true
    post({
      type: 'error',
      message: error instanceof Error ? error.message : String(error)
    })
  })
