import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { homedir, platform, tmpdir } from 'os'
import { delimiter, dirname, join } from 'path'
import type { AiopsMutationResult } from './contracts/common'
import type {
  KubernetesAgentProxyConfig,
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
import { buildKubernetesProxyEnvironment, normalizeKubernetesCommand, stripAnsi } from './kubernetesKubectlRuntime'
import { pinKubeconfigCurrentContext } from './kubernetesKubeconfigRuntime'

export type KubernetesPtyProcess = {
  pid?: number
  write: (data: string) => void
  resize: (cols: number, rows: number) => void
  kill: () => void
  onData: (listener: (data: string) => void) => void
  onExit: (listener: (event: { exitCode: number }) => void) => void
}

export type KubernetesPtySpawnRequest = {
  shell: string
  args: string[]
  cols: number
  rows: number
  cwd: string
  env: NodeJS.ProcessEnv
}

export type KubernetesPtySpawner = (request: KubernetesPtySpawnRequest) => Promise<KubernetesPtyProcess> | KubernetesPtyProcess

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
  expandHomePath: (value: string) => string
  loadAgentProxyConfig: () => KubernetesAgentProxyConfig
  /** 测试可注入假 PTY;返回 null 时使用 node-pty 默认实现。 */
  spawnPty: () => KubernetesPtySpawner | null
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

// PTY 数据是连续字节流,按原样拼接(不能像命令块那样插换行),仅保留尾部 1MiB。
const appendK8sTerminalStream = (current: string, chunk: string) => {
  if (!chunk) return current
  const joined = `${current}${chunk}`
  return joined.length > k8sTerminalOutputMaxLength ? joined.slice(-k8sTerminalOutputMaxLength) : joined
}

// 渲染层终端面板是纯文本视图:去掉 ANSI 转义并归一化回车,保证 <pre> 可读。
const sanitizeK8sPtyChunk = (chunk: string) => stripAnsi(chunk).replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\u0007/g, '')

const resolveKubernetesTerminalShell = () => (platform() === 'win32' ? process.env.COMSPEC || 'powershell.exe' : process.env.SHELL || '/bin/bash')

// runLocalKubectl 尊重 AIOPSTERM_KUBECTL_PATH;PTY 里用户敲的是裸 `kubectl`,
// 把自定义 kubectl 所在目录前置到 PATH,保证两条路径解析到同一个二进制。
const kubernetesTerminalPath = () => {
  const customKubectl = process.env.AIOPSTERM_KUBECTL_PATH?.trim()
  const basePath = process.env.PATH || ''
  if (!customKubectl || !existsSync(customKubectl)) return basePath
  return [dirname(customKubectl), basePath].filter(Boolean).join(delimiter)
}

const defaultKubernetesPtySpawner: KubernetesPtySpawner = async (request) => {
  const nodePty = await import('node-pty')
  const pty = nodePty.spawn(request.shell, request.args, {
    name: 'xterm-256color',
    cols: request.cols,
    rows: request.rows,
    cwd: request.cwd,
    env: request.env as { [key: string]: string }
  })
  return {
    pid: pty.pid,
    write: (data) => pty.write(data),
    resize: (cols, rows) => pty.resize(cols, rows),
    kill: () => pty.kill(),
    onData: (listener) => {
      pty.onData(listener)
    },
    onExit: (listener) => {
      pty.onExit((event) => listener({ exitCode: event.exitCode ?? 0 }))
    }
  }
}

const k8sTerminalSessionName = (clusterName: string, index: number) => (index <= 1 ? clusterName : `${clusterName}-${index}`)

const cloneTerminalRecord = (record: KubernetesTerminalRecord): KubernetesTerminalRecord => ({ ...record })

type KubernetesPtySessionHandle = {
  pty: KubernetesPtyProcess | null
  tempDir: string
  disposed: boolean
}

