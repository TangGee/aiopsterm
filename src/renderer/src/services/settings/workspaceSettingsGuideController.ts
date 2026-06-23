import { type Ref } from 'vue'
import {
  appRuntimeClient,
  isSettingsDocumentationResult
} from '@/services/app/appRuntimeClient'
import { createDefaultOnboardingCompleted, onboardingTourSteps } from '@/config/onboarding'
import type { ModuleKey } from '@/config/navigation'
import type { OnboardingModuleId } from '@/config/onboarding'
import type { SettingSectionKey } from '@/config/settings'
import type {
  OpenSettingsDocumentationInput,
  SettingsDocumentationPage
} from '@shared/contracts/appRuntime'
import type { UserConfig } from '@shared/contracts/userConfig'

type WorkspaceOnboardingAiRequest =
  | 'none'
  | 'open-mode'
  | 'open-model'
  | 'open-context-main'
  | 'open-context-hosts'
  | 'prepare-send'
type WorkspaceOnboardingAssetRequest = 'none' | 'open-host-management' | 'open-create-form'

type WorkspaceSettingsGuideControllerState = {
  mode: Ref<'terminal' | 'agents'>
  activeModule: Ref<ModuleKey>
  leftPanelOpen: Ref<boolean>
  rightPanelOpen: Ref<boolean>
  config: Ref<UserConfig>
  activeSettingsSection: Ref<SettingSectionKey>
  settingsDocumentationOpen: Ref<boolean>
  settingsDocumentationTitle: Ref<string>
  settingsDocumentationPath: Ref<string>
  settingsDocumentationContent: Ref<string>
  onboardingCompleted: Ref<Record<OnboardingModuleId, boolean>>
  onboardingActiveTour: Ref<OnboardingModuleId | null>
  onboardingActiveStepIndex: Ref<number>
  onboardingGuideOpen: Ref<boolean>
  onboardingAiRequest: Ref<{ action: WorkspaceOnboardingAiRequest; stepId: string; sequence: number }>
  onboardingAssetRequest: Ref<{ action: WorkspaceOnboardingAssetRequest; stepId: string; sequence: number }>
}

type WorkspaceSettingsGuideControllerDeps = {
  onboardingVersion: NonNullable<UserConfig['onboarding']>['version']
  currentLocale: () => string
  saveConfig: (patch: Partial<UserConfig>) => Promise<void>
  setSettingsNotice: (message: string) => void
  closeSettingsConfigEditors: () => void
  loadSkillsFromBridge: () => Promise<unknown> | unknown
  refreshMcpServersFromBridge: () => Promise<unknown> | unknown
}

