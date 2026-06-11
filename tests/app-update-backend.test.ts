import { createHash, generateKeyPairSync, sign } from 'crypto'
import { existsSync, readFileSync } from 'fs'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

type AppUpdateTestOptions = {
  manifestPath?: string
  cacheDir?: string
  trustedPublicKey?: string
  trustedPublicKeyPath?: string
}

type AppUpdateInstallTestOptions = {
  installer?: (input: { version: string; filePath: string; size: number; sha256?: string; signature?: unknown }) =>
    | { handoff: { kind: 'os-open'; accepted: true }; message?: string }
    | Promise<{ handoff: { kind: 'os-open'; accepted: true }; message?: string }>
}

let checkAppUpdate: (currentVersion: string, options?: AppUpdateTestOptions) => any
let downloadAppUpdate: (
  input: { version?: string },
  emit?: (event: { status: string; version: string; percent: number; message?: string }) => void,
  options?: AppUpdateTestOptions
) => Promise<any>
let installAppUpdate: (input?: { version?: string }, options?: AppUpdateInstallTestOptions) => Promise<any>
let resetAppUpdateStateForTests: () => void

const sha256 = (content: string | Buffer) => createHash('sha256').update(content).digest('hex')

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

const updateSignaturePayload = (input: { version: string; channel: string; fileName: string; size: number; sha256: string; notes?: string }) =>
  stableJson({
    version: input.version,
    channel: input.channel,
    fileName: input.fileName,
    size: input.size,
    sha256: input.sha256,
    ...(input.notes ? { notes: input.notes } : {})
  })

const createUpdateFixture = async (input: {
  version?: string
  channel?: string
  packageName?: string
  packageContent?: string
  sha256?: string
  size?: number
  signature?: string
  signatureAlgorithm?: string
  signatureKeyId?: string
}) => {
  const root = await mkdtemp(join(tmpdir(), 'aiopsterm-update-test-'))
  const packageContent = input.packageContent || 'aiopsterm update package'
  const packageName = input.packageName || 'aiopsterm-setup.bin'
  const packagePath = join(root, packageName)
  const manifestPath = join(root, 'latest.json')
  const cacheDir = join(root, 'cache')
  await writeFile(packagePath, packageContent)
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        version: input.version || '0.1.1',
        channel: input.channel || 'manual',
        packagePath: packageName,
        size: input.size ?? Buffer.byteLength(packageContent),
        sha256: input.sha256 ?? sha256(packageContent),
        notes: 'test update',
        ...(input.signature ? { signature: input.signature } : {}),
        ...(input.signatureAlgorithm ? { signatureAlgorithm: input.signatureAlgorithm } : {}),
        ...(input.signatureKeyId ? { signatureKeyId: input.signatureKeyId } : {})
      },
      null,
      2
    )
  )
  return {
    root,
    packageContent,
    packagePath,
    manifestPath,
    cacheDir,
    packageName
  }
}

const createSignedUpdateFixture = async (input: { version?: string; packageContent?: string; tamperSignaturePayload?: boolean } = {}) => {
  const version = input.version || '0.2.1'
  const packageContent = input.packageContent || 'signed update package'
  const packageName = 'aiopsterm-signed.bin'
  const digest = sha256(packageContent)
  const size = Buffer.byteLength(packageContent)
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const payload = updateSignaturePayload({
    version: input.tamperSignaturePayload ? `${version}.tampered` : version,
    channel: 'manual',
    fileName: packageName,
    size,
    sha256: digest,
    notes: 'test update'
  })
  const signature = sign(null, Buffer.from(payload, 'utf-8'), privateKey).toString('base64')
  const fixture = await createUpdateFixture({
    version,
    packageName,
    packageContent,
    sha256: digest,
    size,
    signature,
    signatureAlgorithm: 'ed25519',
    signatureKeyId: 'release-key-1'
  })
  return {
    ...fixture,
    trustedPublicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString()
  }
}

beforeAll(async () => {
  const modulePath = '../src/main/backend/appUpdate'
  const backend = await import(modulePath)
  checkAppUpdate = backend.checkAppUpdate as typeof checkAppUpdate
  downloadAppUpdate = backend.downloadAppUpdate as typeof downloadAppUpdate
  installAppUpdate = backend.installAppUpdate as typeof installAppUpdate
  resetAppUpdateStateForTests = backend.resetAppUpdateStateForTests as typeof resetAppUpdateStateForTests
})

