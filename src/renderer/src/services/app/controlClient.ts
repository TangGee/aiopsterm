import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'
import { createBridgeMethod } from '@/services/common/preloadBridgeClient'

type ControlBridge = Pick<AiopsPreloadApi, 'invokeControlRequest' | 'respondControlRequest' | 'onControlRequest'>

const bridgeMethod = createBridgeMethod<ControlBridge>()

export const controlClient = {
  invokeControlRequest: () => bridgeMethod('invokeControlRequest'),
  respondControlRequest: () => bridgeMethod('respondControlRequest'),
  onControlRequest: () => bridgeMethod('onControlRequest')
}
