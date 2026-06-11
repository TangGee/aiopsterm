<template>
  <div class="assets-panel-native">
    <template v-if="activeAssetView === 'menu'">
      <div class="asset-management-header">
        <strong>管理</strong>
      </div>
      <div class="asset-management-search">
        <input
          v-model="managementQuery"
          placeholder="搜索"
        />
        <Search />
      </div>
      <div class="asset-management-list">
        <button
          v-for="entry in filteredManagementEntries"
          :key="entry.key"
          class="asset-management-item"
          :data-onboarding-id="entry.key === 'assetConfig' ? 'host-management-entry' : undefined"
          @click="openManagementEntry(entry.key)"
        >
          <span class="asset-management-icon">
            <component :is="entry.icon" />
          </span>
          <span>
            <strong>{{ entry.name }}</strong>
            <small>{{ entry.description }}</small>
          </span>
        </button>
      </div>
    </template>

    <template v-else-if="activeAssetView === 'assetConfig'">
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
                data-testid="asset-new-host-button"
                data-onboarding-id="asset-new-host-button"
                @click="openNewPanel"
              >
                <Database />
                新建主机
              </button>
              <button
                class="asset-action-button"
                @click="openImportDialog"
              >
                <Import />
                导入
              </button>
              <button
                class="asset-action-button icon-only"
                title="导入帮助"
                @click="importNotice = '导入文件需要包含 username、ip、password、label、group_name、auth_type、port。'"
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
            <template
              v-for="group in filteredAssetGroups"
              :key="group.key"
            >
              <div class="group-title">{{ group.title }}</div>
              <div
                class="host-cards"
                :class="{ 'wide-layout': !editorOpen }"
              >
                <div
                  v-for="asset in group.children"
                  :key="asset.id"
                  class="host-card-wrapper"
                >
                  <div
                    class="host-card"
                    role="button"
                    tabindex="0"
                    :aria-label="`${asset.title} 主机${asset.username ? `, ${asset.username}` : ''}`"
                    :data-onboarding-id="asset.id === flatFilteredAssets[0]?.id ? 'asset-card' : undefined"
                    @click="selectedAssetId = asset.id"
                    @dblclick.stop="connectAsset(asset.id)"
                    @keydown.enter.prevent="connectAsset(asset.id)"
                    @keydown.space.prevent="selectedAssetId = asset.id"
                    @contextmenu.prevent="openAssetContextMenu($event, asset.id)"
                  >
                    <span class="host-card-icon">
                      <Network v-if="asset.asset_type === 'switch'" />
                      <Laptop v-else />
                      <PlugZap
                        v-if="asset.asset_type === 'organization'"
                        class="enterprise-indicator"
                      />
                    </span>
                    <span class="host-card-info">
                      <strong>{{ asset.title }}</strong>
                      <small>主机{{ asset.username ? `, ${asset.username}` : '' }}</small>
                    </span>
                    <span class="host-card-actions">
                      <button
                        title="编辑"
                        @click.stop="editAsset(asset.id)"
                      >
                        <Pencil />
                      </button>
                      <button
                        v-if="asset.asset_type !== 'organization'"
                        title="删除"
                        @click.stop="removeAsset(asset.id)"
                      >
                        <Trash2 />
                      </button>
                    </span>
                  </div>
                </div>
              </div>
            </template>

            <div
              v-if="filteredAssetGroups.length === 0"
              class="asset-empty-state"
            >
              <Laptop />
              <strong>{{ assetQuery ? '没有搜索结果' : '暂无资产' }}</strong>
              <small v-if="!assetQuery">新建主机或导入已有会话。</small>
              <div v-if="!assetQuery">
                <button @click="openNewPanel">新建主机</button>
                <button @click="importNotice = '请选择支持的导入文件。'">导入</button>
              </div>
            </div>
          </div>

          <div
            v-if="assetContextMenuId"
            class="asset-context-menu"
            :style="{ left: `${contextPosition.x}px`, top: `${contextPosition.y}px` }"
          >
            <button
              v-if="contextAsset?.asset_type !== 'organization'"
              @click="connectAsset(assetContextMenuId)"
            >
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

        <aside
          class="asset-form-panel"
          :class="{ collapsed: !editorOpen }"
          :data-onboarding-id="editorOpen ? 'asset-form-fields' : undefined"
        >
          <template v-if="editorOpen">
            <header>
              <strong>{{ editMode ? '编辑主机' : '新建主机' }}</strong>
              <button
                title="关闭"
                @click="editorOpen = false"
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
              <input
                v-model="form.password"
                type="password"
              />
            </label>
            <label v-else>
              <span>密钥链</span>
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
              <span>代理</span>
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
                  @click="openSshProxySettings"
                >
                  去设置代理
                </button>
              </div>
            </label>
            <label>
              <span>跳板机</span>
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

    <template v-else-if="activeAssetView === 'assetManagement'">
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
                  v-for="asset in pagedManagedAssets"
                  :key="asset.id"
                  :class="{ selected: selectedRows.includes(asset.id) }"
                >
                  <td>
                    <input
                      v-model="selectedRows"
                      type="checkbox"
                      :value="asset.id"
                    />
                  </td>
                  <td>{{ asset.title }}</td>
                  <td>{{ asset.host }}</td>
                  <td>
                    <span
                      class="asset-source-tag"
                      :class="asset.data_source === 'manual' ? 'manual' : 'refresh'"
                    >
                      {{ asset.data_source === 'manual' ? '手动' : '刷新' }}
                    </span>
                  </td>
                  <td>{{ asset.comment }}</td>
                  <td>
                    <button @click="openManagedAssetEdit(asset.id)">编辑</button>
                    <button @click="removeAsset(asset.id)">删除</button>
                  </td>
                </tr>
              </tbody>
            </table>
            <div
              v-if="pagedManagedAssets.length === 0"
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

    <template v-else-if="activeAssetView === 'keyManagement'">
      <div class="key-management-container">
        <div class="key-management-main">
          <div class="asset-search-container">
            <div class="asset-search-row">
              <div class="asset-search-input">
                <input
                  v-model="keyQuery"
                  placeholder="搜索"
                />
                <button
                  v-if="keyQuery"
                  class="asset-search-clear"
                  title="清空搜索"
                  @click="keyQuery = ''"
                >
                  <X />
                </button>
                <Search />
              </div>
              <button
                class="asset-action-button"
                data-testid="key-new-button"
                @click="openNewKeyPanel"
              >
                <KeyRound />
                新建密钥
              </button>
            </div>
            <small v-if="keyServiceNotice">{{ keyServiceNotice }}</small>
          </div>

          <div class="keychain-list-container">
            <div
              v-if="filteredKeychains.length"
              class="keychain-cards"
              :class="{ 'wide-layout': !keyEditorOpen }"
            >
              <div
                v-for="key in filteredKeychains"
                :key="key.id"
                class="card-wrapper"
              >
                <button
                  class="keychain-card"
                  @click="selectedKeyId = key.id"
                  @contextmenu.prevent="openKeyContextMenu($event, key.id)"
                >
                  <span class="keychain-icon"><KeyRound /></span>
                  <span class="keychain-info">
                    <strong>{{ key.name }}</strong>
                    <small>类型{{ key.type }}</small>
                  </span>
                  <span class="host-card-actions">
                    <button
                      title="编辑"
                      @click.stop="editKey(key.id)"
                    >
                      <Pencil />
                    </button>
                    <button
                      title="删除"
                      @click.stop="removeKey(key.id)"
                    >
                      <Trash2 />
                    </button>
                  </span>
                </button>
              </div>
            </div>
            <div
              v-else
              class="asset-empty-state"
            >
              <KeyRound />
              <strong>{{ keyQuery ? '没有搜索结果' : '暂无密钥' }}</strong>
            </div>
          </div>

          <div
            v-if="keyContextMenuId"
            class="asset-context-menu"
            :style="{ left: `${keyContextPosition.x}px`, top: `${keyContextPosition.y}px` }"
          >
            <button @click="editKey(keyContextMenuId)">
              <Pencil />
              编辑
            </button>
            <button
              class="delete"
              @click="removeKey(keyContextMenuId)"
            >
              <Trash2 />
              删除
            </button>
          </div>
        </div>

        <aside
          v-if="keyEditorOpen"
          class="asset-form-panel key-form-panel"
        >
          <header>
            <strong>{{ keyEditMode ? '编辑密钥' : '新建密钥' }}</strong>
            <button
              title="关闭"
              @click="keyEditorOpen = false"
            >
              <X />
            </button>
          </header>
          <label>
            <span>名称</span>
            <input v-model="keyForm.name" />
          </label>
          <label>
            <span>私钥</span>
            <textarea
              v-model="keyForm.privateKey"
              spellcheck="false"
            />
          </label>
          <label>
            <span>公钥</span>
            <textarea
              v-model="keyForm.publicKey"
              spellcheck="false"
            />
          </label>
          <label>
            <span>Passphrase</span>
            <input
              v-model="keyForm.passphrase"
              type="password"
            />
          </label>
          <div
            class="key-drop-area"
            :class="{ 'drag-over': keyDragOver }"
            @dragover.prevent
            @dragenter.prevent="keyDragOver = true"
            @dragleave.prevent="keyDragOver = false"
            @drop.prevent="handleKeyDrop"
            @click="openKeyImportDialog"
          >
            <Upload />
            <span>拖拽或点击导入密钥文件</span>
          </div>
          <small
            v-if="keyFormError"
            class="key-form-error"
          >
            {{ keyFormError }}
          </small>
          <small v-if="keyImportNotice">{{ keyImportNotice }}</small>
          <button
            class="asset-submit-button"
            @click="submitKeyForm"
          >
            {{ keyEditMode ? '保存密钥' : '创建密钥' }}
          </button>
        </aside>
      </div>
    </template>

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

    <small
      v-if="importNotice"
      class="asset-panel-notice"
    >
      {{ importNotice }}
    </small>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import {
  CircleHelp,
  Copy,
  Database,
  Download,
  Import,
  KeyRound,
  Laptop,
  Network,
  Pencil,
  PlugZap,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X
} from 'lucide-vue-next'
import { assetManagementEntries } from '@/config/assets'
import type {
  AiopsAssetAuthType,
  AiopsAssetGroupRecord,
  AiopsAssetImportPreviewRecord,
  AiopsAssetInput,
  AiopsAssetRecord,
  AiopsAssetType,
  AiopsKeychainInput,
  AiopsKeychainRecord,
  AiopsKeychainType
} from '@shared/preload'
import { useWorkspaceStore } from '@/stores/workspace'
import {
  isAiopsAssetConnectionTestInfo,
  isAiopsAssetExportData,
  isAiopsAssetImportConfirmData,
  isAiopsAssetImportPreviewData,
  isAiopsAssetRecord,
  isAiopsAssetSnapshot,
  isAiopsKeychainDeleteData,
  isAiopsKeychainListData,
  isAiopsKeychainRecord,
  malformedAssetBackendResultMessage
} from '@/services/assetBackendGuards'

