import type {
  TerminalCommandGenerationInput,
  TerminalCommandGenerationResult,
  TerminalCommandSuggestion,
  TerminalCommandSuggestionContext
} from '@shared/contracts/terminalTools'
import { createTerminalCommandGenerationRuntime } from './terminalCommandGenerationRuntime'
import { createTerminalSuggestionAiRuntime } from './terminalSuggestionAiRuntime'
import { createTerminalSuggestionExecutableRuntime } from './terminalSuggestionExecutableRuntime'
import { createTerminalSuggestionFigRuntime } from './terminalSuggestionFigRuntime'
import { createTerminalSuggestionHistoryRuntime } from './terminalSuggestionHistoryRuntime'
import {
  dedupeSuggestions,
  isValidTerminalCommandForHistory,
  maxSuggestionRows,
  normalizeText,
  type TerminalSuggestionRuntimeConfig
} from './terminalSuggestionCommon'

export { isValidTerminalCommandForHistory }
export type { TerminalSuggestionRuntimeConfig }

let runtimeConfig: TerminalSuggestionRuntimeConfig = {}

const getRuntimeConfig = () => runtimeConfig
const historyRuntime = createTerminalSuggestionHistoryRuntime(getRuntimeConfig)
const figRuntime = createTerminalSuggestionFigRuntime(getRuntimeConfig)
const executableRuntime = createTerminalSuggestionExecutableRuntime(getRuntimeConfig)
const aiRuntime = createTerminalSuggestionAiRuntime(getRuntimeConfig, {
  historyRuntime,
  figRuntime,
  executableRuntime
})
const commandGenerationRuntime = createTerminalCommandGenerationRuntime(getRuntimeConfig)

export const configureTerminalSuggestionsRuntime = (config?: TerminalSuggestionRuntimeConfig) => {
  runtimeConfig = config ? { ...config } : {}
  historyRuntime.reset()
  figRuntime.reset()
  executableRuntime.reset()
}

export const recordTerminalCommandHistory = (command: string, context?: Pick<TerminalCommandSuggestionContext, 'host'>) => {
  try {
    historyRuntime.getStore().record(command, context?.host)
  } catch {
    // Recording terminal history must never interrupt live terminal writes.
  }
}

export const getTerminalCommandSuggestions = async (
  query: string,
  context?: TerminalCommandSuggestionContext
): Promise<TerminalCommandSuggestion[]> => {
  const trimmed = normalizeText(query)
  if (trimmed.length < 2) return []
  if (context?.mode === 'ai') {
    return aiRuntime.fetchAiSuggestion(trimmed, context)
  }
  try {
    const history = historyRuntime.getStore().query(trimmed, context?.host, maxSuggestionRows)
    const specs = await figRuntime.getSuggestions(trimmed, maxSuggestionRows)
    return dedupeSuggestions([...history, ...specs], maxSuggestionRows)
  } catch {
    return []
  }
}

export const generateTerminalCommand = async (input: TerminalCommandGenerationInput): Promise<TerminalCommandGenerationResult> => {
  return commandGenerationRuntime.generate(input)
}
