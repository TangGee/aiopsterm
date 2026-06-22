<template>
  <div class="asset-management-page">
    <div class="asset-management-table-shell">
      <div class="asset-table-toolbar">
        <div class="asset-search-input">
          <input
            v-model="assetManagementQuery"
            placeholder="搜索"
          />
          <button
            v-if="assetManagementQuery"
            class="asset-search-clear"
            title="清空搜索"
            @click="assetManagementQuery = ''"
          >
            <X />
          </button>
          <Search />
        </div>
        <span class="asset-management-context">
          {{ managedOrganizationTitle }}
        </span>
        <button
          class="asset-action-button"
          @click="openCreateAssetFolder(null, 'bastion')"
        >
          <Folder />
          新建目录
        </button>
        <button
          class="asset-action-button"
          @click="openManagedAssetAdd"
        >
          <Database />
          添加资产
        </button>
        <button
          class="asset-action-button"
          :disabled="selectedRows.length === 0"
          @click="confirmBulkDelete"
        >
          批量删除
        </button>
        <button
          class="asset-action-button icon-only"
          title="刷新"
          @click="refreshManagedAssets"
        >
          <RefreshCw />
        </button>
      </div>
      <div class="asset-table-scroll">
        <table>
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  :checked="managedVisibleAllSelected"
                  @change="toggleManagedVisibleSelection(($event.target as HTMLInputElement).checked)"
                />
              </th>
              <th>主机名</th>
              <th>主机 IP</th>
              <th>来源</th>
              <th>备注</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in pagedManagedRows"
              :key="row.key"
              :class="[
                row.kind === 'group' ? 'asset-management-tree-group-row' : 'asset-management-tree-asset-row',
                row.kind === 'asset' && selectedRows.includes(row.asset.id) ? 'selected' : ''
              ]"
            >
              <td v-if="row.kind === 'group'">
                <button
                  class="asset-management-tree-toggle"
                  :style="{ paddingLeft: `${8 + row.depth * 14}px` }"
                  @click="toggleManagedGroup(row.group.key)"
                >
                  <ChevronDown v-if="isManagedGroupExpanded(row.group.key)" />
                  <ChevronRight v-else />
                  <Folder />
                  <span>{{ row.group.title }}</span>
                  <em>{{ assetGroupAssetCount(row.group) }}</em>
                </button>
              </td>
              <td v-else>
                <input
                  v-model="selectedRows"
                  type="checkbox"
                  :value="row.asset.id"
                />
              </td>
              <td v-if="row.kind === 'group'" colspan="5"></td>
              <template v-else>
                <td>
                  <span
                    class="asset-management-tree-title"
                    :style="{ paddingLeft: `${row.depth * 14}px` }"
                  >
                    {{ row.asset.title }}
                  </span>
                </td>
                <td>{{ row.asset.host }}</td>
                <td>
                  <span
                    class="asset-source-tag"
                    :class="row.asset.data_source === 'manual' ? 'manual' : 'refresh'"
                  >
                    {{ row.asset.data_source === 'manual' ? '手动' : '刷新' }}
                  </span>
                </td>
                <td>{{ row.asset.comment }}</td>
                <td>
                  <button @click="openManagedAssetEdit(row.asset.id)">编辑</button>
                  <button @click="removeAsset(row.asset.id)">删除</button>
                </td>
              </template>
            </tr>
          </tbody>
        </table>
        <div
          v-if="pagedManagedRows.length === 0"
          class="asset-empty-state compact"
        >
          <Laptop />
          <strong>{{ assetManagementQuery ? '没有搜索结果' : '暂无资产' }}</strong>
        </div>
      </div>
      <footer class="asset-table-footer">
        <span>共 {{ managedAssets.length }} 条</span>
        <span v-if="selectedRows.length">已选择 {{ selectedRows.length }}</span>
        <label>
          每页
          <select v-model.number="assetManagementPageSize">
            <option :value="50">50</option>
            <option :value="100">100</option>
            <option :value="200">200</option>
          </select>
        </label>
        <button
          :disabled="assetManagementPage <= 1"
          @click="assetManagementPage -= 1"
        >
          上一页
        </button>
        <span>{{ assetManagementPage }} / {{ assetManagementPageCount }}</span>
        <button
          :disabled="assetManagementPage >= assetManagementPageCount"
          @click="assetManagementPage += 1"
        >
          下一页
        </button>
      </footer>
    </div>

    <aside
      class="asset-form-panel managed-asset-form"
      :class="{ collapsed: !managedEditorOpen }"
    >
      <template v-if="managedEditorOpen">
        <header>
          <strong>{{ managedEditMode ? '编辑资产' : '添加资产' }}</strong>
          <button
            title="关闭"
            @click="managedEditorOpen = false"
          >
            <X />
          </button>
        </header>
        <label>
          <span>主机名</span>
          <input
            v-model="managedForm.title"
            :disabled="managedCommentOnly"
          />
        </label>
        <label>
          <span>主机 IP</span>
          <input
            v-model="managedForm.host"
            :disabled="managedCommentOnly"
          />
        </label>
        <label>
          <span>备注</span>
          <textarea v-model="managedForm.comment" />
        </label>
        <small v-if="managedCommentOnly">刷新来源资产只允许编辑备注。</small>
        <button
          class="asset-submit-button"
          @click="submitManagedForm"
        >
          保存资产
        </button>
        <small
          v-if="managedFormError"
          class="asset-form-error"
        >
          {{ managedFormError }}
        </small>
      </template>
    </aside>
  </div>
</template>

<script setup lang="ts">
import {
  ChevronDown,
  ChevronRight,
  Database,
  Folder,
  Laptop,
  RefreshCw,
  Search,
  X
} from 'lucide-vue-next'
import { useAssetsPanelRuntimeContext } from '@/services/assetsPanelContext'

const {
  managedFormError,
  selectedRows,
  managedEditorOpen,
  managedEditMode,
  managedCommentOnly,
  assetManagementQuery,
  assetManagementPage,
  assetManagementPageSize,
  managedForm,
  assetGroupAssetCount,
  managedAssets,
  isManagedGroupExpanded,
  toggleManagedGroup,
  assetManagementPageCount,
  pagedManagedRows,
  managedVisibleAllSelected,
  managedOrganizationTitle,
  openCreateAssetFolder,
  removeAsset,
  confirmBulkDelete,
  toggleManagedVisibleSelection,
  openManagedAssetAdd,
  openManagedAssetEdit,
  submitManagedForm,
  refreshManagedAssets
} = useAssetsPanelRuntimeContext()
</script>
