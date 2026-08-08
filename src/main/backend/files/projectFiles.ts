import { createHash, randomUUID } from 'crypto'
import { lstat, mkdir, open, readFile, readdir, realpath, rename, stat, unlink, writeFile } from 'fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'path'
import type {
  ProjectDirectoryEntry,
  ProjectDirectoryListInput,
  ProjectDirectoryListResult,
  ProjectEntryMutationInput,
  ProjectEntryMutationResult,
  ProjectFileChangeOrigin,
  ProjectFileChangeRecordResult,
  ProjectFileChangeV1,
  ProjectFileContext,
  ProjectFileContextInput,
  ProjectFileContextResult,
  ProjectFileReadInput,
  ProjectFileReadResult,
  ProjectFileRecentEntry,
  ProjectFileTrackingCapability,
  ProjectFileWatchEvent,
  ProjectFileWatchInput,
  ProjectFileWatchResult,
  ProjectFileWriteInput,
  ProjectFileWriteResult
} from '@shared/contracts/projectFiles'
import { projectFileChangeProtocolVersion } from '@shared/contracts/projectFiles'
import type { AiAgentSessionSource, ManagedAiSessionRecord } from '@shared/contracts/managedAiSessions'
import type { ProductSessionRecord } from '@shared/contracts/productSessions'
import { projectFileTrackingForAgent } from '../agent/agentIntegrationAdapters'
import { createResilientParentFileWatcher } from './resilientParentFileWatcher'

type ProjectFilesRuntimeConfig = {
  userDataPath: string
  getManagedSession: (source: AiAgentSessionSource, sessionId: string) => Promise<ManagedAiSessionRecord | null>
  findProductSession: (source: string, sessionId: string) => ProductSessionRecord | null
  emitWatchEvent?: (event: ProjectFileWatchEvent) => void
  emitProjectChange?: (context: ProjectFileContext) => void
}

type HistorySnapshot = {
  version: 1
  projects: Array<{
    projectRoot: string
    touchedAt: number
    recent: ProjectFileRecentEntry[]
  }>
}

type ResolvedProjectContext = {
  source: AiAgentSessionSource
  sessionId: string
  projectRoot: string
  capability: ProjectFileTrackingCapability
}

type WatchedTarget = {
  input: ProjectFileWatchInput
  projectRoot: string
  absolutePath: string
  lastMtimeMs: number
  lastSize: number
  existed: boolean
}

type ParentWatch = {
  watcher: { close: () => void }
  targets: Map<string, WatchedTarget>
}

const maxRecentPerProject = 50
const maxStoredProjects = 100
const maxChangeBatch = 256
const maxDirectoryPage = 500
const defaultDirectoryPage = 200
const maxTextBytes = 1024 * 1024
const maxParentWatchers = 64

let runtime: ProjectFilesRuntimeConfig | null = null
let historyLoaded = false
let history = new Map<string, { touchedAt: number; recent: ProjectFileRecentEntry[] }>()
let persistTimer: NodeJS.Timeout | null = null
const processedEvents = new Map<string, number>()
const parentWatches = new Map<string, ParentWatch>()
const watchDebounce = new Map<string, NodeJS.Timeout>()

const cleanText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
const slashPath = (value: string) => value.split(sep).join('/')
const failure = (errorCode: string, errorMessage: string) => ({ ok: false as const, errorCode, errorMessage })
const contentHash = (content: Buffer | string) => createHash('sha256').update(content).digest('hex')

const trackingCapabilityFor = (source: string): ProjectFileTrackingCapability =>
  projectFileTrackingForAgent(source)

const historyPath = () => join(runtime!.userDataPath, 'project-file-history.json')

const loadHistory = async () => {
  if (historyLoaded || !runtime) return
  historyLoaded = true
  try {
    const parsed = JSON.parse(await readFile(historyPath(), 'utf8')) as HistorySnapshot
    if (parsed.version !== 1 || !Array.isArray(parsed.projects)) return
    history = new Map(
      parsed.projects
        .filter((item) => cleanText(item.projectRoot) && Array.isArray(item.recent))
        .slice(0, maxStoredProjects)
        .map((item) => [
          item.projectRoot,
          {
            touchedAt: Number.isFinite(item.touchedAt) ? item.touchedAt : 0,
            recent: item.recent.slice(0, maxRecentPerProject)
          }
        ])
    )
  } catch {
    history = new Map()
  }
}

