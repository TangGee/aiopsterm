import { reactive, ref, type Ref } from 'vue'

import type { AiopsKeychainInput, AiopsKeychainRecord, AiopsKeychainType } from '@shared/contracts/assets'
import { assetsClient } from '@/services/assets/assetsClient'
import { localFilesClient } from '@/services/app/localFilesClient'
import { isAiopsKeychainRecord, malformedAssetBackendResultMessage } from '@/services/assets/assetBackendGuards'

type AssetKeyEditorRuntimeInput = {
  keychains: Ref<AiopsKeychainRecord[]>
  serviceNotice: Ref<string>
  refreshKeychains: () => Promise<void>
  onSaved?: (saved: AiopsKeychainRecord) => void
}

export const createAssetKeyEditorRuntime = ({
  keychains,
  serviceNotice,
  refreshKeychains,
  onSaved
}: AssetKeyEditorRuntimeInput) => {
  const keyEditorOpen = ref(false)
  const keyEditMode = ref(false)
  const keyDragOver = ref(false)
  const keyImportNotice = ref('')
  const keyFormError = ref('')
  const keyForm = reactive({
    id: '',
    name: '',
    privateKey: '',
    publicKey: '',
    passphrase: ''
  })

  const closeKeyEditor = () => {
    keyEditorOpen.value = false
    keyDragOver.value = false
  }

  const openNewKeyPanel = () => {
    keyEditMode.value = false
    keyFormError.value = ''
    keyImportNotice.value = ''
    Object.assign(keyForm, { id: '', name: '', privateKey: '', publicKey: '', passphrase: '' })
    keyEditorOpen.value = true
  }

  const editKey = async (keyId: string | null) => {
    if (!keyId) return false
    const getKeychain = assetsClient.getKeychain()
    if (!getKeychain) {
      serviceNotice.value = '密钥详情服务不可用。'
      return false
    }
    let key: AiopsKeychainRecord | null = null
    try {
      key = await getKeychain(keyId)
    } catch (error) {
      serviceNotice.value = error instanceof Error ? error.message : '密钥加载失败。'
      return false
    }
    if (!key) {
      serviceNotice.value = '密钥不存在或已被删除。'
      return false
    }
    if (!isAiopsKeychainRecord(key)) {
      serviceNotice.value = malformedAssetBackendResultMessage
      return false
    }
    keyEditMode.value = true
    keyFormError.value = ''
    serviceNotice.value = ''
    keyImportNotice.value = ''
    Object.assign(keyForm, {
      id: key.id,
      name: key.name,
      privateKey: key.privateKey || '',
      publicKey: key.publicKey,
      passphrase: key.passphrase || ''
    })
    keyEditorOpen.value = true
    return true
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
        return 'rsa'
      }
    }
    return 'rsa'
  }

  const validateKeyForm = () => {
    const name = keyForm.name.trim()
    if (!name) return '请输入名称。'
    if (!keyForm.privateKey.trim()) return '请输入私钥。'
    if (keyForm.name.includes(' ')) return '名称不能包含空格。'
    if (keyForm.passphrase.includes(' ')) return 'Passphrase 不能包含空格。'
    if (keychains.value.some((key) => key.name === name && key.id !== keyForm.id)) return `密钥 ${name} 已存在。`
    return ''
  }

  const submitKeyForm = async () => {
    const error = validateKeyForm()
    if (error) {
      keyFormError.value = error
      return
    }
    const saveKeychain = assetsClient.saveKeychain()
    if (!saveKeychain) {
      keyFormError.value = '密钥保存服务不可用。'
      return
    }
    const input: AiopsKeychainInput = {
      id: keyForm.id || undefined,
      name: keyForm.name.trim(),
      type: detectKeyType(keyForm.privateKey, keyForm.publicKey),
      privateKey: keyForm.privateKey.trim(),
      publicKey: keyForm.publicKey.trim(),
      passphrase: keyForm.passphrase
    }
    try {
      const result = await saveKeychain(input)
      if (!result?.ok) throw new Error(result?.errorMessage || '密钥保存失败')
      if (!isAiopsKeychainRecord(result.data)) throw new Error(malformedAssetBackendResultMessage)
      await refreshKeychains()
      onSaved?.(result.data)
      keyFormError.value = ''
      keyImportNotice.value = `${keyEditMode.value ? '已保存' : '已创建'} ${result.data.name}。`
      closeKeyEditor()
    } catch (saveError) {
      keyFormError.value = saveError instanceof Error ? saveError.message : '密钥保存失败。'
    }
  }

  const applyImportedKeyFile = (fileName: string, content: string) => {
    const text = content.trim()
    if (!text) {
      keyImportNotice.value = '密钥文件为空。'
      return
    }
    const isPublicKey =
      /^-----BEGIN (?:OPENSSH )?PUBLIC KEY-----/i.test(text) ||
      text.split(/\s+/).some((token) => /^(?:ssh-|ecdsa-|sk-)/i.test(token))
    if (isPublicKey) keyForm.publicKey = text
    else keyForm.privateKey = text
    if (!keyForm.name.trim()) keyForm.name = fileName
    keyFormError.value = ''
    keyImportNotice.value = `已导入 ${fileName}，识别为 ${detectKeyType(keyForm.privateKey, keyForm.publicKey).toUpperCase()}。`
  }

  const importKeyFileFromPath = async (filePath: string) => {
    if (!filePath) {
      keyImportNotice.value = '没有选择密钥文件。'
      return
    }
    const fileName = filePath.split(/[/\\]/).filter(Boolean).at(-1) || filePath
    const readLocalFile = localFilesClient.readLocalFile()
    if (!readLocalFile) {
      keyImportNotice.value = '密钥文件读取服务不可用。'
      return
    }
    try {
      const result = await readLocalFile(filePath)
      applyImportedKeyFile(fileName, result.content)
    } catch (error) {
      keyImportNotice.value = error instanceof Error ? error.message : '密钥文件读取失败。'
    }
  }

  const openKeyImportDialog = async () => {
    keyImportNotice.value = '请选择密钥文件，包括无扩展名的 OpenSSH 私钥、.pem、.key、.pub、.ppk 等格式。'
    const showOpenDialog = localFilesClient.showOpenDialog()
    if (!showOpenDialog) {
      keyImportNotice.value = '密钥文件选择服务不可用。'
      return
    }
    try {
      const result = await showOpenDialog({
        defaultPath: '~/.ssh',
        properties: ['openFile', 'showHiddenFiles']
      })
      if (result?.canceled) {
        keyImportNotice.value = '已取消导入密钥。'
        return
      }
      await importKeyFileFromPath(result?.filePaths?.[0] || '')
    } catch {
      keyImportNotice.value = '密钥文件选择失败。'
    }
  }

  const handleKeyDrop = async (event: DragEvent) => {
    keyDragOver.value = false
    const file = event.dataTransfer?.files?.[0]
    if (!file) {
      keyImportNotice.value = '没有检测到可导入的密钥文件。'
      return
    }
    const getPathForFile = localFilesClient.getPathForFile()
    const filePath = (getPathForFile ? getPathForFile(file) : '') || String((file as File & { path?: string }).path || '').trim()
    if (!filePath) {
      keyImportNotice.value = '拖拽导入需要本地文件路径。'
      return
    }
    await importKeyFileFromPath(filePath)
  }

  return {
    keyEditorOpen,
    keyEditMode,
    keyDragOver,
    keyImportNotice,
    keyFormError,
    keyForm,
    closeKeyEditor,
    openNewKeyPanel,
    editKey,
    submitKeyForm,
    openKeyImportDialog,
    handleKeyDrop
  }
}

export type AssetKeyEditorRuntime = ReturnType<typeof createAssetKeyEditorRuntime>
