import type { AiChatMessageInput } from '@shared/contracts/aiChat'
import type { TerminalPanel } from '@/services/terminalPanelRuntime'

export type TerminalAgentLoopMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  ask?: AiChatMessageInput['ask']
  say?: AiChatMessageInput['say']
  action?: AiChatMessageInput['action']
  commandExecution?: AiChatMessageInput['commandExecution']
}

export type TerminalAgentOutputFilterOptions = {
  enabled: boolean
  limit?: number
  head?: number
  tail?: number
}

const defaultFilterLimit = 12000
const defaultFilterHead = 4000
const defaultFilterTail = 6000

export const waitForTerminalOutputAfter = async (
  panelForOutput: () => Pick<TerminalPanel, 'output'> | null | undefined,
  startLength: number,
  timeoutMs = 2_500,
  delay: (delayMs: number) => Promise<void> = (delayMs) => new Promise((resolve) => window.setTimeout(resolve, Math.max(0, delayMs)))
) => {
  const startedAt = Date.now()
  let panel = panelForOutput()
  if (!panel) return ''
  while (Date.now() - startedAt < timeoutMs) {
    panel = panelForOutput()
    if (!panel) return ''
    const output = panel.output.slice(startLength)
    if (output.trim()) return output
    await delay(80)
  }
  panel = panelForOutput()
  return panel?.output.slice(startLength) || ''
}

export const aiChatMessageInputFromTerminalAgentMessage = (message: TerminalAgentLoopMessage): AiChatMessageInput => ({
  role: message.role,
  text: message.text,
  ask: message.ask,
  say: message.say,
  action: message.action,
  commandExecution: message.commandExecution ? { ...message.commandExecution } : undefined
})

export const filterAgentCommandOutputForPrompt = (output: string, options: TerminalAgentOutputFilterOptions) => {
  const trimmed = output.trimEnd()
  const limit = options.limit ?? defaultFilterLimit
  if (!options.enabled || trimmed.length <= limit) return trimmed
  const head = options.head ?? defaultFilterHead
  const tail = options.tail ?? defaultFilterTail
  const omittedChars = trimmed.length - head - tail
  return [
    trimmed.slice(0, head).trimEnd(),
    '',
    `[aiopsterm omitted ${omittedChars.toLocaleString()} characters from the middle of this command output because AI command output filtering is enabled.]`,
    '',
    trimmed.slice(-tail).trimStart()
  ].join('\n')
}

export const buildAgentCommandOutputPrompt = (
  command: string,
  output: string,
  filterOptions: TerminalAgentOutputFilterOptions
) =>
  [
    'Command output from the approved execute_command tool is available.',
    '',
    `<command>${command}</command>`,
    '',
    'Output:',
    '```',
    filterAgentCommandOutputForPrompt(output, filterOptions),
    '```',
    '',
    'Continue the Agent loop: analyze this observation, request another <execute_command> block only if another terminal step is needed, otherwise provide the final answer.'
  ].join('\n')

export const createAgentCommandOutputMessages = (input: {
  requestId: string
  command: string
  output: string
  commandExecution?: AiChatMessageInput['commandExecution']
}) => ({
  commandOutputMessage: {
    id: `${input.requestId}-command-output`,
    role: 'assistant' as const,
    text: input.output,
    state: 'done' as const,
    say: 'command_output' as const,
    action: 'approved' as const,
    commandExecution: input.commandExecution ? { ...input.commandExecution } : undefined,
    executedCommand: input.command
  },
  assistantMessage: {
    id: `${input.requestId}-assistant`,
    role: 'assistant' as const,
    text: '正在分析命令输出...',
    state: 'streaming' as const
  }
})

export const buildAgentCommandOutputMessagesForRequest = (
  messages: TerminalAgentLoopMessage[],
  commandOutputMessageId: string,
  filterOptions: TerminalAgentOutputFilterOptions
): AiChatMessageInput[] =>
  messages.map((message) => {
    const mapped = aiChatMessageInputFromTerminalAgentMessage(message)
    if (message.id === commandOutputMessageId) {
      mapped.text = filterAgentCommandOutputForPrompt(message.text, filterOptions)
    }
    return mapped
  })