const persistHistory = async () => {
  if (!runtime) return
  const projects = [...history.entries()]
    .sort((left, right) => right[1].touchedAt - left[1].touchedAt)
    .slice(0, maxStoredProjects)
    .map(([projectRoot, value]) => ({ projectRoot, ...value }))
  const path = historyPath()
  const temporaryPath = `${path}.${process.pid}.tmp`
  await mkdir(dirname(path), { recursive: true })
  await writeFile(temporaryPath, `${JSON.stringify({ version: 1, projects }, null, 2)}\n`, 'utf8')
  await rename(temporaryPath, path)
}

const schedulePersistHistory = () => {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    void persistHistory().catch(() => undefined)
  }, 120)
  persistTimer.unref()
}

const resolveProjectContext = async (input: ProjectFileContextInput): Promise<ResolvedProjectContext | null> => {
  if (!runtime) return null
  const source = cleanText(input.source) as AiAgentSessionSource
  const sessionId = cleanText(input.sessionId)
  if (!source || !sessionId) return null
  const session = await runtime.getManagedSession(source, sessionId)
  if (!session || (!session.terminalSessionId && !session.hibernatedTerminalSessionId)) return null
  const productSession = runtime.findProductSession(source, sessionId)
  if (productSession?.target?.kind === 'ssh') return null
  const rawRoot = cleanText(productSession?.projectRoot || session.canonicalCwd || session.cwd)
  if (!rawRoot || !isAbsolute(rawRoot)) return null
  try {
    const projectRoot = await realpath(rawRoot)
    const metadata = await stat(projectRoot)
    if (!metadata.isDirectory()) return null
    return {
      source,
      sessionId,
      projectRoot,
      capability: trackingCapabilityFor(source)
    }
  } catch {
    return null
  }
}

const withinRoot = (projectRoot: string, candidate: string) => {
  const rel = relative(projectRoot, candidate)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

const nearestExistingRealPath = async (candidate: string) => {
  let current = candidate
  while (true) {
    try {
      return await realpath(current)
    } catch {
      const parent = dirname(current)
      if (parent === current) throw new Error('No existing parent path was found.')
      current = parent
    }
  }
}

const resolveProjectPath = async (
  projectRoot: string,
  pathInput: string,
  cwdInput = '',
  requireExisting = false
): Promise<{ absolutePath: string; relativePath: string } | null> => {
  const pathText = cleanText(pathInput)
  if (!pathText || pathText.includes('\0')) return null
  const cwd = cleanText(cwdInput)
  let base = projectRoot
  if (!isAbsolute(pathText) && cwd && isAbsolute(cwd)) {
    try {
      base = await realpath(cwd)
    } catch {
      return null
    }
    if (!withinRoot(projectRoot, base)) return null
  }
  const absolutePath = resolve(isAbsolute(pathText) ? pathText : join(base, pathText))
  if (!withinRoot(projectRoot, absolutePath)) return null
  try {
    const existing = await realpath(absolutePath)
    if (!withinRoot(projectRoot, existing)) return null
  } catch {
    if (requireExisting) return null
    const parent = await nearestExistingRealPath(dirname(absolutePath))
    if (!withinRoot(projectRoot, parent)) return null
  }
  const relativePath = slashPath(relative(projectRoot, absolutePath))
  if (!relativePath || relativePath.startsWith('../')) return null
  return { absolutePath, relativePath }
}

const recentFor = (projectRoot: string) => history.get(projectRoot)?.recent || []

const contextResult = (context: ResolvedProjectContext): ProjectFileContext => {
  const recent = [...recentFor(context.projectRoot)]
  return {
    ...context,
    capability: recent.some((entry) => entry.source === context.source && entry.origin === 'native')
      ? 'native'
      : context.capability,
    recent
  }
}

const pruneProcessedEvents = (now: number) => {
  for (const [key, at] of processedEvents) {
    if (now - at > 10 * 60_000) processedEvents.delete(key)
  }
  while (processedEvents.size > 4096) {
    const first = processedEvents.keys().next().value
    if (!first) break
    processedEvents.delete(first)
  }
}

export const configureProjectFilesRuntime = (config: ProjectFilesRuntimeConfig) => {
  runtime = config
  historyLoaded = false
  history = new Map()
}

export const getProjectFileContext = async (input: ProjectFileContextInput): Promise<ProjectFileContextResult> => {
  await loadHistory()
  const context = await resolveProjectContext(input)
  if (!context) return failure('PROJECT_FILE_CONTEXT_UNAVAILABLE', 'The selected managed AI session has no eligible local project.')
  return { ok: true, data: contextResult(context) }
}

export const projectFileSessionMatchesTerminal = async (
  input: ProjectFileContextInput,
  terminalSessionIdInput: string
) => {
  if (!runtime) return false
  const terminalSessionId = cleanText(terminalSessionIdInput)
  if (!terminalSessionId) return false
  const session = await runtime.getManagedSession(input.source, input.sessionId)
  return Boolean(
    session &&
    (session.terminalSessionId === terminalSessionId || session.hibernatedTerminalSessionId === terminalSessionId)
  )
}

export const inspectProjectFileCandidate = async (
  input: ProjectFileContextInput,
  pathInput: string,
  cwd = ''
) => {
  const context = await resolveProjectContext(input)
  if (!context) return null
  const path = await resolveProjectPath(context.projectRoot, pathInput, cwd)
  if (!path) return null
  const metadata = await stat(path.absolutePath).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  })
  return {
    relativePath: path.relativePath,
    exists: Boolean(metadata?.isFile()),
    size: metadata?.size || 0,
    mtimeMs: metadata?.mtimeMs || 0
  }
}

