import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { CLINE_AGENT_MAX_PROTOCOL_FRAME_BYTES } from '../src/shared/contracts/clineAgent'

let ClineAgentSidecarSupervisor: any
let resolveClineAgentSidecarLaunch: any

beforeAll(async () => {
  const modulePath = '../src/main/backend/agent/clineAgentSidecarSupervisor'
  ;({ ClineAgentSidecarSupervisor, resolveClineAgentSidecarLaunch } = await import(modulePath))
})

class FakeSidecarProcess extends EventEmitter {
  stdin = new PassThrough()
  stdout = new PassThrough()
  stderr = new PassThrough()
  killed = false
  exitCode: number | null = null
  pid = 4242

  kill = vi.fn((_signal?: NodeJS.Signals) => {
    if (this.killed) return false
    this.killed = true
    this.exitCode = 0
    queueMicrotask(() => this.emit('exit', 0, null))
    return true
  })

  sendFrame(frame: unknown) {
    this.stdout.write(`${JSON.stringify(frame)}\n`)
  }

  exitUnexpectedly(code = 7) {
    this.exitCode = code
    this.emit('exit', code, null)
  }
}

const tempDirs: string[] = []

const temporaryApp = () => {
  const appPath = mkdtempSync(join(tmpdir(), 'aiopsterm-cline-supervisor-'))
  tempDirs.push(appPath)
  return appPath
}

const readyFrame = {
  version: 1,
  kind: 'event',
  event: 'runtime.ready',
  payload: { protocolVersion: 1, sdkVersion: '0.0.59', pid: 4242 }
}

afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

describe('Cline Agent sidecar path resolution', () => {
  it('prefers an explicit launch and locates a built Node runtime plus bundle', () => {
    const appPath = temporaryApp()
    expect(resolveClineAgentSidecarLaunch({
      appPath,
      resourcesPath: appPath,
      isPackaged: false,
      env: { AIOPSTERM_CLINE_SIDECAR_BIN: '/opt/aiopsterm/cline-sidecar' }
    })).toMatchObject({ command: '/opt/aiopsterm/cline-sidecar', source: 'override' })

    const outputDir = join(appPath, 'build', 'cline-sidecar')
    const runtimePath = join(outputDir, process.platform === 'win32' ? 'node.exe' : 'node')
    const bundlePath = join(outputDir, 'cline-agent-sidecar.cjs')
    mkdirSync(outputDir, { recursive: true })
    writeFileSync(runtimePath, '')
    writeFileSync(bundlePath, '')
    expect(resolveClineAgentSidecarLaunch({ appPath, resourcesPath: appPath, isPackaged: false, env: {} }))
      .toMatchObject({ command: runtimePath, args: [bundlePath], source: 'build' })
  })

  it('passes an explicit bundle to an overridden Node runtime', () => {
    const appPath = temporaryApp()
    const bundlePath = join(appPath, 'sidecar.cjs')
    writeFileSync(bundlePath, '')
    expect(resolveClineAgentSidecarLaunch({
      appPath,
      resourcesPath: appPath,
      isPackaged: false,
      env: {
        AIOPSTERM_CLINE_SIDECAR_BIN: '/opt/node22/bin/node',
        AIOPSTERM_CLINE_SIDECAR_BUNDLE: bundlePath
      }
    })).toMatchObject({ command: '/opt/node22/bin/node', args: [bundlePath], source: 'override' })
  })

  it('prefers the source runtime in development unless the built bundle is explicitly selected', () => {
    const appPath = temporaryApp()
    const outputDir = join(appPath, 'build', 'cline-sidecar')
    const runtimePath = join(outputDir, process.platform === 'win32' ? 'node.exe' : 'node')
    const bundlePath = join(outputDir, 'cline-agent-sidecar.cjs')
    const bunPath = process.platform === 'win32'
      ? join(appPath, 'node_modules', '.bin', 'bun.cmd')
      : join(appPath, 'node_modules', '.bin', 'bun')
    const entryPath = join(appPath, 'src', 'sidecar', 'clineAgentSidecar.ts')
    mkdirSync(outputDir, { recursive: true })
    mkdirSync(join(appPath, 'node_modules', '.bin'), { recursive: true })
    mkdirSync(join(appPath, 'src', 'sidecar'), { recursive: true })
    for (const file of [runtimePath, bundlePath, bunPath, entryPath]) writeFileSync(file, '')

    expect(resolveClineAgentSidecarLaunch({ appPath, resourcesPath: appPath, isPackaged: false, env: {} }))
      .toMatchObject({ command: bunPath, args: ['run', entryPath], source: 'bun-source' })
    expect(resolveClineAgentSidecarLaunch({
      appPath,
      resourcesPath: appPath,
      isPackaged: false,
      env: { AIOPSTERM_CLINE_USE_BUILT_SIDECAR: '1' }
    })).toMatchObject({ command: runtimePath, args: [bundlePath], source: 'build' })
  })

  it('fails closed when a packaged sidecar is missing', () => {
    const appPath = temporaryApp()
    expect(() => resolveClineAgentSidecarLaunch({ appPath, resourcesPath: appPath, isPackaged: true, env: {} }))
      .toThrow('Packaged Cline Agent sidecar is missing')
  })
})

