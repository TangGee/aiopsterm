import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, rm, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'

const stressEnabled = process.env.AIOPSTERM_TERMINAL_STRESS === '1'
const stressDurationMs = Number(process.env.AIOPSTERM_TERMINAL_STRESS_DURATION_MS || 20 * 60 * 1000)
const foregroundTerms = Number(process.env.AIOPSTERM_TERMINAL_STRESS_FOREGROUND || 10)
const backgroundTerms = Number(process.env.AIOPSTERM_TERMINAL_STRESS_BACKGROUND || 40)
const switchIntervalMs = Number(process.env.AIOPSTERM_TERMINAL_STRESS_SWITCH_INTERVAL_MS || 5000)
const stressProfiles = new Set(['frame-small-chunk', 'pty-burst', 'mixed-background', 'mixed-switch'])
const stressProfile = stressProfiles.has(process.env.AIOPSTERM_TERMINAL_STRESS_PROFILE || '')
  ? process.env.AIOPSTERM_TERMINAL_STRESS_PROFILE || 'mixed-switch'
  : 'mixed-switch'
const stressArtifactDir = path.join(process.cwd(), 'test-results', 'terminal-stress')

type StressMetricSummary = {
  samples: number
  avg: number
  p50: number
  p95: number
  p99: number
  max: number
}

