import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  __resetKubernetesCatalogForTests,
  addKubernetesCluster,
  cleanupKubernetesAgent,
  closeKubernetesTerminal,
  configureKubernetesBackendRuntime,
  createKubernetesTerminal,
  executeKubernetesCommand,
  getKubernetesAgentProxyConfig,
  importKubernetesKubeconfig,
  listKubernetesCatalog,
  refreshKubernetesResources,
  resizeKubernetesTerminal,
  saveKubernetesAgentProxyConfig,
  testKubernetesClusterConnection
} from '@shared/kubernetes'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

describe('kubernetes backend boundary', () => {
  const tempDirs: string[] = []
  const originalKubectlPath = process.env.AIOPSTERM_KUBECTL_PATH

  beforeEach(async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'aiopsterm-k8s-state-'))
    tempDirs.push(stateDir)
    configureKubernetesBackendRuntime({ stateDir })
    __resetKubernetesCatalogForTests()
  })

  afterEach(async () => {
    if (originalKubectlPath === undefined) delete process.env.AIOPSTERM_KUBECTL_PATH
    else process.env.AIOPSTERM_KUBECTL_PATH = originalKubectlPath
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

    configureKubernetesBackendRuntime({ stateDir: tempDirs[0] })
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

    expect(result.ok).toBe(true)
    expect(result.data).toEqual(
      expect.objectContaining({
        refreshedClusterId: 'k8s-3',
        refreshedKind: 'pods',
        clusterId: 'k8s-3',
        contextName: 'jumpserver/prod',
        namespace: 'ops',
        command: 'kubectl get pods -n ops',
        success: false,
        refreshedResources: 0,
        refreshedNamespaces: 0
      })
    )
    expect(result.data?.error).toContain('JumpServer Kubernetes command streaming is not connected')

    const after = await listKubernetesCatalog()
    expect(after.data?.resources.filter((resource) => resource.clusterId === 'k8s-3')).toEqual(beforeJumpResources)
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

    const fromContent = await testKubernetesClusterConnection({
      contextName: 'qa/dev',
      serverUrl: 'https://qa.k8s.local:6443',
      kubeconfigContent: qaKubeconfigContent
    })
    expect(fromContent).toMatchObject({
      ok: true,
      data: {
        isValid: true,
        contextName: 'qa/dev',
        serverUrl: 'https://qa.k8s.local:6443'
      }
    })

    await expect(testKubernetesClusterConnection({ contextName: 'qa/dev', serverUrl: 'https://wrong.k8s.local:6443', kubeconfigContent: qaKubeconfigContent })).resolves.toMatchObject({
      ok: false,
      errorCode: 'K8S_TEST_SERVER_MISMATCH'
    })
    await expect(testKubernetesClusterConnection({ contextName: '' })).resolves.toMatchObject({
      ok: false,
      errorCode: 'K8S_TEST_CONTEXT_REQUIRED'
    })
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
    const fromContent = await importKubernetesKubeconfig({ kubeconfigContent })
    expect(fromContent).toMatchObject({
      ok: true,
      data: {
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
    await expect(importKubernetesKubeconfig({ kubeconfigPath: filePath })).resolves.toMatchObject({
      ok: true,
      data: {
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
