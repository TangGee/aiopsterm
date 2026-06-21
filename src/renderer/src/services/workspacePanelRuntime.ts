import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'

import type {
  AiopsAssetAuthType,
  AiopsAssetGroupRecord,
  AiopsAssetInput,
  AiopsAssetType,
  AiopsCustomFolderSaveInput,
  AiopsKeychainInput,
  AiopsKeychainRecord,
  AiopsKeychainType,
  AiopsSshTunnelMutationResult,
  AiopsSshTunnelType
} from '@shared/contracts/assets'
import { useWorkspaceStore } from '@/stores/workspace'
import { assetsClient } from '@/services/assetsClient'
import { localFilesClient } from '@/services/localFilesClient'
import {
  isAiopsAssetConnectionTestInfo,
  isAiopsAssetGroupDeleteSnapshot,
  isAiopsAssetGroupListData,
  isAiopsAssetGroupRenameSnapshot,
  isAiopsAssetSnapshot,
  isAiopsDeletedAssetData,
  isAiopsDeletedCustomFolderData,
  isAiopsJumpserverOrganizationAssetRefreshData,
  isAiopsKeychainListData,
  isAiopsKeychainRecord,
  isAiopsSavedAssetRecord,
  isAiopsSavedCustomFolderRecord,
  isAiopsSshTunnelMutationData,
  malformedAssetBackendResultMessage
} from '@/services/assetBackendGuards'
import { openLocalTerminalLaunch, openSshTerminalLaunch } from '@/services/terminalLaunchRuntime'
import {
  assetGroupAssetCount,
  assetGroupName,
  buildBastionGroups,
  buildDirectGroups,
  collectGroupAssets,
  collectTreeRows,
  directGroupKey,
  filterGroupTree,
  flattenGroups,
  folderGroupKey,
  ungroupedGroupName,
  type WorkspacePanelAsset,
  type WorkspacePanelFolder,
  type WorkspacePanelGroup
} from '@/services/workspaceAssetTreeRuntime'
import type { WorkspaceTabKey } from '@/services/workspaceAssetTreeRuntime'

type HostModalMode = 'create' | 'edit' | 'clone'
type FolderModalMode = 'create' | 'edit-custom' | 'edit-direct'
type WorkspaceAssetType = AiopsAssetType
type WorkspaceTunnelType = AiopsSshTunnelType

