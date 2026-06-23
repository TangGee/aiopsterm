import type { QuickCommandGroupConfig, QuickCommandSnippetConfig, QuickCommandsUserConfig } from '@shared/contracts/quickCommands'
import {
  MACRO_MAX_COMMAND_COUNT,
  MACRO_MAX_RECORDING_DURATION_MS,
  createMacroSnippetName,
  parseMacroTerminalInput,
  type MacroCommandEntry
} from '@/services/terminal/terminalMacroRuntime'

export type SnippetGroup = QuickCommandGroupConfig
export type QuickCommandSnippet = QuickCommandSnippetConfig

export type QuickCommandsStateSnapshot = {
  groups: SnippetGroup[]
  snippets: QuickCommandSnippet[]
}

export type MacroRecordingState = {
  isRecording: boolean
  terminalId: string | null
  commandBuffer: MacroCommandEntry[]
  currentLineBuffer: string
  recordingStartTime: number | null
  defaultName: string
  targetGroupUuid: string | null
  limitReason: 'time' | 'count' | null
}

export const createEmptyMacroRecordingState = (): MacroRecordingState => ({
  isRecording: false,
  terminalId: null,
  commandBuffer: [],
  currentLineBuffer: '',
  recordingStartTime: null,
  defaultName: '',
  targetGroupUuid: null,
  limitReason: null
})

export const resetMacroRecordingState = (limitReason: MacroRecordingState['limitReason'] = null): MacroRecordingState => ({
  ...createEmptyMacroRecordingState(),
  limitReason
})

export const cloneMacroRecordingState = (state: MacroRecordingState): MacroRecordingState => ({
  ...state,
  commandBuffer: state.commandBuffer.map((entry) => ({ ...entry }))
})

export const cloneQuickCommandsSnapshot = (snapshot: QuickCommandsUserConfig): QuickCommandsStateSnapshot => ({
  groups: snapshot.groups.map((group) => ({ ...group })),
  snippets: snapshot.snippets.map((snippet) => ({ ...snippet }))
})

export const filteredQuickCommands = (
  snippets: QuickCommandSnippet[],
  query: string,
  selectedGroupUuid: string | null
) => {
  const normalizedQuery = query.trim().toLowerCase()
  if (normalizedQuery) {
    return snippets.filter(
      (command) => command.snippet_name.toLowerCase().includes(normalizedQuery) || command.snippet_content.toLowerCase().includes(normalizedQuery)
    )
  }
  if (selectedGroupUuid) return snippets.filter((command) => command.group_uuid === selectedGroupUuid)
  return snippets.filter((command) => !command.group_uuid)
}

export const currentSnippetGroupName = (groups: SnippetGroup[], selectedGroupUuid: string | null) =>
  groups.find((group) => group.uuid === selectedGroupUuid)?.group_name || ''

export const selectedGroupAfterDelete = (selectedGroupUuid: string | null, deletedGroupUuid: string) =>
  selectedGroupUuid === deletedGroupUuid ? null : selectedGroupUuid

export const reorderQuickCommandPlan = (
  commands: QuickCommandSnippet[],
  sourceId: number,
  targetId: number,
  groupUuid: string | null
) => {
  const currentList = [...commands]
  const sourceIndex = currentList.findIndex((command) => command.id === sourceId)
  const targetIndex = currentList.findIndex((command) => command.id === targetId)
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return null
  const [moved] = currentList.splice(sourceIndex, 1)
  currentList.splice(targetIndex, 0, moved)
  return {
    orderedIds: currentList.map((command) => command.id),
    groupUuid
  }
}

export const startMacroRecordingState = (input: {
  terminalId: string | null
  selectedGroupUuid: string | null
  timestamp?: number
}): MacroRecordingState => ({
  isRecording: true,
  terminalId: input.terminalId,
  commandBuffer: [],
  currentLineBuffer: '',
  recordingStartTime: input.timestamp ?? Date.now(),
  defaultName: createMacroSnippetName(),
  targetGroupUuid: input.selectedGroupUuid,
  limitReason: null
})

export const recordedMacroCommands = (state: Pick<MacroRecordingState, 'commandBuffer'>) => state.commandBuffer.map((entry) => entry.command)

export const macroSaveDraft = (state: MacroRecordingState, sleepThresholdMs: number) => ({
  entries: state.commandBuffer.map((entry) => ({ ...entry })),
  snippetName: state.defaultName || createMacroSnippetName(),
  groupUuid: state.targetGroupUuid,
  sleepThresholdMs
})

export const commitMacroCurrentLine = (
  state: MacroRecordingState,
  timestamp = Date.now()
): { state: MacroRecordingState; added: boolean; limitReached: boolean } => {
  if (!state.currentLineBuffer.length) return { state, added: true, limitReached: false }
  const command = state.currentLineBuffer
  return addMacroCommandEntry({ ...state, currentLineBuffer: '' }, command, timestamp)
}

export const addMacroCommandEntry = (
  state: MacroRecordingState,
  command: string,
  timestamp = Date.now()
): { state: MacroRecordingState; added: boolean; limitReached: boolean } => {
  if (!state.isRecording) return { state, added: false, limitReached: false }
  if (state.commandBuffer.length >= MACRO_MAX_COMMAND_COUNT) {
    return { state: { ...state, limitReason: 'count' }, added: false, limitReached: true }
  }
  const commandBuffer = [...state.commandBuffer, { command, timestamp }]
  const limitReached = commandBuffer.length >= MACRO_MAX_COMMAND_COUNT
  return {
    state: {
      ...state,
      commandBuffer,
      ...(limitReached ? { limitReason: 'count' as const } : {})
    },
    added: true,
    limitReached
  }
}

export const recordMacroCommandText = (
  state: MacroRecordingState,
  command: string,
  timestamp = Date.now()
) => {
  const text = command.trim()
  if (!text) return { state, added: false, limitReached: false }
  return addMacroCommandEntry(state, text, timestamp)
}

export const recordMacroTerminalInputState = (
  state: MacroRecordingState,
  input: { panelId: string; data: string; recordControlKeys: boolean; timestamp?: number }
): { state: MacroRecordingState; limitReached: boolean; shouldAutoStop: false | 'time' | 'count' } => {
  const timestamp = input.timestamp ?? Date.now()
  if (!state.isRecording || !input.data) return { state, limitReached: false, shouldAutoStop: false }
  if (state.terminalId && input.panelId !== state.terminalId) return { state, limitReached: false, shouldAutoStop: false }
  if (state.recordingStartTime && timestamp - state.recordingStartTime >= MACRO_MAX_RECORDING_DURATION_MS) {
    return { state: { ...state, limitReason: 'time' }, limitReached: true, shouldAutoStop: 'time' }
  }

  const parsed = parseMacroTerminalInput(
    {
      lineBuffer: state.currentLineBuffer,
      commands: []
    },
    input.data,
    { recordControlKeys: input.recordControlKeys, timestamp }
  )
  let nextState: MacroRecordingState = { ...state, currentLineBuffer: parsed.lineBuffer }
  for (const entry of parsed.commands) {
    const result = addMacroCommandEntry(nextState, entry.command, entry.timestamp)
    nextState = result.state
    if (result.limitReached) return { state: nextState, limitReached: true, shouldAutoStop: 'count' }
  }
  return { state: nextState, limitReached: false, shouldAutoStop: false }
}
