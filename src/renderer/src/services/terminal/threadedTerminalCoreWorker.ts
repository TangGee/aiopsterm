import type {
  ThreadedTerminalCellRun,
  ThreadedTerminalCoreRequest,
  ThreadedTerminalCoreResponse,
  ThreadedTerminalCreateOptions,
  ThreadedTerminalExportedState,
  ThreadedTerminalFullReason,
  ThreadedTerminalHighlightRun,
  ThreadedTerminalKeywordHighlightConfig,
  ThreadedTerminalModeState,
  ThreadedTerminalMouseAction,
  ThreadedTerminalMouseButton,
  ThreadedTerminalMouseEventPayload,
  ThreadedTerminalPerfSample,
  ThreadedTerminalPriority,
  ThreadedTerminalScreenLine,
  ThreadedTerminalScreenSnapshot,
  ThreadedTerminalSelectionRange,
  ThreadedTerminalSettings,
  ThreadedTerminalTheme
} from '@/services/terminal/threadedTerminalProtocol'
import {
  compileThreadedKeywordHighlightRules,
  findThreadedKeywordHighlightRuns
} from '@/services/terminal/threadedTerminalKeywordHighlight'
import {
  normalizeTerminalProgramTitle,
  parseTerminalCurrentDirectoryOsc,
  parseTerminalProgressOsc
} from '@/services/terminal/terminalOscRuntime'

type DedicatedWorkerScopeLike = {
  onmessage: ((event: MessageEvent<ThreadedTerminalCoreRequest>) => void) | null
  postMessage: (message: ThreadedTerminalCoreResponse) => void
  setTimeout: typeof setTimeout
  clearTimeout: typeof clearTimeout
}

type HeadlessTerminalClass = typeof import('@xterm/headless').Terminal
type HeadlessTerminalLike = InstanceType<HeadlessTerminalClass>
type HeadlessTerminalOptionsWithTermName = HeadlessTerminalLike['options'] & { termName?: string }
type HeadlessTerminalWithCoreMouse = HeadlessTerminalLike & {
  _core?: {
    coreMouseService?: {
      triggerMouseEvent?: (event: {
        col: number
        row: number
        x: number
        y: number
        button: number
        action: number
        ctrl?: boolean
        alt?: boolean
        shift?: boolean
      }) => boolean
    }
  }
}

type CoreSearchMatch = {
  row: number
  column: number
  length: number
}

type CoreSearchState = {
  query: string
  caseSensitive: boolean
  matches: CoreSearchMatch[]
  activeIndex: number
  epoch: number
}

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
  keywordHighlight?: ThreadedTerminalKeywordHighlightConfig
  keywordHighlightRules: ReturnType<typeof compileThreadedKeywordHighlightRules>
  search: CoreSearchState
  seq: number
  pendingChunks: Array<{
    data: string
    bytes: number
    sessionId?: string
  }>
  pendingBytes: number
  contentEpoch: number
  scheduled: boolean
  flushTimer: ReturnType<typeof setTimeout> | null
  flushDueAt: number
  disposed: boolean
  pendingFullSnapshot: boolean
  pendingFullSnapshotReason?: ThreadedTerminalFullReason
  dirtyRows: Set<number>
  lastVisibleLineSignatures: number[] | null
  snapshotScheduled: boolean
  snapshotTimer: ReturnType<typeof setTimeout> | null
  snapshotDueAt: number
  lastSnapshotAt: number
  lastSnapshotViewportY: number
  followOutput: boolean
  programmaticScrollDepth: number
  perf: ThreadedTerminalPerfSample
  lastPerfAt: number
}

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

// 无分配的 UTF-8 字节长度:数据链路上每个 chunk 都要量长度,不能为此整串编码出一份 Uint8Array。
const textByteLength = (value: string) => {
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4
      index += 1
    } else bytes += 3
  }
  return bytes
}

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

const newSearchState = (): CoreSearchState => ({
  query: '',
  caseSensitive: false,
  matches: [],
  activeIndex: -1,
  epoch: -1
})

const ansiForegroundPaletteForTheme = (theme: ThreadedTerminalTheme) => [
  theme.black || theme.background,
  theme.red || '#e06c75',
  theme.green || '#8ccf7e',
  theme.yellow || '#e6b450',
  theme.blue || '#56b6c2',
  theme.magenta || '#8ccf7e',
  theme.cyan || '#56b6c2',
  theme.white || theme.foreground,
  theme.brightBlack || '#8993a8',
  theme.brightRed || theme.red || '#e06c75',
  theme.brightGreen || theme.green || '#8ccf7e',
  theme.brightYellow || theme.yellow || '#e6b450',
  theme.brightBlue || theme.blue || '#56b6c2',
  theme.brightMagenta || theme.magenta || '#8ccf7e',
  theme.brightCyan || theme.cyan || '#56b6c2',
  theme.brightWhite || theme.foreground
]

const ansiBackgroundPaletteForTheme = (theme: ThreadedTerminalTheme) => {
  const background = theme.ansiBackground || {}
  return [
    background.black || theme.black || theme.background,
    background.red || theme.red || '#e06c75',
    background.green || theme.green || '#8ccf7e',
    background.yellow || theme.yellow || '#e6b450',
    background.blue || theme.blue || '#56b6c2',
    background.magenta || theme.magenta || '#8ccf7e',
    background.cyan || theme.cyan || '#56b6c2',
    background.white || theme.white || theme.foreground,
    background.brightBlack || theme.brightBlack || '#8993a8',
    background.brightRed || theme.brightRed || theme.red || '#e06c75',
    background.brightGreen || theme.brightGreen || theme.green || '#8ccf7e',
    background.brightYellow || theme.brightYellow || theme.yellow || '#e6b450',
    background.brightBlue || theme.brightBlue || theme.blue || '#56b6c2',
    background.brightMagenta || theme.brightMagenta || theme.magenta || '#8ccf7e',
    background.brightCyan || theme.brightCyan || theme.cyan || '#56b6c2',
    background.brightWhite || theme.brightWhite || theme.foreground
  ]
}

