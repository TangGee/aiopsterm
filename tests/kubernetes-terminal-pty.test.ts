import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  __resetKubernetesCatalogForTests,
  addKubernetesCluster,
  closeKubernetesTerminal,
  configureKubernetesBackendRuntime,
  connectKubernetesCluster,
  createKubernetesTerminal,
  deleteKubernetesCluster,
  disconnectKubernetesCluster,
  listKubernetesCatalog,
  resizeKubernetesTerminal,
  saveKubernetesAgentProxyConfig,
  setKubernetesTerminalEventSink,
  updateKubernetesCluster,
  writeKubernetesTerminal
} from '@shared/kubernetes'
import type { KubernetesPtyProcess, KubernetesPtySpawnRequest } from '@shared/kubernetesTerminalRuntime'
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises'
import { execFileSync } from 'child_process'
import { join, resolve } from 'path'
import { tmpdir } from 'os'

class FakePty implements KubernetesPtyProcess {
  pid = 4242
  written: string[] = []
  resized: Array<{ cols: number; rows: number }> = []
  killed = false
  private dataListeners: Array<(data: string) => void> = []
  private exitListeners: Array<(event: { exitCode: number }) => void> = []

  write(data: string) {
    this.written.push(data)
  }

  resize(cols: number, rows: number) {
    this.resized.push({ cols, rows })
  }

  kill() {
    this.killed = true
  }

  onData(listener: (data: string) => void) {
    this.dataListeners.push(listener)
  }

  onExit(listener: (event: { exitCode: number }) => void) {
    this.exitListeners.push(listener)
  }

  emitData(chunk: string) {
    this.dataListeners.forEach((listener) => listener(chunk))
  }

  emitExit(exitCode: number) {
    this.exitListeners.forEach((listener) => listener({ exitCode }))
  }
}