type StressResult = {
  profile: string
  foreground: number
  background: number
  durationMs: number
  writtenBytes: number
  writes: {
    foregroundWrites: number
    backgroundWrites: number
    foregroundChunks: number
    backgroundChunks: number
    foregroundBytes: number
    backgroundBytes: number
  }
  frames: number
  avgFrameMs: number
  p95FrameMs: number
  p99FrameMs: number
  maxFrameMs: number
  panels: number
  threaded: {
    supported: boolean
    capabilityReason?: string
    coreWorkers: number
    coreDebug: Array<{
      workerId: number
      ready: boolean
      terminals: number
      created: number
      screens: number
      perf: number
      errors: number
      pendingBytes: number
      lastError?: string
    }>
    renderWorkerActive: boolean
    renderDebug: {
      ready: boolean
      attached: number
      frames: number
      perf: number
      errors: number
      lastError?: string
    }
    renderGroups: Array<{
      renderGroupId: string
      surface: string
      hosts: number
      attached: boolean
      requestedBackend: string
      backend?: string
      width: number
      height: number
      dpr: number
    }>
    hostCount: number
    hosts: unknown[]
  }
  gpu?: {
    webgl: boolean
    webgl2: boolean
    hardwareLikely: boolean
    softwareRenderer: boolean
    renderer?: string
    vendor?: string
    unmaskedRenderer?: string
    unmaskedVendor?: string
    mainFeatureStatus?: Record<string, unknown>
    renderGroups: StressResult['threaded']['renderGroups']
  }
  paintLatency: StressMetricSummary
  paintFrameMs: StressMetricSummary
  paintRows: StressMetricSummary
  paintScrollRows: StressMetricSummary
  paintFullFrames: number
  paintFullReasons: Record<string, number>
  paintRepaintReasons: Record<string, number>
  realEchoLatency: StressMetricSummary & { available: boolean; error?: string }
  regressions: Record<string, {
    ok: boolean
    details?: Record<string, unknown>
    error?: string
  }>
  memory: {
    samples: Array<{
      at: number
      phase: string
      jsHeapUsedBytes?: number
      workingSetSizeKb?: number
      canvasCount: number
      threadedHostCount: number
      gcRuns?: number
    }>
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
  queues: {
    samples: Array<{
      at: number
      ingressPanels: number
      ingressBytes: number
      ingressChunks: number
      historyPanels: number
      historyBytes: number
    }>
    maxIngressPanels: number
    maxIngressBytes: number
    maxIngressChunks: number
    maxHistoryPanels: number
    maxHistoryBytes: number
  }
  switches: {
    enabled: boolean
    intervalMs: number
    count: number
    failed: number
    paintLatency: StressMetricSummary
  }
  teardown: {
    enabled: boolean
    closedPanels: number
    baseline: {
      at: number
      phase: string
      jsHeapUsedBytes?: number
      workingSetSizeKb?: number
      canvasCount: number
      threadedHostCount: number
      gcRuns?: number
    }
    beforeClose: {
      at: number
      phase: string
      jsHeapUsedBytes?: number
      workingSetSizeKb?: number
      canvasCount: number
      threadedHostCount: number
      gcRuns?: number
    }
    afterClose: {
      at: number
      phase: string
      jsHeapUsedBytes?: number
      workingSetSizeKb?: number
      canvasCount: number
      threadedHostCount: number
      gcRuns?: number
    }
    gcSupported: boolean
    gcRuns: number
    hostCountDelta: number
    canvasCountDelta: number
    jsHeapUsedDeltaBytes?: number
    workingSetDeltaKb?: number
    threaded: StressResult['threaded']
    remainingStressHosts: Array<{
      terminalId: string
      sessionId?: string
      visible: boolean
      surfaceAttached: boolean
    }>
    errors: string[]
  }
  canvasCount: { before: number; after: number }
  errors: string[]
  heapArtifacts?: StressHeapArtifacts
}

type StressHeapArtifacts = {
  snapshotPath?: string
  samplingPath?: string
  baselineRendererHeapUsedBytes?: number
  rendererHeapUsedBytes?: number
  rendererHeapUsedDeltaBytes?: number
  allocationHotspots: Array<{
    name: string
    size: number
    count: number
  }>
  objectSummary: Array<{
    type: string
    name: string
    size: number
    count: number
  }>
}

type HeapProfilerHandle = {
  stop: () => Promise<StressHeapArtifacts>
}

test.skip(!stressEnabled, 'Set AIOPSTERM_TERMINAL_STRESS=1 to run the 10 foreground + 40 background terminal stress test.')
test.setTimeout(Math.max(120_000, stressDurationMs + 120_000))

const launchStressApp = async () => {
  const userDataDir = path.join(os.tmpdir(), `aiopsterm-terminal-stress-${Date.now()}`)
  await mkdir(userDataDir, { recursive: true })
  const app = await electron.launch({
    args: ['--js-flags=--expose-gc', '.'],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      AIOPSTERM_USER_DATA_DIR: userDataDir,
      AIOPSTERM_THREADED_TERMINAL: '1',
      VITE_AIOPSTERM_THREADED_TERMINAL: '1',
      VITE_AIOPSTERM_TERMINAL_STRESS: '1',
      AIOPSTERM_E2E_DIALOG_FIXTURES: '1',
      AIOPSTERM_MCP_DISCOVERY_DISABLE: '1',
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1'
    }
  })
  return { app, userDataDir }
}

const injectStressHarness = async (page: Page, options: { foreground: number; background: number; durationMs: number; switchIntervalMs: number; profile: string }) =>
  page.evaluate(async ({ foreground, background, durationMs, switchIntervalMs, profile }) => {
    const harness = (window as any).__AIOPSTERM_TERMINAL_STRESS__
    if (!harness?.run) throw new Error('Terminal stress harness is unavailable.')
    const result = await harness.run({ foreground, background, durationMs, switchIntervalMs, profile })
    ;(window as any).__AIOPSTERM_TERMINAL_STRESS_RESULT__ = result
    return result
  }, options) as Promise<StressResult>

const mb = (bytes?: number) => (typeof bytes === 'number' ? Math.round((bytes / 1024 / 1024) * 10) / 10 : undefined)
const heapObjectSize = (artifacts: StressHeapArtifacts, type: string, name: string) =>
  artifacts.objectSummary.find((item) => item.type === type && item.name === name)?.size || 0

