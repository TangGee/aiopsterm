import type { AiopsMutationResult } from './common'

export type QuickCommandGroupConfig = {
  id: number
  uuid: string
  group_name: string
}

export type QuickCommandSnippetConfig = {
  id: number
  uuid: string
  snippet_name: string
  snippet_content: string
  group_uuid?: string | null
  create_at?: string
  update_at?: string
}

export type QuickCommandsUserConfig = {
  groups: QuickCommandGroupConfig[]
  snippets: QuickCommandSnippetConfig[]
}

export type QuickCommandGroupSaveInput = {
  uuid?: string
  group_name: string
}

export type QuickCommandSnippetSaveInput = {
  id?: number
  uuid?: string
  snippet_name: string
  snippet_content: string
  group_uuid?: string | null
}

export type QuickCommandMacroEntryInput = {
  command: string
  timestamp: number
}

export type QuickCommandMacroSaveInput = {
  snippet_name?: string
  group_uuid?: string | null
  entries: QuickCommandMacroEntryInput[]
  sleepThresholdMs?: number
}

export type QuickCommandReorderInput = {
  orderedIds: number[]
  groupUuid?: string | null
}

export type QuickCommandScriptPlanInput = {
  snippetId?: number
  snippetContent?: string
  autoExecute?: boolean
}

export type QuickCommandScriptSegment = {
  text: string
  delayBeforeMs: number
}

export type QuickCommandScriptPlan = {
  segments: QuickCommandScriptSegment[]
  shellText: string
  securityCommand: string
  commands: string[]
  source: 'snippet' | 'inline'
  snippetId: number | null
  snippetName: string
  autoExecute: boolean
}

export type QuickCommandGroupMutationResult = AiopsMutationResult<QuickCommandsUserConfig & { group: QuickCommandGroupConfig }>
export type QuickCommandGroupDeleteResult = AiopsMutationResult<QuickCommandsUserConfig & { groupUuid: string }>
export type QuickCommandSnippetMutationResult = AiopsMutationResult<QuickCommandsUserConfig & { snippet: QuickCommandSnippetConfig }>
export type QuickCommandMacroMutationResult = QuickCommandSnippetMutationResult
export type QuickCommandSnippetDeleteResult = AiopsMutationResult<QuickCommandsUserConfig & { id: number }>
export type QuickCommandReorderResult = AiopsMutationResult<QuickCommandsUserConfig>
export type QuickCommandScriptPlanResult = AiopsMutationResult<QuickCommandScriptPlan>
