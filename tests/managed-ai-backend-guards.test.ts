import { describe, expect, it } from 'vitest'
import {
  isAgentHibernationConfigData,
  isAgentHookInstallOperationData,
  isAgentHookInstallerSnapshot,
  isManagedAiSessionBulkData,
  isManagedAiSessionHibernateData,
  isManagedAiSessionMutationData,
  isManagedAiSessionSnapshot
} from '@/services/managedAiBackendGuards'
import type { AgentHookInstallerSnapshot } from '@shared/contracts/agentHooks'
import type { AgentHibernationConfig, ManagedAiSessionRecord } from '@shared/contracts/managedAiSessions'

const session: ManagedAiSessionRecord = {
  id: 'session-1',
  source: 'codex',
  title: 'Deploy review',
  summary: 'Needs permission',
  state: 'needsInput',
  lastEvent: 'permission_request',
  lastActivityAt: 1781884800000,
  createdAt: 1781884700000,
  updatedAt: 1781884800000,
  requestKind: 'permission',
  decisionMode: 'local',
  waitTimeoutMs: 60000,
  toolName: 'shell',
  terminalSessionId: 'terminal-1',
  terminalProcessId: 1234,
  events: [
    {
      id: 'event-1',
      source: 'codex',
      event: 'permission_request',
      sessionId: 'session-1',
      title: 'Deploy review',
      summary: 'Approve command',
      receivedAt: 1781884800000,
      requestKind: 'permission',
      decisionMode: 'local',
      waitTimeoutMs: 60000,
      toolName: 'shell'
    }
  ],
  decisions: [{ id: 'decision-1', kind: 'allow', createdAt: 1781884810000 }]
}

const snapshot = { sessions: [session] }

const hibernationConfig: AgentHibernationConfig = {
  enabled: true,
  idleSeconds: 300,
  maxLiveTerminals: 8,
  confirmationSeconds: 30
}

const hookSnapshot: AgentHookInstallerSnapshot = {
  installers: [
    {
      source: 'codex',
      label: 'Codex',
      binaryName: 'codex',
      binaryPath: '/usr/local/bin/codex',
      configPath: '/home/unit/.codex/config.toml',
      configExists: true,
      installed: true,
      scriptPath: '/home/unit/.codex/hooks/aiopsterm.sh',
      warnings: []
    }
  ]
}

describe('managedAiBackendGuards', () => {
  it('validates managed AI session snapshots and mutation envelopes', () => {
    expect(isManagedAiSessionSnapshot(snapshot)).toBe(true)
    expect(isManagedAiSessionSnapshot({ sessions: [{ ...session, source: 'unknown' }] })).toBe(false)
    expect(isManagedAiSessionSnapshot({ sessions: [{ ...session, events: [{ ...session.events[0], waitTimeoutMs: 0 }] }] })).toBe(false)
    expect(isManagedAiSessionMutationData({ session, snapshot })).toBe(true)
    expect(isManagedAiSessionMutationData({ session: { ...session, decisions: [{ id: 'decision-1', kind: 'invalid', createdAt: 1 }] }, snapshot })).toBe(false)
    expect(isManagedAiSessionBulkData({ changed: 1, snapshot })).toBe(true)
    expect(isManagedAiSessionBulkData({ changed: '1', snapshot })).toBe(false)
  })

  it('validates hibernation config and hibernation mutation data', () => {
    expect(isAgentHibernationConfigData({ config: hibernationConfig })).toBe(true)
    expect(isAgentHibernationConfigData({ config: { ...hibernationConfig, idleSeconds: 0 } })).toBe(false)
    expect(isManagedAiSessionHibernateData({ session, snapshot, config: hibernationConfig })).toBe(true)
    expect(isManagedAiSessionHibernateData({ session, snapshot, config: { ...hibernationConfig, maxLiveTerminals: 0 } })).toBe(false)
  })

  it('validates Agent Hook installer snapshots and operation data', () => {
    expect(isAgentHookInstallerSnapshot(hookSnapshot)).toBe(true)
    expect(isAgentHookInstallerSnapshot({ installers: [{ ...hookSnapshot.installers[0], source: 'antigravity' }] })).toBe(false)
    expect(isAgentHookInstallOperationData({ operation: 'install', source: 'codex', status: hookSnapshot.installers[0], snapshot: hookSnapshot })).toBe(true)
    expect(isAgentHookInstallOperationData({ operation: 'refresh', source: 'codex', status: hookSnapshot.installers[0], snapshot: hookSnapshot })).toBe(false)
  })
})
