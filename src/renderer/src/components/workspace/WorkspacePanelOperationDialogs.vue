<template>
  <div
    v-if="tunnelModal.visible && tunnelAsset"
    class="files-folder-modal-backdrop"
  >
    <section class="files-folder-modal workspace-tunnel-modal">
      <header>
        <h3>隧道 · {{ tunnelAsset.name }}</h3>
        <button
          type="button"
          @click="closeTunnelModal"
        >
          <X />
        </button>
      </header>
      <form
        class="workspace-tunnel-form files-folder-form"
        @submit.prevent="startTunnelFromModal"
      >
        <div class="workspace-tunnel-type-grid">
          <label
            v-for="option in tunnelTypeOptions"
            :key="option.value"
            class="workspace-tunnel-type-card"
            :class="{ selected: tunnelForm.type === option.value }"
          >
            <input
              v-model="tunnelForm.type"
              type="radio"
              name="workspace-tunnel-type"
              :value="option.value"
            />
            <span>{{ option.label }}</span>
            <small>{{ option.description }}</small>
          </label>
        </div>
        <label>
          <span>{{ tunnelForm.type === 'remote_forward' ? '本地服务端口 *' : '本地监听端口 *' }}</span>
          <input
            v-model="tunnelForm.localPort"
            data-testid="workspace-tunnel-local-port"
            inputmode="numeric"
            placeholder="3306"
          />
        </label>
        <label v-if="tunnelForm.type !== 'dynamic_socks'">
          <span>远端主机</span>
          <input
            v-model="tunnelForm.remoteHost"
            data-testid="workspace-tunnel-remote-host"
            placeholder="localhost"
          />
        </label>
        <label v-if="tunnelForm.type !== 'dynamic_socks'">
          <span>{{ tunnelForm.type === 'remote_forward' ? '远端监听端口 *' : '远端服务端口 *' }}</span>
          <input
            v-model="tunnelForm.remotePort"
            data-testid="workspace-tunnel-remote-port"
            inputmode="numeric"
            placeholder="3306"
          />
        </label>
        <p
          v-if="tunnelFormError"
          class="files-folder-error"
        >
          {{ tunnelFormError }}
        </p>
        <footer>
          <button
            type="button"
            @click="closeTunnelModal"
          >
            取消
          </button>
          <button
            type="submit"
            class="primary"
            :disabled="tunnelSubmitting"
          >
            {{ tunnelSubmitting ? '启动中' : '启动隧道' }}
          </button>
        </footer>
      </form>
    </section>
  </div>

  <div
    v-if="deleteAssetModal.visible && deleteAssetInfo"
    class="files-folder-modal-backdrop"
  >
    <section class="files-folder-modal files-folder-confirm workspace-folder-modal">
      <header>
        <h3>删除主机</h3>
        <button
          type="button"
          @click="closeDeleteAssetModal"
        >
          <X />
        </button>
      </header>
      <div class="files-folder-confirm-body">
        <p>确定删除主机 {{ deleteAssetInfo.name }}？该主机将从当前工作区资源树移除。</p>
      </div>
      <footer>
        <button
          type="button"
          @click="closeDeleteAssetModal"
        >
          取消
        </button>
        <button
          type="button"
          class="danger"
          @click="confirmDeleteAsset"
        >
          删除
        </button>
      </footer>
    </section>
  </div>

  <div
    v-if="managementModal.visible && managedOrganization"
    class="files-folder-modal-backdrop"
  >
    <section class="files-folder-modal workspace-management-modal">
      <header>
        <h3>管理资产 · {{ managedOrganization.name }}</h3>
        <button
          type="button"
          @click="closeManagementModal"
        >
          <X />
        </button>
      </header>
      <div class="workspace-management-body">
        <div class="workspace-management-toolbar">
          <div class="workspace-search">
            <input
              v-model="managementModal.query"
              placeholder="搜索资产"
            />
            <Search />
          </div>
          <button
            class="workspace-button"
            :title="refreshingGroupKey === managedOrganization.uuid ? '刷新中' : '刷新'"
            @click="refreshGroup(managedOrganization.uuid)"
          >
            <RefreshCw :class="{ spinning: refreshingGroupKey === managedOrganization.uuid }" />
          </button>
        </div>
        <div class="workspace-management-list">
          <div
            v-for="asset in managedOrganizationAssets"
            :key="asset.id"
            class="workspace-management-row"
          >
            <span>
              <strong>{{ asset.name }}</strong>
              <small>{{ asset.host }} · {{ asset.username }}:{{ asset.port }}</small>
            </span>
            <em>{{ folderNameByUuid(asset.folderUuid) || asset.comment || '未分组' }}</em>
            <button
              v-if="!asset.folderUuid"
              @click="openMoveModal(asset.id)"
            >
              移动
            </button>
            <button
              v-else
              @click="removeAssetFromFolder(asset.id)"
            >
              移除
            </button>
          </div>
          <div
            v-if="managedOrganizationAssets.length === 0"
            class="workspace-management-empty"
          >
            暂无资产
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { RefreshCw, Search, X } from 'lucide-vue-next'
import { useWorkspacePanelRuntimeContext } from '@/services/workspace/workspacePanelContext'

const {
  refreshingGroupKey,
  deleteAssetModal,
  managementModal,
  tunnelModal,
  tunnelForm,
  tunnelFormError,
  tunnelSubmitting,
  tunnelAsset,
  tunnelTypeOptions,
  deleteAssetInfo,
  managedOrganization,
  managedOrganizationAssets,
  closeTunnelModal,
  closeDeleteAssetModal,
  closeManagementModal,
  folderNameByUuid,
  startTunnelFromModal,
  openMoveModal,
  removeAssetFromFolder,
  refreshGroup,
  confirmDeleteAsset
} = useWorkspacePanelRuntimeContext()
</script>
