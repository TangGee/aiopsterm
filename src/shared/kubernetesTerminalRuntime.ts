import { randomUUID } from 'crypto'
import type { AiopsMutationResult } from './contracts/common'
import type {
  KubernetesClusterRecord,
  KubernetesCommandResult,
  KubernetesTerminalCloseResult,
  KubernetesTerminalCreateInput,
  KubernetesTerminalCreateResult,
  KubernetesTerminalDataEvent,
  KubernetesTerminalExitEvent,
  KubernetesTerminalMutationResult,
  KubernetesTerminalRecord,
  KubernetesTerminalWriteResult
} from './contracts/kubernetes'
import { normalizeKubernetesCommand } from './kubernetesKubectlRuntime'

type KubernetesTerminalRuntimeOptions = {
  sessions: () => KubernetesTerminalRecord[]
  setSessions: (sessions: KubernetesTerminalRecord[]) => void
  requireCluster: (id: string) => KubernetesClusterRecord
  canRunLocalKubectl: (cluster: KubernetesClusterRecord) => boolean
  nonRunnableKubernetesReason: (cluster: KubernetesClusterRecord) => { code: string; message: string } | null
  markClusterRuntimeError: (cluster: KubernetesClusterRecord, errorMessage: string) => void
  executeKubernetesCommand: (input: {
    command: string
    clusterId?: string
    clusterName?: string
    contextName?: string
    namespace?: string
    defaultNamespace?: string
    source?: 'terminal' | 'agent' | 'resource'
  }) => Promise<KubernetesCommandResult>
  persistCatalogState: () => void
  nowLabel: () => string
}

const toMutationError = <T>(error: unknown, fallbackCode = 'K8S_BACKEND_ERROR'): AiopsMutationResult<T> => {
  const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : fallbackCode
  return {
    ok: false,
    errorCode: code,
    errorMessage: error instanceof Error ? error.message : String(error)
  }
}

const asResult = <T>(fn: () => T, fallbackCode = 'K8S_BACKEND_ERROR'): AiopsMutationResult<T> => {
  try {
    return { ok: true, data: fn() }
  } catch (error) {
    return toMutationError(error, fallbackCode)
  }
}

const clampTerminalDimension = (value: unknown, fallback: number, min: number, max: number) => {
  const number = Math.round(Number(value) || fallback)
  return Math.max(min, Math.min(max, number))
}

const k8sTerminalPrompt = (namespace: string) => `[${namespace || 'default'}]$ `

// 会话累计输出必须有上限：超限只保留尾部，避免长跑终端把主进程内存拖爆。
const k8sTerminalOutputMaxLength = 1024 * 1024

const appendK8sTerminalOutput = (current: string, chunk: string) => {
  if (!chunk) return current
  const joined = current.endsWith('\n') || !current ? `${current}${chunk}` : `${current}\n${chunk}`
  return joined.length > k8sTerminalOutputMaxLength ? joined.slice(-k8sTerminalOutputMaxLength) : joined
}

const k8sTerminalSessionName = (clusterName: string, index: number) => (index <= 1 ? clusterName : `${clusterName}-${index}`)

const cloneTerminalRecord = (record: KubernetesTerminalRecord): KubernetesTerminalRecord => ({ ...record })

