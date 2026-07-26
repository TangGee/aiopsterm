<template>
  <div class="asset-config-container">
    <div class="asset-config-main">
      <div class="asset-search-container">
        <div class="asset-search-row">
          <div class="asset-search-input">
            <input
              v-model="assetQuery"
              placeholder="搜索"
            />
            <button
              v-if="assetQuery"
              class="asset-search-clear"
              title="清空搜索"
              @click="assetQuery = ''"
            >
              <X />
            </button>
            <Search />
          </div>
          <button
            class="asset-action-button"
            title="支持 external-reference.json、CSV、XSH/XTS、INI/XML、MXTSESSIONS 导入。"
            @click="openImportDialog"
          >
            <Import />
            导入
          </button>
          <button
            class="asset-action-button icon-only"
            title="导入帮助"
            @click="importHelpOpen = true"
          >
            <CircleHelp />
          </button>
          <button
            class="asset-action-button"
            @click="openExportModal"
          >
            <Download />
            导出
          </button>
        </div>
      </div>

      <div class="asset-list-container">
        <div
          class="asset-host-tree"
          @contextmenu.prevent="openAssetBlankContextMenu"
        >
          <AssetTreeGroupNode
            v-for="group in filteredAssetGroups"
            :key="group.key"
            :group="group"
            :level="0"
            :expanded-keys="expandedAssetGroupKeys"
            :force-expanded="Boolean(assetQuery.trim())"
            :selected-asset-id="selectedAssetId || ''"
            :first-asset-id="flatFilteredAssets[0]?.id || ''"
            @toggle="toggleAssetGroup"
            @select-asset="selectedAssetId = $event"
            @connect-asset="connectAsset"
            @edit-asset="editAsset"
            @remove-asset="removeAsset"
            @group-context="openAssetGroupContextMenu"
            @asset-context="openAssetContextMenu"
          />
        </div>

        <div
          v-if="filteredAssetGroups.length === 0"
          class="asset-empty-state"
          @contextmenu.prevent="openAssetBlankContextMenu"
        >
          <Laptop />
          <strong>{{ assetQuery ? '没有搜索结果' : '暂无资产' }}</strong>
          <small v-if="!assetQuery">右键树区域新建主机，或导入已有会话。</small>
          <div v-if="!assetQuery">
            <button @click="openNewPanel()">新建主机</button>
            <button @click="openImportDialog">导入</button>
          </div>
        </div>
      </div>

      <Teleport to="body">
        <div
          v-if="assetBlankContextMenuOpen"
          class="asset-context-menu"
          :style="{ left: `${contextPosition.x}px`, top: `${contextPosition.y}px` }"
        >
          <button @click="openCreateAssetFolderFromContext()">
            <Folder />
            新建目录
          </button>
          <button @click="openNewPanelFromContext()">
            <Laptop />
            新建主机
          </button>
        </div>

        <div
          v-if="assetGroupContextMenuKey"
          class="asset-context-menu"
          :style="{ left: `${contextPosition.x}px`, top: `${contextPosition.y}px` }"
        >
          <button @click="openCreateAssetFolderFromContext(assetGroupContextMenuKey)">
            <Folder />
            新建子目录
          </button>
          <button @click="openNewPanelFromContext(assetGroupContextMenuKey)">
            <Laptop />
            新建主机
          </button>
        </div>

        <div
          v-if="assetContextMenuId"
          class="asset-context-menu"
          :style="{ left: `${contextPosition.x}px`, top: `${contextPosition.y}px` }"
        >
          <button @click="connectAsset(assetContextMenuId)">
            <PlugZap />
            连接
          </button>
          <button @click="editAsset(assetContextMenuId)">
            <Pencil />
            编辑
          </button>
          <button @click="cloneAsset(assetContextMenuId)">
            <Copy />
            克隆
          </button>
          <button
            v-if="contextAsset?.asset_type === 'organization'"
            @click="refreshOrganizationAsset"
          >
            <RefreshCw />
            刷新资产
          </button>
          <button
            v-if="contextAsset?.asset_type === 'organization'"
            @click="openOrganizationManagement"
          >
            <Database />
            管理资产
          </button>
          <button
            class="delete"
            @click="removeAsset(assetContextMenuId)"
          >
            <Trash2 />
            删除
          </button>
        </div>
      </Teleport>
    </div>
  </div>

  <Teleport to="body">
    <AssetHostFormDialog
      :visible="editorOpen"
      :title="editMode ? t('assets.hostConfig.editHostTitle') : t('assets.hostConfig.newHostTitle')"
      :asset-type="form.asset_type"
      :host-title="form.title"
      :host="form.host"
      :auth-type="form.auth_type"
      :username="form.username"
      :password="form.password"
      :password-visible="assetPasswordVisible"
      :password-placeholder="editMode ? '清空将删除已保存密码' : ''"
      :port="form.port"
      :keychain-id="form.keyId"
      :proxy-name="form.proxyName"
      :jump-host-id="form.jumpHostId"
      :group="form.group"
      :bastion-type="form.bastionType"
      :jumpserver-api-url="form.jumpserverApiUrl"
      :jumpserver-token="form.jumpserverToken"
      :jumpserver-org-id="form.jumpserverOrgId"
      :jumpserver-token-placeholder="editMode ? '填写已保存的 Private Token' : ''"
      :switch-brand="form.switchBrand"
      :error="assetFormError"
      :test-loading="assetTestLoading"
      :test-message="assetTestMessage"
      :test-ok="assetTestOk"
      :keychain-options="keychains"
      :group-options="assetGroupOptions"
      :proxy-options="assetProxyOptions"
      :jump-host-options="assetJumpHostOptions"
      :show-bastion-type="form.asset_type === 'organization'"
      :show-switch-brand="form.asset_type === 'switch'"
      show-group
      show-empty-jump-host-select
      group-datalist-id="asset-host-group-options"
      keychain-label="密钥链"
      empty-keychain-label="请选择密钥"
      empty-proxy-action-label="新增代理"
      jump-host-label="跳板机"
      port-input-type="number"
      test-connection-test-id="asset-test-connection"
      proxy-test-id="asset-proxy-select"
      :onboarding-id="editorOpen ? 'asset-form-fields' : undefined"
      submit-onboarding-id="asset-form-submit"
      @close="closeAssetEditor"
      @submit="submitAssetHostForm"
      @test-connection="testAssetHostConnection"
      @toggle-password="assetPasswordVisible = !assetPasswordVisible"
      @create-keychain="openAssetHostKeyCreate"
      @create-proxy="openAssetHostProxyAdd"
      @create-jump-host="openAssetHostJumpHostCreate"
      @field-change="updateAssetHostField"
    />
  </Teleport>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import type { AiopsAssetAuthType, AiopsAssetType } from '@shared/contracts/assets'
