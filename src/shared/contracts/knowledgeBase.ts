export type KnowledgeBaseNodeConfig = {
  id: string
  key: string
  title: string
  type: 'file' | 'dir'
  relPath: string
  size?: number
  children?: KnowledgeBaseNodeConfig[]
}

export type KnowledgeNodeType = KnowledgeBaseNodeConfig['type']
export type KnowledgeNode = KnowledgeBaseNodeConfig

export type KnowledgeBaseUserConfig = {
  tree: KnowledgeBaseNodeConfig[]
  usedBytes: number
  totalBytes: number
}

export type KnowledgeBaseEntry = {
  name: string
  relPath: string
  type: 'file' | 'dir'
  size?: number
  mtimeMs?: number
}

export type KnowledgeBaseReadResult = {
  content: string
  mtimeMs: number
  mimeType?: string
  isImage?: boolean
}

export type KnowledgeBaseMutationEntry = {
  relPath: string
  type: 'file' | 'dir'
  size?: number
  mtimeMs: number
}

export type KnowledgeBaseWriteResult = KnowledgeBaseMutationEntry & {
  type: 'file'
  size: number
  bytes: number
}

export type KnowledgeBaseCreateResult = KnowledgeBaseMutationEntry

export type KnowledgeBaseDeleteResult = {
  success: boolean
  relPath: string
  type: 'file' | 'dir'
  deleted: true
}

export type KnowledgeBaseImportResult = KnowledgeBaseMutationEntry & {
  jobId: string
}

export type KnowledgeBasePastedImageInput = {
  relDir?: string
  name?: string
}

export type KnowledgeBasePastedImageResult = {
  relPath: string
  fileName: string
  mimeType: string
  dataUrl: string
  size: number
  mtimeMs: number
}

export type KnowledgeBaseTransferProgress = {
  jobId: string
  transferred: number
  total: number
  destRelPath: string
}

export type KnowledgeBaseSearchResult = {
  path: string
  startLine: number
  endLine: number
  score: number
  snippet: string
  matchCount: number
}

export type KnowledgeBaseSearchStatus = {
  totalFiles: number
  totalChunks: number
  provider: string
  model: string
  updatedAt: number
}
