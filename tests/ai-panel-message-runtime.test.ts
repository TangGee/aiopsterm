import { describe, expect, it } from 'vitest'
import {
  aiPanelChatExportMessage,
  aiPanelMessagePlainText,
  applyCommandTextToMessage,
  commandHostForMessage,
  commandHostTooltipForMessage,
  commandLineCountForMessage,
  commandOutputLineCount,
  commandTextForMessage,
  formatAiPanelLineCount,
  isAiPanelCommandSuggestionMessage,
  isCommandTerminalActionDisabled,
  isReadOnlyCommandMessage,
  normalizedCommandOutputText,
  renderAiPanelMarkdownParts,
  setAiPanelCommandExecutionState
} from '@/services/aiPanelMessageRuntime'
import type { AiChatHistoryMessage } from '@shared/contracts/aiChat'

describe('aiPanelMessageRuntime', () => {
  it('renders sanitized markdown and separates fenced code blocks', () => {
    const parts = renderAiPanelMarkdownParts(
      'CPU summary\n\n```sh\nps aux\n```\n\n<script>alert(1)</script>\n[bad](javascript:alert(1))'
    )
    expect(parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'html',
          html: expect.stringContaining('CPU summary')
        }),
        expect.objectContaining({
          type: 'code',
          language: 'bash',
          code: 'ps aux',
          lineCount: 1
        })
      ])
    )
    const html = parts.map((part) => (part.type === 'html' ? part.html : part.html)).join('')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('javascript:alert')
  })

  it('normalizes command output and line counts', () => {
    expect(normalizedCommandOutputText('```text\nline 1\nline 2\n```')).toBe('line 1\nline 2')
    expect(commandOutputLineCount('```text\nline 1\nline 2\n```')).toBe(2)
    expect(formatAiPanelLineCount(0)).toBe('1 line')
    expect(formatAiPanelLineCount(3)).toBe('3 lines')
  })

  it('detects command messages and updates editable command state', () => {
    const chipMessage = {
      id: 'm1',
      role: 'assistant',
      text: 'uptime',
      state: 'done',
      action: 'rejected',
      commandExecutionStatus: 'failed',
      commandExecutionMessage: 'blocked',
      executedCommand: 'uptime',
      contentParts: [{ type: 'chip', chipType: 'command', ref: { command: 'uptime', label: 'uptime' } }]
    } satisfies AiChatHistoryMessage

    expect(isAiPanelCommandSuggestionMessage(chipMessage)).toBe(true)
    expect(commandTextForMessage(chipMessage)).toBe('uptime')
    expect(applyCommandTextToMessage(chipMessage, 'uptime -p')).toBe(true)
    expect(chipMessage.text).toBe('uptime -p')
    expect(chipMessage.contentParts?.[0]).toEqual({
      type: 'chip',
      chipType: 'command',
      ref: { command: 'uptime -p', label: 'uptime -p' }
    })
    expect(chipMessage.action).toBeUndefined()
    expect(chipMessage.commandExecutionStatus).toBeUndefined()
    expect(chipMessage.commandExecutionMessage).toBeUndefined()
    expect(chipMessage.executedCommand).toBeUndefined()

    setAiPanelCommandExecutionState(chipMessage, 'running', 'sending')
    expect(isCommandTerminalActionDisabled(chipMessage)).toBe(true)
    expect(chipMessage.commandExecutionMessage).toBe('sending')
  })

  it('projects read-only command host metadata and export messages', () => {
    const message = {
      id: 'm2',
      role: 'assistant',
      text: 'df -h',
      state: 'done',
      ask: 'command',
      hosts: [
        { id: 'host-1', kind: 'hosts', label: 'prod', detail: '10.0.0.8' },
        { id: 'doc-1', kind: 'docs', label: 'Runbook' }
      ],
      commandExecution: {
        ip: '10.0.0.8',
        command: 'df -h',
        requiresApproval: false,
        interactive: false
      }
    } satisfies Omit<AiChatHistoryMessage, 'hosts'> & {
      hosts: Array<{ id: string; kind: string; label: string; detail?: string }>
    }

    expect(isReadOnlyCommandMessage(message)).toBe(true)
    expect(commandLineCountForMessage(message)).toBe(1)
    expect(commandHostForMessage(message)).toBe('Host 10.0.0.8')
    expect(commandHostTooltipForMessage(message)).toBe('目标主机：10.0.0.8')
    expect(aiPanelChatExportMessage(message).hosts).toEqual([{ id: 'host-1', kind: 'hosts', label: 'prod', detail: '10.0.0.8' }])
  })

  it('builds display text from structured user content parts', () => {
    expect(
      aiPanelMessagePlainText({
        text: '',
        contentParts: [
          { type: 'text', text: 'review ' },
          { type: 'chip', chipType: 'doc', ref: { absPath: '/runbook.md', name: 'Runbook.md' } },
          { type: 'image', mediaType: 'image/png', data: 'abc', name: 'chart.png' }
        ]
      })
    ).toBe('review @Runbook.md[image: chart.png]')
  })
})
