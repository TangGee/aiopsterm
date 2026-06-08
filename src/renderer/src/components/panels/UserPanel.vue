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
        class="user-login-card auth-login-card"
      >
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
            :class="{ active: workspace.userLoginTab === 'email' }"
            @click="workspace.setUserLoginTab('email')"
          >
            邮箱登录
          </button>
          <button
            :class="{ active: workspace.userLoginTab === 'mobile' }"
            @click="workspace.setUserLoginTab('mobile')"
          >
            手机号登录
          </button>
          <button
            :class="{ active: workspace.userLoginTab === 'account' }"
            @click="workspace.setUserLoginTab('account')"
          >
            账号登录
          </button>
        </div>

        <div
          v-if="workspace.userLoginTab === 'account'"
          class="user-login-form"
        >
          <label>
            <span>用户名</span>
            <input
              v-model="loginDraft.username"
              placeholder="请输入用户名"
            />
          </label>
          <label>
            <span>密码</span>
            <input
              v-model="loginDraft.password"
              type="password"
              placeholder="请输入密码"
            />
          </label>
          <button
            class="settings-button primary"
            :disabled="workspace.userLoginLoading"
            @click="loginWithAccount"
          >
            {{ workspace.userLoginLoading ? '登录中' : '登录' }}
          </button>
        </div>

        <div
          v-else-if="workspace.userLoginTab === 'email'"
          class="user-login-form"
        >
          <label>
            <span>邮箱</span>
            <input
              v-model="loginDraft.email"
              type="email"
              placeholder="请输入邮箱"
            />
          </label>
          <label>
            <span>验证码</span>
            <div class="user-code-row">
              <input
                v-model="loginDraft.emailCode"
                placeholder="请输入验证码"
              />
              <button
                class="settings-button"
                :disabled="!canSendLoginEmailCode || workspace.userLoginCodeCountdown.email > 0 || workspace.userLoginCodeSending.email"
                @click="sendLoginCode('email')"
              >
                {{
                  workspace.userLoginCodeSending.email
                    ? '发送中'
                    : workspace.userLoginCodeCountdown.email > 0
                      ? `${workspace.userLoginCodeCountdown.email}s`
                      : '获取验证码'
                }}
              </button>
            </div>
          </label>
          <button
            class="settings-button primary"
            :disabled="workspace.userLoginLoading"
            @click="loginWithEmail"
          >
            {{ workspace.userLoginLoading ? '登录中' : '登录' }}
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
                v-model="loginDraft.mobile"
                type="tel"
                placeholder="请输入手机号"
              />
            </div>
          </label>
          <label>
            <span>验证码</span>
            <div class="user-code-row">
              <input
                v-model="loginDraft.mobileCode"
                placeholder="请输入验证码"
              />
              <button
                class="settings-button"
                :disabled="!canSendLoginMobileCode || workspace.userLoginCodeCountdown.mobile > 0 || workspace.userLoginCodeSending.mobile"
                @click="sendLoginCode('mobile')"
              >
                {{
                  workspace.userLoginCodeSending.mobile
                    ? '发送中'
                    : workspace.userLoginCodeCountdown.mobile > 0
                      ? `${workspace.userLoginCodeCountdown.mobile}s`
                      : '获取验证码'
                }}
              </button>
            </div>
          </label>
          <button
            class="settings-button primary"
            :disabled="workspace.userLoginLoading"
            @click="loginWithMobile"
          >
            {{ workspace.userLoginLoading ? '登录中' : '登录' }}
          </button>
        </div>

        <p
          v-if="workspace.userProfile.needDeviceVerification"
          class="user-login-warning"
        >
          当前设备需要验证后才能登录
        </p>

        <div class="user-skip-login">
          暂不登录
          <button @click="skipLogin">跳过登录</button>
        </div>
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
          <img
            v-if="workspace.userProfile.avatarImageUrl"
            :src="workspace.userProfile.avatarImageUrl"
            alt=""
          />
          <span v-else>{{ workspace.userProfile.avatarInitials }}</span>
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
            :title="`到期时间：${workspace.userProfile.subscriptionExpiresAt}`"
          >
            {{ isSubscriptionActive ? titleCase(workspace.userProfile.subscription) : 'free' }}
          </span>
        </div>

        <div class="user-status-strip">
          <span>{{ workspace.userProfile.authProvider === 'local' ? '本地账号' : workspace.userProfile.authProvider.toUpperCase() }}</span>
          <span>{{ workspace.userProfile.isOfficeDevice ? '办公设备' : '非办公设备' }}</span>
          <span :class="{ warn: workspace.userProfile.needDeviceVerification }">
            {{ workspace.userProfile.needDeviceVerification ? '需要设备验证' : '设备已验证' }}
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
                v-if="!editing && workspace.canResetUserPassword"
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
                v-if="!editing && workspace.canEditUserMobile"
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
                v-if="!editing && workspace.canEditUserEmail"
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
            @click="cancelPasswordModal"
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
          v-if="confirmPasswordDraft && passwordDraft !== confirmPasswordDraft"
          class="user-modal-error"
        >
          两次输入的密码不一致
        </p>
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
            @click="cancelPasswordModal"
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
            @click="cancelContactModal"
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
              :disabled="!canSendContactCode || workspace.userContactCodeCountdown[contactKind] > 0 || workspace.userContactCodeSending[contactKind]"
              @click="sendContactCode"
            >
              {{
                workspace.userContactCodeSending[contactKind]
                  ? '发送中'
                  : workspace.userContactCodeCountdown[contactKind] > 0
                    ? `${workspace.userContactCodeCountdown[contactKind]}s`
                    : '发送验证码'
              }}
            </button>
          </div>
        </label>
        <footer>
          <button
            class="settings-button"
            @click="cancelContactModal"
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
            @click="cancelAvatarModal"
          >
            <X />
          </button>
        </header>
        <div
          class="avatar-preview-box"
          :class="{ empty: !avatarPreview }"
          @click="!avatarPreview ? chooseAvatarImage() : undefined"
        >
          <img
            v-if="avatarPreview"
            :src="avatarPreview"
            :style="{ transform: `scale(${avatarZoom}) translate(${avatarOffset.x / avatarZoom}px, ${avatarOffset.y / avatarZoom}px)` }"
            alt=""
            draggable="false"
            @mousedown="startAvatarDrag"
          />
          <div
            v-else
            class="avatar-preview-placeholder"
          >
            <Camera />
            <p>点击上传头像</p>
          </div>
        </div>
        <div
          v-if="avatarPreview"
          class="avatar-zoom-control"
        >
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
        <div class="avatar-actions-row">
          <button
            class="settings-button"
            @click="chooseAvatarImage"
          >
            本地上传
          </button>
          <button
            v-if="avatarPreview"
            class="settings-button"
            @click="clearAvatarImage"
          >
            使用缩写
          </button>
          <input
            ref="avatarInput"
            class="visually-hidden-input"
            type="file"
            accept="image/*"
            @change="handleAvatarFile"
          />
        </div>
        <footer>
          <button
            class="settings-button"
            @click="cancelAvatarModal"
          >
            取消
          </button>
          <button
            class="settings-button primary"
            :disabled="!avatarPreview"
            @click="saveAvatar"
          >
            保存
          </button>
        </footer>
      </section>
    </div>

    <div
      v-if="workspace.userAccountCenterOpen"
      class="user-modal-backdrop"
    >
      <section class="user-modal-card user-account-modal">
        <header>
          <h3>账号中心</h3>
          <button
            title="关闭"
            @click="workspace.closeAccountCenter"
          >
            <X />
          </button>
        </header>
        <div class="account-center-grid">
          <section>
            <small>账号</small>
            <strong>{{ workspace.userProfile.email || workspace.userProfile.username }}</strong>
            <span>{{ accountAuthLabel }}</span>
          </section>
          <section>
            <small>订阅</small>
            <strong>{{ isSubscriptionActive ? titleCase(workspace.userProfile.subscription) : 'Free' }}</strong>
            <span>{{ workspace.userProfile.subscriptionExpiresAt }} 到期</span>
          </section>
          <section>
            <small>可信设备</small>
            <strong>{{ workspace.trustedDevices.length }}</strong>
            <span>{{ currentDeviceLabel }}</span>
          </section>
          <section>
            <small>计费用量</small>
            <strong>{{ Math.round(workspace.billingSettings.ratio * 100) }}%</strong>
            <span>{{ workspace.billingSettings.budgetResetAt }} 重置</span>
          </section>
          <section>
            <small>登录时间</small>
            <strong>{{ workspace.userProfile.lastLoginAt || '-' }}</strong>
            <span>{{ workspace.userProfile.localDatabaseReady ? '本地数据库已初始化' : '本地数据库未初始化' }}</span>
          </section>
          <section>
            <small>密码</small>
            <strong>{{ workspace.userProfile.passwordUpdatedAt || '-' }}</strong>
            <span>{{ workspace.canResetUserPassword ? '允许重置' : '当前账号不可重置' }}</span>
          </section>
        </div>
        <div class="account-device-list">
          <article
            v-for="device in workspace.trustedDevices"
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
                @click="workspace.openTrustedDeviceRevoke(device.id)"
              >
                <Trash2 />
              </button>
            </div>
          </article>
        </div>
        <footer>
          <button
            class="settings-button"
            @click="workspace.setActiveModule('settings'); workspace.setActiveSettingsSection('billing'); workspace.closeAccountCenter()"
          >
            订阅设置
          </button>
          <button
            class="settings-button"
            @click="workspace.setActiveModule('settings'); workspace.setActiveSettingsSection('trustedDevices'); workspace.closeAccountCenter()"
          >
            可信设备
          </button>
        </footer>
      </section>
    </div>

    <div
      v-if="workspace.trustedDeviceModal.open"
      class="user-modal-backdrop"
    >
      <section class="user-modal-card small user-trusted-device-confirm">
        <header>
          <h3>移除可信设备</h3>
          <button
            title="关闭"
            @click="workspace.trustedDeviceModal.open = false"
          >
            <X />
          </button>
        </header>
        <p>确认移除该可信设备？</p>
        <footer>
          <button
            class="settings-button"
            @click="workspace.trustedDeviceModal.open = false"
          >
            取消
          </button>
          <button
            class="settings-button primary"
            @click="workspace.confirmTrustedDeviceRevoke"
          >
            完成
          </button>
        </footer>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onUnmounted, reactive, ref } from 'vue'