const colorFromPalette = (kind: 'fg' | 'bg', value: number, fallback: string, theme: ThreadedTerminalTheme) => {
  if (value < 16) return (kind === 'fg' ? ansiForegroundPaletteForTheme(theme) : ansiBackgroundPaletteForTheme(theme))[value] || fallback
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

const normalizedPaletteIndex = (value: number, bold: boolean) => {
  if (!bold || value < 0 || value > 7) return value
  return value + 8
}

type HeadlessCellLike = NonNullable<ReturnType<NonNullable<ReturnType<HeadlessTerminalLike['buffer']['active']['getLine']>>['getCell']>> & {
  extended?: {
    underlineStyle?: unknown
    underlineColor?: unknown
  }
}

const cellColor = (
  cell: HeadlessCellLike,
  kind: 'fg' | 'bg',
  theme: ThreadedTerminalTheme
) => {
  const fallback = kind === 'fg' ? theme.foreground : theme.background
  const isRgb = kind === 'fg' ? cell.isFgRGB() : cell.isBgRGB()
  const isPalette = kind === 'fg' ? cell.isFgPalette() : cell.isBgPalette()
  const value = kind === 'fg' ? cell.getFgColor() : cell.getBgColor()
  if (isRgb) return rgbNumberToCss(value)
  if (isPalette) return colorFromPalette(kind, kind === 'fg' ? normalizedPaletteIndex(value, Boolean(cell.isBold())) : value, fallback, theme)
  return fallback
}

const cellFlag = (cell: HeadlessCellLike, key: 'isDim' | 'isBlink' | 'isInvisible' | 'isStrikethrough' | 'isOverline') => Boolean(cell[key]?.())

const absoluteCursorRow = (buffer: HeadlessTerminalLike['buffer']['active']) => buffer.baseY + buffer.cursorY

// 单列且单码元的 run 不携带 chars/widths:所有消费方都有 Array.from(text)/宽度 1 的回退,
// 这一表示对 ASCII 为主的终端内容省掉每 cell 两个数组元素的分配与克隆。
const createCellRun = (options: Omit<ThreadedTerminalCellRun, 'text' | 'chars' | 'widths' | 'columns'> & { char: string; width: number }): ThreadedTerminalCellRun => {
  const { char, width, ...style } = options
  const run: ThreadedTerminalCellRun = {
    ...style,
    text: char,
    columns: width
  }
  if (width !== 1 || char.length !== 1) {
    run.chars = [char]
    run.widths = [width]
  }
  return run
}

const appendCellToRun = (run: ThreadedTerminalCellRun, char: string, width: number) => {
  if (!run.chars && width === 1 && char.length === 1) {
    run.text = (run.text || '') + char
    run.columns = (run.columns || 0) + 1
    return
  }
  const chars = run.chars || Array.from(run.text || '')
  const widths = run.widths || chars.map(() => 1)
  chars.push(char)
  widths.push(width)
  run.chars = chars
  run.widths = widths
  run.text = chars.join('')
  run.columns = widths.reduce((total, item) => total + Math.max(1, item || 1), 0)
}

const isAtScrollBottom = (record: CoreTerminalRecord) => {
  const buffer = record.terminal.buffer.active
  return buffer.viewportY >= buffer.baseY
}

const runProgrammaticScroll = (record: CoreTerminalRecord, callback: () => void) => {
  record.programmaticScrollDepth += 1
  try {
    callback()
  } finally {
    record.programmaticScrollDepth = Math.max(0, record.programmaticScrollDepth - 1)
  }
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
    const width = Math.max(1, nextCell.getWidth() || 1)
    const inverse = Boolean(nextCell.isInverse())
    const hidden = cellFlag(nextCell, 'isInvisible')
    const fg = inverse ? cellColor(nextCell, 'bg', record.theme) : cellColor(nextCell, 'fg', record.theme)
    const bg = inverse ? cellColor(nextCell, 'fg', record.theme) : cellColor(nextCell, 'bg', record.theme)
    const hasCustomStyle =
      fg !== record.theme.foreground ||
      bg !== record.theme.background ||
      Boolean(nextCell.isBold()) ||
      cellFlag(nextCell, 'isDim') ||
      Boolean(nextCell.isItalic()) ||
      Boolean(nextCell.isUnderline()) ||
      cellFlag(nextCell, 'isStrikethrough') ||
      cellFlag(nextCell, 'isOverline') ||
      hidden ||
      cellFlag(nextCell, 'isBlink') ||
      inverse
    const style = {
      fg: hidden || fg === record.theme.foreground ? undefined : fg,
      bg: bg === record.theme.background ? undefined : bg,
      bold: Boolean(nextCell.isBold()) || undefined,
      dim: cellFlag(nextCell, 'isDim') || undefined,
      italic: Boolean(nextCell.isItalic()) || undefined,
      underline: Boolean(nextCell.isUnderline()) || undefined,
      strikethrough: cellFlag(nextCell, 'isStrikethrough') || undefined,
      overline: cellFlag(nextCell, 'isOverline') || undefined,
      hidden: hidden || undefined,
      blink: cellFlag(nextCell, 'isBlink') || undefined,
      inverse: inverse || undefined
    }
    if (
      hasCustomStyle &&
      current &&
      current.x + (current.columns || Array.from(current.text).length) === x &&
      current.fg === style.fg &&
      current.bg === style.bg &&
      current.bold === style.bold &&
      current.dim === style.dim &&
      current.italic === style.italic &&
      current.underline === style.underline &&
      current.strikethrough === style.strikethrough &&
      current.overline === style.overline &&
      current.hidden === style.hidden &&
      current.blink === style.blink &&
      current.inverse === style.inverse
    ) {
      appendCellToRun(current, chars, width)
    } else if (hasCustomStyle) {
      current = createCellRun({ x, char: chars, width, ...style })
      runs.push(current)
    } else {
      current = null
    }
  }
  return runs
}

