import { computed, reactive, ref, type ComputedRef, type Ref } from 'vue'

import type {
  AiopsAssetAuthType,
  AiopsAssetInput,
  AiopsAssetType,
  AiopsKeychainInput,
  AiopsKeychainRecord,
  AiopsKeychainType
} from '@shared/contracts/assets'
import type { useWorkspaceStore } from '@/stores/workspace'
import { assetsClient } from '@/services/assets/assetsClient'
import { localFilesClient } from '@/services/app/localFilesClient'
import {
  isAiopsAssetConnectionTestInfo,
  isAiopsKeychainRecord,
  malformedAssetBackendResultMessage
} from '@/services/assets/assetBackendGuards'
import {
  ungroupedGroupName,
  type WorkspacePanelAsset,
  type WorkspacePanelGroup,
  type WorkspaceTabKey
} from '@/services/assets/workspaceAssetTreeRuntime'

type WorkspaceStore = ReturnType<typeof useWorkspaceStore>
type HostModalMode = 'create' | 'edit' | 'clone'
type WorkspaceAssetType = AiopsAssetType

type WorkspacePanelHostRuntimeInput = {
  workspace: WorkspaceStore
  activeWorkspace: Ref<WorkspaceTabKey>
  workspaceAssets: Ref<WorkspacePanelAsset[]>
  keychainOptions: Ref<AiopsKeychainRecord[]>
  organizationAssets: ComputedRef<WorkspacePanelAsset[]>
  contextAsset: ComputedRef<WorkspacePanelAsset | null>
  groupByKey: (key: string) => WorkspacePanelGroup | null
  groupTargetPatch: (group: WorkspacePanelGroup | null, sourceAsset?: WorkspacePanelAsset) => Partial<AiopsAssetInput>
  findEditableAsset: (assetId: string) => WorkspacePanelAsset | null
  saveAssetRecord: (input: AiopsAssetInput) => Promise<WorkspacePanelAsset>
  loadKeychainOptions: () => Promise<void>
  expandGroup: (key: string) => Promise<boolean | void>
  closeContextMenu: () => void
  notice: Ref<string>
}

