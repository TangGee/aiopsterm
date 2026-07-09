import { nextTick, type ComputedRef } from 'vue'
import { appRuntimeClient } from '@/services/app/appRuntimeClient'
import { terminalClient } from '@/services/terminal/terminalClient'
import { isTerminalWorkspacePanel } from '@/services/terminal/terminalPanelRuntime'
import { getThreadedTerminalDebugStats, isThreadedTerminalHost, type ThreadedTerminalHost } from '@/services/terminal/threadedTerminalRuntime'
import type { TerminalView } from '@/services/terminal/terminalWorkspaceViewRuntime'
import type { TerminalPanel, useWorkspaceStore } from '@/stores/workspace'

type WorkspaceStore = ReturnType<typeof useWorkspaceStore>

export type TerminalStressProfileName = 'frame-small-chunk' | 'pty-burst' | 'mixed-background' | 'mixed-switch'

type TerminalStressProfile = {
  foregroundIntervalMs: number
  backgroundIntervalMs: number
  foregroundChunks: number
  backgroundChunks: number
  foregroundLinesPerChunk: number
  backgroundLinesPerChunk: number
  foregroundPayloadBytes: number
  backgroundPayloadBytes: number
}

type TerminalStressWriteSummary = {
  foregroundWrites: number
  backgroundWrites: number
  foregroundChunks: number
  backgroundChunks: number
  foregroundBytes: number
  backgroundBytes: number
}

type TerminalStressMetricSummary = {
  samples: number
  avg: number
  p50: number
  p95: number
  p99: number
  max: number
}

type TerminalStressMemorySample = {
  at: number
  phase: string
  jsHeapUsedBytes?: number
  jsHeapTotalBytes?: number
  jsHeapLimitBytes?: number
  workingSetSizeKb?: number
  privateBytesKb?: number
  canvasCount: number
  renderGroupCanvasCount: number
  renderGroupCount: number
  threadedHostCount: number
  gcRuns?: number
}

type TerminalStressMemorySummary = {
  samples: TerminalStressMemorySample[]
  jsHeapUsedDeltaBytes?: number
  jsHeapUsedMaxBytes?: number
  workingSetDeltaKb?: number
  workingSetMaxKb?: number
  gcSupported: boolean
  gcRuns: number
  endBeforeGcHeapUsedBytes?: number
  endAfterGcHeapUsedBytes?: number
  postGcHeapDeltaBytes?: number
}

export type TerminalStressQueueSample = {
  at: number
  ingressPanels: number
  ingressBytes: number
  ingressChunks: number
  historyPanels: number
  historyBytes: number
}

type TerminalStressQueueSummary = {
  samples: TerminalStressQueueSample[]
  maxIngressPanels: number
  maxIngressBytes: number
  maxIngressChunks: number
  maxHistoryPanels: number
  maxHistoryBytes: number
}

type TerminalStressGpuSummary = {
  webgl: boolean
  webgl2: boolean
  hardwareLikely: boolean
  softwareRenderer: boolean
  renderer?: string
  vendor?: string
  unmaskedRenderer?: string
  unmaskedVendor?: string
  mainFeatureStatus?: Record<string, unknown>
  renderGroups: ReturnType<typeof getThreadedTerminalDebugStats>['renderGroups']
}

const gpuLooksSoftware = (values: Array<unknown>) => {
  const text = values
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase()
  return /\b(swiftshader|llvmpipe|softpipe|software|disabled_software)\b/.test(text)
}

type TerminalStressSwitchSummary = {
  enabled: boolean
  intervalMs: number
  count: number
  failed: number
  paintLatency: TerminalStressMetricSummary
}

type TerminalStressTeardownSummary = {
  enabled: boolean
  closedPanels: number
  baseline: TerminalStressMemorySample
  beforeClose: TerminalStressMemorySample
  afterClose: TerminalStressMemorySample
  gcSupported: boolean
  gcRuns: number
  hostCountDelta: number
  canvasCountDelta: number
  renderGroupCountDelta: number
  renderGroupCanvasCountDelta: number
  jsHeapUsedDeltaBytes?: number
  workingSetDeltaKb?: number
  threaded: ReturnType<typeof getThreadedTerminalDebugStats>
  remainingStressHosts: Array<{
    terminalId: string
    sessionId?: string
    visible: boolean
    surfaceAttached: boolean
  }>
  errors: string[]
}

type TerminalStressRegressionProbe = {
  ok: boolean
  details?: Record<string, unknown>
  error?: string
}

type TerminalStressRegressionSummary = {
  contentFreshness: TerminalStressRegressionProbe
  foregroundSwitchRefresh: TerminalStressRegressionProbe
  ansiStyleDirtyRepaint: TerminalStressRegressionProbe
  scrollbackAndScrollbar: TerminalStressRegressionProbe
  selectionSoftWrap: TerminalStressRegressionProbe
  keyboardInputFocus: TerminalStressRegressionProbe
}

export type TerminalStressHarnessResult = {
  profile: TerminalStressProfileName
  foreground: number
  background: number
  durationMs: number
  writtenBytes: number
  writes: TerminalStressWriteSummary
  frames: number
  avgFrameMs: number
  p95FrameMs: number
  p99FrameMs: number
  maxFrameMs: number
  panels: number
  threaded: ReturnType<typeof getThreadedTerminalDebugStats>
  gpu: TerminalStressGpuSummary
  paintLatency: TerminalStressMetricSummary
  paintFrameMs: TerminalStressMetricSummary
  paintRows: TerminalStressMetricSummary
  paintScrollRows: TerminalStressMetricSummary
  paintFullFrames: number
  paintFullReasons: Record<string, number>
  paintRepaintReasons: Record<string, number>
  realEchoLatency: TerminalStressMetricSummary & { available: boolean; error?: string }
  regressions: TerminalStressRegressionSummary
  memory: TerminalStressMemorySummary
  queues: TerminalStressQueueSummary
  switches: TerminalStressSwitchSummary
  teardown: TerminalStressTeardownSummary
  canvasCount: {
    before: number
    after: number
  }
  errors: string[]
}

type PaintableThreadedStressCandidate = {
  panel: TerminalPanel
  terminal: ThreadedTerminalHost
  element: HTMLElement
}

export type TerminalStressHarnessInput = {
  workspace: WorkspaceStore
  visibleTerminalPanels: ComputedRef<TerminalPanel[]>
  terminalViews: Map<string, TerminalView>
  getTerminalElement: (panelId: string) => HTMLElement | null
  syncPanelViews: () => void | Promise<void>
  syncTerminalView: (panel: TerminalPanel, options?: { suppressInputReplies?: boolean; refit?: boolean }) => boolean
  scheduleVisibleTerminalFit: (options?: { scrollToBottom?: boolean; frames?: number; forceGeometry?: boolean }) => void
  startLocalTerminalForPanel: (panel: TerminalPanel) => Promise<boolean>
  queueTerminalIngressData: (sessionId: string, data: string, zmodemMs: number) => void
  flushTerminalIngressBatch: (sessionId: string) => void
  flushAllTerminalIngressBatches: () => void
  flushAllTerminalHistoryBatches: () => void
  appendTerminalHistoryBatched: (sessionId: string, data: string, options?: { flushMs?: number }) => void
  sampleQueues: () => TerminalStressQueueSample
}

declare global {
  interface Window {
    __AIOPSTERM_TERMINAL_STRESS__?: {
      run: (options?: { foreground?: number; background?: number; durationMs?: number; switchIntervalMs?: number; profile?: TerminalStressProfileName }) => Promise<TerminalStressHarnessResult>
    }
  }
}

