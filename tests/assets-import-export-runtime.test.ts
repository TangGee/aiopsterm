import { describe, expect, it, vi } from 'vitest'
import type { AiopsAssetInput, AiopsAssetRecord, AiopsAssetSnapshot } from '../src/shared/contracts/assets'

type AssetsImportExportRuntimeModule = {
  assetExportFileName(now?: Date): string
  assetExportPayload(asset: AiopsAssetRecord): Record<string, unknown>
  confirmAssetImportRuntime(input: { filePath: string; overwrite?: boolean }, runtime: TestAssetImportExportRuntime): Promise<any>
  exportAssetsRuntime(input: { assetIds: string[] }, exportRuntime: Record<string, unknown>, runtime: TestAssetImportExportRuntime): Promise<any>
  previewAssetImportRuntime(input: { filePath: string }, runtime: TestAssetImportExportRuntime): Promise<any>
  resolveAssetExportSelection(input: { assetIds: string[] }, assets: AiopsAssetRecord[]): AiopsAssetRecord[]
}

type TestAssetImportExportRuntime = {
  listAssets: () => AiopsAssetSnapshot
  saveAsset: (input: AiopsAssetInput) => AiopsAssetRecord
  readFile: (filePath: string, encoding: 'utf-8') => Promise<string>
  stat?: (filePath: string) => Promise<{ size: number }>
}

const loadRuntime = async () => {
  const modulePath = '../src/main/backend/assetsImportExportRuntime'
  return import(modulePath) as Promise<AssetsImportExportRuntimeModule>
}

const localAsset = {
  id: 'local-127-1',
  uuid: 'local-127-1',
  name: 'Local',
  title: 'Local',
  host: '127.0.0.1',
  ip: '127.0.0.1',
  group: '本地连接',
  group_name: '本地连接',
  status: 'online',
  tags: [],
  username: 'local',
  port: 22,
  asset_type: 'person',
  auth_type: 'password',
  comment: '',
  data_source: 'manual',
  isLocalShell: true
} satisfies AiopsAssetRecord

const asset = (overrides: Partial<AiopsAssetRecord>): AiopsAssetRecord => ({
  id: 'asset-1',
  uuid: 'asset-1',
  name: 'prod-bastion',
  title: 'prod-bastion',
  host: '10.24.8.12',
  ip: '10.24.8.12',
  group: '生产',
  group_name: '生产',
  status: 'online',
  tags: ['prod'],
  username: 'ops',
  port: 22,
  asset_type: 'person',
  auth_type: 'keyBased',
  comment: '生产入口',
  data_source: 'manual',
  keychainId: 'key-1',
  ...overrides
})

const createRuntime = (initialAssets: AiopsAssetRecord[], fileContent = '') => {
  let assets = initialAssets.map((item) => ({ ...item }))
  const readFile = vi.fn(async () => fileContent)
  const saveAsset = vi.fn((input: AiopsAssetInput) => {
    const next = asset({
      id: input.id || `asset-${assets.length + 1}`,
      uuid: input.id || `asset-${assets.length + 1}`,
      name: input.name,
      title: input.title || input.name,
      host: input.host,
      ip: input.ip || input.host,
      group: input.group || '',
      group_name: input.group_name || input.group || '',
      username: input.username || '',
      port: input.port || 22,
      asset_type: input.asset_type || 'person',
      auth_type: input.auth_type || 'password',
      comment: input.comment || '',
      data_source: input.data_source || 'manual',
      hasPassword: Boolean(input.password)
    })
    assets = assets.some((item) => item.id === next.id) ? assets.map((item) => (item.id === next.id ? next : item)) : [...assets, next]
    return next
  })
  const listAssets = (): AiopsAssetSnapshot => ({ assets: assets.map((item) => ({ ...item })), folders: [] })
  return { runtime: { listAssets, saveAsset, readFile } satisfies TestAssetImportExportRuntime, saveAsset, readFile, listAssets }
}

