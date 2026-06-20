import { describe, expect, it } from 'vitest'
import {
  addMacroCommandEntry,
  cloneMacroRecordingState,
  cloneQuickCommandsSnapshot,
  commitMacroCurrentLine,
  createEmptyMacroRecordingState,
  currentSnippetGroupName,
  filteredQuickCommands,
  macroSaveDraft,
  recordedMacroCommands,
  recordMacroCommandText,
  recordMacroTerminalInputState,
  reorderQuickCommandPlan,
  resetMacroRecordingState,
  selectedGroupAfterDelete,
  startMacroRecordingState,
  type QuickCommandSnippet,
  type SnippetGroup
} from '@/services/quickCommandsRuntime'
import { MACRO_MAX_COMMAND_COUNT, MACRO_MAX_RECORDING_DURATION_MS } from '@/services/terminalMacroRuntime'

const groups: SnippetGroup[] = [
  { id: 1, uuid: 'group-a', group_name: 'Group A' },
  { id: 2, uuid: 'group-b', group_name: 'Group B' }
]

const snippets: QuickCommandSnippet[] = [
  { id: 1, uuid: 'cmd-1', snippet_name: 'Disk Check', snippet_content: 'df -h', group_uuid: null },
  { id: 2, uuid: 'cmd-2', snippet_name: 'Pod Logs', snippet_content: 'kubectl logs app', group_uuid: 'group-a' },
  { id: 3, uuid: 'cmd-3', snippet_name: 'Restart Service', snippet_content: 'systemctl restart app', group_uuid: 'group-a' },
  { id: 4, uuid: 'cmd-4', snippet_name: 'Network', snippet_content: 'ss -lntp', group_uuid: 'group-b' }
]

