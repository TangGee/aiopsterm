import { beforeAll, describe, expect, it } from 'vitest'
import type { TerminalCommandSuggestion } from '@shared/contracts/terminalTools'

type HistoryRow = {
  command: string
  host: string
  count: number
  last_used_at: number
}

type CommonRuntime = {
  isValidTerminalCommandForHistory(command: string): boolean
  dedupeSuggestions(items: TerminalCommandSuggestion[], limit: number): TerminalCommandSuggestion[]
}

type HistoryRuntime = {
  queryTerminalSuggestionHistoryRows(
    rows: HistoryRow[],
    command: string,
    host: string,
    limit: number,
    nowSeconds: number
  ): TerminalCommandSuggestion[]
}

type AiRuntime = {
  parseTerminalAiSuggestResponse(response: string, partialCommand: string): TerminalCommandSuggestion | null
}

type CommandGenerationRuntime = {
  extractGeneratedTerminalCommand(response: string): string
  inferGeneratedTerminalCommand(instruction: string, cwd?: string): string
}

let common: CommonRuntime
let historyRuntime: HistoryRuntime
let aiRuntime: AiRuntime
let commandGenerationRuntime: CommandGenerationRuntime

beforeAll(async () => {
  const commonPath = '../src/main/backend/terminal/terminalSuggestionCommon'
  const historyPath = '../src/main/backend/terminal/terminalSuggestionHistoryRuntime'
  const aiPath = '../src/main/backend/terminal/terminalSuggestionAiRuntime'
  const commandGenerationPath = '../src/main/backend/terminal/terminalCommandGenerationRuntime'
  common = (await import(commonPath)) as CommonRuntime
  historyRuntime = (await import(historyPath)) as HistoryRuntime
  aiRuntime = (await import(aiPath)) as AiRuntime
  commandGenerationRuntime = (await import(commandGenerationPath)) as CommandGenerationRuntime
})

describe('terminal suggestion extracted runtimes', () => {
  it('validates terminal history candidates without accepting destructive commands', () => {
    expect(common.isValidTerminalCommandForHistory('kubectl get pods -A')).toBe(true)
    expect(common.isValidTerminalCommandForHistory('./scripts/check-health.sh')).toBe(true)
    expect(common.isValidTerminalCommandForHistory('rm -rf /')).toBe(false)
    expect(common.isValidTerminalCommandForHistory('mkfs.ext4 /dev/sda')).toBe(false)
    expect(common.isValidTerminalCommandForHistory('...\nnext')).toBe(false)
  })

  it('ranks same-host history before remote matches and fills with fuzzy candidates', () => {
    const now = 1_780_488_000
    const rows = [
      { command: 'systemctl restart nginx', host: '10.0.0.8', count: 9, last_used_at: now },
      { command: 'systemctl status nginx', host: '10.0.0.9', count: 1, last_used_at: now },
      { command: 'kubectl get pods -A', host: '10.0.0.9', count: 4, last_used_at: now }
    ]

    expect(historyRuntime.queryTerminalSuggestionHistoryRows(rows, 'sys', '10.0.0.9', 3, now)).toEqual([
      {
        command: 'systemctl status nginx',
        source: 'history',
        explanation: 'history on this host'
      },
      {
        command: 'systemctl restart nginx',
        source: 'history',
        explanation: 'history from 10.0.0.8'
      }
    ])

    expect(historyRuntime.queryTerminalSuggestionHistoryRows(rows, 'kgp', '10.0.0.9', 3, now)).toEqual([
      {
        command: 'kubectl get pods -A',
        source: 'history',
        explanation: 'history fuzzy match'
      }
    ])
  })

  it('deduplicates suggestions by normalized command while preserving source metadata', () => {
    const suggestions: TerminalCommandSuggestion[] = [
      { command: ' kubectl get pods ', source: 'history', explanation: 'history' },
      { command: 'kubectl get pods', source: 'base', explanation: 'spec' },
      { command: 'kubectl get services', source: 'base', explanation: 'spec' }
    ]

    expect(common.dedupeSuggestions(suggestions, 6)).toEqual([
      { command: 'kubectl get pods', source: 'history', explanation: 'history' },
      { command: 'kubectl get services', source: 'base', explanation: 'spec' }
    ])
  })

  it('parses terminal AI suggestions and rejects unsafe or unrelated responses', () => {
    expect(aiRuntime.parseTerminalAiSuggestResponse('CMD: git log --oneline -5\nEXP: recent commits', 'git lo')).toEqual({
      command: 'git log --oneline -5',
      source: 'ai',
      explanation: 'recent commits'
    })
    expect(aiRuntime.parseTerminalAiSuggestResponse('CMD: rm -rf /\nEXP: cleanup', 'rm')).toBeNull()
    expect(aiRuntime.parseTerminalAiSuggestResponse('CMD: kubectl get pods\nEXP: pods', 'git')).toBeNull()
    expect(aiRuntime.parseTerminalAiSuggestResponse('NONE', 'git')).toBeNull()
  })

  it('extracts provider-generated commands from common response formats', () => {
    expect(commandGenerationRuntime.extractGeneratedTerminalCommand('```bash\njournalctl -u nginx\n```')).toBe('journalctl -u nginx')
    expect(commandGenerationRuntime.extractGeneratedTerminalCommand('CMD: df -h\nEXP: disk')).toBe('df -h')
    expect(commandGenerationRuntime.extractGeneratedTerminalCommand('"kubectl get pods -A"')).toBe('kubectl get pods -A')
    expect(commandGenerationRuntime.extractGeneratedTerminalCommand('NONE')).toBe('')
  })

  it('keeps local command generation heuristics in the command generation runtime', () => {
    expect(commandGenerationRuntime.inferGeneratedTerminalCommand('检查磁盘空间')).toBe('df -h')
    expect(commandGenerationRuntime.inferGeneratedTerminalCommand('show files', '/srv/app')).toBe('ls -la /srv/app')
    expect(commandGenerationRuntime.inferGeneratedTerminalCommand('inspect custom service')).toBe('echo "inspect custom service"')
  })
})