const terminalStressProfiles: Record<TerminalStressProfileName, TerminalStressProfile> = {
  'frame-small-chunk': {
    foregroundIntervalMs: 16,
    backgroundIntervalMs: 16,
    foregroundChunks: 1,
    backgroundChunks: 1,
    foregroundLinesPerChunk: 1,
    backgroundLinesPerChunk: 1,
    foregroundPayloadBytes: 96,
    backgroundPayloadBytes: 96
  },
  'pty-burst': {
    foregroundIntervalMs: 64,
    backgroundIntervalMs: 128,
    foregroundChunks: 4,
    backgroundChunks: 4,
    foregroundLinesPerChunk: 2,
    backgroundLinesPerChunk: 3,
    foregroundPayloadBytes: 128,
    backgroundPayloadBytes: 160
  },
  'mixed-background': {
    foregroundIntervalMs: 16,
    backgroundIntervalMs: 96,
    foregroundChunks: 1,
    backgroundChunks: 4,
    foregroundLinesPerChunk: 1,
    backgroundLinesPerChunk: 2,
    foregroundPayloadBytes: 96,
    backgroundPayloadBytes: 160
  },
  'mixed-switch': {
    foregroundIntervalMs: 16,
    backgroundIntervalMs: 96,
    foregroundChunks: 1,
    backgroundChunks: 4,
    foregroundLinesPerChunk: 1,
    backgroundLinesPerChunk: 2,
    foregroundPayloadBytes: 96,
    backgroundPayloadBytes: 160
  }
}

const terminalTextEncoder = new TextEncoder()
const nowMs = () => globalThis.performance?.now?.() ?? Date.now()
const textByteLength = (value: string) => terminalTextEncoder.encode(value).length

const metricSummary = (values: number[]): TerminalStressMetricSummary => {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
  const percentile = (value: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * value)))] || 0
  return {
    samples: sorted.length,
    avg: sorted.reduce((sum, value) => sum + value, 0) / Math.max(1, sorted.length),
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
    max: sorted[sorted.length - 1] || 0
  }
}

const terminalTextContains = (screenText: string, expected: string) =>
  screenText.includes(expected) || screenText.replace(/\r?\n/g, '').includes(expected)

const nextStressAnimationFrame = () =>
  new Promise<void>((resolve) => {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => resolve())
      return
    }
    window.setTimeout(resolve, 16)
  })

const findLastStressSample = (samples: TerminalStressMemorySample[], phase: string) => {
  for (let index = samples.length - 1; index >= 0; index -= 1) {
    if (samples[index]?.phase === phase) return samples[index]
  }
  return undefined
}

const terminalStressProfileFor = (name?: string): { name: TerminalStressProfileName; profile: TerminalStressProfile } => {
  if (name && name in terminalStressProfiles) {
    const profileName = name as TerminalStressProfileName
    return { name: profileName, profile: terminalStressProfiles[profileName] }
  }
  return { name: 'mixed-switch', profile: terminalStressProfiles['mixed-switch'] }
}

const summarizeQueues = (samples: TerminalStressQueueSample[]): TerminalStressQueueSummary => ({
  samples,
  maxIngressPanels: samples.reduce((max, sample) => Math.max(max, sample.ingressPanels), 0),
  maxIngressBytes: samples.reduce((max, sample) => Math.max(max, sample.ingressBytes), 0),
  maxIngressChunks: samples.reduce((max, sample) => Math.max(max, sample.ingressChunks), 0),
  maxHistoryPanels: samples.reduce((max, sample) => Math.max(max, sample.historyPanels), 0),
  maxHistoryBytes: samples.reduce((max, sample) => Math.max(max, sample.historyBytes), 0)
})

const runStressGarbageCollection = async (runs = 2) => {
  const globalWithGc = globalThis as typeof globalThis & { gc?: () => void }
  if (typeof globalWithGc.gc !== 'function') return { supported: false, runs: 0 }
  for (let index = 0; index < runs; index += 1) {
    globalWithGc.gc()
    await new Promise((resolve) => window.setTimeout(resolve, 50))
  }
  return { supported: true, runs }
}

const syncStressPanelViews = async (input: Pick<TerminalStressHarnessInput, 'syncPanelViews'>) => {
  await input.syncPanelViews()
  await nextTick()
}

const isStressRenderableElement = (element: HTMLElement | null) => {
  if (!element?.isConnected) return false
  const rect = element.getBoundingClientRect()
  const width = Math.floor(element.clientWidth || rect.width || 0)
  const height = Math.floor(element.clientHeight || rect.height || 0)
  return width >= 24 && height >= 24
}

type StressSplitRect = { x: number; y: number; width: number; height: number }

const stressSplitRectsFor = (panels: TerminalPanel[]) => {
  const rects = new Map<string, StressSplitRect>()
  if (!panels.length) return rects
  const panelIds = new Set(panels.map((panel) => panel.id))
  const rootPanel = panels.find((panel) => !panel.split || !panel.splitSourceId || !panelIds.has(panel.splitSourceId)) || panels[0]
  rects.set(rootPanel.id, { x: 0, y: 0, width: 100, height: 100 })
  const panelIndex = new Map(panels.map((panel, index) => [panel.id, index]))
  panels
    .filter((panel) => panel.split && panel.splitSourceId && panelIds.has(panel.splitSourceId))
    .sort((left, right) => (left.splitOrder ?? panelIndex.get(left.id) ?? 0) - (right.splitOrder ?? panelIndex.get(right.id) ?? 0))
    .forEach((panel) => {
      if (!panel.splitSourceId) return
      const sourceRect = rects.get(panel.splitSourceId)
      if (!sourceRect) return
      const original = { ...sourceRect }
      if (panel.split === 'right') {
        const leftWidth = original.width / 2
        sourceRect.width = leftWidth
        rects.set(panel.id, {
          x: original.x + leftWidth,
          y: original.y,
          width: original.width - leftWidth,
          height: original.height
        })
        return
      }
      const topHeight = original.height / 2
      sourceRect.height = topHeight
      rects.set(panel.id, {
        x: original.x,
        y: original.y + topHeight,
        width: original.width,
        height: original.height - topHeight
      })
    })
  panels.forEach((panel) => {
    if (!rects.has(panel.id)) rects.set(panel.id, { x: 0, y: 0, width: 100, height: 100 })
  })
  return rects
}

const stressSplitGroupPanels = (workspace: WorkspaceStore) => {
  const active = workspace.panels.find((panel) => panel.id === workspace.activePanelId && isTerminalWorkspacePanel(panel)) ||
    workspace.panels.find((panel) => isTerminalWorkspacePanel(panel))
  if (!active) return []
  if (active.splitGroupId) {
    const groupPanels = workspace.panels.filter((panel) => isTerminalWorkspacePanel(panel) && panel.splitGroupId === active.splitGroupId)
    return groupPanels.length ? groupPanels : [active]
  }
  return [active]
}

const largestStressSplitTarget = (workspace: WorkspaceStore) => {
  const groupPanels = stressSplitGroupPanels(workspace)
  const rects = stressSplitRectsFor(groupPanels)
  return groupPanels
    .map((panel) => ({ panel, rect: rects.get(panel.id) || { x: 0, y: 0, width: 100, height: 100 } }))
    .sort((left, right) => (right.rect.width * right.rect.height) - (left.rect.width * left.rect.height))[0] || null
}

