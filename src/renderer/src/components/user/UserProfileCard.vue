<template>
  <section class="user-info-card">
    <div
      class="user-avatar large"
      title="头像设置"
      @click="emit('open-avatar')"
    >
      <img
        v-if="profile.avatarImageUrl"
        :src="profile.avatarImageUrl"
        alt=""
      />
      <span v-else>{{ profile.avatarInitials }}</span>
      <div class="user-avatar-overlay">
        <Camera />
      </div>
      <em
        v-if="isSubscriptionActive"
        class="user-vip-badge"
      >
        VIP/{{ profile.subscription }}
      </em>
    </div>

    <div class="registration_type">
      {{ registrationLabel }}
      <span
        class="subscription-tag"
        :class="{ free: !isSubscriptionActive }"
        :title="`到期时间：${profile.subscriptionExpiresAt}`"
      >
        {{ isSubscriptionActive ? titleCase(profile.subscription) : 'free' }}
      </span>
    </div>

    <div class="user-status-strip">
      <span>{{ profile.authProvider === 'local' ? '本地账号' : profile.authProvider.toUpperCase() }}</span>
      <span>{{ profile.isOfficeDevice ? '办公设备' : '非办公设备' }}</span>
      <span :class="{ warn: profile.needDeviceVerification }">
        {{ profile.needDeviceVerification ? '需要设备验证' : '设备已验证' }}
      </span>
    </div>

    <div class="user-divider" />

    <div class="user-info-actions">
      <button
        v-if="!editing"
        class="settings-button icon-only"
        title="编辑"
        @click="emit('start-editing')"
      >
        <Pencil />
      </button>
      <template v-else>
        <button
          class="settings-button icon-only"
          title="保存"
          @click="emit('save-profile')"
        >
          <Check />
        </button>
        <button
          class="settings-button icon-only"
          title="取消"
          @click="emit('cancel-editing')"
        >
          <X />
        </button>
      </template>
    </div>

    <div class="user-info-form">
      <label>
        <span>UID</span>
        <strong>{{ profile.uid }}</strong>
      </label>

      <label>
        <span>姓名</span>
        <input
          v-if="editing"
          :value="profileDraft.name"
          placeholder="请输入姓名"
          @input="updateDraft('name', ($event.target as HTMLInputElement).value)"
        />
        <strong v-else>{{ profile.name }}</strong>
      </label>

      <label>
        <span>用户名</span>
        <input
          v-if="editing"
          :value="profileDraft.username"
          placeholder="请输入用户名"
          @input="updateDraft('username', ($event.target as HTMLInputElement).value)"
        />
        <strong v-else>{{ profile.username }}</strong>
      </label>

      <label>
        <span>密码</span>
        <div class="user-inline-value">
          <strong>****************</strong>
          <button
            v-if="!editing && canResetPassword"
            class="settings-button icon-only"
            title="重置密码"
            @click="emit('open-password')"
          >
            <Pencil />
          </button>
        </div>
      </label>

      <label>
        <span>手机号</span>
        <div class="user-inline-value">
          <strong>{{ profile.mobile || '-' }}</strong>
          <button
            v-if="!editing && canEditMobile"
            class="settings-button icon-only"
            :title="profile.mobile ? '修改手机号' : '绑定手机号'"
            @click="emit('open-contact', 'mobile')"
          >
            <Pencil />
          </button>
        </div>
      </label>

      <label>
        <span>邮箱</span>
        <div class="user-inline-value">
          <strong>{{ profile.email || '-' }}</strong>
          <button
            v-if="!editing && canEditEmail"
            class="settings-button icon-only"
            :title="profile.email ? '修改邮箱' : '绑定邮箱'"
            @click="emit('open-contact', 'email')"
          >
            <Pencil />
          </button>
        </div>
      </label>

      <label>
        <span>IP</span>
        <strong>{{ profile.localIp }}</strong>
      </label>

      <label>
        <span>MAC地址</span>
        <strong>{{ profile.macAddress }}</strong>
      </label>
    </div>

    <footer class="user-info-footer">
      <button
        class="settings-button"
        @click="emit('open-account-center')"
      >
        <Gauge />
        账号中心
      </button>
      <button
        class="settings-button danger"
        @click="emit('logout')"
      >
        <LogOut />
        退出登录
      </button>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Camera, Check, Gauge, LogOut, Pencil, X } from 'lucide-vue-next'
import type { WorkspaceUserContactKind } from '@/services/user/workspaceUserController'
import type { AiopsUserProfile } from '@shared/contracts/userAccount'
import type { UserProfileDraft } from '@/services/user/userPanelTypes'

const props = defineProps<{
  profile: AiopsUserProfile
  profileDraft: UserProfileDraft
  editing: boolean
  isSubscriptionActive: boolean
  canResetPassword: boolean
  canEditMobile: boolean
  canEditEmail: boolean
}>()

const emit = defineEmits<{
  'update:profileDraft': [value: UserProfileDraft]
  'start-editing': []
  'cancel-editing': []
  'save-profile': []
  'open-password': []
  'open-contact': [kind: WorkspaceUserContactKind]
  'open-avatar': []
  'open-account-center': []
  logout: []
}>()

const registrationLabel = computed(() => {
  if (props.isSubscriptionActive) return 'VIP用户'
  return props.profile.registrationType === 'enterprise' ? '企业用户' : '个人用户'
})

const titleCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)

const updateDraft = <Key extends keyof UserProfileDraft>(key: Key, value: UserProfileDraft[Key]) => {
  emit('update:profileDraft', { ...props.profileDraft, [key]: value })
}
</script>
