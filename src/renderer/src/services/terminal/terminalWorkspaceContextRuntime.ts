import { computed, type ComputedRef } from 'vue'
import type { I18nKey } from '@/i18n'
import type { TerminalPanel, useWorkspaceStore } from '@/stores/workspace'

type WorkspaceStore = ReturnType<typeof useWorkspaceStore>

type TerminalWorkspaceContextRuntimeInput = {
  workspace: WorkspaceStore
  activeTerminalPanel: ComputedRef<TerminalPanel | undefined>
  isWelcomePlaceholderPanel: (panel?: TerminalPanel | null) => boolean
  t: (key: I18nKey, params?: Record<string, string | number>) => string
}

const pathBaseName = (value?: string) => {
  const normalized = String(value || '').trim().replace(/\\/g, '/').replace(/\/+$/, '')
  if (!normalized) return ''
  if (normalized === '~' || normalized === '/') return normalized
  return normalized.split('/').filter(Boolean).pop() || normalized
}

export const createTerminalWorkspaceContextRuntime = ({ workspace, activeTerminalPanel, isWelcomePlaceholderPanel, t }: TerminalWorkspaceContextRuntimeInput) => {
  const terminalStatusLabel = (panel: TerminalPanel) => {
    if (panel.kind === 'knowledge') return t('terminal.status.editor')
    if (panel.kind === 'managed-ai-session') return t('terminal.status.aiSessionContent')
    if (panel.status === 'connecting') return t('terminal.status.connecting')
    if (panel.status === 'error') return t('terminal.status.error')
    if (panel.status === 'closed') return t('terminal.status.closed')
    return t('terminal.status.connected')
  }

  const terminalSshTargetLabel = (panel: TerminalPanel) => {
    const ssh = panel.sshSession
    if (!ssh?.host) return ''
    const userHost = `${ssh.username ? `${ssh.username}@` : ''}${ssh.host}`
    return `${userHost}${ssh.port && ssh.port !== 22 ? `:${ssh.port}` : ''}`
  }

  const terminalTabMeta = (panel: TerminalPanel) => {
    if (panel.kind === 'knowledge') return panel.knowledge?.relPath || panel.cwd || ''
    if (panel.kind === 'managed-ai-session') return panel.managedAiSession ? `${panel.managedAiSession.source}:${panel.managedAiSession.sessionId}` : panel.cwd
    const sshTarget = terminalSshTargetLabel(panel)
    if (sshTarget) return sshTarget
    return pathBaseName(panel.cwd) || 'local'
  }

  const terminalTabKindBadge = (panel: TerminalPanel) => {
    if (panel.kind === 'knowledge') return 'editor'
    if (panel.kind === 'managed-ai-session') return 'AI'
    return ''
  }

  const terminalTabShowsState = (panel: TerminalPanel) =>
    Boolean(panel.terminalProgress || panel.status === 'connecting' || panel.status === 'error' || panel.status === 'closed')

  const terminalTabStateClass = (panel: TerminalPanel) =>
    panel.terminalProgress ? `progress-${panel.terminalProgress.status}` : panel.status

  const terminalTabStateLabel = (panel: TerminalPanel) => {
    const progress = panel.terminalProgress
    if (!progress) return terminalStatusLabel(panel)
    const label =
      progress.status === 'running'
        ? t('terminal.progress.running')
        : progress.status === 'error'
          ? t('terminal.progress.error')
          : progress.status === 'indeterminate'
            ? t('terminal.progress.indeterminate')
            : t('terminal.progress.paused')
    return progress.value === undefined ? label : `${label} ${progress.value}%`
  }

  const terminalTabProgressStyle = (panel: TerminalPanel) =>
    panel.terminalProgress?.value === undefined
      ? {}
      : { '--terminal-tab-progress': `${panel.terminalProgress.value}%` }

  const terminalTabTooltip = (panel: TerminalPanel) => {
    const lines = [
      panel.title,
      `${t('terminal.tab.type')}: ${panel.kind === 'knowledge' ? t('terminal.status.editor') : panel.kind === 'managed-ai-session' ? t('terminal.kind.aiSessionContent') : panel.sshSession ? 'SSH' : t('terminal.kind.localTerminal')}`,
      `${t('terminal.tab.status')}: ${terminalStatusLabel(panel)}`
    ]
    if (panel.terminalProgress) lines.push(`${t('terminal.tab.progress')}: ${terminalTabStateLabel(panel)}`)
    const sshTarget = terminalSshTargetLabel(panel)
    if (sshTarget) lines.push(`${t('terminal.tab.host')}: ${sshTarget}`)
    if (panel.cwd) lines.push(`${t('terminal.tab.path')}: ${panel.cwd}`)
    if (panel.knowledge?.relPath) lines.push(`${t('terminal.tab.file')}: ${panel.knowledge.relPath}`)
    if (panel.sessionId) lines.push(`${t('terminal.tab.session')}: ${panel.sessionId}`)
    return lines.filter(Boolean).join('\n')
  }

  const terminalContextKindLabel = (panel: TerminalPanel) => {
    if (panel.kind === 'knowledge') return t('terminal.kind.editor')
    if (panel.kind === 'managed-ai-session') return t('terminal.kind.aiSessionContent')
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
      focusable: !panel.kind || panel.kind === 'terminal',
      text: terminalContextText(panel)
    }
  })

  return {
    activeTerminalContextBar,
    panelNeedsAiAttention,
    pendingAiSessionsForPanel,
    terminalContextKindLabel,
    terminalContextText,
    terminalStatusLabel,
    terminalSshTargetLabel,
    terminalTabKindBadge,
    terminalTabMeta,
    terminalTabProgressStyle,
    terminalTabShowsState,
    terminalTabStateClass,
    terminalTabStateLabel,
    terminalTabTooltip
  }
}
