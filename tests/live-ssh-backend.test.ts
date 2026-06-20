import { randomUUID } from 'crypto'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { createRequire } from 'module'
import { tmpdir } from 'os'
import { join, posix } from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { TerminalLifecycleEvent } from '../src/shared/contracts/terminalSessions'

const requireNative = createRequire(__filename)
const Database = requireNative('better-sqlite3')

vi.mock('electron', () => ({
  app: {
    getPath: () => join(tmpdir(), 'aiopsterm-live-ssh-test')
  },
  safeStorage: {
    isEncryptionAvailable: () => false
  }
}))

type LiveSshConfig = {
  enabled: boolean
  host: string
  port: number
  username: string
  password?: string
  privateKey?: string
  passphrase?: string
  remoteRoot: string
  timeoutMs: number
}

const parseHostAndPort = () => {
  const rawHost = String(process.env.AIOPSTERM_LIVE_SSH_HOST || '').trim()
  const rawPort = String(process.env.AIOPSTERM_LIVE_SSH_PORT || '').trim()
  if (!rawHost) return { host: '', port: Number(rawPort || 22) }
  if (!rawPort) {
    const match = rawHost.match(/^([^:\s]+):(\d{1,5})$/)
    if (match) return { host: match[1], port: Number(match[2]) }
  }
  return { host: rawHost, port: Number(rawPort || 22) }
}

const readLiveSshConfig = (): LiveSshConfig => {
  const { host, port } = parseHostAndPort()
  const username = String(process.env.AIOPSTERM_LIVE_SSH_USERNAME || 'root').trim()
  const timeoutMs = Math.max(1000, Math.min(120000, Number(process.env.AIOPSTERM_LIVE_SSH_TIMEOUT_MS || 120000) || 120000))
  return {
    enabled: String(process.env.AIOPSTERM_LIVE_SSH_ENABLE || '').trim() === '1',
    host,
    port,
    username,
    password: String(process.env.AIOPSTERM_LIVE_SSH_PASSWORD || ''),
    privateKey: String(process.env.AIOPSTERM_LIVE_SSH_PRIVATE_KEY || ''),
    passphrase: String(process.env.AIOPSTERM_LIVE_SSH_PASSPHRASE || ''),
    remoteRoot: String(process.env.AIOPSTERM_LIVE_SSH_REMOTE_DIR || '').trim() || `/tmp/aiopsterm-live-${randomUUID()}`,
    timeoutMs
  }
}

const liveConfig = readLiveSshConfig()
const liveDescribe = liveConfig.enabled ? describe : describe.skip
const liveTestTimeoutMs = Math.max(30_000, liveConfig.timeoutMs * 4)

const expectValidLiveConfig = (config: LiveSshConfig) => {
  expect(config.host, 'AIOPSTERM_LIVE_SSH_HOST is required when AIOPSTERM_LIVE_SSH_ENABLE=1').toBeTruthy()
  expect(Number.isInteger(config.port) && config.port >= 1 && config.port <= 65535, 'AIOPSTERM_LIVE_SSH_PORT must be 1-65535').toBe(true)
  expect(config.username, 'AIOPSTERM_LIVE_SSH_USERNAME is required when AIOPSTERM_LIVE_SSH_ENABLE=1').toBeTruthy()
  expect(config.password || config.privateKey, 'AIOPSTERM_LIVE_SSH_PASSWORD or AIOPSTERM_LIVE_SSH_PRIVATE_KEY is required').toBeTruthy()
}

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const backendRuntimeConfig = () => ({
  sshProxyConfigs: [],
  sshAgentKeys: [],
  terminal: { sshAgentsStatus: false } as never
})

const loadBackends = async () => {
  vi.resetModules()
  const assetsModulePath = '../src/main/backend/assets'
  const filesModulePath = '../src/main/backend/files'
  const sshTerminalModulePath = '../src/main/backend/sshTerminal'
  const assets = await import(assetsModulePath)
  const files = await import(filesModulePath)
  const sshTerminal = await import(sshTerminalModulePath)
  return { assets, files, sshTerminal }
}

