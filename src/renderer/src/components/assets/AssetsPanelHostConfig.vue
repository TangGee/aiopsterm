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
    </div>
  </div>

  <div
    v-if="editorOpen"
    class="asset-host-modal file-modal"
  >
    <aside
      class="asset-form-panel asset-host-form-modal"
      :data-onboarding-id="editorOpen ? 'asset-form-fields' : undefined"
    >
      <template v-if="editorOpen">
        <header>
          <strong>{{ editMode ? '编辑主机' : '新建主机' }}</strong>
          <button
            title="关闭"
            @click="closeAssetEditor"
          >
            <X />
          </button>
        </header>
        <label>
          <span>设备类型</span>
          <select v-model="form.asset_type">
            <option value="person">服务器</option>
            <option value="switch">交换机</option>
            <option value="organization">堡垒机</option>
          </select>
        </label>
        <label v-if="form.asset_type === 'organization'">
          <span>堡垒机类型</span>
          <select v-model="form.bastionType">
            <option value="jumpserver">JumpServer</option>
            <option value="teleport">Teleport</option>
          </select>
        </label>
        <label v-if="form.asset_type === 'switch'">
          <span>交换机品牌</span>
          <select v-model="form.switchBrand">
            <option value="cisco">Cisco</option>
            <option value="huawei">Huawei</option>
          </select>
        </label>
        <label>
          <span>主机名</span>
          <input v-model="form.title" />
        </label>
        <label>
          <span>地址</span>
          <input v-model="form.host" />
        </label>
        <label>
          <span>认证方式</span>
          <select v-model="form.auth_type">
            <option value="password">密码</option>
            <option value="keyBased">密钥</option>
          </select>
        </label>
        <label>
          <span>用户名</span>
          <input v-model="form.username" />
        </label>
        <label v-if="form.auth_type === 'password'">
          <span>密码</span>
          <div class="asset-secret-field">
            <input
              v-model="form.password"
              :type="assetPasswordVisible ? 'text' : 'password'"
              :placeholder="editMode ? '清空将删除已保存密码' : ''"
              autocomplete="new-password"
            />
            <button
              type="button"
              class="asset-secret-toggle"
              :title="assetPasswordVisible ? '隐藏密码' : '显示密码'"
              @click="assetPasswordVisible = !assetPasswordVisible"
            >
              <EyeOff v-if="assetPasswordVisible" />
              <Eye v-else />
            </button>
          </div>
        </label>
        <label v-else>
          <span class="asset-field-heading">
            密钥链
            <button
              type="button"
              @click="openKeyCreateFromHostForm"
            >
              新建密钥
            </button>
          </span>
          <select v-model="form.keyId">
            <option value="">请选择密钥</option>
            <option
              v-for="key in keychains"
              :key="key.id"
              :value="key.id"
            >
              {{ key.name }}
            </option>
          </select>
        </label>
        <label>
          <span>分组</span>
          <input
            v-model="form.group"
            list="asset-host-group-options"
          />
          <datalist id="asset-host-group-options">
            <option
              v-for="group in assetGroupOptions"
              :key="group.key"
              :value="group.name"
            />
          </datalist>
        </label>
        <label>
          <span>端口</span>
          <input
            v-model.number="form.port"
            type="number"
          />
        </label>
        <label>
          <span class="asset-field-heading">
            代理
            <button
              type="button"
              @click="openProxyAddPanel(true)"
            >
              新增代理
            </button>
          </span>
          <select
            v-if="sshProxyOptions.length"
            v-model="form.proxyName"
            data-testid="asset-proxy-select"
          >
            <option value="">不使用代理</option>
            <option
              v-for="proxy in sshProxyOptions"
              :key="proxy.name"
              :value="proxy.name"
            >
              {{ proxy.name }}
            </option>
          </select>
          <div
            v-else
            class="asset-proxy-empty"
          >
            <small>暂无 SSH 代理配置</small>
            <button
              type="button"
              @click="openProxyAddPanel(true)"
            >
              新增代理
            </button>
          </div>
        </label>
        <label>
          <span class="asset-field-heading">
            跳板机
            <button
              type="button"
              @click="openJumpHostCreateFromHostForm"
            >
              新建跳板机
            </button>
          </span>
          <select v-model="form.jumpHostId">
            <option value="">不使用跳板机</option>
            <option
              v-for="asset in jumpHostOptions"
              :key="asset.id"
              :value="asset.id"
            >
              {{ asset.title }} ({{ asset.username }}@{{ asset.host }}:{{ asset.port }})
            </option>
          </select>
        </label>
        <div class="asset-form-actions">
          <button
            class="asset-submit-button secondary"
            data-testid="asset-test-connection"
            :disabled="assetTestLoading"
            @click="testAssetFormConnection"
          >
            {{ assetTestLoading ? '测试中' : '测试连接' }}
          </button>
          <button
            class="asset-submit-button"
            data-onboarding-id="asset-form-submit"
            @click="submitForm"
          >
            保存
          </button>
        </div>
        <small
          v-if="assetTestMessage"
          class="asset-form-error asset-connection-test-result"
          :class="{ success: assetTestOk }"
        >
          {{ assetTestMessage }}
        </small>
        <small
          v-if="assetFormError"
          class="asset-form-error"
        >
          {{ assetFormError }}
        </small>
      </template>
    </aside>
  </div>
</template>

<script setup lang="ts">
import {
  CircleHelp,
  Copy,
  Database,
  Download,
  Eye,
  EyeOff,
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
import AssetTreeGroupNode from '@/components/assets/AssetTreeGroupNode.vue'
import { useAssetsPanelRuntimeContext } from '@/services/assetsPanelContext'

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
</script>
