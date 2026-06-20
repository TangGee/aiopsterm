<template>
  <div class="workspace-tree-panel">
    <div class="workspace-tabs">
      <button
        v-for="tab in workspaceTabs"
        :key="tab.key"
        :class="{ active: activeWorkspace === tab.key }"
        @click="activeWorkspace = tab.key"
      >
        {{ tab.label }}
      </button>
    </div>

    <div class="workspace-manage">
      <div class="workspace-search">
        <input
          v-model="searchValue"
          placeholder="搜索"
          @input="closeMenus"
        />
        <Search />
      </div>
      <button
        class="workspace-button"
        :title="showIpMode ? '显示主机名' : '显示 IP'"
        @click="toggleDisplayMode"
      >
        <Repeat2 />
      </button>
    </div>

    <div
      class="workspace-tree"
      @contextmenu.prevent="openBlankContextMenu"
      @dragover.prevent="handleBlankDragOver"
      @dragleave="handleBlankDragLeave"
      @drop.prevent="handleBlankDrop"
    >
      <template
        v-for="row in visibleTreeRows"
        :key="row.key"
      >
        <button
          v-if="row.kind === 'group'"
          class="workspace-folder-row"
          :class="{ 'custom-folder': row.group.type === 'custom-folder' || row.group.type === 'direct-group', 'drag-over': dragOverGroupKey === row.group.key }"
          :style="{ paddingLeft: `${6 + row.depth * 14}px` }"
          :draggable="canDragGroup(row.group)"
          @click="toggleGroup(row.group.key)"
          @contextmenu.prevent.stop="openGroupContextMenu($event, row.group.key)"
          @dragstart="handleGroupDragStart($event, row.group)"
          @dragover.prevent.stop="handleGroupDragOver($event, row.group)"
          @dragleave="handleGroupDragLeave(row.group.key)"
          @drop.prevent.stop="handleGroupDrop($event, row.group)"
          @dragend="clearDragState"
        >
          <ChevronDown v-if="isGroupExpanded(row.group.key)" />
          <ChevronRight v-else />
          <span>{{ row.group.title }}</span>
          <em>({{ assetGroupAssetCount(row.group) }})</em>
          <span
            v-if="activeWorkspace === 'bastion' && row.group.refreshable"
            class="workspace-row-action refresh"
            :title="refreshingGroupKey === row.group.key ? '刷新中' : '刷新'"
            @click.stop="refreshGroup(row.group.key)"
          >
            <RefreshCw :class="{ spinning: refreshingGroupKey === row.group.key }" />
          </span>
          <MoreHorizontal
            v-if="row.group.menu"
            class="workspace-row-more"
            @click.stop="openGroupContextMenu($event, row.group.key)"
          />
        </button>
        <div
          v-else
          class="workspace-host-row"
          :class="{ selected: selectedAssetId === row.asset.id, 'drag-over': dragOverAssetId === row.asset.id }"
          :style="{ paddingLeft: `${6 + row.depth * 14}px` }"
          role="button"
          tabindex="0"
          :draggable="canDragAsset(row.asset)"
          @click="selectAsset(row.asset.id)"
          @dblclick="connectAsset(row.asset.id)"
          @contextmenu.prevent.stop="openContextMenu($event, row.asset.id)"
          @dragstart="handleAssetDragStart($event, row.asset)"
          @dragover.prevent.stop="handleAssetDragOver($event, row.asset)"
          @dragleave="handleAssetDragLeave(row.asset.id)"
          @drop.prevent.stop="handleAssetDrop($event, row.asset)"
          @dragend="clearDragState"
        >
          <Laptop />
          <span>{{ displayAsset(row.asset) }}</span>
          <span
            v-if="commentAssetId === row.asset.id"
            class="workspace-comment-edit"
            @click.stop
          >
            <input
              v-model="editingComment"
              placeholder="备注"
              @keydown.enter.prevent="saveComment(row.asset.id)"
              @keydown.esc.prevent="cancelComment"
            />
            <button
              type="button"
              title="保存备注"
              @click="saveComment(row.asset.id)"
            >
              <Check />
            </button>
            <button
              type="button"
              title="取消备注"
              @click="cancelComment"
            >
              <X />
            </button>
          </span>
          <small v-else-if="row.asset.comment">({{ row.asset.comment }})</small>
          <Network
            v-if="row.asset.tunnelState"
            class="tunnel-icon"
            :class="{ active: row.asset.tunnelState === 'active' }"
            :title="row.asset.tunnelState === 'active' ? '隧道已连接' : '隧道已创建'"
          />
          <PlugZap
            v-if="row.asset.asset_type === 'organization'"
            class="tunnel-icon"
            title="堡垒机资源"
          />
          <MoreHorizontal
            class="workspace-row-more"
            @click.stop="openContextMenu($event, row.asset.id)"
          />
        </div>
      </template>
    </div>

    <div
      v-if="blankContextMenuVisible"
      class="asset-context-menu workspace-node-menu"
      :style="{ left: `${contextMenuPosition.x}px`, top: `${contextMenuPosition.y}px` }"
      @click.stop
    >
      <button @click="openCreateFolder()">
        <Folder />
        新建顶级分组
      </button>
      <button @click="openCreateHost()">
        <Laptop />
        新建主机
      </button>
    </div>

    <div
      v-if="contextMenuAssetId && contextAsset"
      class="asset-context-menu workspace-node-menu"
      :style="{ left: `${contextMenuPosition.x}px`, top: `${contextMenuPosition.y}px` }"
      @click.stop
    >
      <button
        v-if="contextAsset.favorite !== undefined"
        @click="toggleFavorite"
      >
        <Star />
        {{ contextAsset.favorite ? '取消收藏' : '加入收藏' }}
      </button>
      <button
        v-if="canCommentContextAsset"
        @click="openContextComment"
      >
        <Pencil />
        {{ contextAsset.comment ? '编辑备注' : '添加备注' }}
      </button>
      <button
        v-if="canMoveContextAsset"
        @click="openMoveModalFromContext"
      >
        <FolderInput />
        移动到文件夹
      </button>
      <button
        v-if="canRemoveContextAssetFromFolder"
        class="delete"
        @click="removeContextAssetFromFolder"
      >
        <FolderMinus />
        从文件夹移除
      </button>
      <button
        v-if="contextAsset.asset_type === 'person' && !contextAsset.isLocalShell"
        @click="toggleTunnel"
      >
        <Network />
        {{ contextAsset.tunnelState === 'active' ? '停止隧道' : '隧道' }}
      </button>
      <button
        v-if="canConnectContextAsset"
        @click="connectContextAsset"
      >
        <PlugZap />
        连接
      </button>
      <button
        v-if="!contextAsset.isLocalShell"
        @click="editContextAsset"
      >
        <Pencil />
        编辑
      </button>
      <button
        v-if="contextAsset.asset_type !== 'organization' && !contextAsset.isLocalShell"
        @click="cloneContextAsset"
      >
        <Copy />
        克隆
      </button>
      <button
        v-if="contextAsset.asset_type === 'organization'"
        @click="refreshContextOrganization"
      >
        <RefreshCw />
        刷新资产
      </button>
      <button
        v-if="contextAsset.asset_type === 'organization'"
        @click="openContextOrganizationManagement"
      >
        <Database />
        管理资产
      </button>
      <button
        v-if="!contextAsset.isLocalShell"
        class="delete"
        @click="openDeleteContextAsset"
      >
        <Trash2 />
        删除
      </button>
    </div>

    <div
      v-if="contextMenuGroupKey && contextGroup"
      class="asset-context-menu workspace-node-menu"
      :style="{ left: `${contextMenuPosition.x}px`, top: `${contextMenuPosition.y}px` }"
      @click.stop
    >
      <button
        v-if="canCreateChildInContextGroup"
        @click="openCreateFolder(contextGroup)"
      >
        <Folder />
        新建子分组
      </button>
      <button
        v-if="canCreateHostInContextGroup"
        @click="openCreateHost(contextGroup)"
      >
        <Laptop />
        新建主机
      </button>
      <button
        v-if="contextGroup.type === 'custom-folder' || contextGroup.type === 'direct-group'"
        @click="openEditGroup"
      >
        <Pencil />
        编辑文件夹
      </button>
      <button
        v-if="contextGroup.refreshable"
        @click="refreshGroup(contextGroup.key)"
      >
        <RefreshCw />
        刷新
      </button>
      <button
        v-if="contextGroup.type === 'organization'"
        @click="openGroupOrganizationManagement"
      >
        <Database />
        管理资产
      </button>
      <button
        v-if="contextGroup.type === 'custom-folder' || contextGroup.type === 'direct-group'"
        class="delete"
        @click="openDeleteGroup"
      >
        <Trash2 />
        删除文件夹
      </button>
      <button
        v-if="contextGroup.type === 'organization'"
        class="delete"
        @click="openDeleteGroupOrganization"
      >
        <Trash2 />
        删除
      </button>
    </div>

    <div
      v-if="folderModal.visible"
      class="files-folder-modal-backdrop"
    >
      <section class="files-folder-modal workspace-folder-modal">
        <header>
          <h3>{{ folderModal.mode === 'create' ? '创建文件夹' : '编辑文件夹' }}</h3>
          <button
            type="button"
            @click="closeFolderModal"
          >
            <X />
          </button>
        </header>
        <form
          class="files-folder-form"
          @submit.prevent="saveFolderForm"
        >
          <label>
            <span>文件夹名称 *</span>
            <input
              v-model="folderForm.name"
              placeholder="请输入文件夹名称"
            />
          </label>
          <label>
            <span>文件夹描述</span>
            <textarea
              v-model="folderForm.description"
              rows="3"
              placeholder="请输入文件夹描述"
            />
          </label>
          <p
            v-if="folderFormError"
            class="files-folder-error"
          >
            {{ folderFormError }}
          </p>
          <footer>
            <button
              type="button"
              @click="closeFolderModal"
            >
              取消
            </button>
            <button
              type="submit"
              class="primary"
            >
              确定
            </button>
          </footer>
        </form>
      </section>
    </div>

    <div
      v-if="moveModal.visible"
      class="files-folder-modal-backdrop"
    >
      <section class="files-folder-modal workspace-folder-modal">
        <header>
          <h3>移动到文件夹</h3>
          <button
            type="button"
            @click="closeMoveModal"
          >
            <X />
          </button>
        </header>
        <div
          v-if="targetMoveFolders.length === 0"
          class="files-folder-empty"
        >
          <p>暂无文件夹</p>
          <button @click="openCreateFolderFromMoveModal">创建文件夹</button>
        </div>
        <div
          v-else
          class="files-folder-list"
        >
          <p>选择文件夹:</p>
          <button
            v-for="folder in targetMoveFolders"
            :key="folder.uuid"
            class="files-folder-option"
            @click="moveAssetToFolder(folder.uuid)"
          >
            <strong>{{ folder.name }}</strong>
            <small v-if="folder.description">{{ folder.description }}</small>
          </button>
        </div>
      </section>
    </div>

    <div
      v-if="deleteGroupModal.visible && deleteGroupInfo"
      class="files-folder-modal-backdrop"
    >
      <section class="files-folder-modal files-folder-confirm workspace-folder-modal">
        <header>
          <h3>{{ deleteGroupInfo.kind === 'direct-group' ? '删除分组' : '删除文件夹' }}</h3>
          <button
            type="button"
            @click="closeDeleteGroupModal"
          >
            <X />
          </button>
        </header>
        <div class="files-folder-confirm-body">
          <p v-if="deleteGroupInfo.count > 0">
            确定删除{{ deleteGroupInfo.kind === 'direct-group' ? '分组' : '文件夹' }} {{ deleteGroupInfo.name }}？其中 {{ deleteGroupInfo.count }} 个主机将移出该{{ deleteGroupInfo.kind === 'direct-group' ? '分组' : '文件夹' }}。
          </p>
          <p v-else>确定删除{{ deleteGroupInfo.kind === 'direct-group' ? '分组' : '文件夹' }} {{ deleteGroupInfo.name }}？</p>
        </div>
        <footer>
          <button
            type="button"
            @click="closeDeleteGroupModal"
          >
            取消
          </button>
          <button
            type="button"
            class="danger"
            @click="confirmDeleteGroup"
          >
            删除
          </button>
        </footer>
      </section>
    </div>

    <div
      v-if="hostModal.visible"
      class="files-folder-modal-backdrop"
    >
      <section class="files-folder-modal workspace-host-modal">
        <header>
          <h3>{{ hostModalTitle }}</h3>
          <button
            type="button"
            @click="closeHostModal"
          >
            <X />
          </button>
        </header>
        <form
          class="workspace-host-form files-folder-form"
          @submit.prevent="saveHostForm"
        >
          <label>
            <span>设备类型</span>
            <select v-model="hostForm.assetType">
              <option value="person">服务器</option>
              <option value="switch">交换机</option>
              <option value="organization">堡垒机</option>
            </select>
          </label>
          <label>
            <span>主机名 *</span>
            <input
              v-model="hostForm.title"
              placeholder="请输入主机名"
            />
          </label>
          <label>
            <span>地址 *</span>
            <input
              v-model="hostForm.host"
              placeholder="请输入 IP 或 Host"
            />
          </label>
          <label>
            <span>认证方式</span>
            <select v-model="hostForm.authType">
              <option value="password">密码</option>
              <option value="keyBased">密钥</option>
            </select>
          </label>
          <label>
            <span>用户名 *</span>
            <input
              v-model="hostForm.username"
              placeholder="请输入用户名"
            />
          </label>
          <label v-if="hostForm.authType === 'password'">
            <span>密码</span>
            <div class="asset-secret-field">
              <input
                v-model="hostForm.password"
                :type="hostPasswordVisible ? 'text' : 'password'"
                :placeholder="hostModal.mode === 'create' ? '' : '清空将删除已保存密码'"
                autocomplete="new-password"
              />
              <button
                type="button"
                class="asset-secret-toggle"
                :title="hostPasswordVisible ? '隐藏密码' : '显示密码'"
                @click="hostPasswordVisible = !hostPasswordVisible"
              >
                <EyeOff v-if="hostPasswordVisible" />
                <Eye v-else />
              </button>
            </div>
          </label>
          <label v-if="hostForm.authType === 'keyBased'">
            <span class="workspace-field-heading">
              KeyChain
              <button
                type="button"
                @click="openKeyManagementFromHostForm"
              >
                新建密钥
              </button>
            </span>
            <select v-model="hostForm.keychainId">
              <option value="">不使用 KeyChain</option>
              <option
                v-for="keychain in keychainOptions"
                :key="keychain.id"
                :value="keychain.id"
              >
                {{ keychain.name }}
              </option>
            </select>
          </label>
          <label v-if="hostModal.mode !== 'create'">
            <span>分组</span>
            <input
              v-model="hostForm.group"
              list="workspace-host-group-options"
              placeholder="请输入分组"
            />
            <datalist id="workspace-host-group-options">
              <option
                v-for="group in hostGroupOptions"
                :key="group.key"
                :value="group.name"
              />
            </datalist>
          </label>
          <label>
            <span>端口 *</span>
            <input
              v-model="hostForm.port"
              inputmode="numeric"
              placeholder="22"
            />
          </label>
          <label>
            <span class="workspace-field-heading">
              代理
              <button
                type="button"
                @click="openProxyManagementFromHostForm"
              >
                新增代理
              </button>
            </span>
            <select
              v-if="workspace.sshProxyConfigs.length"
              v-model="hostForm.proxyName"
            >
              <option value="">不使用代理</option>
              <option
                v-for="proxy in workspace.sshProxyConfigs"
                :key="proxy.name"
                :value="proxy.name"
              >
                {{ proxy.name }}
              </option>
            </select>
            <div
              v-else
              class="asset-proxy-empty workspace-host-inline-empty"
            >
              <small>暂无 SSH 代理配置</small>
              <button
                type="button"
                @click="openProxyManagementFromHostForm"
              >
                添加代理
              </button>
            </div>
          </label>
          <label>
            <span class="workspace-field-heading">
              登录跳板机
              <button
                type="button"
                @click="openJumpHostCreateFromHostForm"
              >
                新建跳板机
              </button>
            </span>
            <select
              v-if="jumpHostOptions.length"
              v-model="hostForm.jumpHostId"
            >
              <option value="">不使用跳板机</option>
              <option
                v-for="jumpHost in jumpHostOptions"
                :key="jumpHost.id"
                :value="jumpHost.id"
              >
                {{ jumpHost.name }}
              </option>
            </select>
            <div
              v-else
              class="asset-proxy-empty workspace-host-inline-empty"
            >
              <small>暂无可用跳板机主机</small>
              <button
                type="button"
                @click="openJumpHostCreateFromHostForm"
              >
                新建跳板机
              </button>
            </div>
          </label>
          <label class="workspace-host-form-wide">
            <span>备注</span>
            <textarea
              v-model="hostForm.comment"
              rows="3"
              placeholder="请输入备注"
            />
          </label>
          <p
            v-if="hostFormError"
            class="files-folder-error workspace-host-form-wide"
          >
            {{ hostFormError }}
          </p>
          <p
            v-if="hostTestMessage"
            class="files-folder-error workspace-host-form-wide asset-connection-test-result"
            :class="{ success: hostTestOk }"
          >
            {{ hostTestMessage }}
          </p>
          <footer class="workspace-host-form-wide">
            <button
              type="button"
              data-testid="workspace-host-test-connection"
              :disabled="hostTestLoading"
              @click="testHostFormConnection"
            >
              {{ hostTestLoading ? '测试中' : '测试连接' }}
            </button>
            <button
              type="button"
              @click="closeHostModal"
            >
              取消
            </button>
            <button
              type="submit"
              class="primary"
            >
              确定
            </button>
          </footer>
        </form>
      </section>
    </div>

    <div
      v-if="hostChildModal === 'proxy'"
      class="files-folder-modal-backdrop workspace-child-modal-backdrop"
    >
      <section class="files-folder-modal workspace-child-modal workspace-proxy-child-modal asset-proxy-form-modal">
        <header>
          <h3>新增代理</h3>
          <button
            type="button"
            @click="closeHostChildModal"
          >
            <X />
          </button>
        </header>
        <form
          class="files-folder-form workspace-proxy-form"
          @submit.prevent="saveHostProxyForm"
        >
          <label>
            <span>名称 *</span>
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
            <span>主机 *</span>
            <input
              :value="workspace.sshProxyForm.host"
              @input="workspace.updateSshProxyForm({ host: ($event.target as HTMLInputElement).value })"
            />
          </label>
          <label class="workspace-port-field">
            <span>端口 *</span>
            <input
              type="number"
              :value="workspace.sshProxyForm.port"
              @input="workspace.updateSshProxyForm({ port: Number(($event.target as HTMLInputElement).value) })"
            />
          </label>
          <label class="asset-inline-check workspace-host-form-wide">
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
          <p
            v-if="hostChildFormError"
            class="files-folder-error workspace-host-form-wide"
          >
            {{ hostChildFormError }}
          </p>
          <footer class="workspace-host-form-wide">
            <button
              type="button"
              @click="closeHostChildModal"
            >
              取消
            </button>
            <button
              type="submit"
              class="primary"
            >
              保存
            </button>
          </footer>
        </form>
      </section>
    </div>

    <div
      v-if="hostChildModal === 'key'"
      class="files-folder-modal-backdrop workspace-child-modal-backdrop"
    >
      <section class="files-folder-modal workspace-child-modal workspace-key-child-modal key-form-panel">
        <header>
          <h3>新建密钥</h3>
          <button
            type="button"
            @click="closeHostChildModal"
          >
            <X />
          </button>
        </header>
        <form
          class="files-folder-form workspace-key-form"
          @submit.prevent="saveHostKeyForm"
        >
          <label>
            <span>名称 *</span>
            <input v-model="hostKeyForm.name" />
          </label>
          <label class="workspace-host-form-wide">
            <span>私钥 *</span>
            <textarea
              v-model="hostKeyForm.privateKey"
              spellcheck="false"
              rows="6"
            />
          </label>
          <label class="workspace-host-form-wide">
            <span>公钥</span>
            <textarea
              v-model="hostKeyForm.publicKey"
              spellcheck="false"
              rows="3"
            />
          </label>
          <label>
            <span>Passphrase</span>
            <input
              v-model="hostKeyForm.passphrase"
              type="password"
            />
          </label>
          <div
            class="key-drop-area workspace-host-form-wide"
            :class="{ 'drag-over': hostKeyDragOver }"
            @dragover.prevent
            @dragenter.prevent="hostKeyDragOver = true"
            @dragleave.prevent="hostKeyDragOver = false"
            @drop.prevent="handleHostKeyDrop"
            @click="openHostKeyImportDialog"
          >
            <Upload />
            <span>拖拽或点击导入密钥文件</span>
          </div>
          <p
            v-if="hostChildFormError"
            class="files-folder-error workspace-host-form-wide"
          >
            {{ hostChildFormError }}
          </p>
          <footer class="workspace-host-form-wide">
            <button
              type="button"
              @click="closeHostChildModal"
            >
              取消
            </button>
            <button
              type="submit"
              class="primary"
            >
              保存
            </button>
          </footer>
        </form>
      </section>
    </div>

    <div
      v-if="hostChildModal === 'jumpHost'"
      class="files-folder-modal-backdrop workspace-child-modal-backdrop"
    >
      <section class="files-folder-modal workspace-host-modal workspace-jump-child-modal">
        <header>
          <h3>新建跳板机</h3>
          <button
            type="button"
            @click="closeHostChildModal"
          >
            <X />
          </button>
        </header>
        <form
          class="workspace-host-form files-folder-form"
          @submit.prevent="saveHostJumpHostForm"
        >
          <label>
            <span>主机名 *</span>
            <input
              v-model="hostJumpForm.title"
              placeholder="jump-host"
            />
          </label>
          <label>
            <span>地址 *</span>
            <input v-model="hostJumpForm.host" />
          </label>
          <label>
            <span>认证方式</span>
            <select v-model="hostJumpForm.authType">
              <option value="password">密码</option>
              <option value="keyBased">密钥</option>
            </select>
          </label>
          <label>
            <span>用户名 *</span>
            <input v-model="hostJumpForm.username" />
          </label>
          <label v-if="hostJumpForm.authType === 'password'">
            <span>密码</span>
            <div class="asset-secret-field">
              <input
                v-model="hostJumpForm.password"
                :type="hostJumpPasswordVisible ? 'text' : 'password'"
                autocomplete="new-password"
              />
              <button
                type="button"
                class="asset-secret-toggle"
                :title="hostJumpPasswordVisible ? '隐藏密码' : '显示密码'"
                @click="hostJumpPasswordVisible = !hostJumpPasswordVisible"
              >
                <EyeOff v-if="hostJumpPasswordVisible" />
                <Eye v-else />
              </button>
            </div>
          </label>
          <label v-else>
            <span>KeyChain</span>
            <select v-model="hostJumpForm.keychainId">
              <option value="">不使用 KeyChain</option>
              <option
                v-for="keychain in keychainOptions"
                :key="keychain.id"
                :value="keychain.id"
              >
                {{ keychain.name }}
              </option>
            </select>
          </label>
          <label>
            <span>端口 *</span>
            <input
              v-model="hostJumpForm.port"
              inputmode="numeric"
            />
          </label>
          <label>
            <span>分组</span>
            <input v-model="hostJumpForm.group" />
          </label>
          <label class="workspace-host-form-wide">
            <span>备注</span>
            <textarea
              v-model="hostJumpForm.comment"
              rows="3"
              placeholder="请输入备注"
            />
          </label>
          <p
            v-if="hostChildFormError"
            class="files-folder-error workspace-host-form-wide"
          >
            {{ hostChildFormError }}
          </p>
          <footer class="workspace-host-form-wide">
            <button
              type="button"
              @click="closeHostChildModal"
            >
              取消
            </button>
            <button
              type="submit"
              class="primary"
            >
              保存
            </button>
          </footer>
        </form>
      </section>
    </div>

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

    <div
      v-if="notice"
      class="workspace-notice"
    >
      {{ notice }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Database,
  Eye,
  EyeOff,
  Folder,
  FolderInput,
  FolderMinus,
  Laptop,
  MoreHorizontal,
  Network,
  Pencil,
  PlugZap,
  RefreshCw,
  Repeat2,
  Search,
  Star,
  Trash2,
  Upload,
  X
} from 'lucide-vue-next'
import type {
  AiopsAssetAuthType,
  AiopsAssetGroupRecord,
  AiopsAssetInput,
  AiopsAssetRecord,
  AiopsAssetType,
  AiopsCustomFolderRecord,
  AiopsCustomFolderSaveInput,
  AiopsKeychainInput,
  AiopsKeychainRecord,
  AiopsKeychainType,
  AiopsSshTunnelMutationResult,
  AiopsSshTunnelType
} from '@shared/contracts/assets'
import { useWorkspaceStore } from '@/stores/workspace'
import {
  isAiopsAssetConnectionTestInfo,
  isAiopsAssetGroupDeleteSnapshot,
  isAiopsAssetGroupListData,
  isAiopsAssetGroupRenameSnapshot,
  isAiopsAssetSnapshot,
  isAiopsDeletedAssetData,
  isAiopsDeletedCustomFolderData,
  isAiopsJumpserverOrganizationAssetRefreshData,
  isAiopsKeychainListData,
  isAiopsKeychainRecord,
  isAiopsSavedAssetRecord,
  isAiopsSavedCustomFolderRecord,
  isAiopsSshTunnelMutationData,
  malformedAssetBackendResultMessage
} from '@/services/assetBackendGuards'
import { openLocalTerminalLaunch, openSshTerminalLaunch } from '@/services/terminalLaunchRuntime'

