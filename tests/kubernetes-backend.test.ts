import { beforeEach, describe, expect, it } from 'vitest'
import { __resetKubernetesCatalogForTests, closeKubernetesTerminal, createKubernetesTerminal, executeKubernetesCommand, resizeKubernetesTerminal } from '@shared/kubernetes'

describe('kubernetes backend boundary', () => {
  beforeEach(() => {
    __resetKubernetesCatalogForTests()
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
})
