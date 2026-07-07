import type { TerminalSettings } from '@/stores/workspace'
import type { KeywordHighlightUserConfig } from '@shared/contracts/appRuntime'
import type { TerminalProgress } from '@/services/terminal/terminalOscRuntime'

export type ThreadedTerminalPriority = 'active' | 'visible' | 'background'

export type ThreadedTerminalSurface = 'workspace' | 'codex'

export type ThreadedTerminalFullReason = 'create' | 'import' | 'settings' | 'resize' | 'visibility' | 'clear' | 'jump' | 'search' | 'unknown'

export type ThreadedTerminalAnsiPalette = {
  black?: string
  red?: string
  green?: string
  yellow?: string
  blue?: string
  magenta?: string
  cyan?: string
  white?: string
  brightBlack?: string
  brightRed?: string
  brightGreen?: string
  brightYellow?: string
  brightBlue?: string
  brightMagenta?: string
  brightCyan?: string
  brightWhite?: string
}

export type ThreadedTerminalSettings = Pick<
  TerminalSettings,
  'terminalType' | 'fontFamily' | 'fontSize' | 'lineHeight' | 'cursorBlink' | 'cursorStyle' | 'scrollBack'
>

export type ThreadedTerminalTheme = {
  background: string
  contrastBackground?: string
  foreground: string
  minimumContrastRatio?: number
  cursor: string
  cursorAccent?: string
  selectionBackground?: string
  black?: string
  red?: string
  green?: string
  yellow?: string
  blue?: string
  magenta?: string
  cyan?: string
  white?: string
  brightBlack?: string
  brightRed?: string
  brightGreen?: string
  brightYellow?: string
  brightBlue?: string
  brightMagenta?: string
  brightCyan?: string
  brightWhite?: string
  ansiBackground?: ThreadedTerminalAnsiPalette
  scrollbarTrack?: string
  scrollbarThumb?: string
  scrollbarThumbHover?: string
}

export type ThreadedTerminalKeywordHighlightConfig = KeywordHighlightUserConfig | null | undefined

export type ThreadedTerminalSelectionPoint = {
  x: number
  y: number
}

export type ThreadedTerminalSelectionRange = {
  start: ThreadedTerminalSelectionPoint
  end: ThreadedTerminalSelectionPoint
}

export type ThreadedTerminalMouseTrackingMode = 'none' | 'x10' | 'vt200' | 'drag' | 'any'

export type ThreadedTerminalActiveBufferType = 'normal' | 'alternate'

export type ThreadedTerminalModeState = {
  applicationCursorKeysMode: boolean
  applicationKeypadMode: boolean
  bracketedPasteMode: boolean
  mouseTrackingMode: ThreadedTerminalMouseTrackingMode
  activeBufferType: ThreadedTerminalActiveBufferType
}

export type ThreadedTerminalMouseButton = 'left' | 'middle' | 'right' | 'none' | 'wheel'

export type ThreadedTerminalMouseAction = 'down' | 'up' | 'move' | 'wheel-up' | 'wheel-down' | 'wheel-left' | 'wheel-right'

export type ThreadedTerminalMouseEventPayload = {
  x: number
  y: number
  col: number
  row: number
  button: ThreadedTerminalMouseButton
  action: ThreadedTerminalMouseAction
  ctrl?: boolean
  alt?: boolean
  shift?: boolean
}

export type ThreadedTerminalHighlightRun = {
  x: number
  text: string
  chars?: string[]
  widths?: number[]
  columns?: number
  fg?: string
  bg?: string
  bold?: boolean
}

export type ThreadedTerminalCreateOptions = {
  terminalId: string
  sessionId?: string
  groupId: string
  surface: ThreadedTerminalSurface
  cols: number
  rows: number
  visible: boolean
  priority: ThreadedTerminalPriority
  settings: ThreadedTerminalSettings
  theme: ThreadedTerminalTheme
  keywordHighlight?: ThreadedTerminalKeywordHighlightConfig
}

