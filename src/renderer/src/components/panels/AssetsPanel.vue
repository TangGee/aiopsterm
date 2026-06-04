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
              <input
                ref="assetImportInput"
                class="asset-hidden-file-input"
                type="file"
                accept=".json,.csv,.xsh,.xts,.ini,.xml,.mxtsessions"
                @change="handleAssetImportFile"
              />
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
            <small v-if="importNotice">{{ importNotice }}</small>
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
                  <button
                    class="host-card"
                    :data-onboarding-id="asset.id === flatFilteredAssets[0]?.id ? 'asset-card' : undefined"
                    @click="selectedAssetId = asset.id"
                    @dblclick="connectAsset(asset.id)"
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
                  </button>
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
              <input v-model="form.group" />
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
              <select v-model="form.proxyName">
                <option value="">不使用代理</option>
                <option value="prod-proxy">prod-proxy</option>
                <option value="office-proxy">office-proxy</option>
              </select>
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
            <button
              class="asset-submit-button"
              data-onboarding-id="asset-form-submit"
              @click="submitForm"
            >
              保存
            </button>
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
            @click="keyImportNotice = '请选择 .pem、.key、.pub、.ppk 等密钥文件。'"
          >
            <Upload />
            <span>拖拽或点击导入密钥文件</span>
          </div>
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
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
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
import { assetManagementEntries, mockAssets, type MockAsset, type MockAssetGroup } from '@/data/mockData'
import { useWorkspaceStore } from '@/stores/workspace'

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
const assetImportInput = ref<HTMLInputElement | null>(null)
const exportModalOpen = ref(false)
const exportCheckedIds = ref<string[]>([])
const exportQuery = ref('')
const selectedRows = ref<string[]>([])
const assets = ref<MockAsset[]>(mockAssets.map((asset) => ({ ...asset, tags: [...asset.tags] })))
const form = reactive({
  id: '',
  title: '',
  host: '',
  username: '',
  group: '生产',
  port: 22,
  asset_type: 'person' as MockAsset['asset_type'],
  auth_type: 'password' as MockAsset['auth_type'],
  password: '',
  keyId: '',
  proxyName: '',
  jumpHostId: '',
  bastionType: 'jumpserver',
  switchBrand: 'cisco'
})

type KeychainItem = {
  id: string
  name: string
  type: string
  privateKey: string
  publicKey: string
  passphrase: string
}

const keychains = ref<KeychainItem[]>([
  {
    id: 'key-1',
    name: 'prod-ed25519',
    type: 'ed25519',
    privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----',
    publicKey: 'ssh-ed25519 AAAA... prod',
    passphrase: ''
  },
  {
    id: 'key-2',
    name: 'staging-rsa',
    type: 'rsa',
    privateKey: '-----BEGIN RSA PRIVATE KEY-----',
    publicKey: 'ssh-rsa AAAA... staging',
    passphrase: ''
  }
])
const keyQuery = ref('')
const keyEditorOpen = ref(false)
const keyEditMode = ref(false)
const selectedKeyId = ref<string | null>(null)
const keyContextMenuId = ref<string | null>(null)
const keyContextPosition = reactive({ x: 0, y: 0 })
const keyDragOver = ref(false)
const keyImportNotice = ref('')
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
  action: null | (() => void)
}>({
  open: false,
  title: '',
  message: '',
  expectedText: '',
  action: null
})

type ImportPreviewAsset = {
  previewId: string
  duplicateId?: string
  title: string
  host: string
  username: string
  group: string
  port: number
  auth_type: MockAsset['auth_type']
  asset_type: MockAsset['asset_type']
  comment: string
}

const importPreviewOpen = ref(false)
const importPreviewAssets = ref<ImportPreviewAsset[]>([])
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

