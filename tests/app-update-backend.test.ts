import { beforeAll, describe, expect, it } from 'vitest'

let checkAppUpdate: (currentVersion: string, options?: { latestVersion?: string; channel?: 'local' | 'manual' | 'auto' }) => any
let downloadAppUpdate: (
  input: { version?: string },
  emit?: (event: { status: string; version: string; percent: number }) => void,
  options?: { downloadStepDelayMs?: number }
) => Promise<any>
let installAppUpdate: (input?: { version?: string }) => Promise<any>

beforeAll(async () => {
  const modulePath = '../src/main/backend/appUpdate'
  const backend = await import(modulePath)
  checkAppUpdate = backend.checkAppUpdate as typeof checkAppUpdate
  downloadAppUpdate = backend.downloadAppUpdate as typeof downloadAppUpdate
  installAppUpdate = backend.installAppUpdate as typeof installAppUpdate
})

describe('app update backend boundary', () => {
  it('reports latest state from backend-owned version comparison', () => {
    expect(checkAppUpdate('0.1.0', { latestVersion: '0.1.0' })).toEqual({
      available: false,
      channel: 'local',
      isUpdateAvailable: false,
      versionInfo: { version: '0.1.0', channel: 'local' },
      updateInfo: null
    })
  })

  it('reports an available manual update with External reference-style updateInfo shape', () => {
    expect(checkAppUpdate('0.1.0', { latestVersion: '0.1.1', channel: 'manual' })).toEqual({
      available: true,
      channel: 'manual',
      isUpdateAvailable: true,
      versionInfo: { version: '0.1.0', channel: 'manual' },
      updateInfo: { version: '0.1.1', channel: 'manual' }
    })
  })

  it('downloads update progress and returns a backend-owned downloaded result', async () => {
    const progress: Array<{ status: string; percent: number }> = []
    const result = await downloadAppUpdate({ version: '0.1.2' }, (event) => progress.push(event), { downloadStepDelayMs: 0 })

    expect(result).toEqual({
      ok: true,
      data: {
        version: '0.1.2',
        status: 'downloaded',
        percent: 100,
        message: 'Update 0.1.2 downloaded by aiopsterm backend.'
      }
    })
    expect(progress.map((event) => event.percent)).toEqual([8, 32, 56, 80, 100])
    expect(progress.at(-1)).toMatchObject({ status: 'downloaded', percent: 100 })
  })

  it('rejects download without a version', async () => {
    await expect(downloadAppUpdate({}, undefined, { downloadStepDelayMs: 0 })).resolves.toEqual({
      ok: false,
      errorCode: 'APP_UPDATE_VERSION_REQUIRED',
      errorMessage: 'Update version is required.'
    })
  })

  it('requests install for the downloaded update version', async () => {
    await downloadAppUpdate({ version: '0.1.3' }, undefined, { downloadStepDelayMs: 0 })

    await expect(installAppUpdate({ version: '0.1.3' })).resolves.toEqual({
      ok: true,
      data: {
        version: '0.1.3',
        status: 'install-requested',
        message: 'Update 0.1.3 install requested by aiopsterm backend.'
      }
    })
  })
})
