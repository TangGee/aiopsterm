import { describe, expect, it } from 'vitest'
import {
  isLocalTerminalSessionInfo,
  isSshTerminalSessionInfo,
  isTerminalCommandGenerationRecord,
  isTerminalExitEvent,
  isTerminalLifecycleEvent,
  terminalWriteByteLength,
  terminalWriteExceptionReason,
  validateTerminalWriteResult
} from '@/services/terminal/terminalBackendGuards'
import type { TerminalLifecycleEvent, TerminalSessionInfo } from '@shared/contracts/terminalSessions'
import type { TerminalCommandGenerationRecord } from '@shared/contracts/terminalTools'

const sshLifecycle: TerminalLifecycleEvent = {
  id: 'terminal-ssh-1',
  kind: 'ssh',
  stage: 'connected',
  at: 1781884800000,
  connectionId: 'ssh-connection-1',
  host: '10.0.0.5',
  port: 22,
  username: 'root',
  sshTransport: 'jump',
  connectionReuse: 'created',
  endpointConfidence: 'confirmed'
}

const sshSession: TerminalSessionInfo = {
  id: 'terminal-ssh-1',
  kind: 'ssh',
  shell: '/bin/bash',
  cwd: '/srv/app',
  classicTarget: {
    targetId: 'asset-prod',
    terminalSessionId: 'terminal-ssh-1',
    label: 'prod-host',
    kind: 'ssh',
    cwd: '/srv/app'
  },
  lifecycle: sshLifecycle,
  connection: {
    connectionId: 'ssh-connection-1',
    host: '10.0.0.5',
    port: 22,
    username: 'root',
    assetName: 'prod-host',
    createdAt: 1781884800000
  }
}

const generatedCommand: TerminalCommandGenerationRecord = {
  id: 'generated-command-1',
  panelId: 'panel-1',
  instruction: 'show disk usage',
  command: 'df -h',
  modelName: 'ops-model',
  context: {
    host: '10.0.0.5',
    username: 'root',
    cwd: '/srv/app',
    shell: 'bash',
    connectionType: 'ssh'
  },
  status: 'done',
  createdAt: 1781884800000,
  provider: 'aiopsterm-local'
}

describe('terminalBackendGuards', () => {
  it('validates terminal lifecycle, exit, and session payloads', () => {
    expect(isTerminalLifecycleEvent(sshLifecycle, 'terminal-ssh-1', 'ssh')).toBe(true)
    expect(isTerminalLifecycleEvent({ ...sshLifecycle, port: 70000 })).toBe(false)
    expect(isTerminalLifecycleEvent({ ...sshLifecycle, kind: 'local' }, 'terminal-ssh-1', 'ssh')).toBe(false)
    expect(isTerminalExitEvent({ id: 'terminal-ssh-1', code: 0, kind: 'ssh', reason: 'process' })).toBe(true)
    expect(isTerminalExitEvent({ id: 'terminal-ssh-1', code: '0', kind: 'ssh' })).toBe(false)
    expect(isSshTerminalSessionInfo(sshSession)).toBe(true)
    expect(isSshTerminalSessionInfo({
      ...sshSession,
      classicTarget: { ...sshSession.classicTarget!, terminalSessionId: 'terminal-other' }
    })).toBe(false)
    expect(isSshTerminalSessionInfo({
      ...sshSession,
      classicTarget: { ...sshSession.classicTarget!, kind: 'local' }
    })).toBe(false)
    expect(isSshTerminalSessionInfo({ ...sshSession, connection: { ...sshSession.connection, assetName: '' } })).toBe(false)
    expect(isLocalTerminalSessionInfo({
      id: 'terminal-local-1',
      kind: 'local',
      shell: '/bin/zsh',
      cwd: '/work',
      classicTarget: {
        targetId: 'opened-local',
        terminalSessionId: 'terminal-local-1',
        label: 'Local terminal',
        kind: 'local',
        cwd: '/work'
      }
    })).toBe(true)
    expect(isLocalTerminalSessionInfo({ id: 'terminal-local-1', kind: 'ssh', shell: '/bin/zsh', cwd: '/work' })).toBe(false)
  })

  it('validates terminal write envelopes using byte length', () => {
    expect(terminalWriteByteLength('你好\n')).toBe(7)
    expect(validateTerminalWriteResult({ ok: true, data: { id: 'terminal-1', bytes: terminalWriteByteLength('你好\n') } }, 'terminal-1', '你好\n')).toEqual({ ok: true })
    expect(validateTerminalWriteResult({ ok: true, data: { id: 'terminal-1', bytes: 3 } }, 'terminal-1', '你好\n')).toEqual({
      ok: false,
      reason: '终端写入服务返回数据无效'
    })
    expect(validateTerminalWriteResult({ ok: false, errorMessage: 'session closed' }, 'terminal-1', 'pwd\n')).toEqual({ ok: false, reason: 'session closed' })
    expect(validateTerminalWriteResult(null, 'terminal-1', 'pwd\n')).toEqual({ ok: false, reason: '终端写入服务返回数据无效' })
    expect(terminalWriteExceptionReason(new Error('bridge down'))).toBe('bridge down')
    expect(terminalWriteExceptionReason('broken')).toBe('终端写入失败，请重新打开本地 shell 或连接 SSH')
  })

  it('validates generated terminal command records', () => {
    expect(isTerminalCommandGenerationRecord(generatedCommand)).toBe(true)
    expect(isTerminalCommandGenerationRecord({ ...generatedCommand, provider: 'unknown' })).toBe(false)
    expect(isTerminalCommandGenerationRecord({ ...generatedCommand, context: { ...generatedCommand.context, connectionType: 'container' } })).toBe(false)
    expect(isTerminalCommandGenerationRecord({ ...generatedCommand, createdAt: -1 })).toBe(false)
  })
})
