<template>
  <div
    class="assets-panel-native"
    :class="{ 'assets-panel-workspace-mode': isWorkspaceMode }"
  >
    <div
      v-if="isWorkspaceMode"
      class="asset-workspace-tabs"
      role="tablist"
      aria-label="资产管理"
    >
      <button
        v-for="entry in assetManagementEntries"
        :key="entry.key"
        type="button"
        class="asset-workspace-tab"
        :class="{ active: activeAssetView === entry.key }"
        :data-onboarding-id="entry.key === 'assetConfig' ? 'host-management-entry' : undefined"
        role="tab"
        :aria-selected="activeAssetView === entry.key"
        @click="openManagementEntry(entry.key)"
      >
        <component :is="entry.icon" />
        <span>{{ entry.name }}</span>
      </button>
    </div>

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

    <template v-else-if="activeAssetView === 'proxyManagement'">
      <div class="asset-proxy-management-page">
        <div class="asset-search-container">
          <div class="asset-search-row">
            <div class="asset-management-title">
              <strong>代理管理</strong>
              <small>SSH 代理作为资源配置供主机、数据库和文件会话复用。</small>
            </div>
            <button
              class="asset-action-button"
              @click="openProxyAddPanel()"
            >
              <Network />
              新增代理
            </button>
          </div>
        </div>
        <div class="asset-proxy-list">
          <div
            v-if="workspace.sshProxyConfigs.length"
            class="asset-table-scroll"
          >
            <table>
              <thead>
                <tr>
                  <th>名称</th>
                  <th>类型</th>
                  <th>地址</th>
                  <th>认证</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="proxy in workspace.sshProxyConfigs"
                  :key="proxy.name"
                >
                  <td>{{ proxy.name }}</td>
                  <td>{{ proxy.type }}</td>
                  <td>{{ proxy.host }}:{{ proxy.port }}</td>
                  <td>{{ proxy.enableProxyIdentity ? proxy.username || '-' : '无' }}</td>
                  <td>
                    <button @click="workspace.removeSshProxyConfig(proxy.name)">删除</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div
            v-else
            class="asset-empty-state"
          >
            <Network />
            <strong>暂无代理配置</strong>
            <small>添加后可在主机、数据库和远程文件会话中选择。</small>
            <div>
              <button @click="openProxyAddPanel()">新增代理</button>
            </div>
          </div>
        </div>
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

        <div
          v-if="keyEditorOpen"
          class="asset-host-modal file-modal"
        >
          <aside class="asset-form-panel key-form-panel asset-host-form-modal">
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
            <div class="asset-form-actions">
              <button
                class="asset-submit-button secondary"
                @click="keyEditorOpen = false"
              >
                取消
              </button>
              <button
                class="asset-submit-button"
                @click="submitKeyForm"
              >
                {{ keyEditMode ? '保存密钥' : '创建密钥' }}
              </button>
            </div>
          </aside>
        </div>
      </div>
    </template>

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

    <small
      v-if="importNotice"
      class="asset-panel-notice"
    >
      {{ importNotice }}
    </small>

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
  </div>
</template>

<script setup lang="ts">
import {
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Copy,
  Database,
  Download,
  Eye,
  EyeOff,
  Folder,
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
import AssetTreeGroupNode from '@/components/assets/AssetTreeGroupNode.vue'
import { useAssetsPanelRuntimeContext } from '@/services/assetsPanelContext'

const {
  assetManagementEntries,
  workspace,
  isWorkspaceMode,
  activeAssetView,
  managementQuery,
  assetQuery,
  editorOpen,
  editMode,
  selectedAssetId,
  assetContextMenuId,
  assetBlankContextMenuOpen,
  assetGroupContextMenuKey,
  contextPosition,
  importNotice,
  importHelpOpen,
  assetFormError,
  managedFormError,
  exportModalOpen,
  exportCheckedIds,
  exportQuery,
  selectedRows,
  assetTestLoading,
  assetTestMessage,
  assetTestOk,
  assetPasswordVisible,
  assets,
  form,
  keychains,
  assetGroupOptions,
  keyQuery,
  keyEditorOpen,
  keyEditMode,
  selectedKeyId,
  keyContextMenuId,
  keyContextPosition,
  keyDragOver,
  keyServiceNotice,
  keyImportNotice,
  keyFormError,
  keyForm,
  expandedAssetGroupKeys,
  assetFolderModal,
  assetFolderForm,
  assetFolderFormError,
  confirmInput,
  confirmState,
  importPreviewOpen,
  importPreviewAssets,
  managedEditorOpen,
  managedEditMode,
  managedCommentOnly,
  assetManagementQuery,
  assetManagementPage,
  assetManagementPageSize,
  managedForm,
  filteredManagementEntries,
  assetGroupAssetCount,
  filteredAssetGroups,
  flatFilteredAssets,
  contextAsset,
  jumpHostOptions,
  sshProxyOptions,
  filteredExportGroups,
  resolvedExportIds,
  managedAssets,
  isManagedGroupExpanded,
  toggleManagedGroup,
  assetManagementPageCount,
  pagedManagedRows,
  managedVisibleAllSelected,
  managedOrganizationTitle,
  importDuplicateCount,
  importPreviewSummary,
  filteredKeychains,
  toggleAssetGroup,
  openNewPanel,
  openNewPanelFromContext,
  closeAssetEditor,
  openCreateAssetFolder,
  openCreateAssetFolderFromContext,
  closeAssetFolderModal,
  submitAssetFolderForm,
  openManagementEntry,
  closeProxyModal,
  openProxyAddPanel,
  saveProxyFormFromAssetPanel,
  openKeyCreateFromHostForm,
  openJumpHostCreateFromHostForm,
  editAsset,
  cloneAsset,
  removeAsset,
  confirmBulkDelete,
  toggleManagedVisibleSelection,
  connectAsset,
  openAssetContextMenu,
  openAssetBlankContextMenu,
  openAssetGroupContextMenu,
  testAssetFormConnection,
  submitForm,
  refreshOrganizationAsset,
  openOrganizationManagement,
  openManagedAssetAdd,
  openManagedAssetEdit,
  submitManagedForm,
  refreshManagedAssets,
  isExportGroupChecked,
  toggleExportGroup,
  openExportModal,
  selectAllExportKeys,
  confirmExport,
  openImportDialog,
  closeImportPreview,
  confirmImportAssets,
  openNewKeyPanel,
  editKey,
  submitKeyForm,
  removeKey,
  openKeyContextMenu,
  openKeyImportDialog,
  handleKeyDrop,
  closeConfirm,
  runConfirmAction
} = useAssetsPanelRuntimeContext()
</script>
