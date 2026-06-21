import { computed, type Ref } from 'vue'
import { userAccountClient } from '@/services/userAccountClient'
import {
  createEmptyUserProfile,
  isTrustedDeviceRevokeData,
  isUserAccountSnapshot,
  isUserAvatarPrepareData,
  isUserCodeDataForRequest,
  isUserExternalActionData,
  isUserMutationData,
  type UserCodeData
} from '@/services/userAccountBackendGuards'
import type { ModuleKey } from '@/config/navigation'
import type { PrivacySettings } from '@/services/workspaceConfigRuntime'
import type {
  AiopsTrustedDevice,
  AiopsUserAccountSnapshot,
  AiopsUserExternalAction,
  AiopsUserExternalActionResult,
  AiopsUserMutationResult,
  AiopsUserProfile
} from '@shared/contracts/userAccount'

export type WorkspaceBillingSettings = {
  skippedLogin: boolean
  email: string
  subscription: string
  subscriptionExpiresAt: string
  budgetResetAt: string
  ratio: number
}

export type WorkspaceUserLoginTab = 'account' | 'email' | 'mobile'
export type WorkspaceUserContactKind = 'email' | 'mobile'
export type WorkspaceTrustedDevice = AiopsTrustedDevice
export type WorkspaceTrustedDeviceModal = { open: boolean; id: number | null }

type WorkspaceUserControllerState = {
  activeModule: Ref<ModuleKey>
  privacySettings: Ref<PrivacySettings>
  billingSettings: Ref<WorkspaceBillingSettings>
  userProfile: Ref<AiopsUserProfile>
  userNotice: Ref<string>
  userAccountCenterOpen: Ref<boolean>
  userContactCodeCountdown: Ref<Record<WorkspaceUserContactKind, number>>
  userContactCodeSending: Ref<Record<WorkspaceUserContactKind, boolean>>
  userLoginTab: Ref<WorkspaceUserLoginTab>
  userLoginLoading: Ref<boolean>
  userLoginCodeCountdown: Ref<Record<WorkspaceUserContactKind, number>>
  userLoginCodeSending: Ref<Record<WorkspaceUserContactKind, boolean>>
  trustedDevices: Ref<WorkspaceTrustedDevice[]>
  trustedDeviceModal: Ref<WorkspaceTrustedDeviceModal>
}

type WorkspaceUserControllerDeps = {
  setSettingsNotice: (message: string) => void
}

export const createDefaultWorkspaceBillingSettings = (): WorkspaceBillingSettings => ({
  skippedLogin: true,
  email: '',
  subscription: 'free',
  subscriptionExpiresAt: '',
  budgetResetAt: '',
  ratio: 0
})

export const createEmptyWorkspaceUserProfile = createEmptyUserProfile

