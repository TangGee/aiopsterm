import { describe, expect, it } from 'vitest'
import {
  addTerminalCommandGenerationRecord,
  prepareTerminalCommandGeneration,
  terminalCommandContextFromPanel,
  terminalCommandGenerationRecordMatchesRequest,
  terminalCommandModelOptions
} from '@/services/terminal/terminalCommandRuntime'
import type { TerminalCommandGenerationRecord } from '@shared/contracts/terminalTools'
import type { SettingsModelOption } from '@/services/settings/workspaceConfigRuntime'
import type { TerminalPanel } from '@/services/terminal/terminalPanelRuntime'

const panel = (input: Partial<TerminalPanel> = {}): TerminalPanel => ({
  id: 'panel-1',
  title: 'Terminal',
  cwd: '/home/unit',
  output: '',
  outputSegments: [],
  status: 'running',
  kind: 'terminal',
  sessionId: 'session-1',
  ...input
})

const models: SettingsModelOption[] = [
  { name: 'ops-model', checked: true, locked: false },
  { name: 'locked-model', checked: true, locked: true },
  { name: 'gpt-5-Thinking', checked: true, locked: false },
  { name: 'unchecked-model', checked: false, locked: false }
]

const record = (input: Partial<TerminalCommandGenerationRecord> = {}): TerminalCommandGenerationRecord => ({
  id: 'generated-command-1',
  panelId: 'panel-1',
  instruction: 'check disk',
  command: 'df -h',
  modelName: 'ops-model',
  context: { host: '127.0.0.1', username: 'local', cwd: '/home/unit', shell: 'local-shell', connectionType: 'local' },
  status: 'done',
  createdAt: 1780488000000,
  provider: 'aiopsterm-local',
  ...input
})

describe('terminalCommandRuntime', () => {
  it('filters command-capable model options without locked or Thinking rows', () => {
    expect(terminalCommandModelOptions(models)).toEqual(['ops-model'])
  })

  it('builds local and SSH command generation contexts from terminal panels', () => {
    expect(terminalCommandContextFromPanel(panel())).toEqual({
      host: '127.0.0.1',
      username: 'local',
      cwd: '/home/unit',
      shell: 'local-shell',
      connectionType: 'local'
    })
    expect(
      terminalCommandContextFromPanel(
        panel({
          sessionId: 'ssh-session',
          cwd: '/srv/app',
          sshSession: {
            host: '10.0.0.8',
            port: 22,
            username: 'deploy',
            assetName: 'prod'
          }
        })
      )
    ).toEqual({
      host: '10.0.0.8',
      username: 'deploy',
      cwd: '/srv/app',
      shell: 'local-shell',
      connectionType: 'ssh'
    })
  })

  it('prepares generation requests and rejects invalid panels, prompts, or missing models', () => {
    expect(
      prepareTerminalCommandGeneration([panel()], {
        panelId: 'session-1',
        instruction: '  check disk  ',
        modelOptions: terminalCommandModelOptions(models)
      })
    ).toEqual({
      ok: true,
      panel: panel(),
      request: {
        panelId: 'panel-1',
        instruction: 'check disk',
        modelName: 'ops-model',
        context: { host: '127.0.0.1', username: 'local', cwd: '/home/unit', shell: 'local-shell', connectionType: 'local' }
      }
    })
    expect(prepareTerminalCommandGeneration([panel({ kind: 'knowledge' })], { panelId: 'panel-1', instruction: 'check disk', modelOptions: ['ops-model'] })).toEqual({
      ok: false,
      reason: 'invalid-panel-or-prompt'
    })
    expect(prepareTerminalCommandGeneration([panel()], { panelId: 'panel-1', instruction: '   ', modelOptions: ['ops-model'] })).toEqual({
      ok: false,
      reason: 'invalid-panel-or-prompt'
    })
    expect(prepareTerminalCommandGeneration([panel()], { panelId: 'panel-1', instruction: 'check disk', modelOptions: [] })).toEqual({
      ok: false,
      reason: 'missing-model'
    })
  })

  it('matches backend records to requests and caps generation history', () => {
    const request = {
      panelId: 'panel-1',
      instruction: 'check disk',
      modelName: 'ops-model',
      context: { host: '127.0.0.1', username: 'local', cwd: '/home/unit', shell: 'local-shell' as const, connectionType: 'local' as const }
    }
    expect(terminalCommandGenerationRecordMatchesRequest(record(), request)).toBe(true)
    expect(terminalCommandGenerationRecordMatchesRequest(record({ instruction: 'other request' }), request)).toBe(false)
    expect(addTerminalCommandGenerationRecord(Array.from({ length: 20 }, (_, index) => record({ id: `old-${index}` })), record())).toHaveLength(20)
    expect(addTerminalCommandGenerationRecord([], record())[0].id).toBe('generated-command-1')
  })
})