const workspace = useWorkspaceStore()
type WorkspaceTabKey = 'direct' | 'bastion'
type HostModalMode = 'create' | 'edit' | 'clone'
type FolderModalMode = 'create' | 'edit-custom' | 'edit-direct'
type WorkspaceAssetType = AiopsAssetType
type WorkspaceTunnelType = AiopsSshTunnelType

const workspaceTabs: Array<{ key: WorkspaceTabKey; label: string }> = [
  { key: 'direct', label: '直接连接' },
  { key: 'bastion', label: '堡垒机资源' }
]

type WorkspaceAsset = AiopsAssetRecord & {
  isLocalShell?: boolean
}

type WorkspaceGroup = {
  key: string
  title: string
  children: WorkspaceAsset[]
  childGroups: WorkspaceGroup[]
  originalCount: number
  type: 'system' | 'direct-group' | 'organization' | 'custom-folder'
  refreshable?: boolean
  menu?: boolean
  parentKey?: string
  folderUuid?: string
  groupName?: string
  organizationId?: string
}

type CustomFolder = AiopsCustomFolderRecord

type WorkspaceTreeRow =
  | { key: string; kind: 'group'; group: WorkspaceGroup; depth: number }
  | { key: string; kind: 'asset'; asset: WorkspaceAsset; depth: number; parentGroupKey: string }

