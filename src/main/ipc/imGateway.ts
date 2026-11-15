import { app, safeStorage, type IpcMain } from 'electron'
import Store from 'electron-store'
import { join } from 'path'
import { defaultImGatewayConfig, type ImGatewaySaveInput } from '@shared/contracts/imGateway'
import { GatewayStateStore } from '../backend/imGateway/gatewayState'
import { GatewayManager, type GatewaySavedSettings } from '../backend/imGateway/gatewayManager'
import { createGatewayTerminalPort } from '../backend/imGateway/gatewayTerminalPort'
import { invokeControlSocketMethod } from '../backend/control/controlSocket'
import { logRuntimeEvent } from '../backend/app/runtimeLog'

export const registerImGatewayIpc = (ipcMain: IpcMain) => {
  let manager: GatewayManager | undefined
  const terminal = createGatewayTerminalPort(invokeControlSocketMethod)
  const initialize = async () => {
    try {
      const store = new Store<GatewaySavedSettings>({ name: 'im-gateway', defaults: { config: defaultImGatewayConfig, encryptedSecret: '' } })
      manager = new GatewayManager({
        read: () => ({ config: store.get('config'), encryptedSecret: store.get('encryptedSecret') }),
        write: value => store.set(value),
        encrypt: value => {
          if (!safeStorage.isEncryptionAvailable() || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend?.() === 'basic_text')) throw new Error('IM_GATEWAY_KEYCHAIN_UNAVAILABLE')
          return safeStorage.encryptString(value).toString('base64')
        },
        decrypt: value => value ? safeStorage.decryptString(Buffer.from(value, 'base64')) : '',
        state: new GatewayStateStore(join(app.getPath('userData'), 'im-gateway-state.json')),
        terminal,
        adapters: new Map([
          ['feishu', async context => (await import('../backend/imGateway/feishuAdapter.js')).createFeishuAdapter(context)],
          ['telegram', async context => (await import('../backend/imGateway/telegramAdapter.js')).createTelegramAdapter(context)],
          ['infoflow', async context => (await import('../backend/imGateway/infoflowAdapter.js')).createInfoflowAdapter(context)]
        ]),
        audit: (event, message, action) => logRuntimeEvent(event.endsWith('failed') ? 'warn' : 'info', `im.gateway.${event}`, {
          provider: message.provider, messageId: message.messageId, senderId: message.senderId, conversationId: message.conversationId, action
        })
      })
      await manager.initialize()
    } catch { logRuntimeEvent('error', 'im.gateway.initialize-failed', { reason: 'IM_GATEWAY_STORAGE_UNAVAILABLE' }) }
  }
  const ready = initialize()
  ipcMain.handle('im-gateway:status', async () => {
    await ready
    return manager?.status() || { config: defaultImGatewayConfig, hasAppSecret: false, connection: 'error', error: 'IM_GATEWAY_STORAGE_UNAVAILABLE', pending: 0, bindings: 0 }
  })
  ipcMain.handle('im-gateway:save', async (_event, input: ImGatewaySaveInput) => {
    await ready
    try {
      if (!manager) throw new Error('IM_GATEWAY_STORAGE_UNAVAILABLE')
      return { ok: true, status: await manager.save(input) }
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      return { ok: false, error: /^IM_GATEWAY_[A-Z_]+$/.test(message) ? message : 'IM_GATEWAY_SAVE_FAILED' }
    }
  })
  ipcMain.handle('im-gateway:terminals', async () => {
    try { return { ok: true, terminals: await terminal.list() } }
    catch { return { ok: false, terminals: [], error: 'IM_GATEWAY_TERMINALS_UNAVAILABLE' } }
  })
  app.once('before-quit', () => manager?.shutdown())
}
