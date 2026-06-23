import { type Ref } from 'vue'
import { appRuntimeClient } from '@/services/app/appRuntimeClient'
import {
  isModelProviderCheckDataForRequest,
  listAiModelCatalog,
  malformedModelProviderResultMessage,
  modelProviderClient
} from '@/services/ai/modelProviderClient'
import {
  defaultModelProviders,
  isVisibleModelSettingsOption,
  mergeGenericSavedConfig,
  modelOptionProviderForSavedProvider,
  modelSettingsSnapshotsMatch,
  normalizeCatalogModelProvider,
  normalizeModelProviderConfig,
  normalizeModelSettingsConfig,
  normalizeUserModelName,
  normalizeUserModelProvider,
  type ModelProviderKey,
  type ModelProviderSettings,
  type SettingsModelOption
} from '@/services/settings/workspaceConfigRuntime'
import type {
  AiModelCatalog,
  AiModelCatalogOption,
  ModelSettingsUserConfig
} from '@shared/contracts/appRuntime'
import type { UserConfig } from '@shared/contracts/userConfig'

type WorkspaceModelSettingsControllerState = {
  config: Ref<UserConfig>
  aiModelOptions: Ref<AiModelCatalogOption[]>
  lockedAiModelOptions: Ref<AiModelCatalogOption[]>
  settingModelOptions: Ref<SettingsModelOption[]>
  addModelSwitch: Ref<boolean>
  modelProviders: Ref<Record<ModelProviderKey, ModelProviderSettings>>
  modelCheckState: Ref<Record<ModelProviderKey, 'idle' | 'checking' | 'success' | 'error'>>
  modelCheckRequestSeq: Ref<Record<ModelProviderKey, number>>
}

