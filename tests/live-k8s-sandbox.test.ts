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
import { chmod, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

// 沙箱/本机全链路实测:真 node-pty + 真 shell + tabwriter 风格的 kubectl 替身。
// 与单元测试的区别:不注入 fake PTY,终端走 node-pty 原生实现,输出为真实字节流。
// 运行方式: AIOPSTERM_LIVE_K8S_PTY=1 npx vitest run tests/live-k8s-sandbox.test.ts
const liveEnabled = String(process.env.AIOPSTERM_LIVE_K8S_PTY || '').trim() === '1' && process.platform !== 'win32'
const liveDescribe = liveEnabled ? describe : describe.skip

// kubectl 替身:严格模拟 kubectl 行为面 —— 读取 KUBECONFIG、校验 --context、
// tabwriter 多空格表格、RESTARTS "7 (32s ago)"、-o wide 的 NOMINATED NODE 表头、logs -f 流式输出。
// 用数组拼接而非模板字符串:shell 的 ${...} 展开会撞上 JS 模板插值。
const fakeKubectlScript = [
  '#!/bin/sh',
  'set -eu',
  'CTX=""',
  'NS=""',
  'WIDE=0',
  'FOLLOW=0',
  'for a in "$@"; do',
  '  case "$a" in',
  '    --context=*) CTX="${a#--context=}" ;;',
  '    --namespace=*) NS="${a#--namespace=}" ;;',
  '    wide|-owide|--output=wide) WIDE=1 ;;',
  '    -f|--follow) FOLLOW=1 ;;',
  '  esac',
  'done',
  'CFG_CTX=""',
  'if [ -n "${KUBECONFIG:-}" ] && [ -f "${KUBECONFIG}" ]; then',
  '  CFG_CTX=$(sed -n "s/^current-context:[[:space:]]*//p" "${KUBECONFIG}" | head -1)',
  'fi',
  'cmd="${1:-}"',
  'sub="${2:-}"',
  'case "$cmd" in',
  '  version)',
  '    echo "Client Version: v1.30.2"',
  '    echo "Server Version: v1.29.4-live-double"',
  '    ;;',
  '  config)',
  '    case "$sub" in',
  '      current-context) echo "${CFG_CTX:-<none>}" ;;',
  '      use-context) echo "Switched to context \\"${3:-}\\"." ;;',
  '      *) echo "error: unsupported config subcommand" >&2; exit 1 ;;',
  '    esac',
  '    ;;',
  '  get)',
  '    if [ -z "$CTX" ] && [ -z "$CFG_CTX" ]; then echo "error: no context" >&2; exit 1; fi',
  '    case "$sub" in',
  '      namespaces|ns)',
  "        printf 'NAME              STATUS   AGE\\n'",
  "        printf 'default           Active   41d\\n'",
  "        printf 'kube-system       Active   41d\\n'",
  "        printf 'live-demo         Active   3h2m\\n'",
  '        ;;',
  '      pods|pod|po)',
  '        if [ "$WIDE" = "1" ]; then',
  "          printf 'NAME            READY   STATUS             RESTARTS      AGE    IP           NODE          NOMINATED NODE   READINESS GATES\\n'",
  "          printf 'api-server-0    1/1     Running            0             3h2m   10.42.0.11   live-node-1   <none>           <none>\\n'",
  "          printf 'billing-1       0/1     CrashLoopBackOff   7 (32s ago)   3h1m   10.42.0.12   live-node-1   <none>           <none>\\n'",
  '        else',
  "          printf 'NAME            READY   STATUS             RESTARTS      AGE\\n'",
  "          printf 'api-server-0    1/1     Running            0             3h2m\\n'",
  "          printf 'billing-1       0/1     CrashLoopBackOff   7 (32s ago)   3h1m\\n'",
  '        fi',
  '        ;;',
  '      deployments|deployment|deploy)',
  "        printf 'NAME          READY   UP-TO-DATE   AVAILABLE   AGE\\n'",
  "        printf 'api-server    1/1     1            1           3h2m\\n'",
  '        ;;',
  '      services|service|svc)',
  "        printf 'NAME         TYPE        CLUSTER-IP    EXTERNAL-IP   PORT(S)            AGE\\n'",
  "        printf 'api-server   ClusterIP   10.43.0.10    <none>        8080/TCP,443/TCP   3h2m\\n'",
  '        ;;',
  '      nodes|node|no)',
  "        printf 'NAME          STATUS   ROLES                  AGE   VERSION\\n'",
  "        printf 'live-node-1   Ready    control-plane,worker   41d   v1.29.4\\n'",
  '        ;;',
  '      *) echo "error: the server doesn\'t have a resource type \\"$sub\\"" >&2; exit 1 ;;',
  '    esac',
  '    ;;',
  '  logs)',
  '    i=1',
  '    while [ $i -le 4 ]; do',
  '      echo "$(date +%H:%M:%S) info live log line $i ns=${NS:-default} ctx=${CFG_CTX}"',
  '      if [ "$FOLLOW" = "1" ]; then sleep 0.2; fi',
  '      i=$((i+1))',
  '    done',
  '    ;;',
  '  *) echo "error: unknown command \\"$cmd\\"" >&2; exit 1 ;;',
  'esac'
].join('\n')

const canonicalLiveKubeconfig = (server: string) =>
  [
    'apiVersion: v1',
    'clusters:',
    '- cluster:',
    `    server: ${server}`,
    '  name: live-cluster',
    'contexts:',
    '- context:',
    '    cluster: live-cluster',
    '    namespace: live-demo',
    '    user: live-user',
    '  name: live/admin',
    '- context:',
    '    cluster: live-cluster',
    '    user: live-user',
    '  name: live/readonly',
    'current-context: live/readonly',
    'kind: Config',
    'preferences: {}',
    'users:',
    '- name: live-user',
    '  user:',
    '    token: live-token-not-real'
  ].join('\n')

const waitFor = async <T>(probe: () => T | undefined, timeoutMs = 10_000, intervalMs = 100): Promise<T> => {
  const startedAt = Date.now()
  for (;;) {
    const value = probe()
    if (value !== undefined) return value
    if (Date.now() - startedAt > timeoutMs) throw new Error('waitFor timed out')
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

liveDescribe('kubernetes live sandbox integration (real node-pty)', () => {
  const tempDirs: string[] = []
  const originalKubectlPath = process.env.AIOPSTERM_KUBECTL_PATH
  let kubeconfigPath = ''
  let dataEvents: KubernetesTerminalDataEvent[] = []
  let exitEvents: KubernetesTerminalExitEvent[] = []

  const terminalText = () => dataEvents.map((event) => event.data).join('')

  beforeEach(async () => {
    dataEvents = []
    exitEvents = []
    const stateDir = await mkdtemp(join(tmpdir(), 'aiopsterm-live-k8s-state-'))
    const kubectlDir = await mkdtemp(join(tmpdir(), 'aiopsterm-live-kubectl-'))
    const kubeconfigDir = await mkdtemp(join(tmpdir(), 'aiopsterm-live-kubeconfig-'))
    tempDirs.push(stateDir, kubectlDir, kubeconfigDir)
    const kubectlFile = join(kubectlDir, 'kubectl')
    await writeFile(kubectlFile, fakeKubectlScript, 'utf-8')
    await chmod(kubectlFile, 0o755)
    process.env.AIOPSTERM_KUBECTL_PATH = kubectlFile
    kubeconfigPath = join(kubeconfigDir, 'config')
    await writeFile(kubeconfigPath, canonicalLiveKubeconfig('https://live.k8s.local:6443'), { encoding: 'utf-8', mode: 0o600 })
    configureKubernetesBackendRuntime({ stateDir, useSeedData: false, defaultKubeconfigPath: null })
    __resetKubernetesCatalogForTests()
    setKubernetesTerminalEventSink((event) => {
      if ('data' in event) dataEvents.push(event)
      else exitEvents.push(event)
    })
  })

  afterEach(async () => {
    if (originalKubectlPath === undefined) delete process.env.AIOPSTERM_KUBECTL_PATH
    else process.env.AIOPSTERM_KUBECTL_PATH = originalKubectlPath
    setKubernetesTerminalEventSink(null)
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('runs the full import → connect → refresh → real PTY terminal flow', async () => {
    // 1. 导入 canonical kubeconfig 文件(kubectl 生成布局)。
    const imported = await importKubernetesKubeconfig({ requestId: 'live-import', kubeconfigPath })
    expect(imported.ok).toBe(true)
    expect(imported.data?.currentContext).toBe('live/readonly')
    expect(imported.data?.contexts).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'live/admin', server: 'https://live.k8s.local:6443', namespace: 'live-demo' })])
    )

    // 2. 从导入结果落一个集群(选非 current-context 的 live/admin,验证钉住逻辑)。
    const added = await addKubernetesCluster({
      name: 'live-cluster',
      contextName: 'live/admin',
      serverUrl: 'https://live.k8s.local:6443',
      defaultNamespace: 'live-demo',
      kubeconfigPath,
      authType: 'kubeconfig',
      sourceType: 'local'
    })
    expect(added.ok).toBe(true)
    const clusterId = added.data!.cluster!.id

    // 3. 连接探测走真实子进程(kubectl 替身校验 context 与 KUBECONFIG)。
    const connected = await connectKubernetesCluster(clusterId)
    expect(connected.ok).toBe(true)
    expect(connected.data?.cluster?.connection_status).toBe('connected')

    // 4. 资源刷新:tabwriter 宽表与含空格 RESTARTS 的真实解析。
    const refreshed = await refreshKubernetesResources({ clusterId, namespace: 'live-demo', kind: 'all' })
    expect(refreshed.ok).toBe(true)
    expect(refreshed.data?.success).toBe(true)
    const pods = refreshed.data!.resources.filter((resource) => resource.kind === 'pods')
    expect(pods).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'billing-1', restarts: 7, age: '3h1m', status: 'CrashLoopBackOff' }),
        expect.objectContaining({ name: 'api-server-0', restarts: 0 })
      ])
    )
    expect(refreshed.data!.resources.filter((resource) => resource.kind === 'nodes')).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'live-node-1', node: 'control-plane,worker' })])
    )

    // 5. 后端一次性命令(-o wide 宽表头含空格)。
    const wide = await executeKubernetesCommand({ command: 'kubectl get pods -o wide', clusterId, namespace: 'live-demo' })
    expect(wide.ok).toBe(true)
    expect(wide.data?.success).toBe(true)
    expect(wide.data?.output).toContain('NOMINATED NODE')

    // 6. 真 node-pty 终端:shell 提示符流式到达。
    const created = await createKubernetesTerminal({ clusterId, namespace: 'live-demo', cols: 120, rows: 32 })
    expect(created.ok).toBe(true)
    expect(created.data?.status).toBe('connected')
    await waitFor(() => (terminalText().includes('$') ? true : undefined), 10_000)

    // 7. 会话内 current-context 已被钉住为 live/admin(而非文件里的 live/readonly)。
    dataEvents = []
    await writeKubernetesTerminal(created.data!.sessionId, 'kubectl config current-context\n')
    await waitFor(() => (terminalText().includes('live/admin') ? true : undefined), 10_000)
    expect(terminalText()).not.toContain('live/readonly')

    // 8. 终端里跑 kubectl 表格命令(shell PATH 已注入 kubectl 替身目录)。
    dataEvents = []
    await writeKubernetesTerminal(created.data!.sessionId, 'kubectl get pods\n')
    await waitFor(() => (terminalText().includes('CrashLoopBackOff') ? true : undefined), 10_000)
    expect(terminalText()).toContain('7 (32s ago)')

    // 9. 流式 logs -f:输出分多个 data 事件陆续到达。
    dataEvents = []
    await writeKubernetesTerminal(created.data!.sessionId, 'kubectl logs -f billing-1\n')
    await waitFor(() => (terminalText().includes('live log line 4') ? true : undefined), 10_000)
    expect(dataEvents.length).toBeGreaterThan(1)
    expect(terminalText()).toContain('ctx=live/admin')

    // 10. 会话内改 context 只影响会话副本,用户真实 kubeconfig 保持不变。
    dataEvents = []
    await writeKubernetesTerminal(created.data!.sessionId, 'kubectl config use-context live/readonly\n')
    await waitFor(() => (terminalText().includes('Switched to context') ? true : undefined), 10_000)
    const kubeconfigOnDisk = await readFile(kubeconfigPath, 'utf-8')
    expect(kubeconfigOnDisk).toContain('current-context: live/readonly')
    expect(kubeconfigOnDisk).toBe(canonicalLiveKubeconfig('https://live.k8s.local:6443'))

    // 11. 关闭终端:真实 PTY 释放并广播 exit。
    const closed = await closeKubernetesTerminal(created.data!.sessionId, 0)
    expect(closed.ok).toBe(true)
    await waitFor(() => (exitEvents.some((event) => event.sessionId === created.data!.sessionId && event.reason === 'closed') ? true : undefined), 5000)

    // 12. 断开集群清理干净。
    const disconnected = await disconnectKubernetesCluster(clusterId)
    expect(disconnected.ok).toBe(true)
  }, 60_000)

  it('streams interactive shell state through the real PTY (cd/pwd/exit)', async () => {
    const added = await addKubernetesCluster({
      name: 'live-cluster',
      contextName: 'live/admin',
      serverUrl: 'https://live.k8s.local:6443',
      defaultNamespace: 'live-demo',
      kubeconfigPath,
      authType: 'kubeconfig',
      sourceType: 'local'
    })
    const clusterId = added.data!.cluster!.id
    await connectKubernetesCluster(clusterId)
    const created = await createKubernetesTerminal({ clusterId, namespace: 'live-demo' })
    expect(created.ok).toBe(true)
    await waitFor(() => (terminalText().includes('$') ? true : undefined), 10_000)

    // 真 shell 状态在写入之间保持:cd 后 pwd 反映新目录(命令模式做不到这一点)。
    dataEvents = []
    await writeKubernetesTerminal(created.data!.sessionId, 'cd /tmp && pwd\n')
    await waitFor(() => (terminalText().includes('/tmp') ? true : undefined), 10_000)

    // shell 主动 exit → 后端广播 ended,会话不可再写。
    await writeKubernetesTerminal(created.data!.sessionId, 'exit\n')
    await waitFor(
      () => (exitEvents.some((event) => event.sessionId === created.data!.sessionId && event.reason === 'closed') ? true : undefined),
      10_000
    )
    await expect(writeKubernetesTerminal(created.data!.sessionId, 'pwd\n')).resolves.toMatchObject({
      ok: false,
      errorCode: 'K8S_TERMINAL_ENDED'
    })
  }, 30_000)
})
