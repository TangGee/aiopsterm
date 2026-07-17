import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'
import { createBridgeMethod } from '@/services/common/preloadBridgeClient'

type CodexSessionBridge = Pick<
  AiopsPreloadApi,
  | 'createCodexSession'
  | 'setCodexSessionTarget'
  | 'setCodexSessionPendingContext'
  | 'writeCodexSession'
  | 'resizeCodexSession'
  | 'killCodexSession'
  | 'onCodexSessionData'
  | 'onCodexSessionLifecycle'
  | 'onCodexSessionExit'
  | 'onCodexSessionThread'
>

const bridgeMethod = createBridgeMethod<CodexSessionBridge>()

export const codexSessionClient = {
  createCodexSession: () => bridgeMethod('createCodexSession'),
  setCodexSessionTarget: () => bridgeMethod('setCodexSessionTarget'),
  setCodexSessionPendingContext: () => bridgeMethod('setCodexSessionPendingContext'),
  writeCodexSession: () => bridgeMethod('writeCodexSession'),
  resizeCodexSession: () => bridgeMethod('resizeCodexSession'),
  killCodexSession: () => bridgeMethod('killCodexSession'),
  onCodexSessionData: () => bridgeMethod('onCodexSessionData'),
  onCodexSessionLifecycle: () => bridgeMethod('onCodexSessionLifecycle'),
  onCodexSessionExit: () => bridgeMethod('onCodexSessionExit'),
  onCodexSessionThread: () => bridgeMethod('onCodexSessionThread')
}