import {
  CircleHelp,
  Copy,
  Database,
  Download,
  Folder,
  Import,
  Laptop,
  Pencil,
  PlugZap,
  RefreshCw,
  Search,
  Trash2,
  X
} from 'lucide-vue-next'
import AssetHostFormDialog, { type AssetHostFormField } from '@/components/assets/AssetHostFormDialog.vue'
import AssetTreeGroupNode from '@/components/assets/AssetTreeGroupNode.vue'
import { useAssetsPanelRuntimeContext } from '@/services/assets/assetsPanelContext'
import { useI18n } from '@/i18n'

const { t } = useI18n()

const {
  assetQuery,
  editorOpen,
  editMode,
  selectedAssetId,
  assetContextMenuId,
  assetBlankContextMenuOpen,
  assetGroupContextMenuKey,
  contextPosition,
  importHelpOpen,
  assetFormError,
  assetTestLoading,
  assetTestMessage,
  assetTestOk,
  assetPasswordVisible,
  form,
  keychains,
  assetGroupOptions,
  expandedAssetGroupKeys,
  filteredAssetGroups,
  flatFilteredAssets,
  contextAsset,
  jumpHostOptions,
  sshProxyOptions,
  toggleAssetGroup,
  openNewPanel,
  openNewPanelFromContext,
  closeAssetEditor,
  openCreateAssetFolderFromContext,
  openProxyAddPanel,
  openKeyCreateFromHostForm,
  openJumpHostCreateFromHostForm,
  editAsset,
  cloneAsset,
  removeAsset,
  connectAsset,
  openAssetContextMenu,
  openAssetBlankContextMenu,
  openAssetGroupContextMenu,
  testAssetFormConnection,
  submitForm,
  refreshOrganizationAsset,
  openOrganizationManagement,
  openImportDialog,
  openExportModal
} = useAssetsPanelRuntimeContext()

