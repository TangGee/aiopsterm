import { computed, reactive, ref, type Ref } from 'vue'

import type {
  AiopsAssetAuthType,
  AiopsKeychainInput,
  AiopsKeychainRecord,
  AiopsKeychainType
} from '@shared/contracts/assets'
import { assetsClient } from '@/services/assetsClient'
import { localFilesClient } from '@/services/localFilesClient'
import {
  isAiopsKeychainDeleteData,
  isAiopsKeychainListData,
  isAiopsKeychainRecord,
  malformedAssetBackendResultMessage
} from '@/services/assetBackendGuards'

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
  const keyEditorOpen = ref(false)
  const keyEditMode = ref(false)
  const selectedKeyId = ref<string | null>(null)
  const keyContextMenuId = ref<string | null>(null)
  const keyContextPosition = reactive({ x: 0, y: 0 })
  const keyDragOver = ref(false)
  const keyServiceNotice = ref('')
  const keyImportNotice = ref('')
  const keyFormError = ref('')
  const keyForm = reactive({
    id: '',
    name: '',
    privateKey: '',
    publicKey: '',
    passphrase: ''
  })

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

  const openNewKeyPanel = () => {
    keyEditMode.value = false
    keyFormError.value = ''
    keyImportNotice.value = ''
    Object.assign(keyForm, { id: '', name: '', privateKey: '', publicKey: '', passphrase: '' })
    keyEditorOpen.value = true
  }

  const openKeyCreateFromHostForm = () => {
    pendingHostDraftReturn.value = true
    activeAssetView.value = 'keyManagement'
    openNewKeyPanel()
  }

  const editKey = async (keyId: string | null) => {
    if (!keyId) return
    const getKeychain = assetsClient.getKeychain()
    if (!getKeychain) {
      keyServiceNotice.value = '密钥详情服务不可用。'
      keyContextMenuId.value = null
      return
    }
    let key: AiopsKeychainRecord | null = null
    try {
      key = await getKeychain(keyId)
    } catch (error) {
      keyServiceNotice.value = error instanceof Error ? error.message : '密钥加载失败。'
      keyContextMenuId.value = null
      return
    }
    if (!key) {
      keyServiceNotice.value = '密钥不存在或已被删除。'
      keyContextMenuId.value = null
      return
    }
    if (!isAiopsKeychainRecord(key)) {
      keyServiceNotice.value = malformedAssetBackendResultMessage
      keyContextMenuId.value = null
      return
    }
    keyEditMode.value = true
    keyFormError.value = ''
    keyServiceNotice.value = ''
    keyImportNotice.value = ''
    Object.assign(keyForm, { id: key.id, name: key.name, privateKey: key.privateKey || '', publicKey: key.publicKey, passphrase: key.passphrase || '' })
    keyEditorOpen.value = true
    keyContextMenuId.value = null
  }

  const detectKeyType = (privateKey = '', publicKey = ''): AiopsKeychainType => {
    const publicAlgorithm = publicKey.trim().split(/\s+/)[0]?.toLowerCase()
    if (publicAlgorithm === 'ssh-ed25519') return 'ed25519'
    if (publicAlgorithm === 'ssh-rsa') return 'rsa'
    if (publicAlgorithm?.startsWith('ecdsa-')) return 'ecdsa'

    if (privateKey.includes('BEGIN RSA PRIVATE KEY')) return 'rsa'
    if (privateKey.includes('BEGIN EC PRIVATE KEY')) return 'ecdsa'
    if (privateKey.includes('ssh-ed25519')) return 'ed25519'
    if (privateKey.includes('ssh-rsa')) return 'rsa'
    if (privateKey.includes('ecdsa-sha2')) return 'ecdsa'

    if (privateKey.includes('BEGIN OPENSSH PRIVATE KEY') && typeof globalThis.atob === 'function') {
      try {
        const body = privateKey.replace(/-----(BEGIN|END)[\s\S]+?KEY-----/g, '').replace(/\s+/g, '')
        const decoded = globalThis.atob(body)
        if (decoded.includes('ssh-ed25519')) return 'ed25519'
        if (decoded.includes('ssh-rsa')) return 'rsa'
        if (decoded.includes('ecdsa-sha2')) return 'ecdsa'
      } catch {
        // Invalid or redacted OpenSSH keys fall back to RSA, matching the visible default.
      }
    }

    return 'rsa'
  }

  const validateKeyForm = () => {
    const name = keyForm.name.trim()
    if (!name) return '请输入名称。'
    if (!keyForm.privateKey.trim()) return '请输入私钥。'
    if (keyForm.name.includes(' ')) return '名称不能包含空格。'
    if (keyForm.publicKey.includes(' ')) return '公钥不能包含空格。'
    if (keyForm.passphrase.includes(' ')) return 'Passphrase 不能包含空格。'
    const duplicate = keychains.value.find((key) => key.name === name && key.id !== keyForm.id)
    if (duplicate) return `密钥 ${name} 已存在。`
    return ''
  }

  const saveKeychainRecord = async (input: AiopsKeychainInput) => {
    const saveKeychain = assetsClient.saveKeychain()
    if (!saveKeychain) {
      throw new Error('密钥保存服务不可用。')
    }
    const result = await saveKeychain(input)
    if (!result?.ok) throw new Error(result?.errorMessage || '密钥保存失败')
    if (!isAiopsKeychainRecord(result.data)) throw new Error(malformedAssetBackendResultMessage)
    await refreshKeychains()
    return result.data
  }

  const submitKeyForm = async () => {
    const error = validateKeyForm()
    if (error) {
      keyFormError.value = error
      return
    }
    const name = keyForm.name.trim()
    const row: AiopsKeychainInput = {
      id: keyForm.id || undefined,
      name,
      type: detectKeyType(keyForm.privateKey, keyForm.publicKey),
      privateKey: keyForm.privateKey.trim(),
      publicKey: keyForm.publicKey.trim(),
      passphrase: keyForm.passphrase
    }
    try {
      const saved = await saveKeychainRecord(row)
      selectedKeyId.value = saved.id
      if (pendingHostDraftReturn.value) {
        form.auth_type = 'keyBased'
        form.keyId = saved.id
        activeAssetView.value = 'assetConfig'
        editorOpen.value = true
        pendingHostDraftReturn.value = false
      }
      keyFormError.value = ''
      keyImportNotice.value = `${keyEditMode.value ? '已保存' : '已创建'} ${saved.name}。`
      keyEditorOpen.value = false
    } catch (saveError) {
      keyFormError.value = saveError instanceof Error ? saveError.message : '密钥保存失败。'
    }
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
        keyImportNotice.value = '密钥删除服务不可用。'
        return
      }
      const result = await deleteKeychain(keyId)
      if (!result?.ok) {
        keyServiceNotice.value = result?.errorMessage || '密钥删除失败。'
        keyImportNotice.value = result?.errorMessage || '密钥删除失败。'
        return
      }
      if (!isAiopsKeychainDeleteData(result.data, keyId)) {
        keyServiceNotice.value = malformedAssetBackendResultMessage
        keyImportNotice.value = malformedAssetBackendResultMessage
        return
      }
      try {
        await refreshKeychains()
      } catch (error) {
        keyServiceNotice.value = error instanceof Error ? error.message : '密钥加载失败。'
        keyImportNotice.value = error instanceof Error ? error.message : '密钥加载失败。'
        return
      }
      selectedKeyId.value = selectedKeyId.value === keyId ? null : selectedKeyId.value
      form.keyId = form.keyId === keyId ? '' : form.keyId
      keyServiceNotice.value = ''
      keyImportNotice.value = `已删除密钥 ${key.name}。`
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

  const applyImportedKeyFile = (fileName: string, content: string) => {
    const text = content.trim()
    if (!text) {
      keyImportNotice.value = '密钥文件为空。'
      return
    }
    keyForm.privateKey = text
    keyFormError.value = ''
    const type = detectKeyType(keyForm.privateKey, keyForm.publicKey).toUpperCase()
    keyImportNotice.value = `已导入 ${fileName}，识别为 ${type}。`
  }

  const localFileName = (filePath: string) => filePath.split(/[/\\]/).filter(Boolean).at(-1) || filePath

  const readLocalTextFile = async (filePath: string, unavailableMessage: string) => {
    const readLocalFile = localFilesClient.readLocalFile()
    if (!readLocalFile) throw new Error(unavailableMessage)
    const result = await readLocalFile(filePath)
    return result.content
  }

  const importKeyFileFromPath = async (filePath: string) => {
    if (!filePath) {
      keyImportNotice.value = '没有选择密钥文件。'
      return
    }
    const fileName = localFileName(filePath)
    try {
      const content = await readLocalTextFile(filePath, '密钥文件读取服务不可用。')
      applyImportedKeyFile(fileName, content)
    } catch (error) {
      keyImportNotice.value = error instanceof Error ? error.message : '密钥文件读取失败。'
    }
  }

  const openKeyImportDialog = async () => {
    keyImportNotice.value = '请选择 .pem、.key、.pub、.ppk 等密钥文件。'
    const showOpenDialog = localFilesClient.showOpenDialog()
    if (!showOpenDialog) {
      keyImportNotice.value = '密钥文件选择服务不可用。'
      return
    }
    let result: Awaited<ReturnType<typeof showOpenDialog>>
    try {
      result = await showOpenDialog({
        properties: ['openFile'],
        filters: [
          { name: 'Key Files', extensions: ['pem', 'key', 'txt', 'pub', 'asc', 'crt', 'cer', 'der', 'p12', 'pfx', 'ssh', 'ppk', 'gpg'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })
    } catch {
      keyImportNotice.value = '密钥文件选择失败。'
      return
    }
    if (result?.canceled) {
      keyImportNotice.value = '已取消导入密钥。'
      return
    }
    await importKeyFileFromPath(result?.filePaths?.[0] || '')
  }

  const handleKeyDrop = async (event: DragEvent) => {
    keyDragOver.value = false
    const file = event.dataTransfer?.files?.[0]
    if (!file) {
      keyImportNotice.value = '没有检测到可导入的密钥文件。'
      return
    }
    const getPathForFile = localFilesClient.getPathForFile()
    const filePath =
      (getPathForFile ? getPathForFile(file) : '') || String((file as File & { path?: string }).path || '').trim()
    if (!filePath) {
      keyImportNotice.value = '拖拽导入需要本地文件路径。'
      return
    }
    await importKeyFileFromPath(filePath)
  }

  const closeKeyContextMenu = () => {
    keyContextMenuId.value = null
  }

  return {
    keychains,
    keyQuery,
    keyEditorOpen,
    keyEditMode,
    selectedKeyId,
    keyContextMenuId,
    keyContextPosition,
    keyDragOver,
    keyServiceNotice,
    keyImportNotice,
    keyFormError,
    keyForm,
    filteredKeychains,
    refreshKeychains,
    openKeyCreateFromHostForm,
    openNewKeyPanel,
    editKey,
    submitKeyForm,
    removeKey,
    openKeyContextMenu,
    openKeyImportDialog,
    handleKeyDrop,
    closeKeyContextMenu
  }
}
