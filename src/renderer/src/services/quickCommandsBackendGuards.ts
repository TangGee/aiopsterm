import type {
  QuickCommandGroupConfig,
  QuickCommandGroupDeleteResult,
  QuickCommandGroupMutationResult,
  QuickCommandMacroMutationResult,
  QuickCommandReorderResult,
  QuickCommandScriptPlan,
  QuickCommandSnippetConfig,
  QuickCommandSnippetDeleteResult,
  QuickCommandSnippetMutationResult,
  QuickCommandsUserConfig
} from '@shared/contracts/quickCommands'

export const malformedQuickCommandsBackendResultMessage = '快捷命令服务返回数据无效'

export type QuickCommandGroupMutationData = NonNullable<QuickCommandGroupMutationResult['data']>
export type QuickCommandGroupDeleteData = NonNullable<QuickCommandGroupDeleteResult['data']>
export type QuickCommandSnippetMutationData = NonNullable<QuickCommandSnippetMutationResult['data']>
export type QuickCommandMacroMutationData = NonNullable<QuickCommandMacroMutationResult['data']>
export type QuickCommandSnippetDeleteData = NonNullable<QuickCommandSnippetDeleteResult['data']>
export type QuickCommandReorderData = NonNullable<QuickCommandReorderResult['data']>

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isPositiveInteger = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0
const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const isOptionalString = (value: unknown): value is string | undefined => value === undefined || typeof value === 'string'
const stripTerminalControlSequences = (value: string) =>
  value
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')

const extractShellCommandLines = (shellText: string) =>
  stripTerminalControlSequences(shellText)
    .split(/\r\n|\n|\r/)
    .map((line) => line.trim())
    .filter(Boolean)

export const quickCommandSnippetGroupUuid = (snippet: Pick<QuickCommandSnippetConfig, 'group_uuid'>) => snippet.group_uuid ?? null

export const isQuickCommandGroupData = (value: unknown): value is QuickCommandGroupConfig =>
  isRecord(value) && isPositiveInteger(value.id) && isNonEmptyString(value.uuid) && isNonEmptyString(value.group_name)

export const isQuickCommandSnippetData = (value: unknown): value is QuickCommandSnippetConfig => {
  if (
    !isRecord(value) ||
    !isPositiveInteger(value.id) ||
    !isNonEmptyString(value.uuid) ||
    !isNonEmptyString(value.snippet_name) ||
    typeof value.snippet_content !== 'string' ||
    value.snippet_content.length === 0 ||
    !isOptionalString(value.create_at) ||
    !isOptionalString(value.update_at)
  ) {
    return false
  }
  const groupUuid = value.group_uuid
  return groupUuid === undefined || groupUuid === null || isNonEmptyString(groupUuid)
}

export const isQuickCommandsSnapshotData = (value: unknown): value is QuickCommandsUserConfig => {
  if (!isRecord(value) || !Array.isArray(value.groups) || !Array.isArray(value.snippets)) return false
  if (!value.groups.every(isQuickCommandGroupData) || !value.snippets.every(isQuickCommandSnippetData)) return false

  const groupIds = new Set<number>()
  const groupUuids = new Set<string>()
  for (const group of value.groups) {
    if (groupIds.has(group.id) || groupUuids.has(group.uuid)) return false
    groupIds.add(group.id)
    groupUuids.add(group.uuid)
  }

  const snippetIds = new Set<number>()
  const snippetUuids = new Set<string>()
  for (const snippet of value.snippets) {
    if (snippetIds.has(snippet.id) || snippetUuids.has(snippet.uuid)) return false
    if (snippet.group_uuid && !groupUuids.has(snippet.group_uuid)) return false
    snippetIds.add(snippet.id)
    snippetUuids.add(snippet.uuid)
  }

  return true
}

const quickCommandGroupsMatch = (left: QuickCommandGroupConfig, right: QuickCommandGroupConfig) =>
  left.id === right.id && left.uuid === right.uuid && left.group_name === right.group_name

const quickCommandSnippetsMatch = (left: QuickCommandSnippetConfig, right: QuickCommandSnippetConfig) =>
  left.id === right.id &&
  left.uuid === right.uuid &&
  left.snippet_name === right.snippet_name &&
  left.snippet_content === right.snippet_content &&
  quickCommandSnippetGroupUuid(left) === quickCommandSnippetGroupUuid(right) &&
  (left.create_at || '') === (right.create_at || '') &&
  (left.update_at || '') === (right.update_at || '')

const snapshotContainsQuickCommandGroup = (snapshot: QuickCommandsUserConfig, group: QuickCommandGroupConfig) =>
  snapshot.groups.some((item) => quickCommandGroupsMatch(item, group))

const snapshotContainsQuickCommandSnippet = (snapshot: QuickCommandsUserConfig, snippet: QuickCommandSnippetConfig) =>
  snapshot.snippets.some((item) => quickCommandSnippetsMatch(item, snippet))