export const recordProjectFileChange = async (
  event: ProjectFileChangeV1,
  origin: ProjectFileChangeOrigin = 'native'
): Promise<ProjectFileChangeRecordResult> => {
  await loadHistory()
  if (event.protocolVersion !== projectFileChangeProtocolVersion) {
    return failure('PROJECT_FILE_PROTOCOL_UNSUPPORTED', 'Unsupported project file change protocol version.')
  }
  const context = await resolveProjectContext({
    source: event.source as AiAgentSessionSource,
    sessionId: event.sessionId
  })
  if (!context) return failure('PROJECT_FILE_CONTEXT_UNAVAILABLE', 'The managed AI session is not bound to an eligible local project.')
  const changes = Array.isArray(event.changes) ? event.changes.slice(0, maxChangeBatch) : []
  if (!cleanText(event.eventId) || !changes.length) {
    return failure('PROJECT_FILE_CHANGE_INVALID', 'eventId and at least one file change are required.')
  }

  const now = Date.now()
  pruneProcessedEvents(now)
  let accepted = 0
  let rejected = Math.max(0, (event.changes?.length || 0) - changes.length)
  let duplicate = 0
  let recent = [...recentFor(context.projectRoot)]

  for (const change of changes) {
    const path = await resolveProjectPath(context.projectRoot, change.path, event.cwd)
    const previous = change.previousPath
      ? await resolveProjectPath(context.projectRoot, change.previousPath, event.cwd)
      : null
    if (!path || (change.kind === 'renamed' && !previous)) {
      rejected += 1
      continue
    }
    const dedupeKey = [event.source, event.sessionId, event.eventId, change.kind, path.relativePath, previous?.relativePath || ''].join('\0')
    if (processedEvents.has(dedupeKey)) {
      duplicate += 1
      continue
    }
    processedEvents.set(dedupeKey, now)
    if (previous) recent = recent.filter((entry) => entry.path !== previous.relativePath)
    recent = recent.filter((entry) => entry.path !== path.relativePath)
    recent.unshift({
      path: path.relativePath,
      kind: change.kind,
      ...(previous ? { previousPath: previous.relativePath } : {}),
      changedAt: now,
      source: event.source,
      origin
    })
    accepted += 1
  }

  if (accepted) {
    history.set(context.projectRoot, { touchedAt: now, recent: recent.slice(0, maxRecentPerProject) })
    schedulePersistHistory()
    runtime?.emitProjectChange?.(contextResult(context))
  }
  return {
    ok: true,
    data: {
      projectRoot: context.projectRoot,
      accepted,
      rejected,
      duplicate,
      recent: [...recentFor(context.projectRoot)]
    }
  }
}

