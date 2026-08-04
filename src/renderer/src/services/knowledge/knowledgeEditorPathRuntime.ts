import {
  joinKnowledgeRelPath,
  knowledgeRelPathParent,
  normalizeKnowledgeRelPath
} from '@/services/knowledge/knowledgePathRuntime'

export const getKnowledgeEditorParentRelDir = (path: string) => {
  return knowledgeRelPathParent(path)
}

export const createKnowledgeEditorRelPath = (parentRelDir: string, name: string) => joinKnowledgeRelPath(parentRelDir, name)

export const normalizeKnowledgeEditorRelPath = normalizeKnowledgeRelPath

export const knowledgeEditorLanguageFromPath = (path: string) => {
  const lower = path.toLowerCase()
  if (/\.(md|markdown)$/.test(lower)) return 'markdown'
  if (/\.(json|jsonc)$/.test(lower)) return 'json'
  if (/\.(ya?ml)$/.test(lower)) return 'yaml'
  if (/\.(ts|tsx)$/.test(lower)) return 'typescript'
  if (/\.(js|jsx|mjs|cjs)$/.test(lower)) return 'javascript'
  if (/\.py$/.test(lower)) return 'python'
  if (/\.go$/.test(lower)) return 'go'
  if (/\.rs$/.test(lower)) return 'rust'
  if (/\.(sh|bash|zsh)$/.test(lower)) return 'shell'
  if (/\.sql$/.test(lower)) return 'sql'
  if (/\.(html|htm)$/.test(lower)) return 'html'
  if (/\.css$/.test(lower)) return 'css'
  if (/\.xml$/.test(lower)) return 'xml'
  return 'plaintext'
}

export const knowledgeEditorImageMimeFromPath = (path: string) => {
  const lower = path.toLowerCase()
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.bmp')) return 'image/bmp'
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  return ''
}
