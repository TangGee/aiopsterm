import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { assetManagementEntries } from '@/config/assets'
import { assetsClient } from '@/services/assetsClient'
import type {
  AiopsAssetGroupRecord,
  AiopsAssetInput,
  AiopsCustomFolderRecord
} from '@shared/contracts/assets'
import { useWorkspaceStore } from '@/stores/workspace'
import {
  isAiopsAssetGroupListData,
  isAiopsAssetSnapshot,
  isAiopsDeletedAssetData,
  isAiopsJumpserverOrganizationAssetRefreshData,
  isAiopsSavedAssetRecord,
  malformedAssetBackendResultMessage
} from '@/services/assetBackendGuards'
import { createAssetsPanelFolderRuntime } from '@/services/assetsPanelFolderRuntime'
import { createAssetsPanelHostFormRuntime } from '@/services/assetsPanelHostFormRuntime'
import { createAssetsPanelImportExportRuntime } from '@/services/assetsPanelImportExportRuntime'
import { createAssetsPanelKeychainRuntime } from '@/services/assetsPanelKeychainRuntime'
import { createAssetsPanelManagedRuntime } from '@/services/assetsPanelManagedRuntime'
import { openSshTerminalLaunch } from '@/services/terminalLaunchRuntime'
import {
  assetGroupAssetCount,
  buildDirectAssetGroups,
  buildExportAssetGroups,
  filterAssetGroups,
  findAssetGroupByKey,
  flattenAssetGroups,
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
  const selectedAssetId = ref<string | null>(null)
  const assetContextMenuId = ref<string | null>(null)
  const assetBlankContextMenuOpen = ref(false)
  const assetGroupContextMenuKey = ref('')
  const contextPosition = reactive({ x: 0, y: 0 })
  const importNotice = ref('')
  const importHelpOpen = ref(false)
  const managedFormError = ref('')
  const assets = ref<AssetRecord[]>([])
  const customFolders = ref<AiopsCustomFolderRecord[]>([])
  const assetGroupOptions = ref<AiopsAssetGroupRecord[]>([])
  const assetGroupOptionsReady = ref(false)
  const expandedAssetGroupKeys = ref<string[]>([])
  const pendingHostDraftReturn = ref(false)
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

  const filteredManagementEntries = computed(() => {
    const keyword = managementQuery.value.trim().toLowerCase()
    if (!keyword) return assetManagementEntries
    return assetManagementEntries.filter((entry) => `${entry.name} ${entry.description}`.toLowerCase().includes(keyword))
  })

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

  const applyAssetGroups = (groups: AiopsAssetGroupRecord[]) => {
    assetGroupOptions.value = groups
    assetGroupOptionsReady.value = true
  }

  const invalidateAssetGroups = () => {
    assetGroupOptions.value = []
    assetGroupOptionsReady.value = false
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

  const refreshAssetGroupOptions = async () => {
    applyAssetGroups(await loadAssetGroupOptions())
  }

  const refreshHostManagement = async () => {
    const { snapshot, groups } = await loadHostManagementRefresh()
    applyAssetSnapshot(snapshot)
    applyAssetGroups(groups)
    return snapshot
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

  const closeAssetContextMenus = () => {
    assetContextMenuId.value = null
    assetBlankContextMenuOpen.value = false
    assetGroupContextMenuKey.value = ''
  }

  const directAssetFolders = computed(() => customFolders.value.filter((folder) => folder.scope === 'direct'))
  const bastionAssetFolders = computed(() => customFolders.value.filter((folder) => folder.scope !== 'direct'))
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
  const sshProxyOptions = computed(() =>
    workspace.sshProxyConfigs
      .map((config) => ({
        name: config.name.trim()
      }))
      .filter((config) => config.name)
  )
  const configuredSshProxyNames = computed(() => new Set(sshProxyOptions.value.map((proxy) => proxy.name)))

  const hostFormRuntime = createAssetsPanelHostFormRuntime({
    workspace,
    activeAssetView,
    selectedAssetId,
    assets,
    pendingHostDraftReturn,
    configuredSshProxyNames,
    saveAssetRecord,
    closeAssetContextMenus,
    importNotice
  })

  const keychainRuntime = createAssetsPanelKeychainRuntime({
    activeAssetView,
    editorOpen: hostFormRuntime.editorOpen,
    pendingHostDraftReturn,
    form: hostFormRuntime.form,
    confirmInput,
    confirmState
  })

  const exportableAssets = computed(() => assets.value.filter((asset) => asset.asset_type !== 'organization'))
  const exportAssetGroups = computed<AssetGroup[]>(() => buildExportAssetGroups(exportableAssets.value))
  const importExportRuntime = createAssetsPanelImportExportRuntime({
    exportableAssets,
    loadAssetGroupOptions,
    applyHostManagementState,
    importNotice
  })
  const filteredExportGroups = computed(() => filterAssetGroups(exportAssetGroups.value, importExportRuntime.exportQuery.value))

  const managedRuntime = createAssetsPanelManagedRuntime({
    assets,
    bastionAssetFolders,
    activeAssetView,
    toAssetInput,
    saveAssetRecord,
    applyAssetSnapshot,
    closeAssetContextMenus,
    importNotice,
    managedFormError
  })

  const assetGroupByKey = (key: string, scope: 'direct' | 'bastion' = 'direct') =>
    scope === 'direct'
      ? findAssetGroupByKey(assetGroups.value, key)
      : findAssetGroupByKey(managedRuntime.managedGroups.value, key) || findAssetGroupByKey(managedRuntime.managedFilteredGroups.value, key)

  const assetFolderByGroup = (group: AssetGroup | null, scope: 'direct' | 'bastion' = 'direct') => {
    if (!group) return null
    const folders = scope === 'direct' ? directAssetFolders.value : bastionAssetFolders.value
    if (group.folderUuid) return folders.find((folder) => folder.uuid === group.folderUuid) || null
    return folders.find((folder) => folder.name === group.groupName || folder.name === group.title) || null
  }

  const folderRuntime = createAssetsPanelFolderRuntime({
    assetGroups,
    bastionAssetFolders,
    expandedAssetGroupKeys,
    expandedManagedGroupKeys: managedRuntime.expandedManagedGroupKeys,
    assetGroupByKey,
    assetFolderByGroup,
    loadHostManagementRefresh,
    applyHostManagementState,
    closeAssetContextMenus,
    importNotice
  })

  const isAssetGroupExpanded = (key: string) => Boolean(assetQuery.value.trim()) || expandedAssetGroupKeys.value.includes(key)
  const toggleAssetGroup = (key: string) => {
    expandedAssetGroupKeys.value = isAssetGroupExpanded(key)
      ? expandedAssetGroupKeys.value.filter((item) => item !== key)
      : [...expandedAssetGroupKeys.value, key]
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
      managedRuntime.openAssetManagement(null)
      return
    }
    activeAssetView.value = entryKey
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
      managedRuntime.pruneDeletedRows(assetIds)
      selectedAssetId.value = selectedAssetId.value && idSet.has(selectedAssetId.value) ? null : selectedAssetId.value
      importExportRuntime.removeExportIds(assetIds)
      importNotice.value = `已删除 ${assetIds.length} 个主机。`
    } catch (error) {
      importNotice.value = error instanceof Error ? error.message : '删除主机失败。'
    }
  }

  const confirmBulkDelete = () => {
    if (!managedRuntime.selectedRows.value.length) return
    confirmState.open = true
    confirmState.title = '批量删除主机'
    confirmState.message = `确定删除选中的 ${managedRuntime.selectedRows.value.length} 个主机？`
    confirmState.expectedText = ''
    confirmState.action = () => deleteAssets([...managedRuntime.selectedRows.value])
    confirmInput.value = ''
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
    hostFormRuntime.editorOpen.value = false
    hostFormRuntime.editMode.value = false
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
    managedRuntime.openAssetManagement(contextAsset.value?.asset_type === 'organization' ? contextAsset.value.id : null)
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

  const onDocumentPointerDown = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null
    if (target?.closest('.asset-context-menu')) return
    if (event.button === 2 && target?.closest('.asset-tree-group-row, .asset-tree-host-row, .keychain-card')) return
    closeAssetContextMenus()
    keychainRuntime.closeKeyContextMenu()
  }

  watch(
    filteredAssetGroups,
    (groups) => {
      const keys = groups.map((group) => group.key)
      expandedAssetGroupKeys.value = Array.from(new Set([...expandedAssetGroupKeys.value.filter((key) => keys.includes(key)), ...keys]))
    },
    { immediate: true }
  )

  watch(
    [() => hostFormRuntime.form.proxyName, configuredSshProxyNames],
    () => {
      hostFormRuntime.validateConfiguredProxy()
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
        assetQuery.value = ''
        hostFormRuntime.openOnboardingCreatePanel()
      }
    },
    { immediate: true }
  )

  watch(
    () => workspace.assetManagementOpenRequest.sequence,
    (sequence) => {
      if (!sequence) return
      const request = workspace.assetManagementOpenRequest
      const nextView = request.view || (request.organizationId ? 'assetManagement' : 'assetConfig')
      if (nextView === 'assetManagement') {
        managedRuntime.openAssetManagement(request.organizationId || null)
      } else {
        activeAssetView.value = nextView
      }
      if (request.action === 'create-key') {
        keychainRuntime.openNewKeyPanel()
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
    keychainRuntime.refreshKeychains().catch((error) => {
      keychainRuntime.keyServiceNotice.value = error instanceof Error ? error.message : '密钥加载失败。'
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
    editorOpen: hostFormRuntime.editorOpen,
    editMode: hostFormRuntime.editMode,
    selectedAssetId,
    assetContextMenuId,
    assetBlankContextMenuOpen,
    assetGroupContextMenuKey,
    contextPosition,
    importNotice,
    importHelpOpen,
    assetFormError: hostFormRuntime.assetFormError,
    managedFormError,
    exportModalOpen: importExportRuntime.exportModalOpen,
    exportCheckedIds: importExportRuntime.exportCheckedIds,
    exportQuery: importExportRuntime.exportQuery,
    selectedRows: managedRuntime.selectedRows,
    assetTestLoading: hostFormRuntime.assetTestLoading,
    assetTestMessage: hostFormRuntime.assetTestMessage,
    assetTestOk: hostFormRuntime.assetTestOk,
    assetPasswordVisible: hostFormRuntime.assetPasswordVisible,
    assets,
    form: hostFormRuntime.form,
    keychains: keychainRuntime.keychains,
    assetGroupOptions,
    keyQuery: keychainRuntime.keyQuery,
    keyEditorOpen: keychainRuntime.keyEditorOpen,
    keyEditMode: keychainRuntime.keyEditMode,
    selectedKeyId: keychainRuntime.selectedKeyId,
    keyContextMenuId: keychainRuntime.keyContextMenuId,
    keyContextPosition: keychainRuntime.keyContextPosition,
    keyDragOver: keychainRuntime.keyDragOver,
    keyServiceNotice: keychainRuntime.keyServiceNotice,
    keyImportNotice: keychainRuntime.keyImportNotice,
    keyFormError: keychainRuntime.keyFormError,
    keyForm: keychainRuntime.keyForm,
    expandedAssetGroupKeys,
    assetFolderModal: folderRuntime.assetFolderModal,
    assetFolderForm: folderRuntime.assetFolderForm,
    assetFolderFormError: folderRuntime.assetFolderFormError,
    confirmInput,
    confirmState,
    importPreviewOpen: importExportRuntime.importPreviewOpen,
    importPreviewAssets: importExportRuntime.importPreviewAssets,
    managedEditorOpen: managedRuntime.managedEditorOpen,
    managedEditMode: managedRuntime.managedEditMode,
    managedCommentOnly: managedRuntime.managedCommentOnly,
    assetManagementQuery: managedRuntime.assetManagementQuery,
    assetManagementPage: managedRuntime.assetManagementPage,
    assetManagementPageSize: managedRuntime.assetManagementPageSize,
    managedForm: managedRuntime.managedForm,
    filteredManagementEntries,
    assetGroupAssetCount,
    filteredAssetGroups,
    flatFilteredAssets,
    contextAsset,
    jumpHostOptions: hostFormRuntime.jumpHostOptions,
    sshProxyOptions,
    filteredExportGroups,
    resolvedExportIds: importExportRuntime.resolvedExportIds,
    managedAssets: managedRuntime.managedAssets,
    isManagedGroupExpanded: managedRuntime.isManagedGroupExpanded,
    toggleManagedGroup: managedRuntime.toggleManagedGroup,
    assetManagementPageCount: managedRuntime.assetManagementPageCount,
    pagedManagedRows: managedRuntime.pagedManagedRows,
    managedVisibleAllSelected: managedRuntime.managedVisibleAllSelected,
    managedOrganizationTitle: managedRuntime.managedOrganizationTitle,
    importDuplicateCount: importExportRuntime.importDuplicateCount,
    importPreviewSummary: importExportRuntime.importPreviewSummary,
    filteredKeychains: keychainRuntime.filteredKeychains,
    toggleAssetGroup,
    openNewPanel: hostFormRuntime.openNewPanel,
    openNewPanelFromContext: hostFormRuntime.openNewPanelFromContext,
    closeAssetEditor: hostFormRuntime.closeAssetEditor,
    openCreateAssetFolder: folderRuntime.openCreateAssetFolder,
    openCreateAssetFolderFromContext: folderRuntime.openCreateAssetFolderFromContext,
    closeAssetFolderModal: folderRuntime.closeAssetFolderModal,
    submitAssetFolderForm: folderRuntime.submitAssetFolderForm,
    openManagementEntry,
    closeProxyModal: hostFormRuntime.closeProxyModal,
    openProxyAddPanel: hostFormRuntime.openProxyAddPanel,
    saveProxyFormFromAssetPanel: hostFormRuntime.saveProxyFormFromAssetPanel,
    openKeyCreateFromHostForm: keychainRuntime.openKeyCreateFromHostForm,
    openJumpHostCreateFromHostForm: hostFormRuntime.openJumpHostCreateFromHostForm,
    editAsset: hostFormRuntime.editAsset,
    cloneAsset: hostFormRuntime.cloneAsset,
    removeAsset,
    confirmBulkDelete,
    toggleManagedVisibleSelection: managedRuntime.toggleManagedVisibleSelection,
    connectAsset,
    openAssetContextMenu,
    openAssetBlankContextMenu,
    openAssetGroupContextMenu,
    testAssetFormConnection: hostFormRuntime.testAssetFormConnection,
    submitForm: hostFormRuntime.submitForm,
    refreshOrganizationAsset,
    openOrganizationManagement,
    openManagedAssetAdd: managedRuntime.openManagedAssetAdd,
    openManagedAssetEdit: managedRuntime.openManagedAssetEdit,
    submitManagedForm: managedRuntime.submitManagedForm,
    refreshManagedAssets: managedRuntime.refreshManagedAssets,
    isExportGroupChecked: importExportRuntime.isExportGroupChecked,
    toggleExportGroup: importExportRuntime.toggleExportGroup,
    openExportModal: importExportRuntime.openExportModal,
    selectAllExportKeys: importExportRuntime.selectAllExportKeys,
    confirmExport: importExportRuntime.confirmExport,
    openImportDialog: importExportRuntime.openImportDialog,
    closeImportPreview: importExportRuntime.closeImportPreview,
    confirmImportAssets: importExportRuntime.confirmImportAssets,
    openNewKeyPanel: keychainRuntime.openNewKeyPanel,
    editKey: keychainRuntime.editKey,
    submitKeyForm: keychainRuntime.submitKeyForm,
    removeKey: keychainRuntime.removeKey,
    openKeyContextMenu: keychainRuntime.openKeyContextMenu,
    openKeyImportDialog: keychainRuntime.openKeyImportDialog,
    handleKeyDrop: keychainRuntime.handleKeyDrop,
    closeConfirm,
    runConfirmAction
  }
}
