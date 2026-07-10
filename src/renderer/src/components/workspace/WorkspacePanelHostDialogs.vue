<template>
  <Teleport to="body">
    <AssetHostFormDialog
      :visible="hostModal.visible"
      :title="hostModalTitle"
      :asset-type="hostForm.assetType"
      :host-title="hostForm.title"
      :host="hostForm.host"
      :auth-type="hostForm.authType"
      :username="hostForm.username"
      :password="hostForm.password"
      :password-visible="hostPasswordVisible"
      :password-placeholder="hostModal.mode === 'create' ? '' : '清空将删除已保存密码'"
      :port="hostForm.port"
      :keychain-id="hostForm.keychainId"
      :proxy-name="hostForm.proxyName"
      :jump-host-id="hostForm.jumpHostId"
      :group="hostForm.group"
      :comment="hostForm.comment"
      :error="hostFormError"
      :test-loading="hostTestLoading"
      :test-message="hostTestMessage"
      :test-ok="hostTestOk"
      :keychain-options="keychainOptions"
      :group-options="hostGroupOptions"
      :proxy-options="workspaceProxyOptions"
      :jump-host-options="workspaceJumpHostOptions"
      :show-group="hostModal.mode !== 'create'"
      show-comment
      group-datalist-id="workspace-host-group-options"
      test-connection-test-id="workspace-host-test-connection"
      @close="closeHostModal"
      @submit="saveHostForm"
      @test-connection="testHostFormConnection"
      @toggle-password="hostPasswordVisible = !hostPasswordVisible"
      @create-keychain="openKeyManagementFromHostForm"
      @create-proxy="openProxyManagementFromHostForm"
      @create-jump-host="openJumpHostCreateFromHostForm"
      @field-change="updateWorkspaceHostField"
    />
  </Teleport>

  <WorkspaceHostProxyChildDialog />
  <WorkspaceHostKeyChildDialog />
  <WorkspaceHostJumpChildDialog />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { AiopsAssetAuthType, AiopsAssetType } from '@shared/contracts/assets'
import AssetHostFormDialog, { type AssetHostFormField } from '@/components/assets/AssetHostFormDialog.vue'
import WorkspaceHostJumpChildDialog from '@/components/workspace/WorkspaceHostJumpChildDialog.vue'
import WorkspaceHostKeyChildDialog from '@/components/workspace/WorkspaceHostKeyChildDialog.vue'
import WorkspaceHostProxyChildDialog from '@/components/workspace/WorkspaceHostProxyChildDialog.vue'
import { useWorkspacePanelRuntimeContext } from '@/services/workspace/workspacePanelContext'

const {
  workspace,
  keychainOptions,
  hostModal,
  hostForm,
  hostFormError,
  hostTestLoading,
  hostTestMessage,
  hostTestOk,
  hostPasswordVisible,
  hostGroupOptions,
  jumpHostOptions,
  hostModalTitle,
  closeHostModal,
  openKeyManagementFromHostForm,
  openProxyManagementFromHostForm,
  openJumpHostCreateFromHostForm,
  testHostFormConnection,
  saveHostForm
} = useWorkspacePanelRuntimeContext()

const workspaceProxyOptions = computed(() =>
  workspace.sshProxyConfigs
    .map((proxy) => ({
      id: proxy.name,
      name: proxy.name
    }))
    .filter((proxy) => proxy.name)
)

const workspaceJumpHostOptions = computed(() =>
  jumpHostOptions.value.map((jumpHost) => ({
    id: jumpHost.id,
    name: jumpHost.name
  }))
)

const updateWorkspaceHostField = (field: AssetHostFormField, value: string | number) => {
  switch (field) {
    case 'assetType':
      hostForm.assetType = String(value) as AiopsAssetType
      break
    case 'hostTitle':
      hostForm.title = String(value)
      break
    case 'host':
      hostForm.host = String(value)
      break
    case 'authType':
      hostForm.authType = String(value) as AiopsAssetAuthType
      break
    case 'username':
      hostForm.username = String(value)
      break
    case 'password':
      hostForm.password = String(value)
      break
    case 'port':
      hostForm.port = String(value)
      break
    case 'keychainId':
      hostForm.keychainId = String(value)
      break
    case 'proxyName':
      hostForm.proxyName = String(value)
      break
    case 'jumpHostId':
      hostForm.jumpHostId = String(value)
      break
    case 'group':
      hostForm.group = String(value)
      break
    case 'comment':
      hostForm.comment = String(value)
      break
    case 'bastionType':
    case 'switchBrand':
      break
  }
}
</script>