const textColumnsBeforeCharIndex = (runs: ThreadedTerminalCellRun[], charIndex: number) => {
  let remaining = Math.max(0, charIndex)
  let columns = 0
  for (const run of runs) {
    const chars = run.chars || Array.from(run.text || '')
    const widths = chars.map((_char, index) => Math.max(1, run.widths?.[index] || 1))
    for (let index = 0; index < chars.length; index += 1) {
      if (remaining <= 0) return columns
      columns += widths[index]
      remaining -= 1
    }
  }
  return columns
}

const sliceRunsByCharRange = (runs: ThreadedTerminalCellRun[], start: number, length: number) => {
  let remainingStart = Math.max(0, start)
  let remainingLength = Math.max(0, length)
  const chars: string[] = []
  const widths: number[] = []
  for (const run of runs) {
    const runChars = run.chars || Array.from(run.text || '')
    const runWidths = runChars.map((_char, index) => Math.max(1, run.widths?.[index] || 1))
    for (let index = 0; index < runChars.length; index += 1) {
      if (remainingStart > 0) {
        remainingStart -= 1
        continue
      }
      if (remainingLength <= 0) return { chars, widths }
      chars.push(runChars[index])
      widths.push(runWidths[index])
      remainingLength -= 1
    }
  }
  return { chars, widths }
}

const mapHighlightRunToColumns = (run: ThreadedTerminalHighlightRun, plainRuns: ThreadedTerminalCellRun[]) => {
  const startChar = Math.max(0, run.x)
  const highlightChars = Array.from(run.text || '')
  const mapped = sliceRunsByCharRange(plainRuns, startChar, highlightChars.length)
  const x = textColumnsBeforeCharIndex(plainRuns, startChar)
  const columns = mapped.widths.reduce((total, width) => total + width, 0)
  return {
    ...run,
    x,
    chars: mapped.chars.length ? mapped.chars : highlightChars,
    widths: mapped.widths.length ? mapped.widths : highlightChars.map(() => 1),
    columns: columns || highlightChars.length || 1
  }
}

const extractKeywordHighlightRuns = (record: CoreTerminalRecord, text: string, plainRuns: ThreadedTerminalCellRun[]) =>
  findThreadedKeywordHighlightRuns(text, record.keywordHighlightRules).map((run) => mapHighlightRunToColumns(run, plainRuns))

const normalizeSearchText = (value: string, caseSensitive: boolean) =>
  caseSensitive ? value : value.toLocaleLowerCase()

const findLineSearchMatches = (text: string, query: string, caseSensitive: boolean) => {
  const source = Array.from(normalizeSearchText(text, caseSensitive))
  const needle = Array.from(normalizeSearchText(query, caseSensitive))
  if (!needle.length || source.length < needle.length) return []
  const matches: Array<{ column: number; length: number }> = []
  const step = Math.max(1, needle.length)
  for (let index = 0; index <= source.length - needle.length;) {
    let matched = true
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (source[index + offset] !== needle[offset]) {
        matched = false
        break
      }
    }
    if (matched) {
      matches.push({ column: index, length: needle.length })
      index += step
    } else {
      index += 1
    }
  }
  return matches
}

const computeSearchMatches = (record: CoreTerminalRecord, query: string, caseSensitive: boolean) => {
  const term = query.trim()
  if (!term) return []
  const buffer = record.terminal.buffer.active
  const matches: CoreSearchMatch[] = []
  for (let row = 0; row < buffer.length; row += 1) {
    const line = buffer.getLine(row)
    if (!line) continue
    const text = line.translateToString(false, 0, record.terminal.cols) || ''
    for (const match of findLineSearchMatches(text, term, caseSensitive)) {
      matches.push({ row, column: match.column, length: match.length })
    }
  }
  return matches
}

const firstSearchMatchAtOrAfter = (matches: CoreSearchMatch[], row: number, column: number) =>
  matches.findIndex((match) => match.row > row || (match.row === row && match.column >= column))

const lastSearchMatchAtOrBefore = (matches: CoreSearchMatch[], row: number, column: number) => {
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const match = matches[index]
    if (match.row < row || (match.row === row && match.column <= column)) return index
  }
  return -1
}

const sameSearchMatch = (left: CoreSearchMatch | undefined, right: CoreSearchMatch) =>
  Boolean(left && left.row === right.row && left.column === right.column && left.length === right.length)

const preserveSearchActiveIndex = (previous: CoreSearchState, matches: CoreSearchMatch[]) => {
  const active = previous.matches[previous.activeIndex]
  const same = matches.findIndex((match) => sameSearchMatch(active, match))
  if (same >= 0) return same
  return matches.length ? 0 : -1
}

