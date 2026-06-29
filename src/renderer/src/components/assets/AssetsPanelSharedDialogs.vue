<template>
  <Teleport to="body">
    <div
      v-if="workspace.sshProxyAddModalOpen"
      class="asset-host-modal file-modal"
    >
      <aside class="asset-form-panel asset-host-form-modal asset-proxy-form-modal">
        <header>
          <strong>新增代理</strong>
          <button
            title="关闭"
            @click="closeProxyModal"
          >
            <X />
          </button>
        </header>
        <label>
          <span>名称</span>
          <input
            :value="workspace.sshProxyForm.name"
            @input="workspace.updateSshProxyForm({ name: ($event.target as HTMLInputElement).value })"
          />
        </label>
        <label>
          <span>类型</span>
          <select
            :value="workspace.sshProxyForm.type"
            @change="workspace.updateSshProxyForm({ type: ($event.target as HTMLSelectElement).value as any })"
          >
            <option value="HTTP">HTTP</option>
            <option value="HTTPS">HTTPS</option>
            <option value="SOCKS4">SOCKS4</option>
            <option value="SOCKS5">SOCKS5</option>
            <option value="TCP">TCP</option>
          </select>
        </label>
        <label>
          <span>主机</span>
          <input
            :value="workspace.sshProxyForm.host"
            @input="workspace.updateSshProxyForm({ host: ($event.target as HTMLInputElement).value })"
          />
        </label>
        <label class="asset-proxy-port-field">
          <span>端口</span>
          <input
            type="number"
            :value="workspace.sshProxyForm.port"
            @input="workspace.updateSshProxyForm({ port: Number(($event.target as HTMLInputElement).value) })"
          />
        </label>
        <label class="asset-inline-check asset-form-wide">
          <input
            type="checkbox"
            :checked="workspace.sshProxyForm.enableProxyIdentity"
            @change="workspace.updateSshProxyForm({ enableProxyIdentity: ($event.target as HTMLInputElement).checked })"
          />
          <span>需要代理认证</span>
        </label>
        <template v-if="workspace.sshProxyForm.enableProxyIdentity">
          <label>
            <span>用户名</span>
            <input
              :value="workspace.sshProxyForm.username"
              @input="workspace.updateSshProxyForm({ username: ($event.target as HTMLInputElement).value })"
            />
          </label>
          <label>
            <span>密码</span>
            <input
              type="password"
              :value="workspace.sshProxyForm.password"
              @input="workspace.updateSshProxyForm({ password: ($event.target as HTMLInputElement).value })"
            />
          </label>
        </template>
        <small
          v-if="workspace.settingsNotice"
          class="asset-form-error asset-form-wide"
        >
          {{ workspace.settingsNotice }}
        </small>
        <div class="asset-form-actions asset-form-wide">
          <button
            class="asset-submit-button secondary"
            @click="closeProxyModal"
          >
            取消
          </button>
          <button
            class="asset-submit-button"
            @click="saveProxyFormFromAssetPanel"
          >
            保存
          </button>
        </div>
      </aside>
    </div>

    <div
      v-if="importHelpOpen"
      class="asset-host-modal file-modal"
    >
      <aside class="asset-form-panel asset-host-form-modal asset-import-help-modal">
        <header>
          <strong>导入说明</strong>
          <button
            title="关闭"
            @click="importHelpOpen = false"
          >
            <X />
          </button>
        </header>
        <div class="asset-import-help-content">
          <p>支持 external-reference.json、CSV、XSH/XTS、INI/XML、MXTSESSIONS 等会话文件。</p>
          <p>CSV 建议包含 username、ip、password、label、group_name、auth_type、port 字段；缺失字段会在预览阶段提示。</p>
          <p>点击导入后先打开预览确认，确认前不会写入资产库。</p>
        </div>
        <div class="asset-form-actions">
          <button
            class="asset-submit-button"
            @click="importHelpOpen = false"
          >
            知道了
          </button>
        </div>
      </aside>
    </div>

    <div
      v-if="exportModalOpen"
      class="export-assets-modal"
    >
      <div>
        <header>
          <strong>选择导出主机</strong>
          <button @click="exportModalOpen = false">
            <X />
          </button>
        </header>
        <p>选择要导出的主机，导出文件名使用 external-reference-assets-YYYY-MM-DD.json。</p>
        <div class="asset-search-input export-search">
          <input
            v-model="exportQuery"
            placeholder="搜索主机"
          />
          <Search />
        </div>
        <div class="export-tree">
          <div
            v-for="group in filteredExportGroups"
            :key="group.key"
            class="export-tree-group"
          >
            <label class="export-group-row">
              <input
                type="checkbox"
                :checked="isExportGroupChecked(group.children)"
                @change="toggleExportGroup(group.children, ($event.target as HTMLInputElement).checked)"
              />
              <strong>{{ group.title }}</strong>
              <small>{{ group.children.length }}</small>
            </label>
            <label
              v-for="asset in group.children"
              :key="asset.id"
              class="export-leaf-row"
            >
              <input
                v-model="exportCheckedIds"
                type="checkbox"
                :value="asset.id"
              />
              <span>{{ asset.title }} · {{ asset.host }}</span>
            </label>
          </div>
          <div
            v-if="filteredExportGroups.length === 0"
            class="export-modal-empty"
          >
            没有可导出的主机
          </div>
        </div>
        <footer>
          <span>已选择 {{ resolvedExportIds.length }}</span>
          <button @click="selectAllExportKeys">全选</button>
          <button @click="exportCheckedIds = []">清空</button>
          <button
            :disabled="resolvedExportIds.length === 0"
            @click="confirmExport"
          >
            确认
          </button>
        </footer>
      </div>
    </div>

    <div
      v-if="importPreviewOpen"
      class="export-assets-modal import-assets-modal"
    >
      <div>
        <header>
          <strong>导入主机预览</strong>
          <button @click="closeImportPreview">
            <X />
          </button>
        </header>
        <p>{{ importPreviewSummary }}</p>
        <div class="asset-table-scroll import-preview-table">
          <table>
            <thead>
              <tr>
                <th>主机名</th>
                <th>地址</th>
                <th>用户名</th>
                <th>分组</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="item in importPreviewAssets"
                :key="item.previewId"
                :class="{ duplicate: item.duplicateId }"
              >
                <td>{{ item.title }}</td>
                <td>{{ item.host }}</td>
                <td>{{ item.username }}</td>
                <td>{{ item.group }}</td>
                <td>{{ item.duplicateId ? '重复' : '新增' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <footer>
          <span>可导入 {{ importPreviewAssets.length }}</span>
          <button @click="closeImportPreview">取消</button>
          <button
            v-if="importDuplicateCount"
            @click="confirmImportAssets(false)"
          >
            跳过重复
          </button>
          <button @click="confirmImportAssets(true)">
            {{ importDuplicateCount ? '覆盖导入' : '确认导入' }}
          </button>
        </footer>
      </div>
    </div>

    <div
      v-if="confirmState.open"
      class="asset-confirm-modal"
    >
      <div>
        <header>
          <strong>{{ confirmState.title }}</strong>
          <button @click="closeConfirm">
            <X />
          </button>
        </header>
        <p>{{ confirmState.message }}</p>
        <label v-if="confirmState.expectedText">
          <span>请输入 {{ confirmState.expectedText }} 确认</span>
          <input v-model="confirmInput" />
        </label>
        <footer>
          <button @click="closeConfirm">取消</button>
          <button
            class="danger"
            :disabled="Boolean(confirmState.expectedText) && confirmInput !== confirmState.expectedText"
            @click="runConfirmAction"
          >
            删除
          </button>
        </footer>
      </div>
    </div>

    <div
      v-if="assetFolderModal.visible"
      class="file-modal"
    >
      <div class="file-modal-card asset-folder-modal">
        <header>
          <strong>{{ assetFolderModal.parentKey ? '新建子目录' : '新建目录' }}</strong>
          <button
            title="关闭"
            @click="closeAssetFolderModal"
          >
            <X />
          </button>
        </header>
        <label class="modal-field">
          <span>目录名称 *</span>
          <input
            v-model="assetFolderForm.name"
            placeholder="请输入目录名称"
          />
        </label>
        <label class="modal-field">
          <span>目录描述</span>
          <textarea
            v-model="assetFolderForm.description"
            rows="3"
            placeholder="请输入目录描述"
          />
        </label>
        <small
          v-if="assetFolderFormError"
          class="asset-form-error"
        >
          {{ assetFolderFormError }}
        </small>
        <footer>
          <button @click="closeAssetFolderModal">取消</button>
          <button
            class="primary"
            @click="submitAssetFolderForm"
          >
            确定
          </button>
        </footer>
      </div>
    </div>
  </Teleport>

  <small
    v-if="importNotice"
    class="asset-panel-notice"
  >
    {{ importNotice }}
  </small>

</template>

<script setup lang="ts">
import { Search, X } from 'lucide-vue-next'
import { useAssetsPanelRuntimeContext } from '@/services/assets/assetsPanelContext'

const {
  workspace,
  importNotice,
  importHelpOpen,
  exportModalOpen,
  exportCheckedIds,
  exportQuery,
  assetFolderModal,
  assetFolderForm,
  assetFolderFormError,
  confirmInput,
  confirmState,
  importPreviewOpen,
  importPreviewAssets,
  filteredExportGroups,
  resolvedExportIds,
  importDuplicateCount,
  importPreviewSummary,
  closeAssetFolderModal,
  submitAssetFolderForm,
  closeProxyModal,
  saveProxyFormFromAssetPanel,
  isExportGroupChecked,
  toggleExportGroup,
  selectAllExportKeys,
  confirmExport,
  closeImportPreview,
  confirmImportAssets,
  closeConfirm,
  runConfirmAction
} = useAssetsPanelRuntimeContext()
</script>
