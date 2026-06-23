export const getKnowledgeEditorParentRelDir = (path: string) => {
  const parts = path.split('/').filter(Boolean)
  return parts.length <= 1 ? '' : parts.slice(0, -1).join('/')
}

export const createKnowledgeEditorRelPath = (parentRelDir: string, name: string) => [parentRelDir, name].filter(Boolean).join('/')

export const normalizeKnowledgeEditorRelPath = (path: string) => {
  const output: string[] = []
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      output.pop()
      continue
    }
    output.push(part)
  }
  return output.join('/')
}

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
