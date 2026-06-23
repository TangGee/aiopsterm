import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import { createWorkspaceKubernetesTerminalController } from '@/services/kubernetes/workspaceKubernetesTerminalController'
import type { K8sCluster } from '@/services/kubernetes/kubernetesBackendGuards'
import type { K8sTerminalTab } from '@/services/kubernetes/kubernetesRuntime'
import type { KubernetesTerminalDataEvent, KubernetesTerminalExitEvent, KubernetesTerminalRecord } from '@shared/contracts/kubernetes'

const originalAiops = window.aiops

const cluster = (input: Partial<K8sCluster> & Pick<K8sCluster, 'id' | 'name'>): K8sCluster => ({
  kubeconfig_path: null,
  kubeconfig_content: null,
  context_name: input.id,
  server_url: `https://${input.id}.k8s.local:6443`,
  auth_type: 'kubeconfig',
  is_active: 1,
  connection_status: 'connected',
  auto_connect: 0,
  default_namespace: 'default',
  created_at: '2026-06-20T00:00:00.000Z',
  updated_at: '2026-06-20T00:00:00.000Z',
  source_type: 'local',
  bastion_uuid: null,
  bastion_asset_address: null,
  bastion_asset_name: null,
  bastion_asset_id_last: null,
  ...input
})

const terminalRecord = (patch: Partial<KubernetesTerminalRecord> & Pick<KubernetesTerminalRecord, 'id' | 'sessionId' | 'clusterId'>): KubernetesTerminalRecord => ({
  name: patch.clusterId,
  namespace: 'default',
  output: 'connected',
  status: 'connected',
  cols: 80,
  rows: 24,
  createdAt: '2026-06-20T00:00:00.000Z',
  updatedAt: '2026-06-20T00:00:00.000Z',
  ...patch
})

