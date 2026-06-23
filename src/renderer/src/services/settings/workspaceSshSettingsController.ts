import { type Ref } from 'vue'
import { assetsClient } from '@/services/assets/assetsClient'
import { appRuntimeClient } from '@/services/app/appRuntimeClient'
import {
  mergeGenericSavedConfig,
  normalizeSshAgentKeys,
  normalizeSshProxyConfigs,
  readSshAgentKeychainOptionsSnapshot,
  sshAgentKeySnapshotsMatch,
  sshProxyConfigSnapshotsMatch,
  sshProxyTypes
} from '@/services/settings/workspaceConfigRuntime'
import type {
  SshAgentKeyConfig,
  SshAgentKeychainOption,
  SshProxyConfig
} from '@shared/contracts/appRuntime'
import type { UserConfig } from '@shared/contracts/userConfig'

type WorkspaceSshProxyForm = SshProxyConfig

type WorkspaceSshSettingsControllerState = {
  config: Ref<UserConfig>
  sshProxyConfigs: Ref<SshProxyConfig[]>
  sshProxyConfigModalOpen: Ref<boolean>
  sshProxyAddModalOpen: Ref<boolean>
  sshProxyForm: Ref<WorkspaceSshProxyForm>
  sshAgentKeys: Ref<SshAgentKeyConfig[]>
  sshAgentConfigModalOpen: Ref<boolean>
  sshAgentSelectedKey: Ref<string>
  sshAgentKeyChainOptions: Ref<SshAgentKeychainOption[]>
}

