<template>
  <section class="user-info-workspace">
    <header class="user-info-title">
      <h2>个人信息</h2>
      <button
        class="settings-tab-close"
        title="关闭"
        @click="workspace.setActiveModule('workspace')"
      >
        <X />
      </button>
    </header>

    <main class="user-info-body">
      <section
        v-if="workspace.userProfile.skippedLogin"
        class="user-login-card"
      >
        <div class="user-avatar large muted">
          <User />
        </div>
        <h3>请先登录</h3>
        <p>登录后可查看个人信息、账号中心、订阅和可信设备状态。</p>
        <button
          class="settings-button primary"
          @click="workspace.loginUser"
        >
          登录
        </button>
      </section>

      <section
        v-else
        class="user-info-card"
      >
        <div
          class="user-avatar large"
          title="头像设置"
          @click="openAvatarModal"
        >
          <span>{{ workspace.userProfile.avatarInitials }}</span>
          <div class="user-avatar-overlay">
            <Camera />
          </div>
          <em
            v-if="isSubscriptionActive"
            class="user-vip-badge"
          >
            VIP/{{ workspace.userProfile.subscription }}
          </em>
        </div>

        <div class="registration_type">
          {{ isSubscriptionActive ? 'VIP用户' : workspace.userProfile.registrationType === 'enterprise' ? '企业用户' : '个人用户' }}
          <span
            class="subscription-tag"
            :class="{ free: !isSubscriptionActive }"
          >
            {{ isSubscriptionActive ? titleCase(workspace.userProfile.subscription) : 'free' }}
          </span>
        </div>

        <div class="user-divider" />

        <div class="user-info-actions">
          <button
            v-if="!editing"
            class="settings-button icon-only"
            title="编辑"
            @click="startEditing"
          >
            <Pencil />
          </button>
          <template v-else>
            <button
              class="settings-button icon-only"
              title="保存"
              @click="saveProfile"
            >
              <Check />
            </button>
            <button
              class="settings-button icon-only"
              title="取消"
              @click="cancelEditing"
            >
              <X />
            </button>
          </template>
        </div>

        <div class="user-info-form">
          <label>
            <span>UID</span>
            <strong>{{ workspace.userProfile.uid }}</strong>
          </label>

          <label>
            <span>姓名</span>
            <input
              v-if="editing"
              v-model="profileDraft.name"
              placeholder="请输入姓名"
            />
            <strong v-else>{{ workspace.userProfile.name }}</strong>
          </label>

          <label>
            <span>用户名</span>
            <input
              v-if="editing"
              v-model="profileDraft.username"
              placeholder="请输入用户名"
            />
            <strong v-else>{{ workspace.userProfile.username }}</strong>
          </label>

          <label>
            <span>密码</span>
            <div class="user-inline-value">
              <strong>****************</strong>
              <button
                class="settings-button icon-only"
                title="重置密码"
                @click="openPasswordModal"
              >
                <Pencil />
              </button>
            </div>
          </label>

          <label>
            <span>手机号</span>
            <div class="user-inline-value">
              <strong>{{ workspace.userProfile.mobile || '-' }}</strong>
              <button
                class="settings-button icon-only"
                :title="workspace.userProfile.mobile ? '修改手机号' : '绑定手机号'"
                @click="openContactModal('mobile')"
              >
                <Pencil />
              </button>
            </div>
          </label>

          <label>
            <span>邮箱</span>
            <div class="user-inline-value">
              <strong>{{ workspace.userProfile.email || '-' }}</strong>
              <button
                class="settings-button icon-only"
                :title="workspace.userProfile.email ? '修改邮箱' : '绑定邮箱'"
                @click="openContactModal('email')"
              >
                <Pencil />
              </button>
            </div>
          </label>

          <label>
            <span>IP</span>
            <strong>{{ workspace.userProfile.localIp }}</strong>
          </label>

          <label>
            <span>MAC地址</span>
            <strong>{{ workspace.userProfile.macAddress }}</strong>
          </label>
        </div>

        <footer class="user-info-footer">
          <button
            class="settings-button"
            @click="workspace.openAccountCenter"
          >
            <Gauge />
            账号中心
          </button>
          <button
            class="settings-button danger"
            @click="workspace.logoutUser"
          >
            <LogOut />
            退出登录
          </button>
        </footer>
      </section>
    </main>

    <div
      v-if="workspace.userNotice"
      class="user-info-notice"
    >
      {{ workspace.userNotice }}
    </div>

    <div
      v-if="passwordModalOpen"
      class="user-modal-backdrop"
    >
      <section class="user-modal-card">
        <header>
          <h3>重置密码</h3>
          <button
            title="关闭"
            @click="passwordModalOpen = false"
          >
            <X />
          </button>
        </header>
        <label>
          <span>密码</span>
          <input
            v-model="passwordDraft"
            type="password"
            placeholder="请输入新密码"
          />
        </label>
        <label>
          <span>确认密码</span>
          <input
            v-model="confirmPasswordDraft"
            type="password"
            placeholder="请再次输入新密码"
          />
        </label>
        <p
          v-if="passwordDraft"
          class="password-strength"
          :class="passwordStrengthClass"
        >
          {{ passwordStrengthText }}
        </p>
        <footer>
          <button
            class="settings-button"
            @click="passwordModalOpen = false"
          >
            取消
          </button>
          <button
            class="settings-button primary"
            :disabled="!canSavePassword"
            @click="savePassword"
          >
            确认
          </button>
        </footer>
      </section>
    </div>

    <div
      v-if="contactModalOpen"
      class="user-modal-backdrop"
    >
      <section class="user-modal-card">
        <header>
          <h3>{{ contactKind === 'email' ? '修改邮箱' : '修改手机号' }}</h3>
          <button
            title="关闭"
            @click="contactModalOpen = false"
          >
            <X />
          </button>
        </header>
        <label>
          <span>{{ contactKind === 'email' ? '邮箱' : '手机号' }}</span>
          <input
            v-model="contactDraft"
            :placeholder="contactKind === 'email' ? '请输入邮箱' : '请输入手机号'"
          />
        </label>
        <label>
          <span>验证码</span>
          <div class="user-code-row">
            <input
              v-model="contactCodeDraft"
              placeholder="请输入验证码"
            />
            <button
              class="settings-button"
              @click="sendContactCode"
            >
              发送验证码
            </button>
          </div>
        </label>
        <footer>
          <button
            class="settings-button"
            @click="contactModalOpen = false"
          >
            取消
          </button>
          <button
            class="settings-button primary"
            :disabled="!contactDraft || !contactCodeDraft"
            @click="saveContact"
          >
            确认
          </button>
        </footer>
      </section>
    </div>

    <div
      v-if="avatarModalOpen"
      class="user-modal-backdrop"
    >
      <section class="user-modal-card avatar-settings-modal">
        <header>
          <h3>头像设置</h3>
          <button
            title="关闭"
            @click="avatarModalOpen = false"
          >
            <X />
          </button>
        </header>
        <div class="avatar-preview-box">
          <span>{{ avatarDraft || workspace.userProfile.avatarInitials }}</span>
        </div>
        <label>
          <span>头像缩写</span>
          <input
            v-model="avatarDraft"
            maxlength="3"
            placeholder="例如 AI"
          />
        </label>
        <div class="avatar-zoom-control">
          <span>-</span>
          <input
            v-model="avatarZoom"
            type="range"
            min="1"
            max="2"
            step="0.1"
          />
          <span>+</span>
        </div>
        <footer>
          <button
            class="settings-button"
            @click="avatarModalOpen = false"
          >
            取消
          </button>
          <button
            class="settings-button primary"
            @click="saveAvatar"
          >
            保存
          </button>
        </footer>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { Camera, Check, Gauge, LogOut, Pencil, User, X } from 'lucide-vue-next'