export const listProjectDirectory = async (input: ProjectDirectoryListInput): Promise<ProjectDirectoryListResult> => {
  const context = await resolveProjectContext(input)
  if (!context) return failure('PROJECT_FILE_CONTEXT_UNAVAILABLE', 'The selected managed AI session has no eligible local project.')
  const relativeDirectory = cleanText(input.relativeDirectory)
  const directory = relativeDirectory
    ? await resolveProjectPath(context.projectRoot, relativeDirectory, '', true)
    : { absolutePath: context.projectRoot, relativePath: '' }
  if (!directory) return failure('PROJECT_DIRECTORY_INVALID', 'The requested directory is outside the project.')
  try {
    const metadata = await stat(directory.absolutePath)
    if (!metadata.isDirectory()) return failure('PROJECT_DIRECTORY_INVALID', 'The requested path is not a directory.')
    const offset = Math.max(0, Math.floor(Number(input.offset) || 0))
    const limit = Math.max(1, Math.min(maxDirectoryPage, Math.floor(Number(input.limit) || defaultDirectoryPage)))
    const rows = await readdir(directory.absolutePath, { withFileTypes: true })
    const sorted = rows.sort((left, right) => {
      const leftRank = left.isDirectory() ? 0 : left.isSymbolicLink() ? 2 : 1
      const rightRank = right.isDirectory() ? 0 : right.isSymbolicLink() ? 2 : 1
      return leftRank - rightRank || left.name.localeCompare(right.name)
    })
    const page = sorted.slice(offset, offset + limit)
    const entries = await Promise.all(
      page.map(async (row): Promise<ProjectDirectoryEntry> => {
        const absolutePath = join(directory.absolutePath, row.name)
        const item = await lstat(absolutePath)
        return {
          name: row.name,
          relativePath: slashPath(relative(context.projectRoot, absolutePath)),
          type: row.isDirectory() ? 'directory' : row.isSymbolicLink() ? 'link' : 'file',
          size: item.size,
          modifiedAt: item.mtimeMs
        }
      })
    )
    const nextOffset = offset + page.length < sorted.length ? offset + page.length : undefined
    return {
      ok: true,
      data: {
        projectRoot: context.projectRoot,
        relativeDirectory: directory.relativePath,
        entries,
        ...(nextOffset !== undefined ? { nextOffset } : {})
      }
    }
  } catch (error) {
    return failure('PROJECT_DIRECTORY_READ_FAILED', error instanceof Error ? error.message : String(error))
  }
}

const projectEntryType = (metadata: Awaited<ReturnType<typeof lstat>>): ProjectDirectoryEntry['type'] =>
  metadata.isDirectory() ? 'directory' : metadata.isSymbolicLink() ? 'link' : 'file'

const existingProjectEntry = async (absolutePath: string) => lstat(absolutePath).catch((error) => {
  if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
  throw error
})

const requireProjectDestinationParent = async (absolutePath: string) => {
  const parent = await stat(dirname(absolutePath)).catch(() => null)
  return Boolean(parent?.isDirectory())
}

