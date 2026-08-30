import type { AgentSessionParserDefinition, AgentSessionParserRule } from './contracts/agentSessionParsers'
import type { AiAgentSessionSource } from './contracts/managedAiSessions'

const rule = (input: AgentSessionParserRule): AgentSessionParserRule => input

const eventOnlySources: Array<{ source: AiAgentSessionSource; displayName: string }> = [
  { source: 'cursor', displayName: 'Cursor Agent' },
  { source: 'gemini', displayName: 'Gemini CLI' },
  { source: 'copilot', displayName: 'GitHub Copilot' },
  { source: 'grok', displayName: 'Grok CLI' },
  { source: 'codebuddy', displayName: 'CodeBuddy' },
  { source: 'factory', displayName: 'Factory Droid' },
  { source: 'qoder', displayName: 'Qoder CLI' },
  { source: 'antigravity', displayName: 'Antigravity' },
  { source: 'kiro', displayName: 'Kiro CLI' },
  { source: 'hermes-agent', displayName: 'Hermes Agent' },
  { source: 'rovodev', displayName: 'Rovo Dev' },
  { source: 'amp', displayName: 'Amp' },
  { source: 'pi', displayName: 'Pi' },
  { source: 'omp', displayName: 'OMP' },
  { source: 'kimi-code', displayName: 'Kimi Code' },
  { source: 'deepseek-harness', displayName: 'DeepSeek Harness' }
]

export const builtinAgentSessionParserDefinitions: AgentSessionParserDefinition[] = [
  {
    schemaVersion: 1,
    id: 'codex',
    source: 'codex',
    displayName: 'Codex',
    storage: { kind: 'jsonl', paths: ['${HOME}/.codex/sessions/**/*.jsonl'] },
    fallback: 'raw-json',
    rules: [
      rule({ id: 'system-prompt', match: { '/type': 'session_meta' }, kind: 'system prompt', role: 'system', contentPointers: ['/payload/base_instructions/text'] }),
      rule({ id: 'user-event-message', match: { '/type': 'event_msg', '/payload/type': 'user_message' }, kind: 'message', role: 'user', contentPointers: ['/payload/message'] }),
      rule({ id: 'assistant-event-message', match: { '/type': 'event_msg', '/payload/type': ['agent_message', 'assistant_message'] }, kind: 'message', role: 'assistant', contentPointers: ['/payload/message'] }),
      rule({ id: 'assistant-event-reasoning', match: { '/type': 'event_msg', '/payload/type': 'agent_reasoning' }, kind: 'reasoning', role: 'assistant', contentPointers: ['/payload/text'] }),
      rule({ id: 'response-message', scopePointer: '/payload/content/*', match: { '/type': ['input_text', 'output_text'] }, kind: 'message', rolePointer: '$/payload/role', contentPointers: ['/text'] }),
      rule({ id: 'function-call', match: { '/type': 'response_item', '/payload/type': 'function_call' }, kind: 'tool call', role: 'tool', contentPointers: ['/payload/arguments'], labelPointer: '/payload/name' }),
      rule({ id: 'custom-tool-call', match: { '/type': 'response_item', '/payload/type': 'custom_tool_call' }, kind: 'tool call', role: 'tool', contentPointers: ['/payload/input'], labelPointer: '/payload/name' }),
      rule({ id: 'function-result', match: { '/type': 'response_item', '/payload/type': ['function_call_output', 'custom_tool_call_output'] }, kind: 'tool result', role: 'tool', contentPointers: ['/payload/output'] }),
      rule({ id: 'reasoning-summary', scopePointer: '/payload/summary/*', match: { '$/type': 'response_item', '$/payload/type': 'reasoning' }, kind: 'reasoning', role: 'assistant', contentPointers: ['/text'] }),
      rule({ id: 'reasoning-content', scopePointer: '/payload/content/*', match: { '$/type': 'response_item', '$/payload/type': 'reasoning' }, kind: 'reasoning', role: 'assistant', contentPointers: ['/text'] }),
      rule({ id: 'web-search', match: { '/type': 'response_item', '/payload/type': 'web_search_call' }, kind: 'tool call', role: 'tool', contentPointers: ['/payload/query'] })
    ]
  },
  {
    schemaVersion: 1,
    id: 'claude-code',
    source: 'claude-code',
    displayName: 'Claude Code',
    storage: { kind: 'jsonl', paths: ['${HOME}/.claude/projects/**/*.jsonl'] },
    fallback: 'raw-json',
    rules: [
      rule({ id: 'plain-message', match: { '/type': ['user', 'assistant'] }, kind: 'message', rolePointer: '/message/role', contentPointers: ['/message/content'] }),
      rule({ id: 'text-block', scopePointer: '/message/content/*', match: { '/type': 'text' }, kind: 'message', rolePointer: '$/message/role', contentPointers: ['/text'] }),
      rule({ id: 'thinking-block', scopePointer: '/message/content/*', match: { '/type': 'thinking' }, kind: 'reasoning', role: 'assistant', contentPointers: ['/thinking'] }),
      rule({ id: 'tool-use-block', scopePointer: '/message/content/*', match: { '/type': ['tool_use', 'server_tool_use'] }, kind: 'tool call', role: 'tool', contentPointers: ['/input'], labelPointer: '/name' }),
      rule({ id: 'tool-result-block', scopePointer: '/message/content/*', match: { '/type': 'tool_result' }, kind: 'tool result', role: 'tool', contentPointers: ['/content'] }),
      rule({ id: 'agent-result', match: { '/type': 'result' }, kind: 'result', role: 'assistant', contentPointers: ['/result'] })
    ]
  },
  {
    schemaVersion: 1,
    id: 'opencode',
    source: 'opencode',
    displayName: 'OpenCode',
    storage: { kind: 'opencode-sqlite' },
    fallback: 'raw-json',
    rules: [
      rule({ id: 'text-part', match: { '/type': ['text', 'reasoning'] }, kind: 'message', contentPointers: ['/text'], editable: true }),
      rule({ id: 'tool-part', match: { '/type': ['tool', 'tool-call', 'tool_result'] }, kind: 'tool', role: 'tool', contentPointers: ['/state', '/input', '/output'] })
    ]
  },
  ...eventOnlySources.map(({ source, displayName }) => ({
    schemaVersion: 1 as const,
    id: source,
    source,
    displayName,
    storage: { kind: 'events' as const },
    rules: [],
    fallback: 'raw-json' as const
  }))
]
