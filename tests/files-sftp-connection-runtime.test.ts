import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/main/backend/assets/assets', () => ({
  getAsset: () => null,
  getAssetSecret: () => ({}),
  getKeychainSecret: () => ({})
}))

vi.mock('../src/main/backend/ssh/sshAgent', () => ({
  createConfiguredSshAgentAuth: () => null
}))

vi.mock('../src/main/backend/ssh/sshProxy', () => ({
  createSshProxySocketForAsset: () => null
}))

vi.mock('../src/main/backend/ssh/ssh2Runtime', () => ({
  loadSsh2: () => null
}))

type ConnectionRuntime = {
  FilesSftpUnsupportedError: new (message: string, errorCode: string) => Error & { errorCode: string }
  isFilesSftpUnsupportedError: (error: unknown) => boolean
  sftpUnavailableError: (errorCode?: string, errorMessage?: string) => Record<string, unknown>
  sftpUnavailableMessage: string
  clearRemoteSftpPool: () => void
  getRemoteSftpPoolSnapshotForTests: () => { active: unknown[]; pending: number }
}

const loadRuntime = async () => {
  const modulePath = '../src/main/backend/files/filesSftpConnectionRuntime'
  return (await import(modulePath)) as ConnectionRuntime
}

describe('filesSftpConnectionRuntime', () => {
  it('keeps unsupported SFTP errors and unavailable envelopes behind the connection boundary', async () => {
    const runtime = await loadRuntime()
    const error = new runtime.FilesSftpUnsupportedError('jump host unsupported', 'FILES_SFTP_JUMP_UNSUPPORTED')

    expect(runtime.isFilesSftpUnsupportedError(error)).toBe(true)
    expect(runtime.sftpUnavailableError(error.errorCode, error.message)).toEqual({
      ok: false,
      errorCode: 'FILES_SFTP_JUMP_UNSUPPORTED',
      errorMessage: 'jump host unsupported'
    })
    expect(runtime.sftpUnavailableError()).toEqual({
      ok: false,
      errorCode: 'FILES_SFTP_UNAVAILABLE',
      errorMessage: runtime.sftpUnavailableMessage
    })
  })

  it('exposes an empty pool snapshot after clearing runtime connections', async () => {
    const runtime = await loadRuntime()

    runtime.clearRemoteSftpPool()

    expect(runtime.getRemoteSftpPoolSnapshotForTests()).toEqual({ active: [], pending: 0 })
  })
})