const assetJumpHostOptions = computed(() =>
  jumpHostOptions.value.map((asset) => ({
    id: asset.id,
    name: asset.title,
    label: `${asset.title} (${asset.username}@${asset.host}:${asset.port})`
  }))
)

const assetProxyOptions = computed(() =>
  sshProxyOptions.value.map((proxy) => ({
    id: proxy.name,
    name: proxy.name
  }))
)

type AssetHostDraft = Partial<{
  asset_type: AiopsAssetType
  title: string
  host: string
  auth_type: AiopsAssetAuthType
  username: string
  password: string
  port: number
  keyId: string
  proxyName: string
  jumpHostId: string
  group: string
  bastionType: string
  jumpserverApiUrl: string
  jumpserverToken: string
  jumpserverOrgId: string
  switchBrand: string
}>

const assetHostDraft: AssetHostDraft = {}

const resetAssetHostDraft = () => {
  for (const key of Object.keys(assetHostDraft) as Array<keyof AssetHostDraft>) {
    delete assetHostDraft[key]
  }
}

watch(
  editorOpen,
  (open) => {
    if (open) resetAssetHostDraft()
  },
  { flush: 'sync' }
)

const syncAssetHostDraft = () => {
  Object.assign(form, assetHostDraft)
}

const updateAssetHostField = (field: AssetHostFormField, value: string | number) => {
  switch (field) {
    case 'assetType':
      assetHostDraft.asset_type = String(value) as AiopsAssetType
      form.asset_type = assetHostDraft.asset_type
      break
    case 'hostTitle':
      assetHostDraft.title = String(value)
      break
    case 'host':
      assetHostDraft.host = String(value)
      break
    case 'authType':
      assetHostDraft.auth_type = String(value) as AiopsAssetAuthType
      form.auth_type = assetHostDraft.auth_type
      break
    case 'username':
      assetHostDraft.username = String(value)
      break
    case 'password':
      assetHostDraft.password = String(value)
      break
    case 'port':
      assetHostDraft.port = Number(value)
      break
    case 'keychainId':
      assetHostDraft.keyId = String(value)
      break
    case 'proxyName':
      assetHostDraft.proxyName = String(value)
      break
    case 'jumpHostId':
      assetHostDraft.jumpHostId = String(value)
      break
    case 'group':
      assetHostDraft.group = String(value)
      break
    case 'bastionType':
      assetHostDraft.bastionType = String(value)
      break
    case 'jumpserverApiUrl':
      assetHostDraft.jumpserverApiUrl = String(value)
      break
    case 'jumpserverToken':
      assetHostDraft.jumpserverToken = String(value)
      break
    case 'jumpserverOrgId':
      assetHostDraft.jumpserverOrgId = String(value)
      break
    case 'switchBrand':
      assetHostDraft.switchBrand = String(value)
      break
    case 'comment':
      break
  }
}

const submitAssetHostForm = () => {
  syncAssetHostDraft()
  void submitForm()
}

const testAssetHostConnection = () => {
  syncAssetHostDraft()
  void testAssetFormConnection()
}

const openAssetHostKeyCreate = () => {
  syncAssetHostDraft()
  openKeyCreateFromHostForm()
}

const openAssetHostProxyAdd = () => {
  syncAssetHostDraft()
  openProxyAddPanel(true)
}

const openAssetHostJumpHostCreate = () => {
  syncAssetHostDraft()
  openJumpHostCreateFromHostForm()
  resetAssetHostDraft()
}
</script>
