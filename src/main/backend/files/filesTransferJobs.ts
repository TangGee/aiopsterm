import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, statSync } from 'fs'
import { dirname, basename, isAbsolute, join, resolve, posix } from 'path'
import type { FileListOptions, FileTransferOperation, FileTransferOperationResult, FileTransferTask, FileTransferTaskActionInput } from '@shared/contracts/files'
import { resolveRemoteSftpTarget, withRemoteSftp, type RemoteSftpTarget } from './filesSftpConnectionRuntime'
import { normalizeRemotePath, remoteBasename } from './filesPathRuntime'
import { localTransferEndpoint, remoteTransferEndpoint, type TransferEndpoint } from './filesTransferEndpoint'
import { copyResumableEntry, type TransferManifestEntry } from './filesResumableCopy'
import { publishFileTransferTask } from './filesTransferRuntime'

type EndpointRef = { kind: 'local' } | { kind: 'remote'; assetId: string; host: string; port: number; username: string }
type TransferJob = {
  task: FileTransferTask
  source: EndpointRef
  target: EndpointRef
  overwrite: boolean
  expectedKind?: 'file' | 'directory'
  entries?: TransferManifestEntry[]
}
const jobs = new Map<string, TransferJob>()
const removing = new Set<string>()
const runs = new Map<string, { stop?: 'paused' | 'cancelled'; promise: Promise<FileTransferOperationResult> }>()
let statePath: string | undefined
let storageError = ''
const maximumJobs = 100
const maximumEntries = 10000
const fail = (code: string, message: string) => Object.assign(new Error(message), { code })
const snapshot = (task: FileTransferTask): FileTransferTask => ({ ...task })
const endpointRef = (options: FileListOptions): EndpointRef => {
  const target = resolveRemoteSftpTarget({ ...options, kind: 'remote' })
  if (!target) throw fail('FILES_SFTP_UNAVAILABLE', '主机不可用，请检查资产和 SFTP 连接')
  return { kind: 'remote', assetId: target.assetId, host: target.host, port: target.port, username: target.username }
}
const currentTarget = (ref: EndpointRef): RemoteSftpTarget => {
  if (ref.kind !== 'remote') throw new Error('Remote target required')
  const target = resolveRemoteSftpTarget({ kind: 'remote', sessionId: ref.assetId })
  if (!target || target.host !== ref.host || target.port !== ref.port || target.username !== ref.username) {
    throw fail('target_changed', '主机配置已改变或资产已删除，请重新创建传输任务')
  }
  return target
}
const withEndpoint = <T>(ref: EndpointRef, action: (endpoint: TransferEndpoint) => Promise<T>): Promise<T> =>
  ref.kind === 'local' ? action(localTransferEndpoint()) : withRemoteSftp(currentTarget(ref), sftp => action(remoteTransferEndpoint(sftp)))
const endpointIdentity = (ref: EndpointRef) => ref.kind === 'local' ? 'local' : `${ref.host}:${ref.port}:${ref.username}`
const containsPath = (root: string, path: string) => {
  if (/^[a-z]:[\\/]/i.test(root) || root.startsWith('\\\\')) { root = root.replace(/\\/g, '/').toLowerCase(); path = path.replace(/\\/g, '/').toLowerCase() }
  return path === root || path.startsWith(`${root.replace(/\/$/, '')}/`)
}
const save = () => {
  if (!statePath) return
  mkdirSync(dirname(statePath), { recursive: true, mode: 0o700 })
  const text = JSON.stringify({ version: 1, jobs: [...jobs.values()] })
  if (Buffer.byteLength(text) > 32 * 1024 * 1024) throw fail('checkpoint_limit', '传输记录过大，请清理已结束任务')
  const temporary = `${statePath}.tmp`
  writeFileSync(temporary, text, { mode: 0o600 })
  renameSync(temporary, statePath)
}
const validEndpoint = (value: EndpointRef) => value?.kind === 'local' ||
  (value?.kind === 'remote' && typeof value.assetId === 'string' && typeof value.host === 'string' && typeof value.username === 'string' && Number.isInteger(value.port))