const onboardingHostDraft = {
  id: '',
  title: 'onboarding-demo',
  host: '127.0.0.1',
  username: 'local',
  group: '生产',
  port: 22,
  asset_type: 'person' as MockAsset['asset_type'],
  auth_type: 'password' as MockAsset['auth_type'],
  password: '',
  keyId: '',
  proxyName: '',
  jumpHostId: '',
  bastionType: 'jumpserver',
  switchBrand: 'cisco'
}

const filteredManagementEntries = computed(() => {
  const keyword = managementQuery.value.trim().toLowerCase()
  if (!keyword) return assetManagementEntries
  return assetManagementEntries.filter((entry) => `${entry.name} ${entry.description}`.toLowerCase().includes(keyword))
})

const assetGroups = computed<MockAssetGroup[]>(() => {
  const groupNames = Array.from(new Set(assets.value.map((asset) => asset.group || asset.group_name || 'Hosts')))
  return groupNames.map((group) => ({
    key: `group-${group}`,
    title: group,
    children: assets.value.filter((asset) => (asset.group || asset.group_name) === group)
  }))
})

const filterGroups = (groups: MockAssetGroup[], keyword: string) => {
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
const filteredExportGroups = computed(() => filterGroups(assetGroups.value, exportQuery.value))
const resolvedExportIds = computed(() => exportCheckedIds.value.filter((id) => assets.value.some((asset) => asset.id === id)))
const managedSourceAssets = computed(() => {
  const nonOrganizationAssets = assets.value.filter((asset) => asset.asset_type !== 'organization')
  if (!managedOrganization.value) return nonOrganizationAssets
  return nonOrganizationAssets.filter((asset) => asset.group_name === managedOrganization.value?.group_name || asset.tags.includes('synced'))
})
const managedFilteredGroups = computed<MockAssetGroup[]>(() => {
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

const resetForm = () => {
  Object.assign(form, {
    id: '',
    title: '',
    host: '',
    username: '',
    group: '生产',
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
  Object.assign(form, onboardingHostDraft)
  editorOpen.value = true
}

const editAsset = (assetId: string | null) => {
  if (!assetId) return
  const asset = assets.value.find((item) => item.id === assetId)
  if (!asset) return
  activeAssetView.value = 'assetConfig'
  editMode.value = true
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
    keyId: '',
    proxyName: '',
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
    keyId: '',
    proxyName: '',
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
  confirmState.message = `确定删除 ${asset.title}？此操作只会更新 aiopsterm 本地 mock 状态。`
  confirmState.expectedText = asset.title
  confirmState.action = () => deleteAssets([assetId])
  confirmInput.value = ''
}

const deleteAssets = (assetIds: string[]) => {
  const idSet = new Set(assetIds)
  assets.value = assets.value.filter((asset) => !idSet.has(asset.id))
  selectedRows.value = selectedRows.value.filter((id) => !idSet.has(id))
  selectedAssetId.value = selectedAssetId.value && idSet.has(selectedAssetId.value) ? null : selectedAssetId.value
  exportCheckedIds.value = exportCheckedIds.value.filter((id) => !idSet.has(id))
  importNotice.value = `已删除 ${assetIds.length} 个主机。`
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

const connectAsset = (assetId: string | null) => {
  if (!assetId) return
  const asset = assets.value.find((item) => item.id === assetId)
  if (!asset || asset.asset_type === 'organization') {
    assetContextMenuId.value = null
    return
  }
  selectedAssetId.value = asset.id
  workspace.createPanel()
  workspace.renamePanel(workspace.activePanelId, asset.name || asset.title)
  workspace.replaceTerminalOutput(workspace.activePanelId, '')
  workspace.appendTerminalInput(workspace.activePanelId, `aiopsterm ssh ${asset.username}@${asset.host}:${asset.port}\n`)
  workspace.appendTerminalOutput(workspace.activePanelId, `[mock ssh] ${asset.name || asset.title}\n$ `)
  workspace.selectedContexts = [
    ...workspace.selectedContexts.filter((item) => item.id !== asset.id),
    { id: asset.id, kind: 'hosts', label: asset.host, detail: asset.name || asset.title }
  ]
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

const submitForm = () => {
  const title = form.title.trim() || form.host.trim() || '未命名主机'
  const host = form.host.trim() || '127.0.0.1'
  const group = form.group.trim() || 'Hosts'
  const generatedId = form.id || `asset-local-${Date.now()}`
  const baseAsset: MockAsset = {
    id: generatedId,
    uuid: generatedId,
    name: title,
    title,
    host,
    ip: host,
    group,
    group_name: group,
    status: 'online',
    tags: [form.auth_type === 'keyBased' ? 'key' : 'ssh'],
    username: form.username.trim() || 'root',
    port: Number(form.port) || 22,
    asset_type: form.asset_type,
    auth_type: form.auth_type,
    comment: editMode.value ? '本地编辑' : '本地创建',
    data_source: form.asset_type === 'organization' ? 'refresh' : 'manual'
  }
  if (editMode.value && form.id) {
    assets.value = assets.value.map((asset) => (asset.id === form.id ? { ...asset, ...baseAsset, id: asset.id, uuid: asset.uuid } : asset))
  } else {
    assets.value = [...assets.value, baseAsset]
    selectedAssetId.value = baseAsset.id
  }
  importNotice.value = `${editMode.value ? '已保存' : '已创建'} ${title}。当前为本地 mock。`
  editorOpen.value = false
  if (workspace.onboardingActiveTour === 'addAndConnectHost') {
    workspace.jumpOnboardingStep('connect-asset')
  }
}

const refreshOrganizationAsset = () => {
  if (contextAsset.value) {
    const exists = assets.value.some((asset) => asset.id === `${contextAsset.value!.id}-synced`)
    if (!exists) {
      const synced: MockAsset = {
        id: `${contextAsset.value.id}-synced`,
        uuid: `${contextAsset.value.uuid}-synced`,
        name: `${contextAsset.value.title}-synced-asset`,
        title: `${contextAsset.value.title}-synced-asset`,
        host: '10.90.0.15',
        ip: '10.90.0.15',
        group: contextAsset.value.group,
        group_name: contextAsset.value.group_name,
        status: 'online',
        tags: ['jumpserver', 'synced'],
        username: 'jump',
        port: 22,
        asset_type: 'person',
        auth_type: 'keyBased',
        comment: '刷新来源资产',
        data_source: 'refresh'
      }
      assets.value = [...assets.value, synced]
    }
    importNotice.value = `已刷新堡垒机资源 ${contextAsset.value.title}。`
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
  Object.assign(managedForm, { id: '', title: '', host: '', comment: '' })
  managedEditorOpen.value = true
}

const openManagedAssetEdit = (assetId: string) => {
  const asset = assets.value.find((item) => item.id === assetId)
  if (!asset) return
  managedEditMode.value = true
  managedCommentOnly.value = asset.data_source !== 'manual'
  Object.assign(managedForm, {
    id: asset.id,
    title: asset.title,
    host: asset.host,
    comment: asset.comment || ''
  })
  managedEditorOpen.value = true
}

const submitManagedForm = () => {
  const title = managedForm.title.trim() || managedForm.host.trim() || 'managed-host'
  const host = managedForm.host.trim() || '127.0.0.1'
  if (managedEditMode.value && managedForm.id) {
    assets.value = assets.value.map((asset) => {
      if (asset.id !== managedForm.id) return asset
      const editable = asset.data_source === 'manual'
      return {
        ...asset,
        title: editable ? title : asset.title,
        name: editable ? title : asset.name,
        host: editable ? host : asset.host,
        ip: editable ? host : asset.ip,
        comment: managedForm.comment
      }
    })
    importNotice.value = `已更新资产 ${title}。`
  } else {
    const generatedId = `managed-local-${Date.now()}`
    const row: MockAsset = {
      id: generatedId,
      uuid: generatedId,
      name: title,
      title,
      host,
      ip: host,
      group: managedOrganization.value?.group_name || '企业',
      group_name: managedOrganization.value?.group_name || '企业',
      status: 'online',
      tags: ['managed'],
      username: 'ops',
      port: 22,
      asset_type: 'person',
      auth_type: 'password',
      comment: managedForm.comment,
      data_source: 'manual'
    }
    assets.value = [...assets.value, row]
    importNotice.value = `已添加资产 ${title}。`
  }
  managedEditorOpen.value = false
}

const refreshManagedAssets = () => {
  const source = managedOrganization.value
  if (source) {
    const generatedId = `${source.id}-managed-${Date.now()}`
    const refreshed: MockAsset = {
      id: generatedId,
      uuid: generatedId,
      name: `${source.title}-refresh-${managedAssets.value.length + 1}`,
      title: `${source.title}-refresh-${managedAssets.value.length + 1}`,
      host: `10.90.0.${managedAssets.value.length + 20}`,
      ip: `10.90.0.${managedAssets.value.length + 20}`,
      group: source.group,
      group_name: source.group_name,
      status: 'online',
      tags: ['jumpserver', 'synced'],
      username: 'jump',
      port: 22,
      asset_type: 'person',
      auth_type: 'keyBased',
      comment: '刷新来源资产',
      data_source: 'refresh'
    }
    assets.value = [...assets.value, refreshed]
  }
  importNotice.value = `已刷新资产表，共 ${managedAssets.value.length} 条。`
}

const isExportGroupChecked = (children: MockAsset[]) => children.length > 0 && children.every((asset) => exportCheckedIds.value.includes(asset.id))

const toggleExportGroup = (children: MockAsset[], checked: boolean) => {
  const ids = children.map((asset) => asset.id)
  exportCheckedIds.value = checked ? Array.from(new Set([...exportCheckedIds.value, ...ids])) : exportCheckedIds.value.filter((id) => !ids.includes(id))
}

const openExportModal = () => {
  if (!assets.value.length) {
    importNotice.value = '暂无可导出的主机。'
    return
  }
  exportCheckedIds.value = []
  exportQuery.value = ''
  exportModalOpen.value = true
}

const selectAllExportKeys = () => {
  exportCheckedIds.value = assets.value.map((asset) => asset.id)
}

const toExportPayload = (asset: MockAsset) => ({
  username: asset.username,
  ip: asset.host,
  label: asset.title,
  group_name: asset.group_name,
  auth_type: asset.auth_type,
  port: asset.port,
  asset_type: asset.asset_type,
  comment: asset.comment || ''
})

const confirmExport = async () => {
  if (!resolvedExportIds.value.length) return
  const date = new Date().toISOString().slice(0, 10)
  const fileName = `external-reference-assets-${date}.json`
  const selected = assets.value.filter((asset) => resolvedExportIds.value.includes(asset.id)).map(toExportPayload)
  const result = await window.aiops?.showSaveDialog?.({
    defaultPath: fileName,
    filters: [{ name: 'JSON Files', extensions: ['json'] }]
  })
  if (result?.canceled || !result?.filePath) {
    importNotice.value = '已取消导出。'
    return
  }
  try {
    await window.aiops?.writeLocalFile?.(result.filePath, JSON.stringify(selected, null, 2))
  } catch {
    importNotice.value = '导出文件写入失败。'
    return
  }
  importNotice.value = `已导出 ${selected.length} 个主机到 ${fileName}。`
  exportModalOpen.value = false
}

const openImportDialog = () => {
  importNotice.value = '支持 external-reference.json、CSV、XSH/XTS、INI/XML、MXTSESSIONS 导入。'
  assetImportInput.value?.click()
}

const readFileAsText = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsText(file, 'utf-8')
  })

const normalizeImportItem = (raw: any, index: number): ImportPreviewAsset | null => {
  if (!raw || typeof raw !== 'object') return null
  const host = String(raw.ip || raw.host || raw.address || '').trim()
  const username = String(raw.username || raw.user || 'root').trim()
  if (!host || !username) return null
  const title = String(raw.label || raw.title || raw.name || host).trim()
  const group = String(raw.group_name || raw.group || 'Imported').trim()
  const port = Number(raw.port) || 22
  const authType = raw.auth_type === 'keyBased' || raw.authType === 'keyBased' ? 'keyBased' : 'password'
  const assetType = raw.asset_type === 'organization' || raw.asset_type === 'switch' ? raw.asset_type : 'person'
  const duplicate = assets.value.find((asset) => asset.host === host && asset.username === username && asset.port === port)
  return {
    previewId: `import-${index}-${host}-${port}`,
    duplicateId: duplicate?.id,
    title,
    host,
    username,
    group,
    port,
    auth_type: authType,
    asset_type: assetType,
    comment: String(raw.comment || raw.description || '')
  }
}

const parseJsonImport = (content: string) => {
  const parsed = JSON.parse(content)
  const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.assets) ? parsed.assets : []
  return rows.map(normalizeImportItem).filter(Boolean) as ImportPreviewAsset[]
}

const parseKeyValueSession = (lines: string[], fallbackName: string) => {
  const raw: Record<string, string> = { label: fallbackName }
  for (const line of lines) {
    const equalIndex = line.indexOf('=')
    if (equalIndex < 0) continue
    const key = line.slice(0, equalIndex).trim().replace(/^[SD]:/, '').replace(/"/g, '').toLowerCase()
    const value = line.slice(equalIndex + 1).trim().replace(/^"|"$/g, '')
    if (!value) continue
    if (['host', 'hostname', 'ip', 'address'].includes(key)) raw.ip = value
    if (['username', 'user', 'user_name'].includes(key)) raw.username = value
    if (['port'].includes(key)) raw.port = value
    if (['description', 'name', 'label'].includes(key)) raw.label = value
    if (key.includes('auth') && value.toLowerCase().includes('public')) raw.auth_type = 'keyBased'
    if (key.includes('identity') || key.includes('privatekey')) raw.auth_type = 'keyBased'
  }
  return raw
}

const parseTextImport = (content: string, fileName: string) => {
  const sessions: ImportPreviewAsset[] = []
  const blocks = content
    .split(/\n\s*\n|\r?\n(?=\[)/)
    .map((block) => block.trim())
    .filter(Boolean)
  if (blocks.some((block) => block.includes('='))) {
    blocks.forEach((block, index) => {
      const lines = block.split(/\r?\n/).map((line) => line.trim())
      const parsed = normalizeImportItem(parseKeyValueSession(lines, fileName.replace(/\.[^.]+$/, '')), index)
      if (parsed) sessions.push(parsed)
    })
  }
  if (sessions.length) return sessions
  return content
    .split(/\r?\n/)
    .map((line, index) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) return null
      const parts = trimmed.split(/[,;\t]/).map((part) => part?.trim())
      const [titlePart, hostPart, userPart, groupPart, portPart] = parts
      const sshMatch = trimmed.match(/(?:ssh\s+)?(?:(?<user>[^@\s]+)@)?(?<host>[a-zA-Z0-9_.-]+)(?::(?<port>\d+))?/)
      const host = hostPart || sshMatch?.groups?.host || titlePart
      return normalizeImportItem(
        {
          label: titlePart || host,
          ip: host,
          username: userPart || sshMatch?.groups?.user || 'root',
          group_name: groupPart || 'Imported',
          port: portPart || sshMatch?.groups?.port || 22
        },
        index
      )
    })
    .filter(Boolean) as ImportPreviewAsset[]
}

const handleAssetImportFile = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    const content = await readFileAsText(file)
    const ext = file.name.split('.').pop()?.toLowerCase()
    const preview = ext === 'json' ? parseJsonImport(content) : parseTextImport(content, file.name)
    if (!preview.length) {
      importNotice.value = '导入文件没有可识别的主机。'
      return
    }
    importPreviewAssets.value = preview
    importPreviewOpen.value = true
  } catch {
    importNotice.value = '导入文件解析失败。'
  } finally {
    input.value = ''
  }
}

const closeImportPreview = () => {
  importPreviewOpen.value = false
  importPreviewAssets.value = []
}

const importPreviewToAsset = (item: ImportPreviewAsset, existing?: MockAsset): MockAsset => {
  const generatedId = `asset-import-${Date.now()}-${item.previewId}`
  return {
    id: existing?.id || generatedId,
    uuid: existing?.uuid || generatedId,
    name: item.title,
    title: item.title,
    host: item.host,
    ip: item.host,
    group: item.group,
    group_name: item.group,
    status: 'online',
    tags: ['imported'],
    username: item.username,
    port: item.port,
    asset_type: item.asset_type,
    auth_type: item.auth_type,
    comment: item.comment,
    data_source: 'manual'
  }
}

const confirmImportAssets = (overwrite: boolean) => {
  let imported = 0
  let skipped = 0
  const nextAssets = [...assets.value]
  for (const item of importPreviewAssets.value) {
    const existingIndex = item.duplicateId ? nextAssets.findIndex((asset) => asset.id === item.duplicateId) : -1
    if (existingIndex >= 0 && !overwrite) {
      skipped++
      continue
    }
    if (existingIndex >= 0) {
      nextAssets[existingIndex] = importPreviewToAsset(item, nextAssets[existingIndex])
    } else {
      nextAssets.push(importPreviewToAsset(item))
    }
    imported++
  }
  assets.value = nextAssets
  importNotice.value = skipped ? `已导入 ${imported} 个主机，跳过 ${skipped} 个重复主机。` : `已导入 ${imported} 个主机。`
  closeImportPreview()
}

const openNewKeyPanel = () => {
  keyEditMode.value = false
  Object.assign(keyForm, { id: '', name: '', privateKey: '', publicKey: '', passphrase: '' })
  keyEditorOpen.value = true
}

const editKey = (keyId: string | null) => {
  if (!keyId) return
  const key = keychains.value.find((item) => item.id === keyId)
  if (!key) return
  keyEditMode.value = true
  Object.assign(keyForm, { id: key.id, name: key.name, privateKey: key.privateKey, publicKey: key.publicKey, passphrase: key.passphrase })
  keyEditorOpen.value = true
  keyContextMenuId.value = null
}

const submitKeyForm = () => {
  const name = keyForm.name.trim() || 'new-key'
  const row: KeychainItem = {
    id: keyForm.id || `key-local-${Date.now()}`,
    name,
    type: keyForm.publicKey.includes('ed25519') ? 'ed25519' : 'rsa',
    privateKey: keyForm.privateKey || '-----BEGIN OPENSSH PRIVATE KEY-----',
    publicKey: keyForm.publicKey,
    passphrase: keyForm.passphrase
  }
  keychains.value = keyEditMode.value && keyForm.id ? keychains.value.map((key) => (key.id === keyForm.id ? row : key)) : [...keychains.value, row]
  selectedKeyId.value = row.id
  keyImportNotice.value = `${keyEditMode.value ? '已保存' : '已创建'} ${row.name}。`
  keyEditorOpen.value = false
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
  confirmState.action = () => {
    keychains.value = keychains.value.filter((item) => item.id !== keyId)
    selectedKeyId.value = selectedKeyId.value === keyId ? null : selectedKeyId.value
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

const handleKeyDrop = () => {
  keyDragOver.value = false
  keyImportNotice.value = '已读取密钥文件名，文件内容读取为本地占位。'
  if (!keyForm.name) keyForm.name = 'imported-key'
  if (!keyForm.privateKey) keyForm.privateKey = '-----BEGIN OPENSSH PRIVATE KEY-----'
}

const closeConfirm = () => {
  confirmState.open = false
  confirmState.action = null
  confirmInput.value = ''
}

const runConfirmAction = () => {
  if (confirmState.expectedText && confirmInput.value !== confirmState.expectedText) return
  confirmState.action?.()
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
</script>
