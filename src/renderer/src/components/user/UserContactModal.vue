<template>
  <div class="user-modal-backdrop">
    <section class="user-modal-card">
      <header>
        <h3>{{ kind === 'email' ? '修改邮箱' : '修改手机号' }}</h3>
        <button
          title="关闭"
          @click="emit('cancel')"
        >
          <X />
        </button>
      </header>
      <label>
        <span>{{ kind === 'email' ? '邮箱' : '手机号' }}</span>
        <input
          :value="contact"
          :placeholder="kind === 'email' ? '请输入邮箱' : '请输入手机号'"
          @input="emit('update:contact', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <label>
        <span>验证码</span>
        <div class="user-code-row">
          <input
            :value="code"
            placeholder="请输入验证码"
            @input="emit('update:code', ($event.target as HTMLInputElement).value)"
          />
          <button
            class="settings-button"
            :disabled="!canSendCode || countdown > 0 || sending"
            @click="emit('send-code')"
          >
            {{ codeButtonText }}
          </button>
        </div>
      </label>
      <footer>
        <button
          class="settings-button"
          @click="emit('cancel')"
        >
          取消
        </button>
        <button
          class="settings-button primary"
          :disabled="!contact || !code"
          @click="emit('save')"
        >
          确认
        </button>
      </footer>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { X } from 'lucide-vue-next'
import type { WorkspaceUserContactKind } from '@/services/user/workspaceUserController'

const props = defineProps<{
  kind: WorkspaceUserContactKind
  contact: string
  code: string
  countdown: number
  sending: boolean
  canSendCode: boolean
}>()

const emit = defineEmits<{
  'update:contact': [value: string]
  'update:code': [value: string]
  'send-code': []
  cancel: []
  save: []
}>()

const codeButtonText = computed(() => {
  if (props.sending) return '发送中'
  if (props.countdown > 0) return `${props.countdown}s`
  return '发送验证码'
})
</script>
