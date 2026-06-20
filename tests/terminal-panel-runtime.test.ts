import { describe, expect, it } from 'vitest'
import {
  appendTerminalSegment,
  clearTerminalPanelSplitState,
  createEmptyTerminalPanel,
  createForkSshTerminalPanel,
  createTerminalSegments,
  defaultTerminalPanelTitle,
  isWelcomeTerminalPanelPlaceholder,
  resetTerminalPanelToDefault,
  setTerminalOutput,
  type TerminalPanel
} from '@/services/terminalPanelRuntime'

const sshSourcePanel = (): TerminalPanel => ({
  ...createEmptyTerminalPanel('panel-source', 'Prod shell'),
  titleSource: 'user',
  cwd: '/srv/app',
  status: 'running',
  sessionId: 'terminal-ssh-1',
  splitGroupId: 'panel-source',
  sshSession: {
    connectionId: 'ssh-connection-1',
    host: '10.0.0.5',
    port: 22,
    username: 'root',
    assetId: 'asset-1',
    assetName: 'prod-host',
    assetType: 'server',
    organizationId: 'org-1',
    jumpHostId: 'jump-1',
    authType: 'key',
    needProxy: true,
    proxyName: 'corp-proxy',
    createdAt: 1781884800000
  }
})

describe('terminalPanelRuntime', () => {
  it('creates, appends, and replaces terminal output segments', () => {
    const panel = createEmptyTerminalPanel('panel-1', 'Terminal 1')

    appendTerminalSegment(panel, 'pwd\n', 'input')
    appendTerminalSegment(panel, '/srv/app\n', 'output')
    appendTerminalSegment(panel, '', 'output')

    expect(panel.output).toBe('pwd\n/srv/app\n')
    expect(panel.outputSegments).toEqual([
      { text: 'pwd\n', scope: 'input' },
      { text: '/srv/app\n', scope: 'output' }
    ])
    expect(createTerminalSegments('', 'input')).toEqual([])

    setTerminalOutput(panel, 'fresh output', 'input')
    expect(panel.output).toBe('fresh output')
    expect(panel.outputSegments).toEqual([{ text: 'fresh output', scope: 'input' }])
  })

  it('creates split terminal panels by copying safe source state', () => {
    const source = sshSourcePanel()
    const split = createEmptyTerminalPanel('panel-split', source.title, 'right', source.id, source.splitGroupId, 42, source)

    expect(split).toEqual(
      expect.objectContaining({
        id: 'panel-split',
        title: 'Prod shell',
        titleSource: 'user',
        cwd: '/srv/app',
        status: 'connecting',
        split: 'right',
        splitSourceId: 'panel-source',
        splitGroupId: 'panel-source',
        splitOrder: 42
      })
    )
    expect(split.sshSession).toEqual(
      expect.objectContaining({
        connectionId: undefined,
        sourcePanelId: 'panel-source',
        host: '10.0.0.5',
        port: 22,
        username: 'root',
        assetName: 'prod-host',
        needProxy: true,
        proxyName: 'corp-proxy'
      })
    )
    expect(source.sshSession?.connectionId).toBe('ssh-connection-1')
  })

  it('recognizes and resets the welcome placeholder panel', () => {
    const panel = createEmptyTerminalPanel('panel-main', defaultTerminalPanelTitle)
    expect(isWelcomeTerminalPanelPlaceholder(panel)).toBe(true)

    appendTerminalSegment(panel, 'whoami\n', 'input')
    panel.sessionId = 'terminal-1'
    panel.split = 'below'
    panel.splitGroupId = 'group-1'
    expect(isWelcomeTerminalPanelPlaceholder(panel)).toBe(false)

    resetTerminalPanelToDefault(panel)
    expect(panel).toEqual(createEmptyTerminalPanel('panel-main', defaultTerminalPanelTitle))
    expect(isWelcomeTerminalPanelPlaceholder(panel)).toBe(true)
  })

  it('clears split state and creates SSH fork panels without reusing live connection ids', () => {
    const source = sshSourcePanel()
    source.split = 'below'
    source.splitSourceId = 'panel-main'
    source.splitOrder = 10

    clearTerminalPanelSplitState(source)
    expect(source.split).toBeUndefined()
    expect(source.splitSourceId).toBeUndefined()
    expect(source.splitGroupId).toBeUndefined()
    expect(source.splitOrder).toBeUndefined()

    source.split = 'right'
    const fork = createForkSshTerminalPanel('panel-fork', source)
    expect(fork).toEqual(
      expect.objectContaining({
        id: 'panel-fork',
        title: 'Prod shell fork',
        cwd: '/srv/app',
        kind: 'terminal',
        status: 'ready',
        split: 'right',
        output: '',
        outputSegments: []
      })
    )
    expect(fork?.sshSession).toEqual(
      expect.objectContaining({
        sourcePanelId: 'panel-source',
        forkFromConnectionId: 'ssh-connection-1',
        host: '10.0.0.5',
        assetName: 'prod-host'
      })
    )
    expect(fork?.sshSession?.connectionId).toBeUndefined()

    source.sshSession!.connectionId = undefined
    expect(createForkSshTerminalPanel('panel-fork-2', source)).toBeNull()
  })
})