export const createKubernetesTerminalRuntime = (options: KubernetesTerminalRuntimeOptions) => {
  let eventSink: ((event: KubernetesTerminalDataEvent | KubernetesTerminalExitEvent) => void) | null = null
  // PTY 句柄与会话模式是主进程运行态,绝不能进入可序列化的会话记录。
  const ptyHandles = new Map<string, KubernetesPtySessionHandle>()
  const sessionModes = new Map<string, 'pty' | 'simulated'>()

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

  const updateSession = (sessionId: string, update: (session: KubernetesTerminalRecord) => KubernetesTerminalRecord) => {
    let updated: KubernetesTerminalRecord | null = null
    options.setSessions(
      options.sessions().map((session) => {
        if (session.sessionId !== sessionId) return session
        updated = update(session)
        return updated
      })
    )
    return updated as KubernetesTerminalRecord | null
  }

  const disposePtyHandle = (sessionId: string) => {
    const handle = ptyHandles.get(sessionId)
    if (!handle) return
    handle.disposed = true
    try {
      handle.pty?.kill()
    } catch {
      /* PTY 可能已随进程退出。 */
    }
    if (handle.tempDir) {
      void rm(handle.tempDir, { recursive: true, force: true }).catch(() => undefined)
    }
    ptyHandles.delete(sessionId)
  }

  const resolveClusterKubeconfigContent = async (cluster: KubernetesClusterRecord) => {
    if (cluster.kubeconfig_content?.trim()) return cluster.kubeconfig_content
    const kubeconfigPath = options.expandHomePath((cluster.kubeconfig_path || '').trim())
    if (!kubeconfigPath) {
      throw Object.assign(new Error('Kubeconfig path or content is required before opening a Kubernetes terminal.'), { code: 'K8S_KUBECONFIG_REQUIRED' })
    }
    try {
      return await readFile(kubeconfigPath, 'utf-8')
    } catch (error) {
      throw Object.assign(new Error(`Failed to read kubeconfig for terminal session: ${error instanceof Error ? error.message : String(error)}`), {
        code: 'K8S_TERMINAL_KUBECONFIG_READ_FAILED'
      })
    }
  }

  const spawnSessionPty = async (session: KubernetesTerminalRecord, cluster: KubernetesClusterRecord) => {
    const handle: KubernetesPtySessionHandle = { pty: null, tempDir: '', disposed: false }
    ptyHandles.set(session.sessionId, handle)
    try {
      const content = await resolveClusterKubeconfigContent(cluster)
      // 终端持有会话级 kubeconfig 副本并钉住 current-context:
      // 会话内的 `kubectl config use-context` 只影响本会话,永不改写用户真实 kubeconfig。
      const pinned = pinKubeconfigCurrentContext(content, cluster.context_name) ?? content
      handle.tempDir = await mkdtemp(join(tmpdir(), 'aiopsterm-k8s-term-'))
      const kubeconfigPath = join(handle.tempDir, 'config')
      await writeFile(kubeconfigPath, pinned, { encoding: 'utf-8', mode: 0o600 })
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        ...buildKubernetesProxyEnvironment(options.loadAgentProxyConfig()),
        PATH: kubernetesTerminalPath(),
        KUBECONFIG: kubeconfigPath
      }
      const spawner = options.spawnPty() || defaultKubernetesPtySpawner
      const pty = await spawner({
        shell: resolveKubernetesTerminalShell(),
        args: [],
        cols: session.cols,
        rows: session.rows,
        cwd: homedir(),
        env
      })
      if (handle.disposed) {
        try {
          pty.kill()
        } catch {
          /* 已释放。 */
        }
        return
      }
      handle.pty = pty
      pty.onData((chunk) => {
        if (handle.disposed) return
        const clean = sanitizeK8sPtyChunk(chunk)
        if (!clean) return
        const current = findTerminalSession(session.sessionId)
        if (!current || current.status === 'ended' || current.status === 'error') return
        const updated = updateSession(session.sessionId, (item) => ({
          ...item,
          output: appendK8sTerminalStream(item.output, clean),
          updatedAt: options.nowLabel()
        }))
        emitData(updated || current, {
          data: clean,
          command: '',
          output: clean,
          success: true,
          error: ''
        })
      })
      pty.onExit(({ exitCode }) => {
        if (handle.disposed) return
        disposePtyHandle(session.sessionId)
        const current = findTerminalSession(session.sessionId)
        if (!current || current.status === 'ended') return
        const ended = updateSession(session.sessionId, (item) => ({
          ...item,
          status: 'ended',
          updatedAt: options.nowLabel()
        }))
        emitExit(ended || current, { exitCode, reason: 'closed' })
      })
    } catch (error) {
      disposePtyHandle(session.sessionId)
      throw error
    }
  }

  const failClusterSessions = (clusterId: string, error: string) => {
    options.setSessions(
      options.sessions().map((session) => {
        if (session.clusterId !== clusterId || session.status === 'ended' || session.status === 'error') return session
        disposePtyHandle(session.sessionId)
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

  /** 集群连接成功后激活其挂起的终端:PTY 会话此刻才真正拉起 shell。 */
  const activateClusterSessions = async (clusterId: string) => {
    const pending = options.sessions().filter((session) => session.clusterId === clusterId && session.status === 'connecting')
    for (const session of pending) {
      if (sessionModes.get(session.sessionId) === 'pty') {
        try {
          const cluster = options.requireCluster(clusterId)
          await spawnSessionPty(session, cluster)
          updateSession(session.sessionId, (item) => ({ ...item, status: 'connected', updatedAt: options.nowLabel() }))
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          const failed = updateSession(session.sessionId, (item) => ({
            ...item,
            output: appendK8sTerminalOutput(item.output, message),
            status: 'error',
            updatedAt: options.nowLabel()
          }))
          emitExit(failed || session, { exitCode: 1, reason: 'error', error: message })
        }
      } else {
        updateSession(session.sessionId, (item) => ({ ...item, status: 'connected', updatedAt: options.nowLabel() }))
      }
    }
  }

  /** 断开/删除集群时统一释放其终端:杀掉 PTY、清理临时 kubeconfig、通知渲染层。 */
  const disposeClusterSessions = (clusterId: string) => {
    const targets = options.sessions().filter((session) => session.clusterId === clusterId)
    targets.forEach((session) => {
      disposePtyHandle(session.sessionId)
      sessionModes.delete(session.sessionId)
      if (session.status !== 'ended' && session.status !== 'error') {
        emitExit(session, { exitCode: 0, reason: 'disconnect' })
      }
    })
    options.setSessions(options.sessions().filter((session) => session.clusterId !== clusterId))
  }

  const createTerminal = async (input: KubernetesTerminalCreateInput): Promise<KubernetesTerminalCreateResult> => {
    try {
      const cluster = options.requireCluster(input.clusterId)
      const ptyMode = options.canRunLocalKubectl(cluster)
      if (!ptyMode) {
        const nonRunnableReason = options.nonRunnableKubernetesReason(cluster)
        if (nonRunnableReason) {
          options.markClusterRuntimeError(cluster, nonRunnableReason.message)
          options.persistCatalogState()
          throw Object.assign(new Error(nonRunnableReason.message), { code: nonRunnableReason.code })
        }
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
        output: [`Connecting to cluster ${cluster.name}...`, `kubectl context: ${cluster.context_name}`, `namespace: ${namespace}`, ptyMode ? '' : k8sTerminalPrompt(namespace)]
          .filter(Boolean)
          .join('\n'),
        status,
        cols: clampTerminalDimension(input.cols, 80, 20, 240),
        rows: clampTerminalDimension(input.rows, 24, 8, 80),
        createdAt: options.nowLabel(),
        updatedAt: options.nowLabel()
      }
      sessionModes.set(record.sessionId, ptyMode ? 'pty' : 'simulated')
      options.setSessions([...options.sessions(), record])
      if (ptyMode && status === 'connected') {
        try {
          await spawnSessionPty(record, cluster)
        } catch (error) {
          options.setSessions(options.sessions().filter((session) => session.sessionId !== record.sessionId))
          sessionModes.delete(record.sessionId)
          throw error
        }
      }
      const current = findTerminalSession(record.sessionId) || record
      return { ok: true, data: cloneTerminalRecord(current) }
    } catch (error) {
      return toMutationError(error, 'K8S_TERMINAL_CREATE_FAILED')
    }
  }

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
      if (sessionModes.get(current.sessionId) === 'pty') {
        const handle = ptyHandles.get(current.sessionId)
        if (!handle?.pty) {
          throw Object.assign(new Error('Kubernetes terminal is not connected.'), { code: 'K8S_TERMINAL_NOT_CONNECTED' })
        }
        handle.pty.write(text)
        const updated = updateSession(current.sessionId, (item) => ({ ...item, updatedAt: options.nowLabel() })) || current
        // PTY 是异步字节流:写入立即返回,命令输出经 data 事件流式到达。
        return {
          ok: true,
          data: {
            id: updated.id,
            sessionId: updated.sessionId,
            bytes,
            command,
            output: '',
            success: true,
            error: '',
            terminalOutput: '',
            updatedAt: updated.updatedAt
          }
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
      const handle = ptyHandles.get(current.sessionId)
      if (handle?.pty) {
        try {
          handle.pty.resize(updated.cols, updated.rows)
        } catch {
          /* resize 失败不阻断记录更新。 */
        }
      }
      return cloneTerminalRecord(updated)
    })

  const closeTerminal = async (id: string, exitCode = 0): Promise<KubernetesTerminalCloseResult> =>
    asResult(() => {
      const current = findTerminalSession(id)
      if (!current) throw Object.assign(new Error('Kubernetes terminal session not found.'), { code: 'K8S_TERMINAL_NOT_FOUND' })
      disposePtyHandle(current.sessionId)
      sessionModes.delete(current.sessionId)
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
    ;[...ptyHandles.keys()].forEach((sessionId) => disposePtyHandle(sessionId))
    ptyHandles.clear()
    sessionModes.clear()
  }

  return {
    setEventSink,
    failClusterSessions,
    activateClusterSessions,
    disposeClusterSessions,
    createTerminal,
    writeTerminal,
    resizeTerminal,
    closeTerminal,
    reset
  }
}