const summarizeSamplingProfile = (profile: unknown): StressHeapArtifacts['allocationHotspots'] => {
  const nodes: Array<{ name: string; size: number }> = []
  const visit = (node: any) => {
    if (!node || typeof node !== 'object') return
    const size = typeof node.selfSize === 'number' ? node.selfSize : 0
    const name = typeof node.callFrame?.functionName === 'string' && node.callFrame.functionName
      ? node.callFrame.functionName
      : typeof node.callFrame?.url === 'string' && node.callFrame.url
        ? node.callFrame.url
        : '(anonymous)'
    if (size > 0) nodes.push({ name, size })
    for (const child of Array.isArray(node.children) ? node.children : []) visit(child)
  }
  visit((profile as any)?.head)
  const byName = new Map<string, { name: string; size: number; count: number }>()
  for (const node of nodes) {
    const current = byName.get(node.name) || { name: node.name, size: 0, count: 0 }
    current.size += node.size
    current.count += 1
    byName.set(node.name, current)
  }
  return Array.from(byName.values()).sort((left, right) => right.size - left.size).slice(0, 20)
}

const normalizeHeapNodeName = (type: string, name: string) => {
  if (type === 'string' || type === 'concatenated string' || type === 'sliced string') return type
  if (type === 'array') return 'array'
  if (!name) return type
  return name.length > 120 ? `${name.slice(0, 117)}...` : name
}

const summarizeHeapSnapshot = (snapshotText: string): StressHeapArtifacts['objectSummary'] => {
  const snapshot = JSON.parse(snapshotText) as {
    snapshot?: {
      meta?: {
        node_fields?: string[]
        node_types?: unknown[]
      }
    }
    nodes?: number[]
    strings?: string[]
  }
  const fields = snapshot.snapshot?.meta?.node_fields || []
  const nodeTypes = snapshot.snapshot?.meta?.node_types?.[0]
  const typeNames = Array.isArray(nodeTypes) ? nodeTypes.map(String) : []
  const nodes = snapshot.nodes || []
  const strings = snapshot.strings || []
  const fieldCount = fields.length
  const typeIndex = fields.indexOf('type')
  const nameIndex = fields.indexOf('name')
  const selfSizeIndex = fields.indexOf('self_size')
  if (!fieldCount || typeIndex < 0 || nameIndex < 0 || selfSizeIndex < 0) return []
  const byName = new Map<string, { type: string; name: string; size: number; count: number }>()
  for (let offset = 0; offset < nodes.length; offset += fieldCount) {
    const type = typeNames[nodes[offset + typeIndex]] || 'unknown'
    const rawName = strings[nodes[offset + nameIndex]] || ''
    const name = normalizeHeapNodeName(type, rawName)
    const size = nodes[offset + selfSizeIndex] || 0
    const key = `${type}:${name}`
    const current = byName.get(key) || { type, name, size: 0, count: 0 }
    current.size += size
    current.count += 1
    byName.set(key, current)
  }
  return Array.from(byName.values()).sort((left, right) => right.size - left.size).slice(0, 30)
}

type HeapUsage = { usedSize?: number; totalSize?: number }

