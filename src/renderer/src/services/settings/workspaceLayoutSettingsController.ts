import { type Ref } from 'vue'
import { appRuntimeClient } from '@/services/app/appRuntimeClient'
import {
  defaultConfig,
  isLayoutPreferencesSnapshot,
  layoutPreferencesPatchMatches,
  layoutWidthFromConfig,
  layoutWidthLimits,
  mergeGenericSavedConfig,
  normalizeLayoutPreferencesPatch,
  type LayoutPreferencesPatch
} from '@/services/settings/workspaceConfigRuntime'
import type { CenterSurface, ModuleKey } from '@/config/navigation'
import type { SettingSectionKey } from '@/config/settings'
import type { UserConfig } from '@shared/contracts/userConfig'

type WorkspaceLayoutSettingsControllerState = {
  mode: Ref<'terminal' | 'agents'>
  activeModule: Ref<ModuleKey>
  activeCenterSurface: Ref<CenterSurface>
  leftPanelOpen: Ref<boolean>
  rightPanelOpen: Ref<boolean>
  agentsLeftOpen: Ref<boolean>
  leftPanelWidth: Ref<number>
  rightPanelWidth: Ref<number>
  agentsLeftWidth: Ref<number>
  onboardingGuideOpen: Ref<boolean>
  config: Ref<UserConfig>
}

type WorkspaceLayoutSettingsControllerDeps = {
  setTopNotice: (message: string) => void
  setActiveSettingsSection: (key: SettingSectionKey) => void
  refreshAgentHookInstallers: (options?: { silent?: boolean }) => Promise<boolean>
  refreshExportMcpInstallers?: (options?: { silent?: boolean }) => Promise<boolean>
}

const numberInRange = (value: unknown, fallback: number, min: number, max?: number) =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && (max === undefined || value <= max) ? value : fallback

