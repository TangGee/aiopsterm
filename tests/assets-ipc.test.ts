import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMain } from 'electron'

const backendMocks = vi.hoisted(() => ({
  confirmAssetImport: vi.fn(),
  deleteAsset: vi.fn(),
  deleteAssetGroup: vi.fn(),
  deleteAssetFolder: vi.fn(),
  deleteKeychain: vi.fn(),
  exportAssets: vi.fn(),
  getAssetEditableSecret: vi.fn(),
  getKeychain: vi.fn(),
  listAssets: vi.fn(),
  listAssetGroups: vi.fn(),
  listKeychains: vi.fn(),
  listSshAgentKeychainOptions: vi.fn(),
  previewAssetImport: vi.fn(),
  refreshOrganizationAssets: vi.fn(),
  renameAssetGroup: vi.fn(),
  saveAsset: vi.fn(),
  saveAssetFolder: vi.fn(),
  saveKeychain: vi.fn(),
  startSshTunnel: vi.fn(),
  stopSshTunnel: vi.fn(),
  testAssetConnection: vi.fn()
}))

vi.mock('../src/main/backend/assets/assets', () => ({
  confirmAssetImport: backendMocks.confirmAssetImport,
  deleteAsset: backendMocks.deleteAsset,
  deleteAssetGroup: backendMocks.deleteAssetGroup,
  deleteAssetFolder: backendMocks.deleteAssetFolder,
  deleteKeychain: backendMocks.deleteKeychain,
  exportAssets: backendMocks.exportAssets,
  getAssetEditableSecret: backendMocks.getAssetEditableSecret,
  getKeychain: backendMocks.getKeychain,
  listAssets: backendMocks.listAssets,
  listAssetGroups: backendMocks.listAssetGroups,
  listKeychains: backendMocks.listKeychains,
  listSshAgentKeychainOptions: backendMocks.listSshAgentKeychainOptions,
  previewAssetImport: backendMocks.previewAssetImport,
  refreshOrganizationAssets: backendMocks.refreshOrganizationAssets,
  renameAssetGroup: backendMocks.renameAssetGroup,
  saveAsset: backendMocks.saveAsset,
  saveAssetFolder: backendMocks.saveAssetFolder,
  saveKeychain: backendMocks.saveKeychain,
  testAssetConnection: backendMocks.testAssetConnection
}))

vi.mock('../src/main/backend/ssh/sshTunnels', () => ({
  startSshTunnel: backendMocks.startSshTunnel,
  stopSshTunnel: backendMocks.stopSshTunnel
}))

type IpcHandler = (event: unknown, ...args: any[]) => unknown

type AssetsIpcBackend = {
  registerAssetsIpc: (ipcMain: IpcMain, input: { showSaveDialog: (...args: any[]) => Promise<unknown> }) => void
}

const loadBackend = async () => {
  const modulePath = '../src/main/ipc/assets'
  return (await import(modulePath)) as AssetsIpcBackend
}

const createIpcHarness = () => {
  const handlers = new Map<string, IpcHandler>()
  const ipcMain = {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      handlers.set(channel, handler)
    })
  } as unknown as IpcMain
  return { ipcMain, handlers }
}