export const mutateProjectEntry = async (input: ProjectEntryMutationInput): Promise<ProjectEntryMutationResult> => {
  if (!(['create-file', 'rename', 'move', 'delete-file'] as const).includes(input.kind)) {
    return failure('PROJECT_ENTRY_MUTATION_INVALID', 'The requested project entry operation is invalid.')
  }
  const context = await resolveProjectContext(input)
  if (!context) return failure('PROJECT_FILE_CONTEXT_UNAVAILABLE', 'The selected managed AI session has no eligible local project.')
  const source = await resolveProjectPath(context.projectRoot, input.relativePath, '', input.kind !== 'create-file')
  if (!source) return failure('PROJECT_ENTRY_PATH_INVALID', 'The requested project path is invalid.')

  try {
    if (input.kind === 'create-file') {
      if (await existingProjectEntry(source.absolutePath)) {
        return failure('PROJECT_ENTRY_EXISTS', 'A project entry already exists at the requested path.')
      }
      if (!await requireProjectDestinationParent(source.absolutePath)) {
        return failure('PROJECT_ENTRY_PARENT_INVALID', 'The target directory does not exist.')
      }
      const handle = await open(source.absolutePath, 'wx')
      await handle.close()
      await recordProjectFileChange({
        protocolVersion: 1,
        eventId: randomUUID(),
        source: context.source,
        sessionId: context.sessionId,
        changes: [{ path: source.relativePath, kind: 'created' }]
      }, 'editor')
      return {
        ok: true,
        data: {
          kind: input.kind,
          projectRoot: context.projectRoot,
          relativePath: source.relativePath,
          entryType: 'file'
        }
      }
    }

    const sourceMetadata = await lstat(source.absolutePath)
    const entryType = projectEntryType(sourceMetadata)
    if (input.kind === 'delete-file') {
      if (entryType === 'directory') {
        return failure('PROJECT_ENTRY_DELETE_DIRECTORY_UNSUPPORTED', 'Project directory deletion is not supported.')
      }
      await unlink(source.absolutePath)
      await recordProjectFileChange({
        protocolVersion: 1,
        eventId: randomUUID(),
        source: context.source,
        sessionId: context.sessionId,
        changes: [{ path: source.relativePath, kind: 'deleted' }]
      }, 'editor')
      return {
        ok: true,
        data: {
          kind: input.kind,
          projectRoot: context.projectRoot,
          relativePath: source.relativePath,
          entryType
        }
      }
    }

    const target = await resolveProjectPath(context.projectRoot, input.targetRelativePath || '')
    if (!target) return failure('PROJECT_ENTRY_TARGET_INVALID', 'The target project path is invalid.')
    if (target.relativePath === source.relativePath) {
      return {
        ok: true,
        data: {
          kind: input.kind,
          projectRoot: context.projectRoot,
          relativePath: source.relativePath,
          previousPath: source.relativePath,
          entryType
        }
      }
    }
    if (entryType === 'directory' && withinRoot(source.absolutePath, target.absolutePath)) {
      return failure('PROJECT_ENTRY_TARGET_INVALID', 'A directory cannot be moved into itself.')
    }
    if (await existingProjectEntry(target.absolutePath)) {
      return failure('PROJECT_ENTRY_EXISTS', 'A project entry already exists at the target path.')
    }
    if (!await requireProjectDestinationParent(target.absolutePath)) {
      return failure('PROJECT_ENTRY_PARENT_INVALID', 'The target directory does not exist.')
    }
    await rename(source.absolutePath, target.absolutePath)
    await recordProjectFileChange({
      protocolVersion: 1,
      eventId: randomUUID(),
      source: context.source,
      sessionId: context.sessionId,
      changes: [{ path: target.relativePath, previousPath: source.relativePath, kind: 'renamed' }]
    }, 'editor')
    return {
      ok: true,
      data: {
        kind: input.kind,
        projectRoot: context.projectRoot,
        relativePath: target.relativePath,
        previousPath: source.relativePath,
        entryType
      }
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EEXIST') return failure('PROJECT_ENTRY_EXISTS', 'A project entry already exists at the requested path.')
    if (code === 'ENOENT') return failure('PROJECT_ENTRY_NOT_FOUND', 'The requested project entry no longer exists.')
    return failure('PROJECT_ENTRY_MUTATION_FAILED', error instanceof Error ? error.message : String(error))
  }
}

export const readProjectFile = async (input: ProjectFileReadInput): Promise<ProjectFileReadResult> => {
  const context = await resolveProjectContext(input)
  if (!context) return failure('PROJECT_FILE_CONTEXT_UNAVAILABLE', 'The selected managed AI session has no eligible local project.')
  const path = await resolveProjectPath(context.projectRoot, input.relativePath, '', true)
  if (!path) return failure('PROJECT_FILE_PATH_INVALID', 'The requested file is outside the project.')
  try {
    const metadata = await stat(path.absolutePath)
    if (!metadata.isFile()) return failure('PROJECT_FILE_NOT_FILE', 'The requested path is not a file.')
    if (metadata.size > maxTextBytes) return failure('PROJECT_FILE_TOO_LARGE', 'Files larger than 1 MiB cannot be edited.')
    const buffer = await readFile(path.absolutePath)
    if (buffer.subarray(0, 8192).includes(0)) return failure('PROJECT_FILE_BINARY', 'Binary files cannot be edited.')
    return {
      ok: true,
      data: {
        projectRoot: context.projectRoot,
        relativePath: path.relativePath,
        content: buffer.toString('utf8'),
        contentHash: contentHash(buffer),
        size: metadata.size,
        mtimeMs: metadata.mtimeMs
      }
    }
  } catch (error) {
    return failure('PROJECT_FILE_READ_FAILED', error instanceof Error ? error.message : String(error))
  }
}

export const writeProjectFile = async (input: ProjectFileWriteInput): Promise<ProjectFileWriteResult> => {
  const context = await resolveProjectContext(input)
  if (!context) return failure('PROJECT_FILE_CONTEXT_UNAVAILABLE', 'The selected managed AI session has no eligible local project.')
  const path = await resolveProjectPath(context.projectRoot, input.relativePath)
  if (!path) return failure('PROJECT_FILE_PATH_INVALID', 'The requested file is outside the project.')
  const content = typeof input.content === 'string' ? input.content : String(input.content)
  if (Buffer.byteLength(content, 'utf8') > maxTextBytes) return failure('PROJECT_FILE_TOO_LARGE', 'Files larger than 1 MiB cannot be edited.')
  try {
    const before = await stat(path.absolutePath).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    })
    if (!input.overwrite) {
      if (!before && (input.expectedMtimeMs !== undefined || input.expectedSize !== undefined)) {
        return failure('PROJECT_FILE_CONFLICT', 'The file was removed on disk.')
      }
      if (before && input.expectedSize !== undefined && before.size !== input.expectedSize) {
        return failure('PROJECT_FILE_CONFLICT', 'The file changed on disk.')
      }
      if (before && input.expectedMtimeMs !== undefined && Math.abs(before.mtimeMs - input.expectedMtimeMs) > 1) {
        return failure('PROJECT_FILE_CONFLICT', 'The file changed on disk.')
      }
      if (before && input.expectedContentHash !== undefined) {
        const currentHash = contentHash(await readFile(path.absolutePath))
        if (currentHash !== input.expectedContentHash) {
          return failure('PROJECT_FILE_CONFLICT', 'The file changed on disk.')
        }
      }
    }
    await mkdir(dirname(path.absolutePath), { recursive: true })
    await writeFile(path.absolutePath, content, 'utf8')
    const writtenContentHash = contentHash(content)
    const persistedContentHash = contentHash(await readFile(path.absolutePath))
    if (persistedContentHash !== writtenContentHash) {
      return failure('PROJECT_FILE_CONFLICT', 'The file changed while it was being saved.')
    }
    const after = await stat(path.absolutePath)
    for (const parent of parentWatches.values()) {
      for (const target of parent.targets.values()) {
        if (target.absolutePath !== path.absolutePath) continue
        target.existed = true
        target.lastMtimeMs = after.mtimeMs
        target.lastSize = after.size
      }
    }
    await recordProjectFileChange(
      {
        protocolVersion: 1,
        eventId: randomUUID(),
        source: context.source,
        sessionId: context.sessionId,
        changes: [{ path: path.relativePath, kind: before ? 'modified' : 'created' }]
      },
      'editor'
    )
    return {
      ok: true,
      data: {
        projectRoot: context.projectRoot,
        relativePath: path.relativePath,
        contentHash: writtenContentHash,
        size: after.size,
        mtimeMs: after.mtimeMs,
        created: !before
      }
    }
  } catch (error) {
    return failure('PROJECT_FILE_WRITE_FAILED', error instanceof Error ? error.message : String(error))
  }
}