export type ThreadedTerminalRenderSettings = {
  fontFamily: string
  fontSize: number
  lineHeight: number
  cursorBlink: boolean
  cursorStyle: ThreadedTerminalSettings['cursorStyle']
  theme: ThreadedTerminalTheme
}

export type ThreadedTerminalCellMetrics = {
  width: number
  height: number
  baseline: number
}

export type ThreadedTerminalRenderBackend = '2d' | 'webgl2'

export type ThreadedTerminalGpuInfo = {
  renderer?: string
  vendor?: string
  unmaskedRenderer?: string
  unmaskedVendor?: string
}

export type ThreadedTerminalRenderSurfaceRect = {
  x: number
  y: number
  width: number
  height: number
}

export type ThreadedTerminalGeometry = {
  seq: number
  canvasWidth: number
  canvasHeight: number
  cols: number
  rows: number
  cellWidth: number
  cellHeight: number
  baseline: number
  paddingLeft: number
  paddingRight: number
  paddingTop: number
  paddingBottom: number
}

export type ThreadedTerminalScreenLine = {
  y: number
  text: string
  runs?: ThreadedTerminalCellRun[]
  cells?: ThreadedTerminalCellRun[]
  highlights?: ThreadedTerminalHighlightRun[]
  wrapped?: boolean
}

export type ThreadedTerminalCellRun = {
  x: number
  text: string
  chars?: string[]
  widths?: number[]
  columns?: number
  fg?: string
  bg?: string
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  overline?: boolean
  hidden?: boolean
  blink?: boolean
  inverse?: boolean
}

export type ThreadedTerminalScreenSnapshot = {
  terminalId: string
  seq: number
  cols: number
  rows: number
  cursorX: number
  cursorY: number
  cursorAbsoluteY?: number
  viewportY: number
  baseY: number
  lines: ThreadedTerminalScreenLine[]
  dirtyRows: number[]
  full: boolean
  fullReason?: ThreadedTerminalFullReason
  repaintReason?: ThreadedTerminalFullReason
  scrollDeltaRows?: number
  visible: boolean
  priority: ThreadedTerminalPriority
  modes?: ThreadedTerminalModeState
}

export type ThreadedTerminalPerfSample = {
  terminalId: string
  workerId?: number
  priority: ThreadedTerminalPriority
  visible: boolean
  chunks: number
  bytes: number
  parseMs: number
  snapshotMs: number
  flushMs: number
  pendingBytes: number
  pendingChunks: number
  maxPendingBytes: number
  droppedPaints: number
}

export type ThreadedTerminalExportedState = {
  terminalId: string
  sessionId?: string
  groupId: string
  surface: ThreadedTerminalSurface
  cols: number
  rows: number
  visible: boolean
  priority: ThreadedTerminalPriority
  settings: ThreadedTerminalSettings
  theme: ThreadedTerminalTheme
  keywordHighlight?: ThreadedTerminalKeywordHighlightConfig
  scrollbackText: string
}

export type ThreadedTerminalCoreRequest =
  | { type: 'create'; requestId?: string; options: ThreadedTerminalCreateOptions; initialData?: string }
  | { type: 'data'; terminalId: string; data: string }
  | { type: 'input'; terminalId: string; data: string }
  | { type: 'resize'; terminalId: string; cols: number; rows: number }
  | { type: 'session'; terminalId: string; sessionId?: string }
  | { type: 'settings'; terminalId: string; settings: ThreadedTerminalSettings; theme: ThreadedTerminalTheme }
  | { type: 'keyword-highlight'; terminalId: string; config?: ThreadedTerminalKeywordHighlightConfig }
  | { type: 'visibility'; terminalId: string; visible: boolean; priority: ThreadedTerminalPriority }
  | { type: 'priority'; terminalId: string; priority: ThreadedTerminalPriority }
  | { type: 'clear'; terminalId: string }
  | { type: 'scroll-to-bottom'; terminalId: string }
  | { type: 'scroll-lines'; terminalId: string; amount: number }
  | { type: 'scroll-to-line'; terminalId: string; line: number }
  | { type: 'search'; terminalId: string; query: string; direction: 'next' | 'previous'; caseSensitive?: boolean; incremental?: boolean }
  | { type: 'search-clear'; terminalId: string }
  | { type: 'read-screen'; terminalId: string; requestId: string; tailLines?: number }
  | { type: 'read-selection'; terminalId: string; requestId: string; range: ThreadedTerminalSelectionRange }
  | { type: 'mouse-event'; terminalId: string; event: ThreadedTerminalMouseEventPayload }
  | { type: 'export'; terminalId: string; requestId: string }
  | { type: 'import'; requestId?: string; state: ThreadedTerminalExportedState }
  | { type: 'dispose'; terminalId: string }
  | { type: 'ping'; requestId: string }