const sampleMemory = async (phase = 'sample', gcRuns?: number): Promise<TerminalStressMemorySample> => {
  const performanceMemory = (performance as Performance & {
    memory?: {
      usedJSHeapSize?: number
      totalJSHeapSize?: number
      jsHeapSizeLimit?: number
    }
  }).memory
  const processLike = (globalThis as {
    process?: {
      getProcessMemoryInfo?: () => Promise<{ workingSetSize?: number; privateBytes?: number }>
    }
  }).process
  let processMemory: { workingSetSize?: number; privateBytes?: number } | undefined
  try {
    processMemory = processLike?.getProcessMemoryInfo ? await processLike.getProcessMemoryInfo() : undefined
  } catch {
    processMemory = undefined
  }
  const threaded = getThreadedTerminalDebugStats()
  return {
    at: nowMs(),
    phase,
    jsHeapUsedBytes: performanceMemory?.usedJSHeapSize,
    jsHeapTotalBytes: performanceMemory?.totalJSHeapSize,
    jsHeapLimitBytes: performanceMemory?.jsHeapSizeLimit,
    workingSetSizeKb: processMemory?.workingSetSize,
    privateBytesKb: processMemory?.privateBytes,
    canvasCount: document.querySelectorAll('canvas').length,
    renderGroupCanvasCount: document.querySelectorAll('canvas.threaded-terminal-render-group-canvas').length,
    renderGroupCount: threaded.renderGroups.length,
    threadedHostCount: threaded.hostCount,
    gcRuns
  }
}

const summarizeMemory = (samples: TerminalStressMemorySample[]): TerminalStressMemorySummary => {
  const first = samples[0]
  const last = samples.at(-1)
  const postGc = findLastStressSample(samples, 'post-gc')
  const endBeforeGc = findLastStressSample(samples, 'end-before-gc')
  const jsHeapValues = samples.map((sample) => sample.jsHeapUsedBytes).filter((value): value is number => typeof value === 'number')
  const workingSetValues = samples.map((sample) => sample.workingSetSizeKb).filter((value): value is number => typeof value === 'number')
  const gcRuns = samples.reduce((total, sample) => total + (sample.gcRuns || 0), 0)
  return {
    samples,
    jsHeapUsedDeltaBytes:
      typeof first?.jsHeapUsedBytes === 'number' && typeof last?.jsHeapUsedBytes === 'number'
        ? last.jsHeapUsedBytes - first.jsHeapUsedBytes
        : undefined,
    jsHeapUsedMaxBytes: jsHeapValues.length ? Math.max(...jsHeapValues) : undefined,
    workingSetDeltaKb:
      typeof first?.workingSetSizeKb === 'number' && typeof last?.workingSetSizeKb === 'number'
        ? last.workingSetSizeKb - first.workingSetSizeKb
        : undefined,
    workingSetMaxKb: workingSetValues.length ? Math.max(...workingSetValues) : undefined,
    gcSupported: samples.some((sample) => typeof sample.gcRuns === 'number'),
    gcRuns,
    endBeforeGcHeapUsedBytes: endBeforeGc?.jsHeapUsedBytes,
    endAfterGcHeapUsedBytes: postGc?.jsHeapUsedBytes,
    postGcHeapDeltaBytes:
      typeof first?.jsHeapUsedBytes === 'number' && typeof postGc?.jsHeapUsedBytes === 'number'
        ? postGc.jsHeapUsedBytes - first.jsHeapUsedBytes
        : undefined
  }
}

const memoryDelta = (before?: number, after?: number) =>
  typeof before === 'number' && typeof after === 'number' ? after - before : undefined

const sampleGpuSummary = async (
  renderGroups = getThreadedTerminalDebugStats().renderGroups
): Promise<TerminalStressGpuSummary> => {
  const canvas = document.createElement('canvas')
  const webgl2Context = canvas.getContext('webgl2')
  const webglContext = webgl2Context || canvas.getContext('webgl') || canvas.getContext('experimental-webgl')
  const gl = webglContext as WebGLRenderingContext | WebGL2RenderingContext | null
  const debugInfo = gl?.getExtension?.('WEBGL_debug_renderer_info')
  const getStringParameter = (parameter: number) => {
    try {
      const value = gl?.getParameter(parameter)
      return typeof value === 'string' ? value : undefined
    } catch {
      return undefined
    }
  }
  const renderer = gl ? getStringParameter(gl.RENDERER) : undefined
  const vendor = gl ? getStringParameter(gl.VENDOR) : undefined
  const unmaskedRenderer = gl && debugInfo ? getStringParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : undefined
  const unmaskedVendor = gl && debugInfo ? getStringParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : undefined
  const mainFeatureStatus = await appRuntimeClient.getGpuFeatureStatus()?.().catch(() => undefined)
  const softwareRenderer = gpuLooksSoftware([
    renderer,
    vendor,
    unmaskedRenderer,
    unmaskedVendor,
    mainFeatureStatus?.gpu_compositing,
    mainFeatureStatus?.webgl,
    mainFeatureStatus?.webgl2,
    mainFeatureStatus?.opengl
  ])
  return {
    webgl: Boolean(webglContext),
    webgl2: Boolean(webgl2Context),
    hardwareLikely: Boolean(webgl2Context) && !softwareRenderer,
    softwareRenderer,
    renderer,
    vendor,
    unmaskedRenderer,
    unmaskedVendor,
    mainFeatureStatus,
    renderGroups
  }
}

const ensureStressPanels = async (input: TerminalStressHarnessInput, foreground: number, background: number) => {
  const { workspace } = input
  const targetForeground = Math.max(1, foreground)
  const targetBackground = Math.max(0, background)
  while (workspace.panels.filter((panel) => isTerminalWorkspacePanel(panel) && panel.splitGroupId).length < targetForeground) {
    const target = largestStressSplitTarget(workspace)?.panel ||
      workspace.panels.find((panel) => panel.id === workspace.activePanelId && isTerminalWorkspacePanel(panel)) ||
      workspace.panels.find((panel) => isTerminalWorkspacePanel(panel))
    if (target) workspace.activePanelId = target.id
    const targetRect = largestStressSplitTarget(workspace)?.rect
    const direction = !targetRect || targetRect.width >= targetRect.height ? 'right' : 'below'
    const panel = workspace.createPanel(direction)
    panel.title = `Stress FG ${workspace.panels.length}`
    panel.sessionId = panel.sessionId || `stress-fg-${panel.id}`
    panel.status = 'running'
    await nextTick()
  }
  while (workspace.panels.filter((panel) => isTerminalWorkspacePanel(panel)).length < targetForeground + targetBackground) {
    const panel = workspace.createPanel()
    panel.title = `Stress BG ${workspace.panels.length}`
    panel.sessionId = panel.sessionId || `stress-bg-${panel.id}`
    panel.status = 'running'
  }
  const foregroundPanel = workspace.panels.find((panel) => isTerminalWorkspacePanel(panel) && panel.splitGroupId)
  if (foregroundPanel) workspace.activePanelId = foregroundPanel.id
  await nextTick()
  await syncStressPanelViews(input)
}

