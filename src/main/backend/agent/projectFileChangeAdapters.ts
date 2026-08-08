import { randomUUID } from 'crypto'
import {
  inspectProjectFileCandidate,
  projectFileSessionMatchesTerminal,
  recordProjectFileChange
} from '../files/projectFiles'
import type { AiAgentSessionEventInput, AiAgentSessionSource } from '@shared/contracts/managedAiSessions'
import type { ProjectFileChangeKind } from '@shared/contracts/projectFiles'

type CandidateSnapshot = {
  path: string
  exists: boolean
  size: number
  mtimeMs: number
}

type PendingSession = {
  source: AiAgentSessionSource
  sessionId: string
  cwd: string
  candidates: Map<string, CandidateSnapshot>
  touchedAt: number
}

const pending = new Map<string, PendingSession>()
const maxPendingPaths = 2048
const pendingTtlMs = 10 * 60_000

const cleanText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
const recordValue = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const normalizedToolName = (value: unknown) => cleanText(value).toLowerCase().replace(/[\s_-]+/g, '')
const sessionKey = (source: string, sessionId: string) => `${source}\0${sessionId}`

const fileToolNames = new Set([
  'write',
  'writefile',
  'edit',
  'editfile',
  'multiedit',
  'notebookedit',
  'applypatch',
  'deletefile',
  'movefile',
  'renamefile',
  'createfile'
])

const pathKeys = new Set([
  'path',
  'file_path',
  'filepath',
  'filePath',
  'target_path',
  'targetPath',
  'old_path',
  'oldPath',
  'new_path',
  'newPath'
])

const pathsFromPatch = (patch: string) => {
  const paths: string[] = []
  for (const line of patch.split(/\r?\n/)) {
    const match = line.match(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/)
    if (match?.[1]) paths.push(match[1].trim())
    const move = line.match(/^\*\*\* Move to: (.+)$/)
    if (move?.[1]) paths.push(move[1].trim())
  }
  return paths
}

const collectPaths = (value: unknown, out: string[], depth = 0) => {
  if (depth > 5 || out.length >= 256) return
  if (Array.isArray(value)) {
    value.forEach((item) => collectPaths(item, out, depth + 1))
    return
  }
  const record = recordValue(value)
  for (const [key, item] of Object.entries(record)) {
    if (pathKeys.has(key) && typeof item === 'string' && item.trim()) out.push(item.trim())
    if ((key === 'patch' || key === 'diff' || key === 'command') && typeof item === 'string') {
      out.push(...pathsFromPatch(item))
    }
    if (item && typeof item === 'object') collectPaths(item, out, depth + 1)
  }
}

const eventName = (record: Record<string, unknown>) =>
  cleanText(record.event || record.hookEventName || record.hook_event_name || record.type || record.kind)
    .toLowerCase()
    .replace(/[\s_-]+/g, '')

const toolInputFor = (record: Record<string, unknown>) => {
  const direct = recordValue(record.tool_input || record.toolInput)
  if (Object.keys(direct).length) return direct
  return recordValue(recordValue(record.toolCall).args)
}

const prunePending = (now = Date.now()) => {
  for (const [key, value] of pending) {
    if (now - value.touchedAt > pendingTtlMs) pending.delete(key)
  }
  let count = [...pending.values()].reduce((total, value) => total + value.candidates.size, 0)
  while (count > maxPendingPaths && pending.size) {
    const oldest = [...pending.entries()].sort((left, right) => left[1].touchedAt - right[1].touchedAt)[0]
    pending.delete(oldest[0])
    count -= oldest[1].candidates.size
  }
}

const captureCandidates = async (
  source: AiAgentSessionSource,
  sessionId: string,
  cwd: string,
  paths: string[]
) => {
  const key = sessionKey(source, sessionId)
  const state = pending.get(key) || {
    source,
    sessionId,
    cwd,
    candidates: new Map<string, CandidateSnapshot>(),
    touchedAt: Date.now()
  }
  state.cwd = cwd || state.cwd
  state.touchedAt = Date.now()
  for (const path of [...new Set(paths)].slice(0, 256)) {
    if (state.candidates.has(path)) continue
    const snapshot = await inspectProjectFileCandidate({ source, sessionId }, path, cwd)
    if (snapshot) state.candidates.set(path, { path, ...snapshot })
  }
  pending.set(key, state)
  prunePending()
}

const finalizeCandidates = async (source: AiAgentSessionSource, sessionId: string) => {
  const key = sessionKey(source, sessionId)
  const state = pending.get(key)
  if (!state) return 0
  pending.delete(key)
  const changes: Array<{ path: string; kind: ProjectFileChangeKind }> = []
  for (const before of state.candidates.values()) {
    const after = await inspectProjectFileCandidate({ source, sessionId }, before.path, state.cwd)
    if (!after) continue
    let kind: ProjectFileChangeKind | null = null
    if (!before.exists && after.exists) kind = 'created'
    else if (before.exists && !after.exists) kind = 'deleted'
    else if (before.exists && after.exists && (before.size !== after.size || before.mtimeMs !== after.mtimeMs)) kind = 'modified'
    if (kind) changes.push({ path: after.relativePath, kind })
  }
  if (!changes.length) return 0
  const result = await recordProjectFileChange({
    protocolVersion: 1,
    eventId: randomUUID(),
    source,
    sessionId,
    changes
  }, 'adapter')
  return result.ok ? result.data?.accepted || 0 : 0
}

export const handleProjectFileAgentHook = async (input: AiAgentSessionEventInput) => {
  const record = input as Record<string, unknown>
  const source = cleanText(record.source || record.agent) as AiAgentSessionSource
  const sessionId = cleanText(record.sessionId || record.session_id || record.conversationId || record.conversation_id || record.id)
  const event = eventName(record)
  if (!source || !sessionId || !event) return false
  const terminalSessionId = cleanText(record.terminalSessionId || record.terminal_session_id)
  if (!await projectFileSessionMatchesTerminal({ source, sessionId }, terminalSessionId)) return false
  const toolName = normalizedToolName(record.toolName || record.tool_name || recordValue(record.toolCall).name)
  const isPreTool = event === 'pretooluse' || event === 'toolexecutebefore' || event === 'toolcall'
  const isPostTool = event === 'posttooluse' || event === 'toolexecuteafter'
  const isFinal = event === 'stop' || event === 'sessionend'
  if (isPreTool && fileToolNames.has(toolName)) {
    const paths: string[] = []
    collectPaths(toolInputFor(record), paths)
    await captureCandidates(source, sessionId, cleanText(record.cwd), paths)
    return true
  }
  if (isPostTool) {
    if (fileToolNames.has(toolName)) {
      const paths: string[] = []
      collectPaths(toolInputFor(record), paths)
      if (paths.length) await captureCandidates(source, sessionId, cleanText(record.cwd), paths)
    }
    await finalizeCandidates(source, sessionId)
    return true
  }
  if (isFinal) {
    await finalizeCandidates(source, sessionId)
    return true
  }
  return false
}

export const clearProjectFileAgentAdapterState = () => {
  pending.clear()
}