describe('quickCommandsRuntime', () => {
  it('clones quick command and macro snapshots without aliasing caller-owned arrays', () => {
    const snapshot = cloneQuickCommandsSnapshot({ groups, snippets })
    snapshot.groups[0].group_name = 'Changed'
    snapshot.snippets[0].snippet_name = 'Changed Command'

    expect(groups[0].group_name).toBe('Group A')
    expect(snippets[0].snippet_name).toBe('Disk Check')

    const macro = startMacroRecordingState({ terminalId: 'panel-a', selectedGroupUuid: 'group-a', timestamp: 1000 })
    const withEntry = addMacroCommandEntry(macro, 'uptime', 1100).state
    const cloned = cloneMacroRecordingState(withEntry)
    cloned.commandBuffer[0].command = 'mutated'

    expect(withEntry.commandBuffer[0].command).toBe('uptime')
  })

  it('filters commands by search text, selected group, or ungrouped root state', () => {
    expect(filteredQuickCommands(snippets, 'logs', null).map((item) => item.id)).toEqual([2])
    expect(filteredQuickCommands(snippets, 'SYSTEMCTL', null).map((item) => item.id)).toEqual([3])
    expect(filteredQuickCommands(snippets, '', 'group-a').map((item) => item.id)).toEqual([2, 3])
    expect(filteredQuickCommands(snippets, '', null).map((item) => item.id)).toEqual([1])
  })

  it('resolves selected group names, delete selection state, and reorder plans', () => {
    expect(currentSnippetGroupName(groups, 'group-b')).toBe('Group B')
    expect(currentSnippetGroupName(groups, 'missing')).toBe('')
    expect(selectedGroupAfterDelete('group-a', 'group-a')).toBeNull()
    expect(selectedGroupAfterDelete('group-b', 'group-a')).toBe('group-b')

    expect(reorderQuickCommandPlan(snippets.slice(1, 3), 3, 2, 'group-a')).toEqual({
      orderedIds: [3, 2],
      groupUuid: 'group-a'
    })
    expect(reorderQuickCommandPlan(snippets.slice(1, 3), 2, 2, 'group-a')).toBeNull()
    expect(reorderQuickCommandPlan(snippets.slice(1, 3), 1, 2, 'group-a')).toBeNull()
  })

  it('starts, records, commits, and drafts macro recording state', () => {
    const started = startMacroRecordingState({ terminalId: 'panel-a', selectedGroupUuid: 'group-a', timestamp: 1000 })
    expect(started).toMatchObject({
      isRecording: true,
      terminalId: 'panel-a',
      recordingStartTime: 1000,
      targetGroupUuid: 'group-a',
      limitReason: null
    })
    expect(started.defaultName).toMatch(/^macro-\d{8}-\d{6}$/)

    const blank = recordMacroCommandText(started, '   ', 1100)
    expect(blank.added).toBe(false)
    expect(blank.state.commandBuffer).toEqual([])

    const direct = recordMacroCommandText(started, '  uptime  ', 1200)
    expect(direct.added).toBe(true)
    expect(recordedMacroCommands(direct.state)).toEqual(['uptime'])

    const withLine = { ...direct.state, currentLineBuffer: 'whoami' }
    const committed = commitMacroCurrentLine(withLine, 1300)
    expect(committed.state.currentLineBuffer).toBe('')
    expect(committed.state.commandBuffer).toEqual([
      { command: 'uptime', timestamp: 1200 },
      { command: 'whoami', timestamp: 1300 }
    ])

    const draft = macroSaveDraft(committed.state, 400)
    expect(draft).toEqual({
      entries: [
        { command: 'uptime', timestamp: 1200 },
        { command: 'whoami', timestamp: 1300 }
      ],
      snippetName: started.defaultName,
      groupUuid: 'group-a',
      sleepThresholdMs: 400
    })
    draft.entries[0].command = 'mutated'
    expect(committed.state.commandBuffer[0].command).toBe('uptime')
  })

  it('records terminal input for the target panel and reports time or count auto-stop reasons', () => {
    const started = startMacroRecordingState({ terminalId: 'panel-a', selectedGroupUuid: null, timestamp: 1000 })

    const staged = recordMacroTerminalInputState(started, {
      panelId: 'panel-a',
      data: 'date',
      recordControlKeys: true,
      timestamp: 1100
    })
    expect(staged.state.currentLineBuffer).toBe('date')
    expect(staged.shouldAutoStop).toBe(false)

    const committed = recordMacroTerminalInputState(staged.state, {
      panelId: 'panel-a',
      data: '\be\n\x1b[A',
      recordControlKeys: true,
      timestamp: 1200
    })
    expect(committed.state.currentLineBuffer).toBe('')
    expect(committed.state.commandBuffer).toEqual([
      { command: 'date', timestamp: 1200 },
      { command: 'up', timestamp: 1200 }
    ])

    const ignored = recordMacroTerminalInputState(committed.state, {
      panelId: 'other-panel',
      data: 'ignored\n',
      recordControlKeys: true,
      timestamp: 1300
    })
    expect(ignored.state.commandBuffer).toEqual(committed.state.commandBuffer)

    const timedOut = recordMacroTerminalInputState(started, {
      panelId: 'panel-a',
      data: 'late\n',
      recordControlKeys: true,
      timestamp: 1000 + MACRO_MAX_RECORDING_DURATION_MS
    })
    expect(timedOut.shouldAutoStop).toBe('time')
    expect(timedOut.state.limitReason).toBe('time')

    let state = started
    for (let index = 0; index < MACRO_MAX_COMMAND_COUNT - 1; index += 1) {
      state = addMacroCommandEntry(state, `cmd-${index}`, 2000 + index).state
    }
    const countedOut = recordMacroTerminalInputState(state, {
      panelId: 'panel-a',
      data: 'last\nextra\n',
      recordControlKeys: true,
      timestamp: 3000
    })
    expect(countedOut.shouldAutoStop).toBe('count')
    expect(countedOut.state.limitReason).toBe('count')
    expect(countedOut.state.commandBuffer).toHaveLength(MACRO_MAX_COMMAND_COUNT)
  })

  it('resets macro recording while preserving the last limit reason for UI feedback', () => {
    expect(createEmptyMacroRecordingState()).toMatchObject({
      isRecording: false,
      terminalId: null,
      commandBuffer: [],
      currentLineBuffer: '',
      limitReason: null
    })
    expect(resetMacroRecordingState('count')).toMatchObject({
      isRecording: false,
      terminalId: null,
      commandBuffer: [],
      currentLineBuffer: '',
      limitReason: 'count'
    })
  })
})