const runTerminalStressTeardown = async (
  input: TerminalStressHarnessInput,
  baseline: TerminalStressMemorySample,
  errors: string[]
): Promise<TerminalStressTeardownSummary> => {
  const { workspace } = input
  input.flushAllTerminalIngressBatches()
  input.flushAllTerminalHistoryBatches()
  const beforeClose = await sampleMemory('teardown-before-close')
  const panelsBeforeClose = workspace.panels.filter((panel) => isTerminalWorkspacePanel(panel))
  const teardownErrors: string[] = []
  try {
    workspace.closePanels('all')
    await nextTick()
    await syncStressPanelViews(input)
    await nextStressAnimationFrame()
    await syncStressPanelViews(input)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    teardownErrors.push(message)
    errors.push(`terminal stress teardown failed: ${message}`)
  }
  const settleDeadline = nowMs() + 5000
  let threaded = getThreadedTerminalDebugStats()
  while (nowMs() < settleDeadline) {
    await syncStressPanelViews(input)
    await nextTick()
    await nextStressAnimationFrame()
    threaded = getThreadedTerminalDebugStats()
    const remainingStressHosts = threaded.hosts.filter((host) => host.sessionId?.startsWith('stress-'))
    const renderGroupCanvasCount = document.querySelectorAll('canvas.threaded-terminal-render-group-canvas').length
    if (
      !remainingStressHosts.length &&
      threaded.hostCount <= baseline.threadedHostCount + 2 &&
      threaded.renderGroups.length <= baseline.renderGroupCount + 2 &&
      renderGroupCanvasCount <= baseline.renderGroupCanvasCount + 2
    ) break
  }
  const gcResult = await runStressGarbageCollection(2)
  const afterClose = await sampleMemory('teardown-post-gc', gcResult.supported ? gcResult.runs : undefined)
  threaded = getThreadedTerminalDebugStats()
  const remainingStressHosts = threaded.hosts
    .filter((host) => host.sessionId?.startsWith('stress-'))
    .map((host) => ({
      terminalId: host.terminalId,
      sessionId: host.sessionId,
      visible: host.visible,
      surfaceAttached: host.surfaceAttached
    }))
  if (remainingStressHosts.length) {
    const message = `Stress threaded hosts remained after teardown: ${JSON.stringify(remainingStressHosts.slice(0, 10))}`
    teardownErrors.push(message)
    errors.push(message)
  }
  return {
    enabled: true,
    closedPanels: panelsBeforeClose.length,
    baseline,
    beforeClose,
    afterClose,
    gcSupported: gcResult.supported,
    gcRuns: gcResult.supported ? gcResult.runs : 0,
    hostCountDelta: afterClose.threadedHostCount - baseline.threadedHostCount,
    canvasCountDelta: afterClose.canvasCount - baseline.canvasCount,
    renderGroupCountDelta: afterClose.renderGroupCount - baseline.renderGroupCount,
    renderGroupCanvasCountDelta: afterClose.renderGroupCanvasCount - baseline.renderGroupCanvasCount,
    jsHeapUsedDeltaBytes: memoryDelta(baseline.jsHeapUsedBytes, afterClose.jsHeapUsedBytes),
    workingSetDeltaKb: memoryDelta(baseline.workingSetSizeKb, afterClose.workingSetSizeKb),
    threaded,
    remainingStressHosts,
    errors: teardownErrors
  }
}

