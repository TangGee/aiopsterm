import { describe, expect, it } from 'vitest'
import { codexTargetSignature, formatCodexTargetEvent } from '@/services/ai/codexTargetRuntime'
import type { CodexSessionTargetContext } from '@shared/contracts/codexSessions'

const target: CodexSessionTargetContext = {
  panelId: 'panel-1',
  sessionId: 'terminal-1',
  kind: 'ssh',
  label: 'prod',
  host: '127.0.0.1',
  port: 22,
  username: 'ops',
  assetId: 'asset-1',
  assetName: 'Production',
  cwd: '/srv/app'
}

describe('codexTargetRuntime', () => {
  it('builds stable target signatures and pending-context messages', () => {
    expect(codexTargetSignature(target)).toBe('panel-1\u001fterminal-1\u001fssh\u001fprod\u001f127.0.0.1\u001f22\u001fops\u001fasset-1\u001fProduction\u001f/srv/app')
    expect(formatCodexTargetEvent('bound', target)).toContain('Current target: prod')
    expect(formatCodexTargetEvent('changed', target)).toContain('[aiopsterm target changed]')
    expect(formatCodexTargetEvent('unbound')).toContain('target unbound')
  })
})
