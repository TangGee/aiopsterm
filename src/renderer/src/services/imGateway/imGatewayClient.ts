import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'
import { createBridgeMethod } from '@/services/common/preloadBridgeClient'
const bridge = createBridgeMethod<Pick<AiopsPreloadApi, 'getImGatewayStatus' | 'saveImGatewaySettings' | 'listImGatewayTerminals'>>()
export const imGatewayClient = {
  status: () => bridge('getImGatewayStatus'),
  save: () => bridge('saveImGatewaySettings'),
  terminals: () => bridge('listImGatewayTerminals')
}