describe('Cline Agent sidecar supervisor', () => {
  const createHarness = (onCallback = vi.fn(async () => ({ accepted: true }))) => {
    const child = new FakeSidecarProcess()
    const appPath = temporaryApp()
    const writes: any[] = []
    let inputBuffer = ''
    child.stdin.on('data', (chunk) => {
      inputBuffer += chunk.toString()
      for (;;) {
        const newline = inputBuffer.indexOf('\n')
        if (newline < 0) break
        const line = inputBuffer.slice(0, newline).trim()
        inputBuffer = inputBuffer.slice(newline + 1)
        if (!line) continue
        const frame = JSON.parse(line)
        writes.push(frame)
        if (frame.kind === 'request' && frame.method === 'runtime.ping') {
          queueMicrotask(() => child.sendFrame({
            version: 1,
            kind: 'response',
            id: frame.id,
            ok: true,
            result: { protocolVersion: 1, sdkVersion: '0.0.59', pid: child.pid }
          }))
        }
        if (frame.kind === 'request' && frame.method === 'runtime.shutdown') {
          queueMicrotask(() => {
            child.sendFrame({ version: 1, kind: 'response', id: frame.id, ok: true, result: { stopped: true } })
            child.exitCode = 0
            child.emit('exit', 0, null)
          })
        }
      }
    })
    const onExit = vi.fn()
    const supervisor = new ClineAgentSidecarSupervisor({
      appPath,
      resourcesPath: appPath,
      userDataPath: appPath,
      isPackaged: false,
      env: { AIOPSTERM_CLINE_SIDECAR_BIN: '/fake/cline-sidecar' },
      spawnProcess: vi.fn(() => child as any) as any,
      onCallback,
      onExit
    })
    queueMicrotask(() => child.sendFrame(readyFrame))
    return { child, onCallback, onExit, supervisor, writes }
  }

  it('handshakes, correlates requests, handles callbacks, and shuts down cleanly', async () => {
    const harness = createHarness()
    await expect(harness.supervisor.request('runtime.ping')).resolves.toMatchObject({ sdkVersion: '0.0.59' })
    harness.child.sendFrame({
      version: 1,
      kind: 'callback',
      id: 'callback-1',
      callback: 'tool.execute',
      payload: { toolName: 'read_only_tool' }
    })
    await vi.waitFor(() => expect(harness.onCallback).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(harness.writes).toContainEqual(expect.objectContaining({
      kind: 'callback-result',
      id: 'callback-1',
      ok: true,
      result: { accepted: true }
    })))
    await harness.supervisor.shutdown()
    expect(harness.onExit).toHaveBeenCalledWith(expect.objectContaining({ code: 0 }))
  })

  it('accepts a complete protocol frame above the former 4 MiB limit', async () => {
    const harness = createHarness()
    await harness.supervisor.ensureStarted()
    const payload = 'x'.repeat(4 * 1024 * 1024)
    expect(Buffer.byteLength(payload, 'utf8')).toBeLessThan(CLINE_AGENT_MAX_PROTOCOL_FRAME_BYTES)
    harness.child.sendFrame({
      version: 1,
      kind: 'callback',
      id: 'large-callback',
      callback: 'tool.execute',
      payload: { value: payload }
    })

    await vi.waitFor(() => expect(harness.onCallback).toHaveBeenCalledWith(expect.objectContaining({
      id: 'large-callback',
      payload: { value: payload }
    })))
    await harness.supervisor.shutdown()
  })

  it('rejects an in-flight turn when the sidecar crashes', async () => {
    const harness = createHarness()
    await harness.supervisor.ensureStarted()
    const pending = harness.supervisor.request('session.send', { sessionId: 'session-1' })
    await vi.waitFor(() => expect(harness.writes).toContainEqual(expect.objectContaining({ method: 'session.send' })))
    harness.child.exitUnexpectedly()
    await expect(pending).rejects.toThrow('exited unexpectedly with code 7')
    expect(harness.onExit).toHaveBeenCalledWith(expect.objectContaining({ code: 7 }))
  })

  it('force-terminates an unresponsive sidecar and waits for process exit', async () => {
    const harness = createHarness()
    await harness.supervisor.ensureStarted()
    const pendingStop = harness.supervisor.request('session.stop', { sessionId: 'session-stuck' })
    void pendingStop.catch(() => undefined)
    await vi.waitFor(() => expect(harness.writes).toContainEqual(expect.objectContaining({
      method: 'session.stop',
      payload: { sessionId: 'session-stuck' }
    })))

    await expect(harness.supervisor.forceTerminate('session.stop exceeded its grace period')).resolves.toBeUndefined()

    expect(harness.child.kill).toHaveBeenCalledWith('SIGTERM')
    expect(harness.onExit).toHaveBeenCalledWith(expect.objectContaining({ code: 0 }))
    await expect(pendingStop).rejects.toThrow('Cline Agent sidecar stopped')
  })

  it('fails closed when a sidecar does not exit after SIGKILL isolation', async () => {
    const harness = createHarness()
    await harness.supervisor.ensureStarted()
    harness.child.kill.mockImplementation(() => {
      harness.child.killed = true
      return true
    })
    vi.useFakeTimers()
    try {
      const forcing = harness.supervisor.forceTerminate('test an unkillable sidecar')
      const rejection = expect(forcing).rejects.toThrow('did not exit after SIGKILL isolation')
      await vi.advanceTimersByTimeAsync(4_000)
      await rejection
      expect(harness.child.kill).toHaveBeenNthCalledWith(1, 'SIGTERM')
      expect(harness.child.kill).toHaveBeenNthCalledWith(2, 'SIGKILL')
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not expire a session.send request while operator approval may still be pending', async () => {
    const harness = createHarness()
    await harness.supervisor.ensureStarted()
    vi.useFakeTimers()
    try {
      let settled = false
      const pending = harness.supervisor.request('session.send', { sessionId: 'session-1' })
        .finally(() => {
          settled = true
        })
      await Promise.resolve()
      const request = harness.writes.find((frame) => frame.kind === 'request' && frame.method === 'session.send')
      expect(request).toBeTruthy()

      await vi.advanceTimersByTimeAsync(31 * 60_000)
      expect(settled).toBe(false)

      harness.child.sendFrame({
        version: 1,
        kind: 'response',
        id: request.id,
        ok: true,
        result: { sessionId: 'session-1', finishReason: 'stop' }
      })
      await expect(pending).resolves.toMatchObject({ sessionId: 'session-1', finishReason: 'stop' })
    } finally {
      vi.useRealTimers()
      await harness.supervisor.shutdown()
    }
  })
})
