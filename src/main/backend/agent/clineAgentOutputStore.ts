import { createHash, randomBytes } from 'crypto'
import { lstat, mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'fs/promises'
import { join } from 'path'

const OUTPUT_REF_PATTERN = /^cline-output:([a-f0-9]{24}):([a-f0-9]{32})$/
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024
const DEFAULT_READ_BYTES = 64 * 1024
const MAX_READ_BYTES = 128 * 1024
const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

type OutputMetadata = {
  version: 1
  fileRef: string
  sessionDigest: string
  taskId: string
  turnId: string
  toolCallId: string
  bytes: number
  createdAt: string
}

const cleanText = (value: unknown) => String(value || '').trim()
const sessionDigestFor = (sessionId: string) =>
  createHash('sha256').update(cleanText(sessionId), 'utf8').digest('hex').slice(0, 24)

const boundedInteger = (value: unknown, fallback: number, minimum: number, maximum: number) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(minimum, Math.min(maximum, Math.trunc(parsed)))
}

const outputPaths = (rootPath: string, sessionDigest: string, token: string) => {
  const directory = join(rootPath, sessionDigest)
  return {
    directory,
    contentPath: join(directory, `${token}.txt`),
    metadataPath: join(directory, `${token}.json`)
  }
}

const parseOutputRef = (fileRef: string) => {
  const match = OUTPUT_REF_PATTERN.exec(cleanText(fileRef))
  return match ? { sessionDigest: match[1], token: match[2] } : null
}

const utf8ChunkEnd = (buffer: Buffer, start: number, desiredEnd: number) => {
  if (desiredEnd >= buffer.length) return buffer.length
  let end = desiredEnd
  while (end > start && (buffer[end] & 0xc0) === 0x80) end -= 1
  if (end > start) return end
  end = desiredEnd
  while (end < buffer.length && (buffer[end] & 0xc0) === 0x80) end += 1
  return end
}

const assertRegularDirectory = async (directory: string) => {
  const info = await lstat(directory)
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error('Cline Agent output session directory is invalid.')
  }
}

export type ClineAgentOutputStore = ReturnType<typeof createClineAgentOutputStore>

