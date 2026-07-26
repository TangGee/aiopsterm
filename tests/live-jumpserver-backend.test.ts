import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'module'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { AiopsAssetRecord } from '../src/shared/contracts/assets'

const requireNative = createRequire(__filename)
const Database = requireNative('better-sqlite3')

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/aiopsterm-live-jumpserver-test'
  }
}))

const apiUrl = String(process.env.AIOPSTERM_LIVE_JUMPSERVER_URL || '').trim().replace(/\/+$/, '')
const privateToken = String(process.env.AIOPSTERM_LIVE_JUMPSERVER_TOKEN || '').trim()
const liveDescribe = apiUrl && privateToken ? describe : describe.skip
const tempDirs: string[] = []

type JumpserverPlatform = {
  id: number
  name: string
}

type JumpserverHost = {
  id: string
  name: string
  address: string
}

const apiRequest = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Token ${privateToken}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers
    }
  })
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`JumpServer ${init.method || 'GET'} ${path} failed with HTTP ${response.status}: ${detail}`)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

liveDescribe('JumpServer live asset refresh integration', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('creates, updates and removes a real JumpServer host through the aiopsterm SQLite backend', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'aiopsterm-live-jumpserver-'))
    tempDirs.push(stateDir)
    const databasePath = join(stateDir, 'aiopsterm-state.db')
    const credentialKeyPath = join(stateDir, 'asset-credential.key')
    const modulePath = '../src/main/backend/assets/assets'
    const backend = await import(modulePath)
    backend.configureAssetBackendRuntime({
      databasePath,
      credentialKeyPath,
      useSeedData: false,
      sqliteFactory: Database,
      jumpserverFetch: globalThis.fetch
    })

    const platforms = await apiRequest<{ results: JumpserverPlatform[] }>('/api/v1/assets/platforms/?limit=100')
    const linuxPlatform = platforms.results.find((platform) => platform.name === 'Linux')
    expect(linuxPlatform).toBeTruthy()

    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
    const originalName = `aiopsterm-live-${suffix}`
    const updatedName = `${originalName}-renamed`
    let remoteHost: JumpserverHost | undefined

    try {
      remoteHost = await apiRequest<JumpserverHost>('/api/v1/assets/hosts/', {
        method: 'POST',
        body: JSON.stringify({
          name: originalName,
          address: '10.250.26.20',
          platform: linuxPlatform!.id,
          nodes: [],
          protocols: [{ name: 'ssh', port: 2202 }],
          is_active: true,
          comment: 'aiopsterm live JumpServer refresh test'
        })
      })

      const savedOrganization = backend.saveAsset({
        name: 'jumpserver-live-test',
        title: 'jumpserver-live-test',
        host: apiUrl,
        username: 'admin',
        port: 2222,
        asset_type: 'organization',
        auth_type: 'password',
        group: 'JumpServer Live',
        group_name: 'JumpServer Live',
        tags: ['jumpserver'],
        data_source: 'refresh',
        bastionType: 'jumpserver',
        jumpserverApiUrl: apiUrl,
        jumpserverToken: privateToken
      })
      expect(savedOrganization.ok, savedOrganization.errorMessage).toBe(true)
      const organization = savedOrganization.data!

      const created = await backend.refreshOrganizationAssets({ organizationId: organization.id })
      expect(created.ok, created.errorMessage).toBe(true)
      expect(created.data!.created).toBeGreaterThanOrEqual(1)
      expect(created.data!.assets).toContainEqual(
        expect.objectContaining({
          title: originalName,
          host: remoteHost.address,
          port: 2202,
          group: '/DEFAULT',
          data_source: 'refresh',
          organizationId: organization.uuid,
          jumpHostId: organization.id,
          jumpserverAssetId: remoteHost.id
        })
      )

      remoteHost = await apiRequest<JumpserverHost>(`/api/v1/assets/hosts/${remoteHost.id}/`, {
        method: 'PATCH',
        body: JSON.stringify({ name: updatedName })
      })

      const updated = await backend.refreshOrganizationAssets({ organizationId: organization.id })
      expect(updated.ok, updated.errorMessage).toBe(true)
      const matchingAssets = updated.data!.assets.filter(
        (asset: AiopsAssetRecord) => asset.jumpserverAssetId === remoteHost!.id
      )
      expect(matchingAssets).toHaveLength(1)
      expect(matchingAssets[0]).toEqual(expect.objectContaining({ title: updatedName, host: remoteHost.address }))

      await apiRequest<void>(`/api/v1/assets/hosts/${remoteHost.id}/`, { method: 'DELETE' })
      const deletedRemoteId = remoteHost.id
      remoteHost = undefined

      const deleted = await backend.refreshOrganizationAssets({ organizationId: organization.id })
      expect(deleted.ok, deleted.errorMessage).toBe(true)
      expect(deleted.data!.deleted).toBeGreaterThanOrEqual(1)
      expect(
        deleted.data!.assets.some((asset: AiopsAssetRecord) => asset.jumpserverAssetId === deletedRemoteId)
      ).toBe(false)
    } finally {
      if (remoteHost) {
        await apiRequest<void>(`/api/v1/assets/hosts/${remoteHost.id}/`, { method: 'DELETE' }).catch(() => undefined)
      }
    }
  }, 60_000)
})
