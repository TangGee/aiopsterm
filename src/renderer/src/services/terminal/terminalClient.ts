import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'
import { createBridgeMethod } from '@/services/common/preloadBridgeClient'

type TerminalBridge = Pick<
  AiopsPreloadApi,
  | 'createTerminal'
  | 'writeTerminal'
  | 'writeTerminalBinary'
  | 'resizeTerminal'
  | 'killTerminal'
  | 'generateTerminalCommand'
  | 'getTerminalCommandSuggestions'
  | 'onTerminalData'
  | 'onTerminalLifecycle'
  | 'onTerminalExit'
  | 'onTerminalKeyboardInteractiveRequest'
  | 'onTerminalKeyboardInteractiveResult'
  | 'respondTerminalKeyboardInteractive'
  | 'cancelTerminalKeyboardInteractive'
>

const bridgeMethod = createBridgeMethod<TerminalBridge>()

export const terminalClient = {
  createTerminal: () => bridgeMethod('createTerminal'),
  writeTerminal: () => bridgeMethod('writeTerminal'),
  writeTerminalBinary: () => bridgeMethod('writeTerminalBinary'),
  resizeTerminal: () => bridgeMethod('resizeTerminal'),
  killTerminal: () => bridgeMethod('killTerminal'),
  generateTerminalCommand: () => bridgeMethod('generateTerminalCommand'),
  getTerminalCommandSuggestions: () => bridgeMethod('getTerminalCommandSuggestions'),
  onTerminalData: () => bridgeMethod('onTerminalData'),
  onTerminalLifecycle: () => bridgeMethod('onTerminalLifecycle'),
  onTerminalExit: () => bridgeMethod('onTerminalExit'),
  onTerminalKeyboardInteractiveRequest: () => bridgeMethod('onTerminalKeyboardInteractiveRequest'),
  onTerminalKeyboardInteractiveResult: () => bridgeMethod('onTerminalKeyboardInteractiveResult'),
  respondTerminalKeyboardInteractive: () => bridgeMethod('respondTerminalKeyboardInteractive'),
  cancelTerminalKeyboardInteractive: () => bridgeMethod('cancelTerminalKeyboardInteractive')
}