beforeEach(() => {
  delete process.env.AIOPSTERM_UPDATE_MANIFEST
  delete process.env.AIOPSTERM_UPDATE_DIR
  delete process.env.AIOPSTERM_UPDATE_CACHE_DIR
  resetAppUpdateStateForTests()
})

describe('app update backend boundary', () => {
  it('reports latest local state when no update manifest is configured', () => {
    expect(checkAppUpdate('0.1.0')).toEqual({
      available: false,
      channel: 'local',
      isUpdateAvailable: false,
      versionInfo: { version: '0.1.0', channel: 'local' },
      updateInfo: null
    })
  })

  it('reports an available manual update from a backend-owned manifest package', async () => {
    const fixture = await createUpdateFixture({ version: '0.1.1', packageContent: 'package-v011' })

    try {
      expect(checkAppUpdate('0.1.0', { manifestPath: fixture.manifestPath })).toEqual({
        available: true,
        channel: 'manual',
        isUpdateAvailable: true,
        versionInfo: { version: '0.1.0', channel: 'manual' },
        updateInfo: {
          version: '0.1.1',
          channel: 'manual',
          fileName: fixture.packageName,
          size: Buffer.byteLength(fixture.packageContent),
          sha256: sha256(fixture.packageContent),
          notes: 'test update'
        }
      })
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })

  it('copies the real update package to a backend cache and emits byte-driven progress', async () => {
    const fixture = await createUpdateFixture({
      version: '0.1.2',
      packageContent: 'x'.repeat(128 * 1024)
    })
    const progress: Array<{ status: string; percent: number }> = []

    try {
      const result = await downloadAppUpdate(
        { version: '0.1.2' },
        (event) => progress.push(event),
        { manifestPath: fixture.manifestPath, cacheDir: fixture.cacheDir }
      )

      expect(result.ok).toBe(true)
      expect(result.data).toMatchObject({
        version: '0.1.2',
        status: 'downloaded',
        percent: 100,
        size: Buffer.byteLength(fixture.packageContent),
        sha256: sha256(fixture.packageContent),
        message: 'Update 0.1.2 downloaded to aiopsterm update cache.'
      })
      expect(result.data.filePath).toContain(fixture.cacheDir)
      expect(existsSync(result.data.filePath)).toBe(true)
      expect(readFileSync(result.data.filePath, 'utf-8')).toBe(fixture.packageContent)
      expect(progress.length).toBeGreaterThan(1)
      expect(progress.at(-1)).toMatchObject({ status: 'downloaded', percent: 100 })
      expect(progress.some((event) => event.status === 'downloading' && event.percent > 0 && event.percent < 100)).toBe(true)
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })

  it('rejects downloads without a configured manifest or matching version', async () => {
    await expect(downloadAppUpdate({})).resolves.toEqual({
      ok: false,
      errorCode: 'APP_UPDATE_VERSION_REQUIRED',
      errorMessage: 'Update version is required.'
    })

    await expect(downloadAppUpdate({ version: '0.1.2' })).resolves.toEqual({
      ok: false,
      errorCode: 'APP_UPDATE_MANIFEST_REQUIRED',
      errorMessage: 'Update manifest is not configured.'
    })

    const fixture = await createUpdateFixture({ version: '0.1.3' })
    try {
      await expect(downloadAppUpdate({ version: '0.1.2' }, undefined, { manifestPath: fixture.manifestPath })).resolves.toEqual({
        ok: false,
        errorCode: 'APP_UPDATE_VERSION_MISMATCH',
        errorMessage: 'Requested update version does not match the manifest.'
      })
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })

  it('rejects package checksum mismatches and leaves no installable package state', async () => {
    const fixture = await createUpdateFixture({
      version: '0.1.4',
      packageContent: 'real package',
      sha256: sha256('different package')
    })
    const progress: Array<{ status: string; percent: number; message?: string }> = []

    try {
      await expect(
        downloadAppUpdate({ version: '0.1.4' }, (event) => progress.push(event), {
          manifestPath: fixture.manifestPath,
          cacheDir: fixture.cacheDir
        })
      ).resolves.toEqual({
        ok: false,
        errorCode: 'APP_UPDATE_CHECKSUM_MISMATCH',
        errorMessage: 'Update package checksum does not match the manifest.'
      })
      expect(progress.at(-1)).toMatchObject({
        status: 'error',
        percent: 0,
        message: 'Update package checksum does not match the manifest.'
      })
      await expect(installAppUpdate({ version: '0.1.4' })).resolves.toEqual({
        ok: false,
        errorCode: 'APP_UPDATE_DOWNLOAD_REQUIRED',
        errorMessage: 'Update package must be downloaded before install.'
      })
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })

  it('requires a downloaded cache package and configured installer before install handoff', async () => {
    const fixture = await createUpdateFixture({ version: '0.1.5', packageContent: 'package-v015' })

    try {
      await expect(installAppUpdate({ version: '0.1.5' })).resolves.toEqual({
        ok: false,
        errorCode: 'APP_UPDATE_DOWNLOAD_REQUIRED',
        errorMessage: 'Update package must be downloaded before install.'
      })

      const downloaded = await downloadAppUpdate({ version: '0.1.5' }, undefined, {
        manifestPath: fixture.manifestPath,
        cacheDir: fixture.cacheDir
      })
      await expect(installAppUpdate({ version: '0.1.5' })).resolves.toEqual({
        ok: false,
        errorCode: 'APP_UPDATE_INSTALLER_UNAVAILABLE',
        errorMessage: 'Update installer handoff is not configured.'
      })

      const installer = vi.fn(async () => ({
        handoff: {
          kind: 'os-open' as const,
          accepted: true as const
        },
        message: 'test installer accepted update package'
      }))
      const result = await installAppUpdate({ version: '0.1.5' }, { installer })

      expect(result.ok).toBe(true)
      expect(installer).toHaveBeenCalledWith({
        version: '0.1.5',
        filePath: downloaded.data.filePath,
        size: Buffer.byteLength(fixture.packageContent),
        sha256: sha256(fixture.packageContent)
      })
      expect(result.data).toMatchObject({
        version: '0.1.5',
        status: 'install-requested',
        filePath: downloaded.data.filePath,
        size: Buffer.byteLength(fixture.packageContent),
        sha256: sha256(fixture.packageContent),
        handoff: {
          kind: 'os-open',
          accepted: true
        },
        message: 'test installer accepted update package'
      })
      expect(result.data.requestedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })

  it('verifies signed update manifests with a trusted public key before download and install', async () => {
    const fixture = await createSignedUpdateFixture({ version: '0.2.2', packageContent: 'signed package v022' })

    try {
      expect(checkAppUpdate('0.2.1', { manifestPath: fixture.manifestPath, trustedPublicKey: fixture.trustedPublicKey })).toMatchObject({
        available: true,
        updateInfo: {
          version: '0.2.2',
          signature: {
            algorithm: 'ed25519',
            verified: true,
            keyId: 'release-key-1'
          }
        }
      })

      const downloaded = await downloadAppUpdate({ version: '0.2.2' }, undefined, {
        manifestPath: fixture.manifestPath,
        cacheDir: fixture.cacheDir,
        trustedPublicKey: fixture.trustedPublicKey
      })
      expect(downloaded.ok).toBe(true)
      expect(downloaded.data?.signature).toEqual({
        algorithm: 'ed25519',
        verified: true,
        keyId: 'release-key-1'
      })

      const installer = vi.fn(async () => ({
        handoff: {
          kind: 'os-open' as const,
          accepted: true as const
        }
      }))
      const installed = await installAppUpdate({ version: '0.2.2' }, { installer })
      expect(installed.ok).toBe(true)
      expect(installer).toHaveBeenCalledWith({
        version: '0.2.2',
        filePath: downloaded.data.filePath,
        size: Buffer.byteLength(fixture.packageContent),
        sha256: sha256(fixture.packageContent),
        signature: {
          algorithm: 'ed25519',
          verified: true,
          keyId: 'release-key-1'
        }
      })
      expect(installed.data?.signature).toEqual({
        algorithm: 'ed25519',
        verified: true,
        keyId: 'release-key-1'
      })
      expect(installed.data?.handoff).toEqual({
        kind: 'os-open',
        accepted: true
      })
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })

  it('fails install handoff when the operating system opener rejects the cached package', async () => {
    const fixture = await createUpdateFixture({ version: '0.1.6', packageContent: 'package-v016' })

    try {
      await expect(
        downloadAppUpdate({ version: '0.1.6' }, undefined, {
          manifestPath: fixture.manifestPath,
          cacheDir: fixture.cacheDir
        })
      ).resolves.toMatchObject({ ok: true })

      await expect(
        installAppUpdate(
          { version: '0.1.6' },
          {
            installer: async () => {
              throw new Error('no application is associated with this package')
            }
          }
        )
      ).resolves.toEqual({
        ok: false,
        errorCode: 'APP_UPDATE_INSTALL_HANDOFF_FAILED',
        errorMessage: 'no application is associated with this package'
      })

      const secondInstaller = vi.fn(async () => ({
        handoff: {
          kind: 'os-open' as const,
          accepted: true as const
        }
      }))
      await expect(installAppUpdate({ version: '0.1.6' }, { installer: secondInstaller })).resolves.toMatchObject({
        ok: true,
        data: {
          version: '0.1.6',
          status: 'install-requested',
          handoff: {
            kind: 'os-open',
            accepted: true
          }
        }
      })
      expect(secondInstaller).toHaveBeenCalledTimes(1)
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })

  it('rejects install handoff results that do not confirm an accepted OS handoff', async () => {
    const fixture = await createUpdateFixture({ version: '0.1.7', packageContent: 'package-v017' })

    try {
      await expect(
        downloadAppUpdate({ version: '0.1.7' }, undefined, {
          manifestPath: fixture.manifestPath,
          cacheDir: fixture.cacheDir
        })
      ).resolves.toMatchObject({ ok: true })

      await expect(
        installAppUpdate(
          { version: '0.1.7' },
          {
            installer: async () =>
              ({
                handoff: {
                  kind: 'os-open',
                  accepted: false
                }
              }) as any
          }
        )
      ).resolves.toEqual({
        ok: false,
        errorCode: 'APP_UPDATE_INSTALL_HANDOFF_FAILED',
        errorMessage: 'Update installer handoff was not accepted by the operating system.'
      })
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })

  it('rejects tampered signed update manifests and leaves no installable package state', async () => {
    const fixture = await createSignedUpdateFixture({ version: '0.2.3', packageContent: 'signed package v023', tamperSignaturePayload: true })
    const progress: Array<{ status: string; percent: number; message?: string }> = []

    try {
      await expect(
        downloadAppUpdate({ version: '0.2.3' }, (event) => progress.push(event), {
          manifestPath: fixture.manifestPath,
          cacheDir: fixture.cacheDir,
          trustedPublicKey: fixture.trustedPublicKey
        })
      ).resolves.toEqual({
        ok: false,
        errorCode: 'APP_UPDATE_MANIFEST_INVALID',
        errorMessage: 'aiopsterm update manifest signature is invalid.'
      })
      expect(progress.at(-1)).toMatchObject({
        status: 'error',
        percent: 0,
        message: 'aiopsterm update manifest signature is invalid.'
      })
      await expect(installAppUpdate({ version: '0.2.3' })).resolves.toEqual({
        ok: false,
        errorCode: 'APP_UPDATE_DOWNLOAD_REQUIRED',
        errorMessage: 'Update package must be downloaded before install.'
      })
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })

  it('rejects malformed signature fields instead of treating them as unsigned manifests', async () => {
    const { publicKey } = generateKeyPairSync('ed25519')
    const fixture = await createUpdateFixture({
      version: '0.2.4',
      packageContent: 'malformed signature package',
      signature: 'not valid base64 ***',
      signatureAlgorithm: 'ed25519',
      signatureKeyId: 'release-key-1'
    })

    try {
      await expect(
        downloadAppUpdate({ version: '0.2.4' }, undefined, {
          manifestPath: fixture.manifestPath,
          cacheDir: fixture.cacheDir,
          trustedPublicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString()
        })
      ).resolves.toEqual({
        ok: false,
        errorCode: 'APP_UPDATE_MANIFEST_INVALID',
        errorMessage: 'aiopsterm update manifest signature is required.'
      })
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })
})