const createSubject = () => {
  const k8sClusters = ref<K8sCluster[]>([
    cluster({ id: 'prod', name: 'Production', context_name: 'prod/admin' }),
    cluster({ id: 'stage', name: 'Staging', context_name: 'stage/dev', connection_status: 'disconnected', default_namespace: 'stage' })
  ])
  const k8sTerminalTabs = ref<K8sTerminalTab[]>([])
  const k8sActiveTerminalId = ref<string | null>(null)
  const k8sActiveClusterId = ref<string | null>('prod')
  const k8sSelectedClusterId = ref<string | null>('prod')
  const notices = ref<string[]>([])
  const connectedClusterIds: string[] = []
  const sentChats: Array<{ text: string; hosts?: unknown[]; options?: unknown }> = []
  const dataListeners: Array<(event: KubernetesTerminalDataEvent) => void> = []
  const exitListeners: Array<(event: KubernetesTerminalExitEvent) => void> = []
  const k8sActiveCluster = computed(() => k8sClusters.value.find((item) => item.id === k8sActiveClusterId.value) || null)
  const k8sSelectedCluster = computed(() => k8sClusters.value.find((item) => item.id === k8sSelectedClusterId.value) || null)
  const k8sActiveTerminal = computed(() => k8sTerminalTabs.value.find((item) => item.id === k8sActiveTerminalId.value) || null)
  let sequence = 0
  let controller: ReturnType<typeof createWorkspaceKubernetesTerminalController>

  window.aiops = {
    ...originalAiops,
    createKubernetesTerminal: vi.fn(async (input) => {
      sequence += 1
      const clusterRecord = k8sClusters.value.find((item) => item.id === input.clusterId)
      if (!clusterRecord) return { ok: false, errorMessage: 'missing cluster' }
      return {
        ok: true,
        data: terminalRecord({
          id: `tab-${sequence}`,
          sessionId: `session-${sequence}`,
          clusterId: input.clusterId,
          name: `${clusterRecord.name}-${sequence}`,
          namespace: input.namespace || clusterRecord.default_namespace || 'default',
          output: `kubectl context: ${clusterRecord.context_name}`,
          status: clusterRecord.connection_status === 'connected' ? 'connected' : 'connecting',
          cols: input.cols || 80,
          rows: input.rows || 24
        })
      }
    }),
    writeKubernetesTerminal: vi.fn(async (sessionId, data) => {
      const tab = k8sTerminalTabs.value.find((item) => item.sessionId === sessionId)
      if (!tab) return { ok: false, errorMessage: 'missing terminal' }
      const command = data.trim()
      const output = `NAME READY\n${tab.namespace}-api 1/1`
      const terminalOutput = `[aiopsterm kubectl] ${command}\n${output}`
      dataListeners.forEach((listener) =>
        listener({
          id: tab.id,
          sessionId: tab.sessionId,
          clusterId: tab.clusterId,
          data: terminalOutput,
          command,
          output,
          success: true,
          error: '',
          emittedAt: '2026-06-20T00:00:01.000Z'
        })
      )
      return {
        ok: true,
        data: {
          id: tab.id,
          sessionId: tab.sessionId,
          bytes: new TextEncoder().encode(data).byteLength,
          command,
          output,
          success: true,
          error: '',
          terminalOutput,
          updatedAt: '2026-06-20T00:00:01.000Z'
        }
      }
    }),
    resizeKubernetesTerminal: vi.fn(async (sessionId, cols, rows) => {
      const tab = k8sTerminalTabs.value.find((item) => item.sessionId === sessionId)
      if (!tab) return { ok: false, errorMessage: 'missing terminal' }
      return { ok: true, data: terminalRecord({ ...tab, cols, rows, updatedAt: '2026-06-20T00:00:02.000Z' }) }
    }),
    closeKubernetesTerminal: vi.fn(async (sessionId, exitCode = 0) => {
      const tab = k8sTerminalTabs.value.find((item) => item.sessionId === sessionId)
      if (!tab) return { ok: false, errorMessage: 'missing terminal' }
      const event: KubernetesTerminalExitEvent = {
        id: tab.id,
        sessionId: tab.sessionId,
        clusterId: tab.clusterId,
        exitCode,
        reason: 'closed',
        emittedAt: '2026-06-20T00:00:03.000Z'
      }
      exitListeners.forEach((listener) => listener(event))
      return { ok: true, data: { ...terminalRecord(tab), status: 'ended' as const, exitCode, updatedAt: event.emittedAt } }
    }),
    onKubernetesTerminalData: vi.fn((listener) => {
      dataListeners.push(listener)
      return () => undefined
    }),
    onKubernetesTerminalExit: vi.fn((listener) => {
      exitListeners.push(listener)
      return () => undefined
    })
  }

  controller = createWorkspaceKubernetesTerminalController(
    {
      k8sClusters,
      k8sTerminalTabs,
      k8sActiveTerminalId,
      k8sActiveCluster,
      k8sSelectedCluster,
      k8sActiveTerminal
    },
    {
      setK8sNotice: (text) => notices.value.push(text),
      connectK8sCluster: async (id) => {
        connectedClusterIds.push(id)
        k8sClusters.value = k8sClusters.value.map((item) => (item.id === id ? { ...item, connection_status: 'connected' } : item))
        controller.completeK8sTerminalConnect(id)
        return true
      },
      sendChat: async (text, _parts, hosts, options) => {
        sentChats.push({ text, hosts, options })
        return true
      }
    }
  )

  return {
    controller,
    k8sClusters,
    k8sTerminalTabs,
    k8sActiveTerminalId,
    k8sActiveClusterId,
    k8sSelectedClusterId,
    k8sActiveTerminal,
    notices,
    connectedClusterIds,
    sentChats,
    dataListeners,
    exitListeners
  }
}

afterEach(() => {
  window.aiops = originalAiops
  vi.restoreAllMocks()
})