type WorkspaceModelSettingsControllerDeps = {
  setSettingsNotice: (message: string) => void
  setTopNotice: (message: string) => void
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export const createWorkspaceModelSettingsController = (
  state: WorkspaceModelSettingsControllerState,
  deps: WorkspaceModelSettingsControllerDeps
) => {
  const {
    config,
    aiModelOptions,
    lockedAiModelOptions,
    settingModelOptions,
    addModelSwitch,
    modelProviders,
    modelCheckState,
    modelCheckRequestSeq
  } = state
  const { setSettingsNotice, setTopNotice } = deps

  let aiModelCatalogLoadPromise: Promise<AiModelCatalog> | null = null

  const applyAiModelCatalog = (catalog: AiModelCatalog, options: { replaceSettingsOptions?: boolean } = {}) => {
    aiModelOptions.value = catalog.chatModels.map((model) => ({ ...model }))
    lockedAiModelOptions.value = catalog.lockedChatModels.map((model) => ({ ...model, locked: true }))
    if (options.replaceSettingsOptions) {
      settingModelOptions.value = catalog.settingsModels
        .filter(isVisibleModelSettingsOption)
        .map((model) => ({
          name: model.name,
          displayName: model.displayName,
          locked: model.locked,
          checked: model.checked,
          type: model.type,
          apiProvider: model.apiProvider
        }))
    }
    return catalog
  }

  const refreshAiModelCatalog = async (options: { replaceSettingsOptions?: boolean } = {}) => {
    const replaceSettingsOptions = options.replaceSettingsOptions ?? settingModelOptions.value.length === 0
    if (!modelProviderClient.listAiModels()) {
      setSettingsNotice('模型列表加载服务不可用')
      return null
    }
    aiModelCatalogLoadPromise ||= listAiModelCatalog({ modelSettings: normalizeModelSettingsConfig(config.value.modelSettings).normalized })
      .then((catalog) => catalog || Promise.reject(new Error('模型列表加载服务不可用')))
      .finally(() => {
        aiModelCatalogLoadPromise = null
      })
    try {
      const catalog = await aiModelCatalogLoadPromise
      return applyAiModelCatalog(catalog, {
        replaceSettingsOptions
      })
    } catch (error) {
      setSettingsNotice(`模型列表加载失败：${error instanceof Error ? error.message : String(error)}`)
      return null
    }
  }

  const getModelSettingsSnapshot = (): ModelSettingsUserConfig => ({
    addModelSwitch: addModelSwitch.value,
    providers: {
      litellm: { ...modelProviders.value.litellm },
      openai: { ...modelProviders.value.openai },
      bedrock: { ...modelProviders.value.bedrock },
      deepseek: { ...modelProviders.value.deepseek },
      anthropic: { ...modelProviders.value.anthropic },
      ollama: { ...modelProviders.value.ollama },
      lmstudio: { ...modelProviders.value.lmstudio }
    },
    options: settingModelOptions.value.filter(isVisibleModelSettingsOption).map((option) => ({
      name: option.name,
      displayName: option.displayName,
      locked: Boolean(option.locked),
      checked: Boolean(option.checked),
      type: option.type || (option.locked ? 'standard' : 'custom'),
      apiProvider: option.apiProvider || (option.locked ? 'default' : 'openai')
    }))
  })

  const getPersistedModelSettingsSnapshot = (): ModelSettingsUserConfig => normalizeModelSettingsConfig(config.value.modelSettings).normalized

  const getModelSettingsSnapshotWithProviderModel = (provider: ModelProviderKey, providerSettings: ModelProviderSettings): ModelSettingsUserConfig => {
    const modelName = providerSettings.modelId.trim()
    const nextSettings = getModelSettingsSnapshot()
    nextSettings.providers = {
      ...nextSettings.providers,
      [provider]: { ...providerSettings }
    }
    if (!modelName) return normalizeModelSettingsConfig(nextSettings).normalized
    const existingIndex = nextSettings.options.findIndex((option) => option.name === modelName)
    const apiProvider = modelOptionProviderForSavedProvider(provider)
    if (existingIndex >= 0) {
      nextSettings.options = nextSettings.options.map((option, index) =>
        index === existingIndex && !option.locked
          ? {
              ...option,
              checked: true,
              type: 'custom',
              displayName: option.displayName,
              apiProvider
            }
          : option
      )
    } else {
      nextSettings.options = [
        ...nextSettings.options,
        {
          name: modelName,
          displayName: undefined,
          locked: false,
          checked: true,
          type: 'custom',
          apiProvider
        }
      ]
    }
    return normalizeModelSettingsConfig(nextSettings).normalized
  }

  const applyModelOptionSettingsSnapshot = (settings: ModelSettingsUserConfig) => {
    addModelSwitch.value = settings.addModelSwitch
    settingModelOptions.value = settings.options.filter(isVisibleModelSettingsOption).map((option) => ({
      name: option.name,
      displayName: option.displayName,
      locked: option.locked,
      checked: option.checked,
      type: option.type,
      apiProvider: option.apiProvider
    }))
  }

  const applyModelSettingsSnapshot = (source: unknown) => {
    const { normalized } = normalizeModelSettingsConfig(source)
    modelProviders.value = {
      litellm: { ...normalized.providers.litellm },
      openai: { ...normalized.providers.openai },
      bedrock: { ...normalized.providers.bedrock },
      deepseek: { ...normalized.providers.deepseek },
      anthropic: { ...normalized.providers.anthropic },
      ollama: { ...normalized.providers.ollama },
      lmstudio: { ...normalized.providers.lmstudio }
    }
    applyModelOptionSettingsSnapshot(normalized)
    return normalized
  }

  const persistModelSettings = async (
    nextSettings: ModelSettingsUserConfig,
    unavailableMessage = '模型设置保存服务不可用',
    failureMessage = '模型设置保存失败'
  ) => {
    const saveConfigBridge = appRuntimeClient.saveConfig()
    if (typeof saveConfigBridge !== 'function') {
      setSettingsNotice(unavailableMessage)
      return false
    }
    try {
      const savedConfig = await saveConfigBridge({ modelSettings: nextSettings })
      if (!isRecord(savedConfig) || !isRecord(savedConfig.modelSettings)) {
        setSettingsNotice(failureMessage)
        return false
      }
      const savedModelSettings = normalizeModelSettingsConfig(savedConfig.modelSettings).normalized
      if (!modelSettingsSnapshotsMatch(savedModelSettings, nextSettings)) {
        setSettingsNotice(failureMessage)
        return false
      }
      applyModelOptionSettingsSnapshot(savedModelSettings)
      config.value = mergeGenericSavedConfig(config.value, savedConfig, {
        modelSettings: savedModelSettings
      })
      await refreshAiModelCatalog({ replaceSettingsOptions: false })
      return true
    } catch (error) {
      setSettingsNotice(error instanceof Error ? error.message : failureMessage)
      return false
    }
  }

  const selectAiModel = async (modelId: string) => {
    const nextModelName = normalizeUserModelName(modelId)
    if (!nextModelName) return false
    const modelOption = aiModelOptions.value.find((option) => normalizeUserModelName(option.id) === nextModelName)
    if (!modelOption && lockedAiModelOptions.value.some((option) => normalizeUserModelName(option.id) === nextModelName)) {
      setTopNotice('AI 模型不可用')
      return false
    }
    const nextModelProvider = normalizeCatalogModelProvider(modelOption?.apiProvider || config.value.modelProvider)
    if (nextModelName === config.value.modelName && nextModelProvider === config.value.modelProvider) return true
    const saveConfigBridge = appRuntimeClient.saveConfig()
    if (typeof saveConfigBridge !== 'function') {
      setTopNotice('AI 模型保存服务不可用')
      return false
    }
    try {
      const savedConfig = await saveConfigBridge({ modelName: nextModelName, modelProvider: nextModelProvider })
      if (
        !isRecord(savedConfig) ||
        normalizeUserModelName(savedConfig.modelName) !== nextModelName ||
        normalizeUserModelProvider(savedConfig.modelProvider) !== nextModelProvider
      ) {
        setTopNotice('AI 模型保存失败')
        return false
      }
      config.value = mergeGenericSavedConfig(config.value, savedConfig, {
        modelName: nextModelName,
        modelProvider: nextModelProvider
      })
      return true
    } catch (error) {
      setTopNotice(error instanceof Error ? error.message : 'AI 模型保存失败')
      return false
    }
  }

  const updateModelOption = async (name: string, checked: boolean) => {
    const model = settingModelOptions.value.find((item) => item.name === name)
    if (!model || model.locked) return false
    const nextSettings = getPersistedModelSettingsSnapshot()
    nextSettings.options = getModelSettingsSnapshot().options.map((item) => (item.name === name ? { ...item, checked } : item))
    return persistModelSettings(nextSettings)
  }

  const removeModelOption = async (name: string) => {
    const model = settingModelOptions.value.find((item) => item.name === name)
    if (!model || model.locked || model.type !== 'custom') return false
    const nextSettings = getPersistedModelSettingsSnapshot()
    nextSettings.options = getModelSettingsSnapshot().options.filter((item) => item.name !== name || item.locked)
    return persistModelSettings(nextSettings)
  }

  const renameModelOption = async (name: string, displayName: string) => {
    const model = settingModelOptions.value.find((item) => item.name === name)
    if (!model || model.locked || model.type !== 'custom') return false
    const nextDisplayName = displayName.trim()
    const nextSettings = getPersistedModelSettingsSnapshot()
    nextSettings.options = getModelSettingsSnapshot().options.map((item) =>
      item.name === name
        ? {
            ...item,
            displayName: nextDisplayName && nextDisplayName !== name ? nextDisplayName : undefined
          }
        : item
    )
    return persistModelSettings(nextSettings)
  }

  const toggleAddModelSwitch = async (checked: boolean) => {
    const nextSettings = {
      ...getPersistedModelSettingsSnapshot(),
      addModelSwitch: checked
    }
    return persistModelSettings(nextSettings)
  }

  const updateModelProviderConfig = (provider: ModelProviderKey, patch: Partial<ModelProviderSettings>) => {
    modelProviders.value[provider] = { ...modelProviders.value[provider], ...patch }
  }

  const checkModelProvider = async (provider: ModelProviderKey) => {
    const requestSeq = (modelCheckRequestSeq.value[provider] || 0) + 1
    modelCheckRequestSeq.value = { ...modelCheckRequestSeq.value, [provider]: requestSeq }
    modelCheckState.value = { ...modelCheckState.value, [provider]: 'checking' }
    const providerConfig = { ...modelProviders.value[provider] }
    const checkProviderBridge = modelProviderClient.checkModelProvider()
    if (typeof checkProviderBridge !== 'function') {
      if (modelCheckRequestSeq.value[provider] !== requestSeq) return
      modelCheckState.value = { ...modelCheckState.value, [provider]: 'error' }
      setSettingsNotice('模型 Provider 检查服务不可用')
      return
    }
    try {
      const result = await checkProviderBridge({ provider, config: providerConfig })
      if (modelCheckRequestSeq.value[provider] !== requestSeq) return
      if (result.ok) {
        if (!isModelProviderCheckDataForRequest(result.data, provider, providerConfig)) {
          modelCheckState.value = { ...modelCheckState.value, [provider]: 'error' }
          setSettingsNotice(malformedModelProviderResultMessage)
          return
        }
        modelCheckState.value = { ...modelCheckState.value, [provider]: 'success' }
        setSettingsNotice(result.data.message)
      } else {
        modelCheckState.value = { ...modelCheckState.value, [provider]: 'error' }
        setSettingsNotice(result.errorMessage || `${provider} Check 失败`)
      }
    } catch (error) {
      if (modelCheckRequestSeq.value[provider] !== requestSeq) return
      modelCheckState.value = { ...modelCheckState.value, [provider]: 'error' }
      setSettingsNotice(`模型 Provider 检查失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const saveModelProvider = async (provider: ModelProviderKey) => {
    const saveConfigBridge = appRuntimeClient.saveConfig()
    if (typeof saveConfigBridge !== 'function') {
      setSettingsNotice('模型 Provider 保存服务不可用')
      return false
    }
    const configPatch = modelProviders.value[provider]
    const providerName: Record<ModelProviderKey, UserConfig['modelProvider']> = {
      litellm: 'litellm',
      openai: 'openai-compatible',
      bedrock: 'bedrock',
      deepseek: 'deepseek',
      anthropic: 'anthropic',
      ollama: 'ollama',
      lmstudio: 'lmstudio'
    }
    const providerLabel: Record<ModelProviderKey, string> = {
      litellm: 'LiteLLM',
      openai: 'OpenAI Compatible',
      bedrock: 'Amazon Bedrock',
      deepseek: 'DeepSeek',
      anthropic: 'Anthropic',
      ollama: 'Ollama',
      lmstudio: 'LM Studio'
    }
    const nextModelSettings = getModelSettingsSnapshotWithProviderModel(provider, configPatch)
    try {
      const savedConfig = await saveConfigBridge({
        modelProvider: providerName[provider],
        modelEndpoint: configPatch.baseUrl,
        modelName: configPatch.modelId,
        modelSettings: nextModelSettings
      })
      if (!isRecord(savedConfig) || !isRecord(savedConfig.modelSettings) || !isRecord(savedConfig.modelSettings.providers) || !Array.isArray(savedConfig.modelSettings.options)) {
        setSettingsNotice('模型 Provider 保存失败')
        return false
      }
      const savedModelSettings = normalizeModelSettingsConfig(savedConfig.modelSettings).normalized
      if (!modelSettingsSnapshotsMatch(savedModelSettings, nextModelSettings)) {
        setSettingsNotice('模型 Provider 保存失败')
        return false
      }
      const savedProviderSettings = normalizeModelProviderConfig(savedConfig.modelSettings.providers[provider], defaultModelProviders[provider])
      if (savedProviderSettings.baseUrl !== configPatch.baseUrl || savedProviderSettings.modelId !== configPatch.modelId) {
        setSettingsNotice('模型 Provider 保存失败')
        return false
      }
      const savedProvider = normalizeUserModelProvider(savedConfig.modelProvider)
      const savedModelName = normalizeUserModelName(savedConfig.modelName)
      if (typeof savedConfig.modelEndpoint !== 'string') {
        setSettingsNotice('模型 Provider 保存失败')
        return false
      }
      const savedEndpoint = savedConfig.modelEndpoint
      if (savedProvider !== providerName[provider] || savedModelName !== configPatch.modelId || savedEndpoint !== configPatch.baseUrl) {
        setSettingsNotice('模型 Provider 保存失败')
        return false
      }
      applyModelSettingsSnapshot(savedModelSettings)
      config.value = mergeGenericSavedConfig(config.value, savedConfig, {
        modelProvider: savedProvider,
        modelEndpoint: savedEndpoint,
        modelName: savedModelName,
        modelSettings: savedModelSettings
      })
      await refreshAiModelCatalog({ replaceSettingsOptions: false })
      setSettingsNotice(`${providerLabel[provider]} Save 成功`)
      return true
    } catch (error) {
      setSettingsNotice(error instanceof Error ? error.message : '模型 Provider 保存失败')
      return false
    }
  }

  return {
    applyModelSettingsSnapshot,
    refreshAiModelCatalog,
    selectAiModel,
    updateModelOption,
    removeModelOption,
    renameModelOption,
    toggleAddModelSwitch,
    updateModelProviderConfig,
    checkModelProvider,
    saveModelProvider
  }
}