export type ThreadedTerminalCoreResponse =
  | { type: 'ready'; workerId?: number }
  | { type: 'created'; requestId?: string; terminalId: string; workerId?: number }
  | { type: 'screen'; snapshot: ThreadedTerminalScreenSnapshot }
  | { type: 'resize'; terminalId: string; cols: number; rows: number }
  | { type: 'data'; terminalId: string; data: string }
  | { type: 'title'; terminalId: string; title: string }
  | { type: 'progress'; terminalId: string; progress: TerminalProgress | null }
  | { type: 'read-screen-result'; requestId: string; terminalId: string; text: string; cols: number; rows: number }
  | { type: 'read-selection-result'; requestId: string; terminalId: string; text: string }
  | { type: 'export-result'; requestId: string; state: ThreadedTerminalExportedState }
  | { type: 'consumed'; terminalId: string; sessionId?: string; bytes: number }
  | { type: 'perf'; sample: ThreadedTerminalPerfSample }
  | { type: 'pong'; requestId: string }
  | { type: 'error'; requestId?: string; terminalId?: string; message: string }

export type ThreadedTerminalRenderGroupAttachOptions = {
  renderGroupId: string
  canvas: OffscreenCanvas
  devicePixelRatio: number
  width: number
  height: number
  backend?: ThreadedTerminalRenderBackend
}

export type ThreadedTerminalRenderAttachOptions = {
  terminalId: string
  groupId: string
  renderGroupId: string
  rect: ThreadedTerminalRenderSurfaceRect
  settings: ThreadedTerminalRenderSettings
  geometry: ThreadedTerminalGeometry
}

export type ThreadedTerminalRenderRequest =
  | { type: 'attach-group'; options: ThreadedTerminalRenderGroupAttachOptions }
  | { type: 'resize-group'; renderGroupId: string; devicePixelRatio: number; width: number; height: number }
  | { type: 'dispose-group'; renderGroupId: string }
  | { type: 'attach'; options: ThreadedTerminalRenderAttachOptions }
  | { type: 'resize'; terminalId: string; rect: ThreadedTerminalRenderSurfaceRect; geometry: ThreadedTerminalGeometry }
  | { type: 'settings'; terminalId: string; settings: ThreadedTerminalRenderSettings; geometry: ThreadedTerminalGeometry }
  | { type: 'screen'; snapshot: ThreadedTerminalScreenSnapshot }
  | { type: 'visibility'; terminalId: string; visible: boolean }
  | { type: 'clear'; terminalId: string }
  | { type: 'dispose'; terminalId: string }
  | { type: 'ping'; requestId: string }

export type ThreadedTerminalRenderResponse =
  | { type: 'ready' }
  | { type: 'group-attached'; renderGroupId: string; backend: ThreadedTerminalRenderBackend; width: number; height: number; gpu?: ThreadedTerminalGpuInfo }
  | { type: 'attached'; terminalId: string }
  | { type: 'frame'; terminalId: string; seq: number; frameMs: number; paintedRows: number; full?: boolean; fullReason?: ThreadedTerminalFullReason; repaintReason?: ThreadedTerminalFullReason; scrollDeltaRows?: number }
  | { type: 'perf'; terminalId: string; frames: number; avgFrameMs: number; maxFrameMs: number; skippedFrames: number }
  | { type: 'pong'; requestId: string }
  | { type: 'error'; terminalId?: string; requestId?: string; message: string }

export type ThreadedTerminalHostCapability = {
  supported: boolean
  reason?: string
}