export const createKubernetesTerminalRuntime = (options: KubernetesTerminalRuntimeOptions) => {
  let eventSink: ((event: KubernetesTerminalDataEvent | KubernetesTerminalExitEvent) => void) | null = null

  const findTerminalSession = (id: string) => options.sessions().find((session) => session.id === id || session.sessionId === id)

  const setEventSink = (sink: ((event: KubernetesTerminalDataEvent | KubernetesTerminalExitEvent) => void) | null) => {
    eventSink = sink
  }

  const emitData = (
    session: KubernetesTerminalRecord,
    event: Omit<KubernetesTerminalDataEvent, 'id' | 'sessionId' | 'clusterId' | 'emittedAt'>
  ) => {
    eventSink?.({
      id: session.id,
      sessionId: session.sessionId,
      clusterId: session.clusterId,
      emittedAt: options.nowLabel(),
      ...event
    })
  }

  const emitExit = (
    session: KubernetesTerminalRecord,
    event: Omit<KubernetesTerminalExitEvent, 'id' | 'sessionId' | 'clusterId' | 'emittedAt'>
  ) => {
    eventSink?.({
      id: session.id,
      sessionId: session.sessionId,
      clusterId: session.clusterId,
      emittedAt: options.nowLabel(),
      ...event
    })
  }

  const failClusterSessions = (clusterId: string, error: string) => {
    options.setSessions(
      options.sessions().map((session) => {
        if (session.clusterId !== clusterId || session.status === 'ended' || session.status === 'error') return session
        const failed: KubernetesTerminalRecord = {
          ...session,
          output: appendK8sTerminalOutput(session.output, error),
          status: 'error',
          updatedAt: options.nowLabel()
        }
        emitExit(failed, {
          exitCode: 1,
          reason: 'error',
          error
        })
        return failed
      })
    )
  }

  const createTerminal = async (input: KubernetesTerminalCreateInput): Promise<KubernetesTerminalCreateResult> =>
    asResult(() => {
      const cluster = options.requireCluster(input.clusterId)
      const nonRunnableReason = options.canRunLocalKubectl(cluster) ? null : options.nonRunnableKubernetesReason(cluster)
      if (nonRunnableReason) {
        options.markClusterRuntimeError(cluster, nonRunnableReason.message)
        options.persistCatalogState()
        throw Object.assign(new Error(nonRunnableReason.message), { code: nonRunnableReason.code })
      }
      const namespace = input.namespace?.trim() || cluster.default_namespace || 'default'
      const activeClusterSessions = options.sessions().filter((session) => session.clusterId === cluster.id && session.status !== 'ended')
      const sessionIndex = activeClusterSessions.length + 1
      const status = cluster.connection_status === 'connected' ? 'connected' : 'connecting'
      const record: KubernetesTerminalRecord = {
        id: `k8s-tab-${randomUUID()}`,
        sessionId: `k8s-session-${randomUUID()}`,
        clusterId: cluster.id,
        name: k8sTerminalSessionName(cluster.name, sessionIndex),
        namespace,
        output: [`Connecting to cluster ${cluster.name}...`, `kubectl context: ${cluster.context_name}`, `namespace: ${namespace}`, k8sTerminalPrompt(namespace)].join('\n'),
        status,
        cols: clampTerminalDimension(input.cols, 80, 20, 240),
        rows: clampTerminalDimension(input.rows, 24, 8, 80),
        createdAt: options.nowLabel(),
        updatedAt: options.nowLabel()
      }
      options.setSessions([...options.sessions(), record])
      return cloneTerminalRecord(record)
    })

  const writeTerminal = async (id: string, data: string): Promise<KubernetesTerminalWriteResult> => {
    try {
      const current = findTerminalSession(id)
      if (!current) throw Object.assign(new Error('Kubernetes terminal session not found.'), { code: 'K8S_TERMINAL_NOT_FOUND' })
      if (current.status === 'ended') throw Object.assign(new Error('Kubernetes terminal session has ended.'), { code: 'K8S_TERMINAL_ENDED' })
      if (current.status !== 'connected') {
        throw Object.assign(new Error('Kubernetes terminal is not connected.'), { code: 'K8S_TERMINAL_NOT_CONNECTED' })
      }
      const text = typeof data === 'string' ? data : ''
      const command = normalizeKubernetesCommand(text)
      const bytes = Buffer.byteLength(text, 'utf-8')
      if (!command) {
        return {
          ok: false,
          errorCode: 'K8S_EMPTY_COMMAND',
          errorMessage: 'Kubernetes command is required.'
        }
      }
      const cluster = options.requireCluster(current.clusterId)
      const result = await options.executeKubernetesCommand({
        command,
        clusterId: current.clusterId,
        clusterName: cluster.name,
        contextName: cluster.context_name,
        namespace: current.namespace,
        defaultNamespace: cluster.default_namespace,
        source: 'terminal'
      })
      if (!result.ok || !result.data) {
        return {
          ok: false,
          errorCode: result.errorCode || 'K8S_TERMINAL_WRITE_FAILED',
          errorMessage: result.errorMessage || 'Kubernetes terminal command failed.'
        }
      }
      const terminalOutput = result.data.terminalOutput
      const updated: KubernetesTerminalRecord = {
        ...current,
        output: terminalOutput ? appendK8sTerminalOutput(current.output, terminalOutput) : current.output,
        status: current.status,
        updatedAt: options.nowLabel()
      }
      options.setSessions(options.sessions().map((session) => (session.id === current.id ? updated : session)))
      emitData(updated, {
        data: terminalOutput,
        command,
        output: result.data.output,
        success: result.data.success,
        error: result.data.error
      })
      return {
        ok: true,
        data: {
          id: updated.id,
          sessionId: updated.sessionId,
          bytes,
          command,
          output: result.data.output,
          success: result.data.success,
          error: result.data.error,
          terminalOutput,
          updatedAt: updated.updatedAt
        }
      }
    } catch (error) {
      return toMutationError(error, 'K8S_TERMINAL_WRITE_FAILED')
    }
  }

  const resizeTerminal = async (id: string, cols: number, rows: number): Promise<KubernetesTerminalMutationResult> =>
    asResult(() => {
      const current = findTerminalSession(id)
      if (!current) throw Object.assign(new Error('Kubernetes terminal session not found.'), { code: 'K8S_TERMINAL_NOT_FOUND' })
      const updated: KubernetesTerminalRecord = {
        ...current,
        cols: clampTerminalDimension(cols, current.cols || 80, 20, 240),
        rows: clampTerminalDimension(rows, current.rows || 24, 8, 80),
        updatedAt: options.nowLabel()
      }
      options.setSessions(options.sessions().map((session) => (session.id === current.id ? updated : session)))
      return cloneTerminalRecord(updated)
    })

  const closeTerminal = async (id: string, exitCode = 0): Promise<KubernetesTerminalCloseResult> =>
    asResult(() => {
      const current = findTerminalSession(id)
      if (!current) throw Object.assign(new Error('Kubernetes terminal session not found.'), { code: 'K8S_TERMINAL_NOT_FOUND' })
      const closed: KubernetesTerminalRecord & { exitCode: number } = {
        ...current,
        status: 'ended',
        updatedAt: options.nowLabel(),
        exitCode
      }
      options.setSessions(options.sessions().filter((session) => session.id !== current.id))
      emitExit(current, {
        exitCode,
        reason: 'closed'
      })
      return { ...closed }
    })

  const reset = () => {
    eventSink = null
  }

  return {
    setEventSink,
    failClusterSessions,
    createTerminal,
    writeTerminal,
    resizeTerminal,
    closeTerminal,
    reset
  }
}