export const useWorkspacePanelRuntime = () => {
  const workspace = useWorkspaceStore()

  const workspaceTabs: Array<{ key: WorkspaceTabKey; label: string }> = [
    { key: 'direct', label: '直接连接' },
    { key: 'bastion', label: '堡垒机资源' }
  ]

  const activeWorkspace = ref<WorkspaceTabKey>('direct')
  const searchValue = ref('')
  const selectedAssetId = ref<string | null>(null)
  const contextMenuAssetId = ref<string | null>(null)
  const contextMenuGroupKey = ref<string | null>(null)
  const blankContextMenuVisible = ref(false)
  const contextMenuPosition = reactive({ x: 0, y: 0 })
  const refreshingGroupKey = ref('')
  const notice = ref('')
  const commentAssetId = ref('')
  const editingComment = ref('')
  const assetBackendReady = ref(false)
  const dragState = reactive({ kind: '' as '' | 'asset' | 'group', assetId: '', groupKey: '' })
  const dragOverGroupKey = ref('')
  const dragOverAssetId = ref('')

  const workspaceAssets = ref<WorkspacePanelAsset[]>([])

  const customFolders = ref<WorkspacePanelFolder[]>([])
  const directGroupOptions = ref<AiopsAssetGroupRecord[]>([])
  const keychainOptions = ref<AiopsKeychainRecord[]>([])

  const folderModal = reactive({ visible: false, mode: 'create' as FolderModalMode, targetKey: '', parentKey: '', fromMove: false })
  const folderForm = reactive({ name: '', description: '' })
  const folderFormError = ref('')
  const moveModal = reactive({ visible: false, assetId: '' })
  const deleteGroupModal = reactive({ visible: false, groupKey: '' })
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
  const deleteAssetModal = reactive({ visible: false, assetId: '' })
  const managementModal = reactive({ visible: false, organizationId: '', query: '' })
  const tunnelModal = reactive({ visible: false, assetId: '' })
  const tunnelForm = reactive({
    type: 'local_forward' as WorkspaceTunnelType,
    localPort: '3306',
    remoteHost: 'localhost',
    remotePort: '3306'
  })
  const tunnelFormError = ref('')
  const tunnelSubmitting = ref(false)

  const localShellAssets = computed(() => workspaceAssets.value.filter((asset) => asset.isLocalShell))
  const directAssets = computed(() => workspaceAssets.value.filter((asset) => !asset.isLocalShell && (asset.asset_type === 'person' || asset.asset_type === 'switch')))
  const organizationAssets = computed(() => workspaceAssets.value.filter((asset) => !asset.isLocalShell && asset.asset_type === 'organization'))
  const bastionResourceAssets = computed(() => workspaceAssets.value.filter((asset) => !asset.isLocalShell && asset.asset_type !== 'organization' && (asset.organizationId || asset.folderUuid)))
  const showIpMode = computed(() => workspace.workspacePreferences.showIpMode)
  const expandedGroups = computed(() => workspace.workspacePreferences.expandedGroups)
  const recentAssetIds = computed(() => workspace.workspacePreferences.recentAssetIds || [])
  const directFolders = computed(() => customFolders.value.filter((folder) => folder.scope === 'direct'))
  const bastionFolders = computed(() => customFolders.value.filter((folder) => folder.scope !== 'direct'))
  const targetMoveFolders = computed(() => (activeWorkspace.value === 'direct' ? directFolders.value : bastionFolders.value))
  const firstDirectGroupName = computed(() => directFolders.value[0]?.name || directGroupOptions.value[0]?.name || '')
  const hostGroupOptions = computed(() => {
    if (activeWorkspace.value === 'direct') {
      const folderOptions = directFolders.value.map((folder) => ({ key: folder.uuid, name: folder.name, count: directAssets.value.filter((asset) => assetGroupName(asset) === folder.name).length }))
      const optionNames = new Set(folderOptions.map((group) => group.name))
      return [...folderOptions, ...directGroupOptions.value.filter((group) => !optionNames.has(group.name))]
    }
    return [
      ...organizationAssets.value.map((asset) => ({ key: asset.uuid, name: asset.name, count: 1 })),
      ...bastionFolders.value.map((folder) => ({ key: folder.uuid, name: folder.name, count: bastionResourceAssets.value.filter((asset) => asset.folderUuid === folder.uuid).length }))
    ]
  })
  const jumpHostOptions = computed(() =>
    workspaceAssets.value.filter((asset) => !asset.isLocalShell && asset.asset_type !== 'organization' && asset.id !== hostModal.assetId)
  )

  const isDescendantGroup = (groupKey: string, possibleDescendantKey: string): boolean => {
    const walk = (group: WorkspacePanelGroup): boolean => group.childGroups.some((child) => child.key === possibleDescendantKey || walk(child))
    const root = sourceGroups.value.find((group) => group.key === groupKey) || sourceGroups.value.flatMap((group) => flattenGroups(group)).find((group) => group.key === groupKey)
    return root ? walk(root) : false
  }

  const sourceGroups = computed(() =>
    activeWorkspace.value === 'direct'
      ? buildDirectGroups({
          directAssets: directAssets.value,
          localShellAssets: localShellAssets.value,
          directFolders: directFolders.value,
          recentAssetIds: recentAssetIds.value
        })
      : buildBastionGroups({
          bastionFolders: bastionFolders.value,
          bastionResourceAssets: bastionResourceAssets.value,
          organizationAssets: organizationAssets.value
        })
  )

  const filteredGroups = computed(() => {
    const keyword = searchValue.value.trim().toLowerCase()
    if (!keyword) return sourceGroups.value
    return sourceGroups.value.map((group) => filterGroupTree(group, keyword)).filter((group): group is WorkspacePanelGroup => Boolean(group))
  })

  const visibleTreeRows = computed(() => collectTreeRows(filteredGroups.value, isGroupExpanded))
  const allAssets = computed(() => sourceGroups.value.flatMap(collectGroupAssets))
  const contextAsset = computed(() => allAssets.value.find((asset) => asset.id === contextMenuAssetId.value) || null)
  const contextGroup = computed(() => sourceGroups.value.flatMap(flattenGroups).find((group) => group.key === contextMenuGroupKey.value) || null)
  const canCommentContextAsset = computed(() => activeWorkspace.value === 'bastion' && !!contextAsset.value && !contextAsset.value.isLocalShell)
  const canMoveContextAsset = computed(
    () => activeWorkspace.value === 'bastion' && !!contextAsset.value && !contextAsset.value.isLocalShell && contextAsset.value.asset_type !== 'organization' && !contextAsset.value.folderUuid
  )
  const canRemoveContextAssetFromFolder = computed(() => activeWorkspace.value === 'bastion' && !!contextAsset.value?.folderUuid && !contextAsset.value.isLocalShell)
  const canConnectContextAsset = computed(() => !!contextAsset.value)
  const canCreateChildInContextGroup = computed(() => !!contextGroup.value && (contextGroup.value.type === 'direct-group' || contextGroup.value.type === 'custom-folder'))
  const canCreateHostInContextGroup = computed(() => !!contextGroup.value && contextGroup.value.type !== 'system')
  const tunnelAsset = computed(() => findEditableAsset(tunnelModal.assetId))
  const hostModalTitle = computed(() => {
    if (hostModal.mode === 'edit') return '编辑主机'
    if (hostModal.mode === 'clone') return '克隆主机'
    return '新建主机'
  })
  const tunnelTypeOptions: Array<{ value: WorkspaceTunnelType; label: string; description: string }> = [
    {
      value: 'local_forward',
      label: '访问远端服务',
      description: '把远端服务映射成本机端口'
    },
    {
      value: 'remote_forward',
      label: '暴露本地服务',
      description: '把本地端口暴露到远端主机'
    },
    {
      value: 'dynamic_socks',
      label: '动态 SOCKS',
      description: '在本机启动 SOCKS5 代理'
    }
  ]
  const deleteAssetInfo = computed(() => workspaceAssets.value.find((asset) => asset.id === deleteAssetModal.assetId) || null)
  const deleteGroupInfo = computed(() => {
    const group = groupByKey(deleteGroupModal.groupKey)
    if (!group) return null
    return {
      key: group.key,
      name: group.title,
      count: group.originalCount,
      kind: group.type
    }
  })
  const managedOrganization = computed(() => organizationAssets.value.find((asset) => asset.uuid === managementModal.organizationId) || null)
  const managedOrganizationAssets = computed(() => {
    const keyword = managementModal.query.trim().toLowerCase()
    return bastionResourceAssets.value
      .filter((asset) => !managementModal.organizationId || asset.organizationId === managementModal.organizationId)
      .filter((asset) => {
        if (!keyword) return true
        return `${asset.name} ${asset.host} ${asset.username} ${asset.comment || ''}`.toLowerCase().includes(keyword)
      })
  })

const findEditableAsset = (assetId: string) => workspaceAssets.value.find((item) => item.id === assetId) || null

const toAssetInput = (asset: WorkspacePanelAsset, patch: Partial<AiopsAssetInput> = {}): AiopsAssetInput => ({
  id: asset.id,
  name: asset.name,
  title: asset.title,
  host: asset.host,
  ip: asset.ip,
  group: asset.group,
  group_name: asset.group_name,
  status: asset.status,
  username: asset.username,
  port: asset.port,
  asset_type: asset.asset_type,
  auth_type: asset.auth_type,
  comment: asset.comment,
  data_source: asset.data_source,
  tags: [...asset.tags],
  favorite: asset.favorite,
  folderUuid: asset.folderUuid,
  organizationId: asset.organizationId,
  tunnelState: asset.tunnelState,
  needProxy: asset.needProxy,
  proxyName: asset.proxyName,
  keychainId: asset.keychainId,
  jumpHostId: asset.jumpHostId,
  ...patch
})

const applyWorkspaceAssetSnapshot = (snapshot: unknown) => {
  if (!isAiopsAssetSnapshot(snapshot)) return false
  workspaceAssets.value = snapshot.assets.map((asset) => ({ ...asset, tags: [...asset.tags] }))
  customFolders.value = snapshot.folders.map((folder) => ({ ...folder }))
  assetBackendReady.value = true
  return true
}

const applyWorkspaceAssetState = (snapshot: unknown, groups: AiopsAssetGroupRecord[]) => {
  if (!isAiopsAssetSnapshot(snapshot)) throw new Error(malformedAssetBackendResultMessage)
  if (!isAiopsAssetGroupListData(groups)) throw new Error(malformedAssetBackendResultMessage)
  applyWorkspaceAssetSnapshot(snapshot)
  directGroupOptions.value = groups
  return snapshot
}

const loadDirectGroupOptions = async () => {
  const listAssetGroups = assetsClient.listAssetGroups()
  if (typeof listAssetGroups !== 'function') throw new Error('资产分组服务不可用')
  const groups = await listAssetGroups({
    assetTypes: ['person', 'switch']
  })
  if (!isAiopsAssetGroupListData(groups)) throw new Error(malformedAssetBackendResultMessage)
  return groups.map((group) => ({ ...group }))
}

const refreshAssets = async () => {
  const listAssets = assetsClient.listAssets()
  if (typeof listAssets !== 'function') throw new Error('资产列表服务不可用')
  const snapshot = await listAssets()
  if (!isAiopsAssetSnapshot(snapshot)) throw new Error(malformedAssetBackendResultMessage)
  const groups = await loadDirectGroupOptions()
  return applyWorkspaceAssetState(snapshot, groups)
}

const loadWorkspaceAssetRefresh = async () => {
  const listAssets = assetsClient.listAssets()
  if (typeof listAssets !== 'function') throw new Error('资产列表服务不可用')
  const snapshot = await listAssets()
  if (!isAiopsAssetSnapshot(snapshot)) throw new Error(malformedAssetBackendResultMessage)
  const groups = await loadDirectGroupOptions()
  return { snapshot, groups }
}

const loadKeychainOptions = async () => {
  const listKeychains = assetsClient.listKeychains()
  if (typeof listKeychains !== 'function') {
    keychainOptions.value = []
    return
  }
  const keychains = await listKeychains()
  if (!isAiopsKeychainListData(keychains)) throw new Error(malformedAssetBackendResultMessage)
  keychainOptions.value = keychains.map((keychain) => ({ ...keychain }))
}

const resetHostConnectionTest = () => {
  hostTestLoading.value = false
  hostTestMessage.value = ''
  hostTestOk.value = false
}

const saveAssetRecord = async (input: AiopsAssetInput) => {
  const saveAsset = assetsClient.saveAsset()
  if (typeof saveAsset !== 'function') {
    throw new Error('资产保存服务不可用')
  }
  const result = await saveAsset(input)
  if (!result?.ok) throw new Error(result?.errorMessage || '资产保存失败')
  const saved = result.data
  if (!isAiopsSavedAssetRecord(saved, input)) throw new Error(malformedAssetBackendResultMessage)
  const { snapshot, groups } = await loadWorkspaceAssetRefresh()
  if (!snapshot.assets.some((asset) => asset.id === saved.id)) throw new Error(malformedAssetBackendResultMessage)
  applyWorkspaceAssetState(snapshot, groups)
  return saved
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

const deleteAssetRecord = async (assetId: string) => {
  const deleteAsset = assetsClient.deleteAsset()
  if (typeof deleteAsset !== 'function') throw new Error('资产删除服务不可用')
  const result = await deleteAsset(assetId)
  if (!result?.ok) throw new Error(result?.errorMessage || '资产删除失败')
  if (!isAiopsDeletedAssetData(result.data, assetId)) throw new Error(malformedAssetBackendResultMessage)
  const { snapshot, groups } = await loadWorkspaceAssetRefresh()
  if (snapshot.assets.some((asset) => asset.id === assetId)) throw new Error(malformedAssetBackendResultMessage)
  applyWorkspaceAssetState(snapshot, groups)
}

const saveFolderRecord = async (folder: AiopsCustomFolderSaveInput) => {
  const saveAssetFolder = assetsClient.saveAssetFolder()
  if (typeof saveAssetFolder !== 'function') throw new Error('文件夹保存服务不可用')
  const result = await saveAssetFolder(folder)
  if (!result?.ok) throw new Error(result?.errorMessage || '文件夹保存失败')
  const saved = result.data
  if (!isAiopsSavedCustomFolderRecord(saved, folder)) throw new Error(malformedAssetBackendResultMessage)
  const { snapshot, groups } = await loadWorkspaceAssetRefresh()
  if (!snapshot.folders.some((item) => item.uuid === saved.uuid)) throw new Error(malformedAssetBackendResultMessage)
  applyWorkspaceAssetState(snapshot, groups)
  return saved
}

const deleteFolderRecord = async (folderUuid: string) => {
  const deleteAssetFolder = assetsClient.deleteAssetFolder()
  if (typeof deleteAssetFolder !== 'function') throw new Error('文件夹删除服务不可用')
  const result = await deleteAssetFolder(folderUuid)
  if (!result?.ok) throw new Error(result?.errorMessage || '文件夹删除失败')
  if (!isAiopsDeletedCustomFolderData(result.data, folderUuid)) throw new Error(malformedAssetBackendResultMessage)
  const { snapshot, groups } = await loadWorkspaceAssetRefresh()
  if (snapshot.folders.some((folder) => folder.uuid === folderUuid)) throw new Error(malformedAssetBackendResultMessage)
  if (snapshot.assets.some((asset) => asset.folderUuid === folderUuid)) throw new Error(malformedAssetBackendResultMessage)
  applyWorkspaceAssetState(snapshot, groups)
}

const isGroupExpanded = (key: string) => !!searchValue.value.trim() || expandedGroups.value.includes(key)

const updateExpandedGroups = (next: string[]) => workspace.updateWorkspacePreferences({ expandedGroups: [...new Set(next)] })

const toggleGroup = async (key: string) => {
  const next = expandedGroups.value.includes(key)
    ? expandedGroups.value.filter((item) => item !== key)
    : [...expandedGroups.value, key]
  await updateExpandedGroups(next)
}

const expandGroup = async (key: string) => {
  if (!expandedGroups.value.includes(key)) {
    return updateExpandedGroups([...expandedGroups.value, key])
  }
  return true
}

const removeExpandedGroup = async (key: string) => {
  if (expandedGroups.value.includes(key)) {
    return updateExpandedGroups(expandedGroups.value.filter((item) => item !== key))
  }
  return true
}

const replaceExpandedGroup = async (oldKey: string, newKey: string) => {
  if (!expandedGroups.value.includes(oldKey)) return true
  return updateExpandedGroups(expandedGroups.value.map((item) => (item === oldKey ? newKey : item)))
}

const closeMenus = () => {
  contextMenuAssetId.value = null
  contextMenuGroupKey.value = null
  blankContextMenuVisible.value = false
}

const closeContextMenu = () => {
  contextMenuAssetId.value = null
  contextMenuGroupKey.value = null
  blankContextMenuVisible.value = false
}

const positionContextMenu = (event: MouseEvent, menuItemCount: number) => {
  const menuWidth = 160
  const estimatedMenuHeight = 6 + menuItemCount * 30
  let left = event.clientX
  let top = event.clientY
  if (left + menuWidth > window.innerWidth) {
    left = window.innerWidth - menuWidth - 5
  }
  if (top + estimatedMenuHeight > window.innerHeight) {
    top = event.clientY - estimatedMenuHeight
    if (top < 0) top = 5
  }
  contextMenuPosition.x = left
  contextMenuPosition.y = top
}

const countAssetMenuItems = (asset: WorkspacePanelAsset) => {
  const items = [
    asset.favorite !== undefined,
    activeWorkspace.value === 'bastion' && !asset.isLocalShell,
    activeWorkspace.value === 'bastion' && !asset.isLocalShell && asset.asset_type !== 'organization' && !asset.folderUuid,
    activeWorkspace.value === 'bastion' && !asset.isLocalShell && !!asset.folderUuid,
    asset.asset_type === 'person' && !asset.isLocalShell,
    true,
    !asset.isLocalShell,
    asset.asset_type !== 'organization' && !asset.isLocalShell,
    asset.asset_type === 'organization',
    asset.asset_type === 'organization',
    !asset.isLocalShell
  ]
  return items.filter(Boolean).length
}

const countGroupMenuItems = (group: WorkspacePanelGroup) =>
  [
    group.type === 'custom-folder' || group.type === 'direct-group',
    group.type !== 'system',
    group.type === 'custom-folder' || group.type === 'direct-group',
    group.refreshable,
    group.type === 'organization',
    group.type === 'custom-folder' || group.type === 'direct-group',
    group.type === 'organization'
  ].filter(Boolean).length

const groupByKey = (key: string) => sourceGroups.value.flatMap(flattenGroups).find((group) => group.key === key) || null

const folderByGroup = (group: WorkspacePanelGroup | null) => {
  if (!group) return null
  if (group.type === 'direct-group') {
    return directFolders.value.find((folder) => folder.name === group.groupName || folder.uuid === group.folderUuid) || null
  }
  if (group.type === 'custom-folder') {
    return bastionFolders.value.find((folder) => folder.uuid === group.folderUuid) || null
  }
  return null
}

const groupTargetPatch = (group: WorkspacePanelGroup | null, sourceAsset?: WorkspacePanelAsset): Partial<AiopsAssetInput> => {
  if (!group) {
    if (activeWorkspace.value === 'direct') {
      return { group: ungroupedGroupName, group_name: ungroupedGroupName, folderUuid: undefined }
    }
    if (activeWorkspace.value === 'bastion' && sourceAsset?.asset_type !== 'organization') {
      return { folderUuid: undefined, organizationId: organizationAssets.value[0]?.uuid || sourceAsset?.organizationId }
    }
    return { folderUuid: undefined }
  }
  if (group.type === 'direct-group') {
    return { group: group.groupName || group.title, group_name: group.groupName || group.title, folderUuid: undefined }
  }
  if (group.type === 'custom-folder') {
    return { folderUuid: group.folderUuid || group.key, organizationId: sourceAsset?.organizationId || organizationAssets.value[0]?.uuid }
  }
  if (group.type === 'organization') {
    return { folderUuid: undefined, organizationId: group.organizationId || group.key }
  }
  return {}
}

const openCreateFolder = (parentGroup?: WorkspacePanelGroup | null) => {
  folderModal.visible = true
  folderModal.mode = 'create'
  folderModal.targetKey = ''
  folderModal.parentKey = parentGroup?.key || ''
  folderModal.fromMove = false
  folderForm.name = ''
  folderForm.description = ''
  folderFormError.value = ''
  closeContextMenu()
}

const openCreateFolderFromMoveModal = () => {
  moveModal.visible = false
  openCreateFolder()
  folderModal.fromMove = true
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

const closeFolderModal = () => {
  folderModal.visible = false
  folderModal.targetKey = ''
  folderModal.parentKey = ''
  folderModal.fromMove = false
  folderForm.name = ''
  folderForm.description = ''
  folderFormError.value = ''
}

const closeMoveModal = () => {
  moveModal.visible = false
  moveModal.assetId = ''
}

const closeDeleteGroupModal = () => {
  deleteGroupModal.visible = false
  deleteGroupModal.groupKey = ''
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

const resetTunnelForm = (type: WorkspaceTunnelType = 'local_forward') => {
  tunnelForm.type = type
  tunnelForm.localPort = type === 'dynamic_socks' ? '1080' : '3306'
  tunnelForm.remoteHost = 'localhost'
  tunnelForm.remotePort = type === 'dynamic_socks' ? '' : '3306'
  tunnelFormError.value = ''
  tunnelSubmitting.value = false
}

const closeTunnelModal = () => {
  tunnelModal.visible = false
  tunnelModal.assetId = ''
  resetTunnelForm()
}

const closeDeleteAssetModal = () => {
  deleteAssetModal.visible = false
  deleteAssetModal.assetId = ''
}

const closeManagementModal = () => {
  managementModal.visible = false
  managementModal.organizationId = ''
  managementModal.query = ''
}

const saveFolderForm = async () => {
  const name = folderForm.name.trim()
  if (!name) {
    folderFormError.value = '请输入文件夹名称'
    return
  }
  const scopedFolders = activeWorkspace.value === 'direct' ? directFolders.value : bastionFolders.value
  const duplicateCustomFolder = scopedFolders.some((folder) => folder.name === name && folder.uuid !== folderModal.targetKey)
  if (duplicateCustomFolder) {
    folderFormError.value = '文件夹名称已存在'
    return
  }

  if (folderModal.mode === 'create') {
    let parentUuid = ''
    const parentGroup = folderModal.parentKey ? groupByKey(folderModal.parentKey) : null
    if (parentGroup && (parentGroup.type === 'direct-group' || parentGroup.type === 'custom-folder')) {
      const parentFolder = folderByGroup(parentGroup)
      if (parentFolder) {
        parentUuid = parentFolder.uuid
      } else if (parentGroup.type === 'direct-group') {
        try {
          const createdParent = await saveFolderRecord({
            name: parentGroup.title,
            description: '',
            scope: 'direct'
          })
          parentUuid = createdParent.uuid
        } catch (error) {
          folderFormError.value = error instanceof Error ? error.message : '父分组保存失败'
          return
        }
      }
    }
    const folder: AiopsCustomFolderSaveInput = {
      name,
      description: folderForm.description.trim(),
      scope: activeWorkspace.value === 'direct' ? 'direct' : 'bastion',
      ...(parentUuid ? { parentUuid } : {})
    }
    try {
      const saved = await saveFolderRecord(folder)
      await expandGroup(activeWorkspace.value === 'direct' ? directGroupKey(saved.name) : saved.uuid)
      if (parentGroup) await expandGroup(parentGroup.key)
      notice.value = `已创建文件夹 ${saved.name}`
      closeFolderModal()
    } catch (error) {
      folderFormError.value = error instanceof Error ? error.message : '文件夹保存失败'
    }
    return
  }

  if (folderModal.mode === 'edit-custom') {
    const folder = customFolders.value.find((item) => item.uuid === folderModal.targetKey)
    if (folder) {
      try {
        const saved = await saveFolderRecord({ ...folder, name, description: folderForm.description.trim() })
        notice.value = `已更新文件夹 ${saved.name}`
      } catch (error) {
        folderFormError.value = error instanceof Error ? error.message : '文件夹保存失败'
        return
      }
    }
    closeFolderModal()
    return
  }

  const oldGroupName = folderModal.targetKey.replace(/^group-/, '')
  const oldKey = `group-${oldGroupName}`
  const newKey = `group-${name}`
  const existingFolder = directFolders.value.find((folder) => folder.name === oldGroupName || directGroupKey(folder.name) === folderModal.targetKey)
  const currentGroup = groupByKey(folderModal.targetKey)
  if (existingFolder && currentGroup?.originalCount === 0) {
    try {
      const saved = await saveFolderRecord({ ...existingFolder, name, description: folderForm.description.trim(), scope: 'direct' })
      await replaceExpandedGroup(oldKey, directGroupKey(saved.name))
      notice.value = `已更新分组 ${saved.name}`
      closeFolderModal()
    } catch (error) {
      folderFormError.value = error instanceof Error ? error.message : '分组保存失败'
    }
    return
  }
  const input = {
    oldName: oldGroupName,
    newName: name,
    assetTypes: ['person' as const, 'switch' as const]
  }
  try {
    const renameAssetGroup = assetsClient.renameAssetGroup()
    if (typeof renameAssetGroup !== 'function') throw new Error('资产分组保存服务不可用')
    const result = await renameAssetGroup(input)
    if (!result?.ok) throw new Error(result?.errorMessage || '分组保存失败')
    if (!isAiopsAssetGroupRenameSnapshot(result.data, input)) throw new Error(malformedAssetBackendResultMessage)
    if (existingFolder) {
      await saveFolderRecord({ ...existingFolder, name, description: folderForm.description.trim(), scope: 'direct' })
    }
    await refreshAssets()
    await replaceExpandedGroup(oldKey, newKey)
    notice.value = `已更新分组 ${name}`
    closeFolderModal()
  } catch (error) {
    folderFormError.value = error instanceof Error ? error.message : '分组保存失败'
  }
}

const displayAsset = (asset: WorkspacePanelAsset) => (showIpMode.value ? asset.ip || asset.host : asset.name || asset.title)

const folderNameByUuid = (folderUuid?: string) => customFolders.value.find((folder) => folder.uuid === folderUuid)?.name || ''

const moveAssetToGroup = async (assetId: string, targetGroup: WorkspacePanelGroup | null) => {
  const asset = findEditableAsset(assetId)
  if (!asset || asset.isLocalShell || asset.asset_type === 'organization') return false
  try {
    const saved = await saveAssetRecord(toAssetInput(asset, groupTargetPatch(targetGroup, asset)))
    if (targetGroup) await expandGroup(targetGroup.key)
    return true
  } catch (error) {
    notice.value = error instanceof Error ? error.message : '移动资产失败'
    return false
  }
}

const ensureDirectFolderForGroup = async (group: WorkspacePanelGroup) => {
  const existing = folderByGroup(group)
  if (existing) return existing
  return saveFolderRecord({ name: group.title, description: '', scope: 'direct' })
}

const moveGroupToParent = async (groupKey: string, parentGroup: WorkspacePanelGroup | null) => {
  const group = groupByKey(groupKey)
  if (!group || group.type === 'system' || group.type === 'organization') return false
  if (parentGroup && (parentGroup.key === group.key || isDescendantGroup(group.key, parentGroup.key))) return false
  try {
    const folder =
      group.type === 'direct-group'
        ? await ensureDirectFolderForGroup(group)
        : customFolders.value.find((item) => item.uuid === group.folderUuid)
    if (!folder) return false
    const parentFolder =
      parentGroup && (parentGroup.type === 'direct-group' || parentGroup.type === 'custom-folder')
        ? parentGroup.type === 'direct-group'
          ? await ensureDirectFolderForGroup(parentGroup)
          : customFolders.value.find((item) => item.uuid === parentGroup.folderUuid)
        : null
    const saved = await saveFolderRecord({
      ...folder,
      parentUuid: parentFolder?.uuid || undefined,
      scope: activeWorkspace.value === 'direct' ? 'direct' : 'bastion'
    })
    if (parentGroup) await expandGroup(parentGroup.key)
    await expandGroup(activeWorkspace.value === 'direct' ? directGroupKey(saved.name) : saved.uuid)
    return true
  } catch (error) {
    notice.value = error instanceof Error ? error.message : '移动分组失败'
    return false
  }
}

const toggleDisplayMode = async () => {
  await workspace.updateWorkspacePreferences({ showIpMode: !showIpMode.value })
}

const selectAsset = (assetId: string) => {
  selectedAssetId.value = assetId
}

const connectAsset = async (assetId: string) => {
  selectedAssetId.value = assetId
  const asset = allAssets.value.find((item) => item.id === assetId)
  if (!asset) {
    return
  }
  const previousActivePanelId = workspace.activePanelId
  workspace.createPanel()
  workspace.renamePanel(workspace.activePanelId, asset.name)
  workspace.replaceTerminalOutput(workspace.activePanelId, '')
  const panelId = workspace.activePanelId
  const discardPendingPanel = () => workspace.discardPendingTerminalPanel(panelId, previousActivePanelId)
  const launchContext = {
    panelId,
    terminalType: workspace.terminalSettings.terminalType,
    discardPendingPanel,
    setNotice: (message: string) => {
      notice.value = message
    },
    applyLocalTerminalSession: workspace.applyLocalTerminalSession,
    applySshTerminalSession: workspace.applySshTerminalSession,
    registerSshSession: workspace.registerSshSession,
    renamePanel: workspace.renamePanel
  }
  if (asset.isLocalShell) {
    const panel = await openLocalTerminalLaunch(launchContext, { title: asset.name })
    if (!panel) return
    notice.value = `已打开本地 shell ${asset.host}`
  } else {
    const panel = await openSshTerminalLaunch(launchContext, asset, { title: asset.name })
    if (!panel) return
  }
  workspace.selectedContexts = [
    ...workspace.selectedContexts.filter((item) => item.id !== asset.id),
    { id: asset.id, kind: 'hosts', label: asset.host, detail: asset.name }
  ]
  if (!asset.isLocalShell) {
    await workspace.updateWorkspacePreferences({
      recentAssetIds: [asset.id, ...recentAssetIds.value.filter((id) => id !== asset.id)].slice(0, 10)
    })
  }
}

const openContextMenu = (event: MouseEvent, assetId: string) => {
  const asset = allAssets.value.find((item) => item.id === assetId)
  if (!asset) return
  contextMenuAssetId.value = assetId
  contextMenuGroupKey.value = null
  blankContextMenuVisible.value = false
  selectedAssetId.value = assetId
  positionContextMenu(event, countAssetMenuItems(asset))
}

const openGroupContextMenu = (event: MouseEvent, groupKey: string) => {
  const group = groupByKey(groupKey)
  if (!group || !group.menu) return
  contextMenuGroupKey.value = groupKey
  contextMenuAssetId.value = null
  blankContextMenuVisible.value = false
  positionContextMenu(event, countGroupMenuItems(group))
}

const openBlankContextMenu = (event: MouseEvent) => {
  if ((event.target as HTMLElement | null)?.closest('.workspace-folder-row, .workspace-host-row, .asset-context-menu')) return
  contextMenuAssetId.value = null
  contextMenuGroupKey.value = null
  blankContextMenuVisible.value = true
  positionContextMenu(event, 2)
}

const canDragAsset = (asset: WorkspacePanelAsset) => !asset.isLocalShell && asset.asset_type !== 'organization'
const canDragGroup = (group: WorkspacePanelGroup) => group.type === 'direct-group' || group.type === 'custom-folder'

const clearDragState = () => {
  dragState.kind = ''
  dragState.assetId = ''
  dragState.groupKey = ''
  dragOverGroupKey.value = ''
  dragOverAssetId.value = ''
}

const handleAssetDragStart = (event: DragEvent, asset: WorkspacePanelAsset) => {
  if (!event.dataTransfer || !canDragAsset(asset)) return
  dragState.kind = 'asset'
  dragState.assetId = asset.id
  dragState.groupKey = ''
  const aiContextPayload = {
    contextType: 'host',
    id: asset.id,
    kind: 'hosts',
    label: asset.host || asset.ip || asset.name,
    detail: asset.name || asset.title || asset.group_name,
    host: asset.host || asset.ip || asset.name,
    port: Number(asset.port) || 22,
    username: asset.username || 'root',
    assetName: asset.name || asset.title || asset.host || asset.ip,
    isLocalShell: Boolean(asset.isLocalShell)
  }
  const serialized = JSON.stringify(aiContextPayload)
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('application/x-aiopsterm-workspace-asset', asset.id)
  event.dataTransfer.setData('application/x-aiopsterm-context', serialized)
  event.dataTransfer.setData('text/html', `<span data-aiopsterm-context="${encodeURIComponent(serialized)}"></span>`)
  event.dataTransfer.setData('text/plain', asset.name)
}

const handleGroupDragStart = (event: DragEvent, group: WorkspacePanelGroup) => {
  if (!event.dataTransfer || !canDragGroup(group)) return
  dragState.kind = 'group'
  dragState.groupKey = group.key
  dragState.assetId = ''
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('application/x-aiopsterm-workspace-group', group.key)
  event.dataTransfer.setData('text/plain', group.title)
}

const draggedAssetId = (event: DragEvent) => event.dataTransfer?.getData('application/x-aiopsterm-workspace-asset') || (dragState.kind === 'asset' ? dragState.assetId : '')
const draggedGroupKey = (event: DragEvent) => event.dataTransfer?.getData('application/x-aiopsterm-workspace-group') || (dragState.kind === 'group' ? dragState.groupKey : '')

const handleGroupDragOver = (event: DragEvent, group: WorkspacePanelGroup) => {
  const assetId = draggedAssetId(event)
  const groupKey = draggedGroupKey(event)
  if (!assetId && !groupKey) return
  if (groupKey && (groupKey === group.key || isDescendantGroup(groupKey, group.key))) return
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  dragOverGroupKey.value = group.key
}

const handleGroupDragLeave = (groupKey: string) => {
  if (dragOverGroupKey.value === groupKey) dragOverGroupKey.value = ''
}

const handleGroupDrop = async (event: DragEvent, group: WorkspacePanelGroup) => {
  const assetId = draggedAssetId(event)
  const groupKey = draggedGroupKey(event)
  if (assetId) await moveAssetToGroup(assetId, group)
  else if (groupKey) await moveGroupToParent(groupKey, group)
  clearDragState()
}

const handleAssetDragOver = (event: DragEvent, asset: WorkspacePanelAsset) => {
  if (!draggedAssetId(event) && !draggedGroupKey(event)) return
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  dragOverAssetId.value = asset.id
}

const handleAssetDragLeave = (assetId: string) => {
  if (dragOverAssetId.value === assetId) dragOverAssetId.value = ''
}

const handleAssetDrop = async (event: DragEvent, asset: WorkspacePanelAsset) => {
  const row = visibleTreeRows.value.find((item) => item.kind === 'asset' && item.asset.id === asset.id)
  const targetGroup = row?.kind === 'asset' ? groupByKey(row.parentGroupKey) : null
  const draggedId = draggedAssetId(event)
  if (draggedId && draggedId !== asset.id) await moveAssetToGroup(draggedId, targetGroup)
  clearDragState()
}

const handleBlankDragOver = (event: DragEvent) => {
  if (!draggedAssetId(event) && !draggedGroupKey(event)) return
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
}

const handleBlankDragLeave = (event: DragEvent) => {
  const target = event.currentTarget as HTMLElement | null
  const related = event.relatedTarget as Node | null
  if (!target || !related || !target.contains(related)) {
    dragOverGroupKey.value = ''
    dragOverAssetId.value = ''
  }
}

const handleBlankDrop = async (event: DragEvent) => {
  if ((event.target as HTMLElement | null)?.closest('.workspace-folder-row, .workspace-host-row')) return
  const assetId = draggedAssetId(event)
  const groupKey = draggedGroupKey(event)
  if (assetId) await moveAssetToGroup(assetId, null)
  else if (groupKey) await moveGroupToParent(groupKey, null)
  clearDragState()
}

const connectContextAsset = () => {
  if (contextMenuAssetId.value) connectAsset(contextMenuAssetId.value)
  closeContextMenu()
}

const toggleFavorite = async () => {
  const asset = findEditableAsset(contextMenuAssetId.value || '')
  if (asset) {
    const nextFavorite = !Boolean(asset.favorite)
    try {
      const saved = await saveAssetRecord(toAssetInput(asset, { favorite: nextFavorite }))
      notice.value = saved.favorite ? `已收藏 ${saved.name}` : `已取消收藏 ${saved.name}`
    } catch (error) {
      notice.value = error instanceof Error ? error.message : '收藏状态保存失败'
    }
  }
  closeContextMenu()
}

const openCommentEditor = (assetId: string) => {
  const asset = allAssets.value.find((item) => item.id === assetId)
  if (!asset) return
  commentAssetId.value = assetId
  editingComment.value = asset.comment || ''
}

const openContextComment = () => {
  if (contextMenuAssetId.value) openCommentEditor(contextMenuAssetId.value)
  closeContextMenu()
}

const saveComment = async (assetId: string) => {
  const asset = findEditableAsset(assetId)
  if (asset) {
    const nextComment = editingComment.value.trim()
    try {
      const saved = await saveAssetRecord(toAssetInput(asset, { comment: nextComment }))
      notice.value = saved.comment ? `已更新备注 ${saved.comment}` : '已清空备注'
      cancelComment()
    } catch (error) {
      notice.value = error instanceof Error ? error.message : '备注保存失败'
    }
    return
  }
  cancelComment()
}

const cancelComment = () => {
  commentAssetId.value = ''
  editingComment.value = ''
}

const applyTunnelResult = (result: AiopsSshTunnelMutationResult, fallbackMessage: string) => {
  if (!result.ok) throw new Error(result.errorMessage || fallbackMessage)
  if (!isAiopsSshTunnelMutationData(result.data)) throw new Error(malformedAssetBackendResultMessage)
  applyWorkspaceAssetSnapshot(result.data)
  notice.value = result.data.message || fallbackMessage
}

const parseTunnelPort = (value: string, label: string) => {
  const port = Number(value.trim())
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    tunnelFormError.value = `${label}必须是 1-65535 的整数`
    return null
  }
  return port
}

const openTunnelModal = (asset: WorkspacePanelAsset) => {
  tunnelModal.visible = true
  tunnelModal.assetId = asset.id
  resetTunnelForm('local_forward')
}

const toggleTunnel = async () => {
  const asset = findEditableAsset(contextMenuAssetId.value || '')
  closeContextMenu()
  if (!asset) return
  try {
    if (asset.tunnelState === 'active') {
      const stopTunnel = assetsClient.stopSshTunnel()
      if (typeof stopTunnel !== 'function') {
        notice.value = '隧道运行时服务不可用'
        return
      }
      applyTunnelResult(await stopTunnel({ assetId: asset.id }), '隧道停止失败')
      return
    }
    openTunnelModal(asset)
  } catch (error) {
    notice.value = error instanceof Error ? error.message : '隧道运行失败'
  }
}

const startTunnelFromModal = async () => {
  const asset = tunnelAsset.value
  if (!asset) {
    tunnelFormError.value = '隧道主机不存在'
    return
  }
  const startTunnel = assetsClient.startSshTunnel()
  if (typeof startTunnel !== 'function') {
    tunnelFormError.value = '隧道运行时服务不可用'
    return
  }
  const localPort = parseTunnelPort(tunnelForm.localPort, tunnelForm.type === 'remote_forward' ? '本地服务端口' : '本地监听端口')
  if (localPort === null) return
  const remotePort =
    tunnelForm.type === 'dynamic_socks'
      ? undefined
      : parseTunnelPort(tunnelForm.remotePort, tunnelForm.type === 'remote_forward' ? '远端监听端口' : '远端服务端口')
  if (remotePort === null) return
  const remoteHost = tunnelForm.remoteHost.trim() || 'localhost'
  tunnelSubmitting.value = true
  tunnelFormError.value = ''
  try {
    applyTunnelResult(
      await startTunnel({
        assetId: asset.id,
        type: tunnelForm.type,
        localPort,
        ...(tunnelForm.type === 'dynamic_socks' ? {} : { remoteHost, remotePort })
      }),
      '隧道连接失败'
    )
    closeTunnelModal()
  } catch (error) {
    tunnelFormError.value = error instanceof Error ? error.message : '隧道连接失败'
  } finally {
    tunnelSubmitting.value = false
  }
}

const openMoveModal = (assetId: string) => {
  moveModal.visible = true
  moveModal.assetId = assetId
  closeContextMenu()
}

const openMoveModalFromContext = () => {
  if (contextMenuAssetId.value) openMoveModal(contextMenuAssetId.value)
}

const moveAssetToFolder = async (folderUuid: string) => {
  const asset = findEditableAsset(moveModal.assetId)
  if (!asset) return
  const folder = customFolders.value.find((item) => item.uuid === folderUuid)
  const targetGroup = folder ? groupByKey(folderGroupKey(folder)) : null
  try {
    await saveAssetRecord(toAssetInput(asset, targetGroup ? groupTargetPatch(targetGroup, asset) : { folderUuid, organizationId: asset.organizationId || organizationAssets.value[0]?.uuid }))
    await expandGroup(targetGroup?.key || folderUuid)
    closeMoveModal()
  } catch (error) {
    notice.value = error instanceof Error ? error.message : '移动资产失败'
  }
}

const removeAssetFromFolder = async (assetId: string) => {
  const asset = findEditableAsset(assetId)
  if (!asset || !asset.folderUuid) return
  const folderName = folderNameByUuid(asset.folderUuid)
  try {
    await saveAssetRecord(toAssetInput(asset, groupTargetPatch(null, asset)))
    if (asset.organizationId) await expandGroup(asset.organizationId)
  } catch (error) {
    notice.value = error instanceof Error ? error.message : '移除资产失败'
  }
  closeContextMenu()
}

const removeContextAssetFromFolder = () => {
  if (contextMenuAssetId.value) removeAssetFromFolder(contextMenuAssetId.value)
}

const refreshGroup = async (groupKey: string) => {
  refreshingGroupKey.value = groupKey
  notice.value = '正在刷新堡垒机资源'
  const organization = organizationAssets.value.find((asset) => asset.uuid === groupKey)
  try {
    const expectedOrganizationId = organization?.id
    const refreshOrganizationAssets = assetsClient.refreshOrganizationAssets()
    if (typeof refreshOrganizationAssets !== 'function') throw new Error('组织资产刷新服务不可用')
    const result = await refreshOrganizationAssets(expectedOrganizationId ? { organizationId: expectedOrganizationId } : undefined)
    if (!result?.ok) throw new Error(result?.errorMessage || '刷新堡垒机资源失败')
    if (!isAiopsJumpserverOrganizationAssetRefreshData(result.data, expectedOrganizationId)) throw new Error(malformedAssetBackendResultMessage)
    const groups = await loadDirectGroupOptions()
    applyWorkspaceAssetState(result.data, groups)
    if (organization) await expandGroup(organization.uuid)
    notice.value = organization ? `${organization.name} 资源已刷新` : '堡垒机资源已刷新'
  } catch (error) {
    notice.value = error instanceof Error ? error.message : '刷新堡垒机资源失败'
  } finally {
    refreshingGroupKey.value = ''
    closeContextMenu()
  }
}

const refreshContextOrganization = () => {
  if (contextAsset.value) refreshGroup(contextAsset.value.uuid)
}

const openManagementForOrganization = (organizationId: string) => {
  managementModal.visible = true
  managementModal.organizationId = organizationId
  managementModal.query = ''
  closeContextMenu()
}

const openContextOrganizationManagement = () => {
  if (contextAsset.value) openManagementForOrganization(contextAsset.value.uuid)
}

const openGroupOrganizationManagement = () => {
  if (contextGroup.value?.organizationId) openManagementForOrganization(contextGroup.value.organizationId)
}

const openEditGroup = () => {
  const group = contextGroup.value
  if (!group) return
  folderModal.visible = true
  folderModal.targetKey = group.key
  folderModal.mode = group.type === 'custom-folder' ? 'edit-custom' : 'edit-direct'
  folderForm.name = group.title
  folderForm.description = group.type === 'custom-folder' ? customFolders.value.find((folder) => folder.uuid === group.folderUuid)?.description || '' : ''
  folderFormError.value = ''
  closeContextMenu()
}

const openDeleteGroup = () => {
  if (!contextGroup.value) return
  deleteGroupModal.visible = true
  deleteGroupModal.groupKey = contextGroup.value.key
  closeContextMenu()
}

const openDeleteGroupOrganization = () => {
  const group = contextGroup.value
  if (!group?.organizationId) return
  deleteAssetModal.visible = true
  deleteAssetModal.assetId = organizationAssets.value.find((asset) => asset.uuid === group.organizationId)?.id || ''
  closeContextMenu()
}

const confirmDeleteGroup = () => {
  const group = groupByKey(deleteGroupModal.groupKey)
  if (!group) return
  if (group.type === 'custom-folder') {
    deleteFolderRecord(group.folderUuid || group.key)
      .then(async () => {
        await removeExpandedGroup(group.key)
        notice.value = `已删除文件夹 ${group.title}`
        closeDeleteGroupModal()
      })
      .catch((error) => {
        notice.value = error instanceof Error ? error.message : '删除文件夹失败'
      })
    return
  }
  if (group.type === 'direct-group' && group.groupName) {
    if (group.originalCount === 0 && group.folderUuid) {
      deleteFolderRecord(group.folderUuid)
        .then(async () => {
          await removeExpandedGroup(group.key)
          notice.value = `已删除分组 ${group.title}`
          closeDeleteGroupModal()
        })
        .catch((error) => {
          notice.value = error instanceof Error ? error.message : '删除分组失败'
        })
      return
    }
    const deleteAssetGroup = assetsClient.deleteAssetGroup()
    if (typeof deleteAssetGroup !== 'function') {
      notice.value = '资产分组删除服务不可用'
      return
    }
    const input = {
      name: group.groupName,
      fallbackName: ungroupedGroupName,
      assetTypes: ['person' as const, 'switch' as const]
    }
    deleteAssetGroup(input)
      .then(async (result) => {
        if (!result?.ok) throw new Error(result?.errorMessage || '删除分组失败')
        if (!isAiopsAssetGroupDeleteSnapshot(result.data, input)) throw new Error(malformedAssetBackendResultMessage)
        const groups = await loadDirectGroupOptions()
        applyWorkspaceAssetState(result.data, groups)
        if (group.folderUuid) {
          await deleteFolderRecord(group.folderUuid)
        }
        await removeExpandedGroup(group.key)
        notice.value = `已删除分组 ${group.title}`
        closeDeleteGroupModal()
      })
      .catch((error) => {
        notice.value = error instanceof Error ? error.message : '删除分组失败'
      })
    return
  }
  closeDeleteGroupModal()
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

const closeHostChildModal = () => {
  hostChildModal.value = ''
  hostChildFormError.value = ''
  hostKeyDragOver.value = false
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

const openDeleteContextAsset = () => {
  if (!contextAsset.value || contextAsset.value.isLocalShell) return
  deleteAssetModal.visible = true
  deleteAssetModal.assetId = contextAsset.value.id
  closeContextMenu()
}

const confirmDeleteAsset = async () => {
  const asset = deleteAssetInfo.value
  if (!asset) return
  try {
    await deleteAssetRecord(asset.id)
    if (asset.asset_type === 'organization') await removeExpandedGroup(asset.uuid)
    workspace.selectedContexts = workspace.selectedContexts.filter((context) => context.id !== asset.id)
    selectedAssetId.value = selectedAssetId.value === asset.id ? null : selectedAssetId.value
    notice.value = `已删除主机 ${asset.name}`
    closeDeleteAssetModal()
  } catch (error) {
    notice.value = error instanceof Error ? error.message : '删除主机失败'
  }
}

const closeMenusFromDocument = () => closeMenus()

onMounted(() => {
  document.addEventListener('click', closeMenusFromDocument)
  Promise.all([workspace.hydrateConfig(), refreshAssets(), loadKeychainOptions()]).catch((error) => {
    notice.value = error instanceof Error ? error.message : '资产加载失败'
  })
})

onBeforeUnmount(() => {
  document.removeEventListener('click', closeMenusFromDocument)
})

watch(activeWorkspace, () => {
  closeMenus()
  closeMoveModal()
  closeFolderModal()
  closeDeleteGroupModal()
  closeHostModal()
  closeTunnelModal()
  closeDeleteAssetModal()
  closeManagementModal()
  cancelComment()
  searchValue.value = ''
  selectedAssetId.value = null
})

watch(
  () => tunnelForm.type,
  (type, previousType) => {
    if (!tunnelModal.visible || type === previousType) return
    tunnelForm.localPort = type === 'dynamic_socks' ? '1080' : '3306'
    tunnelForm.remoteHost = 'localhost'
    tunnelForm.remotePort = type === 'dynamic_socks' ? '' : '3306'
    tunnelFormError.value = ''
  }
)

  return {
    workspace,
    workspaceTabs,
    activeWorkspace,
    searchValue,
    selectedAssetId,
    contextMenuAssetId,
    contextMenuGroupKey,
    blankContextMenuVisible,
    contextMenuPosition,
    refreshingGroupKey,
    notice,
    commentAssetId,
    editingComment,
    dragOverGroupKey,
    dragOverAssetId,
    keychainOptions,
    folderModal,
    folderForm,
    folderFormError,
    moveModal,
    deleteGroupModal,
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
    deleteAssetModal,
    managementModal,
    tunnelModal,
    tunnelForm,
    tunnelFormError,
    tunnelSubmitting,
    showIpMode,
    targetMoveFolders,
    hostGroupOptions,
    jumpHostOptions,
    assetGroupAssetCount,
    visibleTreeRows,
    contextAsset,
    contextGroup,
    canCommentContextAsset,
    canMoveContextAsset,
    canRemoveContextAssetFromFolder,
    canConnectContextAsset,
    canCreateChildInContextGroup,
    canCreateHostInContextGroup,
    tunnelAsset,
    hostModalTitle,
    tunnelTypeOptions,
    deleteAssetInfo,
    deleteGroupInfo,
    managedOrganization,
    managedOrganizationAssets,
    openHostKeyImportDialog,
    handleHostKeyDrop,
    saveHostProxyForm,
    saveHostKeyForm,
    saveHostJumpHostForm,
    isGroupExpanded,
    toggleGroup,
    closeMenus,
    openCreateFolder,
    openCreateFolderFromMoveModal,
    openCreateHost,
    closeFolderModal,
    closeMoveModal,
    closeDeleteGroupModal,
    closeHostModal,
    closeTunnelModal,
    closeDeleteAssetModal,
    closeManagementModal,
    saveFolderForm,
    displayAsset,
    folderNameByUuid,
    toggleDisplayMode,
    selectAsset,
    connectAsset,
    openContextMenu,
    openGroupContextMenu,
    openBlankContextMenu,
    canDragAsset,
    canDragGroup,
    clearDragState,
    handleAssetDragStart,
    handleGroupDragStart,
    handleGroupDragOver,
    handleGroupDragLeave,
    handleGroupDrop,
    handleAssetDragOver,
    handleAssetDragLeave,
    handleAssetDrop,
    handleBlankDragOver,
    handleBlankDragLeave,
    handleBlankDrop,
    connectContextAsset,
    toggleFavorite,
    openContextComment,
    saveComment,
    cancelComment,
    toggleTunnel,
    startTunnelFromModal,
    openMoveModal,
    openMoveModalFromContext,
    moveAssetToFolder,
    removeAssetFromFolder,
    removeContextAssetFromFolder,
    refreshGroup,
    refreshContextOrganization,
    openContextOrganizationManagement,
    openGroupOrganizationManagement,
    openEditGroup,
    openDeleteGroup,
    openDeleteGroupOrganization,
    confirmDeleteGroup,
    closeHostChildModal,
    openKeyManagementFromHostForm,
    openProxyManagementFromHostForm,
    openJumpHostCreateFromHostForm,
    editContextAsset,
    cloneContextAsset,
    testHostFormConnection,
    saveHostForm,
    openDeleteContextAsset,
    confirmDeleteAsset
  }
}
