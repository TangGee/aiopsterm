import type { IpcMain } from 'electron'
import {
  bindUserContact,
  deactivateUserAccount,
  getUserAccount,
  loginUserAccount,
  logoutUserAccount,
  openUserAccountCenter,
  openUserLogin,
  prepareUserAvatarImage,
  resetUserPassword,
  revokeTrustedDevice,
  sendUserContactCode,
  sendUserLoginCode,
  skipUserLogin,
  updateUserProfile
} from '../backend/userAccount'
import type {
  AiopsUserAvatarPrepareInput,
  AiopsUserCodeInput,
  AiopsUserContactBindInput,
  AiopsUserDeactivateInput,
  AiopsUserLoginInput,
  AiopsUserPasswordInput,
  AiopsUserProfileUpdateInput
} from '@shared/preload'

export const registerUserAccountIpc = (ipcMain: IpcMain) => {
  ipcMain.handle('user:get-account', () => getUserAccount())
  ipcMain.handle('user:open-login', () => openUserLogin())
  ipcMain.handle('user:open-account-center', () => openUserAccountCenter())
  ipcMain.handle('user:login', (_event, input: AiopsUserLoginInput) => loginUserAccount(input))
  ipcMain.handle('user:logout', () => logoutUserAccount())
  ipcMain.handle('user:skip-login', () => skipUserLogin())
  ipcMain.handle('user:send-login-code', (_event, input: AiopsUserCodeInput) => sendUserLoginCode(input))
  ipcMain.handle('user:avatar:prepare', (_event, input: AiopsUserAvatarPrepareInput) => prepareUserAvatarImage(input))
  ipcMain.handle('user:update-profile', (_event, input: AiopsUserProfileUpdateInput) => updateUserProfile(input))
  ipcMain.handle('user:reset-password', (_event, input: AiopsUserPasswordInput) => resetUserPassword(input))
  ipcMain.handle('user:send-contact-code', (_event, input: AiopsUserCodeInput) => sendUserContactCode(input))
  ipcMain.handle('user:bind-contact', (_event, input: AiopsUserContactBindInput) => bindUserContact(input))
  ipcMain.handle('user:deactivate-account', (_event, input: AiopsUserDeactivateInput) => deactivateUserAccount(input))
  ipcMain.handle('user:revoke-trusted-device', (_event, id: number) => revokeTrustedDevice(id))
}
