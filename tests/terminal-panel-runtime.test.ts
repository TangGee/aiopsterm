import { describe, expect, it } from 'vitest'
import {
  appendTerminalSegment,
  attachTerminalPanelToSplit,
  clearTerminalPanelSplitState,
  closeOtherTerminalPanelsInCollection,
  closeTerminalPanelInCollection,
  createEmptyTerminalPanel,
  createForkSshTerminalPanel,
  createTerminalPanelInCollection,
  createTerminalSegments,
  defaultTerminalPanelTitle,
  detachTerminalPanelFromSplit,
  discardPendingTerminalPanelInCollection,
  hasTerminalPanelSplitState,
  isWelcomeTerminalPanelPlaceholder,
  resetTerminalPanelCollectionToDefault,
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

  it('creates panels and nested split groups inside a panel collection', () => {
    const panels = [createEmptyTerminalPanel('panel-main', defaultTerminalPanelTitle)]
    const first = createTerminalPanelInCollection(panels, { id: 'panel-1', activePanelId: 'panel-main' })
    expect(first).toBe(panels[0])
    expect(first).toEqual(expect.objectContaining({ id: 'panel-1', title: 'Terminal 1' }))

    first.cwd = '/srv/app'
    first.sessionId = 'terminal-local-1'
    first.status = 'running'
    const split = createTerminalPanelInCollection(panels, { id: 'panel-2', activePanelId: first.id, split: 'right', splitOrder: 10 })
    expect(panels.map((panel) => panel.id)).toEqual(['panel-1', 'panel-2'])
    expect(first.splitGroupId).toBe('panel-1')
    expect(split).toEqual(
      expect.objectContaining({
        split: 'right',
        splitSourceId: 'panel-1',
        splitGroupId: 'panel-1',
        splitOrder: 10,
        cwd: '/srv/app',
        status: 'connecting'
      })
    )

    const nested = createTerminalPanelInCollection(panels, { id: 'panel-3', activePanelId: split.id, split: 'below', splitOrder: 11 })
    expect(nested.splitSourceId).toBe('panel-2')
    expect(nested.splitGroupId).toBe('panel-1')
    expect(panels.filter((panel) => panel.splitGroupId === 'panel-1')).toHaveLength(3)
  })

  it('detaches and reattaches split panels while preserving valid group topology', () => {
    const panels = [
      { ...createEmptyTerminalPanel('root', 'Root'), splitGroupId: 'root' },
      { ...createEmptyTerminalPanel('right', 'Right'), split: 'right' as const, splitSourceId: 'root', splitGroupId: 'root', splitOrder: 10 },
      { ...createEmptyTerminalPanel('nested', 'Nested'), split: 'below' as const, splitSourceId: 'right', splitGroupId: 'root', splitOrder: 11 }
    ]

    expect(hasTerminalPanelSplitState(panels, 'root')).toBe(true)
    expect(detachTerminalPanelFromSplit(panels, 'right')).toBe(true)
    expect(panels.find((panel) => panel.id === 'right')).toEqual(
      expect.objectContaining({ split: undefined, splitSourceId: undefined, splitGroupId: undefined })
    )
    expect(panels.find((panel) => panel.id === 'nested')).toEqual(
      expect.objectContaining({ splitSourceId: 'root', splitGroupId: 'root' })
    )

    expect(attachTerminalPanelToSplit(panels, 'right', 'root', 'right', 20)).toBe(true)
    expect(panels.map((panel) => panel.id)).toEqual(['root', 'right', 'nested'])
    expect(panels.find((panel) => panel.id === 'right')).toEqual(
      expect.objectContaining({ split: 'right', splitSourceId: 'root', splitGroupId: 'root', splitOrder: 20 })
    )

    expect(detachTerminalPanelFromSplit(panels, 'root')).toBe(true)
    expect(panels.find((panel) => panel.id === 'root')).toEqual(
      expect.objectContaining({ split: undefined, splitSourceId: undefined, splitGroupId: undefined })
    )
    expect(panels.find((panel) => panel.id === 'right')).toEqual(
      expect.objectContaining({ split: undefined, splitSourceId: undefined, splitGroupId: 'root' })
    )
    expect(hasTerminalPanelSplitState(panels, 'root')).toBe(false)
    expect(hasTerminalPanelSplitState(panels, 'right')).toBe(true)
  })

  it('closes and discards panels with active-panel fallback rules', () => {
    const panels = [
      { ...createEmptyTerminalPanel('root', 'Root'), splitGroupId: 'root' },
      { ...createEmptyTerminalPanel('right', 'Right'), split: 'right' as const, splitSourceId: 'root', splitGroupId: 'root', splitOrder: 10 },
      createEmptyTerminalPanel('plain', 'Plain')
    ]

    expect(closeTerminalPanelInCollection(panels, 'right', 'right')).toBe('root')
    expect(panels.map((panel) => panel.id)).toEqual(['root', 'plain'])
    expect(panels[0].splitGroupId).toBeUndefined()

    const pending = createEmptyTerminalPanel('pending', 'Pending')
    panels.push(pending)
    expect(discardPendingTerminalPanelInCollection(panels, 'pending', 'pending', 'plain')).toEqual({
      discarded: true,
      activePanelId: 'plain'
    })
    expect(panels.map((panel) => panel.id)).toEqual(['root', 'plain'])

    panels.push({ ...createEmptyTerminalPanel('busy', 'Busy'), sessionId: 'terminal-busy' })
    expect(discardPendingTerminalPanelInCollection(panels, 'busy', 'busy')).toEqual({
      discarded: false,
      activePanelId: 'busy'
    })

    closeOtherTerminalPanelsInCollection(panels, 'plain')
    expect(panels).toEqual([expect.objectContaining({ id: 'plain', split: undefined, splitGroupId: undefined })])

    expect(resetTerminalPanelCollectionToDefault(panels)).toBe('panel-main')
    expect(panels).toEqual([createEmptyTerminalPanel('panel-main', defaultTerminalPanelTitle)])
  })
})
