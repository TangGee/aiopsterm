import type { TerminalCommandSuggestion, TerminalCommandSuggestionContext } from '@shared/contracts/terminalTools'
import {
  createProviderTextRequest,
  fetchProviderText,
  resolveModelProvider,
  type AiProviderResolvedConfig,
  type AiProviderTextRequest
} from '../ai/modelProviderText'
import type { TerminalSuggestionExecutableRuntime } from './terminalSuggestionExecutableRuntime'
import type { TerminalSuggestionFigRuntime, FigSubcommand } from './terminalSuggestionFigRuntime'
import type { TerminalSuggestionHistoryRuntime } from './terminalSuggestionHistoryRuntime'
import {
  createScoredTerminalAiSuggestion,
  dedupeSuggestions,
  isValidTerminalCommandForHistory,
  maxSuggestionRows,
  normalizeCommandName,
  normalizeText,
  resolveNames,
  type ScoredTerminalCommandSuggestion,
  type TerminalSuggestionRuntimeConfig
} from './terminalSuggestionCommon'

export type TerminalSuggestionAiRuntime = {
  fetchAiSuggestion(query: string, context?: TerminalCommandSuggestionContext): Promise<TerminalCommandSuggestion[]>
}

const defaultAiSuggestTimeoutMs = 2000

function createAiSuggestPrompt(partialCommand: string, context?: TerminalCommandSuggestionContext): string {
  const host = normalizeText(context?.host)
  const shell = normalizeText(context?.shell)
  return [
    `Partial command: ${partialCommand}`,
    host ? `Host: ${host}` : '',
    shell ? `Shell: ${shell}` : '',
    'Complete this terminal command.',
    'Return exactly two lines:',
    'CMD: <completed command>',
    'EXP: <brief purpose>',
    'The command must start with the partial command and must not be destructive. Return NONE if unsure.'
  ]
    .filter(Boolean)
    .join('\n')
}

function createAiSuggestRequest(input: AiProviderResolvedConfig, partialCommand: string, context?: TerminalCommandSuggestionContext): AiProviderTextRequest | null {
  return createProviderTextRequest(input, 'You are a terminal autocomplete engine.', createAiSuggestPrompt(partialCommand, context), 80)
}

export function parseTerminalAiSuggestResponse(response: string, partialCommand: string): TerminalCommandSuggestion | null {
  const text = response.trim()
  if (!text || text.toUpperCase() === 'NONE') return null
  const command = normalizeText(text.match(/^CMD:\s*(.+)$/im)?.[1])
  const explanation = normalizeText(text.match(/^EXP:\s*(.+)$/im)?.[1])
  if (!command || !command.startsWith(partialCommand.trim())) return null
  if (!isValidTerminalCommandForHistory(command)) return null
  return { command, source: 'ai', explanation: explanation || 'AI suggestion' }
}

const localFigIntentRank = [
  'status',
  'get',
  'list',
  'show',
  'describe',
  'logs',
  'log',
  'ps',
  'top',
  'version',
  'info',
  'config',
  'help'
]

function scoreFigSubcommand(subcommand: FigSubcommand, index: number): number {
  const names = resolveNames(subcommand.name)
  const primary = normalizeText(names[0]).toLowerCase()
  const description = normalizeText(subcommand.description).toLowerCase()
  const intentIndex = localFigIntentRank.indexOf(primary)
  let score = intentIndex >= 0 ? 200 - intentIndex * 8 : 20
  if (/\b(status|state|health)\b/.test(description)) score += 18
  if (/\b(list|show|display|get|describe|logs?)\b/.test(description)) score += 14
  if (/\b(delete|remove|destroy|kill|stop|terminate|prune)\b/.test(`${primary} ${description}`)) score -= 100
  return score - index / 100
}

