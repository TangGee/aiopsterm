import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'
import { createBridgeMethod } from '@/services/preloadBridgeClient'

type VoiceBridge = Pick<AiopsPreloadApi, 'transcribeVoiceInput'>

const bridgeMethod = createBridgeMethod<VoiceBridge>()

export const voiceClient = {
  transcribeVoiceInput: () => bridgeMethod('transcribeVoiceInput')
}
