import type { TerminalSettings } from '@/stores/workspace'

export type ThreadedTerminalPriority = 'active' | 'visible' | 'background'

export type ThreadedTerminalSurface = 'workspace' | 'codex'

export type ThreadedTerminalSettings = Pick<
  TerminalSettings,
  'terminalType' | 'fontFamily' | 'fontSize' | 'lineHeight' | 'cursorBlink' | 'cursorStyle' | 'scrollBack'
>

export type ThreadedTerminalTheme = {
  background: string
  foreground: string
  cursor: string
  selectionBackground?: string
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
}

export type ThreadedTerminalRenderSettings = {
  fontFamily: string
  fontSize: number
  lineHeight: number
  cursorBlink: boolean
  cursorStyle: ThreadedTerminalSettings['cursorStyle']
  theme: ThreadedTerminalTheme
}

export type ThreadedTerminalScreenLine = {
  y: number
  text: string
  cells?: ThreadedTerminalCellRun[]
  wrapped?: boolean
}

export type ThreadedTerminalCellRun = {
  x: number
  text: string
  fg?: string
  bg?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  inverse?: boolean
}

export type ThreadedTerminalScreenSnapshot = {
  terminalId: string
  seq: number
  cols: number
  rows: number
  cursorX: number
  cursorY: number
  viewportY: number
  baseY: number
  lines: ThreadedTerminalScreenLine[]
  dirtyRows: number[]
  full: boolean
  visible: boolean
  priority: ThreadedTerminalPriority
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
  scrollbackText: string
}

export type ThreadedTerminalCoreRequest =
  | { type: 'create'; requestId?: string; options: ThreadedTerminalCreateOptions; initialData?: string }
  | { type: 'data'; terminalId: string; data: string }
  | { type: 'input'; terminalId: string; data: string }
  | { type: 'resize'; terminalId: string; cols: number; rows: number }
  | { type: 'settings'; terminalId: string; settings: ThreadedTerminalSettings; theme: ThreadedTerminalTheme }
  | { type: 'visibility'; terminalId: string; visible: boolean; priority: ThreadedTerminalPriority }
  | { type: 'priority'; terminalId: string; priority: ThreadedTerminalPriority }
  | { type: 'clear'; terminalId: string }
  | { type: 'scroll-to-bottom'; terminalId: string }
  | { type: 'read-screen'; terminalId: string; requestId: string; tailLines?: number }
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
  | { type: 'read-screen-result'; requestId: string; terminalId: string; text: string; cols: number; rows: number }
  | { type: 'export-result'; requestId: string; state: ThreadedTerminalExportedState }
  | { type: 'perf'; sample: ThreadedTerminalPerfSample }
  | { type: 'pong'; requestId: string }
  | { type: 'error'; requestId?: string; terminalId?: string; message: string }

export type ThreadedTerminalRenderAttachOptions = {
  terminalId: string
  groupId: string
  canvas: OffscreenCanvas
  width: number
  height: number
  devicePixelRatio: number
  settings: ThreadedTerminalRenderSettings
}

export type ThreadedTerminalRenderRequest =
  | { type: 'attach'; options: ThreadedTerminalRenderAttachOptions }
  | { type: 'resize'; terminalId: string; width: number; height: number; devicePixelRatio: number }
  | { type: 'settings'; terminalId: string; settings: ThreadedTerminalRenderSettings }
  | { type: 'screen'; snapshot: ThreadedTerminalScreenSnapshot }
  | { type: 'visibility'; terminalId: string; visible: boolean }
  | { type: 'clear'; terminalId: string }
  | { type: 'dispose'; terminalId: string }
  | { type: 'ping'; requestId: string }

export type ThreadedTerminalRenderResponse =
  | { type: 'ready' }
  | { type: 'attached'; terminalId: string }
  | { type: 'frame'; terminalId: string; seq: number; frameMs: number; paintedRows: number }
  | { type: 'perf'; terminalId: string; frames: number; avgFrameMs: number; maxFrameMs: number; skippedFrames: number }
  | { type: 'pong'; requestId: string }
  | { type: 'error'; terminalId?: string; requestId?: string; message: string }

export type ThreadedTerminalHostCapability = {
  supported: boolean
  reason?: string
}