const chooseSearchActiveIndex = (
  record: CoreTerminalRecord,
  previous: CoreSearchState,
  matches: CoreSearchMatch[],
  direction: 'next' | 'previous',
  incremental: boolean
) => {
  if (!matches.length) return -1
  const sameQuery =
    previous.query === record.search.query &&
    previous.caseSensitive === record.search.caseSensitive &&
    previous.matches.length > 0 &&
    previous.activeIndex >= 0
  if (sameQuery && !incremental) {
    const current = Math.max(0, Math.min(matches.length - 1, previous.activeIndex))
    return direction === 'previous'
      ? (current <= 0 ? matches.length - 1 : current - 1)
      : (current >= matches.length - 1 ? 0 : current + 1)
  }
  const buffer = record.terminal.buffer.active
  if (direction === 'previous') {
    const beforeVisibleEnd = lastSearchMatchAtOrBefore(matches, buffer.viewportY + record.terminal.rows - 1, record.terminal.cols)
    return beforeVisibleEnd >= 0 ? beforeVisibleEnd : matches.length - 1
  }
  const afterVisibleStart = firstSearchMatchAtOrAfter(matches, buffer.viewportY, 0)
  return afterVisibleStart >= 0 ? afterVisibleStart : 0
}

// 匹配集只在缓冲区内容变化后失效:滚动/光标快照不再触发全 scrollback 重扫。
const refreshSearchMatches = (record: CoreTerminalRecord) => {
  if (!record.search.query) return
  if (record.search.epoch === record.contentEpoch) return
  const previous = record.search
  const matches = computeSearchMatches(record, previous.query, previous.caseSensitive)
  record.search = {
    ...previous,
    matches,
    epoch: record.contentEpoch,
    activeIndex: preserveSearchActiveIndex(previous, matches)
  }
}

const scrollToSearchMatch = (record: CoreTerminalRecord, match: CoreSearchMatch) => {
  const buffer = record.terminal.buffer.active
  const maxTop = Math.max(0, buffer.length - record.terminal.rows)
  const targetTop = Math.max(0, Math.min(maxTop, match.row - Math.floor(record.terminal.rows / 2)))
  const beforeViewportY = buffer.viewportY
  record.terminal.scrollToLine(targetTop)
  record.followOutput = isAtScrollBottom(record)
  return record.terminal.buffer.active.viewportY !== beforeViewportY
}

const applySearch = (
  record: CoreTerminalRecord,
  query: string,
  direction: 'next' | 'previous',
  options: { caseSensitive?: boolean; incremental?: boolean } = {}
) => {
  const term = query.trim()
  if (!term) {
    clearSearch(record)
    return
  }
  const previous = record.search
  const caseSensitive = Boolean(options.caseSensitive)
  const matches = computeSearchMatches(record, term, caseSensitive)
  record.search = {
    query: term,
    caseSensitive,
    matches,
    activeIndex: -1,
    epoch: record.contentEpoch
  }
  record.search.activeIndex = chooseSearchActiveIndex(record, previous, matches, direction, Boolean(options.incremental))
  const match = record.search.matches[record.search.activeIndex]
  if (match) {
    scrollToSearchMatch(record, match)
  }
  scheduleSnapshot(record, true, 'search')
}

function clearSearch(record: CoreTerminalRecord) {
  const hadSearch = Boolean(record.search.query || record.search.matches.length)
  record.search = newSearchState()
  if (hadSearch) scheduleSnapshot(record, true, 'search')
}

const extractSearchHighlightRuns = (record: CoreTerminalRecord, lineIndex: number, text: string, plainRuns: ThreadedTerminalCellRun[]) => {
  if (!record.search.query || !record.search.matches.length) return []
  const textChars = Array.from(text)
  const activeBg = record.theme.brightYellow || record.theme.yellow || '#facc15'
  const inactiveBg = record.theme.yellow || '#7a6218'
  return record.search.matches.flatMap((match, index) => {
    if (match.row !== lineIndex) return []
    const runText = textChars.slice(match.column, match.column + match.length).join('')
    if (!runText) return []
    const active = index === record.search.activeIndex
    return mapHighlightRunToColumns({
      x: match.column,
      text: runText,
      fg: active ? '#111827' : '#ffffff',
      bg: active ? activeBg : inactiveBg,
      bold: active || undefined
    }, plainRuns)
  })
}