const activeWorkspace = ref<WorkspaceTabKey>('direct')
const searchValue = ref('')
const selectedAssetId = ref<string | null>(null)
const contextMenuAssetId = ref<string | null>(null)
const contextMenuGroupKey = ref<string | null>(null)
const blankContextMenuVisible = ref(false)
const contextMenuPosition = reactive({ x: 0, y: 0 })
const refreshingGroupKey = ref('')
const notice = ref('')
const commentAssetId = ref('')
const editingComment = ref('')
const assetBackendReady = ref(false)
const dragState = reactive({ kind: '' as '' | 'asset' | 'group', assetId: '', groupKey: '' })
const dragOverGroupKey = ref('')
const dragOverAssetId = ref('')

const workspaceAssets = ref<WorkspaceAsset[]>([])

const customFolders = ref<CustomFolder[]>([])
const directGroupOptions = ref<AiopsAssetGroupRecord[]>([])
const keychainOptions = ref<AiopsKeychainRecord[]>([])

const folderModal = reactive({ visible: false, mode: 'create' as FolderModalMode, targetKey: '', parentKey: '', fromMove: false })
const folderForm = reactive({ name: '', description: '' })
const folderFormError = ref('')
const moveModal = reactive({ visible: false, assetId: '' })
const deleteGroupModal = reactive({ visible: false, groupKey: '' })
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
  jumpHostId: ''
})
const hostFormError = ref('')
const hostTestLoading = ref(false)
const hostTestMessage = ref('')
const hostTestOk = ref(false)
const hostPasswordVisible = ref(false)
const hostJumpPasswordVisible = ref(false)
let hostSecretRequestId = 0
const hostChildModal = ref<'' | 'proxy' | 'key' | 'jumpHost'>('')
const hostChildFormError = ref('')
const hostKeyForm = reactive({
  name: '',
  privateKey: '',
  publicKey: '',
  passphrase: ''
})
const hostKeyDragOver = ref(false)
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
const deleteAssetModal = reactive({ visible: false, assetId: '' })
const managementModal = reactive({ visible: false, organizationId: '', query: '' })
const tunnelModal = reactive({ visible: false, assetId: '' })
const tunnelForm = reactive({
  type: 'local_forward' as WorkspaceTunnelType,
  localPort: '3306',
  remoteHost: 'localhost',
  remotePort: '3306'
})
const tunnelFormError = ref('')
const tunnelSubmitting = ref(false)

const localShellAssets = computed(() => workspaceAssets.value.filter((asset) => asset.isLocalShell))
const directAssets = computed(() => workspaceAssets.value.filter((asset) => !asset.isLocalShell && (asset.asset_type === 'person' || asset.asset_type === 'switch')))
const organizationAssets = computed(() => workspaceAssets.value.filter((asset) => !asset.isLocalShell && asset.asset_type === 'organization'))
const bastionResourceAssets = computed(() => workspaceAssets.value.filter((asset) => !asset.isLocalShell && asset.asset_type !== 'organization' && (asset.organizationId || asset.folderUuid)))
const showIpMode = computed(() => workspace.workspacePreferences.showIpMode)
const expandedGroups = computed(() => workspace.workspacePreferences.expandedGroups)
const recentAssetIds = computed(() => workspace.workspacePreferences.recentAssetIds || [])
const directFolders = computed(() => customFolders.value.filter((folder) => folder.scope === 'direct'))
const bastionFolders = computed(() => customFolders.value.filter((folder) => folder.scope !== 'direct'))
const targetMoveFolders = computed(() => (activeWorkspace.value === 'direct' ? directFolders.value : bastionFolders.value))
const firstDirectGroupName = computed(() => directFolders.value[0]?.name || directGroupOptions.value[0]?.name || '')
const hostGroupOptions = computed(() => {
  if (activeWorkspace.value === 'direct') {
    const folderOptions = directFolders.value.map((folder) => ({ key: folder.uuid, name: folder.name, count: directAssets.value.filter((asset) => assetGroupName(asset) === folder.name).length }))
    const optionNames = new Set(folderOptions.map((group) => group.name))
    return [...folderOptions, ...directGroupOptions.value.filter((group) => !optionNames.has(group.name))]
  }
  return [
    ...organizationAssets.value.map((asset) => ({ key: asset.uuid, name: asset.name, count: 1 })),
    ...bastionFolders.value.map((folder) => ({ key: folder.uuid, name: folder.name, count: bastionResourceAssets.value.filter((asset) => asset.folderUuid === folder.uuid).length }))
  ]
})
const jumpHostOptions = computed(() =>
  workspaceAssets.value.filter((asset) => !asset.isLocalShell && asset.asset_type !== 'organization' && asset.id !== hostModal.assetId)
)

const ungroupedGroupName = '未分组'
const normalizeDirectGroupName = (name?: string) => {
  const trimmed = String(name || '').trim()
  return !trimmed || trimmed === 'Hosts' ? ungroupedGroupName : trimmed
}
const assetGroupName = (asset: WorkspaceAsset) => normalizeDirectGroupName(asset.group || asset.group_name)
const folderScopeMatches = (folder: CustomFolder, scope: WorkspaceTabKey) => (scope === 'direct' ? folder.scope === 'direct' : folder.scope !== 'direct')
const directGroupKey = (name: string) => `group-${name}`
const folderGroupKey = (folder: CustomFolder) => (folder.scope === 'direct' ? directGroupKey(folder.name) : folder.uuid)

const makeGroup = (input: Omit<WorkspaceGroup, 'childGroups' | 'children'> & Partial<Pick<WorkspaceGroup, 'children' | 'childGroups'>>): WorkspaceGroup => ({
  ...input,
  children: input.children || [],
  childGroups: input.childGroups || []
})

const isDescendantGroup = (groupKey: string, possibleDescendantKey: string): boolean => {
  const walk = (group: WorkspaceGroup): boolean => group.childGroups.some((child) => child.key === possibleDescendantKey || walk(child))
  const root = sourceGroups.value.find((group) => group.key === groupKey) || sourceGroups.value.flatMap((group) => flattenGroups(group)).find((group) => group.key === groupKey)
  return root ? walk(root) : false
}

