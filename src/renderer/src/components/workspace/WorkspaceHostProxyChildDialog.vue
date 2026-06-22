<template>
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
</template>

<script setup lang="ts">
import { X } from 'lucide-vue-next'
import { useWorkspacePanelRuntimeContext } from '@/services/workspacePanelContext'

const {
  workspace,
  hostChildModal,
  hostChildFormError,
  saveHostProxyForm,
  closeHostChildModal
} = useWorkspacePanelRuntimeContext()
</script>
