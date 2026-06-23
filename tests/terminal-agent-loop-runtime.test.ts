import { describe, expect, it, vi } from 'vitest'
import {
  aiChatMessageInputFromTerminalAgentMessage,
  buildAgentCommandOutputMessagesForRequest,
  buildAgentCommandOutputPrompt,
  createAgentCommandOutputMessages,
  filterAgentCommandOutputForPrompt,
  waitForTerminalOutputAfter
} from '@/services/terminal/terminalAgentLoopRuntime'

describe('terminalAgentLoopRuntime', () => {
  it('waits for terminal output after a captured start length', async () => {
    let output = 'before'
    const delay = vi.fn(async () => {
      output += '\nresult\n'
    })

    await expect(waitForTerminalOutputAfter(() => ({ output }), 'before'.length, 500, delay)).resolves.toBe('\nresult\n')
    expect(delay).toHaveBeenCalledWith(80)
  })

  it('returns empty output when the terminal panel disappears', async () => {
    await expect(waitForTerminalOutputAfter(() => null, 0, 500, async () => undefined)).resolves.toBe('')
  })

  it('filters long command output for provider prompts', () => {
    const output = `HEAD-${'a'.repeat(20)}\n${'x'.repeat(500)}\nTAIL`

    expect(filterAgentCommandOutputForPrompt(output, { enabled: false, limit: 20, head: 5, tail: 5 })).toBe(output)

    const filtered = filterAgentCommandOutputForPrompt(output, { enabled: true, limit: 20, head: 10, tail: 8 })
    expect(filtered).toContain('HEAD-')
    expect(filtered).toContain('TAIL')
    expect(filtered).toContain('[aiopsterm omitted')
    expect(filtered.length).toBeLessThan(output.length)
  })

  it('builds agent command-output prompts and request messages', () => {
    const prompt = buildAgentCommandOutputPrompt('uptime', 'load average: 0.10', { enabled: true })
    expect(prompt).toContain('Command output from the approved execute_command tool is available.')
    expect(prompt).toContain('<command>uptime</command>')
    expect(prompt).toContain('load average: 0.10')

    const { commandOutputMessage, assistantMessage } = createAgentCommandOutputMessages({
      requestId: 'request-1',
      command: 'uptime',
      output: 'load average: 0.10',
      commandExecution: {
        ip: '10.0.0.5',
        command: 'uptime',
        requiresApproval: false,
        interactive: false
      }
    })
    expect(commandOutputMessage).toEqual(
      expect.objectContaining({
        id: 'request-1-command-output',
        role: 'assistant',
        say: 'command_output',
        action: 'approved',
        executedCommand: 'uptime'
      })
    )
    expect(assistantMessage).toEqual(expect.objectContaining({ id: 'request-1-assistant', state: 'streaming' }))

    const mapped = aiChatMessageInputFromTerminalAgentMessage(commandOutputMessage)
    expect(mapped).toEqual(
      expect.objectContaining({
        role: 'assistant',
        text: 'load average: 0.10',
        say: 'command_output',
        action: 'approved',
        commandExecution: expect.objectContaining({ command: 'uptime' })
      })
    )
  })

  it('filters only the command-output message sent back to the provider', () => {
    const messages = [
      { id: 'user-1', role: 'user' as const, text: 'check logs' },
      { id: 'out-1', role: 'assistant' as const, text: `HEAD\n${'x'.repeat(120)}\nTAIL`, say: 'command_output' as const }
    ]

    const mapped = buildAgentCommandOutputMessagesForRequest(messages, 'out-1', { enabled: true, limit: 20, head: 5, tail: 5 })
    expect(mapped[0]).toEqual({ role: 'user', text: 'check logs' })
    expect(mapped[1].text).toContain('[aiopsterm omitted')
    expect(mapped[1].text).toContain('TAIL')
  })
})
