import {
  importAgentSessionParser,
  listAgentSessionParsers,
  removeAgentSessionParser
} from './agentSessionParserRegistry'
import type { AiAgentSessionSource } from '@shared/contracts/managedAiSessions'
import type {
  AgentSessionParserImportInput,
  AgentSessionParserImportResult,
  AgentSessionParserListResult,
  AgentSessionParserRemoveInput,
  AgentSessionParserRemoveResult
} from '@shared/contracts/agentSessionParsers'

type AgentSessionParserOperationsOptions = {
  loadStoreIfNeeded: () => Promise<void>
  refreshImportedSessions: () => Promise<void>
  removeSessionsForSource: (source: AiAgentSessionSource) => void
}

export const createAgentSessionParserOperationsRuntime = (options: AgentSessionParserOperationsOptions) => ({
  list: async (): Promise<AgentSessionParserListResult> => {
    await options.loadStoreIfNeeded()
    return listAgentSessionParsers()
  },
  import: async (input: AgentSessionParserImportInput): Promise<AgentSessionParserImportResult> => {
    await options.loadStoreIfNeeded()
    const result = await importAgentSessionParser(input)
    if (result.ok) await options.refreshImportedSessions()
    return result
  },
  remove: async (input: AgentSessionParserRemoveInput): Promise<AgentSessionParserRemoveResult> => {
    await options.loadStoreIfNeeded()
    const result = await removeAgentSessionParser(input)
    if (result.ok && result.data) {
      await options.refreshImportedSessions()
      if (result.data.source.startsWith('custom:')) options.removeSessionsForSource(result.data.source)
    }
    return result
  }
})
