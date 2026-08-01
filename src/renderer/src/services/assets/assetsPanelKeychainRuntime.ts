import { computed, reactive, ref, type Ref } from 'vue'

import type { AiopsAssetAuthType, AiopsKeychainRecord } from '@shared/contracts/assets'
import { assetsClient } from '@/services/assets/assetsClient'
import {
  isAiopsKeychainDeleteData,
  isAiopsKeychainListData,
  malformedAssetBackendResultMessage
} from '@/services/assets/assetBackendGuards'
import { createAssetKeyEditorRuntime } from '@/services/assets/assetKeyEditorRuntime'

type AssetsPanelHostFormKeyTarget = {
  auth_type: AiopsAssetAuthType
  keyId: string
}

type AssetsPanelConfirmState = {
  open: boolean
  title: string
  message: string
  expectedText: string
  action: null | (() => void | Promise<void>)
}

type AssetsPanelKeychainRuntimeInput = {
  activeAssetView: Ref<string>
  editorOpen: Ref<boolean>
  pendingHostDraftReturn: Ref<boolean>
  form: AssetsPanelHostFormKeyTarget
  confirmInput: Ref<string>
  confirmState: AssetsPanelConfirmState
}

export const createAssetsPanelKeychainRuntime = ({
  activeAssetView,
  editorOpen,
  pendingHostDraftReturn,
  form,
  confirmInput,
  confirmState
}: AssetsPanelKeychainRuntimeInput) => {
  const keychains = ref<AiopsKeychainRecord[]>([])
  const keyQuery = ref('')
  const selectedKeyId = ref<string | null>(null)
  const keyContextMenuId = ref<string | null>(null)
  const keyContextPosition = reactive({ x: 0, y: 0 })
  const keyServiceNotice = ref('')

  const filteredKeychains = computed(() => {
    const keyword = keyQuery.value.trim().toLowerCase()
    if (!keyword) return keychains.value
    return keychains.value.filter((key) => `${key.name} ${key.type} ${key.publicKey}`.toLowerCase().includes(keyword))
  })

  const refreshKeychains = async () => {
    const listKeychains = assetsClient.listKeychains()
    if (!listKeychains) {
      keyServiceNotice.value = '密钥列表服务不可用。'
      throw new Error(keyServiceNotice.value)
    }
    try {
      const nextKeychains = await listKeychains()
      if (!isAiopsKeychainListData(nextKeychains)) throw new Error(malformedAssetBackendResultMessage)
      keychains.value = nextKeychains.map((keychain) => ({ ...keychain }))
      keyServiceNotice.value = ''
    } catch (error) {
      keyServiceNotice.value = error instanceof Error ? error.message : '密钥加载失败。'
      throw new Error(keyServiceNotice.value)
    }
  }

  const keyEditorRuntime = createAssetKeyEditorRuntime({
    keychains,
    serviceNotice: keyServiceNotice,
    refreshKeychains,
    onSaved: (saved) => {
      selectedKeyId.value = saved.id
      if (!pendingHostDraftReturn.value) return
      form.auth_type = 'keyBased'
      form.keyId = saved.id
      activeAssetView.value = 'assetConfig'
      editorOpen.value = true
      pendingHostDraftReturn.value = false
    }
  })

  const openKeyCreateFromHostForm = () => {
    pendingHostDraftReturn.value = true
    activeAssetView.value = 'keyManagement'
    keyEditorRuntime.openNewKeyPanel()
  }

  const editKey = async (keyId: string | null) => {
    const opened = await keyEditorRuntime.editKey(keyId)
    keyContextMenuId.value = null
    return opened
  }

  const removeKey = (keyId: string | null) => {
    if (!keyId) return
    const key = keychains.value.find((item) => item.id === keyId)
    if (!key) return
    keyContextMenuId.value = null
    confirmState.open = true
    confirmState.title = '删除密钥'
    confirmState.message = `确定删除密钥 ${key.name}？`
    confirmState.expectedText = key.name
    confirmState.action = async () => {
      const deleteKeychain = assetsClient.deleteKeychain()
      if (!deleteKeychain) {
        keyServiceNotice.value = '密钥删除服务不可用。'
        keyEditorRuntime.keyImportNotice.value = '密钥删除服务不可用。'
        return
      }
      const result = await deleteKeychain(keyId)
      if (!result?.ok) {
        keyServiceNotice.value = result?.errorMessage || '密钥删除失败。'
        keyEditorRuntime.keyImportNotice.value = result?.errorMessage || '密钥删除失败。'
        return
      }
      if (!isAiopsKeychainDeleteData(result.data, keyId)) {
        keyServiceNotice.value = malformedAssetBackendResultMessage
        keyEditorRuntime.keyImportNotice.value = malformedAssetBackendResultMessage
        return
      }
      try {
        await refreshKeychains()
      } catch (error) {
        keyServiceNotice.value = error instanceof Error ? error.message : '密钥加载失败。'
        keyEditorRuntime.keyImportNotice.value = error instanceof Error ? error.message : '密钥加载失败。'
        return
      }
      selectedKeyId.value = selectedKeyId.value === keyId ? null : selectedKeyId.value
      form.keyId = form.keyId === keyId ? '' : form.keyId
      keyServiceNotice.value = ''
      keyEditorRuntime.keyImportNotice.value = `已删除密钥 ${key.name}。`
    }
    confirmInput.value = ''
  }

  const openKeyContextMenu = (event: MouseEvent, keyId: string) => {
    keyContextMenuId.value = keyId
    const menuWidth = 150
    const menuHeight = 120
    const padding = 10
    keyContextPosition.x = Math.max(padding, Math.min(event.clientX, window.innerWidth - menuWidth - padding))
    keyContextPosition.y = Math.max(padding, Math.min(event.clientY, window.innerHeight - menuHeight - padding))
  }

  const closeKeyContextMenu = () => {
    keyContextMenuId.value = null
  }

  return {
    keychains,
    keyQuery,
    selectedKeyId,
    keyContextMenuId,
    keyContextPosition,
    keyServiceNotice,
    ...keyEditorRuntime,
    filteredKeychains,
    refreshKeychains,
    openKeyCreateFromHostForm,
    editKey,
    removeKey,
    openKeyContextMenu,
    closeKeyContextMenu
  }
}
