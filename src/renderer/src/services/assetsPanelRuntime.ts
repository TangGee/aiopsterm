import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { assetManagementEntries } from '@/config/assets'
import { assetsClient } from '@/services/assetsClient'
import { localFilesClient } from '@/services/localFilesClient'
import type {
  AiopsAssetAuthType,
  AiopsAssetGroupRecord,
  AiopsAssetImportPreviewRecord,
  AiopsAssetInput,
  AiopsAssetType,
  AiopsCustomFolderRecord,
  AiopsCustomFolderSaveInput,
  AiopsKeychainInput,
  AiopsKeychainRecord,
  AiopsKeychainType
} from '@shared/contracts/assets'
import { useWorkspaceStore } from '@/stores/workspace'
import {
  isAiopsAssetConnectionTestInfo,
  isAiopsAssetGroupListData,
  isAiopsAssetExportData,
  isAiopsAssetImportConfirmData,
  isAiopsAssetImportPreviewData,
  isAiopsAssetSnapshot,
  isAiopsDeletedAssetData,
  isAiopsKeychainDeleteData,
  isAiopsKeychainListData,
  isAiopsKeychainRecord,
  isAiopsJumpserverOrganizationAssetRefreshData,
  isAiopsSavedAssetRecord,
  isAiopsSavedCustomFolderRecord,
  malformedAssetBackendResultMessage
} from '@/services/assetBackendGuards'
import { openSshTerminalLaunch } from '@/services/terminalLaunchRuntime'
import {
  assetGroupAssetCount,
  buildDirectAssetGroups,
  buildExportAssetGroups,
  buildManagedGroups,
  collectManagedRows,
  directGroupKey,
  filterAssetGroups,
  findAssetGroupByKey,
  flattenAssetGroups,
  normalizeDirectAssetGroupName,
  type AssetsPanelAsset,
  type AssetsPanelGroup,
  type AssetsPanelTreeRow
} from '@/services/assetsPanelTreeRuntime'

export { assetGroupAssetCount } from '@/services/assetsPanelTreeRuntime'

export type AssetRecord = AssetsPanelAsset
export type AssetGroup = AssetsPanelGroup
export type AssetManagementTreeRow = AssetsPanelTreeRow

export type AssetsPanelRuntimeProps = { query: string; mode?: 'panel' | 'workspace' }