export const createWorkspacePanelHostRuntime = ({
  workspace,
  activeWorkspace,
  workspaceAssets,
  keychainOptions,
  organizationAssets,
  contextAsset,
  groupByKey,
  groupTargetPatch,
  findEditableAsset,
  saveAssetRecord,
  loadKeychainOptions,
  expandGroup,
  closeContextMenu,
  notice
}: WorkspacePanelHostRuntimeInput) => {
  const hostModal = reactive({ visible: false, mode: 'create' as HostModalMode, assetId: '', targetGroupKey: '' })
  const hostForm = reactive({
    assetType: 'person' as WorkspaceAssetType,
    title: '',
    host: '',
    username: '',
    group: '',
    port: '22',
    authType: 'password' as AiopsAssetAuthType,
    comment: '',
    password: '',
    keychainId: '',
    proxyName: '',
    jumpHostId: ''
  })
  const hostFormError = ref('')
  const hostTestLoading = ref(false)
  const hostTestMessage = ref('')
  const hostTestOk = ref(false)
  const hostPasswordVisible = ref(false)
  const hostJumpPasswordVisible = ref(false)
  let hostSecretRequestId = 0
  const hostChildModal = ref<'' | 'proxy' | 'key' | 'jumpHost'>('')
  const hostChildFormError = ref('')
  const hostKeyForm = reactive({
    name: '',
    privateKey: '',
    publicKey: '',
    passphrase: ''
  })
  const hostKeyDragOver = ref(false)
  const hostJumpForm = reactive({
    title: 'jump-host',
    host: '',
    username: 'root',
    group: '',
    port: '22',
    authType: 'password' as AiopsAssetAuthType,
    password: '',
    keychainId: '',
    comment: '跳板机'
  })

  const jumpHostOptions = computed(() =>
    workspaceAssets.value.filter((asset) => !asset.isLocalShell && asset.asset_type !== 'organization' && asset.id !== hostModal.assetId)
  )

  const hostModalTitle = computed(() => {
    if (hostModal.mode === 'edit') return '编辑主机'
    if (hostModal.mode === 'clone') return '克隆主机'
    return '新建主机'
  })

  const resetHostConnectionTest = () => {
    hostTestLoading.value = false
    hostTestMessage.value = ''
    hostTestOk.value = false
  }

  const detectHostKeyType = (privateKey = '', publicKey = ''): AiopsKeychainType => {
    const publicAlgorithm = publicKey.trim().split(/\s+/)[0]?.toLowerCase()
    if (publicAlgorithm === 'ssh-ed25519') return 'ed25519'
    if (publicAlgorithm === 'ssh-rsa') return 'rsa'
    if (publicAlgorithm?.startsWith('ecdsa-')) return 'ecdsa'
    if (privateKey.includes('ssh-ed25519')) return 'ed25519'
    if (privateKey.includes('BEGIN EC PRIVATE KEY') || privateKey.includes('ecdsa-sha2')) return 'ecdsa'
    return 'rsa'
  }

  const localFileName = (filePath: string) => filePath.split(/[/\\]/).filter(Boolean).at(-1) || filePath

  const readLocalTextFile = async (filePath: string, unavailableMessage: string) => {
    const readLocalFile = localFilesClient.readLocalFile()
    if (!readLocalFile) throw new Error(unavailableMessage)
    const result = await readLocalFile(filePath)
    return result.content
  }

  const applyImportedHostKeyFile = (fileName: string, content: string) => {
    const text = content.trim()
    if (!text) {
      hostChildFormError.value = '密钥文件为空'
      return
    }
    hostKeyForm.privateKey = text
    hostChildFormError.value = `已导入 ${fileName}，识别为 ${detectHostKeyType(hostKeyForm.privateKey, hostKeyForm.publicKey).toUpperCase()}`
  }

  const importHostKeyFileFromPath = async (filePath: string) => {
    if (!filePath) {
      hostChildFormError.value = '没有选择密钥文件'
      return
    }
    try {
      const content = await readLocalTextFile(filePath, '密钥文件读取服务不可用')
      applyImportedHostKeyFile(localFileName(filePath), content)
    } catch (error) {
      hostChildFormError.value = error instanceof Error ? error.message : '密钥文件读取失败'
    }
  }

  const openHostKeyImportDialog = async () => {
    const showOpenDialog = localFilesClient.showOpenDialog()
    if (!showOpenDialog) {
      hostChildFormError.value = '密钥文件选择服务不可用'
      return
    }
    try {
      const result = await showOpenDialog({
        properties: ['openFile'],
        filters: [
          { name: 'Key Files', extensions: ['pem', 'key', 'txt', 'pub', 'asc', 'crt', 'cer', 'der', 'p12', 'pfx', 'ssh', 'ppk', 'gpg'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })
      if (result?.canceled) return
      await importHostKeyFileFromPath(result?.filePaths?.[0] || '')
    } catch {
      hostChildFormError.value = '密钥文件选择失败'
    }
  }

  const handleHostKeyDrop = async (event: DragEvent) => {
    hostKeyDragOver.value = false
    const file = event.dataTransfer?.files?.[0]
    if (!file) {
      hostChildFormError.value = '没有检测到可导入的密钥文件'
      return
    }
    const getPathForFile = localFilesClient.getPathForFile()
    const filePath = (getPathForFile ? getPathForFile(file) : '') || String((file as File & { path?: string }).path || '').trim()
    if (!filePath) {
      hostChildFormError.value = '拖拽导入需要本地文件路径'
      return
    }
    await importHostKeyFileFromPath(filePath)
  }

  const closeHostChildModal = () => {
    hostChildModal.value = ''
    hostChildFormError.value = ''
    hostKeyDragOver.value = false
  }

  const saveHostProxyForm = async () => {
    hostChildFormError.value = ''
    const proxyName = workspace.sshProxyForm.name.trim()
    try {
      const saved = await workspace.saveSshProxyForm()
      if (!saved || !proxyName) {
        hostChildFormError.value = workspace.settingsNotice || '代理保存失败'
        return
      }
      hostForm.proxyName = proxyName
      closeHostChildModal()
    } catch (error) {
      hostChildFormError.value = error instanceof Error ? error.message : '代理保存失败'
    }
  }

  const saveHostKeyForm = async () => {
    hostChildFormError.value = ''
    const name = hostKeyForm.name.trim()
    const privateKey = hostKeyForm.privateKey.trim()
    if (!name || !privateKey) {
      hostChildFormError.value = '请填写名称和私钥'
      return
    }
    const duplicate = keychainOptions.value.some((keychain) => keychain.name === name)
    if (duplicate) {
      hostChildFormError.value = `密钥 ${name} 已存在`
      return
    }
    const saveKeychain = assetsClient.saveKeychain()
    if (typeof saveKeychain !== 'function') {
      hostChildFormError.value = '密钥保存服务不可用'
      return
    }
    const input: AiopsKeychainInput = {
      name,
      type: detectHostKeyType(privateKey, hostKeyForm.publicKey),
      privateKey,
      publicKey: hostKeyForm.publicKey.trim(),
      passphrase: hostKeyForm.passphrase
    }
    try {
      const result = await saveKeychain(input)
      if (!result?.ok) throw new Error(result?.errorMessage || '密钥保存失败')
      if (!isAiopsKeychainRecord(result.data)) throw new Error(malformedAssetBackendResultMessage)
      await loadKeychainOptions()
      hostForm.authType = 'keyBased'
      hostForm.keychainId = result.data.id
      closeHostChildModal()
    } catch (error) {
      hostChildFormError.value = error instanceof Error ? error.message : '密钥保存失败'
    }
  }

  const parseHostJumpPort = () => {
    const port = Number(hostJumpForm.port)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      hostChildFormError.value = '端口必须是 1-65535 的整数'
      return null
    }
    return port
  }

  const saveHostJumpHostForm = async () => {
    hostChildFormError.value = ''
    const title = hostJumpForm.title.trim()
    const host = hostJumpForm.host.trim()
    const username = hostJumpForm.username.trim()
    const port = parseHostJumpPort()
    if (!title || !host || !username || port === null) {
      if (!hostChildFormError.value) hostChildFormError.value = '请填写主机名、地址和用户名'
      return
    }
    const duplicate = workspaceAssets.value.some((asset) => asset.name === title)
    if (duplicate) {
      hostChildFormError.value = '主机名已存在'
      return
    }
    const input: AiopsAssetInput = {
      name: title,
      title,
      host,
      ip: host,
      username,
      port,
      asset_type: 'person',
      auth_type: hostJumpForm.authType,
      group: hostJumpForm.group.trim() || '跳板机',
      group_name: hostJumpForm.group.trim() || '跳板机',
      comment: hostJumpForm.comment.trim() || '跳板机',
      data_source: 'manual',
      status: 'online',
      tags: ['jump-host'],
      keychainId: hostJumpForm.authType === 'keyBased' && hostJumpForm.keychainId ? hostJumpForm.keychainId : undefined,
      ...(hostJumpForm.authType === 'password' ? { password: hostJumpForm.password } : {})
    }
    try {
      const saved = await saveAssetRecord(input)
      hostForm.jumpHostId = saved.id
      closeHostChildModal()
    } catch (error) {
      hostChildFormError.value = error instanceof Error ? error.message : '跳板机保存失败'
    }
  }

  const openCreateHost = (targetGroup?: WorkspacePanelGroup | null) => {
    hostSecretRequestId += 1
    hostModal.visible = true
    hostModal.mode = 'create'
    hostModal.assetId = ''
    hostModal.targetGroupKey = targetGroup?.key || ''
    hostForm.assetType = targetGroup?.type === 'organization' ? 'person' : activeWorkspace.value === 'bastion' && !targetGroup ? 'organization' : 'person'
    hostForm.title = ''
    hostForm.host = ''
    hostForm.username = 'root'
    hostForm.group = targetGroup?.type === 'direct-group' ? targetGroup.title : activeWorkspace.value === 'bastion' ? targetGroup?.title || '企业' : ''
    hostForm.port = '22'
    hostForm.authType = 'password'
    hostForm.comment = ''
    hostForm.password = ''
    hostPasswordVisible.value = false
    hostForm.keychainId = ''
    hostForm.proxyName = ''
    hostForm.jumpHostId = ''
    hostFormError.value = ''
    resetHostConnectionTest()
    closeContextMenu()
  }

  const closeHostModal = () => {
    hostSecretRequestId += 1
    hostModal.visible = false
    hostModal.assetId = ''
    hostModal.targetGroupKey = ''
    hostForm.password = ''
    hostPasswordVisible.value = false
    hostForm.keychainId = ''
    hostForm.proxyName = ''
    hostForm.jumpHostId = ''
    hostFormError.value = ''
    closeHostChildModal()
    resetHostConnectionTest()
  }

  const loadHostEditablePassword = async (requestId: number, assetId: string) => {
    const bridge = assetsClient.getAssetEditableSecret()
    if (typeof bridge !== 'function') return
    try {
      const result = await bridge(assetId)
      if (requestId !== hostSecretRequestId || hostModal.assetId !== assetId || !hostModal.visible || hostModal.mode === 'create') return
      if (!result?.ok) return
      hostForm.password = result.data?.password || ''
    } catch {
      if (requestId === hostSecretRequestId && hostModal.assetId === assetId) hostForm.password = ''
    }
  }

  const openHostEditor = (mode: HostModalMode, asset?: WorkspacePanelAsset) => {
    const secretRequestId = ++hostSecretRequestId
    hostModal.visible = true
    hostModal.mode = mode
    hostModal.assetId = mode === 'create' ? '' : asset?.id || ''
    hostModal.targetGroupKey = ''
    hostForm.assetType = asset?.asset_type || (activeWorkspace.value === 'bastion' ? 'organization' : 'person')
    hostForm.title = mode === 'clone' ? `${asset?.name || ''}_Clone` : asset?.name || ''
    hostForm.host = asset?.host || asset?.ip || ''
    hostForm.username = asset?.username || 'root'
    hostForm.group = asset?.group || (activeWorkspace.value === 'bastion' ? '企业' : '')
    hostForm.port = String(asset?.port || 22)
    hostForm.authType = asset?.auth_type || (activeWorkspace.value === 'bastion' ? 'keyBased' : 'password')
    hostForm.comment = asset?.comment || ''
    hostForm.password = ''
    hostPasswordVisible.value = false
    hostForm.keychainId = asset?.keychainId || ''
    hostForm.proxyName = asset?.proxyName || ''
    hostForm.jumpHostId = asset?.jumpHostId || ''
    hostFormError.value = ''
    resetHostConnectionTest()
    closeContextMenu()
    if ((mode === 'edit' || mode === 'clone') && asset?.id && hostForm.authType === 'password') void loadHostEditablePassword(secretRequestId, asset.id)
  }

  const openKeyManagementFromHostForm = () => {
    hostChildModal.value = 'key'
    hostChildFormError.value = ''
    Object.assign(hostKeyForm, { name: '', privateKey: '', publicKey: '', passphrase: '' })
  }

  const openProxyManagementFromHostForm = () => {
    hostChildModal.value = 'proxy'
    hostChildFormError.value = ''
    workspace.openAddSshProxyConfig()
  }

  const openJumpHostCreateFromHostForm = () => {
    hostChildModal.value = 'jumpHost'
    hostChildFormError.value = ''
    const targetGroup = hostModal.targetGroupKey ? groupByKey(hostModal.targetGroupKey) : null
    const currentGroup = String(hostForm.group || '').trim()
    const defaultGroup = currentGroup || (targetGroup?.type === 'direct-group' ? targetGroup.title : targetGroup?.title) || (activeWorkspace.value === 'bastion' ? '企业' : ungroupedGroupName)
    Object.assign(hostJumpForm, {
      title: 'jump-host',
      host: '',
      username: hostForm.username || 'root',
      group: defaultGroup,
      port: '22',
      authType: 'password',
      password: '',
      keychainId: '',
      comment: '跳板机'
    })
    hostJumpPasswordVisible.value = false
  }

  const editContextAsset = () => {
    if (!contextAsset.value || contextAsset.value.isLocalShell) return
    openHostEditor('edit', contextAsset.value)
  }

  const cloneContextAsset = () => {
    if (!contextAsset.value || contextAsset.value.isLocalShell) return
    openHostEditor('clone', contextAsset.value)
  }

  const parseHostPort = () => {
    const port = Number(hostForm.port)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      hostFormError.value = '端口必须是 1-65535 的整数'
      return null
    }
    return port
  }

  const buildHostInput = (id: string | undefined, port: number, sourceAsset?: WorkspacePanelAsset): AiopsAssetInput => {
    const targetGroup = hostModal.targetGroupKey ? groupByKey(hostModal.targetGroupKey) : null
    const shouldAttachOrganization = activeWorkspace.value === 'bastion' && hostForm.assetType !== 'organization'
    const group =
      String(hostForm.group || '').trim() ||
      (hostForm.assetType === 'organization' ? '企业' : activeWorkspace.value === 'direct' ? ungroupedGroupName : undefined)
    const title = String(hostForm.title || '').trim() || String(hostForm.host || '').trim()
    const proxyName = String(hostForm.proxyName || '').trim()
    const keychainId = String(hostForm.keychainId || '').trim()
    const jumpHostId = String(hostForm.jumpHostId || '').trim()
    const targetPatch = targetGroup ? groupTargetPatch(targetGroup, sourceAsset) : {}
    return {
      ...(id ? { id } : {}),
      name: title,
      title,
      host: String(hostForm.host || '').trim(),
      ip: String(hostForm.host || '').trim(),
      username: String(hostForm.username || '').trim(),
      ...(group ? { group, group_name: group } : {}),
      port,
      asset_type: hostForm.assetType,
      auth_type: hostForm.authType,
      comment: String(hostForm.comment || '').trim(),
      data_source: hostForm.assetType === 'organization' ? 'refresh' : sourceAsset?.data_source || 'manual',
      tags: hostForm.assetType === 'organization' ? ['jumpserver'] : ['ssh'],
      favorite: sourceAsset?.favorite ?? false,
      tunnelState: sourceAsset?.tunnelState,
      organizationId:
        hostForm.assetType === 'organization'
          ? undefined
          : targetPatch.organizationId !== undefined
            ? targetPatch.organizationId
            : shouldAttachOrganization
              ? organizationAssets.value[0]?.uuid || sourceAsset?.organizationId
              : sourceAsset?.organizationId,
      folderUuid: targetPatch.folderUuid !== undefined || hostModal.targetGroupKey ? targetPatch.folderUuid : sourceAsset?.folderUuid,
      needProxy: Boolean(proxyName),
      proxyName: proxyName || undefined,
      keychainId: hostForm.authType === 'keyBased' && keychainId ? keychainId : undefined,
      jumpHostId: jumpHostId || undefined,
      ...(targetPatch.group ? { group: targetPatch.group, group_name: targetPatch.group_name || targetPatch.group } : {}),
      ...(hostForm.authType === 'password' ? { password: hostForm.password } : {})
    }
  }

  const validateHostConnectionDraft = () => {
    const host = hostForm.host.trim()
    const username = hostForm.username.trim()
    const port = parseHostPort()
    if (!host || !username) {
      hostFormError.value = '请填写地址和用户名'
      return null
    }
    if (port === null) return null
    return port
  }

  const testHostFormConnection = async () => {
    const testAssetConnection = assetsClient.testAssetConnection()
    if (typeof testAssetConnection !== 'function') {
      hostTestOk.value = false
      hostTestMessage.value = '连接测试服务不可用'
      return
    }
    const port = validateHostConnectionDraft()
    if (port === null) return
    const sourceAsset = hostModal.mode === 'create' ? null : findEditableAsset(hostModal.assetId)
    hostTestLoading.value = true
    hostTestMessage.value = '正在测试连接...'
    hostTestOk.value = false
    try {
      const result = await testAssetConnection({
        ...(sourceAsset ? { assetId: sourceAsset.id } : {}),
        asset: buildHostInput(sourceAsset?.id, port, sourceAsset || undefined)
      })
      if (!result?.ok || !result.data) {
        throw new Error(result?.errorMessage || '连接测试失败')
      }
      if (!isAiopsAssetConnectionTestInfo(result.data)) {
        throw new Error(malformedAssetBackendResultMessage)
      }
      hostTestOk.value = true
      hostTestMessage.value = `连接成功 ${result.data.endpoint} · ${result.data.durationMs}ms`
    } catch (error) {
      hostTestOk.value = false
      hostTestMessage.value = error instanceof Error ? error.message : '连接测试失败'
    } finally {
      hostTestLoading.value = false
    }
  }

  const saveHostForm = async () => {
    const title = hostForm.title.trim()
    const host = hostForm.host.trim()
    const username = hostForm.username.trim()
    const port = parseHostPort()
    if (!title || !host || !username) {
      hostFormError.value = '请填写主机名、地址和用户名'
      return
    }
    if (port === null) return
    const duplicate = workspaceAssets.value.some((asset) => asset.id !== hostModal.assetId && asset.name === title)
    if (duplicate) {
      hostFormError.value = '主机名已存在'
      return
    }

    if (hostModal.mode === 'edit') {
      const asset = findEditableAsset(hostModal.assetId)
      if (!asset) return
      try {
        const saved = await saveAssetRecord(buildHostInput(asset.id, port, asset))
        notice.value = `已更新主机 ${saved.name}`
        closeHostModal()
      } catch (error) {
        hostFormError.value = error instanceof Error ? error.message : '主机保存失败'
      }
      return
    }

    const sourceAsset = hostModal.mode === 'clone' ? findEditableAsset(hostModal.assetId) : null
    try {
      const saved = await saveAssetRecord(buildHostInput(undefined, port, sourceAsset || undefined))
      await expandGroup(saved.asset_type === 'organization' ? saved.uuid : saved.folderUuid || `group-${saved.group}`)
      notice.value = `${hostModal.mode === 'clone' ? '已克隆主机' : '已创建主机'} ${saved.name}`
      closeHostModal()
    } catch (error) {
      hostFormError.value = error instanceof Error ? error.message : '主机保存失败'
    }
  }

  return {
    hostModal,
    hostForm,
    hostFormError,
    hostTestLoading,
    hostTestMessage,
    hostTestOk,
    hostPasswordVisible,
    hostJumpPasswordVisible,
    hostChildModal,
    hostChildFormError,
    hostKeyForm,
    hostKeyDragOver,
    hostJumpForm,
    jumpHostOptions,
    hostModalTitle,
    openHostKeyImportDialog,
    handleHostKeyDrop,
    saveHostProxyForm,
    saveHostKeyForm,
    saveHostJumpHostForm,
    openCreateHost,
    closeHostModal,
    closeHostChildModal,
    openKeyManagementFromHostForm,
    openProxyManagementFromHostForm,
    openJumpHostCreateFromHostForm,
    editContextAsset,
    cloneContextAsset,
    testHostFormConnection,
    saveHostForm
  }
}
