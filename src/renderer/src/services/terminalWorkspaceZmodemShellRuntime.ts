import { computed, reactive, ref } from 'vue'
import { createTerminalZmodemRuntime, type TerminalZmodemProgress } from '@/services/zmodemRuntime'
import type { TerminalDataEvent } from '@shared/contracts/terminalSessions'

type TerminalWorkspaceZmodemShellBrowser = {
  setTimer: (callback: () => void, delay: number) => number
  clearTimer: (timer: number) => void
}

export type TerminalWorkspaceZmodemShellRuntimeOptions = {
  getApi: Parameters<typeof createTerminalZmodemRuntime>[0]['getApi']
  appendData: (sessionId: string, data: string) => void
  onNotice: (message: string) => void
  browser?: Partial<TerminalWorkspaceZmodemShellBrowser>
}

export const emptyTerminalWorkspaceZmodemProgress = (): TerminalZmodemProgress => ({
  visible: false,
  type: 'download',
  fileName: '',
  transferred: 0,
  total: 0,
  status: 'running',
  message: ''
})

export const formatTerminalWorkspaceZmodemBytes = (bytes: number) => {
  const value = Math.max(0, Number(bytes) || 0)
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${value} B`
}

const defaultBrowserAdapter = (): TerminalWorkspaceZmodemShellBrowser => ({
  setTimer: (callback, delay) => window.setTimeout(callback, delay),
  clearTimer: (timer) => window.clearTimeout(timer)
})

export const createTerminalWorkspaceZmodemShellRuntime = ({
  getApi,
  appendData,
  onNotice,
  browser = {}
}: TerminalWorkspaceZmodemShellRuntimeOptions) => {
  const resolvedBrowser = { ...defaultBrowserAdapter(), ...browser }
  const zmodemSessionId = ref('')
  const zmodemProgress = reactive<TerminalZmodemProgress>(emptyTerminalWorkspaceZmodemProgress())
  let zmodemProgressHideTimer: number | null = null

  const clearHideTimer = () => {
    if (zmodemProgressHideTimer === null) return
    resolvedBrowser.clearTimer(zmodemProgressHideTimer)
    zmodemProgressHideTimer = null
  }

  const terminalZmodemRuntime = createTerminalZmodemRuntime({
    getApi,
    appendData,
    onProgress: (sessionId, progress) => {
      clearHideTimer()
      zmodemSessionId.value = sessionId
      Object.assign(zmodemProgress, progress)
      if (progress.status !== 'running') {
        zmodemProgressHideTimer = resolvedBrowser.setTimer(() => {
          Object.assign(zmodemProgress, emptyTerminalWorkspaceZmodemProgress())
          zmodemSessionId.value = ''
          zmodemProgressHideTimer = null
        }, 1800)
      }
    },
    onNotice
  })

  const zmodemPercent = computed(() =>
    zmodemProgress.total > 0 ? Math.max(0, Math.min(100, Math.round((zmodemProgress.transferred / zmodemProgress.total) * 100))) : 0
  )

  const handleTerminalData = (event: TerminalDataEvent) => terminalZmodemRuntime.handleTerminalData(event)

  const cancelZmodemTransfer = () => {
    if (!zmodemSessionId.value || zmodemProgress.status !== 'running') return
    void terminalZmodemRuntime.cancel(zmodemSessionId.value)
  }

  const dispose = () => {
    terminalZmodemRuntime.dispose()
    clearHideTimer()
  }

  return {
    cancelZmodemTransfer,
    dispose,
    formatZmodemBytes: formatTerminalWorkspaceZmodemBytes,
    handleTerminalData,
    zmodemPercent,
    zmodemProgress,
    zmodemSessionId
  }
}
