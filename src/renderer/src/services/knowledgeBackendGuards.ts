import type {
  KnowledgeBaseEntry,
  KnowledgeBaseReadResult,
  KnowledgeBaseSearchResult,
  KnowledgeBaseSearchStatus,
  KnowledgeBaseTransferProgress
} from '@shared/preload'

export const malformedKnowledgeBackendResultMessage = '知识库服务返回数据无效'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

const isOptionalFiniteNumber = (value: unknown) => value === undefined || (typeof value === 'number' && Number.isFinite(value))

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

const isNonNegativeNumber = (value: unknown): value is number => isFiniteNumber(value) && value >= 0

export const isKnowledgeRelPathResultData = (value: unknown): value is { relPath: string } => isRecord(value) && isNonEmptyString(value.relPath)

export const isKnowledgeDeleteResultData = (value: unknown): value is { success: boolean } => isRecord(value) && value.success === true

export const isKnowledgeWriteResultData = (value: unknown): value is { mtimeMs: number } => isRecord(value) && isFiniteNumber(value.mtimeMs)

export const isKnowledgeImportResultData = (value: unknown): value is { jobId: string; relPath: string } =>
  isRecord(value) && isNonEmptyString(value.jobId) && isNonEmptyString(value.relPath)

export const isKnowledgeEnsureRootResultData = (value: unknown): value is { success: boolean } => isRecord(value) && value.success === true

export const isKnowledgeEntryData = (value: unknown): value is KnowledgeBaseEntry =>
  isRecord(value) &&
  isNonEmptyString(value.name) &&
  isNonEmptyString(value.relPath) &&
  (value.type === 'file' || value.type === 'dir') &&
  isOptionalFiniteNumber(value.size) &&
  isOptionalFiniteNumber(value.mtimeMs)

export const isKnowledgeEntryListData = (value: unknown): value is KnowledgeBaseEntry[] => Array.isArray(value) && value.every(isKnowledgeEntryData)

export const isKnowledgeReadResultData = (value: unknown, encoding?: 'utf-8' | 'base64'): value is KnowledgeBaseReadResult => {
  if (!isRecord(value) || typeof value.content !== 'string' || !isFiniteNumber(value.mtimeMs)) return false
  if (value.mimeType !== undefined && typeof value.mimeType !== 'string') return false
  if (value.isImage !== undefined && typeof value.isImage !== 'boolean') return false
  if (encoding === 'base64' && !isNonEmptyString(value.content)) return false
  return true
}

export const isKnowledgeSearchResultData = (value: unknown): value is KnowledgeBaseSearchResult => {
  if (!isRecord(value)) return false
  const { path, startLine, endLine, score, snippet, matchCount } = value
  return (
    isNonEmptyString(path) &&
    Number.isInteger(startLine) &&
    Number.isInteger(endLine) &&
    typeof startLine === 'number' &&
    typeof endLine === 'number' &&
    startLine >= 1 &&
    endLine >= startLine &&
    isFiniteNumber(score) &&
    typeof snippet === 'string' &&
    Number.isInteger(matchCount) &&
    typeof matchCount === 'number' &&
    matchCount >= 0
  )
}

export const isKnowledgeSearchResultListData = (value: unknown): value is KnowledgeBaseSearchResult[] => Array.isArray(value) && value.every(isKnowledgeSearchResultData)

export const isKnowledgeSearchStatusData = (value: unknown): value is KnowledgeBaseSearchStatus => {
  if (!isRecord(value)) return false
  const { totalFiles, totalChunks, provider, model, updatedAt } = value
  return (
    Number.isInteger(totalFiles) &&
    typeof totalFiles === 'number' &&
    totalFiles >= 0 &&
    Number.isInteger(totalChunks) &&
    typeof totalChunks === 'number' &&
    totalChunks >= 0 &&
    isNonEmptyString(provider) &&
    isNonEmptyString(model) &&
    isFiniteNumber(updatedAt)
  )
}

export const isKnowledgeReindexResultData = (value: unknown): value is { files: number; chunks: number } =>
  isRecord(value) &&
  Number.isInteger(value.files) &&
  typeof value.files === 'number' &&
  value.files >= 0 &&
  Number.isInteger(value.chunks) &&
  typeof value.chunks === 'number' &&
  value.chunks >= 0

export const isKnowledgeTransferProgressData = (value: unknown): value is KnowledgeBaseTransferProgress =>
  isRecord(value) && isNonEmptyString(value.jobId) && isNonEmptyString(value.destRelPath) && isNonNegativeNumber(value.transferred) && isNonNegativeNumber(value.total)

export const expectedKnowledgeRelPath = (relDir: string, name: string) => [relDir.trim().replace(/^\/+|\/+$/g, ''), name.trim()].filter(Boolean).join('/')
