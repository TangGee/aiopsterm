import { beforeAll, describe, expect, it } from 'vitest'
import type {
  TerminalCommandGenerationInput,
  TerminalCommandGenerationResult,
  TerminalCommandSuggestion,
  TerminalCommandSuggestionContext
} from '@shared/preload'

type TerminalSuggestionsBackend = {
  generateTerminalCommand: (input: TerminalCommandGenerationInput) => TerminalCommandGenerationResult
  getTerminalCommandSuggestions: (query: string, context?: TerminalCommandSuggestionContext) => TerminalCommandSuggestion[]
}

let backend: TerminalSuggestionsBackend

beforeAll(async () => {
  const modulePath = '../src/main/backend/terminalSuggestions'
  backend = (await import(modulePath)) as TerminalSuggestionsBackend
})

describe('terminal command backend boundary', () => {
  it('generates command records behind the main-process boundary', () => {
    const result = backend.generateTerminalCommand({
      panelId: 'panel-ssh',
      instruction: '检查磁盘空间',
      modelName: 'aiopsterm-local-agent',
      context: {
        host: '10.8.0.9',
        username: 'deploy',
        cwd: '/home/deploy',
        shell: 'bash',
        connectionType: 'ssh'
      }
    })

    expect(result.ok).toBe(true)
    expect(result.data).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^terminal-command-/),
        panelId: 'panel-ssh',
        instruction: '检查磁盘空间',
        command: 'df -h',
        modelName: 'aiopsterm-local-agent',
        provider: 'aiopsterm-local',
        context: expect.objectContaining({ host: '10.8.0.9', username: 'deploy', connectionType: 'ssh' })
      })
    )
  })

  it('keeps suggestion rows behind the same terminal backend module', () => {
    expect(backend.getTerminalCommandSuggestions('df', { mode: 'base', host: '10.8.0.9' })).toEqual([
      expect.objectContaining({ command: 'df -h', source: 'base' })
    ])
    expect(backend.getTerminalCommandSuggestions('kubectl', { mode: 'ai' })).toEqual([
      expect.objectContaining({ command: 'kubectl --help', source: 'ai' })
    ])
  })
})
