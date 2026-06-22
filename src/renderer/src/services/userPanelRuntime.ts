import { computed, onUnmounted, reactive, ref } from 'vue'
import { localFilesClient } from '@/services/localFilesClient'
import { useWorkspaceStore } from '@/stores/workspace'
import type { WorkspaceUserContactKind } from '@/services/workspaceUserController'
import type { UserAvatarOffset, UserLoginDraft, UserProfileDraft } from '@/services/userPanelTypes'

type UserPanelSettingsSection = 'billing' | 'trustedDevices'

export const useUserPanelRuntime = () => {
  const workspace = useWorkspaceStore()
  const editing = ref(false)
  const passwordModalOpen = ref(false)
  const contactModalOpen = ref(false)
  const avatarModalOpen = ref(false)
  const contactKind = ref<WorkspaceUserContactKind>('email')
  const passwordDraft = ref('')
  const confirmPasswordDraft = ref('')
  const contactDraft = ref('')
  const contactCodeDraft = ref('')
  const avatarPreview = ref('')
  const avatarPreparedImageUrl = ref('')
  const avatarCleared = ref(false)
  const avatarZoom = ref(1)
  const avatarOffset = reactive<UserAvatarOffset>({ x: 0, y: 0 })
  const avatarDrag = reactive({ active: false, startX: 0, startY: 0 })
  const loginDraft = reactive<UserLoginDraft>({
    username: '',
    password: '',
    email: workspace.userProfile.email || '',
    emailCode: '',
    mobile: workspace.userProfile.mobile || '',
    mobileCode: ''
  })
  const profileDraft = reactive<UserProfileDraft>({
    name: workspace.userProfile.name,
    username: workspace.userProfile.username
  })

  const isSubscriptionActive = computed(() => {
    const profile = workspace.userProfile
    if (profile.subscription !== 'pro' && profile.subscription !== 'ultra') return false
    return new Date(profile.subscriptionExpiresAt) > new Date()
  })

  const canSendContactCode = computed(() =>
    contactKind.value === 'email'
      ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactDraft.value.trim())
      : /^1[3-9]\d{9}$/.test(contactDraft.value.trim())
  )
  const canSendLoginEmailCode = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginDraft.email.trim()))
  const canSendLoginMobileCode = computed(() => /^1[3-9]\d{9}$/.test(loginDraft.mobile.trim()))

  const updateLoginDraft = (draft: UserLoginDraft) => {
    Object.assign(loginDraft, draft)
  }

  const updateProfileDraft = (draft: UserProfileDraft) => {
    Object.assign(profileDraft, draft)
  }

  const sendLoginCode = (kind: WorkspaceUserContactKind) => {
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

  const openContactModal = (kind: WorkspaceUserContactKind) => {
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

  const resetAvatarPreview = () => {
    avatarPreview.value = ''
    avatarPreparedImageUrl.value = ''
    avatarCleared.value = false
    avatarZoom.value = 1
    avatarOffset.x = 0
    avatarOffset.y = 0
    avatarDrag.active = false
  }

  const openAvatarModal = () => {
    resetAvatarPreview()
    if (workspace.userProfile.avatarImageUrl) {
      avatarPreview.value = workspace.userProfile.avatarImageUrl
      avatarPreparedImageUrl.value = workspace.userProfile.avatarImageUrl
    }
    avatarModalOpen.value = true
  }

  const chooseAvatarImage = async () => {
    const showOpenDialog = localFilesClient.showOpenDialog()
    if (!showOpenDialog) {
      workspace.setUserNotice('头像选择服务不可用')
      return
    }
    try {
      const result = await showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] }]
      })
      if (!result || result.canceled || !result.filePaths.length) return
      const prepared = await workspace.prepareUserAvatarImage(result.filePaths[0])
      if (!prepared) return
      avatarPreview.value = prepared.dataUrl
      avatarPreparedImageUrl.value = prepared.avatarImageUrl
      avatarCleared.value = false
      avatarZoom.value = 1
      avatarOffset.x = 0
      avatarOffset.y = 0
      avatarDrag.active = false
    } catch (error) {
      workspace.setUserNotice(`头像图片读取失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const clearAvatarImage = () => {
    avatarPreview.value = ''
    avatarPreparedImageUrl.value = ''
    avatarCleared.value = true
    avatarZoom.value = 1
    avatarOffset.x = 0
    avatarOffset.y = 0
    avatarDrag.active = false
  }

  const cancelAvatarModal = () => {
    avatarModalOpen.value = false
    resetAvatarPreview()
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
    if (!avatarPreparedImageUrl.value && !avatarCleared.value) {
      workspace.setUserNotice('请先上传头像图片')
      return
    }
    const saved = await workspace.updateUserProfile({
      avatarImageUrl: avatarCleared.value ? '' : avatarPreparedImageUrl.value
    })
    if (saved) cancelAvatarModal()
  }

  const closeTrustedDeviceModal = () => {
    workspace.trustedDeviceModal.open = false
  }

  const openSettingsSection = (section: UserPanelSettingsSection) => {
    workspace.setActiveModule('settings')
    workspace.setActiveSettingsSection(section)
    workspace.closeAccountCenter()
  }

  onUnmounted(() => {
    window.removeEventListener('mousemove', onAvatarDragMove)
    window.removeEventListener('mouseup', stopAvatarDrag)
  })

  return {
    workspace,
    editing,
    passwordModalOpen,
    contactModalOpen,
    avatarModalOpen,
    contactKind,
    passwordDraft,
    confirmPasswordDraft,
    contactDraft,
    contactCodeDraft,
    avatarPreview,
    avatarPreparedImageUrl,
    avatarCleared,
    avatarZoom,
    avatarOffset,
    loginDraft,
    profileDraft,
    isSubscriptionActive,
    canSendContactCode,
    canSendLoginEmailCode,
    canSendLoginMobileCode,
    updateLoginDraft,
    updateProfileDraft,
    sendLoginCode,
    loginWithAccount,
    loginWithEmail,
    loginWithMobile,
    skipLogin,
    startEditing,
    cancelEditing,
    saveProfile,
    openPasswordModal,
    cancelPasswordModal,
    savePassword,
    openContactModal,
    cancelContactModal,
    sendContactCode,
    saveContact,
    openAvatarModal,
    chooseAvatarImage,
    clearAvatarImage,
    startAvatarDrag,
    cancelAvatarModal,
    saveAvatar,
    closeTrustedDeviceModal,
    openSettingsSection
  }
}