const measurePaintLatency = async (
  input: TerminalStressHarnessInput,
  panels: TerminalPanel[],
  samples: number[],
  frameSamples: number[],
  rowSamples: number[],
  scrollRowSamples: number[],
  fullReasons: string[],
  repaintReasons: string[],
  errors: string[]
) => {
  const candidates = panels
    .map((panel) => ({ panel, view: input.terminalViews.get(panel.id) }))
    .filter((item) => item.view && isThreadedTerminalHost(item.view.terminal))
    .slice(0, Math.min(3, panels.length))
  await Promise.all(candidates.map(async ({ panel, view }, index) => {
    try {
      const marker = `p${index}`
      if (!view || !isThreadedTerminalHost(view.terminal)) return
      const terminal = view.terminal
      const result = await terminal.writeAndMeasurePaint(`\r${marker}`, 3000).catch(async (error) => {
        const screen = await terminal.readScreen(20).catch(() => ({ text: '' }))
        errors.push(`${error instanceof Error ? error.message : String(error)}; coreScreenHasMarker=${terminalTextContains(screen.text, marker)}`)
        return null
      })
      if (!result) return
      samples.push(result.latencyMs)
      frameSamples.push(result.frameMs)
      if (result.full) fullReasons.push(result.fullReason || 'unknown')
      else if (result.repaintReason) repaintReasons.push(result.repaintReason)
      else if (result.scrollDeltaRows) scrollRowSamples.push(result.paintedRows)
      else rowSamples.push(result.paintedRows)
      input.appendTerminalHistoryBatched(panel.sessionId || panel.id, marker)
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }))
}

const measureRealEchoLatency = async (input: TerminalStressHarnessInput, errors: string[]) => {
  const isRealLocalSession = (sessionId?: string) => Boolean(sessionId && !sessionId.startsWith('stress-'))
  const { workspace } = input
  let panel =
    workspace.panels.find((item) => isTerminalWorkspacePanel(item) && !item.sshSession && isRealLocalSession(item.sessionId)) ||
    workspace.panels.find((item) => isTerminalWorkspacePanel(item) && !item.sshSession && !item.sessionId)
  if (!panel) {
    panel = workspace.createPanel()
    panel.title = 'Stress Echo PTY'
    panel.status = 'ready'
    await nextTick()
    await syncStressPanelViews(input)
  }
  if (!panel || !isTerminalWorkspacePanel(panel)) return { available: false, samples: [], error: 'No terminal panel available.' }
  if (!isRealLocalSession(panel.sessionId)) {
    panel.sessionId = undefined
    const connected = await input.startLocalTerminalForPanel(panel)
    if (!connected || !isRealLocalSession(panel.sessionId)) return { available: false, samples: [], error: 'Local terminal could not be started.' }
    await nextTick()
    input.syncTerminalView(panel)
  }
  const writeTerminal = terminalClient.writeTerminal()
  if (!writeTerminal) return { available: false, samples: [], error: 'Terminal write bridge unavailable.' }
  const samples: number[] = []
  const sessionId = panel.sessionId
  if (!sessionId) return { available: false, samples, error: 'Local terminal session id is unavailable.' }
  for (let index = 0; index < 5; index += 1) {
    const marker = `__AIOPSTERM_ECHO_${Date.now()}_${index}__`
    const startedAt = nowMs()
    try {
      await new Promise<void>((resolve, reject) => {
        let unsubscribe: (() => void) | undefined
        const timeout = window.setTimeout(() => {
          unsubscribe?.()
          reject(new Error(`Timed out waiting for PTY echo marker ${marker}.`))
        }, 3000)
        unsubscribe = terminalClient.onTerminalData()?.((event) => {
          if (event.id !== sessionId || !event.data.includes(marker)) return
          window.clearTimeout(timeout)
          unsubscribe?.()
          samples.push(nowMs() - startedAt)
          resolve()
        })
        if (!unsubscribe) {
          window.clearTimeout(timeout)
          reject(new Error('Terminal data bridge unavailable.'))
        }
        void writeTerminal(sessionId, `printf '${marker}\\n'\r`).then((result) => {
          if (result?.ok) return
          window.clearTimeout(timeout)
          unsubscribe?.()
          reject(new Error(result?.errorMessage || 'Terminal write was rejected.'))
        }).catch((error) => {
          window.clearTimeout(timeout)
          unsubscribe?.()
          reject(error instanceof Error ? error : new Error(String(error)))
        })
      })
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
    await new Promise((resolve) => window.setTimeout(resolve, 100))
  }
  return { available: samples.length > 0, samples, error: samples.length ? undefined : 'No real PTY echo samples were collected.' }
}

const runRegressionProbe = async (run: () => Promise<Record<string, unknown> | undefined>): Promise<TerminalStressRegressionProbe> => {
  try {
    const details = await run()
    return { ok: true, details }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

const runTerminalRegressionProbes = async (
  input: TerminalStressHarnessInput,
  context: {
    terminalPanels: TerminalPanel[]
    currentForegroundPanels: () => TerminalPanel[]
    switchVisibleBackgroundPanel: (options?: { force?: boolean }) => Promise<void>
    switchCount: () => number
    errors: string[]
  }
): Promise<TerminalStressRegressionSummary> => {
  const isPaintableThreadedCandidate = (candidate: { terminal: ThreadedTerminalHost; element: HTMLElement | null }) => {
    const info = candidate.terminal.debugInfo()
    return Boolean(candidate.element?.isConnected && info.visible && info.surfaceAttached)
  }
  const threadedCandidateFrom = (panels: TerminalPanel[], options: { requirePaintable?: boolean } = {}): PaintableThreadedStressCandidate | null => {
    for (const panel of panels) {
      const view = input.terminalViews.get(panel.id)
      if (view && isThreadedTerminalHost(view.terminal)) {
        const element = input.getTerminalElement(panel.id)
        const candidate = { panel, terminal: view.terminal, element }
        if (options.requirePaintable && !isPaintableThreadedCandidate(candidate)) continue
        if (!element) continue
        return { panel, terminal: view.terminal, element }
      }
    }
    return null
  }
  const visibleThreadedCandidate = () =>
    threadedCandidateFrom(context.currentForegroundPanels(), { requirePaintable: true }) ||
    threadedCandidateFrom(input.visibleTerminalPanels.value.filter((panel) => isTerminalWorkspacePanel(panel)), { requirePaintable: true })
  const waitForVisibleThreadedCandidate = async (timeoutMs = 5000, panels?: TerminalPanel[]) => {
    const deadline = nowMs() + timeoutMs
    let lastDebug: unknown[] = []
    while (nowMs() < deadline) {
      const candidate = threadedCandidateFrom(panels || context.currentForegroundPanels(), { requirePaintable: true }) || visibleThreadedCandidate()
      if (candidate) return candidate
      lastDebug = getThreadedTerminalDebugStats().hosts.slice(0, 8)
      await nextTick()
      await nextStressAnimationFrame()
    }
    throw new Error(`No paintable threaded terminal candidate is available. hosts=${JSON.stringify(lastDebug)}`)
  }
  let probeCandidate: PaintableThreadedStressCandidate | null = null
  const dedicatedProbeCandidate = async () => {
    if (probeCandidate && isPaintableThreadedCandidate(probeCandidate)) return probeCandidate
    const panel = input.workspace.createPanel()
    panel.title = 'Stress Probe'
    panel.sessionId = panel.sessionId || `stress-probe-${panel.id}`
    panel.status = 'running'
    await nextTick()
    await syncStressPanelViews(input)
    input.scheduleVisibleTerminalFit({ scrollToBottom: true, frames: 2, forceGeometry: true })
    probeCandidate = await waitForVisibleThreadedCandidate(5000, [panel])
    return probeCandidate
  }
  const clearProbeCandidate = async (candidate: PaintableThreadedStressCandidate) => {
    const beforeSeq = candidate.terminal.debugInfo().lastFrameSeq
    candidate.terminal.clear()
    await candidate.terminal.waitForNextRenderFrame(beforeSeq, 3000).catch(() => undefined)
  }
  const waitForScreenText = async (terminal: ThreadedTerminalHost, text: string, timeoutMs = 3000) => {
    const deadline = nowMs() + timeoutMs
    let lastText = ''
    while (nowMs() < deadline) {
      const screen = await terminal.readScreen(Math.max(terminal.rows, 20)).catch(() => null)
      lastText = screen?.text || terminal.debugSnapshot().text
      if (terminalTextContains(lastText, text)) return { text: lastText, screen }
      await new Promise((resolve) => window.setTimeout(resolve, 50))
    }
    throw new Error(`Timed out waiting for terminal screen text "${text}". Last screen: ${lastText.slice(-200)}`)
  }
  const writeQueuedDataAndWait = async (panel: TerminalPanel, data: string, timeoutMs = 3000) => {
    const view = input.terminalViews.get(panel.id)
    if (!view || !isThreadedTerminalHost(view.terminal)) throw new Error(`Panel ${panel.id} is not a threaded terminal.`)
    const beforeSeq = view.terminal.debugInfo().lastFrameSeq
    input.queueTerminalIngressData(panel.sessionId || panel.id, data, 0)
    input.flushTerminalIngressBatch(panel.sessionId || panel.id)
    return view.terminal.waitForNextRenderFrame(beforeSeq, timeoutMs)
  }
  const styledForegroundForMarker = (terminal: ThreadedTerminalHost, marker: string) => {
    const line = terminal.debugSnapshot().lines.find((item) => item.text.includes(marker))
    const styledRun = line?.cells?.find((run) => run.text.includes(marker) || marker.includes(run.text.trim()))
    return styledRun?.fg || ''
  }

  const contentFreshness = await runRegressionProbe(async () => {
    const candidate = await dedicatedProbeCandidate()
    await clearProbeCandidate(candidate)
    const marker = `__AIOPSTERM_STRESS_FRESH_${Date.now()}__`
    const frame = await writeQueuedDataAndWait(candidate.panel, `${marker}\n`)
    await waitForScreenText(candidate.terminal, marker)
    return {
      panelId: candidate.panel.id,
      marker,
      frameSeq: frame.seq,
      paintedRows: frame.paintedRows,
      full: Boolean(frame.full),
      fullReason: frame.fullReason
    }
  })
  const foregroundSwitchRefresh = await runRegressionProbe(async () => {
    const beforePanelId = input.workspace.activePanelId
    await context.switchVisibleBackgroundPanel({ force: true })
    await nextTick()
    const activePanels = input.workspace.activePanelId ? input.workspace.panels.filter((panel) => panel.id === input.workspace.activePanelId) : []
    const candidate = await waitForVisibleThreadedCandidate(5000, activePanels)
    const marker = `__AIOPSTERM_STRESS_SWITCH_${Date.now()}__`
    const frame = await writeQueuedDataAndWait(candidate.panel, `${marker}\n`)
    await waitForScreenText(candidate.terminal, marker)
    return {
      beforePanelId,
      afterPanelId: candidate.panel.id,
      marker,
      frameSeq: frame.seq,
      paintedRows: frame.paintedRows,
      switchCount: context.switchCount()
    }
  })
  const ansiStyleDirtyRepaint = await runRegressionProbe(async () => {
    const candidate = await dedicatedProbeCandidate()
    await clearProbeCandidate(candidate)
    const marker = `W${Date.now().toString(36).slice(-5)}`
    await candidate.terminal.writeAndMeasurePaint(`\r\n\x1b[31m${marker}\x1b[0m`, 3000, { settlePendingFrame: true })
    await waitForScreenText(candidate.terminal, marker)
    const firstFg = styledForegroundForMarker(candidate.terminal, marker)
    const frame = await candidate.terminal.writeAndMeasurePaint(`\r\x1b[32m${marker}\x1b[0m`, 3000, { settlePendingFrame: true })
    await waitForScreenText(candidate.terminal, marker)
    const secondFg = styledForegroundForMarker(candidate.terminal, marker)
    if (!firstFg || !secondFg) throw new Error(`Styled run was not captured for ANSI marker. first=${firstFg || '(empty)'} second=${secondFg || '(empty)'}`)
    if (firstFg === secondFg) throw new Error(`ANSI style did not change for same-text repaint: ${firstFg}`)
    if (frame.paintedRows <= 0) throw new Error('Same-text ANSI repaint did not paint any row.')
    return {
      panelId: candidate.panel.id,
      marker,
      firstFg,
      secondFg,
      paintedRows: frame.paintedRows,
      full: Boolean(frame.full),
      fullReason: frame.fullReason,
      repaintReason: frame.repaintReason
    }
  })
  const scrollbackAndScrollbar = await runRegressionProbe(async () => {
    const candidate = await dedicatedProbeCandidate()
    await clearProbeCandidate(candidate)
    const lastMarker = `__AIOPSTERM_SCROLL_LAST_${Date.now()}__`
    const lineCount = Math.max(candidate.terminal.rows + 12, 32)
    const lines = Array.from({ length: lineCount }, (_item, index) => `scroll-probe-${index}-${'x'.repeat(24)}`)
    lines.push(lastMarker)
    await candidate.terminal.writeAndMeasurePaint(`\r\n${lines.join('\n')}\n`, 5000, { settlePendingFrame: true })
    await waitForScreenText(candidate.terminal, lastMarker, 5000)
    const before = candidate.terminal.debugSnapshot()
    const scrollbar = candidate.element?.querySelector<HTMLElement>('.threaded-terminal-scrollbar')
    const thumb = candidate.element?.querySelector<HTMLElement>('.threaded-terminal-scrollbar-thumb')
    const ariaMax = Number(scrollbar?.getAttribute('aria-valuemax') || 0)
    if (before.baseY <= 0 || ariaMax <= 0) throw new Error(`Scrollback did not become available. baseY=${before.baseY} ariaMax=${ariaMax}`)
    if (!thumb || thumb.style.opacity === '0') throw new Error('Threaded terminal scrollbar thumb is not visible after scrollback is available.')
    const beforeSeq = candidate.terminal.debugInfo().lastFrameSeq
    const framePromise = candidate.terminal.waitForNextRenderFrame(beforeSeq, 3000)
    candidate.terminal.scrollLines(-Math.min(3, before.baseY))
    const scrollDeadline = nowMs() + 3000
    let after = candidate.terminal.debugSnapshot()
    while (after.viewportY >= before.viewportY && nowMs() < scrollDeadline) {
      await nextStressAnimationFrame()
      after = candidate.terminal.debugSnapshot()
    }
    if (after.viewportY >= before.viewportY) throw new Error(`Scrollback viewport did not move upward. before=${before.viewportY} after=${after.viewportY}`)
    const frame = await framePromise
    candidate.terminal.scrollToBottom()
    await candidate.terminal.waitForNextRenderFrame(frame.seq, 3000).catch(() => undefined)
    await waitForScreenText(candidate.terminal, lastMarker, 3000)
    return {
      panelId: candidate.panel.id,
      baseY: before.baseY,
      beforeViewportY: before.viewportY,
      afterViewportY: after.viewportY,
      ariaMax,
      thumbOpacity: thumb.style.opacity,
      paintedRows: frame.paintedRows
    }
  })
  const selectionSoftWrap = await runRegressionProbe(async () => {
    const candidate = await dedicatedProbeCandidate()
    await clearProbeCandidate(candidate)
    const segmentCount = Math.max(6, Math.ceil((candidate.terminal.cols + 20) / 8))
    const path = `./stress/${Array.from({ length: segmentCount }, (_item, index) => `segment${index}`).join('/')}/review_api.py`
    await candidate.terminal.writeAndMeasurePaint(`\r\n${path}\n`, 5000, { settlePendingFrame: true })
    await waitForScreenText(candidate.terminal, path.slice(0, 16), 5000)
    const snapshot = candidate.terminal.debugSnapshot()
    const startRow = snapshot.lines.findIndex((line) => line.text.includes(path.slice(0, 12)))
    if (startRow < 0) throw new Error('Wrapped selection probe start row was not visible.')
    let endRow = startRow
    while (snapshot.lines[endRow + 1]?.wrapped) endRow += 1
    if (endRow === startRow) throw new Error(`Selection probe did not soft-wrap. cols=${candidate.terminal.cols} pathLength=${path.length}`)
    const surface = candidate.element.querySelector<HTMLElement>('.threaded-terminal-surface')
    const rect = surface?.getBoundingClientRect() || candidate.element.getBoundingClientRect()
    const cellWidth = Math.max(1, rect.width / Math.max(1, candidate.terminal.cols))
    const cellHeight = Math.max(1, rect.height / Math.max(1, candidate.terminal.rows))
    const endClientX = Math.min(rect.right - 1, rect.left + candidate.terminal.cols * cellWidth - 1)
    candidate.element.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      button: 0,
      clientX: rect.left + 1,
      clientY: rect.top + startRow * cellHeight + 1
    }))
    candidate.element.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true,
      button: 0,
      clientX: endClientX,
      clientY: rect.top + endRow * cellHeight + 1
    }))
    window.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true,
      button: 0,
      clientX: endClientX,
      clientY: rect.top + endRow * cellHeight + 1
    }))
    const selected = candidate.terminal.getSelection()
    if (selected !== path) throw new Error(`Soft-wrapped selection mismatch. expected="${path}" actual="${selected}"`)
    if (selected.includes('\n')) throw new Error('Soft-wrapped selection contains an unexpected newline.')
    candidate.terminal.clearSelection()
    return {
      panelId: candidate.panel.id,
      rows: endRow - startRow + 1,
      cols: candidate.terminal.cols,
      selectedLength: selected.length
    }
  })
  const keyboardInputFocus = await runRegressionProbe(async () => {
    const candidate = await waitForVisibleThreadedCandidate()
    const inputElement = candidate.element.querySelector<HTMLTextAreaElement>('.threaded-terminal-input')
    if (!inputElement) throw new Error('Threaded terminal hidden input is missing.')
    candidate.terminal.clearSelection()
    const observed: string[] = []
    const waitForObservedInput = async (expected: string) => {
      const deadline = nowMs() + 1500
      while (nowMs() < deadline) {
        if (observed.some((item) => item.includes(expected))) return
        await new Promise((resolve) => window.setTimeout(resolve, 20))
      }
      throw new Error(`Timed out waiting for input "${expected}". Observed: ${JSON.stringify(observed)}`)
    }
    const subscription = candidate.terminal.onData((data) => observed.push(data))
    try {
      candidate.terminal.focus()
      await new Promise((resolve) => window.setTimeout(resolve, 0))
      if (document.activeElement !== inputElement) throw new Error('Threaded terminal focus did not move to the hidden input.')
      inputElement.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'C', ctrlKey: true, shiftKey: true }))
      await new Promise((resolve) => window.setTimeout(resolve, 0))
      if (observed.includes('\x03')) throw new Error('Ctrl+Shift+C was sent to the PTY as Ctrl+C.')
      inputElement.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'c', ctrlKey: true }))
      await waitForObservedInput('\x03')
      const text = `stress-input-${Date.now()}`
      inputElement.value = text
      inputElement.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }))
      await waitForObservedInput(text)
      return {
        panelId: candidate.panel.id,
        activeElementClass: (document.activeElement as HTMLElement | null)?.className || '',
        observedInputs: observed.length
      }
    } finally {
      subscription.dispose()
    }
  })
  const summary = {
    contentFreshness,
    foregroundSwitchRefresh,
    ansiStyleDirtyRepaint,
    scrollbackAndScrollbar,
    selectionSoftWrap,
    keyboardInputFocus
  }
  Object.entries(summary).forEach(([name, probe]) => {
    if (!probe.ok) context.errors.push(`terminal regression probe failed: ${name}: ${probe.error || 'unknown error'}`)
  })
  return summary
}

