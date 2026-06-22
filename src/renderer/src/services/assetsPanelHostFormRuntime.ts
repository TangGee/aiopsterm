import { computed, reactive, ref, type ComputedRef, type Ref } from 'vue'

import type {
  AiopsAssetAuthType,
  AiopsAssetInput,
  AiopsAssetType
} from '@shared/contracts/assets'
import type { useWorkspaceStore } from '@/stores/workspace'
import { assetsClient } from '@/services/assetsClient'
import {
  isAiopsAssetConnectionTestInfo,
  malformedAssetBackendResultMessage
} from '@/services/assetBackendGuards'
import { normalizeDirectAssetGroupName, type AssetsPanelAsset } from '@/services/assetsPanelTreeRuntime'

type WorkspaceStore = ReturnType<typeof useWorkspaceStore>

type AssetsPanelHostFormRuntimeInput = {
  workspace: WorkspaceStore
  activeAssetView: Ref<string>
  selectedAssetId: Ref<string | null>
  assets: Ref<AssetsPanelAsset[]>
  pendingHostDraftReturn: Ref<boolean>
  configuredSshProxyNames: ComputedRef<Set<string>>
  saveAssetRecord: (input: AiopsAssetInput, options?: { requireGroups?: boolean }) => Promise<AssetsPanelAsset>
  closeAssetContextMenus: () => void
  importNotice: Ref<string>
}

export const createAssetsPanelHostFormRuntime = ({
  workspace,
  activeAssetView,
  selectedAssetId,
  assets,
  pendingHostDraftReturn,
  configuredSshProxyNames,
  saveAssetRecord,
  closeAssetContextMenus,
  importNotice
}: AssetsPanelHostFormRuntimeInput) => {
  const editorOpen = ref(false)
  const editMode = ref(false)
  const assetFormError = ref('')
  const assetTestLoading = ref(false)
  const assetTestMessage = ref('')
  const assetTestOk = ref(false)
  const assetPasswordVisible = ref(false)
  let assetSecretRequestId = 0
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

  const jumpHostOptions = computed(() => assets.value.filter((asset) => asset.asset_type === 'person' && asset.id !== form.id))

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

  const openOnboardingCreatePanel = () => {
    activeAssetView.value = 'assetConfig'
    editMode.value = false
    resetForm()
    editorOpen.value = true
    closeAssetContextMenus()
  }

  const resolveConfiguredSshProxyName = (proxyName?: string) => {
    const name = String(proxyName || '').trim()
    return name && configuredSshProxyNames.value.has(name) ? name : ''
  }

  const resolveAssetProxyName = (asset: AssetsPanelAsset) => (asset.needProxy ? resolveConfiguredSshProxyName(asset.proxyName) : '')

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

  const validateConfiguredProxy = () => {
    if (form.proxyName && !configuredSshProxyNames.value.has(form.proxyName)) {
      form.proxyName = ''
    }
  }

  return {
    editorOpen,
    editMode,
    assetFormError,
    assetTestLoading,
    assetTestMessage,
    assetTestOk,
    assetPasswordVisible,
    form,
    jumpHostOptions,
    resetForm,
    openNewPanel,
    openNewPanelFromContext,
    closeAssetEditor,
    openOnboardingCreatePanel,
    closeProxyModal,
    openProxyAddPanel,
    saveProxyFormFromAssetPanel,
    openJumpHostCreateFromHostForm,
    editAsset,
    cloneAsset,
    testAssetFormConnection,
    submitForm,
    validateConfiguredProxy
  }
}
