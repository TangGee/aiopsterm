import { computed, reactive, ref, watch, type ComputedRef, type Ref } from 'vue'

import type { AiopsAssetInput, AiopsCustomFolderRecord } from '@shared/contracts/assets'
import {
  buildManagedGroups,
  collectManagedRows,
  flattenAssetGroups,
  filterAssetGroups,
  normalizeDirectAssetGroupName,
  type AssetsPanelAsset,
  type AssetsPanelGroup,
  type AssetsPanelTreeRow
} from '@/services/assets/assetsPanelTreeRuntime'

type AssetManagementTreeRow = AssetsPanelTreeRow

type AssetsPanelManagedRuntimeInput = {
  assets: Ref<AssetsPanelAsset[]>
  bastionAssetFolders: ComputedRef<AiopsCustomFolderRecord[]>
  activeAssetView: Ref<string>
  toAssetInput: (asset: AssetsPanelAsset, patch?: Partial<AiopsAssetInput>) => AiopsAssetInput
  saveAssetRecord: (input: AiopsAssetInput, options?: { requireGroups?: boolean }) => Promise<AssetsPanelAsset>
  refreshOrganizationAssets: (expectedOrganizationId?: string, fallbackErrorMessage?: string) => Promise<{ assets: AssetsPanelAsset[] }>
  closeAssetContextMenus: () => void
  importNotice: Ref<string>
  managedFormError: Ref<string>
}

export const createAssetsPanelManagedRuntime = ({
  assets,
  bastionAssetFolders,
  activeAssetView,
  toAssetInput,
  saveAssetRecord,
  refreshOrganizationAssets,
  closeAssetContextMenus,
  importNotice,
  managedFormError
}: AssetsPanelManagedRuntimeInput) => {
  const selectedRows = ref<string[]>([])
  const managedEditorOpen = ref(false)
  const managedEditMode = ref(false)
  const managedCommentOnly = ref(false)
  const managedOrganizationId = ref<string | null>(null)
  const assetManagementQuery = ref('')
  const assetManagementPage = ref(1)
  const assetManagementPageSize = ref(50)
  const expandedManagedGroupKeys = ref<string[]>([])
  const managedForm = reactive({
    id: '',
    title: '',
    host: '',
    comment: ''
  })

  const managedOrganization = computed(() => assets.value.find((asset) => asset.id === managedOrganizationId.value && asset.asset_type === 'organization'))
  const managedSourceAssets = computed(() => {
    const nonOrganizationAssets = assets.value.filter((asset) => asset.asset_type !== 'organization')
    if (!managedOrganization.value) return nonOrganizationAssets
    return nonOrganizationAssets.filter((asset) => asset.organizationId === managedOrganization.value?.uuid || asset.group_name === managedOrganization.value?.group_name || asset.tags.includes('synced'))
  })
  const managedGroups = computed<AssetsPanelGroup[]>(() =>
    buildManagedGroups({
      sourceAssets: managedSourceAssets.value,
      allAssets: assets.value,
      bastionFolders: bastionAssetFolders.value,
      managedOrganization: managedOrganization.value
    })
  )
  const managedFilteredGroups = computed<AssetsPanelGroup[]>(() => filterAssetGroups(managedGroups.value, assetManagementQuery.value))
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
  const managedVisibleAllSelected = computed(() => {
    const visibleAssets = pagedManagedRows.value.filter((row): row is Extract<AssetManagementTreeRow, { kind: 'asset' }> => row.kind === 'asset')
    return visibleAssets.length > 0 && visibleAssets.every((row) => selectedRows.value.includes(row.asset.id))
  })
  const managedOrganizationTitle = computed(() => (managedOrganization.value ? `管理资产 · ${managedOrganization.value.title}` : '全部组织资产'))

  const openAssetManagement = (organizationId?: string | null) => {
    managedOrganizationId.value = organizationId || null
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
      const data = await refreshOrganizationAssets(expectedOrganizationId, '刷新资产表失败。')
      selectedRows.value = selectedRows.value.filter((id) => data.assets.some((asset) => asset.id === id))
      importNotice.value = `已刷新资产表，共 ${data.assets.filter((asset) => asset.asset_type !== 'organization').length} 条。`
    } catch (error) {
      importNotice.value = error instanceof Error ? error.message : '刷新资产表失败。'
    }
  }

  const toggleManagedVisibleSelection = (checked: boolean) => {
    const visibleIds = pagedManagedRows.value
      .filter((row): row is Extract<AssetManagementTreeRow, { kind: 'asset' }> => row.kind === 'asset')
      .map((row) => row.asset.id)
    selectedRows.value = checked ? Array.from(new Set([...selectedRows.value, ...visibleIds])) : selectedRows.value.filter((id) => !visibleIds.includes(id))
  }

  const pruneDeletedRows = (assetIds: string[]) => {
    const idSet = new Set(assetIds)
    selectedRows.value = selectedRows.value.filter((id) => !idSet.has(id))
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

  return {
    selectedRows,
    managedEditorOpen,
    managedEditMode,
    managedCommentOnly,
    managedOrganizationId,
    assetManagementQuery,
    assetManagementPage,
    assetManagementPageSize,
    expandedManagedGroupKeys,
    managedForm,
    managedOrganization,
    managedGroups,
    managedFilteredGroups,
    managedAssets,
    isManagedGroupExpanded,
    toggleManagedGroup,
    assetManagementPageCount,
    pagedManagedRows,
    managedVisibleAllSelected,
    managedOrganizationTitle,
    openAssetManagement,
    openManagedAssetAdd,
    openManagedAssetEdit,
    submitManagedForm,
    refreshManagedAssets,
    toggleManagedVisibleSelection,
    pruneDeletedRows
  }
}
