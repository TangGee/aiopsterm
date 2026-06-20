import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'

type ControlBridge = Pick<AiopsPreloadApi, 'invokeControlRequest' | 'respondControlRequest' | 'onControlRequest'>

const bridgeMethod = <Name extends keyof ControlBridge>(name: Name): ControlBridge[Name] | undefined => {
  const method = window.aiops?.[name]
  return typeof method === 'function' ? (method.bind(window.aiops) as ControlBridge[Name]) : undefined
}

export const controlClient = {
  invokeControlRequest: () => bridgeMethod('invokeControlRequest'),
  respondControlRequest: () => bridgeMethod('respondControlRequest'),
  onControlRequest: () => bridgeMethod('onControlRequest')
}
