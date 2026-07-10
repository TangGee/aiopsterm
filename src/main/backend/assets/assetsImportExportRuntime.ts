import { basename, isAbsolute } from 'path'
import { readFile, stat, writeFile } from 'fs/promises'
import type {
  AiopsAssetExportInput,
  AiopsAssetExportPayload,
  AiopsAssetExportResult,
  AiopsAssetImportConfirmInput,
  AiopsAssetImportConfirmResult,
  AiopsAssetImportPreviewInput,
  AiopsAssetImportPreviewRecord,
  AiopsAssetImportPreviewResult,
  AiopsAssetInput,
  AiopsAssetRecord,
  AiopsAssetSnapshot
} from '@shared/contracts/assets'
import type { AiopsMutationResult } from '@shared/contracts/common'
import { parseAssetImportContent, type ImportedAssetDraft } from '@shared/assetImport'

export type AssetExportRuntime = {
  showSaveDialog: (options: { defaultPath: string; filters: Array<{ name: string; extensions: string[] }> }) => Promise<{ canceled?: boolean; filePath?: string }>
  writeFile?: (
    filePath: string,
    content: string,
    encoding: 'utf-8'
  ) => Promise<
    | void
    | {
        filePath?: string
        bytes?: number
      }
  >
  now?: () => Date
}

export type AssetImportExportRuntime = {
  listAssets: () => AiopsAssetSnapshot
  saveAsset: (input: AiopsAssetInput) => AiopsAssetRecord
  saveAssets?: (inputs: AiopsAssetInput[]) => AiopsAssetRecord[]
  readFile?: (filePath: string, encoding: 'utf-8') => Promise<string>
  stat?: (filePath: string) => Promise<{ size: number }>
  writeFile?: typeof writeFile
}

class AssetImportError extends Error {
  constructor(
    public errorCode: string,
    message: string
  ) {
    super(message)
    this.name = 'AssetImportError'
  }
}