liveDescribe('live SSH/SFTP backend verification', () => {
  let localDir = ''
  let databasePath = ''
  let credentialKeyPath = ''
  let filesDatabasePath = ''
  let assetId = ''
  let backends: Record<string, any>

  beforeAll(async () => {
    expectValidLiveConfig(liveConfig)
    localDir = await mkdtemp(join(tmpdir(), 'aiopsterm-live-ssh-'))
    databasePath = join(localDir, 'assets.db')
    credentialKeyPath = join(localDir, 'asset-credential.key')
    filesDatabasePath = join(localDir, 'files.db')
    backends = await loadBackends()
    backends.assets.configureAssetBackendRuntime({
      databasePath,
      credentialKeyPath,
      useSeedData: false,
      sqliteFactory: Database,
      timeoutMs: liveConfig.timeoutMs
    })
    backends.files.configureFilesBackendRuntime({
      databasePath: filesDatabasePath,
      useSeedData: false,
      sqliteFactory: Database,
      sftpPoolIdleTtlMs: 0,
      getConfig: backendRuntimeConfig
    })
    backends.sshTerminal.configureSshTerminalBackendRuntime({
      getAsset: backends.assets.getAsset,
      getAssetSecret: backends.assets.getAssetSecret,
      getKeychainSecret: backends.assets.getKeychainSecret,
      readyTimeoutMs: liveConfig.timeoutMs,
      keepaliveIntervalMs: 5000,
      getConfig: backendRuntimeConfig
    })

    const saved = backends.assets.saveAsset({
      id: 'live-ssh-asset',
      name: `live-${liveConfig.host}`,
      title: `live-${liveConfig.host}`,
      host: liveConfig.host,
      ip: liveConfig.host,
      username: liveConfig.username,
      port: liveConfig.port,
      asset_type: 'person',
      auth_type: liveConfig.privateKey ? 'keyBased' : 'password',
      group: 'Live Verification',
      group_name: 'Live Verification',
      status: 'online',
      tags: ['live-ssh'],
      ...(liveConfig.password ? { password: liveConfig.password } : {}),
      ...(liveConfig.privateKey ? { privateKey: liveConfig.privateKey } : {}),
      ...(liveConfig.passphrase ? { passphrase: liveConfig.passphrase } : {})
    })
    expect(saved.ok).toBe(true)
    assetId = saved.data!.id
  }, liveTestTimeoutMs)

  afterAll(async () => {
    if (backends?.files && assetId && liveConfig.remoteRoot) {
      await backends.files.mutateFileEntry({ kind: 'delete', path: liveConfig.remoteRoot, recursive: true }, { kind: 'remote', sessionId: assetId }).catch(() => undefined)
    }
    if (localDir) await rm(localDir, { recursive: true, force: true })
  }, liveTestTimeoutMs)

  it('connects saved assets and performs SFTP list/read/write/mutate/transfer operations against a real host', async () => {
    const connection = await backends.assets.testAssetConnection({ assetId, timeoutMs: liveConfig.timeoutMs })
    expect(connection).toEqual({
      ok: true,
      data: expect.objectContaining({
        assetId,
        host: liveConfig.host,
        port: liveConfig.port,
        username: liveConfig.username,
        endpoint: `${liveConfig.username}@${liveConfig.host}:${liveConfig.port}`
      })
    })

    const remoteDir = liveConfig.remoteRoot
    const remoteFile = posix.join(remoteDir, 'note.txt')
    const renamedRemoteFile = posix.join(remoteDir, 'renamed-note.txt')
    const uploadedRemoteFile = posix.join(remoteDir, 'local-upload.txt')
    const localUpload = join(localDir, 'local-upload.txt')
    const localDownload = join(localDir, 'downloaded-note.txt')
    const marker = `aiopsterm-live-sftp-${randomUUID()}`

    try {
      const written = await backends.files.writeFileContent(remoteFile, `${marker}\n`, { kind: 'remote', sessionId: assetId, host: liveConfig.host })
      expect(written).toEqual({ ok: true, data: expect.objectContaining({ size: Buffer.byteLength(`${marker}\n`) }) })

      const rows = await backends.files.listFiles(remoteDir, { kind: 'remote', sessionId: assetId, host: liveConfig.host })
      expect(rows).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'note.txt', path: remoteFile, type: 'file' })]))

      const read = await backends.files.readFileContent(remoteFile, { kind: 'remote', sessionId: assetId, host: liveConfig.host })
      expect(read).toEqual({ ok: true, data: expect.objectContaining({ content: `${marker}\n`, action: 'edit' }) })

      const renamed = await backends.files.mutateFileEntry({ kind: 'rename', oldPath: remoteFile, newPath: renamedRemoteFile }, { kind: 'remote', sessionId: assetId })
      expect(renamed).toEqual({ ok: true, data: expect.objectContaining({ affected: 1, path: renamedRemoteFile }) })

      const downloaded = await backends.files.transferFileEntry(
        { kind: 'download-file', remotePath: renamedRemoteFile, localPath: localDownload },
        { kind: 'remote', sessionId: assetId, fromHost: liveConfig.host, toHost: '127.0.0.1' }
      )
      expect(downloaded).toEqual({ ok: true, data: expect.objectContaining({ status: 'success', source: renamedRemoteFile, target: localDownload }) })
      expect(await readFile(localDownload, 'utf-8')).toBe(`${marker}\n`)

      await writeFile(localUpload, `${marker}-upload\n`, 'utf-8')
      const uploaded = await backends.files.transferFileEntry(
        { kind: 'upload-file', localPath: localUpload, remoteDirectory: remoteDir },
        { kind: 'remote', sessionId: assetId, fromHost: '127.0.0.1', toHost: liveConfig.host }
      )
      expect(uploaded).toEqual({ ok: true, data: expect.objectContaining({ status: 'success', source: localUpload, target: uploadedRemoteFile }) })
      const uploadedRead = await backends.files.readFileContent(uploadedRemoteFile, { kind: 'remote', sessionId: assetId, host: liveConfig.host })
      expect(uploadedRead).toEqual({ ok: true, data: expect.objectContaining({ content: `${marker}-upload\n` }) })
    } finally {
      await backends.files.mutateFileEntry({ kind: 'delete', path: remoteDir, recursive: true }, { kind: 'remote', sessionId: assetId }).catch(() => undefined)
    }
  }, liveTestTimeoutMs)

  it('opens a real SSH terminal session and streams shell output only from ssh2 data events', async () => {
    const marker = `AIOPSTERM_LIVE_TERMINAL_${randomUUID().replace(/-/g, '')}`
    const events: { lifecycle: TerminalLifecycleEvent[]; data: string[]; exit: Array<{ event: TerminalLifecycleEvent; code?: number | null }>; closed: string[] } = {
      lifecycle: [],
      data: [],
      exit: [],
      closed: []
    }
    let shellReadyResolve!: (event: TerminalLifecycleEvent) => void
    let shellReadyReject!: (error: Error) => void
    const shellReady = new Promise<TerminalLifecycleEvent>((resolve, reject) => {
      shellReadyResolve = resolve
      shellReadyReject = reject
    })
    let markerResolve!: (output: string) => void
    const markerSeen = new Promise<string>((resolve) => {
      markerResolve = resolve
    })
    let combinedOutput = ''

    const result = backends.sshTerminal.createSshTerminalSession(
      'live-ssh-terminal',
      { kind: 'ssh', assetId, cols: 100, rows: 30 },
      {
        lifecycle: (event: TerminalLifecycleEvent) => {
          events.lifecycle.push(event)
          if (event.stage === 'shell-ready') shellReadyResolve(event)
          if (event.stage === 'error') shellReadyReject(new Error(event.errorMessage || event.message || 'SSH terminal failed'))
        },
        data: (chunk: string | Buffer) => {
          const text = Buffer.isBuffer(chunk) ? chunk.toString('utf-8') : String(chunk)
          events.data.push(text)
          combinedOutput += text
          if (combinedOutput.includes(marker)) markerResolve(combinedOutput)
        },
        exit: (event: TerminalLifecycleEvent, code?: number | null) => events.exit.push({ event, code }),
        closed: (id: string) => events.closed.push(id)
      }
    )

    try {
      await withTimeout(shellReady, liveConfig.timeoutMs + 5000, 'Timed out waiting for live SSH shell readiness')
      result.session?.write(`printf '%s\\n' '${marker}'\n`)
      const output = await withTimeout(markerSeen, liveConfig.timeoutMs + 5000, 'Timed out waiting for live SSH terminal output')

      expect(output).toContain(marker)
      expect(events.lifecycle.map((event) => event.stage)).toEqual(expect.arrayContaining(['connecting', 'connected', 'shell-ready']))
      expect(events.data.join('')).not.toContain('[aiopsterm]')
    } finally {
      result.session?.kill('manual')
    }
  }, liveTestTimeoutMs)
})
