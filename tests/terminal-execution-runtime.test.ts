import { describe, expect, it } from 'vitest'
import {
  commandSecurityNotice,
  createGlobalTerminalSecurityExecution,
  createTerminalSecurityExecution,
  prepareTerminalSecurityExecution,
  quickCommandPlanUnavailable,
  resolveQuickCommandPanelIds,
  terminalExecutionUnavailable,
  terminalSecurityExecutionShouldWrite,
  terminalSecurityPromptCancellationNotice,
  type TerminalSecurityExecution
} from '@/services/terminal/terminalExecutionRuntime'
import { defaultSecuritySettings } from '@/services/settings/workspaceConfigRuntime'
import { createEmptyTerminalPanel, type TerminalPanel } from '@/services/terminal/terminalPanelRuntime'
import type { SecurityUserConfig } from '@shared/contracts/appRuntime'

const securityConfig = (
  patch: Partial<Omit<SecurityUserConfig['security'], 'securityPolicy'>> & {
    securityPolicy?: Partial<SecurityUserConfig['security']['securityPolicy']>
  } = {}
): SecurityUserConfig => ({
  security: {
    ...defaultSecuritySettings.security,
    ...patch,
    securityPolicy: {
      ...defaultSecuritySettings.security.securityPolicy,
      ...(patch.securityPolicy || {})
    }
  }
})

