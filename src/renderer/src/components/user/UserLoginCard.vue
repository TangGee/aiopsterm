<template>
  <section class="user-login-card auth-login-card">
    <div class="user-login-heading">
      <div class="user-avatar large muted">
        <User />
      </div>
      <div>
        <h3>请先登录</h3>
        <p>登录后可查看个人信息、账号中心、订阅和可信设备状态。</p>
      </div>
    </div>

    <div
      class="user-login-tabs"
      role="tablist"
    >
      <button
        :class="{ active: loginTab === 'email' }"
        @click="emit('update:loginTab', 'email')"
      >
        邮箱登录
      </button>
      <button
        :class="{ active: loginTab === 'mobile' }"
        @click="emit('update:loginTab', 'mobile')"
      >
        手机号登录
      </button>
      <button
        :class="{ active: loginTab === 'account' }"
        @click="emit('update:loginTab', 'account')"
      >
        账号登录
      </button>
    </div>

    <div
      v-if="loginTab === 'account'"
      class="user-login-form"
    >
      <label>
        <span>用户名</span>
        <input
          :value="loginDraft.username"
          placeholder="请输入用户名"
          @input="updateDraft('username', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <label>
        <span>密码</span>
        <input
          :value="loginDraft.password"
          type="password"
          placeholder="请输入密码"
          @input="updateDraft('password', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <button
        class="settings-button primary"
        :disabled="loginLoading"
        @click="emit('login-account')"
      >
        {{ loginLoading ? '登录中' : '登录' }}
      </button>
    </div>

    <div
      v-else-if="loginTab === 'email'"
      class="user-login-form"
    >
      <label>
        <span>邮箱</span>
        <input
          :value="loginDraft.email"
          type="email"
          placeholder="请输入邮箱"
          @input="updateDraft('email', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <label>
        <span>验证码</span>
        <div class="user-code-row">
          <input
            :value="loginDraft.emailCode"
            placeholder="请输入验证码"
            @input="updateDraft('emailCode', ($event.target as HTMLInputElement).value)"
          />
          <button
            class="settings-button"
            :disabled="!canSendEmailCode || loginCodeCountdown.email > 0 || loginCodeSending.email"
            @click="emit('send-code', 'email')"
          >
            {{ loginCodeText('email') }}
          </button>
        </div>
      </label>
      <button
        class="settings-button primary"
        :disabled="loginLoading"
        @click="emit('login-email')"
      >
        {{ loginLoading ? '登录中' : '登录' }}
      </button>
    </div>

    <div
      v-else
      class="user-login-form"
    >
      <label>
        <span>手机号</span>
        <div class="user-mobile-input">
          <em>+86</em>
          <input
            :value="loginDraft.mobile"
            type="tel"
            placeholder="请输入手机号"
            @input="updateDraft('mobile', ($event.target as HTMLInputElement).value)"
          />
        </div>
      </label>
      <label>
        <span>验证码</span>
        <div class="user-code-row">
          <input
            :value="loginDraft.mobileCode"
            placeholder="请输入验证码"
            @input="updateDraft('mobileCode', ($event.target as HTMLInputElement).value)"
          />
          <button
            class="settings-button"
            :disabled="!canSendMobileCode || loginCodeCountdown.mobile > 0 || loginCodeSending.mobile"
            @click="emit('send-code', 'mobile')"
          >
            {{ loginCodeText('mobile') }}
          </button>
        </div>
      </label>
      <button
        class="settings-button primary"
        :disabled="loginLoading"
        @click="emit('login-mobile')"
      >
        {{ loginLoading ? '登录中' : '登录' }}
      </button>
    </div>

    <p
      v-if="needDeviceVerification"
      class="user-login-warning"
    >
      当前设备需要验证后才能登录
    </p>

    <div class="user-skip-login">
      暂不登录
      <button @click="emit('skip-login')">跳过登录</button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { User } from 'lucide-vue-next'
import type { WorkspaceUserContactKind, WorkspaceUserLoginTab } from '@/services/workspaceUserController'
import type { UserLoginDraft } from '@/services/userPanelTypes'

const props = defineProps<{
  loginTab: WorkspaceUserLoginTab
  loginDraft: UserLoginDraft
  loginLoading: boolean
  loginCodeCountdown: Record<WorkspaceUserContactKind, number>
  loginCodeSending: Record<WorkspaceUserContactKind, boolean>
  canSendEmailCode: boolean
  canSendMobileCode: boolean
  needDeviceVerification: boolean
}>()

const emit = defineEmits<{
  'update:loginTab': [value: WorkspaceUserLoginTab]
  'update:loginDraft': [value: UserLoginDraft]
  'send-code': [kind: WorkspaceUserContactKind]
  'login-account': []
  'login-email': []
  'login-mobile': []
  'skip-login': []
}>()

const updateDraft = <Key extends keyof UserLoginDraft>(key: Key, value: UserLoginDraft[Key]) => {
  emit('update:loginDraft', { ...props.loginDraft, [key]: value })
}

const loginCodeText = (kind: WorkspaceUserContactKind) => {
  if (props.loginCodeSending[kind]) return '发送中'
  if (props.loginCodeCountdown[kind] > 0) return `${props.loginCodeCountdown[kind]}s`
  return '获取验证码'
}
</script>