const flattenGroups = (group: WorkspaceGroup): WorkspaceGroup[] => [group, ...group.childGroups.flatMap(flattenGroups)]

const buildDirectGroups = (): WorkspaceGroup[] => {
  const source = directAssets.value
  const localAssets = localShellAssets.value
  const foldersByName = new Map(directFolders.value.map((folder) => [folder.name, folder]))
  const groupNames = [...new Set([...directFolders.value.map((folder) => folder.name), ...source.map((asset) => normalizeDirectGroupName(assetGroupName(asset)))])].filter(Boolean)
  const groupsByName = new Map<string, WorkspaceGroup>()
  groupNames.forEach((name) => {
    const folder = foldersByName.get(name)
    const parentFolder = folder?.parentUuid ? directFolders.value.find((item) => item.uuid === folder.parentUuid) : null
    const children = source.filter((asset) => normalizeDirectGroupName(assetGroupName(asset)) === name)
    groupsByName.set(
      name,
      makeGroup({
        key: directGroupKey(name),
        title: name,
        children,
        originalCount: children.length,
        type: 'direct-group',
        menu: true,
        groupName: name,
        ...(parentFolder ? { parentKey: directGroupKey(parentFolder.name) } : {}),
        ...(folder ? { folderUuid: folder.uuid } : {})
      })
    )
  })
  const roots: WorkspaceGroup[] = []
  groupsByName.forEach((group) => {
    if (group.parentKey && groupsByName.size) {
      const parent = [...groupsByName.values()].find((item) => item.key === group.parentKey)
      if (parent && parent.key !== group.key) {
        parent.childGroups.push(group)
        return
      }
    }
    roots.push(group)
  })
  const recentChildren = recentAssetIds.value.map((id) => source.find((asset) => asset.id === id)).filter((asset): asset is WorkspaceAsset => Boolean(asset))
  const groups: WorkspaceGroup[] = [
    makeGroup({
      key: 'recent_connections',
      title: '最近连接',
      children: recentChildren,
      originalCount: recentChildren.length,
      type: 'system',
      menu: false
    }),
    ...roots,
    makeGroup({
      key: 'local_connections',
      title: '本地连接',
      children: localAssets,
      originalCount: localAssets.length,
      type: 'system',
      menu: false
    })
  ]
  return groups.filter((group) => group.children.length > 0 || group.childGroups.length > 0 || group.type !== 'system')
}

const buildBastionGroups = (): WorkspaceGroup[] => {
  const folderGroupsByUuid = new Map(
    bastionFolders.value.map((folder) => {
      const children = bastionResourceAssets.value.filter((asset) => asset.folderUuid === folder.uuid)
      return [
        folder.uuid,
        makeGroup({
          key: folder.uuid,
          title: folder.name,
          children,
          originalCount: children.length,
          type: 'custom-folder' as const,
          refreshable: false,
          menu: true,
          folderUuid: folder.uuid,
          ...(folder.parentUuid ? { parentKey: folder.parentUuid } : {})
        })
      ] as const
    })
  )
  const folderRoots: WorkspaceGroup[] = []
  folderGroupsByUuid.forEach((group) => {
    const parent = group.parentKey ? folderGroupsByUuid.get(group.parentKey) : null
    if (parent && parent.key !== group.key) parent.childGroups.push(group)
    else folderRoots.push(group)
  })
  const orgGroups = organizationAssets.value.map((org) => {
    const children = [
      org,
      ...bastionResourceAssets.value.filter((asset) => !asset.folderUuid && (!asset.organizationId || asset.organizationId === org.uuid))
    ]
    return makeGroup({
      key: org.uuid,
      title: org.name,
      children,
      originalCount: children.length,
      type: 'organization' as const,
      refreshable: true,
      menu: true,
      organizationId: org.uuid
    })
  })

  return [...orgGroups, ...folderRoots]
}

const sourceGroups = computed(() => (activeWorkspace.value === 'direct' ? buildDirectGroups() : buildBastionGroups()))

const filterGroupTree = (group: WorkspaceGroup, keyword: string): WorkspaceGroup | null => {
  const groupMatches = `${group.title} ${group.folderUuid || ''}`.toLowerCase().includes(keyword)
  const childGroups = group.childGroups.map((child) => filterGroupTree(child, keyword)).filter((child): child is WorkspaceGroup => Boolean(child))
  const children = groupMatches
    ? group.children
    : group.children.filter((asset) =>
        `${asset.title} ${asset.name} ${asset.host} ${asset.ip} ${asset.username} ${asset.comment || ''}`.toLowerCase().includes(keyword)
      )
  if (!groupMatches && childGroups.length === 0 && children.length === 0) return null
  return {
    ...group,
    children,
    childGroups,
    originalCount: group.originalCount
  }
}

const filteredGroups = computed(() => {
  const keyword = searchValue.value.trim().toLowerCase()
  if (!keyword) return sourceGroups.value
  return sourceGroups.value.map((group) => filterGroupTree(group, keyword)).filter((group): group is WorkspaceGroup => Boolean(group))
})

const collectGroupAssets = (group: WorkspaceGroup): WorkspaceAsset[] => [...group.children, ...group.childGroups.flatMap(collectGroupAssets)]
const assetGroupAssetCount = (group: WorkspaceGroup): number => collectGroupAssets(group).length
const collectTreeRows = (groups: WorkspaceGroup[], depth = 0): WorkspaceTreeRow[] =>
  groups.flatMap((group) => {
    const rows: WorkspaceTreeRow[] = [{ key: `group-row-${group.key}`, kind: 'group', group, depth }]
    if (isGroupExpanded(group.key)) {
      rows.push(...collectTreeRows(group.childGroups, depth + 1))
      rows.push(...group.children.map((asset) => ({ key: `asset-row-${group.key}-${asset.id}`, kind: 'asset' as const, asset, depth: depth + 1, parentGroupKey: group.key })))
    }
    return rows
  })
const visibleTreeRows = computed(() => collectTreeRows(filteredGroups.value))
const allAssets = computed(() => sourceGroups.value.flatMap(collectGroupAssets))
const contextAsset = computed(() => allAssets.value.find((asset) => asset.id === contextMenuAssetId.value) || null)
const contextGroup = computed(() => sourceGroups.value.flatMap(flattenGroups).find((group) => group.key === contextMenuGroupKey.value) || null)
const canCommentContextAsset = computed(() => activeWorkspace.value === 'bastion' && !!contextAsset.value && !contextAsset.value.isLocalShell)
const canMoveContextAsset = computed(
  () => activeWorkspace.value === 'bastion' && !!contextAsset.value && !contextAsset.value.isLocalShell && contextAsset.value.asset_type !== 'organization' && !contextAsset.value.folderUuid
)
const canRemoveContextAssetFromFolder = computed(() => activeWorkspace.value === 'bastion' && !!contextAsset.value?.folderUuid && !contextAsset.value.isLocalShell)
const canConnectContextAsset = computed(() => !!contextAsset.value)
const canCreateChildInContextGroup = computed(() => !!contextGroup.value && (contextGroup.value.type === 'direct-group' || contextGroup.value.type === 'custom-folder'))
const canCreateHostInContextGroup = computed(() => !!contextGroup.value && contextGroup.value.type !== 'system')
const tunnelAsset = computed(() => findEditableAsset(tunnelModal.assetId))
const hostModalTitle = computed(() => {
  if (hostModal.mode === 'edit') return '编辑主机'
  if (hostModal.mode === 'clone') return '克隆主机'
  return '新建主机'
})
const tunnelTypeOptions: Array<{ value: WorkspaceTunnelType; label: string; description: string }> = [
  {
    value: 'local_forward',
    label: '访问远端服务',
    description: '把远端服务映射成本机端口'
  },
  {
    value: 'remote_forward',
    label: '暴露本地服务',
    description: '把本地端口暴露到远端主机'
  },
  {
    value: 'dynamic_socks',
    label: '动态 SOCKS',
    description: '在本机启动 SOCKS5 代理'
  }
]
const deleteAssetInfo = computed(() => workspaceAssets.value.find((asset) => asset.id === deleteAssetModal.assetId) || null)
const deleteGroupInfo = computed(() => {
  const group = groupByKey(deleteGroupModal.groupKey)
  if (!group) return null
  return {
    key: group.key,
    name: group.title,
    count: group.originalCount,
    kind: group.type
  }
})
const managedOrganization = computed(() => organizationAssets.value.find((asset) => asset.uuid === managementModal.organizationId) || null)
const managedOrganizationAssets = computed(() => {
  const keyword = managementModal.query.trim().toLowerCase()
  return bastionResourceAssets.value
    .filter((asset) => !managementModal.organizationId || asset.organizationId === managementModal.organizationId)
    .filter((asset) => {
      if (!keyword) return true
      return `${asset.name} ${asset.host} ${asset.username} ${asset.comment || ''}`.toLowerCase().includes(keyword)
    })
})

const findEditableAsset = (assetId: string) => workspaceAssets.value.find((item) => item.id === assetId) || null

const toAssetInput = (asset: WorkspaceAsset, patch: Partial<AiopsAssetInput> = {}): AiopsAssetInput => ({
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
  jumpHostId: asset.jumpHostId,
  ...patch
})

const applyWorkspaceAssetSnapshot = (snapshot: unknown) => {
  if (!isAiopsAssetSnapshot(snapshot)) return false
  workspaceAssets.value = snapshot.assets.map((asset) => ({ ...asset, tags: [...asset.tags] }))
  customFolders.value = snapshot.folders.map((folder) => ({ ...folder }))
  assetBackendReady.value = true
  return true
}

const applyWorkspaceAssetState = (snapshot: unknown, groups: AiopsAssetGroupRecord[]) => {
  if (!isAiopsAssetSnapshot(snapshot)) throw new Error(malformedAssetBackendResultMessage)
  if (!isAiopsAssetGroupListData(groups)) throw new Error(malformedAssetBackendResultMessage)
  applyWorkspaceAssetSnapshot(snapshot)
  directGroupOptions.value = groups
  return snapshot
}

const loadDirectGroupOptions = async () => {
  const listAssetGroups = window.aiops?.listAssetGroups
  if (typeof listAssetGroups !== 'function') throw new Error('资产分组服务不可用')
  const groups = await listAssetGroups({
    assetTypes: ['person', 'switch']
  })
  if (!isAiopsAssetGroupListData(groups)) throw new Error(malformedAssetBackendResultMessage)
  return groups.map((group) => ({ ...group }))
}

const refreshAssets = async () => {
  const listAssets = window.aiops?.listAssets
  if (typeof listAssets !== 'function') throw new Error('资产列表服务不可用')
  const snapshot = await listAssets()
  if (!isAiopsAssetSnapshot(snapshot)) throw new Error(malformedAssetBackendResultMessage)
  const groups = await loadDirectGroupOptions()
  return applyWorkspaceAssetState(snapshot, groups)
}

