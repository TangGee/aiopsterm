import type { KnowledgeBaseEntry, KnowledgeBaseTransferProgress, KnowledgeNode } from '@shared/contracts/knowledgeBase'
import {
  joinKnowledgeRelPath,
  knowledgeRelPathContains as containsKnowledgeRelPath,
  knowledgeRelPathParent,
  normalizeKnowledgeRelPath
} from '@/services/knowledge/knowledgePathRuntime'

export type KbClipboard = { mode: 'copy' | 'cut'; sources: string[] } | null
export type KnowledgeImportJob = { id: string; destRelPath: string; percent: number }

export const cloneKnowledgeNodes = (nodes: KnowledgeNode[]): KnowledgeNode[] =>
  nodes.map((node) => ({ ...node, children: node.children ? cloneKnowledgeNodes(node.children) : undefined }))

export const knowledgeEntryToNode = (entry: KnowledgeBaseEntry): KnowledgeNode => ({
  id: `kb-${entry.relPath.replace(/[^a-zA-Z0-9_-]/g, '-') || 'root'}`,
  key: entry.relPath,
  relPath: entry.relPath,
  title: entry.name,
  type: entry.type,
  ...(entry.type === 'file' ? { size: entry.size || 0 } : { children: [] })
})

export const filterKnowledgeTree = (nodes: KnowledgeNode[], query: string): KnowledgeNode[] => {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return nodes
  return nodes
    .map((node) => {
      const hit = node.title.toLowerCase().includes(normalizedQuery)
      const children = node.children ? filterKnowledgeTree(node.children, normalizedQuery) : []
      if (hit || children.length) return { ...node, children: children.length ? children : node.children }
      return null
    })
    .filter(Boolean) as KnowledgeNode[]
}

export const knowledgeContentSearchVisible = (query: string) => query.trim().length > 1

export const knowledgeCapacityPercent = (usedBytes: number, totalBytes: number) => Math.min(100, Math.round((usedBytes / totalBytes) * 100))

export const findKnowledgeNode = (nodes: KnowledgeNode[], relPath: string): KnowledgeNode | null => {
  for (const node of nodes) {
    if (node.relPath === relPath) return node
    if (node.children) {
      const hit = findKnowledgeNode(node.children, relPath)
      if (hit) return hit
    }
  }
  return null
}

export const selectKnowledgeNodeKeys = (selectedKeys: string[], relPath: string, multi = false) => {
  if (!multi) return [relPath]
  return selectedKeys.includes(relPath) ? selectedKeys.filter((item) => item !== relPath) : [...selectedKeys, relPath]
}

export const getKnowledgeParent = (relPath: string) => {
  return knowledgeRelPathParent(relPath)
}

export const knowledgePathContains = containsKnowledgeRelPath

export const missingKnowledgeRelPaths = (nodes: KnowledgeNode[], candidateRelPaths: string[]) =>
  [...new Set(candidateRelPaths.filter(Boolean))].filter((relPath) => !findKnowledgeNode(nodes, relPath))

export const pruneKnowledgeUiState = (
  selectedKeys: string[],
  expandedKeys: string[],
  removedRelPaths: string[]
): { selectedKeys: string[]; expandedKeys: string[] } => ({
  selectedKeys: selectedKeys.filter((key) => !removedRelPaths.some((relPath) => knowledgePathContains(relPath, key))),
  expandedKeys: expandedKeys.filter((key) => !removedRelPaths.some((relPath) => knowledgePathContains(relPath, key)))
})

export const knowledgeRelPathParentMatches = (relPath: string, expectedParentRelDir: string) =>
  getKnowledgeParent(relPath) === normalizeKnowledgeRelPath(expectedParentRelDir)

export const resolveKnowledgePasteTarget = (targetRelDir: string, destination: KnowledgeNode | null | undefined) =>
  destination?.type === 'file' ? getKnowledgeParent(destination.relPath) : targetRelDir

const imageFileExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'])

export const getKnowledgeFileExtension = (relPath: string) => {
  const fileName = relPath.split('/').pop() || relPath
  const dotIndex = fileName.lastIndexOf('.')
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : ''
}

export const isKnowledgeImagePath = (relPath: string) => imageFileExtensions.has(getKnowledgeFileExtension(relPath))

export const mediaTypeFromKnowledgePath = (relPath: string) => {
  const mediaTypes: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml'
  }
  return mediaTypes[getKnowledgeFileExtension(relPath)] || 'application/octet-stream'
}

export const knowledgeTransferProgressPercent = (transferred: number, total: number) => {
  const normalizedTotal = total || 1
  return Math.min(100, Math.round((transferred / normalizedTotal) * 100))
}

export const upsertKnowledgeImportJob = (
  jobs: KnowledgeImportJob[],
  input: Pick<KnowledgeBaseTransferProgress, 'jobId' | 'destRelPath' | 'transferred' | 'total'>
): { jobs: KnowledgeImportJob[]; percent: number } => {
  const percent = knowledgeTransferProgressPercent(input.transferred, input.total)
  const nextJob = { id: input.jobId, destRelPath: input.destRelPath, percent }
  const existingIndex = jobs.findIndex((job) => job.id === input.jobId)
  if (existingIndex < 0) return { jobs: [...jobs, nextJob], percent }
  return {
    jobs: jobs.map((job, index) => (index === existingIndex ? nextJob : { ...job })),
    percent
  }
}

export const addCompletedKnowledgeImportJob = (jobs: KnowledgeImportJob[], jobId: string, destRelPath: string) =>
  jobs.some((job) => job.id === jobId) ? jobs.map((job) => ({ ...job })) : [...jobs, { id: jobId, destRelPath, percent: 100 }]

export const removeKnowledgeImportJob = (jobs: KnowledgeImportJob[], jobId: string) => jobs.filter((job) => job.id !== jobId)

export const uniqueKnowledgeFileName = (nodes: KnowledgeNode[], parentRelDir: string, fileName: string) => {
  const dotIndex = fileName.lastIndexOf('.')
  const base = dotIndex >= 0 ? fileName.slice(0, dotIndex) : fileName
  const ext = dotIndex >= 0 ? fileName.slice(dotIndex) : ''
  let candidate = fileName
  let index = 1
  while (findKnowledgeNode(nodes, joinKnowledgeRelPath(parentRelDir, candidate))) {
    candidate = `${base}-${index}${ext}`
    index += 1
  }
  return candidate
}