defineProps<{ query: string }>()

const workspace = useWorkspaceStore()
const activeAssetView = ref('menu')
const managementQuery = ref('')
const assetQuery = ref('')
const editorOpen = ref(false)
const editMode = ref(false)
const selectedAssetId = ref<string | null>(null)
const assetContextMenuId = ref<string | null>(null)
const contextPosition = reactive({ x: 0, y: 0 })
const importNotice = ref('')
const assetFormError = ref('')
const managedFormError = ref('')
const exportModalOpen = ref(false)
const exportCheckedIds = ref<string[]>([])
const exportQuery = ref('')
const selectedRows = ref<string[]>([])
const assetTestLoading = ref(false)
const assetTestMessage = ref('')
const assetTestOk = ref(false)
type AssetRecord = AiopsAssetRecord & {
  password?: string
  needProxy?: boolean
  proxyName?: string
}

type AssetGroup = {
  key: string
  title: string
  children: AssetRecord[]
}

const assets = ref<AssetRecord[]>([])
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

const keychains = ref<AiopsKeychainRecord[]>([])
const assetGroupOptions = ref<AiopsAssetGroupRecord[]>([])
const keyQuery = ref('')
const keyEditorOpen = ref(false)
const keyEditMode = ref(false)
const selectedKeyId = ref<string | null>(null)
const keyContextMenuId = ref<string | null>(null)
const keyContextPosition = reactive({ x: 0, y: 0 })
const keyDragOver = ref(false)
const keyServiceNotice = ref('')
const keyImportNotice = ref('')
const keyFormError = ref('')
const keyForm = reactive({
  id: '',
  name: '',
  privateKey: '',
  publicKey: '',
  passphrase: ''
})