type WorkspaceSshSettingsControllerDeps = {
  setSettingsNotice: (message: string) => void
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const numberInRange = (value: unknown, fallback: number, min: number, max?: number) =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && (max === undefined || value <= max) ? value : fallback

const stringFromOptions = <T extends string>(value: unknown, options: readonly T[], fallback: T) => (typeof value === 'string' && options.includes(value as T) ? (value as T) : fallback)

export const createWorkspaceSshSettingsController = (
  state: WorkspaceSshSettingsControllerState,
  deps: WorkspaceSshSettingsControllerDeps
) => {
  const {
    config,
    sshProxyConfigs,
    sshProxyConfigModalOpen,
    sshProxyAddModalOpen,
    sshProxyForm,
    sshAgentKeys,
    sshAgentConfigModalOpen,
    sshAgentSelectedKey,
    sshAgentKeyChainOptions
  } = state
  const { setSettingsNotice } = deps

  const refreshSshAgentKeychainOptions = async () => {
    const listSshAgentKeychainOptions = assetsClient.listSshAgentKeychainOptions()
    if (!listSshAgentKeychainOptions) {
      setSettingsNotice('SSH Agent 密钥列表服务不可用')
      return false
    }
    try {
      const options = readSshAgentKeychainOptionsSnapshot(await listSshAgentKeychainOptions())
      if (!options) {
        setSettingsNotice('SSH Agent 密钥列表返回数据无效')
        return false
      }
      sshAgentKeyChainOptions.value = options
      return true
    } catch {
      setSettingsNotice('SSH Agent 密钥列表加载失败')
      return false
    }
  }

  const resetSshProxyForm = () => {
    sshProxyForm.value = {
      name: '',
      type: 'SOCKS5',
      host: '127.0.0.1',
      port: 22,
      enableProxyIdentity: false,
      username: '',
      password: ''
    }
  }

  const openSshProxyConfig = () => {
    sshProxyConfigModalOpen.value = true
  }

  const closeSshProxyConfig = () => {
    sshProxyConfigModalOpen.value = false
  }

  const openAddSshProxyConfig = () => {
    resetSshProxyForm()
    sshProxyAddModalOpen.value = true
  }

  const closeAddSshProxyConfig = () => {
    sshProxyAddModalOpen.value = false
    resetSshProxyForm()
  }

  const updateSshProxyForm = (patch: Partial<WorkspaceSshProxyForm>) => {
    sshProxyForm.value = {
      ...sshProxyForm.value,
      ...patch,
      type: stringFromOptions(patch.type || sshProxyForm.value.type, sshProxyTypes, 'SOCKS5'),
      port: patch.port !== undefined ? numberInRange(patch.port, sshProxyForm.value.port, 1, 65535) : sshProxyForm.value.port
    }
  }

  const persistSshProxyConfigs = async (nextConfigs: SshProxyConfig[], unavailableNotice: string, failureNotice: string) => {
    const saveConfigBridge = appRuntimeClient.saveConfig()
    if (typeof saveConfigBridge !== 'function') {
      setSettingsNotice(unavailableNotice)
      return false
    }
    const normalizedConfigs = normalizeSshProxyConfigs(nextConfigs).normalized
    try {
      const savedConfig = await saveConfigBridge({
        sshProxyConfigs: normalizedConfigs.map((config) => ({ ...config }))
      })
      if (!isRecord(savedConfig) || !Array.isArray(savedConfig.sshProxyConfigs)) {
        setSettingsNotice(failureNotice)
        return false
      }
      const savedProxyConfigs = normalizeSshProxyConfigs(savedConfig.sshProxyConfigs).normalized
      if (!sshProxyConfigSnapshotsMatch(savedProxyConfigs, normalizedConfigs)) {
        setSettingsNotice(failureNotice)
        return false
      }
      config.value = mergeGenericSavedConfig(config.value, savedConfig, {
        sshProxyConfigs: savedProxyConfigs
      })
      sshProxyConfigs.value = savedProxyConfigs.map((config) => ({ ...config }))
      return true
    } catch (error) {
      setSettingsNotice(error instanceof Error ? error.message : failureNotice)
      return false
    }
  }

  const saveSshProxyForm = async () => {
    const rawName = sshProxyForm.value.name.trim()
    const rawHost = sshProxyForm.value.host.trim()
    if (!rawName) {
      setSettingsNotice('请输入代理配置名称')
      return false
    }
    if (!rawHost) {
      setSettingsNotice('请输入代理主机')
      return false
    }
    const proxyConfig = normalizeSshProxyConfigs([{ ...sshProxyForm.value, name: rawName, host: rawHost }]).normalized[0]
    if (!proxyConfig) return false
    if (sshProxyConfigs.value.some((config) => config.name === proxyConfig.name)) {
      setSettingsNotice('代理配置名称已存在')
      return false
    }
    const saved = await persistSshProxyConfigs([...sshProxyConfigs.value, proxyConfig], 'SSH 代理配置保存服务不可用', 'SSH 代理配置保存失败')
    if (!saved) return false
    closeAddSshProxyConfig()
    setSettingsNotice('SSH 代理配置已添加')
    return true
  }

  const removeSshProxyConfig = async (name: string) => {
    const nextConfigs = sshProxyConfigs.value.filter((config) => config.name !== name)
    if (nextConfigs.length === sshProxyConfigs.value.length) return false
    const saved = await persistSshProxyConfigs(nextConfigs, 'SSH 代理配置删除服务不可用', 'SSH 代理配置删除失败')
    if (!saved) return false
    setSettingsNotice('SSH 代理配置已删除')
    return true
  }

  const persistSshAgentKeys = async (nextKeys: SshAgentKeyConfig[], unavailableNotice: string, failureNotice: string) => {
    const saveConfigBridge = appRuntimeClient.saveConfig()
    if (typeof saveConfigBridge !== 'function') {
      setSettingsNotice(unavailableNotice)
      return false
    }
    const normalizedKeys = normalizeSshAgentKeys(nextKeys).normalized
    try {
      const savedConfig = await saveConfigBridge({
        sshAgentKeys: normalizedKeys.map((key) => ({ ...key }))
      })
      if (!isRecord(savedConfig) || !Array.isArray(savedConfig.sshAgentKeys)) {
        setSettingsNotice(failureNotice)
        return false
      }
      const savedKeys = normalizeSshAgentKeys(savedConfig.sshAgentKeys).normalized
      if (!sshAgentKeySnapshotsMatch(savedKeys, normalizedKeys)) {
        setSettingsNotice(failureNotice)
        return false
      }
      config.value = mergeGenericSavedConfig(config.value, savedConfig, {
        sshAgentKeys: savedKeys
      })
      sshAgentKeys.value = savedKeys.map((key) => ({ ...key }))
      return true
    } catch (error) {
      setSettingsNotice(error instanceof Error ? error.message : failureNotice)
      return false
    }
  }

  const openSshAgentConfig = () => {
    sshAgentConfigModalOpen.value = true
    void refreshSshAgentKeychainOptions()
  }

  const closeSshAgentConfig = () => {
    sshAgentConfigModalOpen.value = false
  }

  const setSshAgentSelectedKey = (key: string) => {
    sshAgentSelectedKey.value = key
  }

  const addSshAgentKey = async () => {
    const selectedKey = sshAgentSelectedKey.value
    if (!selectedKey) {
      setSettingsNotice('请选择密钥')
      return false
    }
    const option = sshAgentKeyChainOptions.value.find((item) => item.key === selectedKey)
    if (!option) {
      setSettingsNotice('密钥不存在')
      return false
    }
    if (sshAgentKeys.value.some((key) => key.keyChainId === option.key || key.id === option.key)) {
      setSettingsNotice('密钥已添加')
      sshAgentSelectedKey.value = ''
      return false
    }
    const agentKey: SshAgentKeyConfig = {
      id: option.key,
      fingerprint: option.fingerprint,
      comment: option.label,
      keyType: option.keyType,
      keyChainId: option.key
    }
    const saved = await persistSshAgentKeys([...sshAgentKeys.value, agentKey], 'SSH Agent 密钥保存服务不可用', 'SSH Agent 密钥保存失败')
    if (!saved) return false
    sshAgentSelectedKey.value = ''
    setSettingsNotice('SSH Agent 密钥已添加')
    return true
  }

  const removeSshAgentKey = async (id: string) => {
    const nextKeys = sshAgentKeys.value.filter((key) => key.id !== id)
    if (nextKeys.length === sshAgentKeys.value.length) return false
    const saved = await persistSshAgentKeys(nextKeys, 'SSH Agent 密钥移除服务不可用', 'SSH Agent 密钥移除失败')
    if (!saved) return false
    setSettingsNotice('SSH Agent 密钥已移除')
    return true
  }

  return {
    refreshSshAgentKeychainOptions,
    openSshProxyConfig,
    closeSshProxyConfig,
    openAddSshProxyConfig,
    closeAddSshProxyConfig,
    updateSshProxyForm,
    saveSshProxyForm,
    removeSshProxyConfig,
    openSshAgentConfig,
    closeSshAgentConfig,
    setSshAgentSelectedKey,
    addSshAgentKey,
    removeSshAgentKey
  }
}