const loadWorkspaceAssetRefresh = async () => {
  const listAssets = window.aiops?.listAssets
  if (typeof listAssets !== 'function') throw new Error('资产列表服务不可用')
  const snapshot = await listAssets()
  if (!isAiopsAssetSnapshot(snapshot)) throw new Error(malformedAssetBackendResultMessage)
  const groups = await loadDirectGroupOptions()
  return { snapshot, groups }
}

const loadKeychainOptions = async () => {
  const listKeychains = window.aiops?.listKeychains
  if (typeof listKeychains !== 'function') {
    keychainOptions.value = []
    return
  }
  const keychains = await listKeychains()
  if (!isAiopsKeychainListData(keychains)) throw new Error(malformedAssetBackendResultMessage)
  keychainOptions.value = keychains.map((keychain) => ({ ...keychain }))
}

const resetHostConnectionTest = () => {
  hostTestLoading.value = false
  hostTestMessage.value = ''
  hostTestOk.value = false
}

const saveAssetRecord = async (input: AiopsAssetInput) => {
  const saveAsset = window.aiops?.saveAsset
  if (typeof saveAsset !== 'function') {
    throw new Error('资产保存服务不可用')
  }
  const result = await saveAsset(input)
  if (!result?.ok) throw new Error(result?.errorMessage || '资产保存失败')
  const saved = result.data
  if (!isAiopsSavedAssetRecord(saved, input)) throw new Error(malformedAssetBackendResultMessage)
  const { snapshot, groups } = await loadWorkspaceAssetRefresh()
  if (!snapshot.assets.some((asset) => asset.id === saved.id)) throw new Error(malformedAssetBackendResultMessage)
  applyWorkspaceAssetState(snapshot, groups)
  return saved
}

const detectHostKeyType = (privateKey = '', publicKey = ''): AiopsKeychainType => {
  const publicAlgorithm = publicKey.trim().split(/\s+/)[0]?.toLowerCase()
  if (publicAlgorithm === 'ssh-ed25519') return 'ed25519'
  if (publicAlgorithm === 'ssh-rsa') return 'rsa'
  if (publicAlgorithm?.startsWith('ecdsa-')) return 'ecdsa'
  if (privateKey.includes('ssh-ed25519')) return 'ed25519'
  if (privateKey.includes('BEGIN EC PRIVATE KEY') || privateKey.includes('ecdsa-sha2')) return 'ecdsa'
  return 'rsa'
}

const localFileName = (filePath: string) => filePath.split(/[/\\]/).filter(Boolean).at(-1) || filePath

const readLocalTextFile = async (filePath: string, unavailableMessage: string) => {
  const readLocalFile = window.aiops?.readLocalFile
  if (typeof readLocalFile !== 'function') throw new Error(unavailableMessage)
  const result = await readLocalFile(filePath)
  return result.content
}

const applyImportedHostKeyFile = (fileName: string, content: string) => {
  const text = content.trim()
  if (!text) {
    hostChildFormError.value = '密钥文件为空'
    return
  }
  hostKeyForm.privateKey = text
  hostChildFormError.value = `已导入 ${fileName}，识别为 ${detectHostKeyType(hostKeyForm.privateKey, hostKeyForm.publicKey).toUpperCase()}`
}

const importHostKeyFileFromPath = async (filePath: string) => {
  if (!filePath) {
    hostChildFormError.value = '没有选择密钥文件'
    return
  }
  try {
    const content = await readLocalTextFile(filePath, '密钥文件读取服务不可用')
    applyImportedHostKeyFile(localFileName(filePath), content)
  } catch (error) {
    hostChildFormError.value = error instanceof Error ? error.message : '密钥文件读取失败'
  }
}

const openHostKeyImportDialog = async () => {
  const showOpenDialog = window.aiops?.showOpenDialog
  if (typeof showOpenDialog !== 'function') {
    hostChildFormError.value = '密钥文件选择服务不可用'
    return
  }
  try {
    const result = await showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Key Files', extensions: ['pem', 'key', 'txt', 'pub', 'asc', 'crt', 'cer', 'der', 'p12', 'pfx', 'ssh', 'ppk', 'gpg'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (result?.canceled) return
    await importHostKeyFileFromPath(result?.filePaths?.[0] || '')
  } catch {
    hostChildFormError.value = '密钥文件选择失败'
  }
}