describe('assetsImportExportRuntime', () => {
  it('previews and confirms imports through injected file and store dependencies', async () => {
    const runtimeModule = await loadRuntime()
    const importedPassword = 'test-imported-password'
    const newPassword = 'test-new-password'
    const content = JSON.stringify([
      { username: 'ops', ip: '10.24.8.12', label: 'prod-bastion-imported', group_name: '生产', port: 22, password: importedPassword },
      { username: 'deploy', ip: '10.55.0.9', label: 'imported-json', group_name: 'Imported', port: 2200, password: newPassword }
    ])
    const { runtime, saveAsset } = createRuntime([localAsset, asset({})], content)

    const preview = await runtimeModule.previewAssetImportRuntime({ filePath: '/tmp/external-reference-assets.json' }, runtime)

    expect(preview.ok).toBe(true)
    expect(preview.data).toMatchObject({ fileName: 'external-reference-assets.json', duplicateCount: 1 })
    expect(preview.data?.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ duplicateId: 'asset-1', title: 'prod-bastion-imported' }),
        expect.not.objectContaining({ password: expect.anything() })
      ])
    )

    const skipped = await runtimeModule.confirmAssetImportRuntime({ filePath: '/tmp/external-reference-assets.json', overwrite: false }, runtime)
    expect(skipped.ok).toBe(true)
    expect(skipped.data).toMatchObject({ imported: 1, skipped: 1, created: 1, updated: 0 })
    expect(saveAsset).toHaveBeenCalledTimes(1)

    const overwritten = await runtimeModule.confirmAssetImportRuntime({ filePath: '/tmp/external-reference-assets.json', overwrite: true }, runtime)
    expect(overwritten.ok).toBe(true)
    expect(overwritten.data).toMatchObject({ imported: 2, skipped: 0, created: 0, updated: 2 })
  })

  it('projects export payloads and filters non-exportable selected assets', async () => {
    const runtimeModule = await loadRuntime()
    const selected = runtimeModule.resolveAssetExportSelection({ assetIds: ['local-127-1', 'asset-1', 'org-1'] }, [localAsset, asset({}), asset({ id: 'org-1', asset_type: 'organization' })])

    expect(selected).toHaveLength(1)
    expect(runtimeModule.assetExportFileName(new Date('2026-06-10T00:00:00.000Z'))).toBe('external-reference-assets-2026-06-10.json')
    expect(runtimeModule.assetExportPayload(selected[0])).toEqual({
      username: 'ops',
      password: '',
      ip: '10.24.8.12',
      label: 'prod-bastion',
      group_name: '生产',
      auth_type: 'keyBased',
      keyChain: 'key-1',
      port: 22,
      asset_type: 'person',
      needProxy: false,
      proxyName: '',
      comment: '生产入口'
    })
  })

  it('exports through injected dialog, writer, and stat confirmation', async () => {
    const runtimeModule = await loadRuntime()
    const contentByPath = new Map<string, string>()
    const { runtime } = createRuntime([localAsset, asset({})])
    const filePath = '/tmp/exported-assets.json'
    const result = await runtimeModule.exportAssetsRuntime(
      { assetIds: ['local-127-1', 'asset-1'] },
      {
        now: () => new Date('2026-06-10T00:00:00.000Z'),
        showSaveDialog: async () => ({ filePath }),
        writeFile: async (targetPath: string, content: string) => {
          contentByPath.set(targetPath, content)
          return { filePath: targetPath, bytes: Buffer.byteLength(content, 'utf8') }
        }
      },
      {
        ...runtime,
        stat: async (targetPath: string) => ({ size: Buffer.byteLength(contentByPath.get(targetPath) || '', 'utf8') })
      }
    )

    expect(result).toEqual({
      ok: true,
      data: {
        exported: 1,
        fileName: 'external-reference-assets-2026-06-10.json',
        filePath,
        bytes: expect.any(Number)
      }
    })
    expect(contentByPath.get(filePath)).not.toContain('PRIVATE KEY')
  })

  it('fails closed when export write confirmation does not match', async () => {
    const runtimeModule = await loadRuntime()
    const { runtime } = createRuntime([asset({})])

    await expect(
      runtimeModule.exportAssetsRuntime(
        { assetIds: ['asset-1'] },
        {
          showSaveDialog: async () => ({ filePath: '/tmp/exported-assets.json' }),
          writeFile: async () => ({ filePath: '/tmp/other.json', bytes: 1 })
        },
        {
          ...runtime,
          stat: async () => ({ size: 1 })
        }
      )
    ).resolves.toMatchObject({
      ok: false,
      errorCode: 'ASSET_EXPORT_WRITE_CONFIRMATION_INVALID'
    })
  })
})