import { useWorkspaceStore } from '@/stores/workspace'

const workspace = useWorkspaceStore()
const editing = ref(false)
const passwordModalOpen = ref(false)
const contactModalOpen = ref(false)
const avatarModalOpen = ref(false)
const contactKind = ref<'email' | 'mobile'>('email')
const passwordDraft = ref('')
const confirmPasswordDraft = ref('')
const contactDraft = ref('')
const contactCodeDraft = ref('')
const avatarDraft = ref('')
const avatarZoom = ref(1)
const profileDraft = reactive({
  name: workspace.userProfile.name,
  username: workspace.userProfile.username
})

const isSubscriptionActive = computed(() => {
  const profile = workspace.userProfile
  if (profile.subscription !== 'pro' && profile.subscription !== 'ultra') return false
  return new Date(profile.subscriptionExpiresAt) > new Date()
})

const passwordScore = computed(() => {
  const value = passwordDraft.value
  if (!value) return 0
  let score = value.length >= 8 ? 1 : 0
  if (/[A-Z]/.test(value)) score += 1
  if (/\d/.test(value)) score += 1
  if (/[^A-Za-z0-9]/.test(value)) score += 1
  return score
})
const passwordStrengthText = computed(() => (passwordScore.value <= 1 ? '密码强度弱' : passwordScore.value === 2 ? '密码强度中' : '密码强度强'))
const passwordStrengthClass = computed(() => (passwordScore.value <= 1 ? 'weak' : passwordScore.value === 2 ? 'medium' : 'strong'))
const canSavePassword = computed(() => passwordDraft.value.length >= 6 && passwordDraft.value === confirmPasswordDraft.value)

const titleCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)

const startEditing = () => {
  profileDraft.name = workspace.userProfile.name
  profileDraft.username = workspace.userProfile.username
  editing.value = true
}

const cancelEditing = () => {
  profileDraft.name = workspace.userProfile.name
  profileDraft.username = workspace.userProfile.username
  editing.value = false
}

const saveProfile = () => {
  workspace.updateUserProfile({
    name: profileDraft.name,
    username: profileDraft.username
  })
  editing.value = false
}

const openPasswordModal = () => {
  passwordDraft.value = ''
  confirmPasswordDraft.value = ''
  passwordModalOpen.value = true
}

const savePassword = () => {
  workspace.resetUserPassword()
  passwordModalOpen.value = false
}

const openContactModal = (kind: 'email' | 'mobile') => {
  contactKind.value = kind
  contactDraft.value = workspace.userProfile[kind] || ''
  contactCodeDraft.value = ''
  contactModalOpen.value = true
}

const sendContactCode = () => {
  workspace.setUserNotice(`${contactKind.value === 'email' ? '邮箱' : '手机'}验证码已发送`)
}

const saveContact = () => {
  workspace.bindUserContact(contactKind.value, contactDraft.value)
  contactModalOpen.value = false
}

const openAvatarModal = () => {
  avatarDraft.value = workspace.userProfile.avatarInitials
  avatarZoom.value = 1
  avatarModalOpen.value = true
}

const saveAvatar = () => {
  workspace.updateUserProfile({ avatarInitials: (avatarDraft.value || 'AI').toUpperCase().slice(0, 3) })
  avatarModalOpen.value = false
}
</script>
