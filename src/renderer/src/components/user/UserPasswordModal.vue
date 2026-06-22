<template>
  <div class="user-modal-backdrop">
    <section class="user-modal-card">
      <header>
        <h3>重置密码</h3>
        <button
          title="关闭"
          @click="emit('cancel')"
        >
          <X />
        </button>
      </header>
      <label>
        <span>密码</span>
        <input
          :value="password"
          type="password"
          placeholder="请输入新密码"
          @input="emit('update:password', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <label>
        <span>确认密码</span>
        <input
          :value="confirmPassword"
          type="password"
          placeholder="请再次输入新密码"
          @input="emit('update:confirmPassword', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <p
        v-if="confirmPassword && password !== confirmPassword"
        class="user-modal-error"
      >
        两次输入的密码不一致
      </p>
      <p
        v-if="password"
        class="password-strength"
        :class="passwordStrengthClass"
      >
        {{ passwordStrengthText }}
      </p>
      <footer>
        <button
          class="settings-button"
          @click="emit('cancel')"
        >
          取消
        </button>
        <button
          class="settings-button primary"
          :disabled="!canSavePassword"
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

const props = defineProps<{
  password: string
  confirmPassword: string
}>()

const emit = defineEmits<{
  'update:password': [value: string]
  'update:confirmPassword': [value: string]
  cancel: []
  save: []
}>()

const passwordScore = computed(() => {
  const value = props.password
  if (!value) return 0
  let score = value.length >= 8 ? 1 : 0
  if (/[A-Z]/.test(value)) score += 1
  if (/\d/.test(value)) score += 1
  if (/[^A-Za-z0-9]/.test(value)) score += 1
  return score
})

const passwordStrengthText = computed(() => (passwordScore.value <= 1 ? '密码强度弱' : passwordScore.value === 2 ? '密码强度中' : '密码强度强'))
const passwordStrengthClass = computed(() => (passwordScore.value <= 1 ? 'weak' : passwordScore.value === 2 ? 'medium' : 'strong'))
const canSavePassword = computed(() => props.password.length >= 6 && props.password === props.confirmPassword)
</script>
