import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  __resetKubernetesCatalogForTests,
  addKubernetesCluster,
  cleanupKubernetesAgent,
  closeKubernetesTerminal,
  configureKubernetesBackendRuntime,
  connectKubernetesCluster,
  createKubernetesTerminal,
  executeKubernetesCommand,
  executeKubernetesResourceAction,
  getKubernetesAgentProxyConfig,
  importKubernetesKubeconfig,
  listKubernetesCatalog,
  planKubernetesResourceAction,
  refreshKubernetesResources,
  resizeKubernetesTerminal,
  saveKubernetesAgentProxyConfig,
  setKubernetesTerminalEventSink,
  syncKubernetesBastion,
  testKubernetesClusterConnection,
  writeKubernetesTerminal
} from '@shared/kubernetes'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

describe('kubernetes backend boundary', () => {
  const tempDirs: string[] = []
  const originalKubectlPath = process.env.AIOPSTERM_KUBECTL_PATH
  const originalKubernetesSeedEnv = process.env.AIOPSTERM_KUBERNETES_ENABLE_SEED

  beforeEach(async () => {
    delete process.env.AIOPSTERM_KUBERNETES_ENABLE_SEED
    const stateDir = await mkdtemp(join(tmpdir(), 'aiopsterm-k8s-state-'))
    tempDirs.push(stateDir)
    configureKubernetesBackendRuntime({ stateDir, useSeedData: true, defaultKubeconfigPath: null })
    __resetKubernetesCatalogForTests()
    setKubernetesTerminalEventSink(null)
  })

  afterEach(async () => {
    if (originalKubectlPath === undefined) delete process.env.AIOPSTERM_KUBECTL_PATH
    else process.env.AIOPSTERM_KUBECTL_PATH = originalKubectlPath
    if (originalKubernetesSeedEnv === undefined) delete process.env.AIOPSTERM_KUBERNETES_ENABLE_SEED
    else process.env.AIOPSTERM_KUBERNETES_ENABLE_SEED = originalKubernetesSeedEnv
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  const createFakeKubectl = async (scriptBody: string) => {
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-fake-kubectl-'))
    tempDirs.push(dir)
    const filePath = join(dir, 'kubectl')
    await writeFile(filePath, ['#!/bin/sh', 'set -eu', scriptBody].join('\n'), 'utf-8')
    await chmod(filePath, 0o755)
    process.env.AIOPSTERM_KUBECTL_PATH = filePath
    return filePath
  }

  const qaKubeconfigContent = [
    'apiVersion: v1',
    'kind: Config',
    'current-context: qa/dev',
    'clusters:',
    '- name: qa-cluster',
    '  cluster:',
    '    server: https://qa.k8s.local:6443',
    'contexts:',
    '- name: qa/dev',
    '  context:',
    '    cluster: qa-cluster',
    '    namespace: qa'
  ].join('\n')

  it('does not infer Kubernetes seed mode from NODE_ENV test', async () => {
    configureKubernetesBackendRuntime({ stateDir: tempDirs[0], defaultKubeconfigPath: null })
    __resetKubernetesCatalogForTests()

    const catalog = await listKubernetesCatalog()

    expect(process.env.NODE_ENV).toBe('test')
    expect(catalog.ok).toBe(true)
    expect(catalog.data?.clusters).toEqual([])
    expect(catalog.data?.contexts).toEqual([])
    expect(catalog.data?.bastions).toEqual([])
  })

  it('loads Kubernetes development seeds only when the seed environment switch is enabled', async () => {
    process.env.AIOPSTERM_KUBERNETES_ENABLE_SEED = '1'
    configureKubernetesBackendRuntime({ stateDir: tempDirs[0], defaultKubeconfigPath: null })
    __resetKubernetesCatalogForTests()

    const catalog = await listKubernetesCatalog()

    expect(catalog.ok).toBe(true)
    expect(catalog.data?.clusters.map((cluster) => cluster.id)).toEqual(expect.arrayContaining(['k8s-1', 'k8s-2']))
    expect(catalog.data?.contexts.map((context) => context.name)).toEqual(expect.arrayContaining(['prod/admin', 'staging/devops']))
    expect(catalog.data?.bastions.map((bastion) => bastion.uuid)).toEqual(expect.arrayContaining(['org-1']))
  })

  it('creates backend-owned terminal session records before renderer output handling', async () => {
    const created = await createKubernetesTerminal({
      clusterId: 'k8s-1',
      namespace: 'ops',
      cols: 120,
      rows: 32
    })

    expect(created.ok).toBe(true)
    expect(created.data).toMatchObject({
      id: expect.stringMatching(/^k8s-tab-/),
      sessionId: expect.stringMatching(/^k8s-session-/),
      clusterId: 'k8s-1',
      name: 'prod-cluster',
      namespace: 'ops',
      status: 'connected',
      cols: 120,
      rows: 32,
      createdAt: '刚刚',
      updatedAt: '刚刚'
    })
    expect(created.data?.output).toContain('kubectl context: prod/admin')

    const resized = await resizeKubernetesTerminal(created.data!.sessionId, 500, 2)
    expect(resized.ok).toBe(true)
    expect(resized.data).toMatchObject({ sessionId: created.data!.sessionId, cols: 240, rows: 8 })

    const closed = await closeKubernetesTerminal(created.data!.sessionId, 0)
    expect(closed.ok).toBe(true)
    expect(closed.data).toMatchObject({ sessionId: created.data!.sessionId, status: 'ended', exitCode: 0 })
    await expect(resizeKubernetesTerminal(created.data!.sessionId, 80, 24)).resolves.toMatchObject({
      ok: false,
      errorCode: 'K8S_TERMINAL_NOT_FOUND'
    })
  })

  it('writes Kubernetes terminal commands through backend-owned session events', async () => {
    const events: unknown[] = []
    setKubernetesTerminalEventSink((event) => events.push(event))
    const created = await createKubernetesTerminal({
      clusterId: 'k8s-1',
      namespace: 'ops'
    })
    expect(created.ok).toBe(true)

    const result = await writeKubernetesTerminal(created.data!.sessionId, 'kubectl get pods -n ops\n')

    expect(result.ok).toBe(true)
    expect(result.data).toEqual(
      expect.objectContaining({
        id: created.data!.id,
        sessionId: created.data!.sessionId,
        bytes: Buffer.byteLength('kubectl get pods -n ops\n', 'utf-8'),
        command: 'kubectl get pods -n ops',
        success: true,
        error: '',
        updatedAt: '刚刚'
      })
    )
    expect(result.data?.terminalOutput).toContain('[aiopsterm kubectl] kubectl get pods -n ops')
    expect(result.data?.terminalOutput).toContain('billing-worker-7f9d6f9dd9-rx8mm')
    expect(events).toEqual([
      expect.objectContaining({
        id: created.data!.id,
        sessionId: created.data!.sessionId,
        clusterId: 'k8s-1',
        data: expect.stringContaining('[aiopsterm kubectl] kubectl get pods -n ops'),
        command: 'kubectl get pods -n ops',
        output: expect.stringContaining('billing-worker-7f9d6f9dd9-rx8mm'),
        success: true,
        error: '',
        emittedAt: '刚刚'
      })
    ])

    await expect(writeKubernetesTerminal(created.data!.sessionId, '   \n')).resolves.toMatchObject({
      ok: false,
      errorCode: 'K8S_EMPTY_COMMAND'
    })
    const closed = await closeKubernetesTerminal(created.data!.sessionId, 0)
    expect(closed.ok).toBe(true)
    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        id: created.data!.id,
        sessionId: created.data!.sessionId,
        clusterId: 'k8s-1',
        exitCode: 0,
        reason: 'closed',
        emittedAt: '刚刚'
      })
    )
    await expect(writeKubernetesTerminal(created.data!.sessionId, 'kubectl get ns\n')).resolves.toMatchObject({
      ok: false,
      errorCode: 'K8S_TERMINAL_NOT_FOUND'
    })
  })

  it('renders all-namespace pod listings from backend seed data', async () => {
    const result = await executeKubernetesCommand({
      command: 'kubectl get pods -A',
      clusterId: 'k8s-1',
      clusterName: 'prod-cluster',
      contextName: 'prod/admin',
      namespace: 'default'
    })

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      command: 'kubectl get pods -A',
      success: true,
      error: ''
    })
    expect(result.data).toEqual(
      expect.objectContaining({
        runId: expect.stringMatching(/^k8s-run-/),
        clusterId: 'k8s-1',
        contextName: 'prod/admin',
        namespace: 'default',
        source: 'terminal',
        startedAt: '刚刚'
      })
    )
    expect(result.data?.output).toContain('default\tapi-gateway-6d8c9bb7f6-l6j2m')
    expect(result.data?.output).toContain('ops\tbilling-worker-7f9d6f9dd9-rx8mm')
    expect(result.data?.terminalOutput).toContain('[aiopsterm kubectl] kubectl get pods -A')
    expect(result.data?.terminalOutput).toContain('ops\tbilling-worker-7f9d6f9dd9-rx8mm')
    expect(result.data?.durationMs).toBeGreaterThan(0)
  })

  it('fails closed for unsupported backend seed kubectl commands', async () => {
    const result = await executeKubernetesCommand({
      command: 'kubectl get events -A --sort-by=.lastTimestamp',
      clusterId: 'k8s-1',
      clusterName: 'prod-cluster',
      contextName: 'prod/admin',
      namespace: 'default',
      source: 'agent'
    })

    expect(result.ok).toBe(true)
    expect(result.data).toEqual(
      expect.objectContaining({
        command: 'kubectl get events -A --sort-by=.lastTimestamp',
        success: false,
        clusterId: 'k8s-1',
        contextName: 'prod/admin',
        namespace: 'default',
        source: 'agent'
      })
    )
    expect(result.data?.error).toBe(
      'Kubernetes development seed data cannot execute "kubectl get events -A --sort-by=.lastTimestamp". Select a kubeconfig-backed cluster to run arbitrary kubectl commands.'
    )
    expect(result.data?.output).toBe(result.data?.error)
    expect(result.data?.terminalOutput).toContain('[aiopsterm kubectl] kubectl get events -A --sort-by=.lastTimestamp')
    expect(result.data?.terminalOutput).toContain('Select a kubeconfig-backed cluster')
  })

  it('fails closed for unsupported backend seed resource types without fabricating output', async () => {
    const result = await executeKubernetesCommand({
      command: 'kubectl get configmaps -n ops',
      clusterId: 'k8s-1',
      namespace: 'ops'
    })

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      command: 'kubectl get configmaps -n ops',
      success: false,
      error: 'Kubernetes development seed data cannot execute "kubectl get configmaps -n ops". Select a kubeconfig-backed cluster to run arbitrary kubectl commands.'
    })
    expect(result.data?.output).toBe(result.data?.error)
    expect(result.data?.terminalOutput).not.toContain('command executed through aiopsterm Kubernetes backend')
  })

  it('returns NotFound for missing supported backend seed get resources', async () => {
    const result = await executeKubernetesCommand({
      command: 'kubectl get pod missing -n ops -o wide',
      clusterId: 'k8s-1',
      namespace: 'ops'
    })

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      command: 'kubectl get pod missing -n ops -o wide',
      success: false,
      error: 'Error from server (NotFound): pods "missing" not found'
    })
    expect(result.data?.output).toBe('Error from server (NotFound): pods "missing" not found')
  })

  it('executes kubectl through the backend for explicit kubeconfig clusters', async () => {
    await createFakeKubectl(
      [
        'echo "fake kubectl invoked"',
        'echo "KUBECONFIG_EXISTS=$([ -f "$KUBECONFIG" ] && echo yes || echo no)"',
        'echo "KUBECONFIG_CONTEXT=$(grep -m1 current-context "$KUBECONFIG" | sed "s/.*: //")"',
        'echo "ARGS=$*"'
      ].join('\n')
    )
    const added = await addKubernetesCluster({
      name: 'qa-cluster',
      contextName: 'qa/dev',
      serverUrl: 'https://qa.k8s.local:6443',
      defaultNamespace: 'qa',
      kubeconfigContent: qaKubeconfigContent,
      authType: 'kubeconfig',
      sourceType: 'local'
    })
    expect(added.ok).toBe(true)

    const result = await executeKubernetesCommand({
      command: 'kubectl get pods',
      clusterId: added.data!.cluster!.id,
      namespace: 'qa',
      source: 'terminal'
    })

    expect(result.ok).toBe(true)
    expect(result.data).toEqual(
      expect.objectContaining({
        command: 'kubectl get pods',
        success: true,
        error: '',
        contextName: 'qa/dev',
        namespace: 'qa',
        source: 'terminal'
      })
    )
    expect(result.data?.output).toContain('fake kubectl invoked')
    expect(result.data?.output).toContain('KUBECONFIG_EXISTS=yes')
    expect(result.data?.output).toContain('KUBECONFIG_CONTEXT=qa/dev')
    expect(result.data?.output).toContain('ARGS=get pods --context=qa/dev --namespace=qa')
    expect(result.data?.terminalOutput).toContain('[aiopsterm kubectl] kubectl get pods')
    expect(result.data?.terminalOutput).toContain('fake kubectl invoked')
  })

  it('persists Kubernetes Agent proxy config and applies it to local kubectl runs', async () => {
    await createFakeKubectl(
      [
        'echo "HTTP_PROXY=$HTTP_PROXY"',
        'echo "HTTPS_PROXY=$HTTPS_PROXY"',
        'echo "ALL_PROXY=$ALL_PROXY"',
        'echo "ARGS=$*"'
      ].join('\n')
    )
    const saved = await saveKubernetesAgentProxyConfig({
      enabled: true,
      type: 'SOCKS5',
      host: 'proxy.internal',
      port: 18080,
      enableProxyIdentity: true,
      username: 'ops user',
      password: 'p@ss word'
    })

    expect(saved.ok).toBe(true)
    expect(saved.data?.proxyConfig).toEqual(
      expect.objectContaining({
        enabled: true,
        type: 'SOCKS5',
        host: 'proxy.internal',
        port: 18080,
        username: 'ops user',
        password: 'p@ss word',
        updatedAt: '刚刚'
      })
    )
    const persisted = JSON.parse(await readFile(join(tempDirs[0], 'agent-proxy.json'), 'utf-8'))
    expect(persisted).toMatchObject({ enabled: true, type: 'SOCKS5', host: 'proxy.internal', port: 18080 })

    configureKubernetesBackendRuntime({ stateDir: tempDirs[0], defaultKubeconfigPath: null })
    await expect(getKubernetesAgentProxyConfig()).resolves.toMatchObject({
      ok: true,
      data: {
        proxyConfig: expect.objectContaining({ enabled: true, host: 'proxy.internal', port: 18080 })
      }
    })
    await expect(listKubernetesCatalog()).resolves.toMatchObject({
      ok: true,
      data: {
        agentProxyConfig: expect.objectContaining({ enabled: true, host: 'proxy.internal', port: 18080 })
      }
    })

    const added = await addKubernetesCluster({
      name: 'qa-cluster',
      contextName: 'qa/dev',
      serverUrl: 'https://qa.k8s.local:6443',
      defaultNamespace: 'qa',
      kubeconfigContent: qaKubeconfigContent,
      authType: 'kubeconfig',
      sourceType: 'local'
    })
    const result = await executeKubernetesCommand({
      command: 'kubectl get pods',
      clusterId: added.data!.cluster!.id,
      namespace: 'qa'
    })

    expect(result.ok).toBe(true)
    expect(result.data?.output).toContain('HTTP_PROXY=socks5://ops%20user:p%40ss%20word@proxy.internal:18080')
    expect(result.data?.output).toContain('HTTPS_PROXY=socks5://ops%20user:p%40ss%20word@proxy.internal:18080')
    expect(result.data?.output).toContain('ALL_PROXY=socks5://ops%20user:p%40ss%20word@proxy.internal:18080')
  })

  it('rejects invalid Kubernetes Agent proxy config at the backend boundary', async () => {
    await expect(saveKubernetesAgentProxyConfig({ enabled: true, host: '' })).resolves.toMatchObject({
      ok: false,
      errorCode: 'K8S_AGENT_PROXY_HOST_REQUIRED',
      errorMessage: 'Kubernetes Agent proxy host is required.'
    })
    await expect(
      saveKubernetesAgentProxyConfig({
        enabled: true,
        host: 'proxy.internal',
        enableProxyIdentity: true,
        username: 'ops',
        password: ''
      })
    ).resolves.toMatchObject({
      ok: false,
      errorCode: 'K8S_AGENT_PROXY_CREDENTIALS_REQUIRED',
      errorMessage: 'Proxy authentication requires username and password.'
    })
  })

  it('refreshes explicit kubeconfig cluster resources from kubectl tables', async () => {
    await createFakeKubectl(
      [
        'case "$1:$2" in',
        '  get:namespaces)',
        '    echo "NAME STATUS AGE"',
        '    echo "qa Active 12d"',
        '    echo "ops Active 3d"',
        '    ;;',
        '  get:pods)',
        '    echo "NAMESPACE NAME READY STATUS RESTARTS AGE"',
        '    echo "qa qa-api-5d6f7c8d9b-abcde 1/1 Running 0 4h"',
        '    echo "ops ops-job-0 0/1 Pending 1 8m"',
        '    ;;',
        '  get:deployments)',
        '    echo "NAMESPACE NAME READY UP-TO-DATE AVAILABLE AGE"',
        '    echo "qa qa-api 3/3 3 3 12d"',
        '    ;;',
        '  get:services)',
        '    echo "NAMESPACE NAME TYPE CLUSTER-IP EXTERNAL-IP PORT(S) AGE"',
        '    echo "qa qa-api ClusterIP 10.44.0.12 <none> 8080/TCP 12d"',
        '    ;;',
        '  get:nodes)',
        '    echo "NAME STATUS ROLES AGE VERSION"',
        '    echo "qa-node-01 Ready worker 30d v1.29.4"',
        '    ;;',
        '  *)',
        '    echo "unexpected args: $*" >&2',
        '    exit 17',
        '    ;;',
        'esac'
      ].join('\n')
    )
    const added = await addKubernetesCluster({
      name: 'qa-cluster',
      contextName: 'qa/dev',
      serverUrl: 'https://qa.k8s.local:6443',
      defaultNamespace: 'qa',
      kubeconfigContent: qaKubeconfigContent,
      authType: 'kubeconfig',
      sourceType: 'local'
    })
    const clusterId = added.data!.cluster!.id

    const result = await refreshKubernetesResources({
      clusterId,
      namespace: 'all',
      kind: 'all'
    })

    expect(result.ok).toBe(true)
    expect(result.data).toEqual(
      expect.objectContaining({
        runId: expect.stringMatching(/^k8s-run-/),
        refreshedClusterId: clusterId,
        refreshedKind: 'all',
        clusterId,
        contextName: 'qa/dev',
        namespace: 'all',
        success: true,
        error: '',
        source: 'resource',
        refreshedResources: 5,
        refreshedNamespaces: 2
      })
    )
    expect(result.data?.command).toContain('kubectl get namespaces')
    expect(result.data?.command).toContain('kubectl get pods --all-namespaces')
    expect(result.data?.output).toContain('qa-api-5d6f7c8d9b-abcde')
    expect(result.data?.message).toContain('qa-cluster')

    const catalog = await listKubernetesCatalog()
    expect(catalog.ok).toBe(true)
    expect(catalog.data?.namespaces.filter((namespace) => namespace.clusterId === clusterId)).toEqual([
      { id: expect.any(String), clusterId, name: 'qa', status: 'Active', age: '12d' },
      { id: expect.any(String), clusterId, name: 'ops', status: 'Active', age: '3d' }
    ])
    expect(catalog.data?.resources.filter((resource) => resource.clusterId === clusterId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'pods', namespace: 'qa', name: 'qa-api-5d6f7c8d9b-abcde', ready: '1/1', status: 'Running', restarts: 0 }),
        expect.objectContaining({ kind: 'pods', namespace: 'ops', name: 'ops-job-0', ready: '0/1', status: 'Pending', restarts: 1 }),
        expect.objectContaining({ kind: 'deployments', namespace: 'qa', name: 'qa-api', ready: '3/3', status: 'Available' }),
        expect.objectContaining({ kind: 'services', namespace: 'qa', name: 'qa-api', status: 'ClusterIP', ready: '10.44.0.12', ports: '8080/TCP' }),
        expect.objectContaining({ kind: 'nodes', namespace: 'cluster', name: 'qa-node-01', status: 'Ready', ready: 'v1.29.4', node: 'worker' })
      ])
    )
    expect(catalog.data?.resources.some((resource) => resource.clusterId === clusterId && resource.name === 'api-gateway-6d8c9bb7f6-l6j2m')).toBe(false)
  })

  it('fails closed for non-runnable Kubernetes resource refreshes', async () => {
    const before = await listKubernetesCatalog()
    const beforeJumpResources = before.data?.resources.filter((resource) => resource.clusterId === 'k8s-3') || []

    const result = await refreshKubernetesResources({
      clusterId: 'k8s-3',
      namespace: 'ops',
      kind: 'pods'
    })

    expect(result).toEqual({
      ok: false,
      errorCode: 'K8S_JUMPSERVER_STREAM_UNAVAILABLE',
      errorMessage: 'JumpServer Kubernetes command streaming is not connected in this backend yet.'
    })

    const after = await listKubernetesCatalog()
    expect(after.data?.resources.filter((resource) => resource.clusterId === 'k8s-3')).toEqual(beforeJumpResources)
  })

  it('rejects terminal and resource operations for non-runnable Kubernetes clusters', async () => {
    await expect(connectKubernetesCluster('k8s-3')).resolves.toMatchObject({
      ok: true,
      data: {
        cluster: expect.objectContaining({
          id: 'k8s-3',
          connection_status: 'connected'
        })
      }
    })
    const terminal = await createKubernetesTerminal({ clusterId: 'k8s-3', namespace: 'ops' })
    expect(terminal).toMatchObject({
      ok: true,
      data: expect.objectContaining({
        clusterId: 'k8s-3',
        status: 'connected'
      })
    })
    const events: unknown[] = []
    setKubernetesTerminalEventSink((event) => events.push(event))

    const command = await executeKubernetesCommand({
      command: 'kubectl get pods -n ops',
      clusterId: 'k8s-3',
      namespace: 'ops',
      source: 'terminal'
    })
    expect(command).toEqual({
      ok: false,
      errorCode: 'K8S_JUMPSERVER_STREAM_UNAVAILABLE',
      errorMessage: 'JumpServer Kubernetes command streaming is not connected in this backend yet.'
    })

    const write = await writeKubernetesTerminal(terminal.data!.sessionId, 'kubectl get pods -n ops\n')
    expect(write).toEqual({
      ok: false,
      errorCode: 'K8S_JUMPSERVER_STREAM_UNAVAILABLE',
      errorMessage: 'JumpServer Kubernetes command streaming is not connected in this backend yet.'
    })
    expect(events).toEqual([])

    const action = await executeKubernetesResourceAction({
      resourceId: 'k8s-pod-jump-ops',
      action: 'describe'
    })
    expect(action).toEqual({
      ok: false,
      errorCode: 'K8S_JUMPSERVER_STREAM_UNAVAILABLE',
      errorMessage: 'JumpServer Kubernetes command streaming is not connected in this backend yet.'
    })

    const agentRun = await executeKubernetesCommand({
      command: 'kubectl get pods -n ops',
      clusterId: 'k8s-3',
      namespace: 'ops',
      source: 'agent'
    })
    expect(agentRun).toMatchObject({
      ok: true,
      data: {
        command: 'kubectl get pods -n ops',
        success: false,
        error: 'JumpServer Kubernetes command streaming is not connected in this backend yet.',
        clusterId: 'k8s-3',
        contextName: 'jumpserver/prod',
        namespace: 'ops',
        source: 'agent'
      }
    })
  })

  it('returns backend-owned failure metadata for nonzero kubectl exits', async () => {
    await createFakeKubectl(
      [
        'echo "stdout before failure"',
        'echo "fake kubectl failed" >&2',
        'exit 23'
      ].join('\n')
    )
    const added = await addKubernetesCluster({
      name: 'qa-cluster',
      contextName: 'qa/dev',
      serverUrl: 'https://qa.k8s.local:6443',
      defaultNamespace: 'qa',
      kubeconfigContent: qaKubeconfigContent,
      authType: 'kubeconfig',
      sourceType: 'local'
    })
    expect(added.ok).toBe(true)

    const result = await executeKubernetesCommand({
      command: 'kubectl get pods',
      clusterId: added.data!.cluster!.id,
      namespace: 'qa',
      source: 'agent'
    })

    expect(result.ok).toBe(true)
    expect(result.data).toEqual(
      expect.objectContaining({
        command: 'kubectl get pods',
        success: false,
        error: 'fake kubectl failed',
        contextName: 'qa/dev',
        namespace: 'qa',
        source: 'agent'
      })
    )
    expect(result.data?.output).toContain('stdout before failure')
    expect(result.data?.output).toContain('fake kubectl failed')
    expect(result.data?.terminalOutput).toContain('[aiopsterm kubectl] kubectl get pods')
    expect(result.data?.terminalOutput).toContain('fake kubectl failed')
  })

  it('tests add-cluster context validity through backend boundary', async () => {
    await expect(testKubernetesClusterConnection({ contextName: 'prod/admin' })).resolves.toMatchObject({
      ok: true,
      data: {
        success: true,
        isValid: true,
        contextName: 'prod/admin',
        serverUrl: 'https://prod.k8s.local:6443',
        message: '连接测试成功'
      }
    })

    await createFakeKubectl(
      [
        'echo "NAME STATUS AGE"',
        'echo "qa Active 12d"',
        'echo "PROBE_ARGS=$*"'
      ].join('\n')
    )
    const fromContent = await testKubernetesClusterConnection({
      contextName: 'qa/dev',
      serverUrl: 'https://qa.k8s.local:6443',
      kubeconfigContent: qaKubeconfigContent
    })
    expect(fromContent).toMatchObject({
      ok: true,
      data: {
        success: true,
        isValid: true,
        contextName: 'qa/dev',
        serverUrl: 'https://qa.k8s.local:6443',
        command: 'kubectl get namespaces',
        message: '连接测试成功'
      }
    })
    expect(fromContent.data?.output).toContain('PROBE_ARGS=get namespaces --context=qa/dev')
    expect(fromContent.data?.durationMs).toBeGreaterThan(0)

    await expect(testKubernetesClusterConnection({ contextName: 'qa/dev', serverUrl: 'https://wrong.k8s.local:6443', kubeconfigContent: qaKubeconfigContent })).resolves.toMatchObject({
      ok: false,
      errorCode: 'K8S_TEST_SERVER_MISMATCH'
    })
    await expect(testKubernetesClusterConnection({ contextName: '' })).resolves.toMatchObject({
      ok: false,
      errorCode: 'K8S_TEST_CONTEXT_REQUIRED'
    })
  })

  it('returns a failed add-cluster test result when kubectl cannot reach the cluster', async () => {
    await createFakeKubectl(
      [
        'echo "dial tcp 10.0.0.1:6443: i/o timeout" >&2',
        'exit 28'
      ].join('\n')
    )

    const result = await testKubernetesClusterConnection({
      contextName: 'qa/dev',
      serverUrl: 'https://qa.k8s.local:6443',
      kubeconfigContent: qaKubeconfigContent
    })

    expect(result).toMatchObject({
      ok: true,
      data: {
        success: false,
        isValid: false,
        contextName: 'qa/dev',
        serverUrl: 'https://qa.k8s.local:6443',
        command: 'kubectl get namespaces',
        error: 'dial tcp 10.0.0.1:6443: i/o timeout'
      }
    })
    expect(result.data?.message).toContain('dial tcp')
    expect(result.data?.output).toContain('dial tcp')
  })

  it('rejects placeholder and non-runnable local cluster saves before catalog mutation', async () => {
    const before = await listKubernetesCatalog()
    const beforeClusterIds = before.data?.clusters.map((cluster) => cluster.id) || []

    await expect(
      addKubernetesCluster({
        name: 'new-cluster',
        contextName: 'new/context',
        serverUrl: 'https://new.k8s.local:6443',
        defaultNamespace: 'default',
        kubeconfigContent: qaKubeconfigContent,
        authType: 'kubeconfig',
        sourceType: 'local'
      })
    ).resolves.toMatchObject({
      ok: false,
      errorCode: 'K8S_PLACEHOLDER_CLUSTER_REJECTED'
    })

    await expect(
      addKubernetesCluster({
        name: 'qa-cluster',
        contextName: 'qa/dev',
        serverUrl: 'https://qa.k8s.local:6443',
        defaultNamespace: 'qa',
        authType: 'kubeconfig',
        sourceType: 'local'
      })
    ).resolves.toMatchObject({
      ok: false,
      errorCode: 'K8S_KUBECONFIG_REQUIRED'
    })

    const after = await listKubernetesCatalog()
    expect(after.data?.clusters.map((cluster) => cluster.id)).toEqual(beforeClusterIds)
  })

  it('imports kubeconfig contexts behind the backend boundary', async () => {
    const kubeconfigContent = [
      'apiVersion: v1',
      'kind: Config',
      'current-context: qa/dev',
      'clusters:',
      '- name: qa-cluster',
      '  cluster:',
      '    server: https://qa.k8s.local:6443',
      'contexts:',
      '- name: qa/dev',
      '  context:',
      '    cluster: qa-cluster',
      '    namespace: qa'
    ].join('\n')
    const fromContent = await importKubernetesKubeconfig({ requestId: 'kubeconfig-import-content-test', kubeconfigContent })
    expect(fromContent).toMatchObject({
      ok: true,
      data: {
        requestId: 'kubeconfig-import-content-test',
        currentContext: 'qa/dev',
        kubeconfigContent,
        contexts: [{ name: 'qa/dev', cluster: 'qa-cluster', server: 'https://qa.k8s.local:6443', namespace: 'qa' }]
      }
    })

    await expect(testKubernetesClusterConnection({ contextName: 'qa/dev' })).resolves.toMatchObject({
      ok: true,
      data: { serverUrl: 'https://qa.k8s.local:6443' }
    })

    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-kubeconfig-'))
    const filePath = join(dir, 'config.yaml')
    await writeFile(filePath, kubeconfigContent, 'utf-8')
    await expect(importKubernetesKubeconfig({ requestId: 'kubeconfig-import-file-test', kubeconfigPath: filePath })).resolves.toMatchObject({
      ok: true,
      data: {
        requestId: 'kubeconfig-import-file-test',
        kubeconfigPath: filePath,
        contexts: [{ name: 'qa/dev', cluster: 'qa-cluster', server: 'https://qa.k8s.local:6443', namespace: 'qa' }]
      }
    })

    await expect(importKubernetesKubeconfig({})).resolves.toMatchObject({
      ok: false,
      errorCode: 'K8S_KUBECONFIG_REQUIRED'
    })
    await expect(importKubernetesKubeconfig({ kubeconfigContent: 'apiVersion: v1\nkind: Config\n' })).resolves.toMatchObject({
      ok: false,
      errorCode: 'K8S_KUBECONFIG_CONTEXTS_EMPTY'
    })
  })

  it('does not expose development seed clusters in non-seed runtime catalogs', async () => {
    configureKubernetesBackendRuntime({ stateDir: tempDirs[0], useSeedData: false, defaultKubeconfigPath: null })
    __resetKubernetesCatalogForTests()

    const catalog = await listKubernetesCatalog()

    expect(catalog.ok).toBe(true)
    expect(catalog.data?.clusters).toEqual([])
    expect(catalog.data?.resources).toEqual([])
    expect(catalog.data?.bastions).toEqual([])
    expect(catalog.data?.clusters.some((cluster) => cluster.id === 'k8s-1' || cluster.id === 'k8s-2' || cluster.id === 'k8s-3')).toBe(false)
  })

  it('discovers kubeconfig-backed local clusters in non-seed runtime without renderer fixtures', async () => {
    await createFakeKubectl(
      [
        'case "$1:$2" in',
        '  get:namespaces)',
        '    echo "NAME STATUS AGE"',
        '    echo "qa Active 12d"',
        '    echo "DISCOVERED_ARGS=$*"',
        '    ;;',
        '  *)',
        '    echo "unexpected args: $*" >&2',
        '    exit 17',
        '    ;;',
        'esac'
      ].join('\n')
    )
    const kubeconfigDir = await mkdtemp(join(tmpdir(), 'aiopsterm-kubeconfig-discovery-'))
    tempDirs.push(kubeconfigDir)
    const kubeconfigPath = join(kubeconfigDir, 'config')
    await writeFile(kubeconfigPath, qaKubeconfigContent, 'utf-8')
    configureKubernetesBackendRuntime({ stateDir: tempDirs[0], useSeedData: false, defaultKubeconfigPath: kubeconfigPath })
    __resetKubernetesCatalogForTests()

    const catalog = await listKubernetesCatalog()

    expect(catalog.ok).toBe(true)
    expect(catalog.data?.contexts).toEqual([
      { name: 'qa/dev', cluster: 'qa-cluster', server: 'https://qa.k8s.local:6443', namespace: 'qa', isActive: true }
    ])
    expect(catalog.data?.clusters).toEqual([
      expect.objectContaining({
        id: 'k8s-local-qa-dev',
        name: 'qa-cluster',
        kubeconfig_path: kubeconfigPath,
        kubeconfig_content: null,
        context_name: 'qa/dev',
        server_url: 'https://qa.k8s.local:6443',
        auth_type: 'kubeconfig',
        source_type: 'local',
        connection_status: 'disconnected',
        default_namespace: 'qa'
      })
    ])
    expect(catalog.data?.importContexts).toEqual([
      { name: 'qa/dev', cluster: 'qa-cluster', server: 'https://qa.k8s.local:6443', namespace: 'qa' }
    ])

    const connected = await connectKubernetesCluster('k8s-local-qa-dev')

    expect(connected).toMatchObject({
      ok: true,
      data: {
        cluster: expect.objectContaining({
          id: 'k8s-local-qa-dev',
          connection_status: 'connected',
          is_active: 1
        })
      }
    })
    const testResult = await testKubernetesClusterConnection({ contextName: 'qa/dev' })
    expect(testResult).toMatchObject({
      ok: true,
      data: {
        success: true,
        isValid: true,
        contextName: 'qa/dev',
        serverUrl: 'https://qa.k8s.local:6443',
        command: 'kubectl get namespaces'
      }
    })
    expect(testResult.data?.output).toContain('DISCOVERED_ARGS=get namespaces --context=qa/dev')
  })

  it('strips unchanged legacy seed Kubernetes catalog rows in non-seed runtime state', async () => {
    const statePath = join(tempDirs[0], 'catalog.json')
    await writeFile(
      statePath,
      JSON.stringify(
        {
          version: 1,
          contexts: [
            {
              name: 'prod/admin',
              cluster: 'prod-cluster',
              namespace: 'default',
              server: 'https://prod.k8s.local:6443',
              isActive: true
            }
          ],
          clusters: [
            {
              id: 'k8s-1',
              name: 'prod-cluster',
              kubeconfig_path: '~/.kube/config',
              kubeconfig_content: null,
              context_name: 'prod/admin',
              server_url: 'https://prod.k8s.local:6443',
              auth_type: 'kubeconfig',
              is_active: 1,
              connection_status: 'connected',
              auto_connect: 1,
              default_namespace: 'default',
              created_at: '2026-05-28 10:20',
              updated_at: '2026-06-03 09:30',
              source_type: 'local',
              bastion_uuid: null,
              bastion_asset_address: null,
              bastion_asset_name: null,
              bastion_asset_id_last: null
            }
          ],
          bastions: [{ uuid: 'org-1', label: 'jumpserver-org', ip: 'bastion.internal' }],
          namespaces: [{ id: 'k8s-ns-prod-default', clusterId: 'k8s-1', name: 'default', status: 'Active', age: '92d' }],
          resources: [
            {
              id: 'k8s-pod-api-1',
              clusterId: 'k8s-1',
              kind: 'pods',
              name: 'api-gateway-6d8c9bb7f6-l6j2m',
              namespace: 'default',
              status: 'Running',
              ready: '2/2',
              age: '3d',
              detail: 'REST ingress workload serving public API traffic.',
              node: 'prod-node-01',
              image: 'registry.internal/api-gateway:2.8.4',
              restarts: 0
            }
          ],
          importContexts: [{ name: 'prod/admin', cluster: 'prod-cluster', server: 'https://prod.k8s.local:6443', namespace: 'default' }]
        },
        null,
        2
      ),
      'utf-8'
    )

    configureKubernetesBackendRuntime({ stateDir: tempDirs[0], useSeedData: false, defaultKubeconfigPath: null })
    __resetKubernetesCatalogForTests()
    const catalog = await listKubernetesCatalog()

    expect(catalog.ok).toBe(true)
    expect(catalog.data).toMatchObject({
      contexts: [],
      clusters: [],
      bastions: [],
      namespaces: [],
      resources: [],
      importContexts: []
    })
    expect(JSON.parse(await readFile(statePath, 'utf-8'))).toMatchObject({
      contexts: [],
      clusters: [],
      bastions: [],
      namespaces: [],
      resources: [],
      importContexts: []
    })
  })

  it('preserves user-edited seed-derived Kubernetes rows without falling back to seed command output', async () => {
    const statePath = join(tempDirs[0], 'catalog.json')
    await writeFile(
      statePath,
      JSON.stringify(
        {
          version: 1,
          contexts: [
            {
              name: 'prod/admin',
              cluster: 'prod-cluster',
              namespace: 'default',
              server: 'https://prod.k8s.local:6443',
              isActive: true
            },
            {
              name: 'staging/devops',
              cluster: 'staging-cluster',
              namespace: 'staging',
              server: 'https://staging.k8s.local:6443',
              isActive: false
            }
          ],
          clusters: [
            {
              id: 'k8s-1',
              name: 'prod-owned',
              kubeconfig_path: null,
              kubeconfig_content: null,
              context_name: 'prod/admin',
              server_url: 'https://prod.k8s.local:6443',
              auth_type: 'kubeconfig',
              is_active: 1,
              connection_status: 'connected',
              auto_connect: 1,
              default_namespace: 'ops',
              created_at: '2026-05-28 10:20',
              updated_at: '2026-06-10 09:30',
              source_type: 'local',
              bastion_uuid: null,
              bastion_asset_address: null,
              bastion_asset_name: null,
              bastion_asset_id_last: null
            },
            {
              id: 'k8s-2',
              name: 'staging-cluster',
              kubeconfig_path: '~/.kube/staging',
              kubeconfig_content: null,
              context_name: 'staging/devops',
              server_url: 'https://staging.k8s.local:6443',
              auth_type: 'kubeconfig',
              is_active: 0,
              connection_status: 'disconnected',
              auto_connect: 0,
              default_namespace: 'staging',
              created_at: '2026-05-28 11:20',
              updated_at: '2026-06-01 12:10',
              source_type: 'local',
              bastion_uuid: null,
              bastion_asset_address: null,
              bastion_asset_name: null,
              bastion_asset_id_last: null
            },
            {
              id: 'k8s-3',
              name: 'jumpserver-owned',
              kubeconfig_path: null,
              kubeconfig_content: null,
              context_name: 'jumpserver/prod',
              server_url: '172.16.20.14:6443',
              auth_type: 'jumpserver',
              is_active: 0,
              connection_status: 'error',
              auto_connect: 0,
              default_namespace: 'ops',
              created_at: '2026-05-30 15:00',
              updated_at: '2026-06-10 18:10',
              source_type: 'jumpserver',
              bastion_uuid: 'org-1',
              bastion_asset_address: '172.16.20.14',
              bastion_asset_name: 'jumpserver-prod',
              bastion_asset_id_last: 1014
            }
          ],
          bastions: [
            { uuid: 'org-1', label: 'jumpserver-org', ip: 'bastion.internal' },
            { uuid: 'org-prod', label: 'prod-bastion', ip: '10.24.8.12' }
          ],
          namespaces: [
            { id: 'k8s-ns-prod-default', clusterId: 'k8s-1', name: 'default', status: 'Active', age: '92d' },
            { id: 'k8s-ns-prod-ops', clusterId: 'k8s-1', name: 'ops-owned', status: 'Active', age: '1d' }
          ],
          resources: [
            {
              id: 'k8s-pod-api-1',
              clusterId: 'k8s-1',
              kind: 'pods',
              name: 'api-gateway-6d8c9bb7f6-l6j2m',
              namespace: 'default',
              status: 'Investigating',
              ready: '2/2',
              age: '3d',
              detail: 'User-edited workload note.',
              node: 'prod-node-01',
              image: 'registry.internal/api-gateway:2.8.4',
              restarts: 1
            },
            {
              id: 'k8s-pod-worker-1',
              clusterId: 'k8s-1',
              kind: 'pods',
              name: 'billing-worker-7f9d6f9dd9-rx8mm',
              namespace: 'ops',
              status: 'CrashLoopBackOff',
              ready: '0/1',
              age: '18h',
              detail: 'Background billing worker with repeated startup failures.',
              node: 'prod-node-03',
              image: 'registry.internal/billing-worker:1.15.2',
              restarts: 12
            }
          ],
          importContexts: [
            { name: 'prod/admin', cluster: 'prod-cluster', server: 'https://prod.k8s.local:6443', namespace: 'default' },
            { name: 'staging/devops', cluster: 'staging-cluster', server: 'https://staging.k8s.local:6443', namespace: 'staging' }
          ]
        },
        null,
        2
      ),
      'utf-8'
    )

    configureKubernetesBackendRuntime({ stateDir: tempDirs[0], useSeedData: false, defaultKubeconfigPath: null })
    __resetKubernetesCatalogForTests()
    const catalog = await listKubernetesCatalog()

    expect(catalog.ok).toBe(true)
    expect(catalog.data?.clusters.map((cluster) => cluster.id)).toEqual(['k8s-1', 'k8s-3'])
    expect(catalog.data?.clusters[0]).toMatchObject({
      id: 'k8s-1',
      name: 'prod-owned',
      connection_status: 'disconnected',
      default_namespace: 'ops'
    })
    expect(catalog.data?.contexts.map((context) => context.name)).toEqual(['prod/admin'])
    expect(catalog.data?.bastions).toEqual([expect.objectContaining({ uuid: 'org-1', label: 'jumpserver-org' })])
    expect(catalog.data?.importContexts.map((context) => context.name)).toEqual(['prod/admin'])
    expect(catalog.data?.namespaces).toEqual([expect.objectContaining({ id: 'k8s-ns-prod-ops', name: 'ops-owned' })])
    expect(catalog.data?.resources).toEqual([
      expect.objectContaining({
        id: 'k8s-pod-api-1',
        status: 'Investigating',
        detail: 'User-edited workload note.',
        restarts: 1
      })
    ])
    expect(JSON.parse(await readFile(statePath, 'utf-8')).clusters.map((cluster: { id: string }) => cluster.id)).toEqual(['k8s-1', 'k8s-3'])

    const command = await executeKubernetesCommand({
      command: 'kubectl get pods -A',
      clusterId: 'k8s-1',
      namespace: 'default'
    })
    expect(command).toEqual({
      ok: false,
      errorCode: 'K8S_KUBECONFIG_REQUIRED',
      errorMessage: 'Kubeconfig path or content is required before executing kubectl.'
    })
  })

  it('fails closed for non-seed JumpServer Kubernetes sync when the asset refresh provider is unavailable', async () => {
    const statePath = join(tempDirs[0], 'catalog.json')
    const persistedCatalog = {
      version: 1,
      contexts: [],
      clusters: [],
      bastions: [{ uuid: 'jump-prod', label: 'prod-jump', ip: '10.0.0.10' }],
      namespaces: [],
      resources: [],
      importContexts: []
    }
    await writeFile(statePath, JSON.stringify(persistedCatalog, null, 2), 'utf-8')
    configureKubernetesBackendRuntime({ stateDir: tempDirs[0], useSeedData: false, defaultKubeconfigPath: null })
    __resetKubernetesCatalogForTests()

    const before = await listKubernetesCatalog()
    expect(before).toMatchObject({
      ok: true,
      data: {
        clusters: [],
        bastions: [{ uuid: 'jump-prod', label: 'prod-jump', ip: '10.0.0.10' }]
      }
    })

    const synced = await syncKubernetesBastion('jump-prod')

    expect(synced).toEqual({
      ok: false,
      errorCode: 'K8S_BASTION_SYNC_UNAVAILABLE',
      errorMessage: 'JumpServer Kubernetes asset sync requires the live JumpServer backend integration.'
    })
    const after = await listKubernetesCatalog()
    expect(after.data?.clusters).toEqual([])
    expect(after.data?.bastions).toEqual(before.data?.bastions)
    expect(JSON.parse(await readFile(statePath, 'utf-8'))).toEqual(persistedCatalog)
  })

  it('syncs non-seed JumpServer Kubernetes clusters from backend organization assets', async () => {
    const statePath = join(tempDirs[0], 'catalog.json')
    const persistedCatalog = {
      version: 1,
      contexts: [
        {
          name: 'legacy/context',
          cluster: 'legacy-k8s',
          namespace: 'ops',
          server: '10.90.0.15:6443',
          isActive: true
        }
      ],
      clusters: [
        {
          id: 'k8s-existing',
          name: 'legacy-k8s',
          kubeconfig_path: null,
          kubeconfig_content: null,
          context_name: 'legacy/context',
          server_url: '10.90.0.15:6443',
          auth_type: 'jumpserver',
          is_active: 1,
          connection_status: 'connected',
          auto_connect: 1,
          default_namespace: 'ops',
          created_at: '2026-06-01 08:00',
          updated_at: '2026-06-01 08:00',
          source_type: 'jumpserver',
          bastion_uuid: 'org-1',
          bastion_asset_address: '10.90.0.15',
          bastion_asset_name: 'jumpserver-org-synced-asset',
          bastion_asset_id_last: 15
        }
      ],
      bastions: [{ uuid: 'org-1', label: 'jumpserver-org', ip: 'bastion.internal' }],
      namespaces: [],
      resources: [],
      importContexts: [
        {
          name: 'legacy/context',
          cluster: 'legacy-k8s',
          namespace: 'ops',
          server: '10.90.0.15:6443'
        }
      ]
    }
    await writeFile(statePath, JSON.stringify(persistedCatalog, null, 2), 'utf-8')
    const refreshCalls: Array<{ organizationId?: string }> = []
    configureKubernetesBackendRuntime({
      stateDir: tempDirs[0],
      useSeedData: false,
      defaultKubeconfigPath: null,
      refreshOrganizationAssets: (input) => {
        refreshCalls.push(input)
        return {
          ok: true,
          data: {
            organizationId: 'org-1',
            refreshed: 2,
            created: 1,
            updated: 1,
            folders: [],
            assets: [
              {
                id: 'asset-5',
                uuid: 'org-1',
                name: 'jumpserver-org',
                title: 'jumpserver-org',
                host: 'bastion.internal',
                ip: 'bastion.internal',
                group: '企业',
                group_name: '企业',
                status: 'online',
                tags: ['jumpserver'],
                username: 'sync',
                port: 22,
                asset_type: 'organization',
                auth_type: 'keyBased',
                comment: '',
                data_source: 'refresh'
              },
              {
                id: '15',
                uuid: '15',
                name: 'jumpserver-org-synced-asset',
                title: 'jumpserver-org-synced-asset',
                host: '10.90.0.15',
                ip: '10.90.0.15',
                group: '企业',
                group_name: '企业',
                status: 'online',
                tags: ['jumpserver', 'synced'],
                username: 'jump',
                port: 22,
                asset_type: 'person',
                auth_type: 'keyBased',
                comment: '',
                data_source: 'refresh',
                organizationId: 'org-1'
              },
              {
                id: '16',
                uuid: '16',
                name: 'prod-worker-k8s',
                title: 'prod-worker-k8s',
                host: '10.90.0.16',
                ip: '10.90.0.16',
                group: '企业',
                group_name: '企业',
                status: 'online',
                tags: ['kubernetes', 'synced'],
                username: 'jump',
                port: 22,
                asset_type: 'person',
                auth_type: 'keyBased',
                comment: '',
                data_source: 'refresh',
                organizationId: 'org-1'
              },
              {
                id: 'other-asset',
                uuid: 'other-asset',
                name: 'other-org-host',
                title: 'other-org-host',
                host: '10.90.9.10',
                ip: '10.90.9.10',
                group: '企业',
                group_name: '企业',
                status: 'online',
                tags: ['jumpserver', 'synced'],
                username: 'jump',
                port: 22,
                asset_type: 'person',
                auth_type: 'keyBased',
                comment: '',
                data_source: 'refresh',
                organizationId: 'other-org'
              }
            ]
          }
        }
      }
    })
    __resetKubernetesCatalogForTests()

    const synced = await syncKubernetesBastion('org-1')

    expect(refreshCalls).toEqual([{ organizationId: 'org-1' }])
    expect(synced).toMatchObject({
      ok: true,
      data: {
        syncedCount: 1,
        updatedCount: 1
      }
    })
    expect(synced.data?.clusters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'k8s-existing',
          name: 'jumpserver-org-synced-asset',
          context_name: 'jumpserver-org-synced-asset',
          server_url: '10.90.0.15:6443',
          is_active: 1,
          connection_status: 'disconnected',
          auto_connect: 1,
          default_namespace: 'ops',
          bastion_asset_id_last: 15
        }),
        expect.objectContaining({
          id: 'k8s-js-org-1-16',
          name: 'prod-worker-k8s',
          context_name: 'prod-worker-k8s',
          server_url: '10.90.0.16:6443',
          source_type: 'jumpserver',
          bastion_uuid: 'org-1',
          bastion_asset_address: '10.90.0.16',
          bastion_asset_name: 'prod-worker-k8s',
          bastion_asset_id_last: 16
        })
      ])
    )
    expect(synced.data?.clusters.some((cluster) => cluster.bastion_asset_name === 'other-org-host')).toBe(false)
    expect(synced.data?.contexts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'jumpserver-org-synced-asset', cluster: 'jumpserver-org-synced-asset', namespace: 'ops' }),
        expect.objectContaining({ name: 'prod-worker-k8s', cluster: 'prod-worker-k8s', namespace: 'default' })
      ])
    )
    const persisted = JSON.parse(await readFile(statePath, 'utf-8')) as { clusters: Array<{ id: string }>; contexts: Array<{ name: string }> }
    expect(persisted.clusters.map((cluster) => cluster.id)).toEqual(expect.arrayContaining(['k8s-existing', 'k8s-js-org-1-16']))
    expect(persisted.contexts.map((context) => context.name)).toEqual(expect.arrayContaining(['jumpserver-org-synced-asset', 'prod-worker-k8s']))

    const syncedAgain = await syncKubernetesBastion('org-1')
    expect(syncedAgain).toMatchObject({
      ok: true,
      data: {
        syncedCount: 0,
        updatedCount: 2
      }
    })
    expect(syncedAgain.data?.clusters.filter((cluster) => cluster.bastion_uuid === 'org-1')).toHaveLength(2)
  })

  it('keeps explicit seed JumpServer Kubernetes sync available for development fixtures', async () => {
    configureKubernetesBackendRuntime({ stateDir: tempDirs[0], useSeedData: true, defaultKubeconfigPath: null })
    __resetKubernetesCatalogForTests()

    const before = await listKubernetesCatalog()
    expect(before.data?.clusters.some((cluster) => cluster.bastion_uuid === 'org-prod')).toBe(false)

    const synced = await syncKubernetesBastion('org-prod')

    expect(synced).toMatchObject({
      ok: true,
      data: {
        syncedCount: 1,
        updatedCount: 0
      }
    })
    expect(synced.data?.clusters.some((cluster) => cluster.source_type === 'jumpserver' && cluster.bastion_uuid === 'org-prod')).toBe(true)
  })

  it('persists non-seed Kubernetes catalog mutations and restores them through the backend store', async () => {
    await createFakeKubectl(
      [
        'case "$1:$2" in',
        '  get:namespaces)',
        '    echo "NAME STATUS AGE"',
        '    echo "qa Active 12d"',
        '    ;;',
        '  get:pods)',
        '    echo "NAMESPACE NAME READY STATUS RESTARTS AGE"',
        '    echo "qa qa-api-5d6f7c8d9b-abcde 1/1 Running 0 4h"',
        '    ;;',
        '  get:deployments)',
        '    echo "NAMESPACE NAME READY UP-TO-DATE AVAILABLE AGE"',
        '    echo "qa qa-api 3/3 3 3 12d"',
        '    ;;',
        '  get:services)',
        '    echo "NAMESPACE NAME TYPE CLUSTER-IP EXTERNAL-IP PORT(S) AGE"',
        '    echo "qa qa-api ClusterIP 10.44.0.12 <none> 8080/TCP 12d"',
        '    ;;',
        '  get:nodes)',
        '    echo "NAME STATUS ROLES AGE VERSION"',
        '    echo "qa-node-01 Ready worker 30d v1.29.4"',
        '    ;;',
        '  *)',
        '    echo "unexpected args: $*" >&2',
        '    exit 17',
        '    ;;',
        'esac'
      ].join('\n')
    )
    configureKubernetesBackendRuntime({ stateDir: tempDirs[0], useSeedData: false, defaultKubeconfigPath: null })
    __resetKubernetesCatalogForTests()

    await expect(listKubernetesCatalog()).resolves.toMatchObject({
      ok: true,
      data: {
        clusters: []
      }
    })

    const imported = await importKubernetesKubeconfig({ kubeconfigContent: qaKubeconfigContent })
    expect(imported.ok).toBe(true)
    const added = await addKubernetesCluster({
      name: 'qa-cluster',
      contextName: 'qa/dev',
      serverUrl: 'https://qa.k8s.local:6443',
      defaultNamespace: 'qa',
      kubeconfigContent: qaKubeconfigContent,
      authType: 'kubeconfig',
      sourceType: 'local'
    })
    expect(added.ok).toBe(true)
    const clusterId = added.data!.cluster!.id

    await expect(connectKubernetesCluster(clusterId)).resolves.toMatchObject({
      ok: true,
      data: {
        cluster: expect.objectContaining({
          id: clusterId,
          connection_status: 'connected',
          is_active: 1
        })
      }
    })

    const refreshed = await refreshKubernetesResources({ clusterId, namespace: 'all', kind: 'all' })
    expect(refreshed.ok).toBe(true)
    expect(refreshed.data?.refreshedResources).toBe(4)

    const persisted = JSON.parse(await readFile(join(tempDirs[0], 'catalog.json'), 'utf-8')) as {
      clusters: Array<{ id: string; connection_status: string }>
      resources: Array<{ clusterId: string; name: string }>
      importContexts: Array<{ name: string }>
    }
    expect(persisted.clusters.map((cluster) => cluster.id)).toEqual([clusterId])
    expect(persisted.clusters[0]).toMatchObject({ connection_status: 'connected' })
    expect(persisted.resources.map((resource) => resource.name)).toEqual(expect.arrayContaining(['qa-api-5d6f7c8d9b-abcde', 'qa-api', 'qa-node-01']))
    expect(persisted.importContexts.map((context) => context.name)).toContain('qa/dev')

    configureKubernetesBackendRuntime({ stateDir: tempDirs[0], useSeedData: false, defaultKubeconfigPath: null })
    const restored = await listKubernetesCatalog()

    expect(restored.ok).toBe(true)
    expect(restored.data?.clusters.map((cluster) => cluster.id)).toEqual([clusterId])
    expect(restored.data?.clusters[0]).toMatchObject({
      name: 'qa-cluster',
      context_name: 'qa/dev',
      connection_status: 'disconnected',
      is_active: 1
    })
    expect(restored.data?.clusters.some((cluster) => cluster.id === 'k8s-1' || cluster.id === 'k8s-2' || cluster.id === 'k8s-3')).toBe(false)
    expect(restored.data?.namespaces.filter((namespace) => namespace.clusterId === clusterId)).toEqual([
      { id: expect.any(String), clusterId, name: 'qa', status: 'Active', age: '12d' }
    ])
    expect(restored.data?.resources.filter((resource) => resource.clusterId === clusterId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'pods', namespace: 'qa', name: 'qa-api-5d6f7c8d9b-abcde', ready: '1/1', status: 'Running' }),
        expect.objectContaining({ kind: 'deployments', namespace: 'qa', name: 'qa-api', ready: '3/3', status: 'Available' }),
        expect.objectContaining({ kind: 'services', namespace: 'qa', name: 'qa-api', status: 'ClusterIP', ready: '10.44.0.12' }),
        expect.objectContaining({ kind: 'nodes', namespace: 'cluster', name: 'qa-node-01', status: 'Ready', ready: 'v1.29.4' })
      ])
    )
    expect(restored.data?.importContexts.map((context) => context.name)).toContain('qa/dev')
  })

  it('fails closed when non-seed cluster connect probe fails', async () => {
    await createFakeKubectl(
      [
        'echo "forbidden: user cannot list namespaces" >&2',
        'exit 43'
      ].join('\n')
    )
    configureKubernetesBackendRuntime({ stateDir: tempDirs[0], useSeedData: false, defaultKubeconfigPath: null })
    __resetKubernetesCatalogForTests()

    const added = await addKubernetesCluster({
      name: 'qa-cluster',
      contextName: 'qa/dev',
      serverUrl: 'https://qa.k8s.local:6443',
      defaultNamespace: 'qa',
      kubeconfigContent: qaKubeconfigContent,
      authType: 'kubeconfig',
      sourceType: 'local'
    })
    expect(added.ok).toBe(true)
    const clusterId = added.data!.cluster!.id
    const events: unknown[] = []
    setKubernetesTerminalEventSink((event) => events.push(event))
    const terminal = await createKubernetesTerminal({ clusterId, namespace: 'qa' })
    expect(terminal).toMatchObject({
      ok: true,
      data: expect.objectContaining({
        clusterId,
        status: 'connecting'
      })
    })

    const connected = await connectKubernetesCluster(clusterId)

    expect(connected).toMatchObject({
      ok: false,
      errorCode: 'K8S_CONNECT_PROBE_FAILED',
      errorMessage: 'forbidden: user cannot list namespaces',
      data: {
        cluster: expect.objectContaining({
          id: clusterId,
          connection_status: 'error',
          is_active: 0
        })
      }
    })
    const catalog = await listKubernetesCatalog()
    expect(catalog.data?.clusters.find((cluster) => cluster.id === clusterId)).toMatchObject({
      connection_status: 'error',
      is_active: 0
    })
    await expect(writeKubernetesTerminal(terminal.data!.sessionId, 'kubectl get pods\n')).resolves.toMatchObject({
      ok: false,
      errorCode: 'K8S_TERMINAL_NOT_CONNECTED',
      errorMessage: 'Kubernetes terminal is not connected.'
    })
    expect(events).toEqual([
      expect.objectContaining({
        id: terminal.data!.id,
        sessionId: terminal.data!.sessionId,
        clusterId,
        exitCode: 1,
        reason: 'error',
        error: 'forbidden: user cannot list namespaces',
        emittedAt: '刚刚'
      })
    ])
  })

  it('returns pod logs with backend status details', async () => {
    const result = await executeKubernetesCommand({
      command: 'kubectl logs billing-worker-7f9d6f9dd9-rx8mm -n ops --tail=120',
      clusterId: 'k8s-1',
      namespace: 'ops'
    })

    expect(result.ok).toBe(true)
    expect(result.data?.success).toBe(true)
    expect(result.data?.output).toContain('missing secret billing-api-token')
    expect(result.data?.output).toContain('namespace=ops')
  })

  it('rejects empty commands behind the preload/main boundary', async () => {
    const result = await executeKubernetesCommand({
      command: '',
      clusterId: 'k8s-1'
    })

    expect(result).toEqual({
      ok: false,
      errorCode: 'K8S_EMPTY_COMMAND',
      errorMessage: 'Kubernetes command is required.'
    })
  })

  it('returns backend-owned agent validation failure run records', async () => {
    const noCluster = await executeKubernetesCommand({
      command: 'kubectl version --request-timeout=10s',
      source: 'agent',
      namespace: 'all'
    })

    expect(noCluster.ok).toBe(true)
    expect(noCluster.data).toEqual(
      expect.objectContaining({
        runId: expect.stringMatching(/^k8s-run-/),
        command: 'kubectl version --request-timeout=10s',
        success: false,
        error: 'No cluster selected. Please select a cluster first.',
        clusterId: '',
        contextName: 'unknown-context',
        namespace: 'all',
        source: 'agent',
        terminalOutput: ''
      })
    )

    const empty = await executeKubernetesCommand({
      command: '',
      clusterId: 'k8s-1',
      contextName: 'prod/admin',
      source: 'agent'
    })

    expect(empty.ok).toBe(true)
    expect(empty.data).toEqual(
      expect.objectContaining({
        runId: expect.stringMatching(/^k8s-run-/),
        command: '<empty>',
        success: false,
        error: 'Kubernetes command is required.',
        clusterId: 'k8s-1',
        contextName: 'prod/admin',
        source: 'agent'
      })
    )
  })

  it('returns command failure metadata when a described resource is missing', async () => {
    const result = await executeKubernetesCommand({
      command: 'kubectl describe pod missing -n ops',
      clusterId: 'k8s-1',
      namespace: 'ops'
    })

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      command: 'kubectl describe pod missing -n ops',
      success: false,
      error: 'Error from server (NotFound): pods "missing" not found'
    })
    expect(result.data?.output).toBe('Error from server (NotFound): pods "missing" not found')
    expect(result.data?.terminalOutput).toBe('[aiopsterm kubectl] kubectl describe pod missing -n ops\nError from server (NotFound): pods "missing" not found')
  })

  it('plans Kubernetes resource actions behind the backend boundary', async () => {
    await expect(
      planKubernetesResourceAction({
        resourceId: 'k8s-pod-worker-1',
        action: 'describe'
      })
    ).resolves.toMatchObject({
      ok: true,
      data: {
        resourceId: 'k8s-pod-worker-1',
        resourceName: 'billing-worker-7f9d6f9dd9-rx8mm',
        resourceKind: 'pods',
        action: 'describe',
        title: 'Describe billing-worker-7f9d6f9dd9-rx8mm',
        command: 'kubectl describe pod billing-worker-7f9d6f9dd9-rx8mm -n ops',
        clusterId: 'k8s-1',
        clusterName: 'prod-cluster',
        contextName: 'prod/admin',
        namespace: 'ops'
      }
    })

    await expect(
      planKubernetesResourceAction({
        resourceId: 'k8s-node-prod-1',
        action: 'logs'
      })
    ).resolves.toMatchObject({
      ok: false,
      errorCode: 'K8S_RESOURCE_LOGS_POD_REQUIRED',
      errorMessage: 'Kubernetes logs are only available for pods.'
    })

    await expect(
      planKubernetesResourceAction({
        resourceId: 'missing-resource',
        action: 'describe'
      })
    ).resolves.toMatchObject({
      ok: false,
      errorCode: 'K8S_RESOURCE_NOT_FOUND'
    })
  })

  it('executes Kubernetes resource actions through the shared command runner', async () => {
    const result = await executeKubernetesResourceAction({
      resourceId: 'k8s-pod-worker-1',
      action: 'logs'
    })

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      resourceId: 'k8s-pod-worker-1',
      resourceName: 'billing-worker-7f9d6f9dd9-rx8mm',
      resourceKind: 'pods',
      action: 'logs',
      title: 'Logs billing-worker-7f9d6f9dd9-rx8mm',
      command: 'kubectl logs billing-worker-7f9d6f9dd9-rx8mm -n ops --tail=120',
      clusterId: 'k8s-1',
      contextName: 'prod/admin',
      namespace: 'ops',
      source: 'resource',
      success: true
    })
    expect(result.data?.output).toContain('missing secret billing-api-token')
    expect(result.data?.terminalOutput).toContain('[aiopsterm kubectl] kubectl logs billing-worker-7f9d6f9dd9-rx8mm -n ops --tail=120')
  })

  it('limits backend seed get resource actions to the selected object', async () => {
    const result = await executeKubernetesResourceAction({
      resourceId: 'k8s-pod-worker-1',
      action: 'get'
    })

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      command: 'kubectl get pod billing-worker-7f9d6f9dd9-rx8mm -n ops -o wide',
      resourceId: 'k8s-pod-worker-1',
      action: 'get',
      success: true
    })
    expect(result.data?.output).toContain('billing-worker-7f9d6f9dd9-rx8mm')
    expect(result.data?.output).not.toContain('api-gateway-6d8c9bb7f6-l6j2m')
  })

  it('executes explicit kubeconfig resource actions through real kubectl backend plumbing', async () => {
    await createFakeKubectl(
      [
        'case "$1:$2" in',
        '  get:namespaces)',
        '    echo "NAME STATUS AGE"',
        '    echo "qa Active 12d"',
        '    ;;',
        '  get:pods)',
        '    echo "NAME READY STATUS RESTARTS AGE"',
        '    echo "qa-api-5d6f7c8d9b-abcde 1/1 Running 0 4h"',
        '    ;;',
        '  describe:pod)',
        '    echo "DESCRIBE_ARGS=$*"',
        '    ;;',
        '  *)',
        '    echo "unexpected args: $*" >&2',
        '    exit 17',
        '    ;;',
        'esac'
      ].join('\n')
    )
    const added = await addKubernetesCluster({
      name: 'qa-cluster',
      contextName: 'qa/dev',
      serverUrl: 'https://qa.k8s.local:6443',
      defaultNamespace: 'qa',
      kubeconfigContent: qaKubeconfigContent,
      authType: 'kubeconfig',
      sourceType: 'local'
    })
    const clusterId = added.data!.cluster!.id
    await refreshKubernetesResources({
      clusterId,
      namespace: 'qa',
      kind: 'pods'
    })
    const catalog = await listKubernetesCatalog()
    const pod = catalog.data?.resources.find((resource) => resource.clusterId === clusterId && resource.kind === 'pods' && resource.name === 'qa-api-5d6f7c8d9b-abcde')
    expect(pod).toBeTruthy()

    const result = await executeKubernetesResourceAction({
      resourceId: pod!.id,
      action: 'describe'
    })

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      command: 'kubectl describe pod qa-api-5d6f7c8d9b-abcde -n qa',
      contextName: 'qa/dev',
      namespace: 'qa',
      source: 'resource',
      success: true
    })
    expect(result.data?.output).toContain('DESCRIBE_ARGS=describe pod qa-api-5d6f7c8d9b-abcde -n qa --context=qa/dev')
  })

  it('returns a backend-owned Kubernetes Agent cleanup result', async () => {
    await expect(cleanupKubernetesAgent()).resolves.toMatchObject({
      ok: true,
      data: {
        cleared: true,
        cleanedAt: '刚刚'
      }
    })
  })
})