const runTerminalStressHarness = async (
  input: TerminalStressHarnessInput,
  stressOptions: { foreground?: number; background?: number; durationMs?: number; switchIntervalMs?: number; profile?: TerminalStressProfileName } = {}
): Promise<TerminalStressHarnessResult> => {
  const foreground = Math.max(1, stressOptions.foreground || 10)
  const background = Math.max(0, stressOptions.background || 40)
  const durationMs = Math.max(1000, stressOptions.durationMs || 20 * 60 * 1000)
  const switchIntervalMs = Math.max(0, stressOptions.switchIntervalMs ?? 5000)
  const { name: profileName, profile } = terminalStressProfileFor(stressOptions.profile)
  const { workspace, visibleTerminalPanels, terminalViews } = input
  const errors: string[] = []
  const teardownBaseline = await sampleMemory('teardown-baseline')
  await ensureStressPanels(input, foreground, background)
  await new Promise((resolve) => window.setTimeout(resolve, 500))
  const terminalPanels = workspace.panels.filter((panel) => isTerminalWorkspacePanel(panel))
  let foregroundPanels = visibleTerminalPanels.value.filter((panel) => isTerminalWorkspacePanel(panel)).slice(0, foreground)
  let backgroundPanels = terminalPanels.filter((panel) => !foregroundPanels.some((visible) => visible.id === panel.id)).slice(0, background)
  const currentForegroundPanels = () => visibleTerminalPanels.value.filter((panel) => isTerminalWorkspacePanel(panel)).slice(0, foreground)
  const rafIntervals: number[] = []
  const paintLatencySamples: number[] = []
  const paintFrameSamples: number[] = []
  const paintRowSamples: number[] = []
  const paintScrollRowSamples: number[] = []
  const paintFullReasons: string[] = []
  const paintRepaintReasons: string[] = []
  const switchPaintLatencySamples: number[] = []
  const memorySamples: TerminalStressMemorySample[] = []
  const queueSamples: TerminalStressQueueSample[] = []
  const writeStats: TerminalStressWriteSummary = {
    foregroundWrites: 0,
    backgroundWrites: 0,
    foregroundChunks: 0,
    backgroundChunks: 0,
    foregroundBytes: 0,
    backgroundBytes: 0
  }
  let writtenBytes = 0
  let running = true
  let lastFrame = nowMs()
  let frames = 0
  let foregroundCursor = 0
  let backgroundCursor = 0
  let switchCount = 0
  let switchFailed = 0
  let paintProbeActive = false
  let switchProbeActive = false
  let pendingPaintProbe = false
  let pendingSwitchProbe = false
  memorySamples.push(await sampleMemory('start'))
  queueSamples.push(input.sampleQueues())
  const canvasCountBefore = memorySamples[0]?.canvasCount || 0
  const trackFrame = () => {
    const now = nowMs()
    rafIntervals.push(now - lastFrame)
    lastFrame = now
    frames += 1
    if (running) window.requestAnimationFrame(trackFrame)
  }
  window.requestAnimationFrame(trackFrame)
  const makeStressChunk = (prefix: string, panelIndex: number, burstIndex: number, lines: number, payloadBytes: number) => {
    const payload = 'x'.repeat(Math.max(1, payloadBytes))
    return Array.from({ length: Math.max(1, lines) }, (_line, lineIndex) =>
      `${prefix}-${panelIndex}.${burstIndex}.${lineIndex} ${nowMs().toFixed(1)} ${payload}`
    ).join('\n') + '\n'
  }
  const writePanel = (
    panel: TerminalPanel,
    prefix: 'fg' | 'bg',
    index: number,
    options: { chunks: number; linesPerChunk: number; payloadBytes: number }
  ) => {
    const statPrefix = prefix === 'fg' ? 'foreground' : 'background'
    writeStats[`${statPrefix}Writes` as 'foregroundWrites' | 'backgroundWrites'] += 1
    for (let chunkIndex = 0; chunkIndex < Math.max(1, options.chunks); chunkIndex += 1) {
      const data = makeStressChunk(prefix, index, chunkIndex, options.linesPerChunk, options.payloadBytes)
      const bytes = textByteLength(data)
      writtenBytes += bytes
      writeStats[`${statPrefix}Chunks` as 'foregroundChunks' | 'backgroundChunks'] += 1
      writeStats[`${statPrefix}Bytes` as 'foregroundBytes' | 'backgroundBytes'] += bytes
      input.queueTerminalIngressData(panel.sessionId || panel.id, data, 0)
    }
  }
  const waitForPaintableThreadedPanel = async (panelId: string, timeoutMs = 5000) => {
    const deadline = nowMs() + timeoutMs
    let lastDebug: ReturnType<ThreadedTerminalHost['debugInfo']> | null = null
    let lastElementBox: { connected: boolean; width: number; height: number } | null = null
    while (nowMs() < deadline) {
      await syncStressPanelViews(input)
      await nextStressAnimationFrame()
      input.scheduleVisibleTerminalFit({ scrollToBottom: true, frames: 1, forceGeometry: true })
      await nextStressAnimationFrame()
      const view = terminalViews.get(panelId)
      if (view && isThreadedTerminalHost(view.terminal)) {
        lastDebug = view.terminal.debugInfo()
        const element = input.getTerminalElement(panelId)
        const rect = element?.getBoundingClientRect()
        lastElementBox = element
          ? {
              connected: element.isConnected,
              width: Math.floor(element.clientWidth || rect?.width || 0),
              height: Math.floor(element.clientHeight || rect?.height || 0)
            }
          : null
        if (isStressRenderableElement(element)) {
          const panel = workspace.panels.find((item) => item.id === panelId)
          if (panel && isTerminalWorkspacePanel(panel)) input.syncTerminalView(panel, { refit: true })
          view.terminal.ensureSurfaceAttached({ forceGeometry: true })
          lastDebug = view.terminal.debugInfo()
        }
        if (isStressRenderableElement(element) && lastDebug.visible && lastDebug.surfaceAttached) return view.terminal
      }
    }
    throw new Error(`Timed out waiting for paintable threaded terminal ${panelId}. last=${JSON.stringify(lastDebug)} element=${JSON.stringify(lastElementBox)}`)
  }
  const foregroundTimer = window.setInterval(() => {
    currentForegroundPanels().forEach((panel, index) =>
      writePanel(panel, 'fg', index, {
        chunks: profile.foregroundChunks,
        linesPerChunk: profile.foregroundLinesPerChunk,
        payloadBytes: profile.foregroundPayloadBytes
      })
    )
  }, profile.foregroundIntervalMs)
  const backgroundTimer = window.setInterval(() => {
    const visibleIds = new Set(visibleTerminalPanels.value.map((panel) => panel.id))
    terminalPanels
      .filter((panel) => !visibleIds.has(panel.id))
      .slice(0, background)
      .forEach((panel, index) =>
        writePanel(panel, 'bg', index, {
          chunks: profile.backgroundChunks,
          linesPerChunk: profile.backgroundLinesPerChunk,
          payloadBytes: profile.backgroundPayloadBytes
        })
      )
  }, profile.backgroundIntervalMs)
  const switchVisibleBackgroundPanel = async (options: { force?: boolean } = {}) => {
    if ((!running || switchIntervalMs <= 0) && !options.force) return
    if (switchProbeActive) return
    if (paintProbeActive) {
      pendingSwitchProbe = true
      return
    }
    switchProbeActive = true
    try {
      foregroundPanels = visibleTerminalPanels.value.filter((panel) => isTerminalWorkspacePanel(panel)).slice(0, foreground)
      backgroundPanels = terminalPanels.filter((panel) => !foregroundPanels.some((visible) => visible.id === panel.id)).slice(0, background)
      if (!foregroundPanels.length || !backgroundPanels.length) return
      const outgoing = foregroundPanels[foregroundCursor % foregroundPanels.length]
      const incoming = backgroundPanels[backgroundCursor % backgroundPanels.length]
      foregroundCursor += 1
      backgroundCursor += 1
      if (!outgoing || !incoming || outgoing.id === incoming.id) return
      const largestTarget = largestStressSplitTarget(workspace)?.panel
      const target =
        (largestTarget && largestTarget.id !== outgoing.id && foregroundPanels.some((panel) => panel.id === largestTarget.id)
          ? largestTarget
          : undefined) ||
        foregroundPanels.find((panel) => panel.id !== outgoing.id && isStressRenderableElement(input.getTerminalElement(panel.id))) ||
        foregroundPanels.find((panel) => isStressRenderableElement(input.getTerminalElement(panel.id))) ||
        outgoing
      workspace.unsplitPanel(outgoing.id)
      workspace.attachPanelToSplit(incoming.id, target.id, backgroundCursor % 2 === 0 ? 'right' : 'below')
      workspace.activePanelId = incoming.id
      await syncStressPanelViews(input)
      input.syncTerminalView(incoming, { refit: true })
      input.scheduleVisibleTerminalFit({ scrollToBottom: true, frames: 2, forceGeometry: true })
      switchCount += 1
      const terminal = await waitForPaintableThreadedPanel(incoming.id)
      if (terminal) {
        const marker = `s${switchCount}`
        const result = await terminal.writeAndMeasurePaint(`\r${marker}`, 5000)
        switchPaintLatencySamples.push(result.latencyMs)
        input.appendTerminalHistoryBatched(incoming.sessionId || incoming.id, marker)
      }
    } catch (error) {
      switchFailed += 1
      errors.push(error instanceof Error ? error.message : String(error))
    } finally {
      switchProbeActive = false
      if (pendingPaintProbe) {
        pendingPaintProbe = false
        void measureCurrentForegroundPaintLatency()
      }
    }
  }
  const measureCurrentForegroundPaintLatency = async () => {
    if (paintProbeActive) return
    if (switchProbeActive) {
      pendingPaintProbe = true
      return
    }
    paintProbeActive = true
    try {
      await measurePaintLatency(
        input,
        currentForegroundPanels(),
        paintLatencySamples,
        paintFrameSamples,
        paintRowSamples,
        paintScrollRowSamples,
        paintFullReasons,
        paintRepaintReasons,
        errors
      )
    } finally {
      paintProbeActive = false
      if (pendingSwitchProbe) {
        pendingSwitchProbe = false
        void switchVisibleBackgroundPanel()
      }
    }
  }
  const memoryTimer = window.setInterval(() => {
    void sampleMemory().then((sample) => memorySamples.push(sample)).catch((error) => errors.push(error instanceof Error ? error.message : String(error)))
  }, Math.max(1000, Math.min(10_000, Math.floor(durationMs / 6))))
  const queueTimer = window.setInterval(() => {
    queueSamples.push(input.sampleQueues())
  }, 1000)
  const latencyTimer = window.setInterval(() => {
    void measureCurrentForegroundPaintLatency()
  }, Math.max(1000, Math.min(5000, Math.floor(durationMs / 12))))
  const switchTimer = switchIntervalMs > 0 ? window.setInterval(() => {
    void switchVisibleBackgroundPanel()
  }, switchIntervalMs) : null
  await measureCurrentForegroundPaintLatency()
  await new Promise((resolve) => window.setTimeout(resolve, durationMs))
  running = false
  window.clearInterval(foregroundTimer)
  window.clearInterval(backgroundTimer)
  window.clearInterval(memoryTimer)
  window.clearInterval(queueTimer)
  window.clearInterval(latencyTimer)
  if (switchTimer !== null) window.clearInterval(switchTimer)
  input.flushAllTerminalIngressBatches()
  input.flushAllTerminalHistoryBatches()
  queueSamples.push(input.sampleQueues())
  await measureCurrentForegroundPaintLatency()
  const regressions = await runTerminalRegressionProbes(input, {
    terminalPanels,
    currentForegroundPanels,
    switchVisibleBackgroundPanel,
    switchCount: () => switchCount,
    errors
  })
  memorySamples.push(await sampleMemory('end-before-gc'))
  const gcResult = await runStressGarbageCollection(2)
  memorySamples.push(await sampleMemory('post-gc', gcResult.supported ? gcResult.runs : undefined))
  const realEcho = await measureRealEchoLatency(input, errors)
  const threaded = getThreadedTerminalDebugStats()
  const gpu = await sampleGpuSummary(threaded.renderGroups)
  const teardown = await runTerminalStressTeardown(input, teardownBaseline, errors)
  const sorted = rafIntervals.slice(5).sort((a, b) => a - b)
  const percentile = (value: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * value)))] || 0
  const memory = summarizeMemory(memorySamples)
  const realEchoSummary = metricSummary(realEcho.samples)
  return {
    profile: profileName,
    foreground,
    background,
    durationMs,
    writtenBytes,
    writes: writeStats,
    frames,
    avgFrameMs: sorted.reduce((sum, value) => sum + value, 0) / Math.max(1, sorted.length),
    p95FrameMs: percentile(0.95),
    p99FrameMs: percentile(0.99),
    maxFrameMs: sorted[sorted.length - 1] || 0,
    panels: terminalPanels.length,
    threaded,
    gpu,
    paintLatency: metricSummary(paintLatencySamples),
    paintFrameMs: metricSummary(paintFrameSamples),
    paintRows: metricSummary(paintRowSamples),
    paintScrollRows: metricSummary(paintScrollRowSamples),
    paintFullFrames: paintFullReasons.length,
    paintFullReasons: paintFullReasons.reduce<Record<string, number>>((summary, reason) => {
      summary[reason] = (summary[reason] || 0) + 1
      return summary
    }, {}),
    paintRepaintReasons: paintRepaintReasons.reduce<Record<string, number>>((summary, reason) => {
      summary[reason] = (summary[reason] || 0) + 1
      return summary
    }, {}),
    realEchoLatency: {
      ...realEchoSummary,
      available: realEcho.available,
      error: realEcho.error
    },
    regressions,
    memory,
    queues: summarizeQueues(queueSamples),
    switches: {
      enabled: switchIntervalMs > 0,
      intervalMs: switchIntervalMs,
      count: switchCount,
      failed: switchFailed,
      paintLatency: metricSummary(switchPaintLatencySamples)
    },
    teardown,
    canvasCount: {
      before: canvasCountBefore,
      after: memorySamples.at(-1)?.canvasCount || 0
    },
    errors
  }
}

export const installTerminalStressHarness = (input: TerminalStressHarnessInput) => {
  const run = (options?: { foreground?: number; background?: number; durationMs?: number; switchIntervalMs?: number; profile?: TerminalStressProfileName }) =>
    runTerminalStressHarness(input, options)
  window.__AIOPSTERM_TERMINAL_STRESS__ = { run }
  return () => {
    if (window.__AIOPSTERM_TERMINAL_STRESS__?.run === run) {
      delete window.__AIOPSTERM_TERMINAL_STRESS__
    }
  }
}
