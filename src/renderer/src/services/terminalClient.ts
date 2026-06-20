import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'

type TerminalBridge = Pick<
  AiopsPreloadApi,
  | 'createTerminal'
  | 'writeTerminal'
  | 'writeTerminalBinary'
  | 'resizeTerminal'
  | 'killTerminal'
  | 'generateTerminalCommand'
  | 'onTerminalData'
  | 'onTerminalLifecycle'
  | 'onTerminalExit'
  | 'onTerminalKeyboardInteractiveRequest'
  | 'onTerminalKeyboardInteractiveResult'
>

const bridgeMethod = <Name extends keyof TerminalBridge>(name: Name): TerminalBridge[Name] | undefined => {
  const method = window.aiops?.[name]
  return typeof method === 'function' ? (method.bind(window.aiops) as TerminalBridge[Name]) : undefined
}

export const terminalClient = {
  createTerminal: () => bridgeMethod('createTerminal'),
  writeTerminal: () => bridgeMethod('writeTerminal'),
  writeTerminalBinary: () => bridgeMethod('writeTerminalBinary'),
  resizeTerminal: () => bridgeMethod('resizeTerminal'),
  killTerminal: () => bridgeMethod('killTerminal'),
  generateTerminalCommand: () => bridgeMethod('generateTerminalCommand'),
  onTerminalData: () => bridgeMethod('onTerminalData'),
  onTerminalLifecycle: () => bridgeMethod('onTerminalLifecycle'),
  onTerminalExit: () => bridgeMethod('onTerminalExit'),
  onTerminalKeyboardInteractiveRequest: () => bridgeMethod('onTerminalKeyboardInteractiveRequest'),
  onTerminalKeyboardInteractiveResult: () => bridgeMethod('onTerminalKeyboardInteractiveResult')
}