const extractPlainLineRuns = (record: CoreTerminalRecord, lineIndex: number) => {
  const line = record.terminal.buffer.active.getLine(lineIndex)
  if (!line) return []
  const cell = record.terminal.buffer.active.getNullCell()
  const runs: ThreadedTerminalCellRun[] = []
  let current: ThreadedTerminalCellRun | null = null
  for (let x = 0; x < record.terminal.cols; x += 1) {
    const nextCell = line.getCell(x, cell)
    if (!nextCell || nextCell.getWidth() === 0) continue
    const chars = nextCell.getChars() || ' '
    const width = Math.max(1, nextCell.getWidth() || 1)
    if (current && current.x + (current.columns || Array.from(current.text).length) === x) {
      appendCellToRun(current, chars, width)
    } else {
      current = createCellRun({ x, char: chars, width })
      runs.push(current)
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

const fnvCombine = (hash: number, value: number) => Math.imul(hash ^ value, 0x01000193) >>> 0

const fnvCombineString = (hash: number, value: string) => {
  let next = hash
  for (let index = 0; index < value.length; index += 1) next = fnvCombine(next, value.charCodeAt(index))
  return next
}

// 行签名用两条独立 FNV 流合成 53 位整数,替代逐 cell 字符串拼接:
// diff 只需要相等比较,数值哈希把每行数万次短字符串分配降为零。
const lineSignature = (record: CoreTerminalRecord, lineIndex: number) => {
  const line = record.terminal.buffer.active.getLine(lineIndex)
  if (!line) return -1
  const cell = record.terminal.buffer.active.getNullCell()
  let h1 = line.isWrapped ? 0x811c9dc5 : 0x811c9dc4
  let h2 = 0x9e3779b9
  const mix = (value: number) => {
    h1 = fnvCombine(h1, value)
    h2 = fnvCombine(h2, value ^ 0x5bd1e995)
  }
  for (let x = 0; x < record.terminal.cols; x += 1) {
    const nextCell = line.getCell(x, cell) as HeadlessCellLike | undefined
    if (!nextCell) {
      mix(0x7fffffff)
      continue
    }
    const width = nextCell.getWidth()
    if (width === 0) {
      mix(0x7ffffffe)
      continue
    }
    const chars = nextCell.getChars() || ' '
    h1 = fnvCombineString(h1, chars)
    h2 = fnvCombineString(h2, chars)
    mix(width)
    mix(nextCell.getCode())
    mix(nextCell.getFgColorMode())
    mix(nextCell.getFgColor())
    mix(nextCell.getBgColorMode())
    mix(nextCell.getBgColor())
    mix(
      (nextCell.isBold() ? 1 : 0) |
        (cellFlag(nextCell, 'isDim') ? 2 : 0) |
        (nextCell.isItalic() ? 4 : 0) |
        (nextCell.isUnderline() ? 8 : 0) |
        (cellFlag(nextCell, 'isBlink') ? 16 : 0) |
        (nextCell.isInverse() ? 32 : 0) |
        (cellFlag(nextCell, 'isInvisible') ? 64 : 0) |
        (cellFlag(nextCell, 'isStrikethrough') ? 128 : 0) |
        (cellFlag(nextCell, 'isOverline') ? 256 : 0)
    )
    mix(Number(nextCell.extended?.underlineStyle ?? -1) + 1)
    mix(Number(nextCell.extended?.underlineColor ?? -1) + 1)
  }
  return h1 * 0x200000 + (h2 & 0x1fffff)
}

// 基线为 null 表示未知；正常写入时通过可见行签名只标记真正变化的行。
const markChangedVisibleRows = (record: CoreTerminalRecord) => {
  const visibleIndexes = visibleLineIndexes(record)
  const previous = record.lastVisibleLineSignatures
  const nextSignatures = new Array<number>(visibleIndexes.length)
  for (let row = 0; row < visibleIndexes.length; row += 1) {
    const signature = lineSignature(record, visibleIndexes[row])
    nextSignatures[row] = signature
    if (!previous || signature !== previous[row]) record.dirtyRows.add(row)
  }
  record.lastVisibleLineSignatures = nextSignatures
}

const modeState = (record: CoreTerminalRecord): ThreadedTerminalModeState => ({
  applicationCursorKeysMode: Boolean(record.terminal.modes.applicationCursorKeysMode),
  applicationKeypadMode: Boolean(record.terminal.modes.applicationKeypadMode),
  bracketedPasteMode: Boolean(record.terminal.modes.bracketedPasteMode),
  mouseTrackingMode: record.terminal.modes.mouseTrackingMode || 'none',
  activeBufferType: record.terminal.buffer.active.type === 'alternate' ? 'alternate' : 'normal'
})

const logicalLineBounds = (record: CoreTerminalRecord, row: number) => {
  const buffer = record.terminal.buffer.active
  let start = row
  let end = row
  while (start > 0 && buffer.getLine(start)?.isWrapped) start -= 1
  while (end + 1 < buffer.length && buffer.getLine(end + 1)?.isWrapped) end += 1
  return { start, end }
}

const buildSnapshot = (record: CoreTerminalRecord, forceFull = false, fullReason?: ThreadedTerminalFullReason): ThreadedTerminalScreenSnapshot => {
  const startedAt = nowMs()
  refreshSearchMatches(record)
  const buffer = record.terminal.buffer.active
  const visibleIndexes = visibleLineIndexes(record)
  const allRows = visibleIndexes.map((_lineIndex, row) => row)
  const viewportDelta = record.lastSnapshotAt ? buffer.viewportY - record.lastSnapshotViewportY : 0
  const cursorAbsoluteY = absoluteCursorRow(buffer)
  const cursorViewportY = cursorAbsoluteY - buffer.viewportY
  const repaintVisibleRows = !forceFull && viewportDelta !== 0
  const effectiveFull = forceFull
  const effectiveFullReason = effectiveFull ? fullReason || 'unknown' : undefined
  const dirtyRows = effectiveFull || repaintVisibleRows
    ? allRows
    : Array.from(record.dirtyRows)
        .filter((row) => row >= 0 && row < record.terminal.rows)
        .sort((a, b) => a - b)
  const rowsToRead = effectiveFull ? allRows : dirtyRows
  const limitedRows = rowsToRead.slice(-maxSnapshotRows)
  const lines: ThreadedTerminalScreenLine[] = limitedRows.map((row) => {
    const lineIndex = buffer.viewportY + row
    const line = buffer.getLine(lineIndex)
    const text = line?.translateToString(false, 0, record.terminal.cols) || ''
    const runs = extractPlainLineRuns(record, lineIndex)
    const logicalBounds = logicalLineBounds(record, lineIndex)
    const keywordHighlights = extractKeywordHighlightRuns(record, text, runs)
    const searchHighlights = extractSearchHighlightRuns(record, lineIndex, text, runs)
    return {
      y: row,
      text,
      runs,
      cells: extractLineRuns(record, lineIndex),
      highlights: [...keywordHighlights, ...searchHighlights],
      wrapped: Boolean(line?.isWrapped),
      logicalStartRow: logicalBounds.start,
      logicalEndRow: logicalBounds.end
    }
  })
  record.dirtyRows.clear()
  if (effectiveFull || repaintVisibleRows) {
    record.lastVisibleLineSignatures = visibleIndexes.map((lineIndex) => lineSignature(record, lineIndex))
  }
  record.pendingFullSnapshot = false
  record.pendingFullSnapshotReason = undefined
  record.lastSnapshotViewportY = buffer.viewportY
  record.perf.snapshotMs += nowMs() - startedAt
  return {
    terminalId: record.terminalId,
    seq: ++record.seq,
    cols: record.terminal.cols,
    rows: record.terminal.rows,
    cursorX: buffer.cursorX,
    cursorY: cursorViewportY,
    cursorAbsoluteY,
    viewportY: buffer.viewportY,
    baseY: buffer.baseY,
    lines,
    dirtyRows: limitedRows,
    full: effectiveFull,
    fullReason: effectiveFullReason,
    repaintReason: repaintVisibleRows ? 'jump' : undefined,
    scrollDeltaRows: 0,
    visible: record.visible,
    priority: record.priority,
    modes: modeState(record)
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
    record.pendingFullSnapshotReason = record.pendingFullSnapshotReason || 'visibility'
    emitPerfIfDue(record)
    return
  }
  const snapshot = buildSnapshot(record, forceFull || record.pendingFullSnapshot, record.pendingFullSnapshotReason)
  record.lastSnapshotAt = nowMs()
  post({ type: 'screen', snapshot })
  emitPerfIfDue(record)
}

const scheduleSnapshot = (record: CoreTerminalRecord, forceFull = false, fullReason?: ThreadedTerminalFullReason) => {
  if (record.disposed) return
  if (forceFull) {
    record.pendingFullSnapshot = true
    record.pendingFullSnapshotReason = fullReason || record.pendingFullSnapshotReason || 'unknown'
  }
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
    if (dueAt >= record.snapshotDueAt) return
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
    const buffer = record.terminal.buffer.active
    record.dirtyRows.add(absoluteCursorRow(buffer) - buffer.viewportY)
  })
  record.terminal.onLineFeed(() => {
    const buffer = record.terminal.buffer.active
    record.dirtyRows.add(absoluteCursorRow(buffer) - buffer.viewportY)
  })
  record.terminal.onScroll(() => {
    if (record.programmaticScrollDepth === 0) {
      record.followOutput = isAtScrollBottom(record)
    }
    record.pendingFullSnapshot = true
    record.pendingFullSnapshotReason = record.pendingFullSnapshotReason || 'jump'
    scheduleSnapshot(record, true, 'jump')
  })
  record.terminal.onResize(({ cols, rows }) => {
    record.pendingFullSnapshot = true
    record.pendingFullSnapshotReason = 'resize'
    post({ type: 'resize', terminalId: record.terminalId, cols, rows })
  })
  record.terminal.onData((data) => {
    post({ type: 'data', terminalId: record.terminalId, data })
  })
  record.terminal.onBinary((data) => {
    post({ type: 'data', terminalId: record.terminalId, data })
  })
  record.terminal.onTitleChange((title) => {
    const normalizedTitle = normalizeTerminalProgramTitle(title)
    if (normalizedTitle) post({ type: 'title', terminalId: record.terminalId, title: normalizedTitle })
  })
  record.terminal.parser.registerOscHandler(9, (data) => {
    const change = parseTerminalProgressOsc(data)
    if (change.action === 'ignore') return false
    post({ type: 'progress', terminalId: record.terminalId, progress: change.action === 'set' ? change.progress : null })
    return true
  })
  record.terminal.parser.registerOscHandler(7, (data) => {
    const cwd = parseTerminalCurrentDirectoryOsc(data)
    if (!cwd) return false
    post({ type: 'cwd', terminalId: record.terminalId, cwd })
    return true
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
    keywordHighlight: options.keywordHighlight,
    keywordHighlightRules: compileThreadedKeywordHighlightRules(options.keywordHighlight),
    search: newSearchState(),
    seq: 0,
    pendingChunks: [],
    pendingBytes: 0,
    contentEpoch: 0,
    scheduled: false,
    flushTimer: null,
    flushDueAt: 0,
    disposed: false,
    pendingFullSnapshot: true,
    pendingFullSnapshotReason: 'create',
    dirtyRows: new Set(),
    lastVisibleLineSignatures: null,
    snapshotScheduled: false,
    snapshotTimer: null,
    snapshotDueAt: 0,
    lastSnapshotAt: 0,
    lastSnapshotViewportY: 0,
    followOutput: true,
    programmaticScrollDepth: 0,
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
  record.pendingFullSnapshotReason = 'settings'
  scheduleSnapshot(record, true, 'settings')
}

const applyKeywordHighlight = (record: CoreTerminalRecord, config: ThreadedTerminalKeywordHighlightConfig) => {
  record.keywordHighlight = config
  record.keywordHighlightRules = compileThreadedKeywordHighlightRules(config)
  record.pendingFullSnapshot = true
  record.pendingFullSnapshotReason = 'settings'
  scheduleSnapshot(record, true, 'settings')
}

const enqueueChunk = (record: CoreTerminalRecord, chunk: string, sessionId?: string) => {
  const bytes = textByteLength(chunk)
  record.pendingChunks.push({
    data: chunk,
    bytes,
    sessionId: sessionId || undefined
  })
  record.pendingBytes += bytes
}

const takeBatch = (record: CoreTerminalRecord) => {
  const chunks: string[] = []
  let bytes = 0
  const sessionId = record.pendingChunks[0]?.sessionId
  while (record.pendingChunks.length) {
    const chunk = record.pendingChunks[0]
    if (chunk.sessionId !== sessionId) break
    if (chunks.length && bytes + chunk.bytes > defaultBatchBytes) break
    chunks.push(chunk.data)
    bytes += chunk.bytes
    record.pendingChunks.shift()
    record.pendingBytes = Math.max(0, record.pendingBytes - chunk.bytes)
    if (bytes >= defaultBatchBytes) break
  }
  return { data: chunks.join(''), bytes, sessionId }
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
  const { data, bytes, sessionId } = takeBatch(record)
  const beforeBuffer = record.terminal.buffer.active
  const beforeCursorAbsoluteY = absoluteCursorRow(beforeBuffer)
  const beforeViewportY = beforeBuffer.viewportY
  const beforeBaseY = beforeBuffer.baseY
  const shouldFollowOutput = record.followOutput || isAtScrollBottom(record)
  if (shouldFollowOutput) record.followOutput = true
  record.perf.chunks += 1
  record.perf.bytes += bytes
  record.perf.pendingBytes = record.pendingBytes
  record.perf.pendingChunks = record.pendingChunks.length
  record.perf.maxPendingBytes = Math.max(record.perf.maxPendingBytes, record.pendingBytes)
  const parseStartedAt = nowMs()
  record.programmaticScrollDepth += 1
  record.terminal.write(data, () => {
    try {
      record.perf.parseMs += nowMs() - parseStartedAt
      record.perf.flushMs += nowMs() - flushStartedAt
      if (sessionId) post({ type: 'consumed', terminalId: record.terminalId, sessionId, bytes })
      if (shouldFollowOutput && !isAtScrollBottom(record)) {
        record.terminal.scrollToBottom()
      }
      const buffer = record.terminal.buffer.active
      const viewportChanged = buffer.viewportY !== beforeViewportY
      const baseChanged = buffer.baseY !== beforeBaseY
      record.contentEpoch += 1
      if (viewportChanged || (shouldFollowOutput && baseChanged)) {
        // 滚动场景必发全量快照,行级签名 diff 的结果会被整体丢弃,直接跳过计算。
        record.lastVisibleLineSignatures = null
        scheduleSnapshot(record, true, 'jump')
      } else {
        markChangedVisibleRows(record)
        record.dirtyRows.add(beforeCursorAbsoluteY - buffer.viewportY)
        record.dirtyRows.add(absoluteCursorRow(buffer) - buffer.viewportY)
        scheduleSnapshot(record)
      }
    } finally {
      record.programmaticScrollDepth = Math.max(0, record.programmaticScrollDepth - 1)
    }
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

const lineCellEntries = (record: CoreTerminalRecord, lineIndex: number) => {
  const line = record.terminal.buffer.active.getLine(lineIndex)
  if (!line) return []
  const cell = record.terminal.buffer.active.getNullCell()
  const entries: Array<{ char: string; start: number; end: number }> = []
  for (let x = 0; x < record.terminal.cols; x += 1) {
    const nextCell = line.getCell(x, cell)
    if (!nextCell || nextCell.getWidth() === 0) continue
    const char = nextCell.getChars() || ' '
    const width = Math.max(1, nextCell.getWidth() || 1)
    entries.push({ char, start: x, end: x + width })
  }
  return entries
}

const textForSelectionRow = (record: CoreTerminalRecord, row: number, startX: number, endX: number) => {
  let text = ''
  for (const entry of lineCellEntries(record, row)) {
    if (entry.end > startX && entry.start < endX) text += entry.char
  }
  return text.replace(/\s+$/g, '')
}

const readSelectionText = (record: CoreTerminalRecord, range: ThreadedTerminalSelectionRange) => {
  const anchor = range.start
  const focus = range.end
  if (anchor.x === focus.x && anchor.y === focus.y) return ''
  const anchorBeforeFocus = anchor.y < focus.y || (anchor.y === focus.y && anchor.x <= focus.x)
  const start = anchorBeforeFocus ? anchor : focus
  const end = anchorBeforeFocus ? focus : anchor
  const buffer = record.terminal.buffer.active
  const firstRow = Math.max(0, Math.min(buffer.length - 1, Math.floor(start.y)))
  const lastRow = Math.max(0, Math.min(buffer.length - 1, Math.floor(end.y)))
  if (lastRow < firstRow) return ''
  const lines: string[] = []
  for (let row = firstRow; row <= lastRow; row += 1) {
    const startX = row === start.y ? Math.max(0, Math.min(record.terminal.cols, Math.floor(start.x))) : 0
    const endX = row === end.y ? Math.max(0, Math.min(record.terminal.cols, Math.floor(end.x))) : record.terminal.cols
    const lineText = textForSelectionRow(record, row, startX, endX)
    const line = buffer.getLine(row)
    if (row > firstRow && line?.isWrapped) {
      lines[lines.length - 1] = `${lines[lines.length - 1] || ''}${lineText}`
    } else {
      lines.push(lineText)
    }
  }
  return lines.join('\n').replace(/\s+$/g, '')
}

const mouseButtonCode = (button: ThreadedTerminalMouseButton) => {
  if (button === 'left') return 0
  if (button === 'middle') return 1
  if (button === 'right') return 2
  if (button === 'wheel') return 4
  return 3
}

const mouseActionCode = (action: ThreadedTerminalMouseAction) => {
  if (action === 'up' || action === 'wheel-up') return 0
  if (action === 'down' || action === 'wheel-down') return 1
  if (action === 'wheel-left') return 2
  if (action === 'wheel-right') return 3
  return 32
}

const triggerMouseEvent = (record: CoreTerminalRecord, event: ThreadedTerminalMouseEventPayload) => {
  const coreMouseService = (record.terminal as HeadlessTerminalWithCoreMouse)._core?.coreMouseService
  if (!coreMouseService?.triggerMouseEvent) return false
  return Boolean(coreMouseService.triggerMouseEvent({
    col: Math.max(0, Math.min(record.terminal.cols - 1, Math.floor(event.col))),
    row: Math.max(0, Math.min(record.terminal.rows - 1, Math.floor(event.row))),
    x: Math.max(0, Math.floor(event.x)),
    y: Math.max(0, Math.floor(event.y)),
    button: mouseButtonCode(event.button),
    action: mouseActionCode(event.action),
    ctrl: Boolean(event.ctrl),
    alt: Boolean(event.alt),
    shift: Boolean(event.shift)
  }))
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
  keywordHighlight: record.keywordHighlight,
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
    theme: state.theme,
    keywordHighlight: state.keywordHighlight
  })
  terminals.set(state.terminalId, record)
  if (state.scrollbackText) {
    record.pendingFullSnapshotReason = 'import'
    enqueueChunk(record, state.scrollbackText)
    flushRecord(record)
  } else {
    scheduleSnapshot(record, true, 'import')
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
        enqueueChunk(record, message.initialData)
        scheduleFlush(record)
      } else {
        scheduleSnapshot(record, true, 'create')
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
      enqueueChunk(record, message.data, message.sessionId)
      record.perf.maxPendingBytes = Math.max(record.perf.maxPendingBytes, record.pendingBytes)
      scheduleFlush(record)
      return
    }
    if (message.type === 'input') {
      const beforeViewportY = record.terminal.buffer.active.viewportY
      record.followOutput = true
      runProgrammaticScroll(record, () => {
        record.terminal.scrollToBottom()
        record.terminal.input(message.data)
      })
      if (record.terminal.buffer.active.viewportY !== beforeViewportY) scheduleSnapshot(record, true, 'jump')
      return
    }
    if (message.type === 'resize') {
      const cols = Math.max(2, Math.floor(message.cols))
      const rows = Math.max(1, Math.floor(message.rows))
      if (cols !== record.terminal.cols || rows !== record.terminal.rows) {
        record.terminal.resize(cols, rows)
        record.contentEpoch += 1
        record.lastVisibleLineSignatures = null
      }
      record.pendingFullSnapshot = true
      record.pendingFullSnapshotReason = 'resize'
      scheduleSnapshot(record, true, 'resize')
      return
    }
    if (message.type === 'session') {
      record.sessionId = message.sessionId || undefined
      return
    }
    if (message.type === 'settings') {
      applySettings(record, message.settings, message.theme)
      return
    }
    if (message.type === 'keyword-highlight') {
      applyKeywordHighlight(record, message.config)
      return
    }
    if (message.type === 'visibility') {
      const wasVisible = record.visible
      const wasPriority = record.priority
      record.visible = message.visible
      record.priority = message.priority
      if (record.pendingChunks.length && priorityRank(record.priority, record.visible) > priorityRank(wasPriority, wasVisible)) scheduleFlush(record)
      if (record.visible && (!wasVisible || wasPriority !== record.priority)) scheduleSnapshot(record, true, 'visibility')
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
      record.contentEpoch += 1
      record.search = newSearchState()
      record.terminal.clear()
      record.pendingFullSnapshot = true
      record.pendingFullSnapshotReason = 'clear'
      scheduleSnapshot(record, true, 'clear')
      return
    }
    if (message.type === 'scroll-to-bottom') {
      const beforeViewportY = record.terminal.buffer.active.viewportY
      record.terminal.scrollToBottom()
      record.followOutput = true
      if (record.terminal.buffer.active.viewportY !== beforeViewportY) scheduleSnapshot(record, true, 'jump')
      return
    }
    if (message.type === 'scroll-lines') {
      const amount = Math.trunc(message.amount)
      if (!amount) return
      const beforeViewportY = record.terminal.buffer.active.viewportY
      record.terminal.scrollLines(amount)
      record.followOutput = isAtScrollBottom(record)
      if (record.terminal.buffer.active.viewportY !== beforeViewportY) scheduleSnapshot(record, true, 'jump')
      return
    }
    if (message.type === 'scroll-to-line') {
      const line = Math.trunc(message.line)
      const beforeViewportY = record.terminal.buffer.active.viewportY
      record.terminal.scrollToLine(line)
      record.followOutput = isAtScrollBottom(record)
      if (record.terminal.buffer.active.viewportY !== beforeViewportY) scheduleSnapshot(record, true, 'jump')
      return
    }
    if (message.type === 'search') {
      applySearch(record, message.query, message.direction, {
        caseSensitive: message.caseSensitive,
        incremental: message.incremental
      })
      return
    }
    if (message.type === 'search-clear') {
      clearSearch(record)
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
    if (message.type === 'read-selection') {
      post({
        type: 'read-selection-result',
        requestId: message.requestId,
        terminalId: record.terminalId,
        text: readSelectionText(record, message.range)
      })
      return
    }
    if (message.type === 'mouse-event') {
      triggerMouseEvent(record, message.event)
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
