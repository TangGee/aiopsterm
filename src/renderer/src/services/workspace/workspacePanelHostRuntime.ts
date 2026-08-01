import { computed, reactive, ref, type ComputedRef, type Ref } from 'vue'

import type {
  AiopsAssetAuthType,
  AiopsAssetInput,
  AiopsAssetType,
  AiopsKeychainRecord
} from '@shared/contracts/assets'
import type { useWorkspaceStore } from '@/stores/workspace'
import { assetsClient } from '@/services/assets/assetsClient'
import { isAiopsAssetConnectionTestInfo, malformedAssetBackendResultMessage } from '@/services/assets/assetBackendGuards'
import { createAssetKeyEditorRuntime } from '@/services/assets/assetKeyEditorRuntime'
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
    jumpHostId: '',
    bastionType: 'jumpserver' as string,
    jumpserverApiUrl: '',
    jumpserverToken: '',
    jumpserverOrgId: ''
  })
  const hostFormError = ref('')
  const hostTestLoading = ref(false)
  const hostTestMessage = ref('')
  const hostTestOk = ref(false)
  const hostPasswordVisible = ref(false)
  const hostJumpPasswordVisible = ref(false)
  let hostSecretRequestId = 0
  const hostChildModal = ref<'' | 'proxy' | 'jumpHost'>('')
  const hostChildFormError = ref('')
  const hostKeyServiceNotice = ref('')
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
  const hostKeyEditorRuntime = createAssetKeyEditorRuntime({
    keychains: keychainOptions,
    serviceNotice: hostKeyServiceNotice,
    refreshKeychains: loadKeychainOptions,
    onSaved: (saved) => {
      hostForm.authType = 'keyBased'
      hostForm.keychainId = saved.id
    }
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

  const closeHostChildModal = () => {
    hostChildModal.value = ''
    hostChildFormError.value = ''
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
    hostForm.bastionType = 'jumpserver'
    hostForm.jumpserverApiUrl = ''
    hostForm.jumpserverToken = ''
    hostForm.jumpserverOrgId = ''
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
    hostForm.jumpserverApiUrl = ''
    hostForm.jumpserverToken = ''
    hostForm.jumpserverOrgId = ''
    hostFormError.value = ''
    closeHostChildModal()
    hostKeyEditorRuntime.closeKeyEditor()
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
      hostForm.jumpserverToken = result.data?.jumpserverToken || ''
    } catch {
      if (requestId === hostSecretRequestId && hostModal.assetId === assetId) {
        hostForm.password = ''
        hostForm.jumpserverToken = ''
      }
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
    hostForm.bastionType = asset?.bastionType || 'jumpserver'
    hostForm.jumpserverApiUrl = asset?.jumpserverApiUrl || ''
    hostForm.jumpserverToken = ''
    hostForm.jumpserverOrgId = asset?.jumpserverOrgId || ''
    hostFormError.value = ''
    resetHostConnectionTest()
    closeContextMenu()
    if ((mode === 'edit' || mode === 'clone') && asset?.id && (hostForm.authType === 'password' || asset.asset_type === 'organization')) {
      void loadHostEditablePassword(secretRequestId, asset.id)
    }
  }

  const openKeyManagementFromHostForm = () => {
    hostKeyEditorRuntime.openNewKeyPanel()
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
      tags: hostForm.assetType === 'organization' ? [hostForm.bastionType] : ['ssh'],
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
      bastionType: hostForm.assetType === 'organization' ? hostForm.bastionType : undefined,
      jumpserverApiUrl: hostForm.assetType === 'organization' ? hostForm.jumpserverApiUrl.trim() : undefined,
      jumpserverOrgId: hostForm.assetType === 'organization' ? hostForm.jumpserverOrgId.trim() : undefined,
      ...(hostForm.assetType === 'organization' && hostForm.bastionType === 'jumpserver'
        ? { jumpserverToken: hostForm.jumpserverToken }
        : {}),
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
    if (hostForm.assetType === 'organization' && hostForm.bastionType === 'jumpserver') {
      if (!hostForm.jumpserverApiUrl.trim()) {
        hostFormError.value = '请填写 JumpServer API 地址'
        return
      }
      if (!hostForm.jumpserverToken.trim()) {
        hostFormError.value = '请填写 JumpServer Private Token'
        return
      }
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
    hostKeyEditorRuntime,
    hostJumpForm,
    jumpHostOptions,
    hostModalTitle,
    saveHostProxyForm,
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
