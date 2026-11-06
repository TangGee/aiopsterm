import { describe, expect, it, vi } from 'vitest'
const assets = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@/services/assets/assetsClient', () => ({ assetsClient: { listAssets: () => assets.list } }))
import { createTerminalControlSurfaceAssetHandlers } from '@/services/terminal/terminalControlSurfaceAssets'

const fixture = () => {
  const panels: any[] = []
  const workspace = {
    panels, createPanel: vi.fn(() => { const panel = { id: `p-${panels.length}` }; panels.push(panel); return panel }),
    renamePanel: vi.fn(), replaceTerminalOutput: vi.fn(), registerSshSession: vi.fn(), activateTerminalPanel: vi.fn()
  }
  const start = vi.fn(async (panel: any) => { panel.sessionId = 'connected'; return true })
  const handlers = createTerminalControlSurfaceAssetHandlers({ workspace: workspace as any, startSshTerminalForPanel: start, controlWorkspaceRemote: { value: null }, workspaceRemoteSummaryForControl: () => null, workspaceSnapshotForControl: () => ({} as any), surfaceSummaryForControl: panel => ({ id: panel.id } as any) })
  return { handlers, workspace, start }
}
describe('gateway saved host creation', () => {
  it('creates the exact saved asset despite another host sharing its ID as a name', async () => {
    assets.list.mockResolvedValue({ assets: [{ id: 'allowed-id', name: 'Allowed', host: 'allowed.example' }, { id: 'other', name: 'allowed-id', host: 'other.example' }] })
    const { handlers, workspace, start } = fixture()
    expect(await handlers.handleAssetControlRequest('asset.ssh.connect', { assetId: 'allowed-id', exactAssetId: true, reuse: false })).toMatchObject({ ok: true, data: { connected: true, created: true } })
    expect(workspace.registerSshSession).toHaveBeenCalledWith('p-0', expect.objectContaining({ id: 'allowed-id', host: 'allowed.example' }))
    expect(start).toHaveBeenCalledOnce()
  })
  it('does not fall back to host-name lookup when the authorized asset was deleted', async () => {
    assets.list.mockResolvedValue({ assets: [{ id: 'other', name: 'deleted-id', host: 'other.example' }] })
    const { handlers, workspace, start } = fixture()
    expect(await handlers.handleAssetControlRequest('asset.ssh.connect', { assetId: 'deleted-id', exactAssetId: true, reuse: false })).toMatchObject({ ok: false, errorCode: 'ASSET_TARGET_NOT_FOUND' })
    expect(workspace.createPanel).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled()
  })
  it('retains a newly created panel when SSH authentication has not completed', async () => {
    assets.list.mockResolvedValue({ assets: [{ id: 'asset', name: 'Host', host: 'server' }] })
    const { handlers, workspace, start } = fixture()
    start.mockResolvedValue(false)
    expect(await handlers.handleAssetControlRequest('asset.ssh.connect', { assetId: 'asset', exactAssetId: true, reuse: false })).toMatchObject({ ok: true, data: { connected: false, created: true } })
    expect(workspace.panels).toHaveLength(1)
  })
})