export const createClineAgentOutputStore = (input: {
  rootPath: string
  now?: () => number
  randomToken?: () => string
}) => {
  const rootPath = cleanText(input.rootPath)
  if (!rootPath) throw new Error('Cline Agent output root is required.')
  const now = input.now || Date.now
  const randomToken = input.randomToken || (() => randomBytes(16).toString('hex'))

  const write = async (request: {
    sessionId: string
    taskId: string
    turnId: string
    toolCallId: string
    content: string
  }) => {
    const sessionId = cleanText(request.sessionId)
    const taskId = cleanText(request.taskId)
    const turnId = cleanText(request.turnId)
    const toolCallId = cleanText(request.toolCallId)
    if (!sessionId || !taskId || !turnId || !toolCallId) {
      throw new Error('Cline Agent output identity is incomplete.')
    }
    const content = String(request.content || '')
    const bytes = Buffer.byteLength(content, 'utf8')
    if (!bytes || bytes > MAX_OUTPUT_BYTES) {
      throw new Error(`Cline Agent output must contain 1-${MAX_OUTPUT_BYTES} UTF-8 bytes.`)
    }
    const sessionDigest = sessionDigestFor(sessionId)
    const token = cleanText(randomToken())
    if (!/^[a-f0-9]{32}$/.test(token)) throw new Error('Cline Agent output token is invalid.')
    const fileRef = `cline-output:${sessionDigest}:${token}`
    const paths = outputPaths(rootPath, sessionDigest, token)
    const suffix = `${process.pid}-${now()}`
    const contentTempPath = `${paths.contentPath}.${suffix}.tmp`
    const metadataTempPath = `${paths.metadataPath}.${suffix}.tmp`
    const createdAt = new Date(now()).toISOString()
    const metadata: OutputMetadata = {
      version: 1,
      fileRef,
      sessionDigest,
      taskId,
      turnId,
      toolCallId,
      bytes,
      createdAt
    }
    await mkdir(paths.directory, { recursive: true, mode: 0o700 })
    await assertRegularDirectory(paths.directory)
    try {
      await writeFile(contentTempPath, content, { encoding: 'utf8', mode: 0o600 })
      await writeFile(metadataTempPath, JSON.stringify(metadata), { encoding: 'utf8', mode: 0o600 })
      await rename(contentTempPath, paths.contentPath)
      await rename(metadataTempPath, paths.metadataPath)
    } catch (error) {
      await Promise.all([
        rm(contentTempPath, { force: true }),
        rm(metadataTempPath, { force: true })
      ])
      throw error
    }
    return { fileRef, bytes, createdAt }
  }

  const read = async (request: {
    sessionId: string
    fileRef: string
    offset?: number
    maxBytes?: number
  }) => {
    const sessionId = cleanText(request.sessionId)
    const fileRef = cleanText(request.fileRef)
    const parsed = parseOutputRef(fileRef)
    if (!sessionId || !parsed || parsed.sessionDigest !== sessionDigestFor(sessionId)) {
      throw new Error('Cline Agent output reference is invalid for this session.')
    }
    const paths = outputPaths(rootPath, parsed.sessionDigest, parsed.token)
    await assertRegularDirectory(paths.directory)
    const [contentInfo, metadataInfo, metadataText] = await Promise.all([
      lstat(paths.contentPath),
      lstat(paths.metadataPath),
      readFile(paths.metadataPath, 'utf8')
    ])
    if (!contentInfo.isFile() || contentInfo.isSymbolicLink() || !metadataInfo.isFile() || metadataInfo.isSymbolicLink()) {
      throw new Error('Cline Agent output reference does not resolve to regular files.')
    }
    const metadata = JSON.parse(metadataText) as Partial<OutputMetadata>
    if (
      metadata.version !== 1 ||
      metadata.fileRef !== fileRef ||
      metadata.sessionDigest !== parsed.sessionDigest ||
      metadata.bytes !== contentInfo.size ||
      contentInfo.size > MAX_OUTPUT_BYTES
    ) {
      throw new Error('Cline Agent output metadata is invalid.')
    }
    const offset = boundedInteger(request.offset, 0, 0, contentInfo.size)
    const maxBytes = boundedInteger(request.maxBytes, DEFAULT_READ_BYTES, 1, MAX_READ_BYTES)
    const readLength = Math.min(contentInfo.size - offset, maxBytes + 4)
    const buffer = Buffer.alloc(Math.max(0, readLength))
    if (readLength) {
      const file = await open(paths.contentPath, 'r')
      try {
        await file.read(buffer, 0, readLength, offset)
      } finally {
        await file.close()
      }
    }
    const relativeEnd = utf8ChunkEnd(buffer, 0, Math.min(maxBytes, buffer.length))
    const content = buffer.subarray(0, relativeEnd).toString('utf8')
    const nextOffset = offset + relativeEnd
    return {
      fileRef,
      offset,
      nextOffset,
      totalBytes: contentInfo.size,
      eof: nextOffset >= contentInfo.size,
      content
    }
  }

  const deleteSession = async (sessionId: string) => {
    const normalized = cleanText(sessionId)
    if (!normalized) return
    await rm(join(rootPath, sessionDigestFor(normalized)), { recursive: true, force: true })
  }

  const prune = async (retentionMs = DEFAULT_RETENTION_MS) => {
    const cutoff = now() - Math.max(60_000, retentionMs)
    let directories: string[] = []
    try {
      directories = await readdir(rootPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
      throw error
    }
    let deleted = 0
    for (const directory of directories) {
      if (!/^[a-f0-9]{24}$/.test(directory)) continue
      const directoryPath = join(rootPath, directory)
      let entries: string[] = []
      try {
        await assertRegularDirectory(directoryPath)
        entries = await readdir(directoryPath)
      } catch {
        continue
      }
      for (const entry of entries) {
        if (!/^[a-f0-9]{32}\.json$/.test(entry)) continue
        const metadataPath = join(directoryPath, entry)
        try {
          const info = await stat(metadataPath)
          if (info.mtimeMs >= cutoff) continue
          const token = entry.slice(0, -5)
          await Promise.all([
            rm(metadataPath, { force: true }),
            rm(join(directoryPath, `${token}.txt`), { force: true })
          ])
          deleted += 1
        } catch {
          // Best-effort retention cleanup must not affect active Agent work.
        }
      }
    }
    return deleted
  }

  return { write, read, deleteSession, prune }
}

export const clineAgentOutputStoreLimits = {
  maxOutputBytes: MAX_OUTPUT_BYTES,
  defaultReadBytes: DEFAULT_READ_BYTES,
  maxReadBytes: MAX_READ_BYTES,
  defaultRetentionMs: DEFAULT_RETENTION_MS
}