const inspectWatchedTarget = async (target: WatchedTarget) => {
  const metadata = await stat(target.absolutePath).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  })
  const existed = Boolean(metadata?.isFile())
  const changed = existed !== target.existed ||
    Boolean(metadata && (metadata.mtimeMs !== target.lastMtimeMs || metadata.size !== target.lastSize))
  if (!changed) return
  target.existed = existed
  target.lastMtimeMs = metadata?.mtimeMs || 0
  target.lastSize = metadata?.size || 0
  const kind = existed ? 'modified' : 'deleted'
  runtime?.emitWatchEvent?.({
    watchId: target.input.watchId,
    projectRoot: target.projectRoot,
    relativePath: target.input.relativePath,
    kind,
    changedAt: Date.now()
  })
  await recordProjectFileChange(
    {
      protocolVersion: 1,
      eventId: randomUUID(),
      source: target.input.source,
      sessionId: target.input.sessionId,
      changes: [{ path: target.input.relativePath, kind }]
    },
    'watcher'
  )
}

const scheduleWatchInspection = (target: WatchedTarget) => {
  const existing = watchDebounce.get(target.input.watchId)
  if (existing) clearTimeout(existing)
  const timer = setTimeout(() => {
    watchDebounce.delete(target.input.watchId)
    void inspectWatchedTarget(target).catch(() => undefined)
  }, 80)
  timer.unref()
  watchDebounce.set(target.input.watchId, timer)
}