class AssetExportError extends Error {
  constructor(
    public errorCode: string,
    message: string
  ) {
    super(message)
    this.name = 'AssetExportError'
  }
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const assetImportFileName = (filePath: string) => basename(filePath.replace(/\\/g, '/')) || filePath

const assetImportErrorResult = <T>(error: unknown, fallbackCode = 'ASSET_IMPORT_FAILED', fallbackMessage = '资产导入失败。'): AiopsMutationResult<T> => {
  if (error instanceof AssetImportError) {
    return { ok: false, errorCode: error.errorCode, errorMessage: error.message }
  }
  return {
    ok: false,
    errorCode: fallbackCode,
    errorMessage: error instanceof Error ? error.message : String(error || fallbackMessage)
  }
}

const assetExportErrorResult = (error: unknown): AiopsAssetExportResult => ({
  ok: false,
  errorCode: error instanceof AssetExportError ? error.errorCode : 'ASSET_EXPORT_FAILED',
  errorMessage: error instanceof Error ? error.message : String(error || '导出文件失败。')
})

const readAssetImportDrafts = async (input: AiopsAssetImportPreviewInput, runtime: AssetImportExportRuntime) => {
  const filePath = text(input?.filePath)
  if (!filePath) throw new AssetImportError('ASSET_IMPORT_FILE_REQUIRED', '导入文件路径不能为空。')
  const fileName = assetImportFileName(filePath)
  let content = ''
  try {
    content = await (runtime.readFile || readFile)(filePath, 'utf-8')
  } catch (error) {
    throw new AssetImportError('ASSET_IMPORT_READ_FAILED', error instanceof Error ? error.message : '导入文件读取失败。')
  }
  let drafts: ImportedAssetDraft[] = []
  try {
    drafts = parseAssetImportContent(content, fileName)
  } catch {
    throw new AssetImportError('ASSET_IMPORT_PARSE_FAILED', '导入文件解析失败。')
  }
  if (!drafts.length) throw new AssetImportError('ASSET_IMPORT_EMPTY', '导入文件没有可识别的主机。')
  return { filePath, fileName, drafts }
}

export const findAssetImportDuplicate = (assets: AiopsAssetRecord[], draft: ImportedAssetDraft) =>
  assets.find((asset) => !asset.isLocalShell && asset.host === draft.host && asset.username === draft.username && Number(asset.port) === Number(draft.port))

const assetImportDuplicateKey = (host: string, username: string, port: number | string) => `${host}\u0000${username}\u0000${Number(port)}`

const assetImportDuplicateKeyForAsset = (asset: Pick<AiopsAssetRecord, 'host' | 'username' | 'port'>) => assetImportDuplicateKey(asset.host, asset.username, asset.port)

const assetImportDuplicateKeyForDraft = (draft: ImportedAssetDraft) => assetImportDuplicateKey(draft.host, draft.username, draft.port)

const assetImportDuplicateIndex = (assets: AiopsAssetRecord[]) => {
  const duplicates = new Map<string, AiopsAssetRecord>()
  for (const asset of assets) {
    if (asset.isLocalShell) continue
    const key = assetImportDuplicateKeyForAsset(asset)
    if (!duplicates.has(key)) duplicates.set(key, asset)
  }
  return duplicates
}

const pendingImportedAsset = (draft: ImportedAssetDraft): AiopsAssetRecord => ({
  id: `pending-import-${draft.host}-${draft.username}-${draft.port}`,
  uuid: `pending-import-${draft.host}-${draft.username}-${draft.port}`,
  name: draft.title,
  title: draft.title,
  host: draft.host,
  ip: draft.host,
  group: draft.group,
  group_name: draft.group,
  status: 'online',
  tags: ['imported'],
  username: draft.username,
  port: draft.port,
  asset_type: draft.asset_type,
  auth_type: draft.auth_type,
  comment: draft.comment,
  data_source: 'manual'
})

const assetImportPreviewRecordForDuplicate = (draft: ImportedAssetDraft, index: number, duplicate?: AiopsAssetRecord): AiopsAssetImportPreviewRecord => ({
  previewId: `import-${index}-${draft.host}-${draft.port}`,
  duplicateId: duplicate?.id,
  duplicateTitle: duplicate?.title,
  title: draft.title,
  host: draft.host,
  username: draft.username,
  group: draft.group,
  port: draft.port,
  auth_type: draft.auth_type,
  asset_type: draft.asset_type,
  comment: draft.comment,
  needProxy: draft.needProxy,
  proxyName: draft.proxyName
})

export const assetImportPreviewRecord = (draft: ImportedAssetDraft, index: number, assets: AiopsAssetRecord[]): AiopsAssetImportPreviewRecord =>
  assetImportPreviewRecordForDuplicate(draft, index, findAssetImportDuplicate(assets, draft))

export const assetImportInput = (draft: ImportedAssetDraft, existing?: AiopsAssetRecord): AiopsAssetInput => ({
  ...(existing ? { id: existing.id } : {}),
  name: draft.title,
  title: draft.title,
  host: draft.host,
  ip: draft.host,
  group: draft.group,
  group_name: draft.group,
  status: 'online',
  tags: ['imported'],
  username: draft.username,
  port: draft.port,
  asset_type: draft.asset_type,
  auth_type: draft.auth_type,
  comment: draft.comment,
  password: draft.password,
  needProxy: draft.needProxy,
  proxyName: draft.proxyName,
  data_source: existing?.data_source || 'manual'
})

export const previewAssetImportRuntime = async (
  input: AiopsAssetImportPreviewInput,
  runtime: AssetImportExportRuntime
): Promise<AiopsAssetImportPreviewResult> => {
  try {
    const { filePath, fileName, drafts } = await readAssetImportDrafts(input, runtime)
    const snapshot = runtime.listAssets()
    const duplicates = assetImportDuplicateIndex(snapshot.assets)
    const assets = drafts.map((draft, index) => assetImportPreviewRecordForDuplicate(draft, index, duplicates.get(assetImportDuplicateKeyForDraft(draft))))
    return {
      ok: true,
      data: {
        filePath,
        fileName,
        assets,
        duplicateCount: assets.filter((asset) => asset.duplicateId).length
      }
    }
  } catch (error) {
    return assetImportErrorResult(error)
  }
}

export const confirmAssetImportRuntime = async (
  input: AiopsAssetImportConfirmInput,
  runtime: AssetImportExportRuntime
): Promise<AiopsAssetImportConfirmResult> => {
  try {
    const { filePath, fileName, drafts } = await readAssetImportDrafts(input, runtime)
    const duplicateCounts = new Map<string, number>()
    drafts.forEach((draft) => {
      const key = assetImportDuplicateKeyForDraft(draft)
      duplicateCounts.set(key, (duplicateCounts.get(key) || 0) + 1)
    })
    const snapshot = runtime.listAssets()
    const duplicates = assetImportDuplicateIndex(snapshot.assets)
    const canBatchSave =
      typeof runtime.saveAssets === 'function' &&
      !drafts.some((draft) => input.overwrite && (duplicateCounts.get(assetImportDuplicateKeyForDraft(draft)) || 0) > 1 && !duplicates.get(assetImportDuplicateKeyForDraft(draft)))
    let imported = 0
    let skipped = 0
    let created = 0
    let updated = 0
    const pendingInputs: AiopsAssetInput[] = []

    const saveInput = (assetInput: AiopsAssetInput, draft: ImportedAssetDraft, existing?: AiopsAssetRecord) => {
      if (canBatchSave) {
        pendingInputs.push(assetInput)
        duplicates.set(assetImportDuplicateKeyForDraft(draft), existing || pendingImportedAsset(draft))
        return
      }
      const saved = runtime.saveAsset(assetInput)
      duplicates.set(assetImportDuplicateKeyForAsset(saved), saved)
    }

    for (const draft of drafts) {
      const key = assetImportDuplicateKeyForDraft(draft)
      const existing = duplicates.get(key)
      if (existing && !input.overwrite) {
        skipped += 1
        continue
      }
      saveInput(assetImportInput(draft, existing), draft, existing)
      imported += 1
      if (existing) updated += 1
      else created += 1
    }

    if (canBatchSave && pendingInputs.length) runtime.saveAssets!(pendingInputs)

    return {
      ok: true,
      data: {
        ...runtime.listAssets(),
        imported,
        skipped,
        created,
        updated,
        filePath,
        fileName
      }
    }
  } catch (error) {
    return assetImportErrorResult(error)
  }
}

type AssetExportWriteResult = Awaited<ReturnType<NonNullable<AssetExportRuntime['writeFile']>>>

const isAssetExportWriteMetadata = (value: AssetExportWriteResult): value is Exclude<AssetExportWriteResult, void> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

export const assetExportFileName = (now = new Date()) => `external-reference-assets-${now.toISOString().slice(0, 10)}.json`

export const assetExportPayload = (asset: AiopsAssetRecord): AiopsAssetExportPayload => ({
  username: asset.username,
  password: '',
  ip: asset.host || asset.ip,
  label: asset.title || asset.name || asset.host,
  group_name: asset.group_name || asset.group || '',
  auth_type: asset.auth_type || 'password',
  ...(asset.keychainId ? { keyChain: asset.keychainId } : {}),
  port: asset.port || 22,
  asset_type: asset.asset_type || 'person',
  needProxy: Boolean(asset.needProxy),
  proxyName: asset.proxyName || '',
  ...(asset.comment ? { comment: asset.comment } : {})
})

export const resolveAssetExportSelection = (input: AiopsAssetExportInput, assets: AiopsAssetRecord[]): AiopsAssetRecord[] => {
  const selectedIds = Array.from(new Set((Array.isArray(input?.assetIds) ? input.assetIds : []).map(text).filter(Boolean)))
  if (!selectedIds.length) throw new AssetExportError('ASSET_EXPORT_EMPTY', '请选择要导出的主机。')
  const selectedSet = new Set(selectedIds)
  const selectedAssets = assets.filter((asset) => selectedSet.has(asset.id) && !asset.isLocalShell && asset.asset_type !== 'organization' && asset.host && asset.username)
  if (!selectedAssets.length) throw new AssetExportError('ASSET_EXPORT_EMPTY', '没有可导出的主机。')
  return selectedAssets
}

export const exportAssetsRuntime = async (
  input: AiopsAssetExportInput,
  exportRuntime: AssetExportRuntime,
  runtime: AssetImportExportRuntime
): Promise<AiopsAssetExportResult> => {
  try {
    if (!exportRuntime?.showSaveDialog) throw new AssetExportError('ASSET_EXPORT_SAVE_DIALOG_UNAVAILABLE', '导出保存对话框服务不可用。')
    const assets = resolveAssetExportSelection(input, runtime.listAssets().assets)
    const payload = assets.map(assetExportPayload)
    const fileName = assetExportFileName(exportRuntime.now?.() || new Date())
    const saveResult = await exportRuntime.showSaveDialog({
      defaultPath: fileName,
      filters: [{ name: 'JSON Files', extensions: ['json'] }]
    })
    if (saveResult?.canceled) {
      return {
        ok: true,
        data: {
          exported: 0,
          fileName,
          canceled: true
        }
      }
    }
    const filePath = typeof saveResult.filePath === 'string' ? saveResult.filePath : ''
    if (!filePath.trim() || !isAbsolute(filePath)) throw new AssetExportError('ASSET_EXPORT_SAVE_PATH_INVALID', '资产导出保存路径必须是绝对路径。')
    const content = JSON.stringify(payload, null, 2)
    const expectedBytes = Buffer.byteLength(content, 'utf8')
    const writeResult = await (exportRuntime.writeFile || runtime.writeFile || writeFile)(filePath, content, 'utf-8')
    if (isAssetExportWriteMetadata(writeResult)) {
      if (writeResult.filePath !== filePath) throw new AssetExportError('ASSET_EXPORT_WRITE_CONFIRMATION_INVALID', '资产导出写入路径确认失败。')
      if (writeResult.bytes !== expectedBytes) throw new AssetExportError('ASSET_EXPORT_WRITE_CONFIRMATION_INVALID', '资产导出写入字节数确认失败。')
    }
    let writtenSize = -1
    try {
      writtenSize = (await (runtime.stat || stat)(filePath)).size
    } catch {
      throw new AssetExportError('ASSET_EXPORT_WRITE_CONFIRMATION_INVALID', '资产导出文件写入后无法确认。')
    }
    if (writtenSize !== expectedBytes) throw new AssetExportError('ASSET_EXPORT_WRITE_CONFIRMATION_INVALID', '资产导出文件大小与生成内容不一致。')
    return {
      ok: true,
      data: {
        exported: payload.length,
        fileName,
        filePath,
        bytes: expectedBytes
      }
    }
  } catch (error) {
    return assetExportErrorResult(error)
  }
}