const confirmInput = ref('')
const confirmState = reactive<{
  open: boolean
  title: string
  message: string
  expectedText: string
  action: null | (() => void | Promise<void>)
}>({
  open: false,
  title: '',
  message: '',
  expectedText: '',
  action: null
})

const importPreviewOpen = ref(false)
const importPreviewFilePath = ref('')
const importPreviewAssets = ref<AiopsAssetImportPreviewRecord[]>([])
const managedEditorOpen = ref(false)
const managedEditMode = ref(false)
const managedCommentOnly = ref(false)
const managedOrganizationId = ref<string | null>(null)
const assetManagementQuery = ref('')
const assetManagementPage = ref(1)
const assetManagementPageSize = ref(50)
const managedForm = reactive({
  id: '',
  title: '',
  host: '',
  comment: ''
})

const filteredManagementEntries = computed(() => {
  const keyword = managementQuery.value.trim().toLowerCase()
  if (!keyword) return assetManagementEntries
  return assetManagementEntries.filter((entry) => `${entry.name} ${entry.description}`.toLowerCase().includes(keyword))
})

const firstAssetGroupName = computed(() => assetGroupOptions.value[0]?.name || '')

const refreshAssets = async () => {
  const listAssets = window.aiops?.listAssets
  if (typeof listAssets !== 'function') throw new Error('资产列表服务不可用。')
  const snapshot = await listAssets()
  if (!applyAssetSnapshot(snapshot)) throw new Error(malformedAssetBackendResultMessage)
  await refreshAssetGroupOptions()
}

const refreshAssetGroupOptions = async () => {
  assetGroupOptions.value =
    (await window.aiops?.listAssetGroups?.({
      assetTypes: ['person', 'switch']
    })) || []
}

const refreshKeychains = async () => {
  const listKeychains = window.aiops?.listKeychains
  if (typeof listKeychains !== 'function') {
    keyServiceNotice.value = '密钥列表服务不可用。'
    throw new Error(keyServiceNotice.value)
  }
  try {
    const nextKeychains = await listKeychains()
    if (!isAiopsKeychainListData(nextKeychains)) throw new Error(malformedAssetBackendResultMessage)
    keychains.value = nextKeychains.map((keychain) => ({ ...keychain }))
    keyServiceNotice.value = ''
  } catch (error) {
    keyServiceNotice.value = error instanceof Error ? error.message : '密钥加载失败。'
    throw new Error(keyServiceNotice.value)
  }
}

const toAssetInput = (asset: AssetRecord, patch: Partial<AiopsAssetInput> = {}): AiopsAssetInput => ({
  id: asset.id,
  name: asset.name,
  title: asset.title,
  host: asset.host,
  ip: asset.ip,
  group: asset.group,
  group_name: asset.group_name,
  status: asset.status,
  username: asset.username,
  port: asset.port,
  asset_type: asset.asset_type,
  auth_type: asset.auth_type,
  comment: asset.comment,
  data_source: asset.data_source,
  tags: [...asset.tags],
  favorite: asset.favorite,
  folderUuid: asset.folderUuid,
  organizationId: asset.organizationId,
  tunnelState: asset.tunnelState,
  needProxy: asset.needProxy,
  proxyName: asset.proxyName,
  keychainId: asset.keychainId,
  ...patch
})

const saveAssetRecord = async (input: AiopsAssetInput) => {
  const result = await window.aiops?.saveAsset?.(input)
  if (!result?.ok) throw new Error(result?.errorMessage || '资产保存失败')
  if (!isAiopsAssetRecord(result.data)) throw new Error(malformedAssetBackendResultMessage)
  await refreshAssets()
  return result.data
}

const applyAssetSnapshot = (snapshot: unknown) => {
  if (!isAiopsAssetSnapshot(snapshot)) return false
  assets.value = snapshot.assets.filter((asset) => !asset.isLocalShell).map((asset) => ({ ...asset, tags: [...asset.tags] }))
  return true
}