describe('assets IPC registrar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    backendMocks.listAssets.mockReturnValue([{ id: 'asset-1', name: 'prod-bastion' }])
    backendMocks.listAssetGroups.mockReturnValue([{ name: 'Production' }])
    backendMocks.renameAssetGroup.mockReturnValue({ ok: true, data: { groups: ['Renamed'] } })
    backendMocks.deleteAssetGroup.mockReturnValue({ ok: true, data: { groups: [] } })
    backendMocks.saveAsset.mockReturnValue({ ok: true, data: { id: 'asset-1', name: 'prod-bastion' } })
    backendMocks.getAssetEditableSecret.mockReturnValue({ ok: true, data: { assetId: 'asset-1', password: 'secret' } })
    backendMocks.testAssetConnection.mockResolvedValue({ ok: true, data: { status: 'ok' } })
    backendMocks.deleteAsset.mockReturnValue({ ok: true, data: { deletedId: 'asset-1' } })
    backendMocks.refreshOrganizationAssets.mockReturnValue({ ok: true, data: { assets: [] } })
    backendMocks.previewAssetImport.mockReturnValue({ ok: true, data: { rows: [] } })
    backendMocks.confirmAssetImport.mockReturnValue({ ok: true, data: { imported: 1 } })
    backendMocks.exportAssets.mockResolvedValue({ ok: true, data: { filePath: '/tmp/external-reference-assets.json', count: 1 } })
    backendMocks.startSshTunnel.mockResolvedValue({ ok: true, data: { tunnel: { tunnelId: 'tunnel-1' } } })
    backendMocks.stopSshTunnel.mockResolvedValue({ ok: true, data: { tunnel: { tunnelId: 'tunnel-1' } } })
    backendMocks.saveAssetFolder.mockReturnValue({ ok: true, data: { uuid: 'folder-1' } })
    backendMocks.deleteAssetFolder.mockReturnValue({ ok: true, data: { uuid: 'folder-1' } })
    backendMocks.listKeychains.mockReturnValue([{ id: 'key-1', name: 'prod-ed25519' }])
    backendMocks.listSshAgentKeychainOptions.mockReturnValue([{ key: 'key-1', label: 'prod-ed25519' }])
    backendMocks.getKeychain.mockReturnValue({ id: 'key-1', name: 'prod-ed25519' })
    backendMocks.saveKeychain.mockReturnValue({ ok: true, data: { id: 'key-1', name: 'prod-ed25519' } })
    backendMocks.deleteKeychain.mockReturnValue({ ok: true, data: { id: 'key-1' } })
  })

  it('registers stable asset, tunnel, folder, and keychain channels', async () => {
    const { registerAssetsIpc } = await loadBackend()
    const { ipcMain, handlers } = createIpcHarness()

    registerAssetsIpc(ipcMain, { showSaveDialog: vi.fn() })

    expect([...handlers.keys()]).toEqual([
      'assets:list',
      'assets:groups:list',
      'assets:groups:rename',
      'assets:groups:delete',
      'assets:save',
      'assets:editable-secret:get',
      'assets:test-connection',
      'assets:delete',
      'assets:organization:refresh',
      'assets:import:preview',
      'assets:import:confirm',
      'assets:export',
      'ssh:tunnel:start',
      'ssh:tunnel:stop',
      'assets:folder:save',
      'assets:folder:delete',
      'assets:keychains:list',
      'assets:keychains:ssh-agent-options',
      'assets:keychains:get',
      'assets:keychains:save',
      'assets:keychains:delete'
    ])
  })

  it('forwards asset catalog, mutation, import, tunnel, and keychain requests to backend boundaries', async () => {
    const { registerAssetsIpc } = await loadBackend()
    const { ipcMain, handlers } = createIpcHarness()
    const showSaveDialog = vi.fn(async () => ({ canceled: false, filePath: '/tmp/assets.json' }))

    registerAssetsIpc(ipcMain, { showSaveDialog })

    expect(await handlers.get('assets:list')?.({})).toEqual([{ id: 'asset-1', name: 'prod-bastion' }])
    expect(await handlers.get('assets:groups:list')?.({}, { assetTypes: ['person'] })).toEqual([{ name: 'Production' }])
    expect(backendMocks.listAssetGroups).toHaveBeenCalledWith({ assetTypes: ['person'] })

    expect(await handlers.get('assets:save')?.({}, { id: 'asset-1', name: 'prod-bastion' })).toEqual({
      ok: true,
      data: { id: 'asset-1', name: 'prod-bastion' }
    })
    expect(backendMocks.saveAsset).toHaveBeenCalledWith({ id: 'asset-1', name: 'prod-bastion' })

    expect(await handlers.get('assets:editable-secret:get')?.({}, 'asset-1')).toEqual({
      ok: true,
      data: { assetId: 'asset-1', password: 'secret' }
    })
    expect(await handlers.get('assets:import:preview')?.({}, { filePath: '/tmp/assets.json' })).toEqual({ ok: true, data: { rows: [] } })
    expect(await handlers.get('assets:import:confirm')?.({}, { filePath: '/tmp/assets.json', overwrite: false })).toEqual({
      ok: true,
      data: { imported: 1 }
    })

    expect(await handlers.get('ssh:tunnel:start')?.({}, { assetId: 'asset-1', localPort: 15432 })).toEqual({
      ok: true,
      data: { tunnel: { tunnelId: 'tunnel-1' } }
    })
    expect(backendMocks.startSshTunnel).toHaveBeenCalledWith({ assetId: 'asset-1', localPort: 15432 })
    expect(await handlers.get('ssh:tunnel:stop')?.({}, { assetId: 'asset-1' })).toEqual({
      ok: true,
      data: { tunnel: { tunnelId: 'tunnel-1' } }
    })

    expect(await handlers.get('assets:keychains:list')?.({})).toEqual([{ id: 'key-1', name: 'prod-ed25519' }])
    expect(await handlers.get('assets:keychains:get')?.({}, 'key-1')).toEqual({ id: 'key-1', name: 'prod-ed25519' })
    expect(await handlers.get('assets:keychains:save')?.({}, { id: 'key-1', name: 'prod-ed25519' })).toEqual({
      ok: true,
      data: { id: 'key-1', name: 'prod-ed25519' }
    })
    expect(await handlers.get('assets:keychains:delete')?.({}, 'key-1')).toEqual({ ok: true, data: { id: 'key-1' } })
  })

  it('passes the injected save-dialog adapter to asset export', async () => {
    const { registerAssetsIpc } = await loadBackend()
    const { ipcMain, handlers } = createIpcHarness()
    const showSaveDialog = vi.fn(async () => ({ canceled: false, filePath: '/tmp/assets.json' }))

    registerAssetsIpc(ipcMain, { showSaveDialog })

    await expect(handlers.get('assets:export')?.({}, { assetIds: ['asset-1'] })).resolves.toEqual({
      ok: true,
      data: { filePath: '/tmp/external-reference-assets.json', count: 1 }
    })
    expect(backendMocks.exportAssets).toHaveBeenCalledWith({ assetIds: ['asset-1'] }, { showSaveDialog })
  })
})