const handleHostKeyDrop = async (event: DragEvent) => {
  hostKeyDragOver.value = false
  const file = event.dataTransfer?.files?.[0]
  if (!file) {
    hostChildFormError.value = '没有检测到可导入的密钥文件'
    return
  }
  const getPathForFile = window.aiops?.getPathForFile
  const filePath = (typeof getPathForFile === 'function' ? getPathForFile(file) : '') || String((file as File & { path?: string }).path || '').trim()
  if (!filePath) {
    hostChildFormError.value = '拖拽导入需要本地文件路径'
    return
  }
  await importHostKeyFileFromPath(filePath)
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

const saveHostKeyForm = async () => {
  hostChildFormError.value = ''
  const name = hostKeyForm.name.trim()
  const privateKey = hostKeyForm.privateKey.trim()
  if (!name || !privateKey) {
    hostChildFormError.value = '请填写名称和私钥'
    return
  }
  const duplicate = keychainOptions.value.some((keychain) => keychain.name === name)
  if (duplicate) {
    hostChildFormError.value = `密钥 ${name} 已存在`
    return
  }
  const saveKeychain = window.aiops?.saveKeychain
  if (typeof saveKeychain !== 'function') {
    hostChildFormError.value = '密钥保存服务不可用'
    return
  }
  const input: AiopsKeychainInput = {
    name,
    type: detectHostKeyType(privateKey, hostKeyForm.publicKey),
    privateKey,
    publicKey: hostKeyForm.publicKey.trim(),
    passphrase: hostKeyForm.passphrase
  }
  try {
    const result = await saveKeychain(input)
    if (!result?.ok) throw new Error(result?.errorMessage || '密钥保存失败')
    if (!isAiopsKeychainRecord(result.data)) throw new Error(malformedAssetBackendResultMessage)
    await loadKeychainOptions()
    hostForm.authType = 'keyBased'
    hostForm.keychainId = result.data.id
    closeHostChildModal()
  } catch (error) {
    hostChildFormError.value = error instanceof Error ? error.message : '密钥保存失败'
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

const deleteAssetRecord = async (assetId: string) => {
  const deleteAsset = window.aiops?.deleteAsset
  if (typeof deleteAsset !== 'function') throw new Error('资产删除服务不可用')
  const result = await deleteAsset(assetId)
  if (!result?.ok) throw new Error(result?.errorMessage || '资产删除失败')
  if (!isAiopsDeletedAssetData(result.data, assetId)) throw new Error(malformedAssetBackendResultMessage)
  const { snapshot, groups } = await loadWorkspaceAssetRefresh()
  if (snapshot.assets.some((asset) => asset.id === assetId)) throw new Error(malformedAssetBackendResultMessage)
  applyWorkspaceAssetState(snapshot, groups)
}

const saveFolderRecord = async (folder: AiopsCustomFolderSaveInput) => {
  const saveAssetFolder = window.aiops?.saveAssetFolder
  if (typeof saveAssetFolder !== 'function') throw new Error('文件夹保存服务不可用')
  const result = await saveAssetFolder(folder)
  if (!result?.ok) throw new Error(result?.errorMessage || '文件夹保存失败')
  const saved = result.data
  if (!isAiopsSavedCustomFolderRecord(saved, folder)) throw new Error(malformedAssetBackendResultMessage)
  const { snapshot, groups } = await loadWorkspaceAssetRefresh()
  if (!snapshot.folders.some((item) => item.uuid === saved.uuid)) throw new Error(malformedAssetBackendResultMessage)
  applyWorkspaceAssetState(snapshot, groups)
  return saved
}

const deleteFolderRecord = async (folderUuid: string) => {
  const deleteAssetFolder = window.aiops?.deleteAssetFolder
  if (typeof deleteAssetFolder !== 'function') throw new Error('文件夹删除服务不可用')
  const result = await deleteAssetFolder(folderUuid)
  if (!result?.ok) throw new Error(result?.errorMessage || '文件夹删除失败')
  if (!isAiopsDeletedCustomFolderData(result.data, folderUuid)) throw new Error(malformedAssetBackendResultMessage)
  const { snapshot, groups } = await loadWorkspaceAssetRefresh()
  if (snapshot.folders.some((folder) => folder.uuid === folderUuid)) throw new Error(malformedAssetBackendResultMessage)
  if (snapshot.assets.some((asset) => asset.folderUuid === folderUuid)) throw new Error(malformedAssetBackendResultMessage)
  applyWorkspaceAssetState(snapshot, groups)
}

const isGroupExpanded = (key: string) => !!searchValue.value.trim() || expandedGroups.value.includes(key)

const updateExpandedGroups = (next: string[]) => workspace.updateWorkspacePreferences({ expandedGroups: [...new Set(next)] })

const toggleGroup = async (key: string) => {
  const next = expandedGroups.value.includes(key)
    ? expandedGroups.value.filter((item) => item !== key)
    : [...expandedGroups.value, key]
  await updateExpandedGroups(next)
}

const expandGroup = async (key: string) => {
  if (!expandedGroups.value.includes(key)) {
    return updateExpandedGroups([...expandedGroups.value, key])
  }
  return true
}

const removeExpandedGroup = async (key: string) => {
  if (expandedGroups.value.includes(key)) {
    return updateExpandedGroups(expandedGroups.value.filter((item) => item !== key))
  }
  return true
}

const replaceExpandedGroup = async (oldKey: string, newKey: string) => {
  if (!expandedGroups.value.includes(oldKey)) return true
  return updateExpandedGroups(expandedGroups.value.map((item) => (item === oldKey ? newKey : item)))
}

const closeMenus = () => {
  contextMenuAssetId.value = null
  contextMenuGroupKey.value = null
  blankContextMenuVisible.value = false
}

const closeContextMenu = () => {
  contextMenuAssetId.value = null
  contextMenuGroupKey.value = null
  blankContextMenuVisible.value = false
}

const positionContextMenu = (event: MouseEvent, menuItemCount: number) => {
  const menuWidth = 160
  const estimatedMenuHeight = 6 + menuItemCount * 30
  let left = event.clientX
  let top = event.clientY
  if (left + menuWidth > window.innerWidth) {
    left = window.innerWidth - menuWidth - 5
  }
  if (top + estimatedMenuHeight > window.innerHeight) {
    top = event.clientY - estimatedMenuHeight
    if (top < 0) top = 5
  }
  contextMenuPosition.x = left
  contextMenuPosition.y = top
}

const countAssetMenuItems = (asset: WorkspaceAsset) => {
  const items = [
    asset.favorite !== undefined,
    activeWorkspace.value === 'bastion' && !asset.isLocalShell,
    activeWorkspace.value === 'bastion' && !asset.isLocalShell && asset.asset_type !== 'organization' && !asset.folderUuid,
    activeWorkspace.value === 'bastion' && !asset.isLocalShell && !!asset.folderUuid,
    asset.asset_type === 'person' && !asset.isLocalShell,
    true,
    !asset.isLocalShell,
    asset.asset_type !== 'organization' && !asset.isLocalShell,
    asset.asset_type === 'organization',
    asset.asset_type === 'organization',
    !asset.isLocalShell
  ]
  return items.filter(Boolean).length
}

const countGroupMenuItems = (group: WorkspaceGroup) =>
  [
    group.type === 'custom-folder' || group.type === 'direct-group',
    group.type !== 'system',
    group.type === 'custom-folder' || group.type === 'direct-group',
    group.refreshable,
    group.type === 'organization',
    group.type === 'custom-folder' || group.type === 'direct-group',
    group.type === 'organization'
  ].filter(Boolean).length

const groupByKey = (key: string) => sourceGroups.value.flatMap(flattenGroups).find((group) => group.key === key) || null

const folderByGroup = (group: WorkspaceGroup | null) => {
  if (!group) return null
  if (group.type === 'direct-group') {
    return directFolders.value.find((folder) => folder.name === group.groupName || folder.uuid === group.folderUuid) || null
  }
  if (group.type === 'custom-folder') {
    return bastionFolders.value.find((folder) => folder.uuid === group.folderUuid) || null
  }
  return null
}

const groupTargetPatch = (group: WorkspaceGroup | null, sourceAsset?: WorkspaceAsset): Partial<AiopsAssetInput> => {
  if (!group) {
    if (activeWorkspace.value === 'direct') {
      return { group: ungroupedGroupName, group_name: ungroupedGroupName, folderUuid: undefined }
    }
    if (activeWorkspace.value === 'bastion' && sourceAsset?.asset_type !== 'organization') {
      return { folderUuid: undefined, organizationId: organizationAssets.value[0]?.uuid || sourceAsset?.organizationId }
    }
    return { folderUuid: undefined }
  }
  if (group.type === 'direct-group') {
    return { group: group.groupName || group.title, group_name: group.groupName || group.title, folderUuid: undefined }
  }
  if (group.type === 'custom-folder') {
    return { folderUuid: group.folderUuid || group.key, organizationId: sourceAsset?.organizationId || organizationAssets.value[0]?.uuid }
  }
  if (group.type === 'organization') {
    return { folderUuid: undefined, organizationId: group.organizationId || group.key }
  }
  return {}
}

const openCreateFolder = (parentGroup?: WorkspaceGroup | null) => {
  folderModal.visible = true
  folderModal.mode = 'create'
  folderModal.targetKey = ''
  folderModal.parentKey = parentGroup?.key || ''
  folderModal.fromMove = false
  folderForm.name = ''
  folderForm.description = ''
  folderFormError.value = ''
  closeContextMenu()
}

const openCreateFolderFromMoveModal = () => {
  moveModal.visible = false
  openCreateFolder()
  folderModal.fromMove = true
}

const openCreateHost = (targetGroup?: WorkspaceGroup | null) => {
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
  hostFormError.value = ''
  resetHostConnectionTest()
  closeContextMenu()
}

const closeFolderModal = () => {
  folderModal.visible = false
  folderModal.targetKey = ''
  folderModal.parentKey = ''
  folderModal.fromMove = false
  folderForm.name = ''
  folderForm.description = ''
  folderFormError.value = ''
}

const closeMoveModal = () => {
  moveModal.visible = false
  moveModal.assetId = ''
}

const closeDeleteGroupModal = () => {
  deleteGroupModal.visible = false
  deleteGroupModal.groupKey = ''
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
  hostFormError.value = ''
  closeHostChildModal()
  resetHostConnectionTest()
}

const resetTunnelForm = (type: WorkspaceTunnelType = 'local_forward') => {
  tunnelForm.type = type
  tunnelForm.localPort = type === 'dynamic_socks' ? '1080' : '3306'
  tunnelForm.remoteHost = 'localhost'
  tunnelForm.remotePort = type === 'dynamic_socks' ? '' : '3306'
  tunnelFormError.value = ''
  tunnelSubmitting.value = false
}

const closeTunnelModal = () => {
  tunnelModal.visible = false
  tunnelModal.assetId = ''
  resetTunnelForm()
}

const closeDeleteAssetModal = () => {
  deleteAssetModal.visible = false
  deleteAssetModal.assetId = ''
}

const closeManagementModal = () => {
  managementModal.visible = false
  managementModal.organizationId = ''
  managementModal.query = ''
}

const saveFolderForm = async () => {
  const name = folderForm.name.trim()
  if (!name) {
    folderFormError.value = '请输入文件夹名称'
    return
  }
  const scopedFolders = activeWorkspace.value === 'direct' ? directFolders.value : bastionFolders.value
  const duplicateCustomFolder = scopedFolders.some((folder) => folder.name === name && folder.uuid !== folderModal.targetKey)
  if (duplicateCustomFolder) {
    folderFormError.value = '文件夹名称已存在'
    return
  }

  if (folderModal.mode === 'create') {
    let parentUuid = ''
    const parentGroup = folderModal.parentKey ? groupByKey(folderModal.parentKey) : null
    if (parentGroup && (parentGroup.type === 'direct-group' || parentGroup.type === 'custom-folder')) {
      const parentFolder = folderByGroup(parentGroup)
      if (parentFolder) {
        parentUuid = parentFolder.uuid
      } else if (parentGroup.type === 'direct-group') {
        try {
          const createdParent = await saveFolderRecord({
            name: parentGroup.title,
            description: '',
            scope: 'direct'
          })
          parentUuid = createdParent.uuid
        } catch (error) {
          folderFormError.value = error instanceof Error ? error.message : '父分组保存失败'
          return
        }
      }
    }
    const folder: AiopsCustomFolderSaveInput = {
      name,
      description: folderForm.description.trim(),
      scope: activeWorkspace.value === 'direct' ? 'direct' : 'bastion',
      ...(parentUuid ? { parentUuid } : {})
    }
    try {
      const saved = await saveFolderRecord(folder)
      await expandGroup(activeWorkspace.value === 'direct' ? directGroupKey(saved.name) : saved.uuid)
      if (parentGroup) await expandGroup(parentGroup.key)
      notice.value = `已创建文件夹 ${saved.name}`
      closeFolderModal()
    } catch (error) {
      folderFormError.value = error instanceof Error ? error.message : '文件夹保存失败'
    }
    return
  }

  if (folderModal.mode === 'edit-custom') {
    const folder = customFolders.value.find((item) => item.uuid === folderModal.targetKey)
    if (folder) {
      try {
        const saved = await saveFolderRecord({ ...folder, name, description: folderForm.description.trim() })
        notice.value = `已更新文件夹 ${saved.name}`
      } catch (error) {
        folderFormError.value = error instanceof Error ? error.message : '文件夹保存失败'
        return
      }
    }
    closeFolderModal()
    return
  }

  const oldGroupName = folderModal.targetKey.replace(/^group-/, '')
  const oldKey = `group-${oldGroupName}`
  const newKey = `group-${name}`
  const existingFolder = directFolders.value.find((folder) => folder.name === oldGroupName || directGroupKey(folder.name) === folderModal.targetKey)
  const currentGroup = groupByKey(folderModal.targetKey)
  if (existingFolder && currentGroup?.originalCount === 0) {
    try {
      const saved = await saveFolderRecord({ ...existingFolder, name, description: folderForm.description.trim(), scope: 'direct' })
      await replaceExpandedGroup(oldKey, directGroupKey(saved.name))
      notice.value = `已更新分组 ${saved.name}`
      closeFolderModal()
    } catch (error) {
      folderFormError.value = error instanceof Error ? error.message : '分组保存失败'
    }
    return
  }
  const input = {
    oldName: oldGroupName,
    newName: name,
    assetTypes: ['person' as const, 'switch' as const]
  }
  try {
    const renameAssetGroup = window.aiops?.renameAssetGroup
    if (typeof renameAssetGroup !== 'function') throw new Error('资产分组保存服务不可用')
    const result = await renameAssetGroup(input)
    if (!result?.ok) throw new Error(result?.errorMessage || '分组保存失败')
    if (!isAiopsAssetGroupRenameSnapshot(result.data, input)) throw new Error(malformedAssetBackendResultMessage)
    if (existingFolder) {
      await saveFolderRecord({ ...existingFolder, name, description: folderForm.description.trim(), scope: 'direct' })
    }
    await refreshAssets()
    await replaceExpandedGroup(oldKey, newKey)
    notice.value = `已更新分组 ${name}`
    closeFolderModal()
  } catch (error) {
    folderFormError.value = error instanceof Error ? error.message : '分组保存失败'
  }
}

const displayAsset = (asset: WorkspaceAsset) => (showIpMode.value ? asset.ip || asset.host : asset.name || asset.title)

const folderNameByUuid = (folderUuid?: string) => customFolders.value.find((folder) => folder.uuid === folderUuid)?.name || ''

const moveAssetToGroup = async (assetId: string, targetGroup: WorkspaceGroup | null) => {
  const asset = findEditableAsset(assetId)
  if (!asset || asset.isLocalShell || asset.asset_type === 'organization') return false
  try {
    const saved = await saveAssetRecord(toAssetInput(asset, groupTargetPatch(targetGroup, asset)))
    if (targetGroup) await expandGroup(targetGroup.key)
    return true
  } catch (error) {
    notice.value = error instanceof Error ? error.message : '移动资产失败'
    return false
  }
}

const ensureDirectFolderForGroup = async (group: WorkspaceGroup) => {
  const existing = folderByGroup(group)
  if (existing) return existing
  return saveFolderRecord({ name: group.title, description: '', scope: 'direct' })
}

const moveGroupToParent = async (groupKey: string, parentGroup: WorkspaceGroup | null) => {
  const group = groupByKey(groupKey)
  if (!group || group.type === 'system' || group.type === 'organization') return false
  if (parentGroup && (parentGroup.key === group.key || isDescendantGroup(group.key, parentGroup.key))) return false
  try {
    const folder =
      group.type === 'direct-group'
        ? await ensureDirectFolderForGroup(group)
        : customFolders.value.find((item) => item.uuid === group.folderUuid)
    if (!folder) return false
    const parentFolder =
      parentGroup && (parentGroup.type === 'direct-group' || parentGroup.type === 'custom-folder')
        ? parentGroup.type === 'direct-group'
          ? await ensureDirectFolderForGroup(parentGroup)
          : customFolders.value.find((item) => item.uuid === parentGroup.folderUuid)
        : null
    const saved = await saveFolderRecord({
      ...folder,
      parentUuid: parentFolder?.uuid || undefined,
      scope: activeWorkspace.value === 'direct' ? 'direct' : 'bastion'
    })
    if (parentGroup) await expandGroup(parentGroup.key)
    await expandGroup(activeWorkspace.value === 'direct' ? directGroupKey(saved.name) : saved.uuid)
    return true
  } catch (error) {
    notice.value = error instanceof Error ? error.message : '移动分组失败'
    return false
  }
}

const toggleDisplayMode = async () => {
  await workspace.updateWorkspacePreferences({ showIpMode: !showIpMode.value })
}

const selectAsset = (assetId: string) => {
  selectedAssetId.value = assetId
}

const connectAsset = async (assetId: string) => {
  selectedAssetId.value = assetId
  const asset = allAssets.value.find((item) => item.id === assetId)
  if (!asset) {
    return
  }
  const previousActivePanelId = workspace.activePanelId
  workspace.createPanel()
  workspace.renamePanel(workspace.activePanelId, asset.name)
  workspace.replaceTerminalOutput(workspace.activePanelId, '')
  const panelId = workspace.activePanelId
  const discardPendingPanel = () => workspace.discardPendingTerminalPanel(panelId, previousActivePanelId)
  const launchContext = {
    panelId,
    terminalType: workspace.terminalSettings.terminalType,
    discardPendingPanel,
    setNotice: (message: string) => {
      notice.value = message
    },
    applyLocalTerminalSession: workspace.applyLocalTerminalSession,
    applySshTerminalSession: workspace.applySshTerminalSession,
    registerSshSession: workspace.registerSshSession,
    renamePanel: workspace.renamePanel
  }
  if (asset.isLocalShell) {
    const panel = await openLocalTerminalLaunch(launchContext, { title: asset.name })
    if (!panel) return
    notice.value = `已打开本地 shell ${asset.host}`
  } else {
    const panel = await openSshTerminalLaunch(launchContext, asset, { title: asset.name })
    if (!panel) return
  }
  workspace.selectedContexts = [
    ...workspace.selectedContexts.filter((item) => item.id !== asset.id),
    { id: asset.id, kind: 'hosts', label: asset.host, detail: asset.name }
  ]
  if (!asset.isLocalShell) {
    await workspace.updateWorkspacePreferences({
      recentAssetIds: [asset.id, ...recentAssetIds.value.filter((id) => id !== asset.id)].slice(0, 10)
    })
  }
}

const openContextMenu = (event: MouseEvent, assetId: string) => {
  const asset = allAssets.value.find((item) => item.id === assetId)
  if (!asset) return
  contextMenuAssetId.value = assetId
  contextMenuGroupKey.value = null
  blankContextMenuVisible.value = false
  selectedAssetId.value = assetId
  positionContextMenu(event, countAssetMenuItems(asset))
}

const openGroupContextMenu = (event: MouseEvent, groupKey: string) => {
  const group = groupByKey(groupKey)
  if (!group || !group.menu) return
  contextMenuGroupKey.value = groupKey
  contextMenuAssetId.value = null
  blankContextMenuVisible.value = false
  positionContextMenu(event, countGroupMenuItems(group))
}

const openBlankContextMenu = (event: MouseEvent) => {
  if ((event.target as HTMLElement | null)?.closest('.workspace-folder-row, .workspace-host-row, .asset-context-menu')) return
  contextMenuAssetId.value = null
  contextMenuGroupKey.value = null
  blankContextMenuVisible.value = true
  positionContextMenu(event, 2)
}

const canDragAsset = (asset: WorkspaceAsset) => !asset.isLocalShell && asset.asset_type !== 'organization'
const canDragGroup = (group: WorkspaceGroup) => group.type === 'direct-group' || group.type === 'custom-folder'

const clearDragState = () => {
  dragState.kind = ''
  dragState.assetId = ''
  dragState.groupKey = ''
  dragOverGroupKey.value = ''
  dragOverAssetId.value = ''
}

const handleAssetDragStart = (event: DragEvent, asset: WorkspaceAsset) => {
  if (!event.dataTransfer || !canDragAsset(asset)) return
  dragState.kind = 'asset'
  dragState.assetId = asset.id
  dragState.groupKey = ''
  const aiContextPayload = {
    contextType: 'host',
    id: asset.id,
    kind: 'hosts',
    label: asset.host || asset.ip || asset.name,
    detail: asset.name || asset.title || asset.group_name,
    host: asset.host || asset.ip || asset.name,
    port: Number(asset.port) || 22,
    username: asset.username || 'root',
    assetName: asset.name || asset.title || asset.host || asset.ip,
    isLocalShell: Boolean(asset.isLocalShell)
  }
  const serialized = JSON.stringify(aiContextPayload)
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('application/x-aiopsterm-workspace-asset', asset.id)
  event.dataTransfer.setData('application/x-aiopsterm-context', serialized)
  event.dataTransfer.setData('text/html', `<span data-aiopsterm-context="${encodeURIComponent(serialized)}"></span>`)
  event.dataTransfer.setData('text/plain', asset.name)
}

const handleGroupDragStart = (event: DragEvent, group: WorkspaceGroup) => {
  if (!event.dataTransfer || !canDragGroup(group)) return
  dragState.kind = 'group'
  dragState.groupKey = group.key
  dragState.assetId = ''
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('application/x-aiopsterm-workspace-group', group.key)
  event.dataTransfer.setData('text/plain', group.title)
}

const draggedAssetId = (event: DragEvent) => event.dataTransfer?.getData('application/x-aiopsterm-workspace-asset') || (dragState.kind === 'asset' ? dragState.assetId : '')
const draggedGroupKey = (event: DragEvent) => event.dataTransfer?.getData('application/x-aiopsterm-workspace-group') || (dragState.kind === 'group' ? dragState.groupKey : '')

const handleGroupDragOver = (event: DragEvent, group: WorkspaceGroup) => {
  const assetId = draggedAssetId(event)
  const groupKey = draggedGroupKey(event)
  if (!assetId && !groupKey) return
  if (groupKey && (groupKey === group.key || isDescendantGroup(groupKey, group.key))) return
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  dragOverGroupKey.value = group.key
}

const handleGroupDragLeave = (groupKey: string) => {
  if (dragOverGroupKey.value === groupKey) dragOverGroupKey.value = ''
}

const handleGroupDrop = async (event: DragEvent, group: WorkspaceGroup) => {
  const assetId = draggedAssetId(event)
  const groupKey = draggedGroupKey(event)
  if (assetId) await moveAssetToGroup(assetId, group)
  else if (groupKey) await moveGroupToParent(groupKey, group)
  clearDragState()
}

const handleAssetDragOver = (event: DragEvent, asset: WorkspaceAsset) => {
  if (!draggedAssetId(event) && !draggedGroupKey(event)) return
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  dragOverAssetId.value = asset.id
}

const handleAssetDragLeave = (assetId: string) => {
  if (dragOverAssetId.value === assetId) dragOverAssetId.value = ''
}

const handleAssetDrop = async (event: DragEvent, asset: WorkspaceAsset) => {
  const row = visibleTreeRows.value.find((item) => item.kind === 'asset' && item.asset.id === asset.id)
  const targetGroup = row?.kind === 'asset' ? groupByKey(row.parentGroupKey) : null
  const draggedId = draggedAssetId(event)
  if (draggedId && draggedId !== asset.id) await moveAssetToGroup(draggedId, targetGroup)
  clearDragState()
}

const handleBlankDragOver = (event: DragEvent) => {
  if (!draggedAssetId(event) && !draggedGroupKey(event)) return
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
}

const handleBlankDragLeave = (event: DragEvent) => {
  const target = event.currentTarget as HTMLElement | null
  const related = event.relatedTarget as Node | null
  if (!target || !related || !target.contains(related)) {
    dragOverGroupKey.value = ''
    dragOverAssetId.value = ''
  }
}

const handleBlankDrop = async (event: DragEvent) => {
  if ((event.target as HTMLElement | null)?.closest('.workspace-folder-row, .workspace-host-row')) return
  const assetId = draggedAssetId(event)
  const groupKey = draggedGroupKey(event)
  if (assetId) await moveAssetToGroup(assetId, null)
  else if (groupKey) await moveGroupToParent(groupKey, null)
  clearDragState()
}

const connectContextAsset = () => {
  if (contextMenuAssetId.value) connectAsset(contextMenuAssetId.value)
  closeContextMenu()
}

const toggleFavorite = async () => {
  const asset = findEditableAsset(contextMenuAssetId.value || '')
  if (asset) {
    const nextFavorite = !Boolean(asset.favorite)
    try {
      const saved = await saveAssetRecord(toAssetInput(asset, { favorite: nextFavorite }))
      notice.value = saved.favorite ? `已收藏 ${saved.name}` : `已取消收藏 ${saved.name}`
    } catch (error) {
      notice.value = error instanceof Error ? error.message : '收藏状态保存失败'
    }
  }
  closeContextMenu()
}

const openCommentEditor = (assetId: string) => {
  const asset = allAssets.value.find((item) => item.id === assetId)
  if (!asset) return
  commentAssetId.value = assetId
  editingComment.value = asset.comment || ''
}

const openContextComment = () => {
  if (contextMenuAssetId.value) openCommentEditor(contextMenuAssetId.value)
  closeContextMenu()
}

const saveComment = async (assetId: string) => {
  const asset = findEditableAsset(assetId)
  if (asset) {
    const nextComment = editingComment.value.trim()
    try {
      const saved = await saveAssetRecord(toAssetInput(asset, { comment: nextComment }))
      notice.value = saved.comment ? `已更新备注 ${saved.comment}` : '已清空备注'
      cancelComment()
    } catch (error) {
      notice.value = error instanceof Error ? error.message : '备注保存失败'
    }
    return
  }
  cancelComment()
}

const cancelComment = () => {
  commentAssetId.value = ''
  editingComment.value = ''
}

const applyTunnelResult = (result: AiopsSshTunnelMutationResult, fallbackMessage: string) => {
  if (!result.ok) throw new Error(result.errorMessage || fallbackMessage)
  if (!isAiopsSshTunnelMutationData(result.data)) throw new Error(malformedAssetBackendResultMessage)
  applyWorkspaceAssetSnapshot(result.data)
  notice.value = result.data.message || fallbackMessage
}

const parseTunnelPort = (value: string, label: string) => {
  const port = Number(value.trim())
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    tunnelFormError.value = `${label}必须是 1-65535 的整数`
    return null
  }
  return port
}

const openTunnelModal = (asset: WorkspaceAsset) => {
  tunnelModal.visible = true
  tunnelModal.assetId = asset.id
  resetTunnelForm('local_forward')
}

const toggleTunnel = async () => {
  const asset = findEditableAsset(contextMenuAssetId.value || '')
  closeContextMenu()
  if (!asset) return
  try {
    if (asset.tunnelState === 'active') {
      const stopTunnel = window.aiops?.stopSshTunnel
      if (typeof stopTunnel !== 'function') {
        notice.value = '隧道运行时服务不可用'
        return
      }
      applyTunnelResult(await stopTunnel({ assetId: asset.id }), '隧道停止失败')
      return
    }
    openTunnelModal(asset)
  } catch (error) {
    notice.value = error instanceof Error ? error.message : '隧道运行失败'
  }
}

const startTunnelFromModal = async () => {
  const asset = tunnelAsset.value
  if (!asset) {
    tunnelFormError.value = '隧道主机不存在'
    return
  }
  const startTunnel = window.aiops?.startSshTunnel
  if (typeof startTunnel !== 'function') {
    tunnelFormError.value = '隧道运行时服务不可用'
    return
  }
  const localPort = parseTunnelPort(tunnelForm.localPort, tunnelForm.type === 'remote_forward' ? '本地服务端口' : '本地监听端口')
  if (localPort === null) return
  const remotePort =
    tunnelForm.type === 'dynamic_socks'
      ? undefined
      : parseTunnelPort(tunnelForm.remotePort, tunnelForm.type === 'remote_forward' ? '远端监听端口' : '远端服务端口')
  if (remotePort === null) return
  const remoteHost = tunnelForm.remoteHost.trim() || 'localhost'
  tunnelSubmitting.value = true
  tunnelFormError.value = ''
  try {
    applyTunnelResult(
      await startTunnel({
        assetId: asset.id,
        type: tunnelForm.type,
        localPort,
        ...(tunnelForm.type === 'dynamic_socks' ? {} : { remoteHost, remotePort })
      }),
      '隧道连接失败'
    )
    closeTunnelModal()
  } catch (error) {
    tunnelFormError.value = error instanceof Error ? error.message : '隧道连接失败'
  } finally {
    tunnelSubmitting.value = false
  }
}

const openMoveModal = (assetId: string) => {
  moveModal.visible = true
  moveModal.assetId = assetId
  closeContextMenu()
}

const openMoveModalFromContext = () => {
  if (contextMenuAssetId.value) openMoveModal(contextMenuAssetId.value)
}

const moveAssetToFolder = async (folderUuid: string) => {
  const asset = findEditableAsset(moveModal.assetId)
  if (!asset) return
  const folder = customFolders.value.find((item) => item.uuid === folderUuid)
  const targetGroup = folder ? groupByKey(folderGroupKey(folder)) : null
  try {
    await saveAssetRecord(toAssetInput(asset, targetGroup ? groupTargetPatch(targetGroup, asset) : { folderUuid, organizationId: asset.organizationId || organizationAssets.value[0]?.uuid }))
    await expandGroup(targetGroup?.key || folderUuid)
    closeMoveModal()
  } catch (error) {
    notice.value = error instanceof Error ? error.message : '移动资产失败'
  }
}

const removeAssetFromFolder = async (assetId: string) => {
  const asset = findEditableAsset(assetId)
  if (!asset || !asset.folderUuid) return
  const folderName = folderNameByUuid(asset.folderUuid)
  try {
    await saveAssetRecord(toAssetInput(asset, groupTargetPatch(null, asset)))
    if (asset.organizationId) await expandGroup(asset.organizationId)
  } catch (error) {
    notice.value = error instanceof Error ? error.message : '移除资产失败'
  }
  closeContextMenu()
}

const removeContextAssetFromFolder = () => {
  if (contextMenuAssetId.value) removeAssetFromFolder(contextMenuAssetId.value)
}

const refreshGroup = async (groupKey: string) => {
  refreshingGroupKey.value = groupKey
  notice.value = '正在刷新堡垒机资源'
  const organization = organizationAssets.value.find((asset) => asset.uuid === groupKey)
  try {
    const expectedOrganizationId = organization?.id
    const refreshOrganizationAssets = window.aiops?.refreshOrganizationAssets
    if (typeof refreshOrganizationAssets !== 'function') throw new Error('组织资产刷新服务不可用')
    const result = await refreshOrganizationAssets(expectedOrganizationId ? { organizationId: expectedOrganizationId } : undefined)
    if (!result?.ok) throw new Error(result?.errorMessage || '刷新堡垒机资源失败')
    if (!isAiopsJumpserverOrganizationAssetRefreshData(result.data, expectedOrganizationId)) throw new Error(malformedAssetBackendResultMessage)
    const groups = await loadDirectGroupOptions()
    applyWorkspaceAssetState(result.data, groups)
    if (organization) await expandGroup(organization.uuid)
    notice.value = organization ? `${organization.name} 资源已刷新` : '堡垒机资源已刷新'
  } catch (error) {
    notice.value = error instanceof Error ? error.message : '刷新堡垒机资源失败'
  } finally {
    refreshingGroupKey.value = ''
    closeContextMenu()
  }
}

const refreshContextOrganization = () => {
  if (contextAsset.value) refreshGroup(contextAsset.value.uuid)
}

const openManagementForOrganization = (organizationId: string) => {
  managementModal.visible = true
  managementModal.organizationId = organizationId
  managementModal.query = ''
  closeContextMenu()
}

const openContextOrganizationManagement = () => {
  if (contextAsset.value) openManagementForOrganization(contextAsset.value.uuid)
}

const openGroupOrganizationManagement = () => {
  if (contextGroup.value?.organizationId) openManagementForOrganization(contextGroup.value.organizationId)
}

const openEditGroup = () => {
  const group = contextGroup.value
  if (!group) return
  folderModal.visible = true
  folderModal.targetKey = group.key
  folderModal.mode = group.type === 'custom-folder' ? 'edit-custom' : 'edit-direct'
  folderForm.name = group.title
  folderForm.description = group.type === 'custom-folder' ? customFolders.value.find((folder) => folder.uuid === group.folderUuid)?.description || '' : ''
  folderFormError.value = ''
  closeContextMenu()
}

const openDeleteGroup = () => {
  if (!contextGroup.value) return
  deleteGroupModal.visible = true
  deleteGroupModal.groupKey = contextGroup.value.key
  closeContextMenu()
}

const openDeleteGroupOrganization = () => {
  const group = contextGroup.value
  if (!group?.organizationId) return
  deleteAssetModal.visible = true
  deleteAssetModal.assetId = organizationAssets.value.find((asset) => asset.uuid === group.organizationId)?.id || ''
  closeContextMenu()
}

const confirmDeleteGroup = () => {
  const group = groupByKey(deleteGroupModal.groupKey)
  if (!group) return
  if (group.type === 'custom-folder') {
    deleteFolderRecord(group.folderUuid || group.key)
      .then(async () => {
        await removeExpandedGroup(group.key)
        notice.value = `已删除文件夹 ${group.title}`
        closeDeleteGroupModal()
      })
      .catch((error) => {
        notice.value = error instanceof Error ? error.message : '删除文件夹失败'
      })
    return
  }
  if (group.type === 'direct-group' && group.groupName) {
    if (group.originalCount === 0 && group.folderUuid) {
      deleteFolderRecord(group.folderUuid)
        .then(async () => {
          await removeExpandedGroup(group.key)
          notice.value = `已删除分组 ${group.title}`
          closeDeleteGroupModal()
        })
        .catch((error) => {
          notice.value = error instanceof Error ? error.message : '删除分组失败'
        })
      return
    }
    const deleteAssetGroup = window.aiops?.deleteAssetGroup
    if (typeof deleteAssetGroup !== 'function') {
      notice.value = '资产分组删除服务不可用'
      return
    }
    const input = {
      name: group.groupName,
      fallbackName: ungroupedGroupName,
      assetTypes: ['person' as const, 'switch' as const]
    }
    deleteAssetGroup(input)
      .then(async (result) => {
        if (!result?.ok) throw new Error(result?.errorMessage || '删除分组失败')
        if (!isAiopsAssetGroupDeleteSnapshot(result.data, input)) throw new Error(malformedAssetBackendResultMessage)
        const groups = await loadDirectGroupOptions()
        applyWorkspaceAssetState(result.data, groups)
        if (group.folderUuid) {
          await deleteFolderRecord(group.folderUuid)
        }
        await removeExpandedGroup(group.key)
        notice.value = `已删除分组 ${group.title}`
        closeDeleteGroupModal()
      })
      .catch((error) => {
        notice.value = error instanceof Error ? error.message : '删除分组失败'
      })
    return
  }
  closeDeleteGroupModal()
}

const loadHostEditablePassword = async (requestId: number, assetId: string) => {
  const bridge = window.aiops?.getAssetEditableSecret
  if (typeof bridge !== 'function') return
  try {
    const result = await bridge(assetId)
    if (requestId !== hostSecretRequestId || hostModal.assetId !== assetId || !hostModal.visible || hostModal.mode === 'create') return
    if (!result?.ok) return
    hostForm.password = result.data?.password || ''
  } catch {
    if (requestId === hostSecretRequestId && hostModal.assetId === assetId) hostForm.password = ''
  }
}

const openHostEditor = (mode: HostModalMode, asset?: WorkspaceAsset) => {
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
  hostFormError.value = ''
  resetHostConnectionTest()
  closeContextMenu()
  if ((mode === 'edit' || mode === 'clone') && asset?.id && hostForm.authType === 'password') void loadHostEditablePassword(secretRequestId, asset.id)
}

const closeHostChildModal = () => {
  hostChildModal.value = ''
  hostChildFormError.value = ''
  hostKeyDragOver.value = false
}

const openKeyManagementFromHostForm = () => {
  hostChildModal.value = 'key'
  hostChildFormError.value = ''
  Object.assign(hostKeyForm, { name: '', privateKey: '', publicKey: '', passphrase: '' })
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

const buildHostInput = (id: string | undefined, port: number, sourceAsset?: WorkspaceAsset): AiopsAssetInput => {
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
    tags: hostForm.assetType === 'organization' ? ['jumpserver'] : ['ssh'],
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
  const testAssetConnection = window.aiops?.testAssetConnection
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

const openDeleteContextAsset = () => {
  if (!contextAsset.value || contextAsset.value.isLocalShell) return
  deleteAssetModal.visible = true
  deleteAssetModal.assetId = contextAsset.value.id
  closeContextMenu()
}

const confirmDeleteAsset = async () => {
  const asset = deleteAssetInfo.value
  if (!asset) return
  try {
    await deleteAssetRecord(asset.id)
    if (asset.asset_type === 'organization') await removeExpandedGroup(asset.uuid)
    workspace.selectedContexts = workspace.selectedContexts.filter((context) => context.id !== asset.id)
    selectedAssetId.value = selectedAssetId.value === asset.id ? null : selectedAssetId.value
    notice.value = `已删除主机 ${asset.name}`
    closeDeleteAssetModal()
  } catch (error) {
    notice.value = error instanceof Error ? error.message : '删除主机失败'
  }
}

const closeMenusFromDocument = () => closeMenus()

onMounted(() => {
  document.addEventListener('click', closeMenusFromDocument)
  Promise.all([workspace.hydrateConfig(), refreshAssets(), loadKeychainOptions()]).catch((error) => {
    notice.value = error instanceof Error ? error.message : '资产加载失败'
  })
})

onBeforeUnmount(() => {
  document.removeEventListener('click', closeMenusFromDocument)
})

watch(activeWorkspace, () => {
  closeMenus()
  closeMoveModal()
  closeFolderModal()
  closeDeleteGroupModal()
  closeHostModal()
  closeTunnelModal()
  closeDeleteAssetModal()
  closeManagementModal()
  cancelComment()
  searchValue.value = ''
  selectedAssetId.value = null
})

watch(
  () => tunnelForm.type,
  (type, previousType) => {
    if (!tunnelModal.visible || type === previousType) return
    tunnelForm.localPort = type === 'dynamic_socks' ? '1080' : '3306'
    tunnelForm.remoteHost = 'localhost'
    tunnelForm.remotePort = type === 'dynamic_socks' ? '' : '3306'
    tunnelFormError.value = ''
  }
)
</script>
