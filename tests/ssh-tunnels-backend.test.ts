import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/aiopsterm-ssh-tunnels-test'
  }
}))

vi.mock('electron-store', () => {
  class MockStore<T extends Record<string, unknown>> {
    store: T

    constructor(options?: { defaults?: T }) {
      this.store = JSON.parse(JSON.stringify(options?.defaults || {}))
    }

    get<K extends keyof T>(key: K): T[K] {
      return this.store[key]
    }

    set<K extends keyof T>(key: K, value: T[K]) {
      this.store[key] = value
    }
  }

  return { default: MockStore }
})

vi.mock('better-sqlite3', () => {
  throw new Error('force electron-store tunnel backend in tests')
})

const loadBackends = async () => {
  vi.resetModules()
  const assetsModulePath = '../src/main/backend/assets'
  const tunnelsModulePath = '../src/main/backend/sshTunnels'
  const assets = await import(assetsModulePath)
  const tunnels = await import(tunnelsModulePath)
  return { assets, tunnels }
}

describe('ssh tunnel backend boundary', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('rejects missing and unsupported asset ids before mutating asset rows', async () => {
    const { assets, tunnels } = await loadBackends()
    const before = assets.listAssets()

    const missing = tunnels.startSshTunnel({ assetId: 'missing-host' })
    const local = tunnels.startSshTunnel({ assetId: 'local-127-1' })
    const organization = tunnels.startSshTunnel({ assetId: 'asset-5' })

    expect(missing).toMatchObject({ ok: false, errorCode: 'SSH_TUNNEL_ASSET_NOT_FOUND' })
    expect(local).toMatchObject({ ok: false, errorCode: 'SSH_TUNNEL_START_FAILED' })
    expect(local.errorMessage).toContain('本地连接不支持 SSH 隧道')
    expect(organization).toMatchObject({ ok: false, errorCode: 'SSH_TUNNEL_START_FAILED' })
    expect(organization.errorMessage).toContain('只有 SSH 主机资产支持隧道')
    expect(assets.listAssets().assets).toEqual(before.assets)
  })

  it('starts a tunnel by saving active state through the asset backend snapshot', async () => {
    const { assets, tunnels } = await loadBackends()

    const result = tunnels.startSshTunnel({
      assetId: 'asset-4',
      type: 'local_forward',
      localPort: 3307,
      remoteHost: '127.0.0.1',
      remotePort: 3306
    })

    expect(result.ok).toBe(true)
    expect(result.data?.tunnel).toMatchObject({
      assetId: 'asset-4',
      tunnelId: 'tunnel-asset-4',
      type: 'local_forward',
      state: 'active',
      localPort: 3307,
      remoteHost: '127.0.0.1',
      remotePort: 3306
    })
    expect(result.data?.assets.find((asset: { id: string }) => asset.id === 'asset-4')).toMatchObject({ tunnelState: 'active' })
    expect(assets.listAssets().assets.find((asset: { id: string }) => asset.id === 'asset-4')).toMatchObject({ tunnelState: 'active' })
  })

  it('stops an active tunnel by saving created state through the asset backend snapshot', async () => {
    const { assets, tunnels } = await loadBackends()

    tunnels.startSshTunnel({ assetId: 'asset-4' })
    const stopped = tunnels.stopSshTunnel({ assetId: 'asset-4' })

    expect(stopped.ok).toBe(true)
    expect(stopped.data?.tunnel).toMatchObject({
      assetId: 'asset-4',
      tunnelId: 'tunnel-asset-4',
      state: 'created'
    })
    expect(stopped.data?.message).toContain('隧道已停止 legacy-node')
    expect(assets.listAssets().assets.find((asset: { id: string }) => asset.id === 'asset-4')).toMatchObject({ tunnelState: 'created' })
  })
})