const deleteAssetRecords = async (assetIds: string[]) => {
  for (const id of assetIds) {
    const result = await window.aiops?.deleteAsset?.(id)
    if (!result?.ok) throw new Error(result?.errorMessage || '资产删除失败')
  }
  await refreshAssets()
}

const assetGroups = computed<AssetGroup[]>(() => {
  const groupNames = Array.from(new Set(assets.value.map((asset) => asset.group || asset.group_name || 'Hosts')))
  return groupNames.map((group) => ({
    key: `group-${group}`,
    title: group,
    children: assets.value.filter((asset) => (asset.group || asset.group_name) === group)
  }))
})

const filterGroups = (groups: AssetGroup[], keyword: string) => {
  const normalized = keyword.trim().toLowerCase()
  if (!normalized) return groups
  return groups
    .map((group) => ({
      ...group,
      children: group.children.filter((asset) =>
        `${asset.title} ${asset.host} ${asset.group_name} ${asset.username} ${asset.comment || ''} ${asset.tags.join(' ')}`.toLowerCase().includes(normalized)
      )
    }))
    .filter((group) => group.children.length > 0)
}

const filteredAssetGroups = computed(() => filterGroups(assetGroups.value, assetQuery.value))
const flatAssets = computed(() => assets.value)
const flatFilteredAssets = computed(() => filteredAssetGroups.value.flatMap((group) => group.children))
const contextAsset = computed(() => assets.value.find((asset) => asset.id === assetContextMenuId.value))
const managedOrganization = computed(() => assets.value.find((asset) => asset.id === managedOrganizationId.value && asset.asset_type === 'organization'))
const jumpHostOptions = computed(() => assets.value.filter((asset) => asset.asset_type === 'person' && asset.id !== form.id))
const sshProxyOptions = computed(() =>
  workspace.sshProxyConfigs
    .map((config) => ({
      name: config.name.trim()
    }))
    .filter((config) => config.name)
)
const configuredSshProxyNames = computed(() => new Set(sshProxyOptions.value.map((proxy) => proxy.name)))
const exportableAssets = computed(() => assets.value.filter((asset) => asset.asset_type !== 'organization'))
const exportAssetGroups = computed<AssetGroup[]>(() => {
  const groupNames = Array.from(new Set(exportableAssets.value.map((asset) => asset.group || asset.group_name || 'Hosts')))
  return groupNames.map((group) => ({
    key: `export-group-${group}`,
    title: group,
    children: exportableAssets.value.filter((asset) => (asset.group || asset.group_name) === group)
  }))
})
const filteredExportGroups = computed(() => filterGroups(exportAssetGroups.value, exportQuery.value))
const resolvedExportIds = computed(() => exportCheckedIds.value.filter((id) => exportableAssets.value.some((asset) => asset.id === id)))
const managedSourceAssets = computed(() => {
  const nonOrganizationAssets = assets.value.filter((asset) => asset.asset_type !== 'organization')
  if (!managedOrganization.value) return nonOrganizationAssets
  return nonOrganizationAssets.filter((asset) => asset.group_name === managedOrganization.value?.group_name || asset.tags.includes('synced'))
})
const managedFilteredGroups = computed<AssetGroup[]>(() => {
  const groups = Array.from(new Set(managedSourceAssets.value.map((asset) => asset.group || asset.group_name || 'Hosts')))
  return filterGroups(
    groups.map((group) => ({
      key: `managed-${group}`,
      title: group,
      children: managedSourceAssets.value.filter((asset) => (asset.group || asset.group_name) === group)
    })),
    assetManagementQuery.value
  )
})
const managedAssets = computed(() => managedFilteredGroups.value.flatMap((group) => group.children))
const assetManagementPageCount = computed(() => Math.max(1, Math.ceil(managedAssets.value.length / assetManagementPageSize.value)))
const pagedManagedAssets = computed(() => {
  const start = (assetManagementPage.value - 1) * assetManagementPageSize.value
  return managedAssets.value.slice(start, start + assetManagementPageSize.value)
})
const managedVisibleAllSelected = computed(
  () => pagedManagedAssets.value.length > 0 && pagedManagedAssets.value.every((asset) => selectedRows.value.includes(asset.id))
)
const managedOrganizationTitle = computed(() => (managedOrganization.value ? `管理资产 · ${managedOrganization.value.title}` : '全部组织资产'))
const importDuplicateCount = computed(() => importPreviewAssets.value.filter((asset) => asset.duplicateId).length)
const importPreviewSummary = computed(() => {
  if (!importPreviewAssets.value.length) return '没有可导入的主机。'
  const duplicate = importDuplicateCount.value
  return duplicate ? `解析到 ${importPreviewAssets.value.length} 个主机，其中 ${duplicate} 个与现有主机重复。` : `解析到 ${importPreviewAssets.value.length} 个主机。`
})
const filteredKeychains = computed(() => {
  const keyword = keyQuery.value.trim().toLowerCase()
  if (!keyword) return keychains.value
  return keychains.value.filter((key) => `${key.name} ${key.type} ${key.publicKey}`.toLowerCase().includes(keyword))
})

const resetAssetConnectionTest = () => {
  assetTestLoading.value = false
  assetTestMessage.value = ''
  assetTestOk.value = false
}