describe('kubernetes terminal PTY runtime', () => {
  const tempDirs: string[] = []
  const originalKubectlPath = process.env.AIOPSTERM_KUBECTL_PATH
  let spawned: Array<{ request: KubernetesPtySpawnRequest; pty: FakePty }> = []

  const fakeSpawner = (request: KubernetesPtySpawnRequest) => {
    const pty = new FakePty()
    spawned.push({ request, pty })
    return pty
  }

  const createFakeKubectl = async (scriptBody: string) => {
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-fake-kubectl-'))
    tempDirs.push(dir)
    const filePath = join(dir, process.platform === 'win32' ? 'kubectl.cjs' : 'kubectl')
    if (process.platform === 'win32') {
      const gitExecPath = execFileSync('git', ['--exec-path'], { encoding: 'utf-8' }).trim()
      const shellPath = join(resolve(gitExecPath, '..', '..', '..'), 'bin', 'sh.exe')
      const wrapper = [
        "const { spawnSync } = require('child_process')",
        `const result = spawnSync(${JSON.stringify(shellPath)}, ['-c', ${JSON.stringify(['set -eu', scriptBody].join('\n'))}, 'kubectl', ...process.argv.slice(2)], { env: process.env, stdio: 'inherit' })`,
        "if (result.error) process.stderr.write(`${result.error.message}\\n`)",
        'process.exit(result.status ?? 1)'
      ].join('\n')
      await writeFile(filePath, wrapper, 'utf-8')
    } else {
      await writeFile(filePath, ['#!/bin/sh', 'set -eu', scriptBody].join('\n'), 'utf-8')
      await chmod(filePath, 0o755)
    }
    process.env.AIOPSTERM_KUBECTL_PATH = filePath
    return filePath
  }

  const qaKubeconfigContent = [
    'apiVersion: v1',
    'kind: Config',
    'current-context: unrelated/other',
    'clusters:',
    '- cluster:',
    '    server: https://qa.k8s.local:6443',
    '  name: qa-cluster',
    'contexts:',
    '- context:',
    '    cluster: qa-cluster',
    '    namespace: qa',
    '  name: qa/dev'
  ].join('\n')

  const addQaCluster = async (overrides: Record<string, unknown> = {}) => {
    const added = await addKubernetesCluster({
      name: 'qa-cluster',
      contextName: 'qa/dev',
      serverUrl: 'https://qa.k8s.local:6443',
      defaultNamespace: 'qa',
      kubeconfigContent: qaKubeconfigContent,
      authType: 'kubeconfig',
      sourceType: 'local',
      ...overrides
    })
    expect(added.ok).toBe(true)
    return added.data!.cluster!.id
  }

  beforeEach(async () => {
    spawned = []
    const stateDir = await mkdtemp(join(tmpdir(), 'aiopsterm-k8s-state-'))
    tempDirs.push(stateDir)
    await createFakeKubectl(['echo "NAME STATUS AGE"', 'echo "qa Active 1d"'].join('\n'))
    configureKubernetesBackendRuntime({
      stateDir,
      useSeedData: false,
      defaultKubeconfigPath: null,
      spawnKubernetesTerminalPty: fakeSpawner
    })
    __resetKubernetesCatalogForTests()
    setKubernetesTerminalEventSink(null)
  })

  afterEach(async () => {
    if (originalKubectlPath === undefined) delete process.env.AIOPSTERM_KUBECTL_PATH
    else process.env.AIOPSTERM_KUBECTL_PATH = originalKubectlPath
    setKubernetesTerminalEventSink(null)
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('spawns a PTY shell with a session-scoped pinned kubeconfig for connected clusters', async () => {
    const clusterId = await addQaCluster()
    await connectKubernetesCluster(clusterId)
    const events: unknown[] = []
    setKubernetesTerminalEventSink((event) => events.push(event))

    const created = await createKubernetesTerminal({ clusterId, namespace: 'qa', cols: 100, rows: 30 })
    expect(created.ok).toBe(true)
    expect(created.data).toMatchObject({ clusterId, status: 'connected', cols: 100, rows: 30 })
    expect(spawned).toHaveLength(1)

    const request = spawned[0].request
    expect(request.cols).toBe(100)
    expect(request.rows).toBe(30)
    expect(request.env.KUBECONFIG).toBeTruthy()
    const sessionKubeconfig = await readFile(request.env.KUBECONFIG as string, 'utf-8')
    // 会话 kubeconfig 是私有副本且 current-context 已钉住到集群 context。
    expect(sessionKubeconfig).toContain('current-context: qa/dev')
    expect(sessionKubeconfig).toContain('server: https://qa.k8s.local:6443')
    if (process.platform !== 'win32') {
      const mode = (await stat(request.env.KUBECONFIG as string)).mode & 0o777
      expect(mode).toBe(0o600)
    }

    const write = await writeKubernetesTerminal(created.data!.sessionId, 'kubectl get pods\n')
    expect(write).toMatchObject({
      ok: true,
      data: {
        sessionId: created.data!.sessionId,
        command: 'kubectl get pods',
        output: '',
        terminalOutput: '',
        success: true,
        error: ''
      }
    })
    expect(spawned[0].pty.written).toEqual(['kubectl get pods\n'])

    // PTY 输出流式抵达:ANSI 清洗 + 回车归一化后追加到会话并广播 data 事件。
    spawned[0].pty.emitData('\u001b[32mpod-a Running\u001b[0m\r\n')
    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        sessionId: created.data!.sessionId,
        clusterId,
        data: 'pod-a Running\n',
        command: '',
        success: true
      })
    )

    const resized = await resizeKubernetesTerminal(created.data!.sessionId, 120, 40)
    expect(resized.ok).toBe(true)
    expect(resized.data?.output).toContain('pod-a Running')
    expect(spawned[0].pty.resized.at(-1)).toEqual({ cols: 120, rows: 40 })

    const closed = await closeKubernetesTerminal(created.data!.sessionId, 0)
    expect(closed.ok).toBe(true)
    expect(spawned[0].pty.killed).toBe(true)
    expect(events.at(-1)).toEqual(expect.objectContaining({ sessionId: created.data!.sessionId, reason: 'closed', exitCode: 0 }))
  })

  it('keeps pending terminals in connecting state and starts the shell when the cluster connects', async () => {
    const clusterId = await addQaCluster()
    const events: unknown[] = []
    setKubernetesTerminalEventSink((event) => events.push(event))

    const created = await createKubernetesTerminal({ clusterId, namespace: 'qa' })
    expect(created.ok).toBe(true)
    expect(created.data?.status).toBe('connecting')
    expect(spawned).toHaveLength(0)

    await expect(writeKubernetesTerminal(created.data!.sessionId, 'kubectl get pods\n')).resolves.toMatchObject({
      ok: false,
      errorCode: 'K8S_TERMINAL_NOT_CONNECTED'
    })

    const connected = await connectKubernetesCluster(clusterId)
    expect(connected.ok).toBe(true)
    expect(spawned).toHaveLength(1)

    await expect(writeKubernetesTerminal(created.data!.sessionId, 'kubectl get pods\n')).resolves.toMatchObject({ ok: true })

    // shell 自行退出 → 会话转为 ended 并广播 exit。
    spawned[0].pty.emitExit(0)
    expect(events.at(-1)).toEqual(expect.objectContaining({ sessionId: created.data!.sessionId, reason: 'closed', exitCode: 0 }))
    await expect(writeKubernetesTerminal(created.data!.sessionId, 'kubectl get ns\n')).resolves.toMatchObject({
      ok: false,
      errorCode: 'K8S_TERMINAL_ENDED'
    })
  })

  it('disposes PTY sessions when the cluster disconnects', async () => {
    const clusterId = await addQaCluster()
    await connectKubernetesCluster(clusterId)
    const events: unknown[] = []
    setKubernetesTerminalEventSink((event) => events.push(event))
    const created = await createKubernetesTerminal({ clusterId, namespace: 'qa' })
    expect(created.ok).toBe(true)

    const disconnected = await disconnectKubernetesCluster(clusterId)
    expect(disconnected.ok).toBe(true)
    expect(spawned[0].pty.killed).toBe(true)
    expect(events.at(-1)).toEqual(expect.objectContaining({ sessionId: created.data!.sessionId, reason: 'disconnect' }))
    await expect(writeKubernetesTerminal(created.data!.sessionId, 'kubectl get pods\n')).resolves.toMatchObject({
      ok: false,
      errorCode: 'K8S_TERMINAL_NOT_FOUND'
    })
  })

  it('updates cluster kubeconfig in place and resets the connection status', async () => {
    const clusterId = await addQaCluster()
    await connectKubernetesCluster(clusterId)

    const rotated = qaKubeconfigContent.replace('https://qa.k8s.local:6443', 'https://qa-rotated.k8s.local:6443')
    const updated = await updateKubernetesCluster(clusterId, { kubeconfigContent: rotated })
    expect(updated.ok).toBe(true)
    expect(updated.data?.cluster).toMatchObject({
      id: clusterId,
      kubeconfig_content: rotated,
      connection_status: 'disconnected'
    })

    await expect(updateKubernetesCluster(clusterId, { kubeconfigPath: null, kubeconfigContent: null })).resolves.toMatchObject({
      ok: false,
      errorCode: 'K8S_KUBECONFIG_REQUIRED'
    })

    const jumpserver = await addKubernetesCluster({
      name: 'js-cluster',
      contextName: 'js/ctx',
      serverUrl: 'https://js.k8s.local:6443',
      sourceType: 'jumpserver',
      authType: 'jumpserver'
    })
    expect(jumpserver.ok).toBe(true)
    await expect(updateKubernetesCluster(jumpserver.data!.cluster!.id, { kubeconfigContent: qaKubeconfigContent })).resolves.toMatchObject({
      ok: false,
      errorCode: 'K8S_CLUSTER_KUBECONFIG_NOT_SUPPORTED'
    })
  })

  it('keeps shared contexts until the last cluster referencing them is deleted', async () => {
    const firstId = await addQaCluster()
    const secondId = await addQaCluster({ name: 'qa-cluster-copy' })

    const afterFirstDelete = await deleteKubernetesCluster(firstId)
    expect(afterFirstDelete.ok).toBe(true)
    expect(afterFirstDelete.data?.contexts.some((context) => context.name === 'qa/dev')).toBe(true)

    const afterSecondDelete = await deleteKubernetesCluster(secondId)
    expect(afterSecondDelete.ok).toBe(true)
    expect(afterSecondDelete.data?.contexts.some((context) => context.name === 'qa/dev')).toBe(false)
  })

  it('persists kubernetes state files with 0600 permissions', async () => {
    if (process.platform === 'win32') return
    await addQaCluster()
    const catalog = await listKubernetesCatalog()
    expect(catalog.ok).toBe(true)

    const stateDir = tempDirs.find((dir) => dir.includes('aiopsterm-k8s-state-'))!
    expect(((await stat(join(stateDir, 'catalog.json'))).mode & 0o777)).toBe(0o600)

    const proxySaved = await saveKubernetesAgentProxyConfig({ enabled: false })
    expect(proxySaved.ok).toBe(true)
    expect(((await stat(join(stateDir, 'agent-proxy.json'))).mode & 0o777)).toBe(0o600)
  })
})
