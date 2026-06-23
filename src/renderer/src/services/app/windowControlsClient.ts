import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'
import { createBridgeMethod } from '@/services/common/preloadBridgeClient'

type WindowControlsBridge = Pick<
  AiopsPreloadApi,
  'platform' | 'minimizeWindow' | 'maximizeWindow' | 'unmaximizeWindow' | 'isMaximized' | 'closeWindow' | 'onMaximized' | 'onUnmaximized'
>

const bridgeMethod = createBridgeMethod<WindowControlsBridge>()

export const windowControlsClient = {
  platform: () => bridgeMethod('platform'),
  minimizeWindow: () => bridgeMethod('minimizeWindow'),
  maximizeWindow: () => bridgeMethod('maximizeWindow'),
  unmaximizeWindow: () => bridgeMethod('unmaximizeWindow'),
  isMaximized: () => bridgeMethod('isMaximized'),
  closeWindow: () => bridgeMethod('closeWindow'),
  onMaximized: () => bridgeMethod('onMaximized'),
  onUnmaximized: () => bridgeMethod('onUnmaximized')
}
