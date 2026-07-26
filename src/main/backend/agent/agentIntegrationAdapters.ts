import type { AiAgentSessionEventInput, AiAgentSessionSource } from '@shared/contracts/managedAiSessions'

export type AgentIntegrationAdapter = {
  id: AiAgentSessionSource
  aliases: string[]
  projectFileTracking: 'adapter' | 'limited'
}

const definitions: AgentIntegrationAdapter[] = [
  { id: 'codex', aliases: [], projectFileTracking: 'adapter' },
  { id: 'claude-code', aliases: ['claude', 'claude-code-cli'], projectFileTracking: 'adapter' },
  { id: 'cursor', aliases: ['cursoragent', 'cursor-agent'], projectFileTracking: 'adapter' },
  { id: 'gemini', aliases: ['gemini-cli'], projectFileTracking: 'adapter' },
  { id: 'copilot', aliases: ['github-copilot'], projectFileTracking: 'adapter' },
  { id: 'grok', aliases: [], projectFileTracking: 'adapter' },
  { id: 'opencode', aliases: ['open-code'], projectFileTracking: 'adapter' },
  { id: 'codebuddy', aliases: ['code-buddy'], projectFileTracking: 'adapter' },
  { id: 'factory', aliases: ['droid'], projectFileTracking: 'adapter' },
  { id: 'qoder', aliases: ['qodercli'], projectFileTracking: 'adapter' },
  { id: 'antigravity', aliases: ['agy'], projectFileTracking: 'adapter' },
  { id: 'kiro', aliases: ['kiro-cli'], projectFileTracking: 'adapter' },
  { id: 'hermes-agent', aliases: ['hermes'], projectFileTracking: 'adapter' },
  { id: 'rovodev', aliases: ['rovo', 'rovo-dev'], projectFileTracking: 'limited' },
  { id: 'amp', aliases: [], projectFileTracking: 'adapter' },
  { id: 'pi', aliases: [], projectFileTracking: 'adapter' },
  { id: 'omp', aliases: [], projectFileTracking: 'adapter' }
]

const normalizedId = (value: unknown) =>
  typeof value === 'string' ? value.trim().toLowerCase().replace(/_/g, '-') : ''

const adaptersByName = new Map<string, AgentIntegrationAdapter>()
for (const definition of definitions) {
  adaptersByName.set(definition.id, definition)
  definition.aliases.forEach((alias) => adaptersByName.set(normalizedId(alias), definition))
}

export const listAgentIntegrationAdapters = () => definitions.map((definition) => ({
  ...definition,
  aliases: [...definition.aliases]
}))

export const resolveAgentIntegrationAdapter = (value: unknown) =>
  adaptersByName.get(normalizedId(value)) || null

export const normalizeAgentIntegrationSource = (value: unknown): AiAgentSessionSource | null =>
  resolveAgentIntegrationAdapter(value)?.id || null

export const adaptAgentSessionEventInput = (input: AiAgentSessionEventInput) => {
  const record = input as Record<string, unknown>
  const adapter = resolveAgentIntegrationAdapter(record.source || record.agent || record.agentName || record.agent_name)
  if (!adapter) return null
  return {
    adapter,
    input: {
      ...input,
      source: adapter.id
    } satisfies AiAgentSessionEventInput
  }
}

export const projectFileTrackingForAgent = (value: unknown) =>
  resolveAgentIntegrationAdapter(value)?.projectFileTracking || 'limited'
