import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  __resetKubernetesCatalogForTests,
  addKubernetesCluster,
  closeKubernetesTerminal,
  configureKubernetesBackendRuntime,
  connectKubernetesCluster,
  createKubernetesTerminal,
  disconnectKubernetesCluster,
  executeKubernetesCommand,
  importKubernetesKubeconfig,
  refreshKubernetesResources,
  setKubernetesTerminalEventSink,
  writeKubernetesTerminal
} from '@shared/kubernetes'
import type { KubernetesTerminalDataEvent, KubernetesTerminalExitEvent } from '@shared/contracts/kubernetes'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

// 真实集群端到端实测(kind/minikube/k3s/任意可达集群)。
// 运行方式:
//   export AIOPSTERM_LIVE_K8S_KUBECONFIG=~/.kube/config   # 或 kind 导出的 kubeconfig
//   export AIOPSTERM_LIVE_K8S_CONTEXT=kind-kind            # 可选,默认取文件 current-context 或第一个
//   npm run test:live:k8s
// 前提:kubectl 在 PATH(或设置 AIOPSTERM_KUBECTL_PATH)。测试只读集群(get/version),不创建资源。
const liveKubeconfigPath = String(process.env.AIOPSTERM_LIVE_K8S_KUBECONFIG || '').trim()
const requestedContext = String(process.env.AIOPSTERM_LIVE_K8S_CONTEXT || '').trim()
const liveDescribe = liveKubeconfigPath ? describe : describe.skip

const waitFor = async <T>(probe: () => T | undefined, timeoutMs = 20_000, intervalMs = 150): Promise<T> => {
  const startedAt = Date.now()
  for (;;) {
    const value = probe()
    if (value !== undefined) return value
    if (Date.now() - startedAt > timeoutMs) throw new Error('waitFor timed out')
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

liveDescribe('kubernetes live backend integration (real cluster)', () => {
  const tempDirs: string[] = []
  let dataEvents: KubernetesTerminalDataEvent[] = []
  let exitEvents: KubernetesTerminalExitEvent[] = []
  let kubeconfigBefore = ''

  const terminalText = () => dataEvents.map((event) => event.data).join('')

  beforeEach(async () => {
    dataEvents = []
    exitEvents = []
    const stateDir = await mkdtemp(join(tmpdir(), 'aiopsterm-live-k8s-real-'))
    tempDirs.push(stateDir)
    kubeconfigBefore = await readFile(liveKubeconfigPath, 'utf-8')
    configureKubernetesBackendRuntime({ stateDir, useSeedData: false, defaultKubeconfigPath: null })
    __resetKubernetesCatalogForTests()
    setKubernetesTerminalEventSink((event) => {
      if ('data' in event) dataEvents.push(event)
      else exitEvents.push(event)
    })
  })

  afterEach(async () => {
    setKubernetesTerminalEventSink(null)
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('imports, connects, refreshes and opens a real PTY terminal against the live cluster', async () => {
    // 1. 导入真实 kubeconfig。
    const imported = await importKubernetesKubeconfig({ requestId: 'live-real-import', kubeconfigPath: liveKubeconfigPath })
    expect(imported.ok).toBe(true)
    expect(imported.data!.contexts.length).toBeGreaterThan(0)

    const contextName = requestedContext || imported.data!.currentContext || imported.data!.contexts[0].name
    const context = imported.data!.contexts.find((item) => item.name === contextName)
    expect(context, `context ${contextName} not found in ${liveKubeconfigPath}`).toBeTruthy()

    // 2. 保存集群并连接(真实 kubectl get namespaces 探测)。
    const added = await addKubernetesCluster({
      name: context!.cluster || context!.name,
      contextName: context!.name,
      serverUrl: context!.server,
      defaultNamespace: context!.namespace || 'default',
      kubeconfigPath: liveKubeconfigPath,
      authType: 'kubeconfig',
      sourceType: 'local'
    })
    expect(added.ok).toBe(true)
    const clusterId = added.data!.cluster!.id

    const connected = await connectKubernetesCluster(clusterId)
    expect(connected.ok, connected.errorMessage).toBe(true)
    expect(connected.data?.cluster?.connection_status).toBe('connected')

    // 3. 只读资源刷新:namespaces/pods/deployments/services/nodes 真实表格解析。
    const refreshed = await refreshKubernetesResources({ clusterId, namespace: 'all', kind: 'all' })
    expect(refreshed.ok, refreshed.errorMessage).toBe(true)
    expect(refreshed.data?.success).toBe(true)
    expect(refreshed.data!.refreshedNamespaces).toBeGreaterThan(0)
    expect(refreshed.data!.resources.filter((resource) => resource.kind === 'nodes').length).toBeGreaterThan(0)

    // 4. 一次性命令。
    const version = await executeKubernetesCommand({ command: 'kubectl version', clusterId })
    expect(version.ok).toBe(true)
    expect(version.data?.output).toContain('Client Version')

    // 5. 真 PTY 终端:current-context 已钉住,get pods 可跑,用户 kubeconfig 不被改动。
    const created = await createKubernetesTerminal({ clusterId, namespace: context!.namespace || 'default', cols: 120, rows: 32 })
    expect(created.ok, created.errorMessage).toBe(true)
    expect(created.data?.status).toBe('connected')
    await waitFor(() => (terminalText().length > 0 ? true : undefined))

    dataEvents = []
    await writeKubernetesTerminal(created.data!.sessionId, 'kubectl config current-context\n')
    await waitFor(() => (terminalText().includes(context!.name) ? true : undefined))

    dataEvents = []
    await writeKubernetesTerminal(created.data!.sessionId, 'kubectl get pods -A\n')
    await waitFor(() => (/NAMESPACE\s+NAME|No resources found/.test(terminalText()) ? true : undefined))

    const closed = await closeKubernetesTerminal(created.data!.sessionId, 0)
    expect(closed.ok).toBe(true)
    await waitFor(() => (exitEvents.some((event) => event.sessionId === created.data!.sessionId) ? true : undefined), 5000)

    const kubeconfigAfter = await readFile(liveKubeconfigPath, 'utf-8')
    expect(kubeconfigAfter).toBe(kubeconfigBefore)

    const disconnected = await disconnectKubernetesCluster(clusterId)
    expect(disconnected.ok).toBe(true)
  }, 120_000)
})