const startHeapProfiler = async (app: ElectronApplication, page: Page): Promise<HeapProfilerHandle> => {
  await mkdir(stressArtifactDir, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const session = await app.context().newCDPSession(page)
  const collectHeap = async () => {
    await session.send('HeapProfiler.collectGarbage')
    await session.send('HeapProfiler.collectGarbage')
    return session.send('Runtime.getHeapUsage').catch(() => undefined as HeapUsage | undefined)
  }
  await session.send('HeapProfiler.enable')
  const baselineHeapUsage = await collectHeap()
  await session.send('HeapProfiler.startSampling', { samplingInterval: 32768 })

  return {
    stop: async () => {
      const finalHeapUsage = await collectHeap()
      const sampling = await session.send('HeapProfiler.stopSampling')
      const samplingPath = path.join(stressArtifactDir, `heap-sampling-${timestamp}.json`)
      await writeFile(samplingPath, JSON.stringify(sampling, null, 2))

      const chunks: string[] = []
      session.on('HeapProfiler.addHeapSnapshotChunk', (event: { chunk: string }) => {
        chunks.push(event.chunk)
      })
      await session.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false })
      const snapshotPath = path.join(stressArtifactDir, `heap-${timestamp}.heapsnapshot`)
      const snapshotText = chunks.join('')
      await writeFile(snapshotPath, snapshotText)

      await session.detach()
      return {
        snapshotPath,
        samplingPath,
        baselineRendererHeapUsedBytes: baselineHeapUsage?.usedSize,
        rendererHeapUsedBytes: finalHeapUsage?.usedSize,
        rendererHeapUsedDeltaBytes:
          typeof baselineHeapUsage?.usedSize === 'number' && typeof finalHeapUsage?.usedSize === 'number'
            ? finalHeapUsage.usedSize - baselineHeapUsage.usedSize
            : undefined,
        allocationHotspots: summarizeSamplingProfile((sampling as { profile?: unknown }).profile),
        objectSummary: summarizeHeapSnapshot(snapshotText)
      }
    }
  }
}

const logStressResult = (result: StressResult) => {
  const regressions = Object.fromEntries(
    Object.entries(result.regressions || {}).map(([name, probe]) => [
      name,
      {
        ok: probe.ok,
        error: probe.error,
        details: probe.details
      }
    ])
  )
  console.log('[terminal-stress]', JSON.stringify({
    profile: result.profile,
    foreground: result.foreground,
    background: result.background,
    panels: result.panels,
    durationMs: result.durationMs,
    writtenMb: mb(result.writtenBytes),
    writes: {
      foregroundWrites: result.writes.foregroundWrites,
      backgroundWrites: result.writes.backgroundWrites,
      foregroundChunks: result.writes.foregroundChunks,
      backgroundChunks: result.writes.backgroundChunks,
      foregroundMb: mb(result.writes.foregroundBytes),
      backgroundMb: mb(result.writes.backgroundBytes)
    },
    frames: result.frames,
    avgFrameMs: Math.round(result.avgFrameMs * 10) / 10,
    p95FrameMs: Math.round(result.p95FrameMs * 10) / 10,
    p99FrameMs: Math.round(result.p99FrameMs * 10) / 10,
    maxFrameMs: Math.round(result.maxFrameMs * 10) / 10,
    threaded: {
      supported: result.threaded.supported,
      reason: result.threaded.capabilityReason,
      coreWorkers: result.threaded.coreWorkers,
      coreDebug: result.threaded.coreDebug,
      renderWorkerActive: result.threaded.renderWorkerActive,
      renderGroups: result.threaded.renderGroups,
      renderDebug: result.threaded.renderDebug,
      hostCount: result.threaded.hostCount,
      visibleHosts: result.threaded.hosts.slice(0, 12)
    },
    gpu: result.gpu,
    paintLatency: result.paintLatency,
    paintFrameMs: result.paintFrameMs,
    paintRows: result.paintRows,
    paintScrollRows: result.paintScrollRows,
    paintFullFrames: result.paintFullFrames,
    paintFullReasons: result.paintFullReasons,
    paintRepaintReasons: result.paintRepaintReasons,
    realEchoLatency: result.realEchoLatency,
    regressions,
    memory: {
      samples: result.memory.samples.length,
      jsHeapDeltaMb: mb(result.memory.jsHeapUsedDeltaBytes),
      postGcHeapDeltaMb: mb(result.memory.postGcHeapDeltaBytes),
      beforeGcHeapMb: mb(result.memory.endBeforeGcHeapUsedBytes),
      afterGcHeapMb: mb(result.memory.endAfterGcHeapUsedBytes),
      jsHeapMaxMb: mb(result.memory.jsHeapUsedMaxBytes),
      workingSetDeltaMb: typeof result.memory.workingSetDeltaKb === 'number' ? Math.round((result.memory.workingSetDeltaKb / 1024) * 10) / 10 : undefined,
      workingSetMaxMb: typeof result.memory.workingSetMaxKb === 'number' ? Math.round((result.memory.workingSetMaxKb / 1024) * 10) / 10 : undefined,
      gcSupported: result.memory.gcSupported,
      gcRuns: result.memory.gcRuns,
      canvasCount: result.canvasCount
    },
    queues: {
      samples: result.queues.samples.length,
      maxIngressPanels: result.queues.maxIngressPanels,
      maxIngressKb: Math.round((result.queues.maxIngressBytes / 1024) * 10) / 10,
      maxIngressChunks: result.queues.maxIngressChunks,
      maxHistoryPanels: result.queues.maxHistoryPanels,
      maxHistoryKb: Math.round((result.queues.maxHistoryBytes / 1024) * 10) / 10
    },
    switches: {
      enabled: result.switches.enabled,
      intervalMs: result.switches.intervalMs,
      count: result.switches.count,
      failed: result.switches.failed,
      paintLatency: result.switches.paintLatency
    },
    teardown: {
      enabled: result.teardown.enabled,
      closedPanels: result.teardown.closedPanels,
      hostCountDelta: result.teardown.hostCountDelta,
      canvasCountDelta: result.teardown.canvasCountDelta,
      heapDeltaMb: mb(result.teardown.jsHeapUsedDeltaBytes),
      workingSetDeltaMb: typeof result.teardown.workingSetDeltaKb === 'number' ? Math.round((result.teardown.workingSetDeltaKb / 1024) * 10) / 10 : undefined,
      baselineHosts: result.teardown.baseline.threadedHostCount,
      beforeCloseHosts: result.teardown.beforeClose.threadedHostCount,
      afterCloseHosts: result.teardown.afterClose.threadedHostCount,
      baselineCanvas: result.teardown.baseline.canvasCount,
      beforeCloseCanvas: result.teardown.beforeClose.canvasCount,
      afterCloseCanvas: result.teardown.afterClose.canvasCount,
      remainingStressHosts: result.teardown.remainingStressHosts.slice(0, 10),
      gcSupported: result.teardown.gcSupported,
      gcRuns: result.teardown.gcRuns,
      errors: result.teardown.errors
    },
    heapArtifacts: result.heapArtifacts,
    errors: result.errors.slice(0, 5)
  }))
}