const resetForm = () => {
  assetFormError.value = ''
  resetAssetConnectionTest()
  Object.assign(form, {
    id: '',
    title: '',
    host: '',
    username: '',
    group: firstAssetGroupName.value,
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

const openNewPanel = () => {
  activeAssetView.value = 'assetConfig'
  editMode.value = false
  resetForm()
  editorOpen.value = true
}

const openManagementEntry = (entryKey: string) => {
  if (entryKey === 'assetManagement') {
    managedOrganizationId.value = null
    selectedRows.value = []
    assetManagementQuery.value = ''
    assetManagementPage.value = 1
    managedEditorOpen.value = false
  }
  activeAssetView.value = entryKey
}

const openOnboardingCreatePanel = () => {
  activeAssetView.value = 'assetConfig'
  assetQuery.value = ''
  editMode.value = false
  resetForm()
  editorOpen.value = true
}

const resolveConfiguredSshProxyName = (proxyName?: string) => {
  const name = String(proxyName || '').trim()
  return name && configuredSshProxyNames.value.has(name) ? name : ''
}

const resolveAssetProxyName = (asset: AssetRecord) => (asset.needProxy ? resolveConfiguredSshProxyName(asset.proxyName) : '')

const openSshProxySettings = () => {
  workspace.setActiveModule('settings')
  workspace.setActiveSettingsSection('terminal')
  workspace.openSshProxyConfig()
  workspace.openAddSshProxyConfig()
}

const editAsset = (assetId: string | null) => {
  if (!assetId) return
  const asset = assets.value.find((item) => item.id === assetId)
  if (!asset) return
  activeAssetView.value = 'assetConfig'
  editMode.value = true
  assetFormError.value = ''
  resetAssetConnectionTest()
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
  assetContextMenuId.value = null
}

const cloneAsset = (assetId: string | null) => {
  if (!assetId) return
  const asset = assets.value.find((item) => item.id === assetId)
  if (!asset) return
  activeAssetView.value = 'assetConfig'
  editMode.value = false
  assetFormError.value = ''
  resetAssetConnectionTest()
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
  assetContextMenuId.value = null
}

const removeAsset = (assetId: string | null) => {
  if (!assetId) return
  const asset = assets.value.find((item) => item.id === assetId)
  if (!asset) return
  assetContextMenuId.value = null
  confirmState.open = true
  confirmState.title = '删除主机'
  confirmState.message = `确定删除 ${asset.title}？此操作会更新本地资产库。`
  confirmState.expectedText = asset.title
  confirmState.action = () => deleteAssets([assetId])
  confirmInput.value = ''
}

const deleteAssets = async (assetIds: string[]) => {
  try {
    await deleteAssetRecords(assetIds)
    const idSet = new Set(assetIds)
    selectedRows.value = selectedRows.value.filter((id) => !idSet.has(id))
    selectedAssetId.value = selectedAssetId.value && idSet.has(selectedAssetId.value) ? null : selectedAssetId.value
    exportCheckedIds.value = exportCheckedIds.value.filter((id) => !idSet.has(id))
    importNotice.value = `已删除 ${assetIds.length} 个主机。`
  } catch (error) {
    importNotice.value = error instanceof Error ? error.message : '删除主机失败。'
  }
}

const confirmBulkDelete = () => {
  if (!selectedRows.value.length) return
  confirmState.open = true
  confirmState.title = '批量删除主机'
  confirmState.message = `确定删除选中的 ${selectedRows.value.length} 个主机？`
  confirmState.expectedText = ''
  confirmState.action = () => deleteAssets([...selectedRows.value])
  confirmInput.value = ''
}

const toggleManagedVisibleSelection = (checked: boolean) => {
  const visibleIds = pagedManagedAssets.value.map((asset) => asset.id)
  selectedRows.value = checked ? Array.from(new Set([...selectedRows.value, ...visibleIds])) : selectedRows.value.filter((id) => !visibleIds.includes(id))
}

const connectAsset = async (assetId: string | null) => {
  if (!assetId) return
  const asset = assets.value.find((item) => item.id === assetId)
  if (!asset || asset.asset_type === 'organization') {
    assetContextMenuId.value = null
    return
  }
  selectedAssetId.value = asset.id
  const previousActivePanelId = workspace.activePanelId
  workspace.createPanel()
  workspace.renamePanel(workspace.activePanelId, asset.name || asset.title)
  workspace.replaceTerminalOutput(workspace.activePanelId, '')
  const panelId = workspace.activePanelId
  const discardPendingPanel = () => workspace.discardPendingTerminalPanel(panelId, previousActivePanelId)
  if (!window.aiops?.createTerminal) {
    importNotice.value = 'SSH 终端启动服务不可用'
    discardPendingPanel()
    assetContextMenuId.value = null
    return
  }
  workspace.registerSshSession(panelId, asset)
  try {
    const session = await window.aiops.createTerminal({
      kind: 'ssh',
      assetId: asset.id,
      title: asset.name || asset.title,
      cols: 100,
      rows: 30
    })
    const connected = Boolean(workspace.applySshTerminalSession(panelId, session, asset))
    if (!connected) {
      importNotice.value = 'SSH 终端启动失败'
      discardPendingPanel()
      assetContextMenuId.value = null
      return
    }
  } catch (error) {
    importNotice.value = error instanceof Error ? error.message : 'SSH 终端启动失败'
    discardPendingPanel()
    assetContextMenuId.value = null
    return
  }
  workspace.selectedContexts = [
    ...workspace.selectedContexts.filter((item) => item.id !== asset.id),
    { id: asset.id, kind: 'hosts', label: asset.host, detail: asset.name || asset.title }
  ]
  editorOpen.value = false
  editMode.value = false
  if (workspace.onboardingActiveTour === 'addAndConnectHost') {
    workspace.nextOnboardingStep()
  }
  assetContextMenuId.value = null
}

const openAssetContextMenu = (event: MouseEvent, assetId: string) => {
  assetContextMenuId.value = assetId
  const menuWidth = 150
  const menuHeight = 220
  const padding = 10
  contextPosition.x = Math.max(padding, Math.min(event.clientX, window.innerWidth - menuWidth - padding))
  contextPosition.y = Math.max(padding, Math.min(event.clientY, window.innerHeight - menuHeight - padding))
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
      needProxy: Boolean(selectedProxy),
      proxyName: selectedProxy ? selectedProxyName : '',
      ...(form.password.trim() ? { password: form.password } : {})
    }
  }
}

const testAssetFormConnection = async () => {
  const testAssetConnection = window.aiops?.testAssetConnection
  if (typeof testAssetConnection !== 'function') {
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
    editorOpen.value = false
    if (workspace.onboardingActiveTour === 'addAndConnectHost') {
      workspace.jumpOnboardingStep('connect-asset')
    }
  } catch (error) {
    importNotice.value = error instanceof Error ? error.message : '资产保存失败。'
  }
}

const refreshOrganizationAsset = async () => {
  if (contextAsset.value) {
    try {
      const result = await window.aiops?.refreshOrganizationAssets?.({ organizationId: contextAsset.value.id })
      if (!result?.ok) throw new Error(result?.errorMessage || '刷新堡垒机资源失败。')
      if (!applyAssetSnapshot(result.data)) throw new Error(malformedAssetBackendResultMessage)
      importNotice.value = `已刷新堡垒机资源 ${contextAsset.value.title}。`
    } catch (error) {
      importNotice.value = error instanceof Error ? error.message : '刷新堡垒机资源失败。'
    }
  }
  assetContextMenuId.value = null
}

const openOrganizationManagement = () => {
  managedOrganizationId.value = contextAsset.value?.asset_type === 'organization' ? contextAsset.value.id : null
  selectedRows.value = []
  assetManagementQuery.value = ''
  assetManagementPage.value = 1
  managedEditorOpen.value = false
  activeAssetView.value = 'assetManagement'
  assetContextMenuId.value = null
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
    await saveAssetRecord(toAssetInput(asset, nextPatch))
    importNotice.value = `已更新资产 ${editable ? title : asset.title}。`
  } else {
    await saveAssetRecord({
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
    })
    importNotice.value = `已添加资产 ${title}。`
  }
  managedEditorOpen.value = false
}

