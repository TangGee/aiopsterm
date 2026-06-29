#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import WebSocket from 'ws'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const findFreePort = () =>
  new Promise((resolve, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (typeof address === 'object' && address?.port) resolve(address.port)
        else reject(new Error('Unable to allocate a local port.'))
      })
    })
  })

const fetchJson = async (url, timeoutMs = 1000) => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
    return await response.json()
  } finally {
    clearTimeout(timeout)
  }
}

const waitForDebuggerTarget = async (port, timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`)
      const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
      if (page) return page
    } catch (error) {
      lastError = error
    }
    await sleep(250)
  }
  throw new Error(`Timed out waiting for Electron remote-debugging page target. Last error: ${lastError?.message || 'none'}`)
}

const createCdpClient = (webSocketDebuggerUrl) =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketDebuggerUrl)
    let nextId = 1
    const pending = new Map()
    const client = {
      send(method, params = {}) {
        const id = nextId++
        socket.send(JSON.stringify({ id, method, params }))
        return new Promise((innerResolve, innerReject) => {
          pending.set(id, { resolve: innerResolve, reject: innerReject })
        })
      },
      close() {
        socket.close()
      }
    }
    socket.on('open', () => resolve(client))
    socket.on('message', (raw) => {
      const message = JSON.parse(String(raw))
      if (!message.id) return
      const waiter = pending.get(message.id)
      if (!waiter) return
      pending.delete(message.id)
      if (message.error) waiter.reject(new Error(message.error.message || JSON.stringify(message.error)))
      else waiter.resolve(message.result)
    })
    socket.on('error', reject)
    socket.on('close', () => {
      pending.forEach((waiter) => waiter.reject(new Error('CDP socket closed.')))
      pending.clear()
    })
  })

const evaluate = async (client, expression, options = {}) => {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
    ...options
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed.')
  }
  return result.result?.value
}

const softwarePattern = /\b(swiftshader|llvmpipe|softpipe|software|disabled_software)\b/i
const looksSoftware = (values) => values.filter((value) => typeof value === 'string').some((value) => softwarePattern.test(value))

const environmentGpuExpression = String.raw`
(async () => {
  const canvasGpuInfo = () => {
    const canvas = document.createElement('canvas');
    const webgl2 = canvas.getContext('webgl2');
    const gl = webgl2 || canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    const debugInfo = gl?.getExtension?.('WEBGL_debug_renderer_info');
    const getString = (parameter) => {
      try {
        const value = gl?.getParameter(parameter);
        return typeof value === 'string' ? value : undefined;
      } catch {
        return undefined;
      }
    };
    return {
      webgl: Boolean(gl),
      webgl2: Boolean(webgl2),
      renderer: gl ? getString(gl.RENDERER) : undefined,
      vendor: gl ? getString(gl.VENDOR) : undefined,
      unmaskedRenderer: gl && debugInfo ? getString(debugInfo.UNMASKED_RENDERER_WEBGL) : undefined,
      unmaskedVendor: gl && debugInfo ? getString(debugInfo.UNMASKED_VENDOR_WEBGL) : undefined
    };
  };
  const gpuFeatureStatus = await window.aiops?.getGpuFeatureStatus?.().catch((error) => ({ error: String(error?.message || error) }));
  return {
    userAgent: navigator.userAgent,
    location: location.href,
    canvasGpu: canvasGpuInfo(),
    gpuFeatureStatus
  };
})()
`

const terminalStressGpuExpression = String.raw`
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const startedAt = performance.now();
  while (performance.now() - startedAt < 30000) {
    if (window.__AIOPSTERM_TERMINAL_STRESS__?.run) break;
    await sleep(100);
  }
  const harness = window.__AIOPSTERM_TERMINAL_STRESS__;
  if (!harness?.run) throw new Error('Terminal stress harness did not install.');
  return await harness.run({
    foreground: 2,
    background: 0,
    durationMs: 3000,
    switchIntervalMs: 0,
    profile: 'mixed-switch'
  });
})()
`

const main = async () => {
  const port = Number(process.env.AIOPSTERM_GPU_PROBE_PORT || await findFreePort())
  const userDataDir = process.env.AIOPSTERM_GPU_PROBE_USER_DATA_DIR ||
    path.join(os.tmpdir(), `aiopsterm-gpu-probe-${Date.now()}`)
  await mkdir(userDataDir, { recursive: true })
  const electronPath = path.join(process.cwd(), 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron')
  const args = [`--remote-debugging-port=${port}`, '--no-sandbox', '.']
  const child = spawn(electronPath, args, {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      AIOPSTERM_USER_DATA_DIR: userDataDir,
      AIOPSTERM_THREADED_TERMINAL: '1',
      AIOPSTERM_TERMINAL_RENDER_BACKEND: 'webgl2',
      AIOPSTERM_TERMINAL_STRESS: '1',
      AIOPSTERM_MCP_DISCOVERY_DISABLE: '1',
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1'
    }
  })
  const stderr = []
  child.stdout.on('data', (chunk) => stderr.push(String(chunk)))
  child.stderr.on('data', (chunk) => stderr.push(String(chunk)))

  let client
  try {
    const target = await waitForDebuggerTarget(port)
    client = await createCdpClient(target.webSocketDebuggerUrl)
    await client.send('Runtime.enable')
    const environment = await evaluate(client, environmentGpuExpression)
    const stress = await evaluate(client, terminalStressGpuExpression)
    const terminalRenderGroups = stress?.threaded?.renderGroups || []
    const workspaceGroup = terminalRenderGroups.find((group) => group.renderGroupId === 'workspace-main') ||
      terminalRenderGroups.find((group) => group.surface === 'workspace')
    const allGpuStrings = [
      environment?.canvasGpu?.renderer,
      environment?.canvasGpu?.vendor,
      environment?.canvasGpu?.unmaskedRenderer,
      environment?.canvasGpu?.unmaskedVendor,
      workspaceGroup?.gpu?.renderer,
      workspaceGroup?.gpu?.vendor,
      workspaceGroup?.gpu?.unmaskedRenderer,
      workspaceGroup?.gpu?.unmaskedVendor,
      environment?.gpuFeatureStatus?.gpu_compositing,
      environment?.gpuFeatureStatus?.webgl,
      environment?.gpuFeatureStatus?.webgl2,
      environment?.gpuFeatureStatus?.opengl
    ]
    const terminalBackend = workspaceGroup?.backend
    const softwareRenderer = looksSoftware(allGpuStrings)
    const summary = {
      ok: terminalBackend === 'webgl2' && environment?.canvasGpu?.webgl2 === true,
      hardwareLikely: terminalBackend === 'webgl2' && environment?.canvasGpu?.webgl2 === true && !softwareRenderer,
      softwareRenderer,
      terminalBackend,
      terminalRenderGroups,
      environment,
      stress: {
        profile: stress?.profile,
        foreground: stress?.foreground,
        background: stress?.background,
        frames: stress?.frames,
        avgFrameMs: stress?.avgFrameMs,
        p95FrameMs: stress?.p95FrameMs,
        p99FrameMs: stress?.p99FrameMs,
        maxFrameMs: stress?.maxFrameMs,
        paintFrameMs: stress?.paintFrameMs,
        paintLatency: stress?.paintLatency,
        realEchoLatency: stress?.realEchoLatency,
        errors: stress?.errors,
        teardown: {
          closedPanels: stress?.teardown?.closedPanels,
          hostCountDelta: stress?.teardown?.hostCountDelta,
          canvasCountDelta: stress?.teardown?.canvasCountDelta,
          remainingStressHosts: stress?.teardown?.remainingStressHosts,
          errors: stress?.teardown?.errors
        }
      }
    }
    console.log(JSON.stringify(summary, null, 2))
  } finally {
    client?.close()
    child.kill('SIGTERM')
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 3000)
      child.once('exit', () => {
        clearTimeout(timeout)
        resolve()
      })
    })
    if (!process.env.AIOPSTERM_GPU_PROBE_KEEP_USER_DATA) {
      await rm(userDataDir, { recursive: true, force: true })
    }
    if (child.exitCode !== null && child.exitCode !== 0 && stderr.length) {
      console.error(stderr.join('').slice(-4000))
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exit(1)
})
