import { existsSync } from 'fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { builtinAgentSessionParserDefinitions } from '@shared/agentSessionParserDefaults'
import type {
  AgentSessionParserDefinition,
  AgentSessionParserImportInput,
  AgentSessionParserImportResult,
  AgentSessionParserListResult,
  AgentSessionParserProfile,
  AgentSessionParserRemoveInput,
  AgentSessionParserRemoveResult,
  AgentSessionParserRule,
  AgentSessionParserStorageKind,
  AgentSessionParserValueMatch
} from '@shared/contracts/agentSessionParsers'
import type { AiAgentSessionSource, BuiltinAiAgentSessionSource } from '@shared/contracts/managedAiSessions'

const maxRuleFileBytes = 1024 * 1024
const maxRules = 200
const maxPaths = 16
const maxPointersPerRule = 16
const sourcePattern = /^[a-z0-9][a-z0-9-]{0,63}$/
const pointerPattern = /^(?:\/|\$\/)/
const builtinsBySource = new Map(builtinAgentSessionParserDefinitions.map((definition) => [definition.source, definition]))
const builtinSources = new Set(builtinAgentSessionParserDefinitions.map((definition) => definition.source))

let parserDirectory = ''
let userDefinitions = new Map<AiAgentSessionSource, AgentSessionParserDefinition>()
let userDefinitionPaths = new Map<AiAgentSessionSource, string>()

const parserError = <T>(errorCode: string, errorMessage: string): T => ({ ok: false, errorCode, errorMessage } as T)

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))

const cleanText = (value: unknown) => typeof value === 'string' ? value.trim() : ''

const normalizeSource = (value: unknown): AiAgentSessionSource | null => {
  const raw = cleanText(value).toLowerCase().replace(/_/g, '-')
  if (!raw) return null
  if (builtinSources.has(raw as AiAgentSessionSource)) return raw as BuiltinAiAgentSessionSource
  const slug = raw.startsWith('custom:') ? raw.slice(7) : raw
  return sourcePattern.test(slug) ? `custom:${slug}` as const : null
}

const validatePointer = (value: unknown, field: string) => {
  const pointer = cleanText(value)
  if (!pointer || pointer.length > 240 || !pointerPattern.test(pointer)) throw new Error(`${field} must be a JSON pointer.`)
  return pointer
}

const validateMatchValue = (value: unknown, field: string): AgentSessionParserValueMatch => {
  if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return value
  if (Array.isArray(value) && value.length > 0 && value.length <= 40 && value.every((item) => typeof item === 'string')) return value as string[]
  throw new Error(`${field} must contain a scalar value or a string list.`)
}

const validateRule = (value: unknown, index: number): AgentSessionParserRule => {
  if (!isRecord(value)) throw new Error(`rules[${index}] must be an object.`)
  const id = cleanText(value.id)
  const kind = cleanText(value.kind)
  if (!sourcePattern.test(id)) throw new Error(`rules[${index}].id is invalid.`)
  if (!kind || kind.length > 80) throw new Error(`rules[${index}].kind is invalid.`)
  const contentPointers = Array.isArray(value.contentPointers)
    ? value.contentPointers.map((pointer, pointerIndex) => validatePointer(pointer, `rules[${index}].contentPointers[${pointerIndex}]`))
    : []
  if (!contentPointers.length || contentPointers.length > maxPointersPerRule) throw new Error(`rules[${index}].contentPointers must contain 1-${maxPointersPerRule} pointers.`)
  let match: Record<string, AgentSessionParserValueMatch> | undefined
  if (value.match !== undefined) {
    if (!isRecord(value.match)) throw new Error(`rules[${index}].match must be an object.`)
    match = Object.fromEntries(Object.entries(value.match).map(([pointer, matchValue]) => [
      validatePointer(pointer, `rules[${index}].match.${pointer}`),
      validateMatchValue(matchValue, `rules[${index}].match.${pointer}`)
    ]))
  }
  const role = cleanText(value.role)
  if (role && !['system', 'developer', 'user', 'assistant', 'tool', 'unknown'].includes(role)) throw new Error(`rules[${index}].role is invalid.`)
  return {
    id,
    kind,
    contentPointers,
    ...(value.scopePointer ? { scopePointer: validatePointer(value.scopePointer, `rules[${index}].scopePointer`) } : {}),
    ...(match ? { match } : {}),
    ...(role ? { role: role as AgentSessionParserRule['role'] } : {}),
    ...(value.rolePointer ? { rolePointer: validatePointer(value.rolePointer, `rules[${index}].rolePointer`) } : {}),
    ...(value.label ? { label: cleanText(value.label).slice(0, 120) } : {}),
    ...(value.labelPointer ? { labelPointer: validatePointer(value.labelPointer, `rules[${index}].labelPointer`) } : {}),
    ...(typeof value.editable === 'boolean' ? { editable: value.editable } : {})
  }
}