export const createWorkspaceSettingsGuideController = (
  state: WorkspaceSettingsGuideControllerState,
  deps: WorkspaceSettingsGuideControllerDeps
) => {
  const {
    mode,
    activeModule,
    leftPanelOpen,
    rightPanelOpen,
    config,
    activeSettingsSection,
    settingsDocumentationOpen,
    settingsDocumentationTitle,
    settingsDocumentationPath,
    settingsDocumentationContent,
    onboardingCompleted,
    onboardingActiveTour,
    onboardingActiveStepIndex,
    onboardingGuideOpen,
    onboardingAiRequest,
    onboardingAssetRequest
  } = state
  const {
    onboardingVersion,
    currentLocale,
    saveConfig,
    setSettingsNotice,
    closeSettingsConfigEditors,
    loadSkillsFromBridge,
    refreshMcpServersFromBridge
  } = deps

  const persistOnboardingState = async () => {
    await saveConfig({
      onboarding: {
        version: onboardingVersion,
        guideTabAutoOpened: Boolean(config.value.onboarding?.guideTabAutoOpened),
        completedModules: { ...onboardingCompleted.value }
      }
    })
  }

  const closeSettingsInlineEditors = () => {
    closeSettingsConfigEditors()
    settingsDocumentationOpen.value = false
    onboardingGuideOpen.value = false
  }

  const readSettingsDocumentation = async (input?: OpenSettingsDocumentationInput) => {
    const openSettingsDocumentationBridge = appRuntimeClient.openSettingsDocumentation()
    if (!openSettingsDocumentationBridge) {
      setSettingsNotice('文档入口服务不可用')
      return false
    }
    const result = await openSettingsDocumentationBridge(input)
    if (!isSettingsDocumentationResult(result)) {
      setSettingsNotice('文档入口打开失败')
      return false
    }
    settingsDocumentationPath.value = result.path
    settingsDocumentationTitle.value = result.title
    settingsDocumentationContent.value = result.content
    settingsDocumentationOpen.value = true
    setSettingsNotice('已打开文档')
    return true
  }

  const openSettingsDocumentation = async (page?: SettingsDocumentationPage) => {
    closeSettingsConfigEditors()
    onboardingGuideOpen.value = false
    if (!page) activeSettingsSection.value = 'general'
    try {
      return await readSettingsDocumentation(page ? { page, locale: currentLocale() } : undefined)
    } catch {
      setSettingsNotice('文档入口打开失败')
      return false
    }
  }

  const openSettingsPageDocumentation = (page: SettingsDocumentationPage) => openSettingsDocumentation(page)

  const openSettingsDocumentationLink = async (documentPath: string) => {
    const normalizedPath = documentPath.trim()
    if (!normalizedPath) return false
    try {
      return await readSettingsDocumentation({ documentPath: normalizedPath, basePath: settingsDocumentationPath.value })
    } catch {
      setSettingsNotice('文档入口打开失败')
      return false
    }
  }

  const openSettingsDocumentationFile = async (documentPath: string) => {
    const normalizedPath = documentPath.trim()
    if (!normalizedPath) return false
    try {
      return await readSettingsDocumentation({ documentPath: normalizedPath })
    } catch {
      setSettingsNotice('文档入口打开失败')
      return false
    }
  }

  const closeSettingsDocumentation = () => {
    settingsDocumentationOpen.value = false
  }

  const setActiveSettingsSection = (key: SettingSectionKey) => {
    if (key === 'docs') {
      void openSettingsDocumentation()
      return
    }
    closeSettingsInlineEditors()
    activeSettingsSection.value = key
    if (key === 'skills') {
      void loadSkillsFromBridge()
    } else if (key === 'mcp') {
      void refreshMcpServersFromBridge()
    }
  }

  const prepareOnboardingStep = (moduleId: OnboardingModuleId, stepId: string) => {
    if (mode.value !== 'terminal') mode.value = 'terminal'
    onboardingAiRequest.value = {
      action: 'none',
      stepId,
      sequence: onboardingAiRequest.value.sequence + 1
    }
    onboardingAssetRequest.value = {
      action: 'none',
      stepId,
      sequence: onboardingAssetRequest.value.sequence + 1
    }

    if (moduleId === 'interfaceGuide') {
      activeModule.value = 'workspace'
      leftPanelOpen.value = true
      if (stepId === 'ai-sidebar') rightPanelOpen.value = true
      return
    }

    if (moduleId === 'systemSettings') {
      activeModule.value = 'settings'
      rightPanelOpen.value = false
      if (stepId === 'terminal-tab' || stepId === 'terminal-options') {
        activeSettingsSection.value = 'terminal'
      } else if (stepId === 'ai-preferences-tab' || stepId === 'ai-preferences-content' || stepId === 'ai-auto-approval') {
        activeSettingsSection.value = 'ai'
      } else {
        activeSettingsSection.value = 'general'
      }
      return
    }

    if (moduleId === 'addAndConnectHost') {
      activeModule.value = 'assets'
      leftPanelOpen.value = true
      rightPanelOpen.value = true
      const assetRequestMap: Record<string, WorkspaceOnboardingAssetRequest> = {
        'host-management': 'open-host-management',
        'new-host': 'open-host-management',
        'form-fields': 'open-create-form',
        'form-submit': 'open-create-form'
      }
      onboardingAssetRequest.value = {
        action: assetRequestMap[stepId] || 'none',
        stepId,
        sequence: onboardingAssetRequest.value.sequence + 1
      }
      if (stepId === 'new-host') setSettingsNotice('点击新建主机继续引导')
      return
    }

    if (moduleId === 'aiChat') {
      activeModule.value = 'workspace'
      leftPanelOpen.value = true
      rightPanelOpen.value = true
      const requestMap: Record<string, WorkspaceOnboardingAiRequest> = {
        'ai-mode-agent': 'open-mode',
        'ai-model-open': 'none',
        'ai-model-option': 'open-model',
        'ai-context-open': 'none',
        'ai-context-hosts': 'open-context-main',
        'ai-localhost-option': 'open-context-hosts',
        'ai-send': 'prepare-send'
      }
      onboardingAiRequest.value = {
        action: requestMap[stepId] || 'none',
        stepId,
        sequence: onboardingAiRequest.value.sequence + 1
      }
    }
  }

  const openOnboardingGuide = () => {
    activeModule.value = 'settings'
    activeSettingsSection.value = 'general'
    rightPanelOpen.value = false
    onboardingGuideOpen.value = true
    onboardingActiveTour.value = null
    onboardingActiveStepIndex.value = 0
    config.value = {
      ...config.value,
      onboarding: {
        version: onboardingVersion,
        guideTabAutoOpened: true,
        completedModules: { ...onboardingCompleted.value }
      }
    }
    persistOnboardingState()
    setSettingsNotice('已打开入门引导')
  }

  const startOnboardingTour = (moduleId: OnboardingModuleId) => {
    onboardingActiveTour.value = moduleId
    onboardingActiveStepIndex.value = 0
    onboardingGuideOpen.value = false
    prepareOnboardingStep(moduleId, onboardingTourSteps[moduleId][0]?.id || '')
  }

  const stopOnboardingTour = () => {
    onboardingActiveTour.value = null
    onboardingActiveStepIndex.value = 0
  }

  const nextOnboardingStep = () => {
    const moduleId = onboardingActiveTour.value
    if (!moduleId) return
    const nextIndex = onboardingActiveStepIndex.value + 1
    if (nextIndex >= onboardingTourSteps[moduleId].length) {
      onboardingCompleted.value = { ...onboardingCompleted.value, [moduleId]: true }
      persistOnboardingState()
      stopOnboardingTour()
      setSettingsNotice(`${moduleId === 'interfaceGuide' ? '界面导览' : moduleId === 'systemSettings' ? '系统设置' : moduleId === 'addAndConnectHost' ? '添加并连接主机' : 'AI 会话'} 引导已完成`)
      return
    }
    onboardingActiveStepIndex.value = nextIndex
    prepareOnboardingStep(moduleId, onboardingTourSteps[moduleId][nextIndex]?.id || '')
  }

  const previousOnboardingStep = () => {
    const moduleId = onboardingActiveTour.value
    if (!moduleId) return
    onboardingActiveStepIndex.value = Math.max(0, onboardingActiveStepIndex.value - 1)
    prepareOnboardingStep(moduleId, onboardingTourSteps[moduleId][onboardingActiveStepIndex.value]?.id || '')
  }

  const jumpOnboardingStep = (stepId: string) => {
    const moduleId = onboardingActiveTour.value
    if (!moduleId) return
    const nextIndex = onboardingTourSteps[moduleId].findIndex((step) => step.id === stepId)
    if (nextIndex < 0) return
    onboardingActiveStepIndex.value = nextIndex
    prepareOnboardingStep(moduleId, stepId)
  }

  const resetOnboarding = () => {
    onboardingCompleted.value = createDefaultOnboardingCompleted()
    stopOnboardingTour()
    config.value = {
      ...config.value,
      onboarding: {
        version: onboardingVersion,
        guideTabAutoOpened: false,
        completedModules: { ...onboardingCompleted.value }
      }
    }
    persistOnboardingState()
    setSettingsNotice('入门引导进度已重置')
  }

  return {
    closeSettingsInlineEditors,
    setActiveSettingsSection,
    openSettingsPageDocumentation,
    openSettingsDocumentationLink,
    openSettingsDocumentationFile,
    closeSettingsDocumentation,
    openOnboardingGuide,
    startOnboardingTour,
    stopOnboardingTour,
    nextOnboardingStep,
    previousOnboardingStep,
    jumpOnboardingStep,
    resetOnboarding
  }
}