test('threaded terminal renderer keeps foreground frames healthy under 10 foreground and 40 background streams', async () => {
  const { app, userDataDir } = await launchStressApp()
  try {
    const page = await app.firstWindow()
    await page.waitForFunction(() => Boolean((window as any).__AIOPSTERM_TERMINAL_STRESS__?.run), undefined, { timeout: 30_000 })
    const heapProfiler = await startHeapProfiler(app, page)
    const result = await injectStressHarness(page, {
      foreground: foregroundTerms,
      background: backgroundTerms,
      durationMs: stressDurationMs,
      switchIntervalMs,
      profile: stressProfile
    })
    await page.evaluate(() => {
      delete (window as any).__AIOPSTERM_TERMINAL_STRESS_RESULT__
    })
    const heapArtifacts = await heapProfiler.stop()
    result.heapArtifacts = heapArtifacts
    logStressResult(result)
    expect(result.profile).toBe(stressProfile)
    expect(result.foreground).toBeGreaterThanOrEqual(10)
    expect(result.background).toBeGreaterThanOrEqual(40)
    expect(result.writes.foregroundWrites).toBeGreaterThan(0)
    expect(result.writes.backgroundWrites).toBeGreaterThan(0)
    expect(result.writes.backgroundBytes).toBeGreaterThan(0)
    expect(result.threaded.supported, result.threaded.capabilityReason).toBe(true)
    expect(result.threaded.coreWorkers).toBeGreaterThan(0)
    expect(result.threaded.renderWorkerActive).toBe(true)
    expect(result.threaded.renderGroups.some((group) => group.requestedBackend === '2d')).toBe(true)
    expect(result.threaded.renderGroups.some((group) => group.backend === '2d')).toBe(true)
    expect(result.threaded.hostCount).toBeGreaterThanOrEqual(result.foreground + result.background)
    expect(result.paintLatency.samples).toBeGreaterThan(0)
    expect(result.paintLatency.p95).toBeLessThan(100)
    expect(result.paintFrameMs.p95).toBeLessThan(20)
    const allowedFullReasons = new Set(['create', 'import', 'settings', 'resize', 'visibility', 'clear', 'jump'])
    const unexpectedFullReasons = Object.entries(result.paintFullReasons || {})
      .filter(([reason]) => !allowedFullReasons.has(reason))
      .reduce<Record<string, number>>((summary, [reason, count]) => {
        summary[reason] = count
        return summary
      }, {})
    expect(unexpectedFullReasons, JSON.stringify(result.paintFullReasons)).toEqual({})
    expect(result.paintRows.p95).toBeLessThanOrEqual(6)
    const failedRegressions = Object.entries(result.regressions || {})
      .filter(([, probe]) => !probe.ok)
      .map(([name, probe]) => `${name}: ${probe.error || JSON.stringify(probe.details || {})}`)
    expect(failedRegressions).toEqual([])
    expect(result.switches.failed, result.errors.join('\n')).toBe(0)
    if (switchIntervalMs > 0) {
      expect(result.switches.count).toBeGreaterThan(0)
      expect(result.switches.paintLatency.samples).toBeGreaterThan(0)
      expect(result.switches.paintLatency.p95).toBeLessThan(500)
    }
    expect(result.realEchoLatency.available, result.realEchoLatency.error || result.errors.join('\n')).toBe(true)
    expect(result.realEchoLatency.p95).toBeLessThan(150)
    expect(result.memory.samples.length).toBeGreaterThanOrEqual(2)
    expect(result.memory.gcSupported).toBe(true)
    expect(result.memory.gcRuns).toBeGreaterThanOrEqual(2)
    if (typeof result.memory.workingSetDeltaKb === 'number') {
      expect(result.memory.workingSetDeltaKb).toBeLessThan(256 * 1024)
    }
    expect(result.teardown.enabled).toBe(true)
    expect(result.teardown.closedPanels).toBeGreaterThanOrEqual(result.foreground + result.background)
    expect(result.teardown.gcSupported).toBe(true)
    expect(result.teardown.gcRuns).toBeGreaterThanOrEqual(2)
    expect(result.teardown.remainingStressHosts, JSON.stringify(result.teardown.remainingStressHosts)).toEqual([])
    expect(result.teardown.hostCountDelta).toBeLessThanOrEqual(2)
    expect(result.teardown.canvasCountDelta).toBeLessThanOrEqual(2)
    if (typeof result.teardown.jsHeapUsedDeltaBytes === 'number') {
      expect(result.teardown.jsHeapUsedDeltaBytes).toBeLessThan(48 * 1024 * 1024)
    }
    expect(heapArtifacts.snapshotPath).toBeTruthy()
    expect(heapArtifacts.samplingPath).toBeTruthy()
    if (typeof heapArtifacts.rendererHeapUsedDeltaBytes === 'number') {
      expect(heapArtifacts.rendererHeapUsedDeltaBytes).toBeLessThan(96 * 1024 * 1024)
    }
    if (typeof heapArtifacts.rendererHeapUsedBytes === 'number') {
      expect(heapArtifacts.rendererHeapUsedBytes).toBeLessThan(128 * 1024 * 1024)
    }
    expect(heapObjectSize(heapArtifacts, 'string', 'string')).toBeLessThan(48 * 1024 * 1024)
    expect(result.canvasCount.after).toBeLessThanOrEqual(result.foreground + 5)
    expect(result.p95FrameMs).toBeLessThan(50)
    expect(result.p99FrameMs).toBeLessThan(100)
    expect(result.errors.filter((message) => !message.includes('Timed out waiting for PTY echo marker'))).toEqual([])
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})
