import ampConfig from './agentSessionParserConfigs/amp.json'
import antigravityConfig from './agentSessionParserConfigs/antigravity.json'
import claudeCodeConfig from './agentSessionParserConfigs/claude-code.json'
import codebuddyConfig from './agentSessionParserConfigs/codebuddy.json'
import codexConfig from './agentSessionParserConfigs/codex.json'
import copilotConfig from './agentSessionParserConfigs/copilot.json'
import cursorConfig from './agentSessionParserConfigs/cursor.json'
import deepseekHarnessConfig from './agentSessionParserConfigs/deepseek-harness.json'
import factoryConfig from './agentSessionParserConfigs/factory.json'
import geminiConfig from './agentSessionParserConfigs/gemini.json'
import grokConfig from './agentSessionParserConfigs/grok.json'
import hermesAgentConfig from './agentSessionParserConfigs/hermes-agent.json'
import kimiCodeConfig from './agentSessionParserConfigs/kimi-code.json'
import kiroConfig from './agentSessionParserConfigs/kiro.json'
import ompConfig from './agentSessionParserConfigs/omp.json'
import opencodeConfig from './agentSessionParserConfigs/opencode.json'
import piConfig from './agentSessionParserConfigs/pi.json'
import qoderConfig from './agentSessionParserConfigs/qoder.json'
import rovodevConfig from './agentSessionParserConfigs/rovodev.json'
import type {
  AgentSessionParserDefinition,
  AgentSessionParserRule,
  AgentSessionParserStorageKind,
  AgentSessionParserValueMatch
} from './contracts/agentSessionParsers'
import type { AiAgentSessionSource, BuiltinAiAgentSessionSource } from './contracts/managedAiSessions'

const maxRules = 200
const maxPaths = 16
const maxPointersPerRule = 16
const sourcePattern = /^[a-z0-9][a-z0-9-]{0,63}$/
const pointerPattern = /^(?:\/|\$\/)/

const rawBuiltinAgentSessionParserConfigs: unknown[] = [
  codexConfig,
  claudeCodeConfig,
  opencodeConfig,
  cursorConfig,
  geminiConfig,
  copilotConfig,
  grokConfig,
  codebuddyConfig,
  factoryConfig,
  qoderConfig,
  antigravityConfig,
  kiroConfig,
  hermesAgentConfig,
  rovodevConfig,
  ampConfig,
  piConfig,
  ompConfig,
  kimiCodeConfig,
  deepseekHarnessConfig
]

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))

const cleanText = (value: unknown) => typeof value === 'string' ? value.trim() : ''

const builtinSources = new Set(rawBuiltinAgentSessionParserConfigs.flatMap((value) => {
  if (!isRecord(value)) return []
  const source = cleanText(value.source).toLowerCase().replace(/_/g, '-')
  return source ? [source] : []
}))

export const normalizeAgentSessionParserSource = (value: unknown): AiAgentSessionSource | null => {
  const raw = cleanText(value).toLowerCase().replace(/_/g, '-')
  if (!raw) return null
  if (builtinSources.has(raw)) return raw as BuiltinAiAgentSessionSource
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
  const source = normalizeAgentSessionParserSource(value.source)
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

export const builtinAgentSessionParserDefinitions = rawBuiltinAgentSessionParserConfigs.map(validateAgentSessionParserDefinition)

if (new Set(builtinAgentSessionParserDefinitions.map((definition) => definition.source)).size !== builtinAgentSessionParserDefinitions.length) {
  throw new Error('Built-in Agent session parser config sources must be unique.')
}
