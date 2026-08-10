import { managedAiClient } from '@/services/ai/managedAiClient'
import {
  isAgentHibernationConfigData,
  isManagedAiSessionHibernateData,
  isManagedAiSessionMutationData
} from '@/services/ai/managedAiBackendGuards'
import { terminalClient } from '@/services/terminal/terminalClient'
import type { I18nKey } from '@/i18n/messages'
import { isTerminalWorkspacePanel, type TerminalPanel } from '@/services/terminal/terminalPanelRuntime'
import type { TerminalCommandExecutionOptions, TerminalSecurityDecision } from '@/services/terminal/terminalExecutionRuntime'
import type {
  AiAgentSessionSource,
  AgentHibernationConfig,
  AgentHibernationConfigResult,
  ManagedAiSessionHibernateResult,
  ManagedAiSessionSnapshot
} from '@shared/contracts/managedAiSessions'
import type {
  ManagedAiLocalTerminalOpenOptions,
  ManagedAiSession,
  WorkspaceManagedAiControllerState
} from '@/services/ai/workspaceManagedAiTypes'

const managedAiSessionAllowsResume = (session: Pick<ManagedAiSession, 'sessionKind' | 'restorable' | 'resumeCommand'>) =>
  session.restorable !== false &&
  session.sessionKind !== 'subagent' &&
  session.sessionKind !== 'internal' &&
  Boolean(session.resumeCommand?.trim())

const managedAiSessionIsReviewOnly = (session: Pick<ManagedAiSession, 'sessionKind' | 'restorable'>) =>
  session.restorable === false || session.sessionKind === 'subagent' || session.sessionKind === 'internal'

