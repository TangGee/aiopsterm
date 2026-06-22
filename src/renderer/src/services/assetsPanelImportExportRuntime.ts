import { computed, ref, type ComputedRef, type Ref } from 'vue'

import type {
  AiopsAssetGroupRecord,
  AiopsAssetImportPreviewRecord
} from '@shared/contracts/assets'
import { assetsClient } from '@/services/assetsClient'
import { localFilesClient } from '@/services/localFilesClient'
import {
  isAiopsAssetExportData,
  isAiopsAssetImportConfirmData,
  isAiopsAssetImportPreviewData,
  malformedAssetBackendResultMessage
} from '@/services/assetBackendGuards'
import type { AssetsPanelAsset } from '@/services/assetsPanelTreeRuntime'

type AssetsPanelImportExportRuntimeInput = {
  exportableAssets: ComputedRef<AssetsPanelAsset[]>
  loadAssetGroupOptions: () => Promise<AiopsAssetGroupRecord[]>
  applyHostManagementState: (snapshot: unknown, groups: AiopsAssetGroupRecord[]) => unknown
  importNotice: Ref<string>
}

export const createAssetsPanelImportExportRuntime = ({
  exportableAssets,
  loadAssetGroupOptions,
  applyHostManagementState,
  importNotice
}: AssetsPanelImportExportRuntimeInput) => {
  const exportModalOpen = ref(false)
  const exportCheckedIds = ref<string[]>([])
  const exportQuery = ref('')
  const importPreviewOpen = ref(false)
  const importPreviewFilePath = ref('')
  const importPreviewAssets = ref<AiopsAssetImportPreviewRecord[]>([])

  const resolvedExportIds = computed(() => exportCheckedIds.value.filter((id) => exportableAssets.value.some((asset) => asset.id === id)))
  const importDuplicateCount = computed(() => importPreviewAssets.value.filter((asset) => asset.duplicateId).length)
  const importPreviewSummary = computed(() => {
    if (!importPreviewAssets.value.length) return '没有可导入的主机。'
    const duplicate = importDuplicateCount.value
    return duplicate ? `解析到 ${importPreviewAssets.value.length} 个主机，其中 ${duplicate} 个与现有主机重复。` : `解析到 ${importPreviewAssets.value.length} 个主机。`
  })

  const isExportGroupChecked = (children: AssetsPanelAsset[]) => children.length > 0 && children.every((asset) => exportCheckedIds.value.includes(asset.id))

  const toggleExportGroup = (children: AssetsPanelAsset[], checked: boolean) => {
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

  const removeExportIds = (assetIds: string[]) => {
    exportCheckedIds.value = exportCheckedIds.value.filter((id) => !assetIds.includes(id))
  }

  return {
    exportModalOpen,
    exportCheckedIds,
    exportQuery,
    importPreviewOpen,
    importPreviewAssets,
    resolvedExportIds,
    importDuplicateCount,
    importPreviewSummary,
    isExportGroupChecked,
    toggleExportGroup,
    openExportModal,
    selectAllExportKeys,
    confirmExport,
    openImportDialog,
    closeImportPreview,
    confirmImportAssets,
    removeExportIds
  }
}
