import { computed, ref, type Ref } from 'vue'
import { aliasClient } from '@/services/aliasClient'
import {
  isAliasCommandDeleteData,
  isAliasCommandListData,
  isAliasCommandMutationData,
  malformedAliasBackendResultMessage
} from '@/services/extensionBackendGuards'
import { mergeUserConfig, normalizeAliasCommandsConfig } from '@/services/workspaceConfigRuntime'
import type { AliasCommandConfig, AliasCommandSaveInput } from '@shared/contracts/aliases'
import type { UserConfig } from '@shared/contracts/userConfig'

export type WorkspaceAliasCommand = AliasCommandConfig & { edit?: boolean }

type WorkspaceAliasControllerState = {
  config: Ref<UserConfig>
  aliasCommands: Ref<WorkspaceAliasCommand[]>
  aliasSearchQuery: Ref<string>
}

type WorkspaceAliasClient = Pick<typeof aliasClient, 'listAliasCommands' | 'saveAliasCommand' | 'deleteAliasCommand'>

type WorkspaceAliasControllerDeps = {
  client?: WorkspaceAliasClient
  setExtensionNotice: (text: string) => void
}

export const createWorkspaceAliasController = (
  {
    config,
    aliasCommands,
    aliasSearchQuery
  }: WorkspaceAliasControllerState,
  deps: WorkspaceAliasControllerDeps
) => {
  const client = deps.client ?? aliasClient
  const aliasEditSnapshot = ref<WorkspaceAliasCommand | null>(null)

  const filteredAliasCommands = computed(() => {
    const query = aliasSearchQuery.value.trim().toLowerCase()
    if (!query) return aliasCommands.value
    return aliasCommands.value.filter((item) => item.alias.toLowerCase().includes(query) || item.command.toLowerCase().includes(query))
  })

  const getAliasCommandsSnapshot = (): AliasCommandConfig[] =>
    aliasCommands.value
      .filter((alias) => alias.id !== 'new' && alias.alias.trim() && alias.command.trim())
      .map((alias) => ({
        id: alias.id,
        alias: alias.alias.trim(),
        command: alias.command.trim(),
        createdAt: alias.createdAt
      }))

  const hasAliasListBridge = () => Boolean(client.listAliasCommands())

  const applyAliasCommandsFromBackend = (commands: AliasCommandConfig[]) => {
    const { normalized } = normalizeAliasCommandsConfig(commands)
    aliasCommands.value = normalized.map((alias) => ({ ...alias, edit: false }))
    config.value = mergeUserConfig(config.value, { aliasCommands: normalized })
    return normalized
  }

  const loadAliasCommandsFromBackend = async () => {
    const listAliasCommands = client.listAliasCommands()
    if (!listAliasCommands) throw new Error('Alias 服务不可用')
    const result = await listAliasCommands()
    if (!result?.ok) throw new Error(result?.errorMessage || 'Alias 加载失败')
    if (!isAliasCommandListData(result.data)) throw new Error(malformedAliasBackendResultMessage)
    return result.data
  }

  const refreshAliasCommands = async () => {
    try {
      const commands = await loadAliasCommandsFromBackend()
      applyAliasCommandsFromBackend(commands)
      return true
    } catch (error) {
      deps.setExtensionNotice(error instanceof Error ? error.message : 'Alias 加载失败')
      return false
    }
  }

  const syncAliasConfigFromBackend = (commands: AliasCommandConfig[]) => {
    applyAliasCommandsFromBackend(commands)
  }

  const hydrateAliasCommands = async () => {
    let normalizedAliasCommands = normalizeAliasCommandsConfig().normalized
    let aliasCommandsLoadedFromBridge = false
    try {
      const bridgeAliasCommands = await loadAliasCommandsFromBackend()
      const snapshot = normalizeAliasCommandsConfig(bridgeAliasCommands)
      normalizedAliasCommands = snapshot.normalized
      aliasCommandsLoadedFromBridge = true
    } catch (error) {
      deps.setExtensionNotice(error instanceof Error ? error.message : hasAliasListBridge() ? 'Alias 加载失败' : 'Alias 服务不可用')
    }
    aliasCommands.value = normalizedAliasCommands.map((alias) => ({ ...alias, edit: false }))
    return {
      normalizedAliasCommands,
      aliasCommandsLoadedFromBridge
    }
  }

  const createAliasCommand = () => {
    if (aliasCommands.value.some((item) => item.id === 'new')) return
    aliasSearchQuery.value = ''
    if (aliasEditSnapshot.value && aliasEditSnapshot.value.id !== 'new') {
      aliasCommands.value = aliasCommands.value.map((item) =>
        item.id === aliasEditSnapshot.value?.id ? { ...aliasEditSnapshot.value, edit: false } : { ...item, edit: false }
      )
    } else {
      aliasCommands.value = aliasCommands.value.map((item) => ({ ...item, edit: false }))
    }
    aliasEditSnapshot.value = { id: 'new', alias: '', command: '', edit: true }
    aliasCommands.value = [{ id: 'new', alias: '', command: '', edit: true }, ...aliasCommands.value]
  }

  const startAliasEdit = (id: string) => {
    const target = aliasCommands.value.find((item) => item.id === id)
    if (!target) return
    if (aliasCommands.value.some((item) => item.id === 'new')) {
      aliasCommands.value = aliasCommands.value.filter((item) => item.id !== 'new')
    }
    if (aliasEditSnapshot.value && aliasEditSnapshot.value.id !== 'new') {
      aliasCommands.value = aliasCommands.value.map((item) =>
        item.id === aliasEditSnapshot.value?.id ? { ...aliasEditSnapshot.value, edit: false } : item
      )
    }
    aliasEditSnapshot.value = { ...target }
    aliasCommands.value = aliasCommands.value.map((item) => ({ ...item, edit: item.id === id }))
  }

  const updateAliasDraft = (id: string, patch: Partial<Pick<WorkspaceAliasCommand, 'alias' | 'command'>>) => {
    const target = aliasCommands.value.find((item) => item.id === id)
    if (!target) return
    Object.assign(target, patch)
  }

  const saveAliasCommand = async (id: string) => {
    const target = aliasCommands.value.find((item) => item.id === id)
    if (!target) return { ok: false, reason: 'not-found' as const }
    const alias = target.alias.trim()
    const command = target.command.trim()
    if (!alias || !command) {
      deps.setExtensionNotice('Alias 和 Command 不能为空')
      return { ok: false, reason: 'missing' as const }
    }
    const payload: AliasCommandSaveInput = {
      id: target.id === 'new' ? undefined : target.id,
      previousAlias: target.id === 'new' ? undefined : aliasEditSnapshot.value?.alias || target.alias,
      alias,
      command,
      createdAt: target.createdAt
    }
    const saveAliasCommandBridge = client.saveAliasCommand()
    if (!saveAliasCommandBridge) {
      deps.setExtensionNotice('Alias 保存服务不可用')
      return { ok: false, reason: 'backend' as const }
    }
    try {
      const result = await saveAliasCommandBridge(payload)
      if (!result?.ok) {
        if (result?.errorCode === 'ALIAS_DUPLICATE') {
          deps.setExtensionNotice('Alias 已存在')
          return { ok: false, reason: 'duplicate' as const }
        }
        deps.setExtensionNotice(result?.errorMessage || 'Alias 保存失败')
        return { ok: false, reason: 'backend' as const }
      }
      if (!isAliasCommandMutationData(result.data)) {
        deps.setExtensionNotice(malformedAliasBackendResultMessage)
        return { ok: false, reason: 'backend' as const }
      }
      syncAliasConfigFromBackend(result.data.commands)
      aliasEditSnapshot.value = null
      deps.setExtensionNotice('Alias 已保存')
      return { ok: true, reason: 'saved' as const }
    } catch (error) {
      deps.setExtensionNotice(error instanceof Error ? error.message : 'Alias 保存失败')
      return { ok: false, reason: 'backend' as const }
    }
  }

  const cancelAliasEdit = (id: string) => {
    if (id === 'new') {
      aliasCommands.value = aliasCommands.value.filter((item) => item.id !== 'new')
      aliasEditSnapshot.value = null
      return
    }
    const target = aliasCommands.value.find((item) => item.id === id)
    if (target && aliasEditSnapshot.value?.id === id) {
      target.alias = aliasEditSnapshot.value.alias
      target.command = aliasEditSnapshot.value.command
      target.edit = false
    } else if (target) {
      target.edit = false
    }
    aliasEditSnapshot.value = null
  }

  const deleteAliasCommand = async (id: string) => {
    const target = aliasCommands.value.find((item) => item.id === id)
    if (!target) return { ok: false, reason: 'not-found' as const }
    const deleteAliasCommandBridge = client.deleteAliasCommand()
    if (!deleteAliasCommandBridge) {
      deps.setExtensionNotice('Alias 删除服务不可用')
      return { ok: false, reason: 'backend' as const }
    }
    try {
      const result = await deleteAliasCommandBridge({ id: target.id, alias: target.alias })
      if (!result?.ok) {
        deps.setExtensionNotice(result?.errorMessage || 'Alias 删除失败')
        return { ok: false, reason: 'backend' as const }
      }
      if (!isAliasCommandDeleteData(result.data)) {
        deps.setExtensionNotice(malformedAliasBackendResultMessage)
        return { ok: false, reason: 'backend' as const }
      }
      syncAliasConfigFromBackend(result.data.commands)
      if (aliasEditSnapshot.value?.id === id) aliasEditSnapshot.value = null
      deps.setExtensionNotice('Alias 已删除')
      return { ok: true, reason: 'deleted' as const }
    } catch (error) {
      deps.setExtensionNotice(error instanceof Error ? error.message : 'Alias 删除失败')
      return { ok: false, reason: 'backend' as const }
    }
  }

  return {
    filteredAliasCommands,
    getAliasCommandsSnapshot,
    refreshAliasCommands,
    hydrateAliasCommands,
    createAliasCommand,
    startAliasEdit,
    updateAliasDraft,
    saveAliasCommand,
    cancelAliasEdit,
    deleteAliasCommand
  }
}

export type WorkspaceAliasController = ReturnType<typeof createWorkspaceAliasController>