const refreshManagedAssets = async () => {
  try {
    const result = await window.aiops?.refreshOrganizationAssets?.(
      managedOrganization.value ? { organizationId: managedOrganization.value.id } : undefined
    )
    if (!result?.ok) throw new Error(result?.errorMessage || '刷新资产表失败。')
    if (!isAiopsAssetSnapshot(result.data)) throw new Error(malformedAssetBackendResultMessage)
    const data = result.data
    applyAssetSnapshot(data)
    selectedRows.value = selectedRows.value.filter((id) => data.assets.some((asset) => asset.id === id))
    importNotice.value = `已刷新资产表，共 ${data.assets.filter((asset) => asset.asset_type !== 'organization').length} 条。`
  } catch (error) {
    importNotice.value = error instanceof Error ? error.message : '刷新资产表失败。'
  }
}

const isExportGroupChecked = (children: AssetRecord[]) => children.length > 0 && children.every((asset) => exportCheckedIds.value.includes(asset.id))

const toggleExportGroup = (children: AssetRecord[], checked: boolean) => {
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
  const exportAssets = window.aiops?.exportAssets
  if (typeof exportAssets !== 'function') {
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
    return
  }
}

const loadAssetImportPreviewFromPath = async (filePath: string) => {
  if (!filePath) {
    importNotice.value = '没有选择导入文件。'
    return
  }
  const previewAssetImport = window.aiops?.previewAssetImport
  if (typeof previewAssetImport !== 'function') {
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
  importNotice.value = '支持 external-reference.json、CSV、XSH/XTS、INI/XML、MXTSESSIONS 导入。'
  const showOpenDialog = window.aiops?.showOpenDialog
  if (typeof showOpenDialog !== 'function') {
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
  if (result?.canceled) {
    importNotice.value = '已取消导入。'
    return
  }
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
  const confirmAssetImport = window.aiops?.confirmAssetImport
  if (typeof confirmAssetImport !== 'function') {
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
    applyAssetSnapshot(result.data)
    await refreshAssetGroupOptions()
    importNotice.value = result.data.skipped
      ? `已导入 ${result.data.imported} 个主机，跳过 ${result.data.skipped} 个重复主机。`
      : `已导入 ${result.data.imported} 个主机。`
    closeImportPreview()
  } catch (error) {
    importNotice.value = error instanceof Error ? error.message : '资产导入失败。'
  }
}

const openNewKeyPanel = () => {
  keyEditMode.value = false
  keyFormError.value = ''
  keyImportNotice.value = ''
  Object.assign(keyForm, { id: '', name: '', privateKey: '', publicKey: '', passphrase: '' })
  keyEditorOpen.value = true
}

const editKey = async (keyId: string | null) => {
  if (!keyId) return
  const getKeychain = window.aiops?.getKeychain
  if (typeof getKeychain !== 'function') {
    keyServiceNotice.value = '密钥详情服务不可用。'
    keyContextMenuId.value = null
    return
  }
  let key: AiopsKeychainRecord | null = null
  try {
    key = await getKeychain(keyId)
  } catch (error) {
    keyServiceNotice.value = error instanceof Error ? error.message : '密钥加载失败。'
    keyContextMenuId.value = null
    return
  }
  if (!key) {
    keyServiceNotice.value = '密钥不存在或已被删除。'
    keyContextMenuId.value = null
    return
  }
  if (!isAiopsKeychainRecord(key)) {
    keyServiceNotice.value = malformedAssetBackendResultMessage
    keyContextMenuId.value = null
    return
  }
  keyEditMode.value = true
  keyFormError.value = ''
  keyServiceNotice.value = ''
  keyImportNotice.value = ''
  Object.assign(keyForm, { id: key.id, name: key.name, privateKey: key.privateKey || '', publicKey: key.publicKey, passphrase: key.passphrase || '' })
  keyEditorOpen.value = true
  keyContextMenuId.value = null
}

const detectKeyType = (privateKey = '', publicKey = ''): AiopsKeychainType => {
  const publicAlgorithm = publicKey.trim().split(/\s+/)[0]?.toLowerCase()
  if (publicAlgorithm === 'ssh-ed25519') return 'ed25519'
  if (publicAlgorithm === 'ssh-rsa') return 'rsa'
  if (publicAlgorithm?.startsWith('ecdsa-')) return 'ecdsa'

  if (privateKey.includes('BEGIN RSA PRIVATE KEY')) return 'rsa'
  if (privateKey.includes('BEGIN EC PRIVATE KEY')) return 'ecdsa'
  if (privateKey.includes('ssh-ed25519')) return 'ed25519'
  if (privateKey.includes('ssh-rsa')) return 'rsa'
  if (privateKey.includes('ecdsa-sha2')) return 'ecdsa'

  if (privateKey.includes('BEGIN OPENSSH PRIVATE KEY') && typeof globalThis.atob === 'function') {
    try {
      const body = privateKey.replace(/-----(BEGIN|END)[\s\S]+?KEY-----/g, '').replace(/\s+/g, '')
      const decoded = globalThis.atob(body)
      if (decoded.includes('ssh-ed25519')) return 'ed25519'
      if (decoded.includes('ssh-rsa')) return 'rsa'
      if (decoded.includes('ecdsa-sha2')) return 'ecdsa'
    } catch {
      // Invalid or redacted OpenSSH keys fall back to RSA, matching External reference's visible default.
    }
  }

  return 'rsa'
}

const validateKeyForm = () => {
  const name = keyForm.name.trim()
  if (!name) return '请输入名称。'
  if (!keyForm.privateKey.trim()) return '请输入私钥。'
  if (keyForm.name.includes(' ')) return '名称不能包含空格。'
  if (keyForm.publicKey.includes(' ')) return '公钥不能包含空格。'
  if (keyForm.passphrase.includes(' ')) return 'Passphrase 不能包含空格。'
  const duplicate = keychains.value.find((key) => key.name === name && key.id !== keyForm.id)
  if (duplicate) return `密钥 ${name} 已存在。`
  return ''
}

const saveKeychainRecord = async (input: AiopsKeychainInput) => {
  const saveKeychain = window.aiops?.saveKeychain
  if (typeof saveKeychain !== 'function') {
    throw new Error('密钥保存服务不可用。')
  }
  const result = await saveKeychain(input)
  if (!result?.ok) throw new Error(result?.errorMessage || '密钥保存失败')
  if (!isAiopsKeychainRecord(result.data)) throw new Error(malformedAssetBackendResultMessage)
  await refreshKeychains()
  return result.data
}

const submitKeyForm = async () => {
  const error = validateKeyForm()
  if (error) {
    keyFormError.value = error
    return
  }
  const name = keyForm.name.trim()
  const row: AiopsKeychainInput = {
    id: keyForm.id || undefined,
    name,
    type: detectKeyType(keyForm.privateKey, keyForm.publicKey),
    privateKey: keyForm.privateKey.trim(),
    publicKey: keyForm.publicKey.trim(),
    passphrase: keyForm.passphrase
  }
  try {
    const saved = await saveKeychainRecord(row)
    selectedKeyId.value = saved.id
    keyFormError.value = ''
    keyImportNotice.value = `${keyEditMode.value ? '已保存' : '已创建'} ${saved.name}。`
    keyEditorOpen.value = false
  } catch (saveError) {
    keyFormError.value = saveError instanceof Error ? saveError.message : '密钥保存失败。'
  }
}

const removeKey = (keyId: string | null) => {
  if (!keyId) return
  const key = keychains.value.find((item) => item.id === keyId)
  if (!key) return
  keyContextMenuId.value = null
  confirmState.open = true
  confirmState.title = '删除密钥'
  confirmState.message = `确定删除密钥 ${key.name}？`
  confirmState.expectedText = key.name
  confirmState.action = async () => {
    const deleteKeychain = window.aiops?.deleteKeychain
    if (typeof deleteKeychain !== 'function') {
      keyServiceNotice.value = '密钥删除服务不可用。'
      keyImportNotice.value = '密钥删除服务不可用。'
      return
    }
    const result = await deleteKeychain(keyId)
    if (!result?.ok) {
      keyServiceNotice.value = result?.errorMessage || '密钥删除失败。'
      keyImportNotice.value = result?.errorMessage || '密钥删除失败。'
      return
    }
    if (!isAiopsKeychainDeleteData(result.data, keyId)) {
      keyServiceNotice.value = malformedAssetBackendResultMessage
      keyImportNotice.value = malformedAssetBackendResultMessage
      return
    }
    try {
      await refreshKeychains()
    } catch (error) {
      keyServiceNotice.value = error instanceof Error ? error.message : '密钥加载失败。'
      keyImportNotice.value = error instanceof Error ? error.message : '密钥加载失败。'
      return
    }
    selectedKeyId.value = selectedKeyId.value === keyId ? null : selectedKeyId.value
    form.keyId = form.keyId === keyId ? '' : form.keyId
    keyServiceNotice.value = ''
    keyImportNotice.value = `已删除密钥 ${key.name}。`
  }
  confirmInput.value = ''
}

const openKeyContextMenu = (event: MouseEvent, keyId: string) => {
  keyContextMenuId.value = keyId
  const menuWidth = 150
  const menuHeight = 120
  const padding = 10
  keyContextPosition.x = Math.max(padding, Math.min(event.clientX, window.innerWidth - menuWidth - padding))
  keyContextPosition.y = Math.max(padding, Math.min(event.clientY, window.innerHeight - menuHeight - padding))
}

const applyImportedKeyFile = (fileName: string, content: string) => {
  const text = content.trim()
  if (!text) {
    keyImportNotice.value = '密钥文件为空。'
    return
  }
  keyForm.privateKey = text
  keyFormError.value = ''
  const type = detectKeyType(keyForm.privateKey, keyForm.publicKey).toUpperCase()
  keyImportNotice.value = `已导入 ${fileName}，识别为 ${type}。`
}

const localFileName = (filePath: string) => filePath.split(/[/\\]/).filter(Boolean).at(-1) || filePath

const readLocalTextFile = async (filePath: string, unavailableMessage: string) => {
  const readLocalFile = window.aiops?.readLocalFile
  if (typeof readLocalFile !== 'function') throw new Error(unavailableMessage)
  const result = await readLocalFile(filePath)
  return result.content
}

const importKeyFileFromPath = async (filePath: string) => {
  if (!filePath) {
    keyImportNotice.value = '没有选择密钥文件。'
    return
  }
  const fileName = localFileName(filePath)
  try {
    const content = await readLocalTextFile(filePath, '密钥文件读取服务不可用。')
    applyImportedKeyFile(fileName, content)
  } catch (error) {
    keyImportNotice.value = error instanceof Error ? error.message : '密钥文件读取失败。'
  }
}

const openKeyImportDialog = async () => {
  keyImportNotice.value = '请选择 .pem、.key、.pub、.ppk 等密钥文件。'
  const showOpenDialog = window.aiops?.showOpenDialog
  if (typeof showOpenDialog !== 'function') {
    keyImportNotice.value = '密钥文件选择服务不可用。'
    return
  }
  let result: Awaited<ReturnType<typeof showOpenDialog>>
  try {
    result = await showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Key Files', extensions: ['pem', 'key', 'txt', 'pub', 'asc', 'crt', 'cer', 'der', 'p12', 'pfx', 'ssh', 'ppk', 'gpg'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
  } catch {
    keyImportNotice.value = '密钥文件选择失败。'
    return
  }
  if (result?.canceled) {
    keyImportNotice.value = '已取消导入密钥。'
    return
  }
  await importKeyFileFromPath(result?.filePaths?.[0] || '')
}

const handleKeyDrop = async (event: DragEvent) => {
  keyDragOver.value = false
  const file = event.dataTransfer?.files?.[0]
  if (!file) {
    keyImportNotice.value = '没有检测到可导入的密钥文件。'
    return
  }
  const getPathForFile = window.aiops?.getPathForFile
  const filePath =
    (typeof getPathForFile === 'function' ? getPathForFile(file) : '') || String((file as File & { path?: string }).path || '').trim()
  if (!filePath) {
    keyImportNotice.value = '拖拽导入需要本地文件路径。'
    return
  }
  await importKeyFileFromPath(filePath)
}

const closeConfirm = () => {
  confirmState.open = false
  confirmState.action = null
  confirmInput.value = ''
}

const runConfirmAction = async () => {
  if (confirmState.expectedText && confirmInput.value !== confirmState.expectedText) return
  await confirmState.action?.()
  closeConfirm()
}

watch(
  assetManagementQuery,
  () => {
    assetManagementPage.value = 1
    selectedRows.value = []
  }
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

watch(
  configuredSshProxyNames,
  () => {
    if (form.proxyName && !configuredSshProxyNames.value.has(form.proxyName)) {
      form.proxyName = ''
    }
  }
)

watch(
  () => workspace.onboardingAssetRequest.sequence,
  (sequence) => {
    const request = workspace.onboardingAssetRequest
    if (sequence === 0 && request.action === 'none') return
    if (request.action === 'open-host-management') {
      activeAssetView.value = 'assetConfig'
      return
    }
    if (request.action === 'open-create-form') {
      openOnboardingCreatePanel()
    }
  },
  { immediate: true }
)

watch(
  () => workspace.assetManagementOpenRequest.sequence,
  (sequence) => {
    if (!sequence) return
    managedOrganizationId.value = workspace.assetManagementOpenRequest.organizationId || null
    selectedRows.value = []
    assetManagementQuery.value = ''
    assetManagementPage.value = 1
    managedEditorOpen.value = false
    activeAssetView.value = 'assetManagement'
  },
  { immediate: true }
)

onMounted(() => {
  refreshAssets().catch((error) => {
    importNotice.value = error instanceof Error ? error.message : '资产加载失败。'
  })
  refreshKeychains().catch((error) => {
    keyServiceNotice.value = error instanceof Error ? error.message : '密钥加载失败。'
  })
})
</script>