describe('terminalExecutionRuntime', () => {
  it('builds direct terminal executions without applying security policy', () => {
    const decision = createTerminalSecurityExecution('panel-1', '  uptime  ', { source: 'agent' })

    expect(decision).toEqual({
      status: 'allow',
      execution: {
        command: 'uptime',
        panelIds: ['panel-1'],
        inputText: 'uptime\n',
        shellText: 'uptime\n',
        writeToShell: true,
        source: 'agent'
      }
    })
    expect(terminalSecurityExecutionShouldWrite(decision)).toBe(true)
    expect(createTerminalSecurityExecution('panel-1', '   ')).toEqual({ status: 'allow' })
  })

  it('prepares allow, approval, and blocked security decisions', () => {
    const executionDecision = createTerminalSecurityExecution('panel-1', 'rm /tmp/file')
    expect(executionDecision.status).toBe('allow')
    if (executionDecision.status !== 'allow' || !executionDecision.execution) throw new Error('expected execution')
    const execution = executionDecision.execution
    expect(prepareTerminalSecurityExecution({ ...execution, command: 'pwd' }, { securitySettings: securityConfig(), promptId: 'prompt-1' })).toEqual({
      status: 'allow',
      execution: { ...execution, command: 'pwd' }
    })

    const approval = prepareTerminalSecurityExecution(execution, {
      securitySettings: securityConfig({ securityPolicy: { blockCritical: false } }),
      promptId: 'prompt-approve'
    })
    expect(approval.status).toBe('needs-approval')
    if (approval.status === 'needs-approval') {
      expect(approval.prompt).toEqual(
        expect.objectContaining({
          id: 'prompt-approve',
          command: 'rm /tmp/file',
          panelIds: ['panel-1'],
          source: 'direct'
        })
      )
      expect(approval.prompt.execution.command).toBe('rm /tmp/file')
    }

    const blocked = prepareTerminalSecurityExecution(execution, {
      securitySettings: securityConfig({ blacklistPatterns: ['rm *'], securityPolicy: { askForBlacklist: false } }),
      promptId: 'prompt-blocked'
    })
    expect(blocked).toEqual({
      status: 'blocked',
      command: 'rm /tmp/file',
      result: expect.objectContaining({ isAllowed: false, category: 'blacklist', action: 'block' })
    })
    if (blocked.status === 'blocked') {
      expect(commandSecurityNotice(blocked.result, execution.command)).toContain('命令已被安全策略阻止：rm /tmp/file')
    }
  })

  it('allows manual terminal paste without applying command security', () => {
    const text = `rm -rf /tmp\n${'plain text '.repeat(100_000)}`
    const execution: TerminalSecurityExecution = {
      command: text.trim(),
      panelIds: ['panel-1'],
      inputText: text,
      shellText: text,
      writeToShell: true,
      source: 'manual-paste'
    }

    expect(
      prepareTerminalSecurityExecution(execution, {
        securitySettings: securityConfig({
          enableStrictMode: true,
          blacklistPatterns: ['rm *'],
          maxCommandLength: 1
        }),
        promptId: 'manual-paste'
      })
    ).toEqual({ status: 'allow', execution })
  })

  it('checks every quick-command security command before allowing execution', () => {
    const execution: TerminalSecurityExecution = {
      command: 'disk check',
      securityCommands: ['df -h', 'rm /tmp/later'],
      panelIds: ['panel-1'],
      inputText: 'df -h\nrm /tmp/later\n',
      shellText: 'df -h\nrm /tmp/later\n',
      writeToShell: true,
      source: 'snippet',
      snippetSegments: [{ text: 'df -h\nrm /tmp/later\n', delayBeforeMs: 0 }]
    }

    const decision = prepareTerminalSecurityExecution(execution, {
      securitySettings: securityConfig({ securityPolicy: { blockCritical: false } }),
      promptId: 'prompt-snippet'
    })
    expect(decision.status).toBe('needs-approval')
    if (decision.status === 'needs-approval') {
      expect(decision.prompt.command).toBe('rm /tmp/later')
      expect(decision.prompt.execution.command).toBe('rm /tmp/later')
      expect(decision.prompt.execution.snippetSegments).toBe(execution.snippetSegments)
    }
  })

  it('builds global execution decisions from writable panel availability', () => {
    expect(createGlobalTerminalSecurityExecution('hostname', ['panel-1', 'panel-2'], ['panel-1', 'panel-2', 'panel-3'], true)).toEqual({
      status: 'allow',
      execution: expect.objectContaining({
        command: 'hostname',
        panelIds: ['panel-1', 'panel-2'],
        inputText: 'hostname\n',
        shellText: 'hostname\n',
        writeToShell: true,
        source: 'global'
      })
    })
    expect(createGlobalTerminalSecurityExecution('hostname', [], ['panel-1'], true)).toEqual(
      terminalExecutionUnavailable('hostname', ['panel-1'])
    )
    expect(createGlobalTerminalSecurityExecution('hostname', ['panel-1'], ['panel-1'], false)).toEqual(
      terminalExecutionUnavailable('hostname', ['panel-1'])
    )
    expect(createGlobalTerminalSecurityExecution('   ', ['panel-1'], ['panel-1'], true)).toEqual({ status: 'allow' })
  })

  it('formats shared terminal security notices', () => {
    expect(terminalExecutionUnavailable('uptime', ['panel-1'], 'bridge offline')).toEqual({
      status: 'unavailable',
      command: 'uptime',
      panelIds: ['panel-1'],
      reason: 'bridge offline'
    })
    expect(terminalSecurityPromptCancellationNotice('rm /tmp/file')).toBe('命令执行已取消：rm /tmp/file')
  })

  it('resolves quick-command panel targets and unavailable decisions', () => {
    const active: TerminalPanel = { ...createEmptyTerminalPanel('panel-active', 'Active'), sessionId: 'terminal-active' }
    const pending = createEmptyTerminalPanel('panel-pending', 'Pending')
    const knowledge: TerminalPanel = {
      id: 'kb:readme',
      title: 'Readme',
      cwd: '@knowledgebase',
      output: '',
      outputSegments: [],
      status: 'ready',
      kind: 'knowledge',
      knowledge: { relPath: 'README.md', isImage: false }
    }
    const panels = [knowledge, active, pending]

    expect(resolveQuickCommandPanelIds(panels, active, false)).toEqual(['panel-active'])
    expect(resolveQuickCommandPanelIds(panels, knowledge, false)).toEqual(['panel-active'])
    expect(resolveQuickCommandPanelIds(panels, active, true)).toEqual(['panel-active'])
    active.sessionId = undefined
    expect(resolveQuickCommandPanelIds(panels, active, true)).toEqual(['panel-active', 'panel-pending'])
    expect(quickCommandPlanUnavailable('Disk Check', ['panel-active'], 'planner offline')).toEqual({
      status: 'unavailable',
      command: 'Disk Check',
      panelIds: ['panel-active'],
      reason: 'planner offline'
    })
  })
})