import { Camera, Check, Gauge, LogOut, Pencil, Trash2, User, X } from 'lucide-vue-next'
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
const avatarPreview = ref('')
const avatarZoom = ref(1)
const avatarInput = ref<HTMLInputElement | null>(null)
const avatarOffset = reactive({ x: 0, y: 0 })
const avatarDrag = reactive({ active: false, startX: 0, startY: 0 })
const loginDraft = reactive({
  username: workspace.userProfile.username || 'local_ops',
  password: '',
  email: workspace.userProfile.email || '',
  emailCode: '',
  mobile: workspace.userProfile.mobile || '',
  mobileCode: ''
})
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
const canSendContactCode = computed(() => (contactKind.value === 'email' ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactDraft.value.trim()) : /^1[3-9]\d{9}$/.test(contactDraft.value.trim())))
const canSendLoginEmailCode = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginDraft.email.trim()))
const canSendLoginMobileCode = computed(() => /^1[3-9]\d{9}$/.test(loginDraft.mobile.trim()))
const currentDeviceLabel = computed(() => workspace.trustedDevices.find((device) => device.current)?.deviceName || '未识别当前设备')
const accountAuthLabel = computed(() => {
  if (workspace.userProfile.lastLoginMethod === 'email') return '邮箱验证码登录'
  if (workspace.userProfile.lastLoginMethod === 'mobile') return '手机号验证码登录'
  if (workspace.userProfile.lastLoginMethod === 'skip') return '访客登录'
  if (workspace.userProfile.authProvider === 'local') return '本地密码登录'
  return '第三方登录'
})

const titleCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)

const sendLoginCode = (kind: 'email' | 'mobile') => {
  workspace.sendUserLoginCode(kind, kind === 'email' ? loginDraft.email : loginDraft.mobile)
}

const loginWithAccount = async () => {
  await workspace.loginWithAccount(loginDraft.username, loginDraft.password)
}

const loginWithEmail = async () => {
  await workspace.loginWithEmail(loginDraft.email, loginDraft.emailCode)
}

const loginWithMobile = async () => {
  await workspace.loginWithMobile(loginDraft.mobile, loginDraft.mobileCode)
}

const skipLogin = async () => {
  await workspace.skipUserLogin()
}

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

const saveProfile = async () => {
  const saved = await workspace.updateUserProfile({
    name: profileDraft.name,
    username: profileDraft.username
  })
  if (saved) editing.value = false
}

const openPasswordModal = () => {
  if (!workspace.canResetUserPassword) {
    workspace.setUserNotice('SSO 用户不能修改密码')
    return
  }
  passwordDraft.value = ''
  confirmPasswordDraft.value = ''
  passwordModalOpen.value = true
}

const cancelPasswordModal = () => {
  passwordModalOpen.value = false
  passwordDraft.value = ''
  confirmPasswordDraft.value = ''
}

const savePassword = async () => {
  const saved = await workspace.resetUserPassword(passwordDraft.value)
  if (saved) cancelPasswordModal()
}

