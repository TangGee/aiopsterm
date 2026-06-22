import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useTerminalControlSurface, type TerminalControlSurfaceView } from '@/composables/useTerminalControlSurface'
import { useWorkspaceStore, type TerminalPanel } from '@/stores/workspace'
import { copyTextToClipboard, readTextFromClipboard } from '@/services/clipboardRuntime'
import { controlClient } from '@/services/controlClient'
import { writeRendererRuntimeLog as writeRuntimeLog } from '@/services/runtimeLogClient'
import { terminalClient } from '@/services/terminalClient'
import { createTerminalWorkspaceCommandRuntime, createTerminalWorkspaceCommandState } from '@/services/terminalWorkspaceCommandRuntime'
import { createTerminalWorkspaceLayoutRuntime } from '@/services/terminalWorkspaceLayoutRuntime'
import { createTerminalWorkspaceViewRuntime } from '@/services/terminalWorkspaceViewRuntime'
import { createTerminalZmodemRuntime, type TerminalZmodemProgress } from '@/services/zmodemRuntime'
import { useI18n } from '@/i18n'
import type { TerminalDataEvent, TerminalKillResult } from '@shared/contracts/terminalSessions'

export const useTerminalWorkspaceContainerRuntime = () => {
  const workspace = useWorkspaceStore()
  const { t } = useI18n()
  const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  const isTerminalKillSuccess = (result: TerminalKillResult | null | undefined, sessionId: string) =>
    result?.ok === true && isRecord(result.data) && result.data.id === sessionId
  const renamingId = ref('')
  const renameText = ref('')
  const menu = reactive({ visible: false, x: 0, y: 0, panelId: '' })
  const termMenu = reactive({ visible: false, x: 0, y: 0, panelId: '' })
  const terminalGrid = ref<HTMLElement | null>(null)
  const aiButtonPanelId = ref('')
  const aiButtonPosition = reactive({ top: 0, right: 26 })
  const commandState = createTerminalWorkspaceCommandState()
  const {
    activeSuggestion,
    aiSuggestLoading,
    command,
    commandDialog,
    commandDialogInput,
    commandDialogRef,
    commandLineInput,
    commandLinePanelId,
    globalCommand,
    globalInputVisible,
    hasAiSuggestion,
    search,
    searchMatchCount,
    searchMatchIndex,
    searchOverlayInput,
    searchOverlayPanelId,
    suggestionItems,
    suggestionPanel,
    suggestionPosition,
    suggestionSelectionMode
  } = commandState
  let offData: (() => void) | null = null
  let offLifecycle: (() => void) | null = null
  let offExit: (() => void) | null = null
  let offControlRequest: (() => void) | null = null
  let zmodemProgressHideTimer: number | null = null
  const closeTerminalMenusFromDocument = () => {
    menu.visible = false
    termMenu.visible = false
  }
  const canForkSelected = computed(() => workspace.canForkSshPanel(menu.panelId))
  const isTerminalMenuPanel = computed(() => panelById(menu.panelId)?.kind === 'terminal')
  const isReconnectablePanel = (panel?: TerminalPanel | null) => !panel?.sessionId || panel.status === 'closed' || panel.status === 'error'
  const connectionActionLabel = (panel?: TerminalPanel | null) => {
    if (!panel?.sessionId) {
      if (panel?.sshSession) return panel.status === 'ready' ? '连接 SSH' : '重新连接'
      return panel?.status === 'ready' ? '打开本地 shell' : '重新连接'
    }
    return '断开连接'
  }
  const connectionActionShortcut = (panel?: TerminalPanel | null) => (panel?.sessionId ? 'Ctrl+D' : 'Enter')
  const terminalStatusLabel = (panel: TerminalPanel) => {
    if (panel.kind === 'knowledge') return t('terminal.status.editor')
    if (panel.status === 'connecting') return t('terminal.status.connecting')
    if (panel.status === 'error') return t('terminal.status.error')
    if (panel.status === 'closed') return t('terminal.status.closed')
    return t('terminal.status.connected')
  }
  const pathBaseName = (value?: string) => {
    const normalized = String(value || '').trim().replace(/\\/g, '/').replace(/\/+$/, '')
    if (!normalized) return ''
    if (normalized === '~' || normalized === '/') return normalized
    return normalized.split('/').filter(Boolean).pop() || normalized
  }
  const terminalSshTargetLabel = (panel: TerminalPanel) => {
    const ssh = panel.sshSession
    if (!ssh?.host) return ''
    const userHost = `${ssh.username ? `${ssh.username}@` : ''}${ssh.host}`
    return `${userHost}${ssh.port && ssh.port !== 22 ? `:${ssh.port}` : ''}`
  }
  const terminalTabMeta = (panel: TerminalPanel) => {
    if (panel.kind === 'knowledge') return panel.knowledge?.relPath || panel.cwd || ''
    const sshTarget = terminalSshTargetLabel(panel)
    if (sshTarget) return sshTarget
    return pathBaseName(panel.cwd) || 'local'
  }
  const terminalTabKindBadge = (panel: TerminalPanel) => {
    if (panel.kind === 'knowledge') return 'editor'
    if (panel.sshSession) return 'ssh'
    return ''
  }
  const terminalTabTooltip = (panel: TerminalPanel) => {
    const lines = [
      panel.title,
      `${t('terminal.tab.type')}: ${panel.kind === 'knowledge' ? t('terminal.status.editor') : panel.sshSession ? 'SSH' : t('terminal.kind.localTerminal')}`,
      `${t('terminal.tab.status')}: ${terminalStatusLabel(panel)}`
    ]
    const sshTarget = terminalSshTargetLabel(panel)
    if (sshTarget) lines.push(`${t('terminal.tab.host')}: ${sshTarget}`)
    if (panel.cwd) lines.push(`${t('terminal.tab.path')}: ${panel.cwd}`)
    if (panel.knowledge?.relPath) lines.push(`${t('terminal.tab.file')}: ${panel.knowledge.relPath}`)
    if (panel.sessionId) lines.push(`${t('terminal.tab.session')}: ${panel.sessionId}`)
    return lines.filter(Boolean).join('\n')
  }
  const terminalContextKindLabel = (panel: TerminalPanel) => {
    if (panel.kind === 'knowledge') return t('terminal.kind.editor')
    if (panel.sshSession) return 'SSH'
    return t('terminal.kind.local')
  }
  const pendingAiSessionsForPanel = (panel: TerminalPanel) =>
    workspace.managedAiSessions.filter(
      (session) => session.state === 'needsInput' && (session.panelId === panel.id || Boolean(panel.sessionId && session.terminalSessionId === panel.sessionId))
    )
  const terminalContextText = (panel: TerminalPanel) => {
    const pendingSessions = pendingAiSessionsForPanel(panel)
    return [
      `Title: ${panel.title}`,
      `Type: ${terminalContextKindLabel(panel)}`,
      `Status: ${terminalStatusLabel(panel)}`,
      terminalSshTargetLabel(panel) ? `Host: ${terminalSshTargetLabel(panel)}` : '',
      panel.cwd ? `CWD: ${panel.cwd}` : '',
      panel.knowledge?.relPath ? `File: ${panel.knowledge.relPath}` : '',
      panel.sessionId ? `Terminal Session: ${panel.sessionId}` : '',
      pendingSessions.length ? `Pending AI: ${pendingSessions.map((session) => `${session.source}/${session.title}`).join(', ')}` : ''
    ]
      .filter(Boolean)
      .join('\n')
  }
  const panelNeedsAiAttention = (panel: TerminalPanel) =>
    workspace.managedAiSessionNeedsAttentionForPanel(panel.id) || Boolean(panel.sessionId && workspace.managedAiSessionNeedsAttentionForPanel(panel.sessionId))

  const isWelcomePlaceholderPanel = (panel?: TerminalPanel | null) =>
    Boolean(
      panel &&
        panel.id === 'panel-main' &&
        panel.kind !== 'knowledge' &&
        panel.title === '欢迎' &&
        !panel.sessionId &&
        !panel.output &&
        !panel.outputSegments.length &&
        !panel.sshSession &&
        panel.status === 'ready' &&
        !panel.split &&
        !panel.splitGroupId
    )
  const layoutEffects = {
    focusActivePanel: () => focusActivePanel(),
    refitAfterLayoutChange: () => refitAfterLayoutChange()
  }
  const {
    activeTerminalPanel,
    connectedTerminalPanels,
    handlePaneDragEnter,
    handlePaneDragLeave,
    handlePaneDragOver,
    handlePaneDrop,
    handleTabBarDragLeave,
    handleTabBarDragOver,
    handleTabBarDrop,
    handleTabDragEnd,
    handleTabDragEnter,
    handleTabDragLeave,
    handleTabDragOver,
    handleTabDragStart,
    handleTabDrop,
    paneDragOverPanelId,
    showTerminalDashboard,
    splitLayoutItems,
    tabBarDragOver,
    tabDragOverPanelId,
    terminalGridClasses,
    visibleTerminalPanels,
    visibleTerminalTabPanels
  } = createTerminalWorkspaceLayoutRuntime({
    workspace,
    isWelcomePlaceholderPanel,
    effects: layoutEffects
  })

  const activeTerminalContextBar = computed(() => {
    const panel = activeTerminalPanel.value
    if (!panel || isWelcomePlaceholderPanel(panel)) return null
    const pendingAiCount = pendingAiSessionsForPanel(panel).length
    return {
      title: panel.title,
      kindLabel: terminalContextKindLabel(panel),
      statusLabel: terminalStatusLabel(panel),
      target: terminalSshTargetLabel(panel),
      path: panel.knowledge?.relPath || panel.cwd,
      pendingAiCount,
      focusable: panel.kind !== 'knowledge',
      text: terminalContextText(panel)
    }
  })
  const openAiSessionsFromContextBar = () => {
    workspace.activeModule = 'aiSessions'
    workspace.leftPanelOpen = true
  }
  const refreshAiSessionsFromContextBar = async () => {
    const refreshed = await workspace.refreshManagedAiSessions()
    if (!refreshed && !workspace.managedAiSessionsError) workspace.setTopNotice(t('terminal.context.refreshFailed'))
  }
  const focusActiveTerminalFromContextBar = () => {
    const panel = activeTerminalPanel.value
    if (!panel || panel.kind === 'knowledge') return
    workspace.activeModule = 'workspace'
    workspace.activePanelId = panel.id
    focusPanel(panel.id)
  }
  const copyActiveTerminalContext = async () => {
    const context = activeTerminalContextBar.value
    if (!context) return
    const copied = await copyTextToClipboard(context.text)
    workspace.setTopNotice(copied ? t('terminal.context.copied') : t('terminal.context.copyFailed'))
  }
  const emptyZmodemProgress = (): TerminalZmodemProgress => ({
    visible: false,
    type: 'download',
    fileName: '',
    transferred: 0,
    total: 0,
    status: 'running',
    message: ''
  })

  const zmodemSessionId = ref('')
  const zmodemProgress = reactive<TerminalZmodemProgress>(emptyZmodemProgress())
  const zmodemPercent = computed(() =>
    zmodemProgress.total > 0 ? Math.max(0, Math.min(100, Math.round((zmodemProgress.transferred / zmodemProgress.total) * 100))) : 0
  )

  const formatZmodemBytes = (bytes: number) => {
    const value = Math.max(0, Number(bytes) || 0)
    if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
    if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`
    return `${value} B`
  }

  const terminalZmodemRuntime = createTerminalZmodemRuntime({
    getApi: () => window.aiops,
    appendData: (sessionId, data) => workspace.appendTerminalOutput(sessionId, data),
    onProgress: (sessionId, progress) => {
      if (zmodemProgressHideTimer !== null) {
        window.clearTimeout(zmodemProgressHideTimer)
        zmodemProgressHideTimer = null
      }
      zmodemSessionId.value = sessionId
      Object.assign(zmodemProgress, progress)
      if (progress.status !== 'running') {
        zmodemProgressHideTimer = window.setTimeout(() => {
          Object.assign(zmodemProgress, emptyZmodemProgress())
          zmodemSessionId.value = ''
          zmodemProgressHideTimer = null
        }, 1800)
      }
    },
    onNotice: (message) => workspace.setTopNotice(message)
  })

  const writeXtermInput = async (panelId: string, data: string) => {
    const panel = workspace.panels.find((item) => item.id === panelId || item.sessionId === panelId)
    const sessionId = panel?.sessionId
    const bytes = new TextEncoder().encode(data).length
    if (!panel || !sessionId) {
      workspace.setTopNotice('终端会话不可用，请先打开本地 shell 或连接 SSH')
      writeRuntimeLog('warn', 'renderer.terminal-input.missing-session', {
        panelId,
        bytes
      })
      return
    }
    const writeTerminal = terminalClient.writeTerminal()
    if (!writeTerminal) {
      workspace.setTopNotice('终端写入服务不可用')
      writeRuntimeLog('warn', 'renderer.terminal-input.missing-bridge', {
        panelId,
        sessionId,
        bytes
      })
      return
    }
    try {
      writeRuntimeLog('debug', 'renderer.terminal-input.write-request', {
        panelId,
        sessionId,
        bytes
      })
      const result = await writeTerminal(sessionId, data)
      if (!result?.ok || !isRecord(result.data) || result.data.id !== sessionId || result.data.bytes !== bytes) {
        workspace.setTopNotice(result?.errorMessage || '终端写入服务返回数据无效')
        writeRuntimeLog('warn', 'renderer.terminal-input.write-rejected', {
          panelId,
          sessionId,
          bytes,
          ok: result?.ok,
          errorCode: result?.errorCode,
          errorMessage: result?.errorMessage
        })
        return
      }
      writeRuntimeLog('debug', 'renderer.terminal-input.write-accepted', {
        panelId,
        sessionId,
        bytes
      })
    } catch (error) {
      const message = error instanceof Error && error.message.trim() ? error.message.trim() : '终端写入失败，请重新打开本地 shell 或连接 SSH'
      workspace.setTopNotice(message)
      writeRuntimeLog('error', 'renderer.terminal-input.write-error', {
        panelId,
        sessionId,
        bytes,
        message
      })
    }
  }

  const {
    activeView,
    applyTerminalSettingsToAll,
    dispose: disposeTerminalViews,
    estimateTerminalCellSize,
    focusActivePanel,
    focusPanel,
    getTerminalElement,
    refitAfterLayoutChange,
    scheduleTerminalFit,
    scheduleVisibleTerminalFit,
    setTerminalElement,
    syncPanelViews,
    syncTerminalView,
    terminalSettingsSignature,
    terminalViewSize,
    terminalViews,
    terminalFontSizeForPanel,
    updateFontSize,
    updateSelectionButtonPosition,
    updateSuggestionsPosition
  } = createTerminalWorkspaceViewRuntime({
    workspace,
    visibleTerminalPanels,
    aiButtonPanelId,
    aiButtonPosition,
    suggestionPanel,
    suggestionPosition,
    suggestionItems,
    aiSuggestLoading,
    writeXtermInput
  })

  const {
    applyGeneratedCommand,
    applySuggestion,
    approveSecurityPrompt,
    cancelSecurityPrompt,
    clearSearchFromButton,
    closeCommandDialog,
    closeCommandLine,
    closeSearchOverlay,
    commandDialogStyle,
    commandLineStyle,
    enterSuggestionSelection,
    findNext,
    findPrevious,
    focusCommandDialogInput,
    getCommandDialogInput,
    hideCommandDialogForActivePanel,
    hideSuggestions,
    moveSuggestion,
    openCommandDialog,
    openCommandDialogFromTabMenu,
    openCommandDialogFromTermMenu,
    openCommandLineFromMenu,
    openSearchOverlay,
    resizeCommandDialogInput,
    sendCommand,
    sendGlobalCommand,
    submitCommandDialog,
    toggleGlobalInput,
    triggerAiSuggestion,
    updateSuggestions
  } = createTerminalWorkspaceCommandRuntime({
    workspace,
    state: commandState,
    menu,
    termMenu,
    aiButtonPanelId,
    activeView,
    estimateTerminalCellSize,
    focusActivePanel,
    focusPanel,
    getTerminalElement,
    syncTerminalView,
    terminalViews,
    updateSuggestionsPosition
  })

  const getPanelTitle = (panelId: string) => workspace.panels.find((panel) => panel.id === panelId)?.title || ''

  const activatePanel = (panelId: string) => {
    workspace.activePanelId = panelId
    focusPanel(panelId)
  }

  const openMenu = (event: MouseEvent, panelId: string) => {
    const position = clampFloatingMenuPosition(event, 154, 320)
    menu.visible = true
    menu.x = position.x
    menu.y = position.y
    menu.panelId = panelId
    termMenu.visible = false
    aiButtonPanelId.value = ''
  }

  const openTerminalMenu = (event: MouseEvent, panelId: string) => {
    const position = clampFloatingMenuPosition(event, 214, 560)
    workspace.activePanelId = panelId
    hideSuggestions()
    termMenu.visible = true
    termMenu.x = position.x
    termMenu.y = position.y
    termMenu.panelId = panelId
    menu.visible = false
    aiButtonPanelId.value = ''
  }

  const clampFloatingMenuPosition = (event: MouseEvent, width: number, height: number) => {
    const padding = 8
    const maxX = Math.max(padding, window.innerWidth - width - padding)
    const maxY = Math.max(padding, window.innerHeight - height - padding)
    return {
      x: Math.max(padding, Math.min(event.clientX, maxX)),
      y: Math.max(padding, Math.min(event.clientY, maxY))
    }
  }

  const handleTerminalContextMenu = async (panelId: string, event: MouseEvent) => {
    workspace.activePanelId = panelId
    switch (workspace.terminalSettings.rightMouseEvent) {
      case 'paste':
        await pasteClipboard(panelId)
        break
      case 'contextMenu':
        openTerminalMenu(event, panelId)
        break
      case 'none':
        termMenu.visible = false
        aiButtonPanelId.value = ''
        break
    }
  }

  const handleTerminalMouseDown = async (panelId: string, event: MouseEvent) => {
    workspace.activePanelId = panelId
    if (event.button !== 1) return
    event.preventDefault()
    switch (workspace.terminalSettings.middleMouseEvent) {
      case 'paste':
        await pasteClipboard(panelId)
        break
      case 'contextMenu':
        openTerminalMenu(event, panelId)
        break
      case 'closeTab':
        workspace.closePanel(panelId)
        termMenu.visible = false
        break
      case 'none':
        termMenu.visible = false
        aiButtonPanelId.value = ''
        break
    }
  }

  const startRename = (panelId: string, title: string) => {
    renamingId.value = panelId
    renameText.value = title
  }

  const finishRename = () => {
    workspace.renamePanel(renamingId.value, renameText.value)
    renamingId.value = ''
  }

  const closeSelected = () => {
    workspace.closePanel(menu.panelId)
    menu.visible = false
  }

  const closeTab = (panelId: string) => {
    workspace.closePanel(panelId)
    menu.visible = false
    termMenu.visible = false
    nextTick(() => scheduleVisibleTerminalFit({ scrollToBottom: true, frames: 3, forceGeometry: true }))
  }

  const closeOtherTabsFromMenu = () => {
    workspace.activePanelId = menu.panelId
    workspace.closeOthers()
    menu.visible = false
  }

  const closeAllTabsFromMenu = () => {
    workspace.closeAllPanels()
    menu.visible = false
  }

  const renameSelected = () => {
    startRename(menu.panelId, getPanelTitle(menu.panelId))
    menu.visible = false
  }

  const cloneSelected = () => {
    const source = workspace.panels.find((panel) => panel.id === menu.panelId)
    const sourcePanelId = source?.id
    workspace.createPanel()
    if (source) {
      workspace.renamePanel(workspace.activePanelId, `${source.title} copy`)
      const panel = panelById(workspace.activePanelId)
      if (panel) {
        panel.cwd = source.cwd
        panel.sshSession = source.sshSession
          ? {
              ...source.sshSession,
              connectionId: undefined,
              sourcePanelId
            }
          : undefined
      }
    }
    menu.visible = false
  }

  const startLocalTerminalForPanel = async (panel: TerminalPanel) => {
    const createTerminal = terminalClient.createTerminal()
    if (!createTerminal) {
      workspace.setTopNotice('本地终端启动服务不可用')
      return false
    }
    await nextTick()
    const size = terminalViewSize(panel.id)
    try {
      const session = await createTerminal({
        kind: 'local',
        panelId: panel.id,
        workspaceId: 'workspace',
        cols: size.cols,
        rows: size.rows,
        terminalType: workspace.terminalSettings.terminalType
      })
      const connected = Boolean(workspace.applyLocalTerminalSession(panel.id, session))
      if (!connected) workspace.setTopNotice('本地终端启动失败')
      return connected
    } catch (error) {
      workspace.setTopNotice(error instanceof Error ? error.message : '本地终端启动失败')
      return false
    }
  }

  const startSshTerminalForPanel = async (panel: TerminalPanel) => {
    const ssh = panel.sshSession
    if (!ssh) return false
    const createTerminal = terminalClient.createTerminal()
    if (!createTerminal) {
      workspace.setTopNotice('SSH 终端启动服务不可用')
      return false
    }
    await nextTick()
    const size = terminalViewSize(panel.id)
    try {
      const session = await createTerminal({
        kind: 'ssh',
        assetId: ssh.assetId,
        title: panel.title,
        cols: size.cols,
        rows: size.rows,
        terminalType: workspace.terminalSettings.terminalType,
        ssh: {
          host: ssh.host,
          port: ssh.port,
          username: ssh.username,
          needProxy: Boolean(ssh.needProxy),
          proxyName: ssh.proxyName || '',
          ...(ssh.forkFromConnectionId ? { forkFromConnectionId: ssh.forkFromConnectionId } : {})
        }
      })
      const connected = Boolean(workspace.applySshTerminalSession(panel.id, session, {
        id: ssh.assetId,
        name: ssh.assetName,
        title: ssh.assetName,
        host: ssh.host,
        port: ssh.port,
        username: ssh.username,
        group_name: ssh.organizationId,
        asset_type: ssh.assetType,
        auth_type: ssh.authType,
        needProxy: ssh.needProxy,
        proxyName: ssh.proxyName
      }))
      if (!connected) workspace.setTopNotice('SSH 终端启动失败')
      return connected
    } catch (error) {
      workspace.setTopNotice(error instanceof Error ? error.message : 'SSH 终端启动失败')
      return false
    }
  }

  const connectSplitPanelFromSource = async (panel: TerminalPanel, sourcePanel?: TerminalPanel | null) => {
    if (!sourcePanel?.sessionId || sourcePanel.status === 'closed' || sourcePanel.status === 'error') return false
    return panel.sshSession ? startSshTerminalForPanel(panel) : startLocalTerminalForPanel(panel)
  }

  const createSplitPanel = async (direction: 'right' | 'below', sourcePanelId: string) => {
    const sourcePanel = panelById(sourcePanelId)
    workspace.activePanelId = sourcePanelId
    const panel = workspace.createPanel(direction)
    await nextTick()
    void connectSplitPanelFromSource(panel, sourcePanel)
    return panel
  }

  const splitSelected = (direction: 'right' | 'below') => {
    void createSplitPanel(direction, menu.panelId)
    menu.visible = false
  }

  const unsplitSelected = () => {
    workspace.unsplitPanel(menu.panelId)
    menu.visible = false
    refitAfterLayoutChange()
    focusActivePanel()
  }

  const forkSelected = async () => {
    const sourcePanelId = menu.panelId
    const forkPanel = workspace.forkSshPanel(menu.panelId)
    menu.visible = false
    if (!forkPanel) return
    const pendingSsh = forkPanel.sshSession ? { ...forkPanel.sshSession } : null
    const connected = await startSshTerminalForPanel(forkPanel)
    if (!connected) {
      workspace.discardPendingTerminalPanel(forkPanel.id, sourcePanelId)
      return
    }
    const ssh = forkPanel.sshSession
    if (!ssh) return
    const contextId = pendingSsh?.assetId || ssh.assetId || ssh.connectionId || forkPanel.id
    workspace.selectedContexts = [
      ...workspace.selectedContexts.filter((item) => item.id !== contextId),
      {
        id: contextId,
        kind: 'hosts',
        label: pendingSsh?.host || ssh.host,
        detail: `${pendingSsh?.assetName || ssh.assetName} fork`
      }
    ]
  }

  const panelById = (panelId: string) => workspace.panels.find((panel) => panel.id === panelId)

  const copySelection = async (panelId = workspace.activePanelId) => {
    const selectedText = terminalViews.get(panelId)?.terminal.getSelection()
    if (selectedText) {
      const copied = await copyTextToClipboard(selectedText)
      workspace.setTopNotice(copied ? '终端内容已复制' : '终端复制失败')
    }
    menu.visible = false
    termMenu.visible = false
  }

  const pasteClipboard = async (panelId = workspace.activePanelId) => {
    const clipboardRead = await readTextFromClipboard()
    if (!clipboardRead.ok) {
      if (clipboardRead.error === 'unavailable') {
        workspace.setTopNotice('终端剪贴板读取服务不可用')
      } else {
        workspace.setTopNotice(clipboardRead.message || '终端剪贴板读取失败')
      }
      termMenu.visible = false
      return
    }
    const text = clipboardRead.text
    if (!text) {
      termMenu.visible = false
      return
    }
    const panel = panelById(panelId)
    if (!panel || panel.kind === 'knowledge') {
      termMenu.visible = false
      return
    }
    const result = await workspace.runTerminalCommand(panel.id, text, {
      inputText: text,
      shellText: text,
      writeToShell: true,
      source: 'direct'
    })
    if (result?.status === 'allow') syncTerminalView(panel)
    menu.visible = false
    termMenu.visible = false
  }

  const clearTerminal = (panelId = workspace.activePanelId) => {
    const panel = panelById(panelId)
    if (!panel || panel.kind === 'knowledge') return
    workspace.replaceTerminalOutput(panel.id, '')
    const view = terminalViews.get(panelId)
    view?.terminal.clear()
    if (view) view.lastOutput = ''
    menu.visible = false
    termMenu.visible = false
  }

  const increaseFont = (panelId = workspace.activePanelId) => updateFontSize(panelId, terminalFontSizeForPanel(panelId) + 1)
  const decreaseFont = (panelId = workspace.activePanelId) => updateFontSize(panelId, terminalFontSizeForPanel(panelId) - 1)
  const increaseFontFromMenu = () => {
    increaseFont(termMenu.panelId || workspace.activePanelId)
    termMenu.visible = false
    menu.visible = false
  }
  const decreaseFontFromMenu = () => {
    decreaseFont(termMenu.panelId || workspace.activePanelId)
    termMenu.visible = false
    menu.visible = false
  }

  const handleTerminalWheel = (panelId: string, event: WheelEvent) => {
    if (!workspace.terminalSettings.pinchZoomStatus || (!event.ctrlKey && !event.metaKey)) return
    event.preventDefault()
    if (event.deltaY < 0) increaseFont(panelId)
    if (event.deltaY > 0) decreaseFont(panelId)
  }

  const reconnectTerminalPanel = async (panel: TerminalPanel) => {
    return panel.sshSession ? startSshTerminalForPanel(panel) : startLocalTerminalForPanel(panel)
  }

  const disconnectTerminalPanel = async (panel: TerminalPanel) => {
    if (!panel.sessionId) {
      workspace.setTopNotice('终端会话不可用，请先打开本地 shell 或连接 SSH')
      return false
    }
    const killTerminal = terminalClient.killTerminal()
    if (!killTerminal) {
      workspace.setTopNotice('终端断开服务不可用')
      return false
    }
    const sessionId = panel.sessionId
    let result: TerminalKillResult
    try {
      result = await killTerminal(sessionId)
    } catch (error) {
      workspace.setTopNotice(error instanceof Error ? error.message : '终端断开失败')
      return false
    }
    if (!result?.ok || !isTerminalKillSuccess(result, sessionId)) {
      workspace.setTopNotice(result?.ok ? '终端断开失败' : result?.errorMessage || '终端断开失败')
      return false
    }
    if (panel.sessionId === sessionId) {
      panel.sessionId = undefined
      panel.status = 'closed'
    }
    return true
  }

  const terminalControlSurface = useTerminalControlSurface({
    workspace,
    terminalViews: terminalViews as unknown as Map<string, TerminalControlSurfaceView>,
    visibleTerminalPanels,
    isWelcomePlaceholderPanel,
    terminalViewSize,
    startSshTerminalForPanel,
    disconnectTerminalPanel,
    scheduleVisibleTerminalFit
  })
  const controlFlashingPanelIds = terminalControlSurface.controlFlashingPanelIds
  const handleControlRequest = terminalControlSurface.handleControlRequest

  const togglePanelConnection = async (panelId: string) => {
    const panel = panelById(panelId)
    if (!panel || panel.kind === 'knowledge') return
    const wasNeverConnected = !panel.sessionId && panel.status === 'ready'
    if (!panel.sessionId) {
      const connected = await reconnectTerminalPanel(panel)
      if (connected) workspace.setTopNotice(wasNeverConnected && !panel.sshSession ? '本地 shell 已打开' : '终端已重新连接')
    } else {
      const disconnected = await disconnectTerminalPanel(panel)
      if (disconnected) workspace.setTopNotice('终端已断开连接')
    }
    syncTerminalView(panel)
    termMenu.visible = false
  }

  const toggleTabConnectionFromMenu = async () => {
    await togglePanelConnection(menu.panelId)
    menu.visible = false
  }

  const createTerminalFromMenu = () => {
    workspace.createPanel()
    termMenu.visible = false
  }

  const closeTerminalFromMenu = () => {
    workspace.closePanel(termMenu.panelId)
    termMenu.visible = false
  }

  const splitFromTermMenu = (direction: 'right' | 'below') => {
    void createSplitPanel(direction, termMenu.panelId)
    termMenu.visible = false
  }

  const unsplitFromTermMenu = () => {
    workspace.unsplitPanel(termMenu.panelId)
    termMenu.visible = false
    refitAfterLayoutChange()
    focusActivePanel()
  }

  const openFileManagerFromMenu = () => {
    void workspace.ensureFileSessionForTerminalPanel(termMenu.panelId || workspace.activePanelId)
    termMenu.visible = false
  }

  const handleTerminalData = (event: TerminalDataEvent) => {
    if (!terminalZmodemRuntime.handleTerminalData(event)) {
      workspace.appendTerminalOutput(event.id, event.data)
    }
  }

  const cancelZmodemTransfer = () => {
    if (!zmodemSessionId.value || zmodemProgress.status !== 'running') return
    void terminalZmodemRuntime.cancel(zmodemSessionId.value)
  }

  const handleTerminalMouseUp = (panelId: string, event: MouseEvent) => {
    if (event.button !== 0 || termMenu.visible || searchOverlayPanelId.value === panelId) {
      aiButtonPanelId.value = ''
      return
    }
    updateSelectionButtonPosition(panelId)
  }

  const chatSelectionToAi = (panelId: string) => {
    const view = terminalViews.get(panelId)
    const selected = view?.terminal.getSelection().trim()
    if (selected) {
      workspace.rightPanelOpen = true
      workspace.selectedContexts = [...workspace.selectedContexts.filter((item) => item.id !== `terminal-${panelId}`), { id: `terminal-${panelId}`, kind: 'hosts', label: `Terminal selection: ${selected.slice(0, 24)}` }]
      void workspace.sendChat(`Terminal output:\n\`\`\`\n${selected}\n\`\`\``, undefined, undefined, { skipKnowledgeSearch: true })
      view?.terminal.clearSelection()
    }
    aiButtonPanelId.value = ''
  }

  onMounted(() => {
    offData = terminalClient.onTerminalData()?.(handleTerminalData) || null
    offLifecycle = terminalClient.onTerminalLifecycle()?.((event) => workspace.applyTerminalLifecycle(event)) || null
    offExit = terminalClient.onTerminalExit()?.((event) => workspace.applyTerminalExit(event)) || null
    offControlRequest = controlClient.onControlRequest()?.(handleControlRequest) || null
    document.addEventListener('click', closeTerminalMenusFromDocument)
    window.addEventListener('keydown', handleShortcut)
  })

  onUnmounted(() => {
    offData?.()
    offLifecycle?.()
    offExit?.()
    offControlRequest?.()
    terminalControlSurface.dispose()
    terminalZmodemRuntime.dispose()
    if (zmodemProgressHideTimer !== null) {
      window.clearTimeout(zmodemProgressHideTimer)
      zmodemProgressHideTimer = null
    }
    disposeTerminalViews()
    document.removeEventListener('click', closeTerminalMenusFromDocument)
    window.removeEventListener('keydown', handleShortcut)
  })

  const handleShortcut = async (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault()
      openSearchOverlay(workspace.activePanelId)
      return
    }
    if (event.key === 'Escape') {
      menu.visible = false
      termMenu.visible = false
      closeSearchOverlay()
      if (commandDialog.visible) closeCommandDialog()
      hideSuggestions()
      return
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault()
      if (commandDialog.visible) {
        const activeInput = getCommandDialogInput()
        if (document.activeElement === activeInput) {
          focusPanel(commandDialog.panelId)
        } else {
          focusCommandDialogInput()
        }
        return
      }
      void openCommandDialog(workspace.activePanelId)
      return
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') {
      event.preventDefault()
      clearTerminal()
      return
    }
    if ((event.ctrlKey || event.metaKey) && event.key === '=') {
      event.preventDefault()
      increaseFont(workspace.activePanelId)
      return
    }
    if ((event.ctrlKey || event.metaKey) && event.key === '-') {
      event.preventDefault()
      decreaseFont(workspace.activePanelId)
      return
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'm') {
      event.preventDefault()
      await workspace.ensureFileSessionForTerminalPanel(workspace.activePanelId)
    }
  }

  watch(
    () =>
      workspace.panels
        .filter((panel) => panel.kind !== 'knowledge')
        .map((panel) => `${panel.id}:${panel.output.length}:${panel.outputSegments?.length || 0}:${panel.title}`)
        .join('|') + `${workspace.extensionSettings.highlightStatus}|${JSON.stringify(workspace.keywordHighlightSettings)}`,
    () => {
      nextTick(() => workspace.panels.filter((panel) => panel.kind !== 'knowledge').forEach((panel) => syncTerminalView(panel)))
    }
  )

  watch(
    () => workspace.panels.map((panel) => panel.id).join('|'),
    syncPanelViews
  )

  watch(
    terminalSettingsSignature,
    applyTerminalSettingsToAll
  )

  watch(
    () => splitLayoutItems.value.map(({ panel, style }) => `${panel.id}:${panel.splitGroupId || ''}:${panel.split || ''}:${JSON.stringify(style)}`).join('|'),
    () => {
      refitAfterLayoutChange()
    },
    { flush: 'post' }
  )

  watch(
    () => workspace.activePanelId,
    (panelId, previousPanelId) => {
      if (previousPanelId && previousPanelId !== panelId && workspace.panels.some((panel) => panel.id === previousPanelId)) {
        terminalControlSurface.recordLastActiveControlPanel(previousPanelId)
      }
      hideCommandDialogForActivePanel(panelId)
    }
  )

  return {
    activeSuggestion,
    activeTerminalContextBar,
    activatePanel,
    aiButtonPanelId,
    aiButtonPosition,
    aiSuggestLoading,
    applyGeneratedCommand,
    applySuggestion,
    approveSecurityPrompt,
    canForkSelected,
    cancelSecurityPrompt,
    cancelZmodemTransfer,
    chatSelectionToAi,
    clearSearchFromButton,
    clearTerminal,
    cloneSelected,
    closeAllTabsFromMenu,
    closeCommandDialog,
    closeCommandLine,
    closeOtherTabsFromMenu,
    closeSearchOverlay,
    closeSelected,
    closeTab,
    closeTerminalFromMenu,
    command,
    commandDialog,
    commandDialogInput,
    commandDialogRef,
    commandDialogStyle,
    commandLineInput,
    commandLinePanelId,
    commandLineStyle,
    connectedTerminalPanels,
    connectionActionLabel,
    connectionActionShortcut,
    controlFlashingPanelIds,
    copyActiveTerminalContext,
    copySelection,
    createTerminalFromMenu,
    decreaseFontFromMenu,
    enterSuggestionSelection,
    findNext,
    findPrevious,
    finishRename,
    forkSelected,
    formatZmodemBytes,
    focusActiveTerminalFromContextBar,
    globalCommand,
    globalInputVisible,
    handlePaneDragEnter,
    handlePaneDragLeave,
    handlePaneDragOver,
    handlePaneDrop,
    handleTabBarDragLeave,
    handleTabBarDragOver,
    handleTabBarDrop,
    handleTabDragEnd,
    handleTabDragEnter,
    handleTabDragLeave,
    handleTabDragOver,
    handleTabDragStart,
    handleTabDrop,
    handleTerminalContextMenu,
    handleTerminalMouseDown,
    handleTerminalMouseUp,
    handleTerminalWheel,
    hasAiSuggestion,
    increaseFontFromMenu,
    isTerminalMenuPanel,
    menu,
    moveSuggestion,
    openAiSessionsFromContextBar,
    openCommandDialogFromTabMenu,
    openCommandDialogFromTermMenu,
    openCommandLineFromMenu,
    openFileManagerFromMenu,
    openMenu,
    openSearchOverlay,
    panelById,
    paneDragOverPanelId,
    panelNeedsAiAttention,
    pasteClipboard,
    refreshAiSessionsFromContextBar,
    renameSelected,
    renameText,
    renamingId,
    resizeCommandDialogInput,
    search,
    searchMatchCount,
    searchMatchIndex,
    searchOverlayInput,
    searchOverlayPanelId,
    sendCommand,
    sendGlobalCommand,
    setTerminalElement,
    showTerminalDashboard,
    splitFromTermMenu,
    splitLayoutItems,
    splitSelected,
    startRename,
    submitCommandDialog,
    suggestionItems,
    suggestionPanel,
    suggestionPosition,
    suggestionSelectionMode,
    t,
    tabBarDragOver,
    tabDragOverPanelId,
    termMenu,
    terminalGrid,
    terminalGridClasses,
    terminalStatusLabel,
    terminalTabKindBadge,
    terminalTabMeta,
    terminalTabTooltip,
    toggleGlobalInput,
    togglePanelConnection,
    toggleTabConnectionFromMenu,
    triggerAiSuggestion,
    unsplitFromTermMenu,
    unsplitSelected,
    updateSuggestions,
    visibleTerminalTabPanels,
    workspace,
    zmodemPercent,
    zmodemProgress,
  }
}
