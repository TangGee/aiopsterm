import { existsSync } from 'fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import {
  builtinAgentSessionParserDefinitions,
  normalizeAgentSessionParserSource,
  validateAgentSessionParserDefinition
} from '@shared/agentSessionParserConfigRuntime'
import type {
  AgentSessionParserDefinition,
  AgentSessionParserImportInput,
  AgentSessionParserImportResult,
  AgentSessionParserListResult,
  AgentSessionParserProfile,
  AgentSessionParserRemoveInput,
  AgentSessionParserRemoveResult
} from '@shared/contracts/agentSessionParsers'
import type { AiAgentSessionSource } from '@shared/contracts/managedAiSessions'

const maxRuleFileBytes = 1024 * 1024
const builtinsBySource = new Map(builtinAgentSessionParserDefinitions.map((definition) => [definition.source, definition]))

let parserDirectory = ''
let userDefinitions = new Map<AiAgentSessionSource, AgentSessionParserDefinition>()
let userDefinitionPaths = new Map<AiAgentSessionSource, string>()

const parserError = <T>(errorCode: string, errorMessage: string): T => ({ ok: false, errorCode, errorMessage } as T)

const cleanText = (value: unknown) => typeof value === 'string' ? value.trim() : ''

export { validateAgentSessionParserDefinition } from '@shared/agentSessionParserConfigRuntime'

const profileFor = (definition: AgentSessionParserDefinition, origin: 'builtin' | 'user', filePath?: string): AgentSessionParserProfile => ({
  id: definition.id,
  source: definition.source,
  displayName: definition.displayName,
  storageKind: definition.storage.kind,
  origin,
  ruleCount: definition.rules.length,
  fallback: definition.fallback,
  ...(filePath ? { filePath } : {})
})

const snapshot = () => {
  const sources = new Set<AiAgentSessionSource>([...builtinsBySource.keys(), ...userDefinitions.keys()])
  return {
    parsers: [...sources].map((source) => {
      const user = userDefinitions.get(source)
      if (user) return profileFor(user, 'user', userDefinitionPaths.get(source))
      return profileFor(builtinsBySource.get(source)!, 'builtin')
    }).sort((first, second) => first.displayName.localeCompare(second.displayName))
  }
}

const storedFileName = (source: AiAgentSessionSource) => `${source.replace(/[^a-z0-9-]+/g, '-')}.json`

export const configureAgentSessionParserRegistry = async (userDataPath: string) => {
  parserDirectory = join(userDataPath, 'agent-sessions', 'parser-rules')
  userDefinitions = new Map()
  userDefinitionPaths = new Map()
  await mkdir(parserDirectory, { recursive: true })
  const entries = await readdir(parserDirectory, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    const filePath = join(parserDirectory, entry.name)
    try {
      const raw = await readFile(filePath, 'utf-8')
      const definition = validateAgentSessionParserDefinition(JSON.parse(raw))
      userDefinitions.set(definition.source, definition)
      userDefinitionPaths.set(definition.source, filePath)
    } catch {}
  }
}

export const getAgentSessionParserDefinition = (source: AiAgentSessionSource) =>
  userDefinitions.get(source) || builtinsBySource.get(source) || null

export const listCustomAgentSessionParserDefinitions = () =>
  [...userDefinitions.values()].filter((definition) => definition.source.startsWith('custom:'))

export const listAgentSessionParsers = (): AgentSessionParserListResult => ({ ok: true, data: snapshot() })

export const importAgentSessionParser = async (input: AgentSessionParserImportInput): Promise<AgentSessionParserImportResult> => {
  try {
    const filePath = cleanText(input?.filePath)
    if (!filePath || !existsSync(filePath)) return parserError('AGENT_SESSION_PARSER_FILE_MISSING', 'Parser rule file was not found.')
    const raw = await readFile(filePath, 'utf-8')
    if (Buffer.byteLength(raw) > maxRuleFileBytes) return parserError('AGENT_SESSION_PARSER_FILE_TOO_LARGE', 'Parser rule file exceeds 1 MiB.')
    const definition = validateAgentSessionParserDefinition(JSON.parse(raw))
    if (input.expectedSource && definition.source !== input.expectedSource) {
      return parserError('AGENT_SESSION_PARSER_SOURCE_MISMATCH', `Parser source ${definition.source} does not match ${input.expectedSource}.`)
    }
    if (!parserDirectory) return parserError('AGENT_SESSION_PARSER_STORE_UNAVAILABLE', 'Parser rule storage is unavailable.')
    const target = join(parserDirectory, storedFileName(definition.source))
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, `${JSON.stringify(definition, null, 2)}\n`, 'utf-8')
    userDefinitions.set(definition.source, definition)
    userDefinitionPaths.set(definition.source, target)
    return { ok: true, data: { parser: profileFor(definition, 'user', target), snapshot: snapshot() } }
  } catch (error) {
    return parserError('AGENT_SESSION_PARSER_IMPORT_FAILED', error instanceof Error ? error.message : 'Failed to import parser rule file.')
  }
}

export const removeAgentSessionParser = async (input: AgentSessionParserRemoveInput): Promise<AgentSessionParserRemoveResult> => {
  const source = normalizeAgentSessionParserSource(input?.source)
  if (!source) return parserError('AGENT_SESSION_PARSER_SOURCE_INVALID', 'Parser source is invalid.')
  const filePath = userDefinitionPaths.get(source)
  if (filePath) await rm(filePath, { force: true })
  userDefinitions.delete(source)
  userDefinitionPaths.delete(source)
  return { ok: true, data: { source, snapshot: snapshot() } }
}