export const createWorkspaceLayoutSettingsController = (
  state: WorkspaceLayoutSettingsControllerState,
  deps: WorkspaceLayoutSettingsControllerDeps
) => {
  const {
    mode,
    activeModule,
    activeCenterSurface,
    leftPanelOpen,
    rightPanelOpen,
    agentsLeftOpen,
    leftPanelWidth,
    rightPanelWidth,
    agentsLeftWidth,
    onboardingGuideOpen,
    config
  } = state
  const {
    setTopNotice,
    setActiveSettingsSection,
    refreshAgentHookInstallers
  } = deps

  const applyLayoutPreferencesSnapshot = (savedConfig: UserConfig) => {
    config.value = mergeGenericSavedConfig(config.value, savedConfig)
    mode.value = config.value.defaultMode
    leftPanelOpen.value = config.value.leftPanelOpen
    rightPanelOpen.value = config.value.rightPanelOpen
    agentsLeftOpen.value = config.value.agentsLeftOpen
    leftPanelWidth.value = layoutWidthFromConfig(config.value.leftPanelWidth, defaultConfig.leftPanelWidth!)
    rightPanelWidth.value = layoutWidthFromConfig(config.value.rightPanelWidth, defaultConfig.rightPanelWidth!)
    agentsLeftWidth.value = layoutWidthFromConfig(config.value.agentsLeftWidth, defaultConfig.agentsLeftWidth!)
  }

  const persistLayoutPreferences = async (patch: LayoutPreferencesPatch) => {
    const saveConfigBridge = appRuntimeClient.saveConfig()
    if (typeof saveConfigBridge !== 'function') {
      setTopNotice('布局设置保存服务不可用')
      return false
    }
    const normalizedPatch = normalizeLayoutPreferencesPatch(patch)
    if (!normalizedPatch || !Object.keys(normalizedPatch).length) {
      setTopNotice('布局设置保存失败')
      return false
    }
    try {
      const savedConfig = await saveConfigBridge(normalizedPatch)
      if (!isLayoutPreferencesSnapshot(savedConfig) || !layoutPreferencesPatchMatches(normalizedPatch, savedConfig)) {
        setTopNotice('布局设置保存失败')
        return false
      }
      applyLayoutPreferencesSnapshot(savedConfig)
      return true
    } catch (error) {
      setTopNotice(error instanceof Error ? error.message : '布局设置保存失败')
      return false
    }
  }

  const openAiSessionSettings = () => {
    mode.value = 'terminal'
    activeModule.value = 'settings'
    leftPanelOpen.value = true
    rightPanelOpen.value = false
    onboardingGuideOpen.value = false
    setActiveSettingsSection('aiRemoteHostManagement')
    void refreshAgentHookInstallers({ silent: true })
    void deps.refreshExportMcpInstallers?.({ silent: true })
    setTopNotice('已打开主机Agent设置')
  }

  const toggleMode = async () => {
    const nextMode = mode.value === 'terminal' ? 'agents' : 'terminal'
    const saved = await persistLayoutPreferences({
      defaultMode: nextMode,
      ...(nextMode === 'agents' ? { agentsLeftOpen: true } : {})
    })
    if (!saved) return false
    if (nextMode === 'terminal' && (activeCenterSurface.value === 'database' || activeCenterSurface.value === 'user')) {
      rightPanelOpen.value = false
    }
    setTopNotice(`已切换到 ${mode.value === 'agents' ? 'Agents' : 'Terminal'} 模式`)
    return true
  }

  const toggleLeft = async () => {
    if (mode.value === 'agents') {
      const nextOpen = !agentsLeftOpen.value
      const saved = await persistLayoutPreferences({ agentsLeftOpen: nextOpen })
      if (saved) setTopNotice(`Agents 会话侧栏已${agentsLeftOpen.value ? '打开' : '关闭'}`)
      return saved
    }
    const nextOpen = !leftPanelOpen.value
    const saved = await persistLayoutPreferences({ leftPanelOpen: nextOpen })
    if (saved) setTopNotice(`左侧面板已${leftPanelOpen.value ? '打开' : '关闭'}`)
    return saved
  }

  const toggleRight = async () => {
    if (mode.value !== 'terminal' || activeCenterSurface.value === 'database' || activeCenterSurface.value === 'user') return false
    const nextOpen = !rightPanelOpen.value
    const saved = await persistLayoutPreferences({ rightPanelOpen: nextOpen })
    if (saved) setTopNotice(`AI 侧栏已${rightPanelOpen.value ? '打开' : '关闭'}`)
    return saved
  }

  const resizeLeftPanel = async (width: number) => {
    const previousWidth = mode.value === 'agents' ? agentsLeftWidth.value : leftPanelWidth.value
    const normalizedWidth = Math.round(numberInRange(width, previousWidth, layoutWidthLimits.min, layoutWidthLimits.max))
    if (mode.value === 'agents') {
      agentsLeftWidth.value = normalizedWidth
      const saved = await persistLayoutPreferences({ agentsLeftOpen: true, agentsLeftWidth: normalizedWidth })
      if (!saved) agentsLeftWidth.value = previousWidth
      if (saved) setTopNotice(`Agents 会话侧栏宽度已保存为 ${agentsLeftWidth.value}px`)
      return saved
    }
    leftPanelWidth.value = normalizedWidth
    const saved = await persistLayoutPreferences({ leftPanelOpen: true, leftPanelWidth: normalizedWidth })
    if (!saved) leftPanelWidth.value = previousWidth
    if (saved) setTopNotice(`左侧面板宽度已保存为 ${leftPanelWidth.value}px`)
    return saved
  }

  const resizeRightPanel = async (width: number) => {
    if (mode.value === 'terminal' && (activeCenterSurface.value === 'database' || activeCenterSurface.value === 'user')) return false
    const previousWidth = rightPanelWidth.value
    const normalizedWidth = Math.round(numberInRange(width, previousWidth, layoutWidthLimits.min, layoutWidthLimits.max))
    rightPanelWidth.value = normalizedWidth
    const saved = await persistLayoutPreferences(
      mode.value === 'agents'
        ? { rightPanelWidth: normalizedWidth }
        : { rightPanelOpen: true, rightPanelWidth: normalizedWidth }
    )
    if (!saved) rightPanelWidth.value = previousWidth
    if (saved) setTopNotice(`AI 侧栏宽度已保存为 ${rightPanelWidth.value}px`)
    return saved
  }

  const quickCloseLeftPanel = async () => {
    const saved = await persistLayoutPreferences(mode.value === 'agents' ? { agentsLeftOpen: false } : { leftPanelOpen: false })
    if (saved) setTopNotice(mode.value === 'agents' ? 'Agents 会话侧栏已关闭' : '左侧面板已关闭')
    return saved
  }

  const quickCloseRightPanel = async () => {
    if (mode.value !== 'terminal' || activeCenterSurface.value === 'database' || activeCenterSurface.value === 'user') return false
    const saved = await persistLayoutPreferences({ rightPanelOpen: false })
    if (saved) setTopNotice('AI 侧栏已关闭')
    return saved
  }

  return {
    persistLayoutPreferences,
    openAiSessionSettings,
    toggleMode,
    toggleLeft,
    toggleRight,
    resizeLeftPanel,
    resizeRightPanel,
    quickCloseLeftPanel,
    quickCloseRightPanel
  }
}