export const createWorkspaceManagedAiHibernationRuntime = (input: {
  state: Pick<WorkspaceManagedAiControllerState, 'agentHibernationConfig' | 'managedAiSessions' | 'panels'>
  setTopNotice: (message: string) => void
  i18nText: (key: I18nKey, params?: Record<string, string | number>) => string
  applyManagedAiSessionSnapshot: (snapshot: ManagedAiSessionSnapshot) => void
  focusManagedAiSession: (sessionIdOrPanelId: string) => ManagedAiSession | null
  openLocalTerminalPanel?: (options?: ManagedAiLocalTerminalOpenOptions) => Promise<TerminalPanel | null | undefined>
  runTerminalCommand: (
    panelId: string,
    command: string,
    options?: TerminalCommandExecutionOptions
  ) => Promise<TerminalSecurityDecision>
}) => {
  const { state, setTopNotice, i18nText, applyManagedAiSessionSnapshot, focusManagedAiSession, openLocalTerminalPanel, runTerminalCommand } = input
  const { agentHibernationConfig, managedAiSessions, panels } = state

  const refreshAgentHibernationConfig = async () => {
    const getAgentHibernationConfig = managedAiClient.getAgentHibernationConfig()
    if (!getAgentHibernationConfig) return false
    try {
      const result = (await getAgentHibernationConfig()) as AgentHibernationConfigResult
      if (!result?.ok || !isAgentHibernationConfigData(result.data)) {
        setTopNotice(result?.errorMessage || i18nText('settings.ai.hibernation.loadFailed'))
        return false
      }
      agentHibernationConfig.value = { ...result.data.config }
      return true
    } catch (error) {
      setTopNotice(error instanceof Error ? error.message : i18nText('settings.ai.hibernation.loadFailed'))
      return false
    }
  }

  const updateAgentHibernationConfig = async (patch: Partial<AgentHibernationConfig>) => {
    const setAgentHibernationConfig = managedAiClient.setAgentHibernationConfig()
    if (!setAgentHibernationConfig) {
      setTopNotice(i18nText('settings.ai.hibernation.serviceUnavailable'))
      return false
    }
    const nextConfig = { ...agentHibernationConfig.value, ...patch }
    try {
      const result = (await setAgentHibernationConfig(nextConfig)) as AgentHibernationConfigResult
      if (!result?.ok || !isAgentHibernationConfigData(result.data)) {
        setTopNotice(result?.errorMessage || i18nText('settings.ai.hibernation.saveFailed'))
        return false
      }
      agentHibernationConfig.value = { ...result.data.config }
      setTopNotice(i18nText('settings.ai.hibernation.saved'))
      return true
    } catch (error) {
      setTopNotice(error instanceof Error ? error.message : i18nText('settings.ai.hibernation.saveFailed'))
      return false
    }
  }

  const setAgentHibernationEnabled = async (enabled: boolean) => {
    const saved = await updateAgentHibernationConfig({ enabled })
    if (saved) setTopNotice(enabled ? i18nText('settings.ai.hibernation.enabledNotice') : i18nText('settings.ai.hibernation.disabledNotice'))
    return saved
  }

  const hibernateManagedAiSession = async (source: AiAgentSessionSource, sessionId: string, reason = 'manual') => {
    const session = managedAiSessions.value.find((item) => item.source === source && item.id === sessionId)
    if (!session) {
      setTopNotice(i18nText('aiSessions.notice.missing'))
      return false
    }
    if (!agentHibernationConfig.value.enabled) {
      setTopNotice(i18nText('aiSessions.notice.hibernationDisabled'))
      return false
    }
    if (session.state === 'needsInput' || session.agentLifecycle === 'needsInput') {
      setTopNotice(i18nText('aiSessions.notice.cannotHibernateNeedsInput'))
      return false
    }
    if (!managedAiSessionAllowsResume(session)) {
      setTopNotice(i18nText(managedAiSessionIsReviewOnly(session) ? 'aiSessions.notice.notRestorable' : 'aiSessions.notice.noResumeCommand'))
      return false
    }
    const targetId = session.panelId || session.terminalSessionId
    const panel = targetId ? panels.value.find((item) => item.id === targetId || item.sessionId === targetId) : null
    const terminalSessionId = panel?.sessionId || session.terminalSessionId
    const hibernateManagedAiSessionBridge = managedAiClient.hibernateManagedAiSession()
    if (!hibernateManagedAiSessionBridge) {
      setTopNotice(i18nText('settings.ai.hibernation.serviceUnavailable'))
      return false
    }
    const killTerminal = terminalClient.killTerminal()
    if (terminalSessionId && killTerminal) {
      // 先解绑终端引用再杀终端，避免随后的终端关闭事件把休眠会话标记为 ended
      const previousPanelId = session.panelId
      const previousTerminalSessionId = session.terminalSessionId
      session.panelId = undefined
      session.terminalSessionId = undefined
      try {
        const killResult = await killTerminal(terminalSessionId)
        if (!killResult?.ok) {
          session.panelId = previousPanelId
          session.terminalSessionId = previousTerminalSessionId
          setTopNotice(killResult?.errorMessage || i18nText('aiSessions.notice.hibernateFailed'))
          return false
        }
      } catch (error) {
        session.panelId = previousPanelId
        session.terminalSessionId = previousTerminalSessionId
        setTopNotice(error instanceof Error ? error.message : i18nText('aiSessions.notice.hibernateFailed'))
        return false
      }
      if (panel?.sessionId === terminalSessionId) {
        panel.sessionId = undefined
        panel.status = 'closed'
      }
    }
    try {
      const result = (await hibernateManagedAiSessionBridge({ source, sessionId, reason, terminalSessionId })) as ManagedAiSessionHibernateResult
      if (!result?.ok || !isManagedAiSessionHibernateData(result.data)) {
        setTopNotice(result?.errorMessage || i18nText('aiSessions.notice.hibernateFailed'))
        return false
      }
      agentHibernationConfig.value = { ...result.data.config }
      applyManagedAiSessionSnapshot(result.data.snapshot)
      setTopNotice(i18nText('aiSessions.notice.hibernated'))
      return true
    } catch (error) {
      setTopNotice(error instanceof Error ? error.message : i18nText('aiSessions.notice.hibernateFailed'))
      return false
    }
  }

  const resumeManagedAiSession = async (source: AiAgentSessionSource, sessionId: string) => {
    const session = managedAiSessions.value.find((item) => item.source === source && item.id === sessionId)
    if (!session) {
      setTopNotice(i18nText('aiSessions.notice.missing'))
      return false
    }
    const focused = focusManagedAiSession(session.id)
    const targetIds = [focused?.panelId, focused?.terminalSessionId, session.panelId, session.terminalSessionId].filter(Boolean)
    let panel = targetIds.length ? panels.value.find((item) => targetIds.includes(item.id) || (item.sessionId ? targetIds.includes(item.sessionId) : false)) : null
    if (panel?.sessionId && isTerminalWorkspacePanel(panel) && panel.status !== 'closed' && panel.status !== 'error') {
      return true
    }
    if (!managedAiSessionAllowsResume(session)) {
      setTopNotice(i18nText(managedAiSessionIsReviewOnly(session) ? 'aiSessions.notice.notRestorable' : 'aiSessions.notice.noResumeCommand'))
      return false
    }
    const command = session.resumeCommand?.trim()
    if (!command) {
      setTopNotice(i18nText('aiSessions.notice.noResumeCommand'))
      return false
    }
    if (openLocalTerminalPanel) {
      const opened = await openLocalTerminalPanel({
        title: session.title,
        cwd: session.cwd
      })
      panel = opened ? panels.value.find((item) => item.id === opened.id || item.sessionId === opened.sessionId) || opened : null
    }
    if (!panel?.sessionId) {
      setTopNotice(i18nText('aiSessions.notice.resumeNeedsTerminal'))
      return false
    }
    const decision = await runTerminalCommand(panel.id, command, { source: 'agent', writeToShell: true })
    if (decision.status === 'allow') {
      const wakeManagedAiSession = managedAiClient.wakeManagedAiSession()
      if (session.hibernated && wakeManagedAiSession) {
        const result = (await wakeManagedAiSession({ source, sessionId, reason: 'resume' })) as ManagedAiSessionHibernateResult
        if (result?.ok && isManagedAiSessionHibernateData(result.data)) {
          agentHibernationConfig.value = { ...result.data.config }
          applyManagedAiSessionSnapshot(result.data.snapshot)
        }
      }
      const bindManagedAiSessionTerminal = managedAiClient.bindManagedAiSessionTerminal()
      if (!bindManagedAiSessionTerminal) {
        setTopNotice(i18nText('settings.ai.hibernation.serviceUnavailable'))
        return false
      }
      const bindingResult = await bindManagedAiSessionTerminal({
        source,
        sessionId,
        panelId: panel.id,
        terminalSessionId: panel.sessionId,
        cwd: session.canonicalCwd || session.cwd
      })
      if (!bindingResult?.ok || !isManagedAiSessionMutationData(bindingResult.data)) {
        setTopNotice(bindingResult?.errorMessage || i18nText('aiSessions.notice.resumeNeedsTerminal'))
        return false
      }
      const boundSession = managedAiSessions.value.find((item) => item.source === source && item.id === sessionId)
      if (boundSession) {
        boundSession.panelId = panel.id
        boundSession.terminalSessionId = panel.sessionId
        boundSession.terminalActivityAt = Date.now()
        boundSession.updatedAt = Date.now()
      }
      focusManagedAiSession(session.id)
      setTopNotice(i18nText('aiSessions.notice.resumeCommandWritten'))
      return true
    }
    if (decision.status === 'needs-approval') {
      setTopNotice(i18nText('aiSessions.notice.resumeCommandNeedsApproval'))
      return false
    }
    return false
  }

  return {
    refreshAgentHibernationConfig,
    updateAgentHibernationConfig,
    setAgentHibernationEnabled,
    hibernateManagedAiSession,
    resumeManagedAiSession
  }
}
