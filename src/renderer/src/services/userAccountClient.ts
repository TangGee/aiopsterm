import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'

type UserAccountBridge = Pick<
  AiopsPreloadApi,
  | 'getUserAccount'
  | 'openUserLogin'
  | 'openUserAccountCenter'
  | 'loginUserAccount'
  | 'logoutUserAccount'
  | 'skipUserLogin'
  | 'sendUserLoginCode'
  | 'prepareUserAvatarImage'
  | 'updateUserProfile'
  | 'resetUserPassword'
  | 'sendUserContactCode'
  | 'bindUserContact'
  | 'deactivateUserAccount'
  | 'revokeTrustedDevice'
>

const bridgeMethod = <Name extends keyof UserAccountBridge>(name: Name): UserAccountBridge[Name] | undefined => {
  const method = window.aiops?.[name]
  return typeof method === 'function' ? (method.bind(window.aiops) as UserAccountBridge[Name]) : undefined
}

export const userAccountClient = {
  getUserAccount: () => bridgeMethod('getUserAccount'),
  openUserLogin: () => bridgeMethod('openUserLogin'),
  openUserAccountCenter: () => bridgeMethod('openUserAccountCenter'),
  loginUserAccount: () => bridgeMethod('loginUserAccount'),
  logoutUserAccount: () => bridgeMethod('logoutUserAccount'),
  skipUserLogin: () => bridgeMethod('skipUserLogin'),
  sendUserLoginCode: () => bridgeMethod('sendUserLoginCode'),
  prepareUserAvatarImage: () => bridgeMethod('prepareUserAvatarImage'),
  updateUserProfile: () => bridgeMethod('updateUserProfile'),
  resetUserPassword: () => bridgeMethod('resetUserPassword'),
  sendUserContactCode: () => bridgeMethod('sendUserContactCode'),
  bindUserContact: () => bridgeMethod('bindUserContact'),
  deactivateUserAccount: () => bridgeMethod('deactivateUserAccount'),
  revokeTrustedDevice: () => bridgeMethod('revokeTrustedDevice')
}
