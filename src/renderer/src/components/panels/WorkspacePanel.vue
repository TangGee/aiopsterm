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
import { useWorkspacePanelRuntime } from '@/services/workspacePanelRuntime'

const {
  workspace,
  workspaceTabs,
  activeWorkspace,
  searchValue,
  selectedAssetId,
  contextMenuAssetId,
  contextMenuGroupKey,
  blankContextMenuVisible,
  contextMenuPosition,
  refreshingGroupKey,
  notice,
  commentAssetId,
  editingComment,
  dragOverGroupKey,
  dragOverAssetId,
  keychainOptions,
  folderModal,
  folderForm,
  folderFormError,
  moveModal,
  deleteGroupModal,
  hostModal,
  hostForm,
  hostFormError,
  hostTestLoading,
  hostTestMessage,
  hostTestOk,
  hostPasswordVisible,
  hostJumpPasswordVisible,
  hostChildModal,
  hostChildFormError,
  hostKeyForm,
  hostKeyDragOver,
  hostJumpForm,
  deleteAssetModal,
  managementModal,
  tunnelModal,
  tunnelForm,
  tunnelFormError,
  tunnelSubmitting,
  showIpMode,
  targetMoveFolders,
  hostGroupOptions,
  jumpHostOptions,
  assetGroupAssetCount,
  visibleTreeRows,
  contextAsset,
  contextGroup,
  canCommentContextAsset,
  canMoveContextAsset,
  canRemoveContextAssetFromFolder,
  canConnectContextAsset,
  canCreateChildInContextGroup,
  canCreateHostInContextGroup,
  tunnelAsset,
  hostModalTitle,
  tunnelTypeOptions,
  deleteAssetInfo,
  deleteGroupInfo,
  managedOrganization,
  managedOrganizationAssets,
  openHostKeyImportDialog,
  handleHostKeyDrop,
  saveHostProxyForm,
  saveHostKeyForm,
  saveHostJumpHostForm,
  isGroupExpanded,
  toggleGroup,
  closeMenus,
  openCreateFolder,
  openCreateFolderFromMoveModal,
  openCreateHost,
  closeFolderModal,
  closeMoveModal,
  closeDeleteGroupModal,
  closeHostModal,
  closeTunnelModal,
  closeDeleteAssetModal,
  closeManagementModal,
  saveFolderForm,
  displayAsset,
  folderNameByUuid,
  toggleDisplayMode,
  selectAsset,
  connectAsset,
  openContextMenu,
  openGroupContextMenu,
  openBlankContextMenu,
  canDragAsset,
  canDragGroup,
  clearDragState,
  handleAssetDragStart,
  handleGroupDragStart,
  handleGroupDragOver,
  handleGroupDragLeave,
  handleGroupDrop,
  handleAssetDragOver,
  handleAssetDragLeave,
  handleAssetDrop,
  handleBlankDragOver,
  handleBlankDragLeave,
  handleBlankDrop,
  connectContextAsset,
  toggleFavorite,
  openContextComment,
  saveComment,
  cancelComment,
  toggleTunnel,
  startTunnelFromModal,
  openMoveModal,
  openMoveModalFromContext,
  moveAssetToFolder,
  removeAssetFromFolder,
  removeContextAssetFromFolder,
  refreshGroup,
  refreshContextOrganization,
  openContextOrganizationManagement,
  openGroupOrganizationManagement,
  openEditGroup,
  openDeleteGroup,
  openDeleteGroupOrganization,
  confirmDeleteGroup,
  closeHostChildModal,
  openKeyManagementFromHostForm,
  openProxyManagementFromHostForm,
  openJumpHostCreateFromHostForm,
  editContextAsset,
  cloneContextAsset,
  testHostFormConnection,
  saveHostForm,
  openDeleteContextAsset,
  confirmDeleteAsset
} = useWorkspacePanelRuntime()
</script>