const openContactModal = (kind: 'email' | 'mobile') => {
  if ((kind === 'email' && !workspace.canEditUserEmail) || (kind === 'mobile' && !workspace.canEditUserMobile)) {
    workspace.setUserNotice(kind === 'email' ? '当前登录方式不允许修改邮箱' : '当前登录方式不允许修改手机号')
    return
  }
  contactKind.value = kind
  contactDraft.value = workspace.userProfile[kind] || ''
  contactCodeDraft.value = ''
  contactModalOpen.value = true
}

const cancelContactModal = () => {
  contactModalOpen.value = false
  contactDraft.value = workspace.userProfile[contactKind.value] || ''
  contactCodeDraft.value = ''
}

const sendContactCode = () => {
  workspace.sendUserContactCode(contactKind.value, contactDraft.value)
}

const saveContact = async () => {
  const saved = await workspace.bindUserContact(contactKind.value, contactDraft.value, contactCodeDraft.value)
  if (saved) cancelContactModal()
}

const openAvatarModal = () => {
  resetAvatarPreview()
  avatarModalOpen.value = true
}

const chooseAvatarImage = () => {
  avatarInput.value?.click()
}

const clearAvatarImage = () => {
  resetAvatarPreview()
  if (avatarInput.value) avatarInput.value.value = ''
}

const resetAvatarPreview = () => {
  avatarPreview.value = ''
  avatarZoom.value = 1
  avatarOffset.x = 0
  avatarOffset.y = 0
  avatarDrag.active = false
}

const cancelAvatarModal = () => {
  avatarModalOpen.value = false
  resetAvatarPreview()
  if (avatarInput.value) avatarInput.value.value = ''
}

const handleAvatarFile = (event: Event) => {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (!file.type.startsWith('image/')) {
    workspace.setUserNotice('请选择图片文件')
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    avatarPreview.value = String(reader.result || '')
    avatarOffset.x = 0
    avatarOffset.y = 0
  }
  reader.onerror = () => {
    workspace.setUserNotice('图片读取失败')
  }
  reader.readAsDataURL(file)
  if (avatarInput.value) avatarInput.value.value = ''
}

const onAvatarDragMove = (event: MouseEvent) => {
  if (!avatarDrag.active) return
  avatarOffset.x = event.clientX - avatarDrag.startX
  avatarOffset.y = event.clientY - avatarDrag.startY
}

const stopAvatarDrag = () => {
  avatarDrag.active = false
}

const startAvatarDrag = (event: MouseEvent) => {
  if (!avatarPreview.value) return
  avatarDrag.active = true
  avatarDrag.startX = event.clientX - avatarOffset.x
  avatarDrag.startY = event.clientY - avatarOffset.y
  window.addEventListener('mousemove', onAvatarDragMove)
  window.addEventListener('mouseup', stopAvatarDrag, { once: true })
}

const saveAvatar = async () => {
  if (!avatarPreview.value) {
    workspace.setUserNotice('请先上传头像图片')
    return
  }
  const saved = await workspace.updateUserProfile({
    avatarImageUrl: avatarPreview.value
  })
  if (saved) cancelAvatarModal()
}

onUnmounted(() => {
  window.removeEventListener('mousemove', onAvatarDragMove)
  window.removeEventListener('mouseup', stopAvatarDrag)
})
</script>
