<template>
  <Teleport to="body">
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
  </Teleport>
</template>

<script setup lang="ts">
import { Eye, EyeOff, X } from 'lucide-vue-next'
import { useWorkspacePanelRuntimeContext } from '@/services/workspace/workspacePanelContext'

const {
  keychainOptions,
  hostJumpPasswordVisible,
  hostChildModal,
  hostChildFormError,
  hostJumpForm,
  saveHostJumpHostForm,
  closeHostChildModal
} = useWorkspacePanelRuntimeContext()
</script>