export const validateAgentSessionParserDefinition = (value: unknown): AgentSessionParserDefinition => {
  if (!isRecord(value)) throw new Error('Parser rule file must contain a JSON object.')
  for (const forbidden of ['script', 'command', 'sql', 'module']) {
    if (forbidden in value) throw new Error(`Parser rule file must not contain ${forbidden}.`)
  }
  if (value.schemaVersion !== 1) throw new Error('Only parser schemaVersion 1 is supported.')
  const source = normalizeSource(value.source)
  if (!source) throw new Error('Parser source is invalid.')
  const rawId = cleanText(value.id).toLowerCase().replace(/^custom:/, '')
  if (!sourcePattern.test(rawId)) throw new Error('Parser id is invalid.')
  const displayName = cleanText(value.displayName)
  if (!displayName || displayName.length > 80) throw new Error('Parser displayName is invalid.')
  if (!isRecord(value.storage)) throw new Error('Parser storage is required.')
  const kind = cleanText(value.storage.kind) as AgentSessionParserStorageKind
  if (!['jsonl', 'json', 'opencode-sqlite', 'events'].includes(kind)) throw new Error('Parser storage kind is unsupported.')
  if (source.startsWith('custom:') && kind !== 'jsonl') throw new Error('Custom Agents currently support JSONL session files.')
  const paths = value.storage.paths === undefined
    ? undefined
    : Array.isArray(value.storage.paths)
      ? value.storage.paths.map((path, index) => {
          const text = cleanText(path)
          if (!text || text.length > 500 || text.includes('\0')) throw new Error(`storage.paths[${index}] is invalid.`)
          return text
        })
      : null
  if (paths === null || (paths && (paths.length === 0 || paths.length > maxPaths))) throw new Error(`storage.paths must contain 1-${maxPaths} paths.`)
  if ((kind === 'jsonl' || kind === 'json') && !paths?.length) throw new Error(`${kind} parser storage requires paths.`)
  if (!Array.isArray(value.rules) || value.rules.length > maxRules) throw new Error(`Parser rules must contain at most ${maxRules} entries.`)
  const storage = {
    kind,
    ...(paths ? { paths } : {}),
    ...(value.storage.sessionIdPointer ? { sessionIdPointer: validatePointer(value.storage.sessionIdPointer, 'storage.sessionIdPointer') } : {}),
    ...(value.storage.titlePointer ? { titlePointer: validatePointer(value.storage.titlePointer, 'storage.titlePointer') } : {}),
    ...(value.storage.summaryPointer ? { summaryPointer: validatePointer(value.storage.summaryPointer, 'storage.summaryPointer') } : {}),
    ...(value.storage.cwdPointer ? { cwdPointer: validatePointer(value.storage.cwdPointer, 'storage.cwdPointer') } : {}),
    ...(value.storage.timestampPointer ? { timestampPointer: validatePointer(value.storage.timestampPointer, 'storage.timestampPointer') } : {})
  }
  return {
    schemaVersion: 1,
    id: rawId,
    source,
    displayName,
    storage,
    rules: value.rules.map(validateRule),
    fallback: 'raw-json'
  }
}

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
  const source = normalizeSource(input?.source)
  if (!source) return parserError('AGENT_SESSION_PARSER_SOURCE_INVALID', 'Parser source is invalid.')
  const filePath = userDefinitionPaths.get(source)
  if (filePath) await rm(filePath, { force: true })
  userDefinitions.delete(source)
  userDefinitionPaths.delete(source)
  return { ok: true, data: { source, snapshot: snapshot() } }
}