const canonicalPath = (ref: EndpointRef, path: string) => typeof path === 'string' && !path.includes('\0') && isAbsolute(path) && (ref.kind === 'local' ? resolve(path) === path : posix.isAbsolute(path) && posix.normalize(path) === path && normalizeRemotePath(path) === path)
const validStat = (value: TransferManifestEntry['stat']) => value && ['file', 'directory', 'link'].includes(value.kind) && Number.isFinite(value.size) && value.size >= 0 && (Number.isFinite(value.mtime) && (value.mode === undefined || (Number.isInteger(value.mode) && value.mode >= 0 && value.mode <= 0o777)))
const validJob = (job: TransferJob) => {
  const task = job?.task
  if (!task || !/^transfer-[a-f0-9-]{36}$/.test(task.id) || !['upload', 'download', 'r2r'].includes(task.type) || typeof task.name !== 'string' || typeof job.overwrite !== 'boolean') return false
  if (!validEndpoint(job.source) || !validEndpoint(job.target) || !canonicalPath(job.source, task.source) || !canonicalPath(job.target, task.target)) return false
  if (!['running', 'paused', 'cancelled', 'success', 'error'].includes(task.status)) return false
  if (typeof task.speed !== 'string' || !Number.isFinite(task.progress) || task.progress < 0 || task.progress > 100) return false
  if (job.entries === undefined) return true
  return Array.isArray(job.entries) && job.entries.length <= maximumEntries && job.entries.every((entry, index) =>
    canonicalPath(job.source, entry.source) && canonicalPath(job.target, entry.target) && containsPath(task.source, entry.source) && containsPath(task.target, entry.target) &&
    entry.temporary === `${entry.target}.aiopsterm-${task.id}-${index}.part` && validStat(entry.stat) &&
    (entry.original === undefined || entry.original === null || validStat(entry.original)) &&
    (entry.digest === undefined || /^[a-f0-9]{64}$/.test(entry.digest)) &&
    (entry.link === undefined || typeof entry.link === 'string') && (entry.done === undefined || typeof entry.done === 'boolean'))
}
export const configureFileTransferJobs = (path?: string) => {
  if (runs.size || removing.size) throw new Error('Cannot reload transfer jobs while transfers are active')
  jobs.clear()
  statePath = path
  storageError = ''
  if (!path || !existsSync(path)) return
  try {
    if (statSync(path).size > 32 * 1024 * 1024) throw new Error('Transfer checkpoint exceeds size limit')
    const text = readFileSync(path, 'utf8')
    if (Buffer.byteLength(text) > 32 * 1024 * 1024) throw new Error('Transfer checkpoint exceeds size limit')
    const data = JSON.parse(text) as { version: number; jobs: TransferJob[] }
    if (data.version !== 1 || !Array.isArray(data.jobs) || data.jobs.length > maximumJobs || !data.jobs.every(validJob)) throw new Error('Invalid transfer checkpoint')
    for (const job of data.jobs) {
      job.task.resumable = true
      if (job.task.status === 'running') {
        job.task.status = 'paused'
        job.task.speed = '应用已重启，点击继续传输'
        delete job.task.stage
      }
      jobs.set(job.task.id, job)
    }
  } catch (error) {
    storageError = `传输记录读取失败，已保留原文件：${error instanceof Error ? error.message : String(error)}`
  }
}
export const listResumableFileTransfers = () => {
  if (storageError) throw new Error(storageError)
  return [...jobs.values()].map(job => snapshot(job.task))
}
export const hasResumableFileTransfer = (id: string) => jobs.has(id)
const notify = (job: TransferJob, kind: 'registered' | 'progress' | 'finished') => publishFileTransferTask(kind, job.task)
const result = (job: TransferJob): FileTransferOperationResult => ({ ok: true, data: {
  status: job.task.status === 'paused' ? 'paused' : job.task.status === 'cancelled' ? 'cancelled' : 'success',
  source: job.task.source, target: job.task.target, bytes: job.task.transferredBytes || 0,
  files: job.task.finishedFiles || 0, itemKind: job.task.isGroup ? 'directory' : 'file', mtimeMs: Date.now(), task: snapshot(job.task)
} })
const plan = async (job: TransferJob, source: TransferEndpoint, target: TransferEndpoint, check: () => void) => {
  const entries: TransferManifestEntry[] = []
  const walk = async (from: string, to: string, depth: number) => {
    check()
    if (depth > 128 || entries.length >= maximumEntries) throw fail('manifest_limit', '目录超过 10000 个条目或 128 层，请分批传输')
    const stat = await source.stat(from)
    if (!stat) throw fail('not_found', '源文件不存在')
    if (!entries.length && job.expectedKind && stat.kind !== job.expectedKind) throw fail('source_type', '源文件类型不符合传输操作')
    const index = entries.length
    entries.push({ source: from, target: to, stat, temporary: `${to}.aiopsterm-${job.task.id}-${index}.part` })
    if (stat.kind === 'directory') {
      for (const name of (await source.list(from)).sort()) {
        if (!name || name === '.' || name === '..' || /[\\/\0]/.test(name)) throw fail('invalid_path', '目录条目名称无效')
        await walk(source.join(from, name), target.join(to, name), depth + 1)
      }
    }
  }
  await walk(job.task.source, job.task.target, 0)
  job.entries = entries
  job.task.isGroup = entries[0].stat.kind === 'directory'
  job.task.totalFiles = entries.filter(entry => entry.stat.kind !== 'directory').length
  job.task.totalBytes = entries.reduce((sum, entry) => sum + (entry.stat.kind === 'file' ? entry.stat.size : 0), 0)
  save()
}
const run = async (job: TransferJob): Promise<FileTransferOperationResult> => {
  const running = runs.get(job.task.id)
  if (running) return running.promise
  const conflicting = [...runs.keys(), ...removing].some(id => {
    const other = jobs.get(id)!
    return endpointIdentity(other.target) === endpointIdentity(job.target) && (containsPath(other.task.target, job.task.target) || containsPath(job.task.target, other.task.target))
  })
  if (conflicting) return { ok: false, errorCode: 'target_busy', errorMessage: '目标路径已有传输，请等待完成后重试' }
  const state: { stop?: 'paused' | 'cancelled'; promise: Promise<FileTransferOperationResult> } = { promise: Promise.resolve(result(job)) }
  runs.set(job.task.id, state)
  job.task.status = 'running'
  job.task.stage = job.entries ? 'verifying' : 'scanning'
  job.task.speed = job.entries ? '检查续传内容' : '扫描中'
  delete job.task.errorCode
  const check = () => { if (state.stop) throw fail('transfer_stopped', state.stop) }
  state.promise = Promise.resolve().then(async (): Promise<FileTransferOperationResult> => {
    try {
      save()
      notify(job, 'registered')
      await withEndpoint(job.source, source => withEndpoint(job.target, async target => {
        if (!job.entries) await plan(job, source, target, check)
        let completedBytes = 0
        let completedFiles = 0
        let startedAt = Date.now()
        let startedBytes = 0
        let lastProgressAt = 0
        for (const entry of job.entries!) {
          check()
          await copyResumableEntry(source, target, entry, job.overwrite, {
            check, save,
            progress: (bytes, verifying) => {
              if (!startedBytes) { startedAt = Date.now(); startedBytes = bytes + 1 }
              job.task.transferredBytes = completedBytes + bytes
              job.task.progress = job.task.totalBytes ? Math.min(99, Math.floor(job.task.transferredBytes / job.task.totalBytes * 100)) : 0
              if (verifying) { job.task.stage = 'verifying'; job.task.speed = '校验中' }
              else {
                delete job.task.stage
                const speed = Math.max(0, bytes - startedBytes + 1) / Math.max(0.1, (Date.now() - startedAt) / 1000)
                job.task.speed = `${(speed / 1024).toFixed(0)} KB/s`
              }
              if (Date.now() - lastProgressAt >= 100) { lastProgressAt = Date.now(); notify(job, 'progress') }
            }
          })
          if (entry.stat.kind !== 'directory') completedFiles += 1
          if (entry.stat.kind === 'file') completedBytes += entry.stat.size
          job.task.finishedFiles = completedFiles
          job.task.transferredBytes = completedBytes
          startedBytes = 0
          notify(job, 'progress')
        }
      }))
      job.task.status = 'success'
      job.task.progress = 100
      job.task.speed = '完成，校验通过'
    } catch (error) {
      job.task.status = state.stop || 'error'
      job.task.errorCode = (error as { code?: string; errorCode?: string }).code || (error as { errorCode?: string }).errorCode || 'transfer_failed'
      job.task.speed = state.stop === 'paused' ? '已暂停，点击继续传输' : state.stop === 'cancelled' ? '已取消' : error instanceof Error ? error.message : '传输失败'
    } finally {
      delete job.task.stage
      runs.delete(job.task.id)
      try { save() } catch (error) { job.task.status = 'error'; job.task.speed = `传输记录保存失败：${String(error)}` }
      notify(job, 'finished')
    }
    if (job.task.status === 'error') return { ok: false, errorCode: job.task.errorCode || 'transfer_failed', errorMessage: job.task.speed }
    return result(job)
  })
  return state.promise
}
export const submitResumableFileTransfer = async (operation: FileTransferOperation, options: FileListOptions = {}): Promise<FileTransferOperationResult> => {
  try {
    if (storageError) throw new Error(storageError)
    if (!operation || !['upload-file', 'upload-directory', 'upload-path', 'download-file', 'download-directory', 'copy-remote'].includes(operation.kind)) throw fail('invalid_operation', '传输操作无效')
    const paths = operation.kind === 'copy-remote' ? [operation.remotePath, operation.targetPath]
      : operation.kind === 'download-file' ? [operation.remotePath, operation.localPath]
      : operation.kind === 'download-directory' ? [operation.remotePath, operation.localDirectory]
      : [operation.localPath, operation.remoteDirectory]
    if (paths.some(path => typeof path !== 'string' || !path.trim() || path.includes('\0'))) throw fail('invalid_path', '传输路径无效')
    if (jobs.size >= maximumJobs) throw fail('task_limit', '传输任务已达 100 个，请清理已结束任务')
    const downloading = operation.kind === 'download-file' || operation.kind === 'download-directory'
    const copying = operation.kind === 'copy-remote'
    const sourceRef: EndpointRef = downloading || copying ? endpointRef(copying ? operation.sourceOptions || options : options) : { kind: 'local' }
    const targetRef: EndpointRef = downloading ? { kind: 'local' } : endpointRef(options)
    const source = downloading || copying ? normalizeRemotePath(operation.remotePath) : resolve(operation.localPath)
    const target = operation.kind === 'download-file' ? resolve(operation.localPath)
      : operation.kind === 'download-directory' ? join(resolve(operation.localDirectory), remoteBasename(source) || 'root')
      : copying ? normalizeRemotePath(operation.targetPath)
      : normalizeRemotePath(`${operation.remoteDirectory}/${basename(source)}`)
    if (!canonicalPath(sourceRef, source) || !canonicalPath(targetRef, target)) throw fail('invalid_path', '传输路径无效')
    if (endpointIdentity(sourceRef) === endpointIdentity(targetRef) && (containsPath(source, target) || containsPath(target, source))) throw fail('invalid_target', '不能复制到自身、父目录或子目录')
    const task: FileTransferTask = {
      id: `transfer-${randomUUID()}`, type: downloading ? 'download' : copying ? 'r2r' : 'upload',
      name: downloading || copying ? remoteBasename(source) || 'root' : basename(source), source, target,
      progress: 0, speed: '等待中', status: 'paused', resumable: true,
      fromHost: sourceRef.kind === 'local' ? 'Local' : sourceRef.host, toHost: targetRef.kind === 'local' ? 'Local' : targetRef.host
    }
    const expectedKind = operation.kind.endsWith('-directory') ? 'directory' : operation.kind.endsWith('-file') ? 'file' : undefined
    const job: TransferJob = { task, source: sourceRef, target: targetRef, overwrite: copying ? Boolean(operation.overwrite) : true, expectedKind }
    jobs.set(task.id, job)
    try { save() } catch (error) { jobs.delete(task.id); throw error }
    const outcome = await run(job)
    if (!outcome.ok && outcome.errorCode === 'target_busy') { job.task.speed = outcome.errorMessage || '目标忙'; save(); notify(job, 'finished') }
    return outcome
  } catch (error) {
    return { ok: false, errorCode: (error as { code?: string; errorCode?: string }).code || (error as { errorCode?: string }).errorCode || 'transfer_failed', errorMessage: error instanceof Error ? error.message : String(error) }
  }
}
export const controlResumableFileTransfer = async (input: FileTransferTaskActionInput) => {
  const job = jobs.get(input?.id)
  if (!job) return { ok: false as const, errorCode: 'not_found', errorMessage: '传输任务不存在' }
  try {
    if (removing.has(input.id)) throw new Error('任务正在清理，请稍后重试')
    if (input.action === 'resume') {
      if (!['paused', 'error'].includes(job.task.status)) throw new Error('任务当前不能继续')
      const attempt = run(job)
      // The running lease is acquired synchronously; completion is pushed through task events.
      void attempt.catch(() => {})
      if (!runs.has(job.task.id)) return { ok: false as const, errorMessage: '目标路径已有传输，请稍后重试' }
    } else if (input.action === 'pause' || input.action === 'cancel') {
      const active = runs.get(job.task.id)
      if (active) {
        if (active.stop === 'cancelled') throw new Error('任务正在取消')
        active.stop = input.action === 'pause' ? 'paused' : 'cancelled'
        job.task.speed = input.action === 'pause' ? '正在暂停' : '正在取消'
      } else if (input.action === 'cancel' && ['paused', 'error'].includes(job.task.status)) {
        job.task.status = 'cancelled'; job.task.speed = '已取消'; save()
      } else throw new Error('任务当前不能暂停或取消')
      notify(job, active ? 'progress' : 'finished')
    } else if (input.action === 'remove') {
      if (runs.has(job.task.id)) throw new Error('请先暂停或取消任务')
      removing.add(input.id)
      try {
        // Only remove our own temporary paths. A failed cleanup retains the job for retry.
        if (job.entries?.some(entry => !entry.done && entry.stat.kind !== 'directory')) {
          await withEndpoint(job.target, async endpoint => {
            for (const entry of job.entries || []) {
              if (!entry.done && entry.stat.kind !== 'directory' && await endpoint.stat(entry.temporary)) await endpoint.unlink(entry.temporary)
            }
          })
        }
        jobs.delete(job.task.id)
        try { save() } catch (error) { jobs.set(job.task.id, job); throw error }
        return { ok: true as const, data: { removed: input.id } }
      } finally { removing.delete(input.id) }
    } else throw new Error('未知传输操作')
    return { ok: true as const, data: { task: snapshot(job.task) } }
  } catch (error) {
    return { ok: false as const, errorMessage: error instanceof Error ? error.message : String(error) }
  }
}