async function getExactCommandFigAiSuggestion(
  figRuntime: TerminalSuggestionFigRuntime,
  partialCommand: string
): Promise<ScoredTerminalCommandSuggestion | null> {
  const commandName = normalizeCommandName(partialCommand)
  if (!commandName || commandName !== partialCommand.trim().toLowerCase()) return null
  const specs = await figRuntime.loadAvailableSpecs()
  if (!specs.has(commandName)) return null
  const spec = await figRuntime.loadFigSpec(commandName)
  const ranked = (spec?.subcommands || [])
    .map((subcommand, index) => ({ subcommand, score: scoreFigSubcommand(subcommand, index) }))
    .sort((a, b) => b.score - a.score)
  for (const { subcommand, score } of ranked) {
    const name = resolveNames(subcommand.name)[0]
    const suggestion = createScoredTerminalAiSuggestion(
      `${commandName} ${name}`,
      partialCommand,
      `local backend Fig spec: ${subcommand.description || 'subcommand'}`,
      score
    )
    if (suggestion) return suggestion
  }
  return null
}

async function getFigAiSuggestions(
  figRuntime: TerminalSuggestionFigRuntime,
  partialCommand: string
): Promise<ScoredTerminalCommandSuggestion[]> {
  const suggestions: ScoredTerminalCommandSuggestion[] = []
  const exact = await getExactCommandFigAiSuggestion(figRuntime, partialCommand)
  if (exact) suggestions.push(exact)
  const figSuggestions = await figRuntime.getSuggestions(partialCommand, maxSuggestionRows)
  figSuggestions.forEach((item, index) => {
    const suggestion = createScoredTerminalAiSuggestion(
      item.command,
      partialCommand,
      `local backend Fig spec: ${item.explanation || 'command spec'}`,
      160 - index
    )
    if (suggestion) suggestions.push(suggestion)
  })
  return suggestions
}

async function inferLocalAiSuggestions(
  partialCommand: string,
  context: TerminalCommandSuggestionContext | undefined,
  dependencies: {
    historyRuntime: TerminalSuggestionHistoryRuntime
    figRuntime: TerminalSuggestionFigRuntime
    executableRuntime: TerminalSuggestionExecutableRuntime
  }
): Promise<TerminalCommandSuggestion[]> {
  const partial = partialCommand.trim()
  if (partial.length < 3) return []
  const suggestions: ScoredTerminalCommandSuggestion[] = []
  try {
    dependencies.historyRuntime
      .getStore()
      .query(partial, context?.host, maxSuggestionRows)
      .forEach((item, index) => {
        const suggestion = createScoredTerminalAiSuggestion(item.command, partial, `local backend ${item.explanation || 'history'}`, 300 - index)
        if (suggestion) suggestions.push(suggestion)
      })
  } catch {
    // Local AI suggestions are opportunistic; history storage failures fail closed.
  }
  try {
    suggestions.push(...(await getFigAiSuggestions(dependencies.figRuntime, partial)))
  } catch {
    // Fig catalog lookup must not fabricate fallback rows on failure.
  }
  try {
    suggestions.push(...(await dependencies.executableRuntime.getSuggestions(partial)))
  } catch {
    // PATH discovery is best-effort and stays behind the backend boundary.
  }
  return dedupeSuggestions(
    suggestions
      .sort((a, b) => b.score - a.score)
      .map(({ score: _score, ...item }) => item),
    1
  )
}

export function createTerminalSuggestionAiRuntime(
  getConfig: () => TerminalSuggestionRuntimeConfig,
  dependencies: {
    historyRuntime: TerminalSuggestionHistoryRuntime
    figRuntime: TerminalSuggestionFigRuntime
    executableRuntime: TerminalSuggestionExecutableRuntime
  }
): TerminalSuggestionAiRuntime {
  return {
    async fetchAiSuggestion(query, context) {
      const configGetter = getConfig().getConfig
      if (!configGetter || query.trim().length < 3) return []
      const config = configGetter()
      const requestedModel = normalizeText(context?.modelName) || normalizeText(config.modelName) || 'aiopsterm-local-agent'
      const provider = resolveModelProvider(config, context?.modelName)
      if (!provider) {
        if (requestedModel !== 'aiopsterm-local-agent') return []
        return inferLocalAiSuggestions(query, context, dependencies)
      }
      const request = createAiSuggestRequest(provider, query.trim(), context)
      if (!request) return []
      const response = await fetchProviderText(request, {
        fetch: getConfig().fetch,
        timeoutMs: defaultAiSuggestTimeoutMs,
        errorCodePrefix: 'TERMINAL_SUGGESTION_PROVIDER'
      })
      if (!response.ok) return []
      const parsed = parseTerminalAiSuggestResponse(response.text, query)
      return parsed ? [parsed] : []
    }
  }
}
