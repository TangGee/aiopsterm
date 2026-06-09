import { createHash } from 'crypto'
import { existsSync, readFileSync } from 'fs'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

type AppUpdateTestOptions = {
  manifestPath?: string
  cacheDir?: string
}

let checkAppUpdate: (currentVersion: string, options?: AppUpdateTestOptions) => any
let downloadAppUpdate: (
  input: { version?: string },
  emit?: (event: { status: string; version: string; percent: number; message?: string }) => void,
  options?: AppUpdateTestOptions
) => Promise<any>
let installAppUpdate: (input?: { version?: string }) => Promise<any>
let resetAppUpdateStateForTests: () => void

const sha256 = (content: string | Buffer) => createHash('sha256').update(content).digest('hex')

const createUpdateFixture = async (input: {
  version?: string
  channel?: string
  packageName?: string
  packageContent?: string
  sha256?: string
  size?: number
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
        notes: 'test update'
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

  it('requires a downloaded cache package before install and returns the cached file path', async () => {
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
      const result = await installAppUpdate({ version: '0.1.5' })

      expect(result.ok).toBe(true)
      expect(result.data).toMatchObject({
        version: '0.1.5',
        status: 'install-requested',
        filePath: downloaded.data.filePath,
        size: Buffer.byteLength(fixture.packageContent),
        sha256: sha256(fixture.packageContent),
        message: 'Update 0.1.5 install requested with cached package.'
      })
      expect(result.data.requestedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })
})
