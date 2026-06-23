import { describe, expect, it } from 'vitest'
import {
  applyCodexExitEvent,
  applyCodexLifecycleEvent,
  applyCodexSessionStarted,
  applyCodexTargetBinding,
  applyCodexTargetUnbinding,
  closeCodexConversationRecord,
  codexAttentionId,
  codexBoundTargetDetail,
  codexBoundTargetLabel,
  codexConversationTitle,
  codexStatusLabelKey,
  codexTargetContextFromPanel,
  codexTargetTitle,
  createCodexConversationRecord,
  currentBoundCodexTarget,
  markCodexPendingTargetDelivered,
  markCodexTargetSyncFailed,
  prepareCodexPendingTargetContext,
  prepareCodexTargetSync,
  resetCodexConversationForRestart,
  terminalSettingsSignature
} from '@/services/ai/aiPanelCodexRuntime'
import type { TerminalPanel } from '@/services/terminal/terminalPanelRuntime'
import type { TerminalSettings } from '@/services/settings/workspaceConfigRuntime'
import type { CodexSessionTargetContext } from '@shared/contracts/codexSessions'

const localPanel: TerminalPanel = {
  id: 'panel-local',
  title: 'Local shell',
  cwd: '/repo',
  output: '',
  outputSegments: [],
  status: 'ready',
  kind: 'terminal',
  sessionId: 'terminal-local'
}

const sshPanel: TerminalPanel = {
  ...localPanel,
  id: 'panel-ssh',
  title: 'prod',
  cwd: '/srv/app',
  sessionId: 'terminal-ssh',
  sshSession: {
    connectionId: 'conn-1',
    host: '10.0.0.8',
    port: 22,
    username: 'ops',
    assetId: 'asset-1',
    assetName: 'Production'
  }
}

