import { describe, expect, it, vi } from 'vitest'
import { computed, reactive, ref } from 'vue'
import { createTerminalWorkspaceContextRuntime } from '@/services/terminal/terminalWorkspaceContextRuntime'
import { createEmptyTerminalPanel, type TerminalPanel } from '@/services/terminal/terminalPanelRuntime'
import type { useWorkspaceStore } from '@/stores/workspace'

type WorkspaceStore = ReturnType<typeof useWorkspaceStore>

const t = (key: string) =>
  ({
    'terminal.status.editor': 'Editor',
    'terminal.status.connecting': 'Connecting',
    'terminal.status.error': 'Error',
    'terminal.status.closed': 'Closed',
    'terminal.status.connected': 'Connected',
    'terminal.tab.type': 'Type',
    'terminal.tab.status': 'Status',
    'terminal.tab.host': 'Host',
    'terminal.tab.path': 'Path',
    'terminal.tab.file': 'File',
    'terminal.tab.session': 'Session',
    'terminal.tab.progress': 'Progress',
    'terminal.progress.running': 'Running',
    'terminal.progress.error': 'Error',
    'terminal.progress.indeterminate': 'Working',
    'terminal.progress.paused': 'Paused',
    'terminal.kind.localTerminal': 'Local Terminal',
    'terminal.kind.editor': 'Editor',
    'terminal.kind.local': 'Local'
  })[key] || key

const localPanel = (): TerminalPanel => ({
  ...createEmptyTerminalPanel('panel-local', 'Local shell'),
  cwd: '/srv/app/current',
  sessionId: 'session-local',
  status: 'running'
})

const sshPanel = (): TerminalPanel => ({
  ...createEmptyTerminalPanel('panel-ssh', 'Prod SSH'),
  cwd: '/home/ops',
  sessionId: 'session-ssh',
  status: 'running',
  sshSession: {
    connectionId: 'connection-ssh',
    host: '10.0.0.8',
    port: 2222,
    username: 'ops',
    assetId: 'asset-ssh',
    assetName: 'prod-host',
    assetType: 'server',
    organizationId: 'org-prod',
    authType: 'keyBased',
    createdAt: 1781884800000
  }
})

const knowledgePanel = (): TerminalPanel => ({
  ...createEmptyTerminalPanel('panel-knowledge', 'Runbook'),
  kind: 'knowledge',
  cwd: '/docs',
  status: 'ready',
  knowledge: {
    relPath: 'runbooks/deploy.md',
    isImage: false
  }
})

const createWorkspace = (panels: TerminalPanel[], attentionIds: string[] = []) =>
  reactive({
    panels,
    managedAiSessions: [
      {
        id: 'managed-1',
        source: 'codex',
        title: 'Approve deployment',
        state: 'needsInput',
        panelId: 'panel-ssh',
        terminalSessionId: 'session-ssh'
      },
      {
        id: 'managed-2',
        source: 'codex',
        title: 'Completed task',
        state: 'completed',
        panelId: 'panel-ssh',
        terminalSessionId: 'session-ssh'
      }
    ],
    managedAiSessionNeedsAttentionForPanel: vi.fn((id: string) => attentionIds.includes(id))
  }) as unknown as WorkspaceStore

describe('terminalWorkspaceContextRuntime', () => {
  it('derives terminal tab labels, tooltips, context text, and attention state', () => {
    const panels = [localPanel(), sshPanel(), knowledgePanel()]
    const activePanelId = ref('panel-ssh')
    const workspace = createWorkspace(panels, ['session-ssh'])
    const runtime = createTerminalWorkspaceContextRuntime({
      workspace,
      activeTerminalPanel: computed(() => panels.find((panel) => panel.id === activePanelId.value)),
      isWelcomePlaceholderPanel: (panel) => panel?.id === 'panel-main' && panel.title === '欢迎',
      t
    })

    expect(runtime.terminalStatusLabel({ ...panels[0], status: 'closed' })).toBe('Closed')
    expect(runtime.terminalTabMeta(panels[0])).toBe('current')

    expect(runtime.terminalTabMeta(panels[1])).toBe('ops@10.0.0.8:2222')
    expect(runtime.terminalTabShowsState(panels[1])).toBe(false)
    expect(runtime.terminalTabTooltip(panels[1])).toContain('Host: ops@10.0.0.8:2222')
    expect(runtime.terminalTabTooltip(panels[1])).toContain('Session: session-ssh')

    panels[1].terminalProgress = { status: 'running', value: 58, updatedAt: 1 }
    expect(runtime.terminalTabShowsState(panels[1])).toBe(true)
    expect(runtime.terminalTabStateClass(panels[1])).toBe('progress-running')
    expect(runtime.terminalTabStateLabel(panels[1])).toBe('Running 58%')
    expect(runtime.terminalTabProgressStyle(panels[1])).toEqual({ '--terminal-tab-progress': '58%' })
    expect(runtime.terminalTabTooltip(panels[1])).toContain('Progress: Running 58%')

    expect(runtime.terminalTabMeta(panels[2])).toBe('runbooks/deploy.md')
    expect(runtime.terminalStatusLabel(panels[2])).toBe('Editor')

    expect(runtime.pendingAiSessionsForPanel(panels[1]).map((session) => session.title)).toEqual(['Approve deployment'])
    expect(runtime.terminalContextText(panels[1])).toContain('Pending AI: codex/Approve deployment')
    expect(runtime.panelNeedsAiAttention(panels[1])).toBe(true)

    expect(runtime.activeTerminalContextBar.value).toMatchObject({
      title: 'Prod SSH',
      kindLabel: 'SSH',
      statusLabel: 'Connected',
      target: 'ops@10.0.0.8:2222',
      path: '/home/ops',
      pendingAiCount: 1,
      focusable: true
    })

    activePanelId.value = 'panel-knowledge'
    expect(runtime.activeTerminalContextBar.value).toMatchObject({
      title: 'Runbook',
      kindLabel: 'Editor',
      statusLabel: 'Editor',
      path: 'runbooks/deploy.md',
      focusable: false
    })
  })

  it('hides the context bar for welcome placeholder panels', () => {
    const welcome = createEmptyTerminalPanel('panel-main', '欢迎')
    const workspace = createWorkspace([welcome])
    const runtime = createTerminalWorkspaceContextRuntime({
      workspace,
      activeTerminalPanel: computed(() => welcome),
      isWelcomePlaceholderPanel: (panel) => panel === welcome,
      t
    })

    expect(runtime.activeTerminalContextBar.value).toBeNull()
  })
})
