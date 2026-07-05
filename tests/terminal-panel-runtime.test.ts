import { describe, expect, it } from 'vitest'
import {
  appendGeneratedTerminalCommandToPanel,
  appendTerminalInputToPanelInCollection,
  appendTerminalOutputToPanelInCollection,
  applyLocalTerminalSessionToPanel,
  applySshTerminalSessionToPanel,
  applyTerminalExitToPanel,
  applyTerminalInputExecutionToPanels,
  applyTerminalLifecycleToPanel,
  appendTerminalSegment,
  attachTerminalPanelToSplit,
  canForkSshTerminalPanel,
  canWriteTerminalPanels,
  clearTerminalPanelSplitState,
  closeOtherTerminalPanelsInCollection,
  closeTerminalPanelInCollection,
  collectTerminalInputExecutionRecords,
  createEmptyTerminalPanel,
  createForkSshTerminalPanel,
  createForkSshTerminalPanelInCollection,
  createTerminalPanelInCollection,
  createTerminalSegments,
  defaultTerminalPanelTitle,
  detachTerminalPanelFromSplit,
  discardPendingTerminalPanelInCollection,
  ensureTerminalPanelOutputSegments,
  findTerminalPanelByIdOrSession,
  findTerminalPanelBySessionOrId,
  hasTerminalPanelSplitState,
  isWelcomeTerminalPanelPlaceholder,
  liveTerminalPanelIds,
  renameTerminalPanelInCollection,
  registerTerminalSshSession,
  replaceTerminalOutputInPanelCollection,
  resolveActiveWritableTerminalPanel,
  resolveTerminalPanelSessionWrite,
  resolveTerminalPanelSessionWrites,
  resetTerminalPanelCollectionToDefault,
  resetTerminalPanelToDefault,
  setTerminalOutput,
  setTerminalPanelAutoTitleInCollection,
  setTerminalPanelProgressInCollection,
  terminalLifecycleMatchesPanel,
  terminalPanelIds,
  trimTerminalPanelOutputHistory,
  type TerminalPanel
} from '@/services/terminal/terminalPanelRuntime'

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

  it('trims terminal output history by lines while preserving segment scopes', () => {
    const panel = createEmptyTerminalPanel('panel-1', 'Terminal 1')
    appendTerminalSegment(panel, 'input-1\ninput-2\n', 'input')
    appendTerminalSegment(panel, 'output-1\noutput-2\noutput-3\n', 'output')

    expect(trimTerminalPanelOutputHistory(panel, 3, 0)).toBe(true)
    expect(panel.output).toBe('output-1\noutput-2\noutput-3\n')
    expect(panel.outputSegments).toEqual([{ text: 'output-1\noutput-2\noutput-3\n', scope: 'output' }])

    expect(trimTerminalPanelOutputHistory(panel, 10, 0)).toBe(false)
    expect(panel.output).toBe('output-1\noutput-2\noutput-3\n')
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

  it('tracks terminal program progress and clears it when a panel is reset or exits', () => {
    const panel = createEmptyTerminalPanel('panel-1', 'Terminal 1')
    panel.sessionId = 'terminal-1'
    setTerminalPanelProgressInCollection([panel], panel.id, { status: 'running', value: 25, updatedAt: 1 })
    expect(panel.terminalProgress).toEqual({ status: 'running', value: 25, updatedAt: 1 })

    applyTerminalExitToPanel(panel, { id: 'terminal-1', kind: 'local', code: 0, reason: 'process' })
    expect(panel.terminalProgress).toBeUndefined()

    setTerminalPanelProgressInCollection([panel], panel.id, { status: 'paused', updatedAt: 2 })
    resetTerminalPanelToDefault(panel)
    expect(panel.terminalProgress).toBeUndefined()
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
        title: 'prod-host',
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

  it('updates terminal panel collection titles, fork state, and active writable resolution', () => {
    const source = sshSourcePanel()
    const knowledge: TerminalPanel = {
      id: 'kb:readme',
      title: 'README.md',
      cwd: '@knowledgebase',
      output: '',
      outputSegments: [],
      status: 'ready',
      kind: 'knowledge',
      knowledge: { relPath: 'README.md', isImage: false }
    }
    const panels = [knowledge, source, createEmptyTerminalPanel('plain', 'Plain')]

    expect(resolveActiveWritableTerminalPanel(panels, knowledge)).toBe(source)
    expect(renameTerminalPanelInCollection(panels, source.id, '  Prod API  ', 'user')).toBe(source)
    expect(source).toEqual(expect.objectContaining({ title: 'Prod API', titleSource: 'user' }))
    expect(setTerminalPanelAutoTitleInCollection(panels, source.id, 'Auto title')).toEqual({ found: true, applied: false, userOwned: true })

    source.titleSource = 'system'
    expect(setTerminalPanelAutoTitleInCollection(panels, source.id, 'Auto title')).toEqual({ found: true, applied: true, userOwned: false })
    expect(source.title).toBe('Auto title')
    expect(canForkSshTerminalPanel(source)).toBe(true)

    const fork = createForkSshTerminalPanelInCollection(panels, source.id, 'forked-panel')
    expect(fork).toEqual(expect.objectContaining({ id: 'forked-panel', title: 'prod-host' }))
    expect(panels.at(-1)).toBe(fork)
    expect(createForkSshTerminalPanelInCollection(panels, 'plain', 'forked-plain')).toBeNull()
    expect(terminalPanelIds(panels)).toEqual(['panel-source', 'plain', 'forked-panel'])
  })

  it('applies collection-level terminal IO, input records, and writable session resolution', () => {
    const local = createEmptyTerminalPanel('panel-local', 'Local')
    local.sessionId = 'terminal-local'
    const ssh = sshSourcePanel()
    const knowledge: TerminalPanel = {
      id: 'kb:notes',
      title: 'Notes',
      cwd: '@knowledgebase',
      output: '',
      outputSegments: [],
      status: 'ready',
      kind: 'knowledge',
      knowledge: { relPath: 'notes.md', isImage: false }
    }
    const panels = [local, ssh, knowledge]

    expect(findTerminalPanelByIdOrSession(panels, 'terminal-local')).toBe(local)
    expect(appendTerminalOutputToPanelInCollection(panels, 'terminal-local', 'ready\n')).toBe(local)
    expect(local).toEqual(expect.objectContaining({ output: 'ready\n', status: 'running' }))
    expect(appendTerminalInputToPanelInCollection(panels, 'panel-local', 'pwd\n')).toBe(local)
    expect(local.outputSegments.at(-1)).toEqual({ text: 'pwd\n', scope: 'input' })

    local.outputSegments = []
    expect(ensureTerminalPanelOutputSegments(local)).toEqual([{ text: 'ready\npwd\n', scope: 'output' }])
    expect(replaceTerminalOutputInPanelCollection(panels, 'terminal-local', 'fresh\n', 'input')).toBe(local)
    expect(local.outputSegments).toEqual([{ text: 'fresh\n', scope: 'input' }])

    const records = applyTerminalInputExecutionToPanels(panels, {
      panelIds: ['panel-local', 'terminal-ssh-1', 'missing-panel'],
      inputText: 'ls\n',
      shellText: 'ls -la\n',
      source: 'direct',
      writeToShell: false
    })
    expect(records.map(({ panel, text }) => [panel.id, text])).toEqual([
      ['panel-local', 'ls -la\n'],
      ['panel-source', 'ls -la\n']
    ])
    expect(local.output).toContain('ls\n')
    expect(ssh.output).toContain('ls\n')

    expect(
      collectTerminalInputExecutionRecords(panels, {
        panelIds: ['panel-local', 'terminal-ssh-1'],
        inputText: 'echo hidden\n',
        source: 'snippet',
        writeToShell: true
      })
    ).toEqual([])
    expect(resolveTerminalPanelSessionWrites(panels, ['panel-local', 'terminal-ssh-1'])?.map((write) => write.sessionId)).toEqual([
      'terminal-local',
      'terminal-ssh-1'
    ])
    expect(resolveTerminalPanelSessionWrite(panels, 'terminal-local')).toEqual({ panel: local, sessionId: 'terminal-local' })
    expect(resolveTerminalPanelSessionWrites(panels, ['panel-local', 'missing'])).toBeNull()
    expect(canWriteTerminalPanels(panels, { panelIds: ['panel-local', 'terminal-ssh-1'], writeToShell: true })).toBe(true)
    expect(canWriteTerminalPanels(panels, { panelIds: ['missing'], writeToShell: true })).toBe(false)
    expect(liveTerminalPanelIds(panels)).toEqual(['panel-local', 'panel-source'])

    const generated = appendGeneratedTerminalCommandToPanel(panels, 'terminal-local', '  whoami  ')
    expect(generated).toEqual({ panel: local, text: 'whoami' })
    expect(local.outputSegments.at(-1)).toEqual({ text: 'whoami', scope: 'input' })
    expect(appendGeneratedTerminalCommandToPanel(panels, knowledge.id, 'cat README.md')).toBeNull()
  })

  it('applies local and SSH terminal sessions to panel state', () => {
    const local = createEmptyTerminalPanel('panel-local', 'Welcome')
    expect(
      applyLocalTerminalSessionToPanel(local, {
        id: 'terminal-local-1',
        shell: '/bin/zsh',
        cwd: '/work',
        kind: 'local'
      })
    ).toBe(local)
    expect(local).toEqual(
      expect.objectContaining({
        sessionId: 'terminal-local-1',
        title: 'zsh',
        cwd: '/work',
        kind: 'terminal',
        status: 'running',
        sshSession: undefined
      })
    )

    const ssh = createEmptyTerminalPanel('panel-ssh', 'SSH')
    registerTerminalSshSession(ssh, {
      id: 'asset-1',
      name: 'prod-host',
      host: '10.0.0.5',
      port: 2222,
      username: 'ops',
      group_name: 'prod',
      asset_type: 'server',
      auth_type: 'key',
      needProxy: true,
      proxyName: 'corp-proxy',
      jumpHostId: 'jump-1'
    })
    const applied = applySshTerminalSessionToPanel(
      ssh,
      {
        id: 'terminal-ssh-1',
        shell: 'ssh',
        cwd: '/home/ops',
        kind: 'ssh',
        connection: {
          connectionId: 'ssh-connection-1',
          forkFromConnectionId: 'ssh-parent',
          host: '10.0.0.5',
          port: 2222,
          username: 'ops',
          assetId: 'asset-1',
          assetName: 'prod-host',
          assetType: 'server',
          organizationId: 'prod',
          authType: 'key',
          needProxy: true,
          proxyName: 'corp-proxy',
          createdAt: 1781884800000
        }
      },
      { jumpHostId: 'jump-1' }
    )
    expect(applied).toEqual(
      expect.objectContaining({
        connectionId: 'ssh-connection-1',
        forkFromConnectionId: 'ssh-parent',
        host: '10.0.0.5',
        assetName: 'prod-host',
        jumpHostId: 'jump-1',
        proxyName: 'corp-proxy'
      })
    )
    expect(ssh).toEqual(expect.objectContaining({ sessionId: 'terminal-ssh-1', cwd: '/home/ops', title: 'prod-host', status: 'connecting' }))
  })

  it('applies terminal lifecycle events with kind and SSH endpoint safeguards', () => {
    const panel = createEmptyTerminalPanel('panel-life', 'Life')
    applyLocalTerminalSessionToPanel(panel, {
      id: 'terminal-life-local',
      shell: '/bin/bash',
      cwd: '/home/unit',
      kind: 'local'
    })
    expect(terminalLifecycleMatchesPanel(panel, { id: 'terminal-life-local', kind: 'local', stage: 'shell-ready', at: 1 })).toBe(true)
    expect(
      applyTerminalLifecycleToPanel(panel, {
        id: 'terminal-life-local',
        kind: 'local',
        stage: 'shell-ready',
        cwd: '/tmp',
        at: 1781884800000
      })
    ).toBe(panel)
    expect(panel).toEqual(expect.objectContaining({ status: 'running', cwd: '/tmp', sessionId: 'terminal-life-local' }))

    expect(
      applyTerminalLifecycleToPanel(panel, {
        id: 'terminal-life-local',
        kind: 'ssh',
        stage: 'shell-ready',
        connectionId: 'ssh-1',
        host: '10.0.0.5',
        port: 22,
        username: 'root',
        at: 1781884800010
      })
    ).toBeNull()

    expect(
      applyTerminalLifecycleToPanel(panel, {
        id: 'terminal-life-local',
        kind: 'local',
        stage: 'closed',
        code: 0,
        reason: 'manual',
        at: 1781884800020
      })
    ).toBe(panel)
    expect(panel).toEqual(expect.objectContaining({ status: 'closed', sessionId: undefined }))
    expect(panel.terminalExit).toEqual(expect.objectContaining({ id: 'terminal-life-local', code: 0, reason: 'manual' }))

    const ssh = sshSourcePanel()
    ssh.sessionId = 'terminal-life-ssh'
    ssh.terminalLifecycle = undefined
    expect(
      applyTerminalLifecycleToPanel(ssh, {
        id: 'terminal-life-ssh',
        kind: 'ssh',
        stage: 'error',
        connectionId: 'ssh-connection-1',
        host: '10.0.0.5',
        port: 22,
        username: 'root',
        reason: 'network',
        errorCode: 'ECONNRESET',
        errorMessage: 'read ECONNRESET',
        at: 1781884800030
      })
    ).toBe(ssh)
    expect(ssh.status).toBe('error')
    expect(ssh.sessionId).toBeUndefined()
    expect(ssh.sshSession).toEqual(expect.objectContaining({ connectionId: 'ssh-connection-1', assetId: 'asset-1' }))
  })

  it('applies terminal exit events and finds panels by session, panel, or lifecycle id', () => {
    const panel = createEmptyTerminalPanel('panel-exit', 'Exit')
    applyLocalTerminalSessionToPanel(panel, {
      id: 'terminal-exit-1',
      shell: '/bin/bash',
      cwd: '/work',
      kind: 'local'
    })
    const panels = [panel]
    expect(findTerminalPanelBySessionOrId(panels, 'terminal-exit-1')).toBe(panel)
    expect(findTerminalPanelBySessionOrId(panels, 'panel-exit')).toBe(panel)

    expect(applyTerminalExitToPanel(panel, { id: 'terminal-exit-1', kind: 'local', code: 1, reason: 'error', errorMessage: 'boom' })).toBe(panel)
    expect(panel).toEqual(expect.objectContaining({ status: 'error', sessionId: undefined }))
    expect(panel.output).toContain('[process exited: 1]')
    expect(findTerminalPanelBySessionOrId(panels, 'terminal-exit-1')).toBeNull()
    expect(findTerminalPanelBySessionOrId(panels, 'panel-exit')).toBe(panel)
    panel.terminalLifecycle = { id: 'terminal-exit-1', kind: 'local', stage: 'closed', at: 1781884800000 }
    expect(findTerminalPanelBySessionOrId(panels, 'terminal-exit-1')).toBe(panel)

    const sshPanel = sshSourcePanel()
    sshPanel.sessionId = 'terminal-ssh-exit'
    expect(applyTerminalExitToPanel(sshPanel, { id: 'terminal-ssh-exit', kind: 'local', code: 0, reason: 'manual' })).toBeNull()
    expect(sshPanel.sessionId).toBe('terminal-ssh-exit')
  })
})
