import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { assetManagementEntries } from '@/config/assets'
import type {
  AiopsAssetGroupRecord,
  AiopsAssetInput,
  AiopsCustomFolderRecord
} from '@shared/contracts/assets'
import { useWorkspaceStore } from '@/stores/workspace'
import {
  assetsPanelAssetToInput,
  createAssetsPanelBackendRuntime
} from '@/services/assetsPanelBackendRuntime'
import { createAssetsPanelFolderRuntime } from '@/services/assetsPanelFolderRuntime'
import { createAssetsPanelHostFormRuntime } from '@/services/assetsPanelHostFormRuntime'
import { createAssetsPanelImportExportRuntime } from '@/services/assetsPanelImportExportRuntime'
import { createAssetsPanelKeychainRuntime } from '@/services/assetsPanelKeychainRuntime'
import { createAssetsPanelManagedRuntime } from '@/services/assetsPanelManagedRuntime'
import { createAssetsPanelContextRuntime } from '@/services/assetsPanelContextRuntime'
import { createAssetsPanelAssetInteractionRuntime } from '@/services/assetsPanelAssetInteractionRuntime'
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
  const importNotice = ref('')
  const importHelpOpen = ref(false)
  const managedFormError = ref('')
  const assets = ref<AssetRecord[]>([])
  const customFolders = ref<AiopsCustomFolderRecord[]>([])
  const assetGroupOptions = ref<AiopsAssetGroupRecord[]>([])
  const assetGroupOptionsReady = ref(false)
  const expandedAssetGroupKeys = ref<string[]>([])
  const pendingHostDraftReturn = ref(false)

  const filteredManagementEntries = computed(() => {
    const keyword = managementQuery.value.trim().toLowerCase()
    if (!keyword) return assetManagementEntries
    return assetManagementEntries.filter((entry) => `${entry.name} ${entry.description}`.toLowerCase().includes(keyword))
  })

  const backendRuntime = createAssetsPanelBackendRuntime({
    assets,
    customFolders,
    assetGroupOptions,
    assetGroupOptionsReady
  })
  const {
    loadAssetGroupOptions,
    applyAssetSnapshot,
    applyHostManagementState,
    invalidateAssetGroups,
    refreshAssets,
    refreshAssetGroupOptions,
    refreshHostManagement,
    saveAssetRecord,
    deleteAssetRecords,
    saveAssetFolderRecord,
    refreshOrganizationAssets
  } = backendRuntime

  const toAssetInput = (asset: AssetRecord, patch: Partial<AiopsAssetInput> = {}) => assetsPanelAssetToInput(asset, patch)

  const contextRuntime = createAssetsPanelContextRuntime({ assets })
  const {
    assetContextMenuId,
    assetBlankContextMenuOpen,
    assetGroupContextMenuKey,
    contextPosition,
    contextAsset,
    closeAssetContextMenus,
    openAssetContextMenu,
    openAssetBlankContextMenu,
    openAssetGroupContextMenu
  } = contextRuntime

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
    refreshOrganizationAssets,
    closeAssetContextMenus,
    importNotice,
    managedFormError
  })

  const assetInteractionRuntime = createAssetsPanelAssetInteractionRuntime({
    workspace,
    assets,
    activeAssetView,
    selectedAssetId,
    contextAsset,
    selectedManagedRows: managedRuntime.selectedRows,
    editorOpen: hostFormRuntime.editorOpen,
    editMode: hostFormRuntime.editMode,
    deleteAssetRecords,
    pruneDeletedRows: managedRuntime.pruneDeletedRows,
    removeExportIds: importExportRuntime.removeExportIds,
    refreshOrganizationAssets,
    openAssetManagement: managedRuntime.openAssetManagement,
    closeAssetContextMenus,
    importNotice
  })
  const {
    confirmInput,
    confirmState,
    removeAsset,
    confirmBulkDelete,
    connectAsset,
    refreshOrganizationAsset,
    openOrganizationManagement,
    closeConfirm,
    runConfirmAction
  } = assetInteractionRuntime

  const keychainRuntime = createAssetsPanelKeychainRuntime({
    activeAssetView,
    editorOpen: hostFormRuntime.editorOpen,
    pendingHostDraftReturn,
    form: hostFormRuntime.form,
    confirmInput,
    confirmState
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
    saveAssetFolderRecord,
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