describe('workspaceKubernetesTerminalController', () => {
  it('opens, connects, reuses, force-creates, activates, resizes, and prunes terminal tabs', async () => {
    const subject = createSubject()

    const first = await subject.controller.openK8sTerminal('stage', { namespace: 'ops', cols: 120, rows: 32 })
    expect(first?.clusterId).toBe('stage')
    expect(first?.status).toBe('connected')
    expect(subject.connectedClusterIds).toEqual(['stage'])
    expect(subject.k8sActiveTerminalId.value).toBe(first?.id)
    expect(window.aiops.createKubernetesTerminal).toHaveBeenCalledWith({ clusterId: 'stage', namespace: 'ops', cols: 120, rows: 32 })

    const reused = await subject.controller.openK8sTerminal('stage')
    expect(reused?.id).toBe(first?.id)
    expect(window.aiops.createKubernetesTerminal).toHaveBeenCalledTimes(1)

    const second = await subject.controller.createNewK8sTerminalTab('stage')
    expect(second?.id).not.toBe(first?.id)
    expect(subject.k8sTerminalTabs.value).toHaveLength(2)
    expect(subject.k8sActiveTerminal.value?.id).toBe(second?.id)

    subject.controller.setActiveK8sTerminal(first!.id)
    expect(subject.k8sActiveTerminal.value?.id).toBe(first?.id)
    expect(subject.k8sTerminalTabs.value.find((tab) => tab.id === first?.id)?.isActive).toBe(true)

    await expect(subject.controller.resizeK8sTerminal(first!.sessionId, 132, 40)).resolves.toBe(true)
    expect(subject.k8sTerminalTabs.value.find((tab) => tab.id === first?.id)?.cols).toBe(132)
    expect(subject.k8sTerminalTabs.value.find((tab) => tab.id === first?.id)?.rows).toBe(40)
    expect(subject.notices.value.at(-1)).toBe(`${first?.name} 终端尺寸已同步 132x40`)

    subject.controller.markK8sClusterTerminalTabsEnded('stage')
    expect(subject.k8sTerminalTabs.value.every((tab) => tab.clusterId !== 'stage' || tab.status === 'ended')).toBe(true)

    subject.controller.removeK8sClusterTerminalTabs('stage')
    expect(subject.k8sTerminalTabs.value).toHaveLength(0)
    expect(subject.k8sActiveTerminalId.value).toBeNull()
  })

  it('writes terminal commands, tracks output, and forwards AI collection through injected chat boundary', async () => {
    const subject = createSubject()
    const tab = await subject.controller.openK8sTerminal('prod')

    await expect(subject.controller.sendK8sTerminalCommand('kubectl get pods')).resolves.toContain('default-api')
    expect(window.aiops.writeKubernetesTerminal).toHaveBeenCalledWith(tab?.sessionId, 'kubectl get pods\n')
    expect(subject.k8sActiveTerminal.value?.output).toContain('[aiopsterm kubectl] kubectl get pods')
    expect(subject.k8sActiveTerminal.value?.commandHistory[0]).toBe('kubectl get pods')
    expect(subject.k8sActiveTerminal.value?.lastCommandOutput).toContain('default-api')

    await expect(subject.controller.executeK8sTerminalAiCommand('   ', tab?.id)).resolves.toBe(false)
    expect(subject.k8sActiveTerminal.value?.collectingAiOutput).toBe(false)
    expect(subject.k8sActiveTerminal.value?.aiCommandTabId).toBeNull()
    expect(subject.notices.value.at(-1)).toBe('当前没有可采集到 AI 的 kubectl 命令')

    await expect(subject.controller.executeK8sTerminalAiCommand('kubectl get svc', tab?.id)).resolves.toBe(true)
    expect(subject.sentChats).toHaveLength(1)
    expect(subject.sentChats[0].text).toContain('Terminal output')
    expect(subject.sentChats[0].text).toContain('kubectl get svc')
    expect(subject.sentChats[0].hosts).toEqual([
      {
        id: 'k8s-prod',
        kind: 'hosts',
        label: 'Production',
        detail: 'prod/admin / default'
      }
    ])
    expect(subject.sentChats[0].options).toEqual({ skipKnowledgeSearch: true })
    expect(subject.k8sActiveTerminal.value?.collectingAiOutput).toBe(false)
    expect(subject.notices.value.at(-1)).toBe(`${tab?.name} 命令输出已发送到 AI`)
  })

  it('ends and closes sessions through validated backend close data', async () => {
    const subject = createSubject()
    const first = await subject.controller.openK8sTerminal('prod')
    const second = await subject.controller.createNewK8sTerminalTab('prod')

    await expect(subject.controller.endK8sTerminalSession(second!.id)).resolves.toBe(true)
    expect(window.aiops.closeKubernetesTerminal).toHaveBeenCalledWith(second?.sessionId, 0)
    expect(subject.k8sTerminalTabs.value.find((tab) => tab.id === second?.id)?.status).toBe('ended')
    expect(subject.notices.value.at(-1)).toBe(`${second?.name} 终端会话已结束`)

    await subject.controller.closeK8sTerminalTab(first!.id)
    expect(window.aiops.closeKubernetesTerminal).toHaveBeenCalledWith(first?.sessionId, 0)
    expect(subject.k8sTerminalTabs.value.some((tab) => tab.id === first?.id)).toBe(false)
  })

  it('applies validated terminal listener events and ignores malformed or mismatched events', async () => {
    const subject = createSubject()
    const tab = await subject.controller.openK8sTerminal('prod')
    const before = JSON.stringify(subject.k8sTerminalTabs.value)

    subject.controller.handleK8sTerminalData({
      id: tab!.id,
      sessionId: tab!.sessionId,
      clusterId: tab!.clusterId,
      data: 'manual event output',
      command: 'kubectl get pods',
      output: 'manual event output',
      success: true,
      error: '',
      emittedAt: '2026-06-20T00:00:04.000Z'
    })
    expect(subject.k8sActiveTerminal.value?.output).toContain('manual event output')
    expect(subject.k8sActiveTerminal.value?.lastCommandOutput).toBe('manual event output')

    subject.controller.handleK8sTerminalData({ ...JSON.parse(before)[0], data: 42 })
    expect(subject.k8sActiveTerminal.value?.output).toContain('manual event output')

    subject.controller.handleK8sTerminalExit({
      id: tab!.id,
      sessionId: tab!.sessionId,
      clusterId: tab!.clusterId,
      exitCode: 7,
      reason: 'error',
      error: 'terminal failed',
      emittedAt: '2026-06-20T00:00:05.000Z'
    })
    expect(subject.k8sActiveTerminal.value?.status).toBe('error')
    expect(subject.k8sActiveTerminal.value?.exitCode).toBe(7)
    expect(subject.notices.value.at(-1)).toBe('terminal failed')
  })

  it('rejects malformed create, write, resize, and close results without mutating affected state', async () => {
    const subject = createSubject()
    const tab = await subject.controller.openK8sTerminal('prod')
    const tabsBeforeCreate = JSON.stringify(subject.k8sTerminalTabs.value)
    vi.mocked(window.aiops.createKubernetesTerminal).mockResolvedValueOnce({
      ok: true,
      data: {
        id: 'bad-tab',
        sessionId: 'bad-session',
        clusterId: 'prod'
      }
    } as any)

    await expect(subject.controller.openK8sTerminal('prod', { forceNew: true })).resolves.toBeNull()
    expect(subject.notices.value.at(-1)).toBe('Kubernetes terminal backend returned malformed result data.')
    expect(JSON.stringify(subject.k8sTerminalTabs.value)).toBe(tabsBeforeCreate)

    const tabBeforeWrite = JSON.stringify(subject.k8sActiveTerminal.value)
    vi.mocked(window.aiops.writeKubernetesTerminal).mockResolvedValueOnce({
      ok: true,
      data: {
        id: tab!.id,
        sessionId: 'wrong-session',
        bytes: new TextEncoder().encode('kubectl get pods\n').byteLength,
        command: 'kubectl get pods',
        output: 'bad',
        success: true,
        error: '',
        terminalOutput: 'bad',
        updatedAt: '2026-06-20T00:00:06.000Z'
      }
    } as any)
    await expect(subject.controller.sendK8sTerminalCommand('kubectl get pods')).resolves.toBe('')
    expect(subject.notices.value.at(-1)).toBe('Kubernetes terminal backend returned malformed write data.')
    expect(JSON.stringify(subject.k8sActiveTerminal.value)).toBe(tabBeforeWrite)

    vi.mocked(window.aiops.resizeKubernetesTerminal).mockResolvedValueOnce({
      ok: true,
      data: terminalRecord({ ...tab!, sessionId: 'wrong-session', cols: 120, rows: 40 })
    } as any)
    await expect(subject.controller.resizeK8sTerminal(tab!.sessionId, 120, 40)).resolves.toBe(false)
    expect(subject.notices.value.at(-1)).toBe('Kubernetes terminal backend returned malformed result data.')
    expect(JSON.stringify(subject.k8sActiveTerminal.value)).toBe(tabBeforeWrite)

    vi.mocked(window.aiops.closeKubernetesTerminal).mockResolvedValueOnce({
      ok: true,
      data: terminalRecord({ ...tab!, status: 'ended' })
    } as any)
    await expect(subject.controller.endK8sTerminalSession(tab!.id)).resolves.toBe(false)
    expect(subject.notices.value.at(-1)).toBe('Kubernetes terminal backend returned malformed result data.')
    expect(JSON.stringify(subject.k8sActiveTerminal.value)).toBe(tabBeforeWrite)
  })

  it('stops AI collection when terminal write is unavailable or terminal is disconnected', async () => {
    const subject = createSubject()
    const tab = await subject.controller.openK8sTerminal('prod')
    subject.controller.updateK8sTerminalTabState(tab!.id, (item) => ({ ...item, collectingAiOutput: true, aiCommandTabId: item.id }))
    const writeKubernetesTerminal = window.aiops.writeKubernetesTerminal
    ;(window.aiops as any).writeKubernetesTerminal = undefined

    await expect(subject.controller.sendK8sTerminalCommand('kubectl get pods')).resolves.toBe('')
    expect(subject.notices.value.at(-1)).toBe('Kubernetes terminal write API 不可用')
    expect(subject.k8sActiveTerminal.value?.collectingAiOutput).toBe(false)
    ;(window.aiops as any).writeKubernetesTerminal = writeKubernetesTerminal

    subject.controller.updateK8sTerminalTabState(tab!.id, (item) => ({ ...item, status: 'error', collectingAiOutput: true, aiCommandTabId: item.id }))
    await expect(subject.controller.sendK8sTerminalCommand('kubectl get pods')).resolves.toBe('')
    expect(subject.notices.value.at(-1)).toBe('Kubernetes terminal is not connected.')
    expect(subject.k8sActiveTerminal.value?.collectingAiOutput).toBe(false)
  })
})