export const startProjectFileWatch = async (input: ProjectFileWatchInput): Promise<ProjectFileWatchResult> => {
  const context = await resolveProjectContext(input)
  if (!context) return failure('PROJECT_FILE_CONTEXT_UNAVAILABLE', 'The selected managed AI session has no eligible local project.')
  const path = await resolveProjectPath(context.projectRoot, input.relativePath)
  if (!path || !cleanText(input.watchId)) return failure('PROJECT_FILE_WATCH_INVALID', 'A valid project file and watchId are required.')
  stopProjectFileWatch(input.watchId)
  const parentPath = dirname(path.absolutePath)
  let parent = parentWatches.get(parentPath)
  if (!parent) {
    if (parentWatches.size >= maxParentWatchers) {
      return { ok: true, data: { watchId: input.watchId, watched: false, fallback: true } }
    }
    const targets = new Map<string, WatchedTarget>()
    const watcher = createResilientParentFileWatcher({
      parentPath,
      onChange: (filename) => {
        const changedName = cleanText(filename)
        for (const target of targets.values()) {
          if (!changedName || basename(target.absolutePath) === changedName) scheduleWatchInspection(target)
        }
      },
      inspect: async () => {
        await Promise.all([...targets.values()].map((target) => inspectWatchedTarget(target)))
      }
    })
    parent = { watcher, targets }
    parentWatches.set(parentPath, parent)
  }
  const metadata = await stat(path.absolutePath).catch(() => null)
  parent.targets.set(input.watchId, {
    input: { ...input, relativePath: path.relativePath },
    projectRoot: context.projectRoot,
    absolutePath: path.absolutePath,
    lastMtimeMs: metadata?.mtimeMs || 0,
    lastSize: metadata?.size || 0,
    existed: Boolean(metadata?.isFile())
  })
  return { ok: true, data: { watchId: input.watchId, watched: true, fallback: false } }
}

export const stopProjectFileWatch = (watchIdInput: string): ProjectFileWatchResult => {
  const watchId = cleanText(watchIdInput)
  for (const [parentPath, parent] of parentWatches) {
    if (!parent.targets.delete(watchId)) continue
    const timer = watchDebounce.get(watchId)
    if (timer) clearTimeout(timer)
    watchDebounce.delete(watchId)
    if (!parent.targets.size) {
      parent.watcher.close()
      parentWatches.delete(parentPath)
    }
    return { ok: true, data: { watchId, watched: false, fallback: false } }
  }
  return { ok: true, data: { watchId, watched: false, fallback: false } }
}

export const closeProjectFilesRuntime = async () => {
  let persist: Promise<void> | null = null
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
    persist = persistHistory().catch(() => undefined)
  }
  for (const timer of watchDebounce.values()) clearTimeout(timer)
  watchDebounce.clear()
  for (const parent of parentWatches.values()) parent.watcher.close()
  parentWatches.clear()
  await persist
}

export const getProjectFilesRuntimeSnapshotForTests = () => ({
  parentWatcherCount: parentWatches.size,
  watchedTargetCount: [...parentWatches.values()].reduce((total, parent) => total + parent.targets.size, 0),
  projectCount: history.size
})

export const resetProjectFilesRuntimeForTests = async () => {
  await closeProjectFilesRuntime()
  historyLoaded = false
  history = new Map()
  processedEvents.clear()
  runtime = null
}
