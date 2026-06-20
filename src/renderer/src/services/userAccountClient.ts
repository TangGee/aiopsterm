import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'
import { createBridgeMethod } from '@/services/preloadBridgeClient'

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

const bridgeMethod = createBridgeMethod<UserAccountBridge>()

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