export const useAssetsPanelRuntime = (props: AssetsPanelRuntimeProps) => {
  const workspace = useWorkspaceStore()
  const isWorkspaceMode = computed(() => props.mode === 'workspace')
  const activeAssetView = ref(isWorkspaceMode.value ? 'assetConfig' : 'menu')
  const managementQuery = ref('')
  const assetQuery = ref('')
  const editorOpen = ref(false)
  const editMode = ref(false)
  const selectedAssetId = ref<string | null>(null)
  const assetContextMenuId = ref<string | null>(null)
  const assetBlankContextMenuOpen = ref(false)
  const assetGroupContextMenuKey = ref('')
  const contextPosition = reactive({ x: 0, y: 0 })
  const importNotice = ref('')
  const importHelpOpen = ref(false)
  const assetFormError = ref('')
  const managedFormError = ref('')
  const exportModalOpen = ref(false)
  const exportCheckedIds = ref<string[]>([])
  const exportQuery = ref('')
  const selectedRows = ref<string[]>([])
  const assetTestLoading = ref(false)
  const assetTestMessage = ref('')
  const assetTestOk = ref(false)
  const assetPasswordVisible = ref(false)
  let assetSecretRequestId = 0
  const assets = ref<AssetRecord[]>([])
  const customFolders = ref<AiopsCustomFolderRecord[]>([])
  const form = reactive({
    id: '',
    title: '',
    host: '',
    username: '',
    group: '',
    port: 22,
    asset_type: 'person' as AiopsAssetType,
    auth_type: 'password' as AiopsAssetAuthType,
    password: '',
    keyId: '',
    proxyName: '',
    jumpHostId: '',
    bastionType: 'jumpserver',
    switchBrand: 'cisco'
  })

  const keychains = ref<AiopsKeychainRecord[]>([])
  const assetGroupOptions = ref<AiopsAssetGroupRecord[]>([])
  const assetGroupOptionsReady = ref(false)
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
  const expandedAssetGroupKeys = ref<string[]>([])
  const expandedManagedGroupKeys = ref<string[]>([])
  const pendingHostDraftReturn = ref(false)
  const assetFolderModal = reactive<{ visible: boolean; parentKey: string; scope: 'direct' | 'bastion' }>({ visible: false, parentKey: '', scope: 'direct' })
  const assetFolderForm = reactive({ name: '', description: '' })
  const assetFolderFormError = ref('')

  const confirmInput = ref('')
  const confirmState = reactive<{
    open: boolean
    title: string
    message: string
    expectedText: string
    action: null | (() => void | Promise<void>)
  }>({
    open: false,
    title: '',
    message: '',
    expectedText: '',
    action: null
  })

  const importPreviewOpen = ref(false)
  const importPreviewFilePath = ref('')
  const importPreviewAssets = ref<AiopsAssetImportPreviewRecord[]>([])
  const managedEditorOpen = ref(false)
  const managedEditMode = ref(false)
  const managedCommentOnly = ref(false)
  const managedOrganizationId = ref<string | null>(null)
  const assetManagementQuery = ref('')
  const assetManagementPage = ref(1)
  const assetManagementPageSize = ref(50)
  const managedForm = reactive({
    id: '',
    title: '',
    host: '',
    comment: ''
  })

  const filteredManagementEntries = computed(() => {
    const keyword = managementQuery.value.trim().toLowerCase()
    if (!keyword) return assetManagementEntries
    return assetManagementEntries.filter((entry) => `${entry.name} ${entry.description}`.toLowerCase().includes(keyword))
  })

  const firstAssetGroupName = computed(() => assetGroupOptions.value[0]?.name || '')

  const loadAssetGroupOptions = async () => {
    const listAssetGroups = assetsClient.listAssetGroups()
    if (!listAssetGroups) throw new Error('资产分组服务不可用。')
    const groups = await listAssetGroups({
      assetTypes: ['person', 'switch']
    })
    if (!isAiopsAssetGroupListData(groups)) throw new Error(malformedAssetBackendResultMessage)
    return groups.map((group) => ({ ...group }))
  }

  const loadAssetSnapshot = async () => {
    const listAssets = assetsClient.listAssets()
    if (!listAssets) throw new Error('资产列表服务不可用。')
    const snapshot = await listAssets()
    if (!isAiopsAssetSnapshot(snapshot)) throw new Error(malformedAssetBackendResultMessage)
    return snapshot
  }

  const refreshAssets = async () => {
    const snapshot = await loadAssetSnapshot()
    applyAssetSnapshot(snapshot)
    return snapshot
  }

  const loadHostManagementRefresh = async () => {
    const snapshot = await loadAssetSnapshot()
    const groups = await loadAssetGroupOptions()
    return { snapshot, groups }
  }

  const applyAssetGroups = (groups: AiopsAssetGroupRecord[]) => {
    assetGroupOptions.value = groups
    assetGroupOptionsReady.value = true
  }

  const invalidateAssetGroups = () => {
    assetGroupOptions.value = []
    assetGroupOptionsReady.value = false
  }

  const refreshAssetGroupOptions = async () => {
    applyAssetGroups(await loadAssetGroupOptions())
  }

  const refreshHostManagement = async () => {
    const { snapshot, groups } = await loadHostManagementRefresh()
    applyAssetSnapshot(snapshot)
    applyAssetGroups(groups)
    return snapshot
  }

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

  const toAssetInput = (asset: AssetRecord, patch: Partial<AiopsAssetInput> = {}): AiopsAssetInput => ({
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
    ...patch
  })

  const saveAssetRecord = async (input: AiopsAssetInput, options: { requireGroups?: boolean } = {}) => {
    const saveAsset = assetsClient.saveAsset()
    if (!saveAsset) throw new Error('资产保存服务不可用。')
    const result = await saveAsset(input)
    if (!result?.ok) throw new Error(result?.errorMessage || '资产保存失败')
    const saved = result.data
    if (!isAiopsSavedAssetRecord(saved, input)) throw new Error(malformedAssetBackendResultMessage)
    const refresh = options.requireGroups === false ? { snapshot: await loadAssetSnapshot(), groups: null } : await loadHostManagementRefresh()
    const snapshot = refresh.snapshot
    if (!isAiopsAssetSnapshot(snapshot)) throw new Error(malformedAssetBackendResultMessage)
    if (!snapshot.assets.some((asset) => asset.id === saved.id)) throw new Error(malformedAssetBackendResultMessage)
    applyAssetSnapshot(snapshot)
    if (refresh.groups) applyAssetGroups(refresh.groups)
    return saved
  }

  const applyAssetSnapshot = (snapshot: unknown) => {
    if (!isAiopsAssetSnapshot(snapshot)) return false
    assets.value = snapshot.assets.filter((asset) => !asset.isLocalShell).map((asset) => ({ ...asset, tags: [...asset.tags] }))
    customFolders.value = snapshot.folders.map((folder) => ({ ...folder }))
    return true
  }

  const applyHostManagementState = (snapshot: unknown, groups: AiopsAssetGroupRecord[]) => {
    if (!isAiopsAssetSnapshot(snapshot)) throw new Error(malformedAssetBackendResultMessage)
    if (!isAiopsAssetGroupListData(groups)) throw new Error(malformedAssetBackendResultMessage)
    applyAssetSnapshot(snapshot)
    applyAssetGroups(groups)
    return snapshot
  }

  const deleteAssetRecords = async (assetIds: string[], options: { requireGroups?: boolean } = {}) => {
    const deleteAsset = assetsClient.deleteAsset()
    if (!deleteAsset) throw new Error('资产删除服务不可用。')
    for (const id of assetIds) {
      const result = await deleteAsset(id)
      if (!result?.ok) throw new Error(result?.errorMessage || '资产删除失败')
      if (!isAiopsDeletedAssetData(result.data, id)) throw new Error(malformedAssetBackendResultMessage)
    }
    const refresh = options.requireGroups === false ? { snapshot: await loadAssetSnapshot(), groups: null } : await loadHostManagementRefresh()
    const snapshot = refresh.snapshot
    if (!isAiopsAssetSnapshot(snapshot)) throw new Error(malformedAssetBackendResultMessage)
    if (assetIds.some((id) => snapshot.assets.some((asset) => asset.id === id))) throw new Error(malformedAssetBackendResultMessage)
    applyAssetSnapshot(snapshot)
    if (refresh.groups) applyAssetGroups(refresh.groups)
  }

  const managedGroups = computed<AssetGroup[]>(() =>
    buildManagedGroups({
      sourceAssets: managedSourceAssets.value,
      allAssets: assets.value,
      bastionFolders: bastionAssetFolders.value,
      managedOrganization: managedOrganization.value
    })
  )
  const assetGroupByKey = (key: string, scope: 'direct' | 'bastion' = 'direct') =>
    scope === 'direct'
      ? findAssetGroupByKey(assetGroups.value, key)
      : findAssetGroupByKey(managedGroups.value, key) || findAssetGroupByKey(managedFilteredGroups.value, key)
  const directAssetFolders = computed(() => customFolders.value.filter((folder) => folder.scope === 'direct'))
  const bastionAssetFolders = computed(() => customFolders.value.filter((folder) => folder.scope !== 'direct'))
  const assetFolderByGroup = (group: AssetGroup | null, scope: 'direct' | 'bastion' = 'direct') => {
    if (!group) return null
    const folders = scope === 'direct' ? directAssetFolders.value : bastionAssetFolders.value
    if (group.folderUuid) return folders.find((folder) => folder.uuid === group.folderUuid) || null
    return folders.find((folder) => folder.name === group.groupName || folder.name === group.title) || null
  }

  const assetGroups = computed<AssetGroup[]>(() =>
    buildDirectAssetGroups({
      assets: assets.value,
      directFolders: directAssetFolders.value,
      assetGroupOptions: assetGroupOptions.value,
      assetGroupOptionsReady: assetGroupOptionsReady.value
    })
  )

  const filteredAssetGroups = computed(() => filterAssetGroups(assetGroups.value, assetQuery.value))
  const flatFilteredAssets = computed(() => flattenAssetGroups(filteredAssetGroups.value).flatMap((group) => group.children))
  const contextAsset = computed(() => assets.value.find((asset) => asset.id === assetContextMenuId.value))
  const managedOrganization = computed(() => assets.value.find((asset) => asset.id === managedOrganizationId.value && asset.asset_type === 'organization'))
  const jumpHostOptions = computed(() => assets.value.filter((asset) => asset.asset_type === 'person' && asset.id !== form.id))
  const sshProxyOptions = computed(() =>
    workspace.sshProxyConfigs
      .map((config) => ({
        name: config.name.trim()
      }))
      .filter((config) => config.name)
  )
  const configuredSshProxyNames = computed(() => new Set(sshProxyOptions.value.map((proxy) => proxy.name)))
  const exportableAssets = computed(() => assets.value.filter((asset) => asset.asset_type !== 'organization'))
  const exportAssetGroups = computed<AssetGroup[]>(() => buildExportAssetGroups(exportableAssets.value))
  const filteredExportGroups = computed(() => filterAssetGroups(exportAssetGroups.value, exportQuery.value))
  const resolvedExportIds = computed(() => exportCheckedIds.value.filter((id) => exportableAssets.value.some((asset) => asset.id === id)))
  const managedSourceAssets = computed(() => {
    const nonOrganizationAssets = assets.value.filter((asset) => asset.asset_type !== 'organization')
    if (!managedOrganization.value) return nonOrganizationAssets
    return nonOrganizationAssets.filter((asset) => asset.organizationId === managedOrganization.value?.uuid || asset.group_name === managedOrganization.value?.group_name || asset.tags.includes('synced'))
  })
  const managedFilteredGroups = computed<AssetGroup[]>(() => filterAssetGroups(managedGroups.value, assetManagementQuery.value))
  const managedAssets = computed(() => managedFilteredGroups.value.flatMap((group) => flattenAssetGroups([group]).flatMap((item) => item.children)))
  const isManagedGroupExpanded = (key: string) => Boolean(assetManagementQuery.value.trim()) || expandedManagedGroupKeys.value.includes(key)
  const toggleManagedGroup = (key: string) => {
    expandedManagedGroupKeys.value = isManagedGroupExpanded(key)
      ? expandedManagedGroupKeys.value.filter((item) => item !== key)
      : [...expandedManagedGroupKeys.value, key]
  }
  const managedRows = computed(() => collectManagedRows(managedFilteredGroups.value, isManagedGroupExpanded))
  const assetManagementPageCount = computed(() => Math.max(1, Math.ceil(managedRows.value.length / assetManagementPageSize.value)))
  const pagedManagedRows = computed(() => {
    const start = (assetManagementPage.value - 1) * assetManagementPageSize.value
    return managedRows.value.slice(start, start + assetManagementPageSize.value)
  })
  const managedVisibleAllSelected = computed(
    () => {
      const visibleAssets = pagedManagedRows.value.filter((row): row is Extract<AssetManagementTreeRow, { kind: 'asset' }> => row.kind === 'asset')
      return visibleAssets.length > 0 && visibleAssets.every((row) => selectedRows.value.includes(row.asset.id))
    }
  )
  const managedOrganizationTitle = computed(() => (managedOrganization.value ? `管理资产 · ${managedOrganization.value.title}` : '全部组织资产'))
  const importDuplicateCount = computed(() => importPreviewAssets.value.filter((asset) => asset.duplicateId).length)
  const importPreviewSummary = computed(() => {
    if (!importPreviewAssets.value.length) return '没有可导入的主机。'
    const duplicate = importDuplicateCount.value
    return duplicate ? `解析到 ${importPreviewAssets.value.length} 个主机，其中 ${duplicate} 个与现有主机重复。` : `解析到 ${importPreviewAssets.value.length} 个主机。`
  })
  const filteredKeychains = computed(() => {
    const keyword = keyQuery.value.trim().toLowerCase()
    if (!keyword) return keychains.value
    return keychains.value.filter((key) => `${key.name} ${key.type} ${key.publicKey}`.toLowerCase().includes(keyword))
  })
  const isAssetGroupExpanded = (key: string) => Boolean(assetQuery.value.trim()) || expandedAssetGroupKeys.value.includes(key)
  const toggleAssetGroup = (key: string) => {
    expandedAssetGroupKeys.value = isAssetGroupExpanded(key)
      ? expandedAssetGroupKeys.value.filter((item) => item !== key)
      : [...expandedAssetGroupKeys.value, key]
  }

  const resetAssetConnectionTest = () => {
    assetTestLoading.value = false
    assetTestMessage.value = ''
    assetTestOk.value = false
  }

  const resetForm = (groupName = '') => {
    assetSecretRequestId += 1
    assetFormError.value = ''
    resetAssetConnectionTest()
    assetPasswordVisible.value = false
    Object.assign(form, {
      id: '',
      title: '',
      host: '',
      username: '',
      group: normalizeDirectAssetGroupName(groupName),
      port: 22,
      asset_type: 'person',
      auth_type: 'password',
      password: '',
      keyId: '',
      proxyName: '',
      jumpHostId: '',
      bastionType: 'jumpserver',
      switchBrand: 'cisco'
    })
  }

  const closeAssetContextMenus = () => {
    assetContextMenuId.value = null
    assetBlankContextMenuOpen.value = false
    assetGroupContextMenuKey.value = ''
  }

  const groupNameFromKey = (groupKey = '') => groupKey.replace(/^group-/, '')

  const openNewPanel = (groupKey = '') => {
    activeAssetView.value = 'assetConfig'
    editMode.value = false
    resetForm(groupKey ? groupNameFromKey(groupKey) : '')
    editorOpen.value = true
    closeAssetContextMenus()
  }

  const openNewPanelFromContext = (groupKey = '') => {
    openNewPanel(groupKey)
  }

  const closeAssetEditor = () => {
    assetSecretRequestId += 1
    editorOpen.value = false
    assetPasswordVisible.value = false
  }

  const saveAssetFolderRecord = async (folder: AiopsCustomFolderSaveInput) => {
    const saveAssetFolder = assetsClient.saveAssetFolder()
    if (!saveAssetFolder) throw new Error('目录保存服务不可用。')
    const result = await saveAssetFolder(folder)
    if (!result?.ok) throw new Error(result?.errorMessage || '目录保存失败')
    if (!isAiopsSavedCustomFolderRecord(result.data, folder)) throw new Error(malformedAssetBackendResultMessage)
    const { snapshot, groups } = await loadHostManagementRefresh()
    applyHostManagementState(snapshot, groups)
    return result.data
  }

  const ensureAssetFolderForGroup = async (group: AssetGroup, scope: 'direct' | 'bastion' = 'direct') => {
    const existing = assetFolderByGroup(group, scope)
    if (existing) return existing
    return saveAssetFolderRecord({ name: group.title, description: '', scope })
  }

  const openCreateAssetFolder = (parentGroup?: AssetGroup | null, scope: 'direct' | 'bastion' = 'direct') => {
    assetFolderModal.visible = true
    assetFolderModal.parentKey = parentGroup?.key || ''
    assetFolderModal.scope = scope
    assetFolderForm.name = ''
    assetFolderForm.description = ''
    assetFolderFormError.value = ''
    closeAssetContextMenus()
  }

  const openCreateAssetFolderFromContext = (groupKey = '') => {
    openCreateAssetFolder(groupKey ? assetGroupByKey(groupKey, 'direct') : null)
  }

  const closeAssetFolderModal = () => {
    assetFolderModal.visible = false
    assetFolderModal.parentKey = ''
    assetFolderModal.scope = 'direct'
    assetFolderForm.name = ''
    assetFolderForm.description = ''
    assetFolderFormError.value = ''
  }

  const submitAssetFolderForm = async () => {
    const name = assetFolderForm.name.trim()
    if (!name) {
      assetFolderFormError.value = '请输入目录名称'
      return
    }
    const duplicate =
      assetFolderModal.scope === 'direct'
        ? flattenAssetGroups(assetGroups.value).some((group) => group.title === name)
        : bastionAssetFolders.value.some((folder) => folder.name === name)
    if (duplicate) {
      assetFolderFormError.value = '目录名称已存在'
      return
    }
    let parentUuid = ''
    const parentGroup = assetFolderModal.parentKey ? assetGroupByKey(assetFolderModal.parentKey, assetFolderModal.scope) : null
    if (parentGroup) {
      try {
        parentUuid = (await ensureAssetFolderForGroup(parentGroup, assetFolderModal.scope)).uuid
      } catch (error) {
        assetFolderFormError.value = error instanceof Error ? error.message : '父目录保存失败'
        return
      }
    }
    try {
      const saved = await saveAssetFolderRecord({
        name,
        description: assetFolderForm.description.trim(),
        scope: assetFolderModal.scope,
        ...(parentUuid ? { parentUuid } : {})
      })
      if (assetFolderModal.scope === 'direct') {
        expandedAssetGroupKeys.value = Array.from(new Set([...expandedAssetGroupKeys.value, directGroupKey(saved.name), ...(parentGroup ? [parentGroup.key] : [])]))
      } else {
        expandedManagedGroupKeys.value = Array.from(new Set([...expandedManagedGroupKeys.value, `managed-folder-${saved.uuid}`, ...(parentGroup ? [parentGroup.key] : [])]))
      }
      importNotice.value = `已创建目录 ${saved.name}。`
      closeAssetFolderModal()
    } catch (error) {
      assetFolderFormError.value = error instanceof Error ? error.message : '目录保存失败'
    }
  }

  const openHostManagement = async () => {
    activeAssetView.value = 'assetConfig'
    try {
      await refreshHostManagement()
    } catch (error) {
      invalidateAssetGroups()
      importNotice.value = error instanceof Error ? error.message : '资产加载失败。'
    }
  }

  const openManagementEntry = (entryKey: string) => {
    if (entryKey === 'assetConfig') {
      void openHostManagement()
      return
    }
    if (entryKey === 'assetManagement') {
      managedOrganizationId.value = null
      selectedRows.value = []
      assetManagementQuery.value = ''
      assetManagementPage.value = 1
      managedEditorOpen.value = false
    }
    activeAssetView.value = entryKey
  }

  const openOnboardingCreatePanel = () => {
    activeAssetView.value = 'assetConfig'
    assetQuery.value = ''
    editMode.value = false
    resetForm()
    editorOpen.value = true
    closeAssetContextMenus()
  }

  const resolveConfiguredSshProxyName = (proxyName?: string) => {
    const name = String(proxyName || '').trim()
    return name && configuredSshProxyNames.value.has(name) ? name : ''
  }

  const resolveAssetProxyName = (asset: AssetRecord) => (asset.needProxy ? resolveConfiguredSshProxyName(asset.proxyName) : '')

  const openSshProxySettings = () => {
    workspace.setActiveModule('settings')
    workspace.setActiveSettingsSection('terminal')
    workspace.openSshProxyConfig()
    workspace.openAddSshProxyConfig()
  }

  const closeProxyModal = () => {
    workspace.closeAddSshProxyConfig()
    pendingHostDraftReturn.value = false
  }

  const openProxyAddPanel = (returnToHostForm = false) => {
    pendingHostDraftReturn.value = returnToHostForm
    workspace.openAddSshProxyConfig()
  }

  const saveProxyFormFromAssetPanel = async () => {
    const proxyName = workspace.sshProxyForm.name.trim()
    const saved = await workspace.saveSshProxyForm()
    if (!saved) return
    if (pendingHostDraftReturn.value && proxyName) {
      form.proxyName = proxyName
      activeAssetView.value = 'assetConfig'
      editorOpen.value = true
      pendingHostDraftReturn.value = false
    }
  }

  const openKeyCreateFromHostForm = () => {
    pendingHostDraftReturn.value = true
    activeAssetView.value = 'keyManagement'
    openNewKeyPanel()
  }

  const openJumpHostCreateFromHostForm = () => {
    pendingHostDraftReturn.value = true
    activeAssetView.value = 'assetConfig'
    editMode.value = false
    const currentGroup = normalizeDirectAssetGroupName(form.group)
    resetForm(currentGroup)
    form.asset_type = 'person'
    form.auth_type = 'keyBased'
    form.group = currentGroup
    form.title = 'jump-host'
    editorOpen.value = true
  }

  const loadAssetEditablePassword = async (requestId: number, assetId: string, mode: 'edit' | 'clone' = 'edit') => {
    const bridge = assetsClient.getAssetEditableSecret()
    if (!bridge) return
    try {
      const result = await bridge(assetId)
      const stillEditingSource = mode === 'edit' && form.id === assetId && editMode.value
      const stillCloningSource = mode === 'clone' && !form.id && !editMode.value
      if (requestId !== assetSecretRequestId || !editorOpen.value || (!stillEditingSource && !stillCloningSource)) return
      if (!result?.ok) return
      form.password = result.data?.password || ''
    } catch {
      if (requestId === assetSecretRequestId && ((mode === 'edit' && form.id === assetId) || (mode === 'clone' && !form.id))) form.password = ''
    }
  }

  const editAsset = (assetId: string | null) => {
    if (!assetId) return
    const asset = assets.value.find((item) => item.id === assetId)
    if (!asset) return
    const secretRequestId = ++assetSecretRequestId
    closeAssetContextMenus()
    activeAssetView.value = 'assetConfig'
    editMode.value = true
    assetFormError.value = ''
    resetAssetConnectionTest()
    assetPasswordVisible.value = false
    Object.assign(form, {
      id: asset.id,
      title: asset.title,
      host: asset.host,
      username: asset.username,
      group: asset.group_name,
      port: asset.port,
      asset_type: asset.asset_type,
      auth_type: asset.auth_type,
      password: '',
      keyId: asset.keychainId || '',
      proxyName: resolveAssetProxyName(asset),
      jumpHostId: '',
      bastionType: asset.asset_type === 'organization' ? 'jumpserver' : 'jumpserver',
      switchBrand: asset.asset_type === 'switch' ? 'cisco' : 'cisco'
    })
    editorOpen.value = true
    if (asset.auth_type === 'password') void loadAssetEditablePassword(secretRequestId, asset.id)
  }

  const cloneAsset = (assetId: string | null) => {
    if (!assetId) return
    const asset = assets.value.find((item) => item.id === assetId)
    if (!asset) return
    const secretRequestId = ++assetSecretRequestId
    closeAssetContextMenus()
    activeAssetView.value = 'assetConfig'
    editMode.value = false
    assetFormError.value = ''
    resetAssetConnectionTest()
    assetPasswordVisible.value = false
    Object.assign(form, {
      id: '',
      title: `${asset.title}_Clone`,
      host: asset.host,
      username: asset.username,
      group: asset.group_name,
      port: asset.port,
      asset_type: asset.asset_type,
      auth_type: asset.auth_type,
      password: '',
      keyId: asset.keychainId || '',
      proxyName: resolveAssetProxyName(asset),
      jumpHostId: '',
      bastionType: 'jumpserver',
      switchBrand: 'cisco'
    })
    editorOpen.value = true
    if (asset.auth_type === 'password') void loadAssetEditablePassword(secretRequestId, asset.id, 'clone')
  }

  const removeAsset = (assetId: string | null) => {
    if (!assetId) return
    const asset = assets.value.find((item) => item.id === assetId)
    if (!asset) return
    closeAssetContextMenus()
    confirmState.open = true
    confirmState.title = '删除主机'
    confirmState.message = `确定删除 ${asset.title}？此操作会更新本地资产库。`
    confirmState.expectedText = asset.title
    confirmState.action = () => deleteAssets([assetId])
    confirmInput.value = ''
  }

  const deleteAssets = async (assetIds: string[]) => {
    try {
      await deleteAssetRecords(assetIds, { requireGroups: activeAssetView.value === 'assetConfig' })
      const idSet = new Set(assetIds)
      selectedRows.value = selectedRows.value.filter((id) => !idSet.has(id))
      selectedAssetId.value = selectedAssetId.value && idSet.has(selectedAssetId.value) ? null : selectedAssetId.value
      exportCheckedIds.value = exportCheckedIds.value.filter((id) => !idSet.has(id))
      importNotice.value = `已删除 ${assetIds.length} 个主机。`
    } catch (error) {
      importNotice.value = error instanceof Error ? error.message : '删除主机失败。'
    }
  }

  const confirmBulkDelete = () => {
    if (!selectedRows.value.length) return
    confirmState.open = true
    confirmState.title = '批量删除主机'
    confirmState.message = `确定删除选中的 ${selectedRows.value.length} 个主机？`
    confirmState.expectedText = ''
    confirmState.action = () => deleteAssets([...selectedRows.value])
    confirmInput.value = ''
  }

  const toggleManagedVisibleSelection = (checked: boolean) => {
    const visibleIds = pagedManagedRows.value
      .filter((row): row is Extract<AssetManagementTreeRow, { kind: 'asset' }> => row.kind === 'asset')
      .map((row) => row.asset.id)
    selectedRows.value = checked ? Array.from(new Set([...selectedRows.value, ...visibleIds])) : selectedRows.value.filter((id) => !visibleIds.includes(id))
  }

  const connectAsset = async (assetId: string | null) => {
    if (!assetId) return
    const asset = assets.value.find((item) => item.id === assetId)
    if (!asset) {
      closeAssetContextMenus()
      return
    }
    selectedAssetId.value = asset.id
    const previousActivePanelId = workspace.activePanelId
    workspace.createPanel()
    workspace.renamePanel(workspace.activePanelId, asset.name || asset.title)
    workspace.replaceTerminalOutput(workspace.activePanelId, '')
    const panelId = workspace.activePanelId
    const discardPendingPanel = () => workspace.discardPendingTerminalPanel(panelId, previousActivePanelId)
    const connected = await openSshTerminalLaunch(
      {
        panelId,
        terminalType: workspace.terminalSettings.terminalType,
        discardPendingPanel,
        setNotice: (message) => {
          importNotice.value = message
          closeAssetContextMenus()
        },
        applyLocalTerminalSession: workspace.applyLocalTerminalSession,
        applySshTerminalSession: workspace.applySshTerminalSession,
        registerSshSession: workspace.registerSshSession
      },
      asset,
      { title: asset.name || asset.title }
    )
    if (!connected) return
    workspace.selectedContexts = [
      ...workspace.selectedContexts.filter((item) => item.id !== asset.id),
      { id: asset.id, kind: 'hosts', label: asset.host, detail: asset.name || asset.title }
    ]
    editorOpen.value = false
    editMode.value = false
    if (workspace.onboardingActiveTour === 'addAndConnectHost') {
      workspace.nextOnboardingStep()
    }
    workspace.setActiveModule('workspace')
    closeAssetContextMenus()
  }

  const openAssetContextMenu = (event: MouseEvent, assetId: string) => {
    assetContextMenuId.value = assetId
    assetBlankContextMenuOpen.value = false
    assetGroupContextMenuKey.value = ''
    const menuWidth = 150
    const menuHeight = 220
    const padding = 10
    contextPosition.x = Math.max(padding, Math.min(event.clientX, window.innerWidth - menuWidth - padding))
    contextPosition.y = Math.max(padding, Math.min(event.clientY, window.innerHeight - menuHeight - padding))
  }

  const positionAssetContextMenu = (event: MouseEvent, menuWidth = 150, menuHeight = 90) => {
    const padding = 10
    contextPosition.x = Math.max(padding, Math.min(event.clientX, window.innerWidth - menuWidth - padding))
    contextPosition.y = Math.max(padding, Math.min(event.clientY, window.innerHeight - menuHeight - padding))
  }

  const openAssetBlankContextMenu = (event: MouseEvent) => {
    if ((event.target as HTMLElement | null)?.closest('.asset-tree-group-row, .asset-tree-host-row, .asset-context-menu')) return
    assetContextMenuId.value = null
    assetGroupContextMenuKey.value = ''
    assetBlankContextMenuOpen.value = true
    positionAssetContextMenu(event)
  }

  const openAssetGroupContextMenu = (event: MouseEvent, groupKey: string) => {
    assetContextMenuId.value = null
    assetBlankContextMenuOpen.value = false
    assetGroupContextMenuKey.value = groupKey
    positionAssetContextMenu(event)
  }

  const buildAssetFormInput = (): { asset: AiopsAssetInput; title: string } | null => {
    assetFormError.value = ''
    const host = form.host.trim()
    const username = form.username.trim()
    const port = Number(form.port)
    if (!host || !username || !Number.isInteger(port) || port < 1 || port > 65535) {
      assetFormError.value = '请填写地址、用户名和有效端口。'
      return null
    }
    if (form.auth_type === 'keyBased' && !form.keyId) {
      assetFormError.value = '请选择密钥链。'
      return null
    }
    const selectedProxyName = form.proxyName.trim()
    const selectedProxy = selectedProxyName ? workspace.sshProxyConfigs.find((config) => config.name.trim() === selectedProxyName) : undefined
    if (selectedProxyName && !selectedProxy) {
      assetFormError.value = '请选择已配置的 SSH 代理。'
      return null
    }
    const title = form.title.trim() || host
    const group = form.group.trim()
    return {
      title,
      asset: {
        ...(form.id ? { id: form.id } : {}),
        name: title,
        title,
        host,
        ip: host,
        ...(group ? { group, group_name: group } : {}),
        status: 'online',
        tags: [form.auth_type === 'keyBased' ? 'key' : 'ssh'],
        username,
        port,
        asset_type: form.asset_type,
        auth_type: form.auth_type,
        comment: editMode.value ? '本地编辑' : '本地创建',
        data_source: form.asset_type === 'organization' ? 'refresh' : 'manual',
        keychainId: form.auth_type === 'keyBased' ? form.keyId || undefined : undefined,
        jumpHostId: form.jumpHostId || undefined,
        needProxy: Boolean(selectedProxy),
        proxyName: selectedProxy ? selectedProxyName : '',
        ...(form.auth_type === 'password' ? { password: form.password } : {})
      }
    }
  }

  const testAssetFormConnection = async () => {
    const testAssetConnection = assetsClient.testAssetConnection()
    if (!testAssetConnection) {
      assetTestOk.value = false
      assetTestMessage.value = '连接测试服务不可用。'
      return
    }
    const draft = buildAssetFormInput()
    if (!draft) return
    assetTestLoading.value = true
    assetTestMessage.value = '正在测试连接...'
    assetTestOk.value = false
    try {
      const result = await testAssetConnection({
        ...(form.id ? { assetId: form.id } : {}),
        asset: draft.asset
      })
      if (!result?.ok) throw new Error(result?.errorMessage || '连接测试失败。')
      if (!isAiopsAssetConnectionTestInfo(result.data)) throw new Error(malformedAssetBackendResultMessage)
      assetTestOk.value = true
      assetTestMessage.value = `连接成功 ${result.data.endpoint} · ${result.data.durationMs}ms`
    } catch (error) {
      assetTestOk.value = false
      assetTestMessage.value = error instanceof Error ? error.message : '连接测试失败。'
    } finally {
      assetTestLoading.value = false
    }
  }

  const submitForm = async () => {
    const draft = buildAssetFormInput()
    if (!draft) return
    try {
      const saved = await saveAssetRecord(draft.asset)
      selectedAssetId.value = saved.id
      importNotice.value = `${editMode.value ? '已保存' : '已创建'} ${draft.title}。`
      closeAssetEditor()
      editMode.value = false
      if (workspace.onboardingActiveTour === 'addAndConnectHost') {
        workspace.jumpOnboardingStep('connect-asset')
      }
    } catch (error) {
      importNotice.value = error instanceof Error ? error.message : '资产保存失败。'
    }
  }

  const refreshOrganizationAsset = async () => {
    if (contextAsset.value) {
      try {
        const expectedOrganizationId = contextAsset.value.id
        const refreshOrganizationAssets = assetsClient.refreshOrganizationAssets()
        if (!refreshOrganizationAssets) throw new Error('组织资产刷新服务不可用。')
        const result = await refreshOrganizationAssets({ organizationId: expectedOrganizationId })
        if (!result?.ok) throw new Error(result?.errorMessage || '刷新堡垒机资源失败。')
        if (!isAiopsJumpserverOrganizationAssetRefreshData(result.data, expectedOrganizationId)) throw new Error(malformedAssetBackendResultMessage)
        applyAssetSnapshot(result.data)
        importNotice.value = `已刷新堡垒机资源 ${contextAsset.value.title}。`
      } catch (error) {
        importNotice.value = error instanceof Error ? error.message : '刷新堡垒机资源失败。'
      }
    }
    closeAssetContextMenus()
  }

  const openOrganizationManagement = () => {
    managedOrganizationId.value = contextAsset.value?.asset_type === 'organization' ? contextAsset.value.id : null
    selectedRows.value = []
    assetManagementQuery.value = ''
    assetManagementPage.value = 1
    managedEditorOpen.value = false
    activeAssetView.value = 'assetManagement'
    closeAssetContextMenus()
  }

  const openManagedAssetAdd = () => {
    managedEditMode.value = false
    managedCommentOnly.value = false
    managedFormError.value = ''
    Object.assign(managedForm, { id: '', title: '', host: '', comment: '' })
    managedEditorOpen.value = true
  }

  const openManagedAssetEdit = (assetId: string) => {
    const asset = assets.value.find((item) => item.id === assetId)
    if (!asset) return
    managedEditMode.value = true
    managedCommentOnly.value = asset.data_source !== 'manual'
    managedFormError.value = ''
    Object.assign(managedForm, {
      id: asset.id,
      title: asset.title,
      host: asset.host,
      comment: asset.comment || ''
    })
    managedEditorOpen.value = true
  }

  const submitManagedForm = async () => {
    managedFormError.value = ''
    const host = managedForm.host.trim()
    if (!managedCommentOnly.value && !host) {
      managedFormError.value = '请填写主机 IP。'
      return
    }
    const title = managedForm.title.trim() || host
    if (managedEditMode.value && managedForm.id) {
      const asset = assets.value.find((item) => item.id === managedForm.id)
      if (!asset) return
      const editable = asset.data_source === 'manual'
      const nextPatch = {
        title: editable ? title : asset.title,
        name: editable ? title : asset.name,
        host: editable ? host : asset.host,
        ip: editable ? host : asset.ip,
        comment: managedForm.comment
      }
      await saveAssetRecord(toAssetInput(asset, nextPatch), { requireGroups: false })
      importNotice.value = `已更新资产 ${editable ? title : asset.title}。`
    } else {
      await saveAssetRecord(
        {
          name: title,
          title,
          host,
          ip: host,
          group: managedOrganization.value?.group_name || '企业',
          group_name: managedOrganization.value?.group_name || '企业',
          status: 'online',
          tags: ['managed'],
          asset_type: 'person',
          auth_type: 'password',
          comment: managedForm.comment,
          data_source: 'manual'
        },
        { requireGroups: false }
      )
      importNotice.value = `已添加资产 ${title}。`
    }
    managedEditorOpen.value = false
  }

  const refreshManagedAssets = async () => {
    try {
      const expectedOrganizationId = managedOrganization.value?.id
      const refreshOrganizationAssets = assetsClient.refreshOrganizationAssets()
      if (!refreshOrganizationAssets) throw new Error('组织资产刷新服务不可用。')
      const result = await refreshOrganizationAssets(expectedOrganizationId ? { organizationId: expectedOrganizationId } : undefined)
      if (!result?.ok) throw new Error(result?.errorMessage || '刷新资产表失败。')
      if (!isAiopsJumpserverOrganizationAssetRefreshData(result.data, expectedOrganizationId)) throw new Error(malformedAssetBackendResultMessage)
      const data = result.data
      applyAssetSnapshot(data)
      selectedRows.value = selectedRows.value.filter((id) => data.assets.some((asset) => asset.id === id))
      importNotice.value = `已刷新资产表，共 ${data.assets.filter((asset) => asset.asset_type !== 'organization').length} 条。`
    } catch (error) {
      importNotice.value = error instanceof Error ? error.message : '刷新资产表失败。'
    }
  }

  const isExportGroupChecked = (children: AssetRecord[]) => children.length > 0 && children.every((asset) => exportCheckedIds.value.includes(asset.id))

  const toggleExportGroup = (children: AssetRecord[], checked: boolean) => {
    const ids = children.map((asset) => asset.id)
    exportCheckedIds.value = checked ? Array.from(new Set([...exportCheckedIds.value, ...ids])) : exportCheckedIds.value.filter((id) => !ids.includes(id))
  }

  const openExportModal = () => {
    if (!exportableAssets.value.length) {
      importNotice.value = '暂无可导出的主机。'
      return
    }
    exportCheckedIds.value = []
    exportQuery.value = ''
    exportModalOpen.value = true
  }

  const selectAllExportKeys = () => {
    exportCheckedIds.value = exportableAssets.value.map((asset) => asset.id)
  }

  const confirmExport = async () => {
    if (!resolvedExportIds.value.length) return
    const exportAssets = assetsClient.exportAssets()
    if (!exportAssets) {
      importNotice.value = '资产导出服务不可用。'
      return
    }
    try {
      const result = await exportAssets({ assetIds: resolvedExportIds.value })
      if (!result?.ok) {
        importNotice.value = result?.errorMessage || '导出文件失败。'
        return
      }
      if (!isAiopsAssetExportData(result.data)) {
        importNotice.value = malformedAssetBackendResultMessage
        return
      }
      if (result.data.canceled) {
        importNotice.value = '已取消导出。'
        return
      }
      importNotice.value = `已导出 ${result.data.exported} 个主机到 ${result.data.fileName}。`
      exportModalOpen.value = false
    } catch {
      importNotice.value = '导出文件失败。'
      return
    }
  }

  const loadAssetImportPreviewFromPath = async (filePath: string) => {
    if (!filePath) {
      importNotice.value = '没有选择导入文件。'
      return
    }
    const previewAssetImport = assetsClient.previewAssetImport()
    if (!previewAssetImport) {
      importNotice.value = '导入文件预览服务不可用。'
      return
    }
    try {
      const result = await previewAssetImport({ filePath })
      if (!result?.ok) {
        importNotice.value = result?.errorMessage || '导入文件预览失败。'
        return
      }
      if (!isAiopsAssetImportPreviewData(result.data)) {
        importNotice.value = malformedAssetBackendResultMessage
        return
      }
      if (!result.data.assets.length) {
        importNotice.value = '导入文件没有可识别的主机。'
        return
      }
      importPreviewFilePath.value = result.data.filePath
      importPreviewAssets.value = result.data.assets
      importPreviewOpen.value = true
    } catch (error) {
      importNotice.value = error instanceof Error ? error.message : '导入文件预览失败。'
    }
  }

  const openImportDialog = async () => {
    const showOpenDialog = localFilesClient.showOpenDialog()
    if (!showOpenDialog) {
      importNotice.value = '导入文件选择服务不可用。'
      return
    }
    let result: Awaited<ReturnType<typeof showOpenDialog>>
    try {
      result = await showOpenDialog({
        properties: ['openFile'],
        filters: [
          { name: 'Asset Import Files', extensions: ['json', 'csv', 'xsh', 'xts', 'ini', 'xml', 'mxtsessions'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })
    } catch {
      importNotice.value = '导入文件选择失败。'
      return
    }
    if (result?.canceled) return
    await loadAssetImportPreviewFromPath(result?.filePaths?.[0] || '')
  }

  const closeImportPreview = () => {
    importPreviewOpen.value = false
    importPreviewFilePath.value = ''
    importPreviewAssets.value = []
  }

  const confirmImportAssets = async (overwrite: boolean) => {
    if (!importPreviewFilePath.value) {
      importNotice.value = '导入文件路径缺失。'
      return
    }
    const confirmAssetImport = assetsClient.confirmAssetImport()
    if (!confirmAssetImport) {
      importNotice.value = '资产导入确认服务不可用。'
      return
    }
    try {
      const result = await confirmAssetImport({ filePath: importPreviewFilePath.value, overwrite })
      if (!result?.ok) {
        importNotice.value = result?.errorMessage || '资产导入失败。'
        return
      }
      if (!isAiopsAssetImportConfirmData(result.data)) {
        importNotice.value = malformedAssetBackendResultMessage
        return
      }
      const groups = await loadAssetGroupOptions()
      applyHostManagementState(result.data, groups)
      importNotice.value = result.data.skipped
        ? `已导入 ${result.data.imported} 个主机，跳过 ${result.data.skipped} 个重复主机。`
        : `已导入 ${result.data.imported} 个主机。`
      closeImportPreview()
    } catch (error) {
      importNotice.value = error instanceof Error ? error.message : '资产导入失败。'
    }
  }

  const openNewKeyPanel = () => {
    keyEditMode.value = false
    keyFormError.value = ''
    keyImportNotice.value = ''
    Object.assign(keyForm, { id: '', name: '', privateKey: '', publicKey: '', passphrase: '' })
    keyEditorOpen.value = true
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
        // Invalid or redacted OpenSSH keys fall back to RSA, matching External reference's visible default.
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

  const onDocumentPointerDown = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null
    if (target?.closest('.asset-context-menu')) return
    if (event.button === 2 && target?.closest('.asset-tree-group-row, .asset-tree-host-row, .keychain-card')) return
    closeAssetContextMenus()
    keyContextMenuId.value = null
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

  const closeConfirm = () => {
    confirmState.open = false
    confirmState.action = null
    confirmInput.value = ''
  }

  const runConfirmAction = async () => {
    if (confirmState.expectedText && confirmInput.value !== confirmState.expectedText) return
    await confirmState.action?.()
    closeConfirm()
  }

  watch(
    assetManagementQuery,
    () => {
      assetManagementPage.value = 1
      selectedRows.value = []
    }
  )

  watch(
    managedFilteredGroups,
    (groups) => {
      const keys = flattenAssetGroups(groups).map((group) => group.key)
      expandedManagedGroupKeys.value = Array.from(new Set([...expandedManagedGroupKeys.value.filter((key) => keys.includes(key)), ...keys]))
    },
    { immediate: true }
  )

  watch(
    assetManagementPageSize,
    () => {
      assetManagementPage.value = 1
    }
  )

  watch(
    assetManagementPageCount,
    (count) => {
      if (assetManagementPage.value > count) assetManagementPage.value = count
    }
  )

  watch(
    filteredAssetGroups,
    (groups) => {
      const keys = groups.map((group) => group.key)
      expandedAssetGroupKeys.value = Array.from(new Set([...expandedAssetGroupKeys.value.filter((key) => keys.includes(key)), ...keys]))
    },
    { immediate: true }
  )

  watch(
    [() => form.proxyName, configuredSshProxyNames],
    () => {
      if (form.proxyName && !configuredSshProxyNames.value.has(form.proxyName)) {
        form.proxyName = ''
      }
    },
    { immediate: true }
  )

  watch(
    () => workspace.onboardingAssetRequest.sequence,
    (sequence) => {
      const request = workspace.onboardingAssetRequest
      if (sequence === 0 && request.action === 'none') return
      if (request.action === 'open-host-management') {
        void openHostManagement()
        return
      }
      if (request.action === 'open-create-form') {
        openOnboardingCreatePanel()
      }
    },
    { immediate: true }
  )

  watch(
    () => workspace.assetManagementOpenRequest.sequence,
    (sequence) => {
      if (!sequence) return
      const request = workspace.assetManagementOpenRequest
      activeAssetView.value = request.view || (request.organizationId ? 'assetManagement' : 'assetConfig')
      if (activeAssetView.value === 'assetManagement') {
        managedOrganizationId.value = request.organizationId || null
        selectedRows.value = []
        assetManagementQuery.value = ''
        assetManagementPage.value = 1
        managedEditorOpen.value = false
      }
      if (request.action === 'create-key') {
        openNewKeyPanel()
      }
      if (request.action === 'create-proxy') {
        workspace.openAddSshProxyConfig()
      }
    },
    { immediate: true }
  )

  onMounted(() => {
    document.addEventListener('pointerdown', onDocumentPointerDown)
    refreshAssets().catch((error) => {
      importNotice.value = error instanceof Error ? error.message : '资产加载失败。'
    })
    refreshAssetGroupOptions().catch((error) => {
      invalidateAssetGroups()
      importNotice.value = error instanceof Error ? error.message : '资产分组加载失败。'
    })
    refreshKeychains().catch((error) => {
      keyServiceNotice.value = error instanceof Error ? error.message : '密钥加载失败。'
    })
  })

  onBeforeUnmount(() => {
    document.removeEventListener('pointerdown', onDocumentPointerDown)
  })

  return {
    assetManagementEntries,
    workspace,
    isWorkspaceMode,
    activeAssetView,
    managementQuery,
    assetQuery,
    editorOpen,
    editMode,
    selectedAssetId,
    assetContextMenuId,
    assetBlankContextMenuOpen,
    assetGroupContextMenuKey,
    contextPosition,
    importNotice,
    importHelpOpen,
    assetFormError,
    managedFormError,
    exportModalOpen,
    exportCheckedIds,
    exportQuery,
    selectedRows,
    assetTestLoading,
    assetTestMessage,
    assetTestOk,
    assetPasswordVisible,
    assets,
    form,
    keychains,
    assetGroupOptions,
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
    expandedAssetGroupKeys,
    assetFolderModal,
    assetFolderForm,
    assetFolderFormError,
    confirmInput,
    confirmState,
    importPreviewOpen,
    importPreviewAssets,
    managedEditorOpen,
    managedEditMode,
    managedCommentOnly,
    assetManagementQuery,
    assetManagementPage,
    assetManagementPageSize,
    managedForm,
    filteredManagementEntries,
    assetGroupAssetCount,
    filteredAssetGroups,
    flatFilteredAssets,
    contextAsset,
    jumpHostOptions,
    sshProxyOptions,
    filteredExportGroups,
    resolvedExportIds,
    managedAssets,
    isManagedGroupExpanded,
    toggleManagedGroup,
    assetManagementPageCount,
    pagedManagedRows,
    managedVisibleAllSelected,
    managedOrganizationTitle,
    importDuplicateCount,
    importPreviewSummary,
    filteredKeychains,
    toggleAssetGroup,
    openNewPanel,
    openNewPanelFromContext,
    closeAssetEditor,
    openCreateAssetFolder,
    openCreateAssetFolderFromContext,
    closeAssetFolderModal,
    submitAssetFolderForm,
    openManagementEntry,
    closeProxyModal,
    openProxyAddPanel,
    saveProxyFormFromAssetPanel,
    openKeyCreateFromHostForm,
    openJumpHostCreateFromHostForm,
    editAsset,
    cloneAsset,
    removeAsset,
    confirmBulkDelete,
    toggleManagedVisibleSelection,
    connectAsset,
    openAssetContextMenu,
    openAssetBlankContextMenu,
    openAssetGroupContextMenu,
    testAssetFormConnection,
    submitForm,
    refreshOrganizationAsset,
    openOrganizationManagement,
    openManagedAssetAdd,
    openManagedAssetEdit,
    submitManagedForm,
    refreshManagedAssets,
    isExportGroupChecked,
    toggleExportGroup,
    openExportModal,
    selectAllExportKeys,
    confirmExport,
    openImportDialog,
    closeImportPreview,
    confirmImportAssets,
    openNewKeyPanel,
    editKey,
    submitKeyForm,
    removeKey,
    openKeyContextMenu,
    openKeyImportDialog,
    handleKeyDrop,
    closeConfirm,
    runConfirmAction
  }
}
