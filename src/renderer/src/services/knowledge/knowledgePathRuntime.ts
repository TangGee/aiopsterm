const pathParts = (value: string) => {
  const output: string[] = []
  for (const part of String(value || '').replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      output.pop()
      continue
    }
    output.push(part)
  }
  return output
}

export const normalizeKnowledgeRelPath = (value: string) => pathParts(value).join('/')

export const knowledgeRelPathParent = (value: string) => {
  const parts = pathParts(value)
  return parts.length <= 1 ? '' : parts.slice(0, -1).join('/')
}

export const joinKnowledgeRelPath = (...parts: string[]) => normalizeKnowledgeRelPath(parts.filter(Boolean).join('/'))

export const knowledgeRelPathBasename = (value: string) => pathParts(value).at(-1) || ''

export const knowledgeRelPathContains = (parent: string, candidate: string) => {
  const normalizedParent = normalizeKnowledgeRelPath(parent)
  const normalizedCandidate = normalizeKnowledgeRelPath(candidate)
  return normalizedCandidate === normalizedParent || normalizedCandidate.startsWith(`${normalizedParent}/`)
}
