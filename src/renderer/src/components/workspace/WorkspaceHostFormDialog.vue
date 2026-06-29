<template>
  <Teleport to="body">
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
  </Teleport>
</template>

<script setup lang="ts">
import { Eye, EyeOff, X } from 'lucide-vue-next'
import { useWorkspacePanelRuntimeContext } from '@/services/workspace/workspacePanelContext'

const {
  workspace,
  keychainOptions,
  hostModal,
  hostForm,
  hostFormError,
  hostTestLoading,
  hostTestMessage,
  hostTestOk,
  hostPasswordVisible,
  hostGroupOptions,
  jumpHostOptions,
  hostModalTitle,
  closeHostModal,
  openKeyManagementFromHostForm,
  openProxyManagementFromHostForm,
  openJumpHostCreateFromHostForm,
  testHostFormConnection,
  saveHostForm
} = useWorkspacePanelRuntimeContext()
</script>
