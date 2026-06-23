<template>
  <div class="user-modal-backdrop">
    <section class="user-modal-card user-account-modal">
      <header>
        <h3>账号中心</h3>
        <button
          title="关闭"
          @click="emit('close')"
        >
          <X />
        </button>
      </header>
      <div class="account-center-grid">
        <section>
          <small>账号</small>
          <strong>{{ profile.email || profile.username }}</strong>
          <span>{{ accountAuthLabel }}</span>
        </section>
        <section>
          <small>订阅</small>
          <strong>{{ isSubscriptionActive ? titleCase(profile.subscription) : 'Free' }}</strong>
          <span>{{ profile.subscriptionExpiresAt }} 到期</span>
        </section>
        <section>
          <small>可信设备</small>
          <strong>{{ trustedDevices.length }}</strong>
          <span>{{ currentDeviceLabel }}</span>
        </section>
        <section>
          <small>计费用量</small>
          <strong>{{ Math.round(billingSettings.ratio * 100) }}%</strong>
          <span>{{ billingSettings.budgetResetAt }} 重置</span>
        </section>
        <section>
          <small>登录时间</small>
          <strong>{{ profile.lastLoginAt || '-' }}</strong>
          <span>{{ profile.localDatabaseReady ? '本地数据库已初始化' : '本地数据库未初始化' }}</span>
        </section>
        <section>
          <small>密码</small>
          <strong>{{ profile.passwordUpdatedAt || '-' }}</strong>
          <span>{{ canResetPassword ? '允许重置' : '当前账号不可重置' }}</span>
        </section>
      </div>
      <div class="account-device-list">
        <article
          v-for="device in trustedDevices"
          :key="device.id"
        >
          <div>
            <strong>{{ device.deviceName }}</strong>
            <span>{{ device.lastLoginIp }} · {{ device.location }}</span>
          </div>
          <div class="account-device-actions">
            <em :class="{ current: device.current }">{{ device.current ? '当前设备' : '可信设备' }}</em>
            <button
              class="settings-button icon-only danger"
              :disabled="device.current"
              :title="device.current ? '当前设备不能移除' : '移除可信设备'"
              @click="emit('revoke-device', device.id)"
            >
              <Trash2 />
            </button>
          </div>
        </article>
      </div>
      <footer>
        <button
          class="settings-button"
          @click="emit('open-billing-settings')"
        >
          订阅设置
        </button>
        <button
          class="settings-button"
          @click="emit('open-trusted-devices')"
        >
          可信设备
        </button>
      </footer>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Trash2, X } from 'lucide-vue-next'
import type { WorkspaceBillingSettings, WorkspaceTrustedDevice } from '@/services/user/workspaceUserController'
import type { AiopsUserProfile } from '@shared/contracts/userAccount'

const props = defineProps<{
  profile: AiopsUserProfile
  trustedDevices: WorkspaceTrustedDevice[]
  billingSettings: WorkspaceBillingSettings
  isSubscriptionActive: boolean
  canResetPassword: boolean
}>()

const emit = defineEmits<{
  close: []
  'revoke-device': [id: number]
  'open-billing-settings': []
  'open-trusted-devices': []
}>()

const currentDeviceLabel = computed(() => props.trustedDevices.find((device) => device.current)?.deviceName || '未识别当前设备')

const accountAuthLabel = computed(() => {
  if (props.profile.lastLoginMethod === 'email') return '邮箱验证码登录'
  if (props.profile.lastLoginMethod === 'mobile') return '手机号验证码登录'
  if (props.profile.lastLoginMethod === 'skip') return '访客登录'
  if (props.profile.authProvider === 'local') return '本地密码登录'
  return '第三方登录'
})

const titleCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)
</script>