export const isQuickCommandGroupSaveData = (value: unknown, expected: { uuid?: string; groupName: string }): value is QuickCommandGroupMutationData => {
  if (!isRecord(value) || !isQuickCommandsSnapshotData(value)) return false
  const record = value as QuickCommandsUserConfig & Record<string, unknown>
  if (!isQuickCommandGroupData(record.group)) return false
  const group = record.group
  if (expected.uuid && group.uuid !== expected.uuid) return false
  return group.group_name === expected.groupName && snapshotContainsQuickCommandGroup(record, group)
}

export const isQuickCommandGroupDeleteData = (value: unknown, uuid: string): value is QuickCommandGroupDeleteData => {
  if (!isRecord(value) || !isQuickCommandsSnapshotData(value)) return false
  const record = value as QuickCommandsUserConfig & Record<string, unknown>
  return record.groupUuid === uuid && !record.groups.some((group) => group.uuid === uuid) && !record.snippets.some((snippet) => snippet.group_uuid === uuid)
}

export const isQuickCommandSnippetSaveData = (
  value: unknown,
  expected: { id?: number; snippetName: string; snippetContent: string; groupUuid?: string | null }
): value is QuickCommandSnippetMutationData => {
  if (!isRecord(value) || !isQuickCommandsSnapshotData(value)) return false
  const record = value as QuickCommandsUserConfig & Record<string, unknown>
  if (!isQuickCommandSnippetData(record.snippet)) return false
  const snippet = record.snippet
  if (expected.id !== undefined && snippet.id !== expected.id) return false
  if (expected.groupUuid !== undefined && quickCommandSnippetGroupUuid(snippet) !== expected.groupUuid) return false
  return snippet.snippet_name === expected.snippetName && snippet.snippet_content === expected.snippetContent && snapshotContainsQuickCommandSnippet(record, snippet)
}

export const isQuickCommandMacroSaveData = (
  value: unknown,
  expected: { snippetName?: string; groupUuid?: string | null }
): value is QuickCommandMacroMutationData => {
  if (!isRecord(value) || !isQuickCommandsSnapshotData(value)) return false
  const record = value as QuickCommandsUserConfig & Record<string, unknown>
  if (!isQuickCommandSnippetData(record.snippet)) return false
  const snippet = record.snippet
  if (expected.snippetName !== undefined && snippet.snippet_name !== expected.snippetName) return false
  if (expected.groupUuid !== undefined && quickCommandSnippetGroupUuid(snippet) !== expected.groupUuid) return false
  return snapshotContainsQuickCommandSnippet(record, snippet)
}

export const isQuickCommandSnippetDeleteData = (value: unknown, id: number): value is QuickCommandSnippetDeleteData => {
  if (!isRecord(value) || !isQuickCommandsSnapshotData(value)) return false
  const record = value as QuickCommandsUserConfig & Record<string, unknown>
  return record.id === id && !record.snippets.some((snippet) => snippet.id === id)
}

export const isQuickCommandReorderData = (value: unknown, expectedOrder: number[], groupUuid: string | null): value is QuickCommandReorderData =>
  isQuickCommandsSnapshotData(value) &&
  value.snippets
    .filter((snippet) => quickCommandSnippetGroupUuid(snippet) === groupUuid)
    .map((snippet) => snippet.id)
    .join(',') === expectedOrder.join(',')

export const isQuickCommandScriptPlanData = (value: unknown): value is QuickCommandScriptPlan => {
  if (
    !isRecord(value) ||
    !Array.isArray(value.segments) ||
    typeof value.shellText !== 'string' ||
    !isNonEmptyString(value.securityCommand) ||
    !Array.isArray(value.commands) ||
    (value.source !== 'snippet' && value.source !== 'inline') ||
    (value.snippetId !== null && !isPositiveInteger(value.snippetId)) ||
    typeof value.snippetName !== 'string' ||
    typeof value.autoExecute !== 'boolean'
  ) {
    return false
  }
  if (value.source === 'snippet' && (value.snippetId === null || !isNonEmptyString(value.snippetName))) return false
  if (value.source === 'inline' && value.snippetId !== null) return false
  let shellText = ''
  for (const segment of value.segments) {
    if (!isRecord(segment) || typeof segment.text !== 'string') return false
    const delayBeforeMs = segment.delayBeforeMs
    if (typeof delayBeforeMs !== 'number' || !Number.isFinite(delayBeforeMs) || delayBeforeMs < 0) return false
    shellText += segment.text
  }
  const commands = value.commands
  if (!commands.every(isNonEmptyString)) return false
  if (commands.length && value.securityCommand !== commands[0]) return false
  return shellText === value.shellText && JSON.stringify(extractShellCommandLines(value.shellText)) === JSON.stringify(commands)
}

export const isQuickCommandScriptPlanForRequest = (
  value: unknown,
  expected: { snippetId: number; snippetName: string; autoExecute: boolean }
): value is QuickCommandScriptPlan =>
  isQuickCommandScriptPlanData(value) &&
  value.source === 'snippet' &&
  value.snippetId === expected.snippetId &&
  value.snippetName === expected.snippetName &&
  value.autoExecute === expected.autoExecute