describe('aiPanelCodexRuntime', () => {
  it('projects terminal panels and bound targets into Codex target context', () => {
    expect(codexTargetContextFromPanel(localPanel)).toEqual({
      kind: 'local',
      panelId: 'panel-local',
      sessionId: 'terminal-local',
      label: 'Local shell',
      cwd: '/repo'
    })
    expect(codexTargetContextFromPanel(sshPanel)).toEqual({
      kind: 'ssh',
      panelId: 'panel-ssh',
      sessionId: 'terminal-ssh',
      label: 'Production',
      host: '10.0.0.8',
      port: 22,
      username: 'ops',
      assetId: 'asset-1',
      assetName: 'Production',
      cwd: '/srv/app'
    })

    const staleTarget: CodexSessionTargetContext = { kind: 'ssh', panelId: 'missing', sessionId: 'old-session', label: 'old host' }
    expect(currentBoundCodexTarget({ boundTarget: staleTarget }, [localPanel])).toBe(staleTarget)
    expect(currentBoundCodexTarget({ boundTarget: { panelId: 'panel-ssh', sessionId: 'terminal-ssh' } }, [sshPanel])).toEqual(
      expect.objectContaining({ kind: 'ssh', host: '10.0.0.8' })
    )
  })

  it('creates and mutates Codex conversation state without owning xterm side effects', () => {
    const target = codexTargetContextFromPanel(sshPanel)
    const conversation = createCodexConversationRecord('codex-1', target)
    expect(conversation).toMatchObject({
      id: 'codex-1',
      title: 'Production',
      status: 'idle',
      boundTarget: target
    })
    expect(codexTargetTitle(target)).toBe('Production')
    expect(codexConversationTitle({ title: '', boundTarget: target })).toBe('Production')
    expect(codexAttentionId(conversation)).toBe('codex:codex-1')
    expect(codexStatusLabelKey('ready')).toBe('ready')
    expect(codexBoundTargetLabel(target, 'Unbound')).toBe('Production')
    expect(codexBoundTargetDetail(target, 'Drop a target')).toBe('ops@10.0.0.8:22 · /srv/app')

    applyCodexLifecycleEvent(conversation, { stage: 'starting' }, 'Codex failed')
    expect(conversation.status).toBe('starting')
    applyCodexLifecycleEvent(conversation, { stage: 'ready' }, 'Codex failed')
    expect(conversation).toMatchObject({ status: 'ready', error: '' })
    applyCodexLifecycleEvent(conversation, { stage: 'error', errorMessage: 'bridge failed' }, 'Codex failed')
    expect(conversation).toMatchObject({ status: 'error', error: 'bridge failed' })
    applyCodexExitEvent(conversation, { errorCode: undefined, errorMessage: undefined })
    expect(conversation.status).toBe('closed')
    applyCodexSessionStarted(conversation, { id: 'session-1', lifecycle: { id: 'session-1', stage: 'ready', at: 1 } }, target)
    expect(conversation).toMatchObject({ sessionId: 'session-1', status: 'ready', pendingTargetSignature: '' })
    resetCodexConversationForRestart(conversation)
    expect(conversation).toMatchObject({ sessionId: '', status: 'idle', error: '', lastTargetSignature: '' })
  })

  it('prepares target sync and pending target context delivery', () => {
    const target = codexTargetContextFromPanel(sshPanel)
    const conversation = createCodexConversationRecord('codex-1', target)
    expect(prepareCodexTargetSync(conversation, target)).toBeNull()
    conversation.startPromise = Promise.resolve()
    const sync = prepareCodexTargetSync(conversation, target)
    expect(sync?.target).toEqual(target)
    expect(prepareCodexTargetSync(conversation, target)).toBeNull()
    markCodexTargetSyncFailed(conversation)
    expect(conversation.lastTargetSignature).toBe('')

    const unchanged = prepareCodexPendingTargetContext(conversation, 'bound', target)
    expect(unchanged.clear).toBe(false)
    expect(unchanged.text).toContain('[aiopsterm target bound]')
    expect(conversation.pendingTargetContextActive).toBe(true)
    expect(markCodexPendingTargetDelivered(conversation)).toBe(true)
    expect(conversation.deliveredTargetSignature).toBe(conversation.pendingTargetSignature)

    const duplicate = prepareCodexPendingTargetContext(conversation, 'bound', target)
    expect(duplicate).toEqual({ text: '', clear: true })
    expect(conversation.pendingTargetContextActive).toBe(false)
  })

  it('binds, unbinds, closes, and signs Codex runtime state', () => {
    const localTarget = codexTargetContextFromPanel(localPanel)
    const target = codexTargetContextFromPanel(sshPanel)
    const conversation = createCodexConversationRecord('codex-1', localTarget)
    const previous = applyCodexTargetBinding(conversation, target)
    expect(previous).toEqual(localTarget)
    expect(conversation).toMatchObject({ title: 'Production', boundTarget: target, lastTargetSignature: '' })
    expect(applyCodexTargetUnbinding(conversation, 'Codex CLI')).toEqual(target)
    expect(conversation).toMatchObject({ title: 'Codex CLI', boundTarget: null })

    expect(closeCodexConversationRecord([{ id: 'one' }], 'one', 'one')).toEqual(
      expect.objectContaining({ status: 'keep-one', nextActiveId: 'one' })
    )
    expect(closeCodexConversationRecord([{ id: 'one' }, { id: 'two' }, { id: 'three' }], 'two', 'two')).toEqual({
      status: 'closed-active',
      conversation: { id: 'two' },
      nextConversation: { id: 'three' },
      nextConversations: [{ id: 'one' }, { id: 'three' }],
      nextActiveId: 'three'
    })

    const settings: TerminalSettings = {
      terminalType: 'xterm-256color',
      fontFamily: 'JetBrains Mono',
      fontSize: 13,
      scrollBack: 1000,
      cursorStyle: 'block',
      cursorBlink: true,
      lineHeight: 1.2,
      pinchZoomStatus: false,
      showCloseButton: true,
      sshAgentsStatus: false,
      middleMouseEvent: 'none',
      rightMouseEvent: 'contextMenu'
    }
    expect(terminalSettingsSignature(settings)).toBe('xterm-256color|JetBrains Mono|13|1.2|true|block|1000')
  })
})
