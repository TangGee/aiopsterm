import type { ModelProviderCheckKey } from './appRuntime'
import type { AiopsMutationResult } from './common'

export type TerminalCommandSuggestion = {
  command: string
  source: 'base' | 'history' | 'ai'
  explanation?: string
}

export type TerminalCommandSuggestionContext = {
  panelId?: string
  host?: string
  shell?: string
  modelName?: string
  mode?: 'base' | 'ai'
}

export type TerminalCommandGenerationContext = {
  host: string
  username: string
  cwd: string
  shell: string
  connectionType: 'local' | 'ssh'
}

export type TerminalCommandGenerationInput = {
  panelId: string
  instruction: string
  modelName?: string
  context: TerminalCommandGenerationContext
}

export type TerminalCommandGenerationRecord = {
  id: string
  panelId: string
  instruction: string
  command: string
  modelName: string
  context: TerminalCommandGenerationContext
  status: 'done'
  createdAt: number
  provider: 'aiopsterm-local' | ModelProviderCheckKey
}

export type TerminalCommandGenerationResult = AiopsMutationResult<TerminalCommandGenerationRecord>
