import { type Ref } from 'vue'
import { isAiopstermDeepLinkPayload } from '@shared/deepLink'
import type { ModuleKey } from '@/config/navigation'
import type { SettingSectionKey } from '@/config/settings'
import type { UserConfig } from '@shared/contracts/userConfig'
import { isTerminalWorkspacePanel, type TerminalPanel } from '@/services/terminal/terminalPanelRuntime'

export type AssetManagementViewRequest = 'assetConfig' | 'assetManagement' | 'keyManagement' | 'proxyManagement'
export type AssetManagementOpenAction = 'none' | 'create-key' | 'create-proxy'
export type AssetManagementOpenRequest = {
  sequence: number
  organizationId?: string
  view?: AssetManagementViewRequest
  action?: AssetManagementOpenAction
}

type WorkspaceShellControllerState = {
  mode: Ref<'terminal' | 'agents'>
  activeModule: Ref<ModuleKey>
  leftPanelOpen: Ref<boolean>
  rightPanelOpen: Ref<boolean>
  agentsLeftOpen: Ref<boolean>
  activePanelId: Ref<string>
  panels: Ref<TerminalPanel[]>
  config: Ref<UserConfig>
  onboardingGuideOpen: Ref<boolean>
  assetManagementOpenRequest: Ref<AssetManagementOpenRequest>
}

type WorkspaceShellControllerDeps = {
  setTopNotice: (message: string) => void
  openLocalTerminalPanel: (options?: { cwd?: string }) => Promise<TerminalPanel | null>
  toggleRight: () => Promise<boolean> | boolean
  setActiveSettingsSection: (section: SettingSectionKey) => void
  openRecentPanels: () => boolean
  navigatePanelBack: () => boolean
  navigatePanelForward: () => boolean
}

export const createWorkspaceShellController = (
  state: WorkspaceShellControllerState,
  deps: WorkspaceShellControllerDeps
) => {
  const {
    mode,
    activeModule,
    leftPanelOpen,
    rightPanelOpen,
    agentsLeftOpen,
    activePanelId,
    panels,
    config,
    onboardingGuideOpen,
    assetManagementOpenRequest
  } = state
  const {
    setTopNotice,
    openLocalTerminalPanel,
    toggleRight,
    setActiveSettingsSection,
    openRecentPanels,
    navigatePanelBack,
    navigatePanelForward
  } = deps

  const switchToTerminalPanelIndex = (digit: number) => {
    const index = Math.max(1, Math.min(9, Math.floor(digit))) - 1
    const terminalPanels = panels.value.filter((panel) => isTerminalWorkspacePanel(panel))
    const target = terminalPanels[index]
    if (!target) return false
    mode.value = 'terminal'
    activeModule.value = 'workspace'
    activePanelId.value = target.id
    return true
  }

  const triggerShortcutAction = (actionId: string, digit?: number) => {
    if (actionId === 'newTerminal') {
      mode.value = 'terminal'
      activeModule.value = 'workspace'
      const source = panels.value.find((panel) => panel.id === activePanelId.value)
      const cwd = !source?.sshSession && source?.sessionId && source.cwd?.trim() ? source.cwd.trim() : undefined
      void openLocalTerminalPanel(cwd ? { cwd } : undefined).then((panel) => {
        if (panel) setTopNotice('已通过快捷键新建终端')
      })
      return true
    }
    if (actionId === 'toggleAi') {
      mode.value = 'terminal'
      if (activeModule.value === 'database' || activeModule.value === 'user') activeModule.value = 'workspace'
      void toggleRight()
      return true
    }
    if (actionId === 'switchToSpecificTab' && digit) {
      return switchToTerminalPanelIndex(digit)
    }
    if (actionId === 'quickCommand') {
      mode.value = 'terminal'
      activeModule.value = 'snippets'
      leftPanelOpen.value = true
      setTopNotice('已打开快捷命令')
      return true
    }
    if (actionId === 'recentPanels') return openRecentPanels()
    if (actionId === 'navigatePanelBack') return navigatePanelBack()
    if (actionId === 'navigatePanelForward') return navigatePanelForward()
    return false
  }

  const setActiveModule = (key: ModuleKey) => {
    activeModule.value = key
    if (key !== 'settings') onboardingGuideOpen.value = false
    if (key === 'database') {
      rightPanelOpen.value = false
    }
  }

  const openAssetManagement = (
    organizationId?: string,
    view: AssetManagementViewRequest = organizationId ? 'assetManagement' : 'assetConfig',
    action: AssetManagementOpenAction = 'none'
  ) => {
    mode.value = 'terminal'
    activeModule.value = 'assets'
    leftPanelOpen.value = true
    rightPanelOpen.value = config.value.rightPanelOpen
    onboardingGuideOpen.value = false
    assetManagementOpenRequest.value = {
      sequence: assetManagementOpenRequest.value.sequence + 1,
      view,
      action,
      ...(organizationId ? { organizationId } : {})
    }
    setTopNotice(organizationId ? '已打开组织资产管理' : '已打开资产管理')
  }

  const handleDeepLink = (payload: unknown) => {
    if (!isAiopstermDeepLinkPayload(payload)) {
      setTopNotice('aiopsterm deep link 后端返回数据异常')
      return false
    }

    if (payload.target === 'agents') {
      mode.value = 'agents'
      agentsLeftOpen.value = true
      setTopNotice('已通过 aiopsterm:// 打开 Agents')
      return true
    }

    const targetModule = payload.module || payload.target
    mode.value = 'terminal'
    activeModule.value = targetModule
    if (targetModule === 'settings') {
      rightPanelOpen.value = false
      setActiveSettingsSection(payload.settingsSection || 'general')
    } else if (targetModule === 'database' || targetModule === 'user') {
      rightPanelOpen.value = false
      onboardingGuideOpen.value = false
    } else {
      leftPanelOpen.value = true
      rightPanelOpen.value = config.value.rightPanelOpen
      onboardingGuideOpen.value = false
    }
    setTopNotice(`已通过 aiopsterm:// 打开${targetModule === 'workspace' ? '工作区' : targetModule}`)
    return true
  }

  return {
    switchToTerminalPanelIndex,
    triggerShortcutAction,
    setActiveModule,
    openAssetManagement,
    handleDeepLink
  }
}