export const createWorkspaceUserController = (state: WorkspaceUserControllerState, deps: WorkspaceUserControllerDeps) => {
  const {
    activeModule,
    privacySettings,
    billingSettings,
    userProfile,
    userNotice,
    userAccountCenterOpen,
    userContactCodeCountdown,
    userContactCodeSending,
    userLoginTab,
    userLoginLoading,
    userLoginCodeCountdown,
    userLoginCodeSending,
    trustedDevices,
    trustedDeviceModal
  } = state
  const { setSettingsNotice } = deps

  const userContactCodeTimers: Partial<Record<WorkspaceUserContactKind, number>> = {}
  const userLoginCodeTimers: Partial<Record<WorkspaceUserContactKind, number>> = {}

  const setUserNotice = (message: string) => {
    userNotice.value = message
  }

  const clearUserCodeTimer = (timers: Partial<Record<WorkspaceUserContactKind, number>>, kind: WorkspaceUserContactKind) => {
    if (!timers[kind]) return
    window.clearInterval(timers[kind])
    delete timers[kind]
  }

  const resetUserCodeState = (target: 'login' | 'contact', kind?: WorkspaceUserContactKind) => {
    const kinds: WorkspaceUserContactKind[] = kind ? [kind] : ['email', 'mobile']
    kinds.forEach((item) => {
      if (target === 'login') {
        userLoginCodeCountdown.value = { ...userLoginCodeCountdown.value, [item]: 0 }
        userLoginCodeSending.value = { ...userLoginCodeSending.value, [item]: false }
        clearUserCodeTimer(userLoginCodeTimers, item)
      } else {
        userContactCodeCountdown.value = { ...userContactCodeCountdown.value, [item]: 0 }
        userContactCodeSending.value = { ...userContactCodeSending.value, [item]: false }
        clearUserCodeTimer(userContactCodeTimers, item)
      }
    })
  }

  const isUserSubscriptionActive = computed(() => {
    const profile = userProfile.value
    if (profile.subscription !== 'pro' && profile.subscription !== 'ultra') return false
    return new Date(profile.subscriptionExpiresAt) > new Date()
  })

  const canEditUserMobile = computed(() => userProfile.value.registrationCode !== 7)
  const canEditUserEmail = computed(() => ![2, 3, 4, 6].includes(userProfile.value.registrationCode))
  const canResetUserPassword = computed(() => userProfile.value.registrationCode !== 1 && userProfile.value.authProvider !== 'sso')

  const applyUserAccountSnapshot = (snapshot: AiopsUserAccountSnapshot) => {
    userProfile.value = { ...snapshot.profile }
    trustedDevices.value = snapshot.trustedDevices.map((device) => ({ ...device }))
    billingSettings.value = {
      ...billingSettings.value,
      skippedLogin: snapshot.profile.skippedLogin || snapshot.profile.lastLoginMethod === 'skip',
      email: snapshot.profile.email,
      subscription: snapshot.profile.subscription,
      subscriptionExpiresAt: snapshot.profile.subscriptionExpiresAt
    }
  }

  const applyUserMutationResult = (result: AiopsUserMutationResult | undefined) => {
    if (!result) {
      setUserNotice('用户操作失败')
      userLoginLoading.value = false
      return false
    }
    if (result.ok) {
      if (!isUserMutationData(result.data)) {
        setUserNotice('用户后端返回了无效结果')
        userLoginLoading.value = false
        return false
      }
      applyUserAccountSnapshot(result.data)
      setUserNotice(result.data.message || '用户操作已完成')
      userLoginLoading.value = false
      return true
    }
    if (result.data !== undefined) {
      if (!isUserAccountSnapshot(result.data)) {
        setUserNotice('用户后端返回了无效结果')
        userLoginLoading.value = false
        return false
      }
      if (result.errorCode === 'USER_DEVICE_VERIFICATION_REQUIRED') {
        applyUserAccountSnapshot(result.data)
      }
    }
    setUserNotice(result.errorMessage || '用户操作失败')
    userLoginLoading.value = false
    return false
  }

  const applyUserExternalActionResult = (
    result: AiopsUserExternalActionResult | undefined,
    action: AiopsUserExternalAction,
    fallbackNotice: string,
    invalidNotice = '用户后端返回了无效结果'
  ) => {
    if (!result) {
      setUserNotice(fallbackNotice)
      userLoginLoading.value = false
      return false
    }
    if (!result.ok) {
      setUserNotice(result.errorMessage || fallbackNotice)
      userLoginLoading.value = false
      return false
    }
    if (!isUserExternalActionData(result.data, action)) {
      setUserNotice(invalidNotice)
      userLoginLoading.value = false
      return false
    }
    setUserNotice(result.data.message)
    userLoginLoading.value = false
    return true
  }

  const refreshUserAccount = async () => {
    const getUserAccount = userAccountClient.getUserAccount()
    if (!getUserAccount) return false
    try {
      const result = await getUserAccount()
      if (!result?.ok || !result.data) {
        setUserNotice(result?.errorMessage || '用户信息加载失败')
        return false
      }
      if (!isUserAccountSnapshot(result.data)) {
        setUserNotice('用户后端返回了无效账号快照')
        return false
      }
      applyUserAccountSnapshot(result.data)
      return true
    } catch (error) {
      setUserNotice(error instanceof Error ? error.message : '用户信息加载失败')
      return false
    }
  }

  const userCooldownRemainingSeconds = (expiresAt: number) => Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000))

  const isValidUserCodeCooldown = (cooldown: UserCodeData | undefined): cooldown is UserCodeData =>
    Boolean(cooldown && typeof cooldown.expiresAt === 'number' && Number.isFinite(cooldown.expiresAt) && typeof cooldown.message === 'string')

  const startUserCountdown = (target: 'login' | 'contact', kind: WorkspaceUserContactKind, cooldown: UserCodeData) => {
    const sendingRef = target === 'login' ? userLoginCodeSending : userContactCodeSending
    const countdownRef = target === 'login' ? userLoginCodeCountdown : userContactCodeCountdown
    const timers = target === 'login' ? userLoginCodeTimers : userContactCodeTimers
    const expiresAt = cooldown.expiresAt
    const applyCountdown = () => {
      const next = userCooldownRemainingSeconds(expiresAt)
      countdownRef.value = { ...countdownRef.value, [kind]: next }
      if (next === 0) clearUserCodeTimer(timers, kind)
    }

    sendingRef.value = { ...sendingRef.value, [kind]: false }
    clearUserCodeTimer(timers, kind)
    applyCountdown()
    if (countdownRef.value[kind] > 0) {
      timers[kind] = window.setInterval(applyCountdown, 1000)
    }
    setUserNotice(cooldown.message)
  }

  const rejectInvalidUserCodeCooldown = (target: 'login' | 'contact', kind: WorkspaceUserContactKind) => {
    const sendingRef = target === 'login' ? userLoginCodeSending : userContactCodeSending
    const countdownRef = target === 'login' ? userLoginCodeCountdown : userContactCodeCountdown
    const timers = target === 'login' ? userLoginCodeTimers : userContactCodeTimers
    sendingRef.value = { ...sendingRef.value, [kind]: false }
    countdownRef.value = { ...countdownRef.value, [kind]: 0 }
    clearUserCodeTimer(timers, kind)
    setUserNotice('验证码冷却状态无效')
  }

  const openAccountCenter = async (options: { activateUserModule?: boolean; notifySettings?: boolean } = {}) => {
    if (!userAccountClient.getUserAccount()) {
      setUserNotice('账号中心服务不可用')
      if (options.notifySettings) setSettingsNotice('账户中心服务不可用')
      return false
    }
    const openUserAccountCenterBridge = userAccountClient.openUserAccountCenter()
    if (!openUserAccountCenterBridge) {
      setUserNotice('账号中心服务不可用')
      if (options.notifySettings) setSettingsNotice('账户中心服务不可用')
      return false
    }
    const refreshed = await refreshUserAccount()
    if (!refreshed) {
      if (options.notifySettings) setSettingsNotice('账户中心打开失败')
      return false
    }
    let opened = false
    try {
      opened = applyUserExternalActionResult(await openUserAccountCenterBridge(), 'account-center', '账号中心打开失败')
    } catch {
      setUserNotice('账号中心打开失败')
      userLoginLoading.value = false
      opened = false
    }
    if (!opened) {
      if (options.notifySettings) setSettingsNotice(userNotice.value || '账户中心打开失败')
      return false
    }
    userAccountCenterOpen.value = true
    if (options.activateUserModule) activeModule.value = 'user'
    if (options.notifySettings) setSettingsNotice(userNotice.value || '账号中心已打开')
    return true
  }

  const closeAccountCenter = () => {
    userAccountCenterOpen.value = false
  }

  const openUserLogin = async () => {
    const openUserLoginBridge = userAccountClient.openUserLogin()
    if (!openUserLoginBridge) {
      setUserNotice('登录服务不可用')
      return false
    }
    try {
      const opened = applyUserExternalActionResult(await openUserLoginBridge(), 'login', '登录服务打开失败')
      if (!opened) return false
      activeModule.value = 'user'
      userLoginTab.value = 'account'
      resetUserCodeState('login')
      return true
    } catch {
      setUserNotice('登录服务打开失败')
      userLoginLoading.value = false
      return false
    }
  }

  const setUserLoginTab = (tab: WorkspaceUserLoginTab) => {
    userLoginTab.value = tab
  }

  const loginUser = async (username = '', password = '') => {
    const loginUserAccountBridge = userAccountClient.loginUserAccount()
    if (!loginUserAccountBridge) {
      setUserNotice('账号登录服务不可用')
      return false
    }
    try {
      return applyUserMutationResult(await loginUserAccountBridge({ method: 'account', username, password }))
    } catch {
      setUserNotice('账号登录失败')
      return false
    }
  }

  const logoutUser = async () => {
    userAccountCenterOpen.value = false
    resetUserCodeState('login')
    resetUserCodeState('contact')
    const logoutUserAccountBridge = userAccountClient.logoutUserAccount()
    if (!logoutUserAccountBridge) {
      setUserNotice('登出服务不可用')
      return false
    }
    try {
      return applyUserMutationResult(await logoutUserAccountBridge())
    } catch {
      setUserNotice('登出失败')
      return false
    }
  }

  const deactivateUserAccount = async () => {
    const confirmation = privacySettings.value.deactivateConfirmationInput.trim()
    if (confirmation !== 'DEACTIVATE') {
      setSettingsNotice('请输入 DEACTIVATE 以确认停用账户')
      return false
    }
    const deactivateUserAccountBridge = userAccountClient.deactivateUserAccount()
    if (!deactivateUserAccountBridge) {
      setSettingsNotice('账户停用服务不可用')
      setUserNotice('账户停用服务不可用')
      return false
    }
    const uid = Number(userProfile.value.uid)
    if (!Number.isFinite(uid) || uid <= 0) {
      setSettingsNotice('无法确定当前用户账号')
      setUserNotice('无法确定当前用户账号')
      return false
    }
    privacySettings.value = {
      ...privacySettings.value,
      deactivateLoading: true
    }
    try {
      const ok = applyUserMutationResult(await deactivateUserAccountBridge({ uid }))
      if (!ok) {
        setSettingsNotice(userNotice.value || '账户停用失败')
        return false
      }
      resetUserCodeState('login')
      resetUserCodeState('contact')
      userAccountCenterOpen.value = false
      privacySettings.value = {
        ...privacySettings.value,
        deactivateModalOpen: false,
        deactivateConfirmationInput: '',
        deactivateLoading: false
      }
      setSettingsNotice('账号已停用')
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : '账户停用失败'
      setSettingsNotice(message)
      setUserNotice(message)
      return false
    } finally {
      privacySettings.value = {
        ...privacySettings.value,
        deactivateLoading: false
      }
    }
  }

  const skipUserLogin = async () => {
    const skipUserLoginBridge = userAccountClient.skipUserLogin()
    if (!skipUserLoginBridge) {
      setUserNotice('跳过登录服务不可用')
      return false
    }
    try {
      return applyUserMutationResult(await skipUserLoginBridge())
    } catch {
      setUserNotice('跳过登录失败')
      return false
    }
  }

  const sendUserLoginCode = async (kind: WorkspaceUserContactKind, value: string) => {
    if (userLoginCodeCountdown.value[kind] > 0 || userLoginCodeSending.value[kind]) return false
    const sendUserLoginCodeBridge = userAccountClient.sendUserLoginCode()
    if (!sendUserLoginCodeBridge) {
      setUserNotice('登录验证码发送服务不可用')
      return false
    }
    userLoginCodeSending.value = { ...userLoginCodeSending.value, [kind]: true }
    try {
      const result = await sendUserLoginCodeBridge({ kind, value })
      if (!result?.ok || !result.data) {
        userLoginCodeSending.value = { ...userLoginCodeSending.value, [kind]: false }
        setUserNotice(result?.errorMessage || '验证码发送失败')
        return false
      }
      if (!isUserCodeDataForRequest(result.data, kind, value) || !isValidUserCodeCooldown(result.data)) {
        rejectInvalidUserCodeCooldown('login', kind)
        return false
      }
      startUserCountdown('login', kind, result.data)
      return true
    } catch {
      userLoginCodeSending.value = { ...userLoginCodeSending.value, [kind]: false }
      setUserNotice('登录验证码发送失败')
      return false
    }
  }

  const loginWithAccount = async (username: string, password: string) => {
    const loginUserAccountBridge = userAccountClient.loginUserAccount()
    if (!loginUserAccountBridge) {
      userLoginLoading.value = false
      setUserNotice('账号登录服务不可用')
      return false
    }
    userLoginLoading.value = true
    try {
      return applyUserMutationResult(await loginUserAccountBridge({ method: 'account', username, password }))
    } catch {
      userLoginLoading.value = false
      setUserNotice('账号登录失败')
      return false
    }
  }

  const loginWithEmail = async (email: string, code: string) => {
    const loginUserAccountBridge = userAccountClient.loginUserAccount()
    if (!loginUserAccountBridge) {
      userLoginLoading.value = false
      setUserNotice('邮箱登录服务不可用')
      return false
    }
    userLoginLoading.value = true
    try {
      const ok = applyUserMutationResult(await loginUserAccountBridge({ method: 'email', email, code }))
      if (ok) resetUserCodeState('login', 'email')
      return ok
    } catch {
      userLoginLoading.value = false
      setUserNotice('邮箱登录失败')
      return false
    }
  }

  const loginWithMobile = async (mobile: string, code: string) => {
    const loginUserAccountBridge = userAccountClient.loginUserAccount()
    if (!loginUserAccountBridge) {
      userLoginLoading.value = false
      setUserNotice('手机号登录服务不可用')
      return false
    }
    userLoginLoading.value = true
    try {
      const ok = applyUserMutationResult(await loginUserAccountBridge({ method: 'mobile', mobile, code }))
      if (ok) resetUserCodeState('login', 'mobile')
      return ok
    } catch {
      userLoginLoading.value = false
      setUserNotice('手机号登录失败')
      return false
    }
  }

  const updateUserProfile = async (
    patch: Partial<Pick<AiopsUserProfile, 'name' | 'username' | 'avatarInitials' | 'avatarImageUrl'>>
  ) => {
    const updateUserProfileBridge = userAccountClient.updateUserProfile()
    if (!updateUserProfileBridge) {
      setUserNotice('用户资料保存服务不可用')
      return false
    }
    try {
      return applyUserMutationResult(await updateUserProfileBridge(patch))
    } catch {
      setUserNotice('用户资料保存失败')
      return false
    }
  }

  const resetUserPassword = async (password = '') => {
    const resetUserPasswordBridge = userAccountClient.resetUserPassword()
    if (!resetUserPasswordBridge) {
      setUserNotice('密码重置服务不可用')
      return false
    }
    try {
      return applyUserMutationResult(await resetUserPasswordBridge({ password }))
    } catch {
      setUserNotice('密码重置失败')
      return false
    }
  }

  const sendUserContactCode = async (kind: WorkspaceUserContactKind, value: string) => {
    if (userContactCodeCountdown.value[kind] > 0 || userContactCodeSending.value[kind]) return false
    const sendUserContactCodeBridge = userAccountClient.sendUserContactCode()
    if (!sendUserContactCodeBridge) {
      setUserNotice('联系方式验证码发送服务不可用')
      return false
    }
    userContactCodeSending.value = { ...userContactCodeSending.value, [kind]: true }
    try {
      const result = await sendUserContactCodeBridge({ kind, value })
      if (!result?.ok || !result.data) {
        userContactCodeSending.value = { ...userContactCodeSending.value, [kind]: false }
        setUserNotice(result?.errorMessage || '验证码发送失败')
        return false
      }
      if (!isUserCodeDataForRequest(result.data, kind, value) || !isValidUserCodeCooldown(result.data)) {
        rejectInvalidUserCodeCooldown('contact', kind)
        return false
      }
      startUserCountdown('contact', kind, result.data)
      return true
    } catch {
      userContactCodeSending.value = { ...userContactCodeSending.value, [kind]: false }
      setUserNotice('联系方式验证码发送失败')
      return false
    }
  }

  const bindUserContact = async (kind: WorkspaceUserContactKind, value: string, code = '') => {
    const bindUserContactBridge = userAccountClient.bindUserContact()
    if (!bindUserContactBridge) {
      setUserNotice('联系方式绑定服务不可用')
      return false
    }
    try {
      const ok = applyUserMutationResult(await bindUserContactBridge({ kind, value, code }))
      if (ok) resetUserCodeState('contact', kind)
      return ok
    } catch {
      setUserNotice('联系方式绑定失败')
      return false
    }
  }

  const prepareUserAvatarImage = async (filePath: string) => {
    const prepareUserAvatarImageBridge = userAccountClient.prepareUserAvatarImage()
    if (!prepareUserAvatarImageBridge) {
      setUserNotice('头像读取服务不可用')
      return null
    }
    try {
      const result = await prepareUserAvatarImageBridge({ filePath })
      if (!result?.ok || !result.data) {
        setUserNotice(result?.errorMessage || '头像图片读取失败')
        return null
      }
      if (!isUserAvatarPrepareData(result.data)) {
        setUserNotice('头像后端返回了无效结果')
        return null
      }
      setUserNotice(result.data.message || '头像图片已读取')
      return result.data
    } catch (error) {
      setUserNotice(`头像图片读取失败：${error instanceof Error ? error.message : String(error)}`)
      return null
    }
  }

  const openTrustedDeviceRevoke = (id: number) => {
    const device = trustedDevices.value.find((item) => item.id === id)
    if (!device || device.current) return
    trustedDeviceModal.value = { open: true, id }
  }

  const confirmTrustedDeviceRevoke = async () => {
    const id = trustedDeviceModal.value.id
    if (id === null) return false
    const revokeTrustedDeviceBridge = userAccountClient.revokeTrustedDevice()
    if (!revokeTrustedDeviceBridge) {
      setSettingsNotice('可信设备移除服务不可用')
      setUserNotice('可信设备移除服务不可用')
      return false
    }
    try {
      const result = await revokeTrustedDeviceBridge(id)
      if (!result?.ok || !result.data) {
        setSettingsNotice(result?.errorMessage || '可信设备移除失败')
        setUserNotice(result?.errorMessage || '可信设备移除失败')
        return false
      }
      if (!isTrustedDeviceRevokeData(result.data)) {
        setSettingsNotice('可信设备后端返回了无效结果')
        setUserNotice('可信设备后端返回了无效结果')
        return false
      }
      trustedDevices.value = result.data.trustedDevices.map((device) => ({ ...device }))
      trustedDeviceModal.value = { open: false, id: null }
      setSettingsNotice(result.data.message)
      setUserNotice(result.data.message)
      return true
    } catch {
      setSettingsNotice('可信设备移除失败')
      setUserNotice('可信设备移除失败')
      return false
    }
  }

  return {
    isUserSubscriptionActive,
    canEditUserMobile,
    canEditUserEmail,
    canResetUserPassword,
    setUserNotice,
    refreshUserAccount,
    openAccountCenter,
    closeAccountCenter,
    openUserLogin,
    setUserLoginTab,
    loginUser,
    logoutUser,
    deactivateUserAccount,
    skipUserLogin,
    sendUserLoginCode,
    loginWithAccount,
    loginWithEmail,
    loginWithMobile,
    updateUserProfile,
    resetUserPassword,
    sendUserContactCode,
    bindUserContact,
    prepareUserAvatarImage,
    openTrustedDeviceRevoke,
    confirmTrustedDeviceRevoke
  }
}
