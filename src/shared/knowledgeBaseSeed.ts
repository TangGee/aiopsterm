const utf8ByteLength = (value: string) => {
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0x80) {
      bytes += 1
    } else if (code < 0x800) {
      bytes += 2
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        index += 1
      } else {
        bytes += 3
      }
    } else {
      bytes += 3
    }
  }
  return bytes
}

const base64ByteLength = (value: string) => {
  const normalized = value.replace(/\s/g, '')
  if (!normalized) return 0
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0
  return Math.floor((normalized.length * 3) / 4) - padding
}

export const DEFAULT_KNOWLEDGE_INTERFACE_IMAGE_REL_PATH = 'images/interface.png'
export const DEFAULT_KNOWLEDGE_INTERFACE_IMAGE_MIME = 'image/png'
export const DEFAULT_KNOWLEDGE_INTERFACE_IMAGE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

export const DEFAULT_KNOWLEDGE_SEED_TEXT: Record<string, string> = Object.freeze({
  'commands/rollback-plan.md': '# rollback-plan\n\nGenerate rollback steps, validation checks, and risk notes for the current service.\n',
  'commands/diagnose.md': '# diagnose\n\nGenerate a read-only diagnosis plan from the current terminal, asset, and knowledge context.\n',
  'commands/Summary to Doc.md': '# Summary to Doc\n\nUse this note to summarize terminal findings, remediation steps, and reusable operations knowledge.\n',
  'Markdown语法指南.md': '# Markdown语法指南\n\n- 使用标题组织运维知识。\n- 使用代码块保存命令和输出。\n- 使用列表记录排查步骤和结论。\n'
})

export type DefaultKnowledgeSeedFile =
  | {
      kind: 'text'
      content: string
      size: number
    }
  | {
      kind: 'base64'
      base64: string
      mimeType: typeof DEFAULT_KNOWLEDGE_INTERFACE_IMAGE_MIME
      size: number
    }

export const DEFAULT_KNOWLEDGE_SEED_SIZES: Record<string, number> = Object.freeze({
  ...Object.fromEntries(Object.entries(DEFAULT_KNOWLEDGE_SEED_TEXT).map(([relPath, content]) => [relPath, utf8ByteLength(content)])),
  [DEFAULT_KNOWLEDGE_INTERFACE_IMAGE_REL_PATH]: base64ByteLength(DEFAULT_KNOWLEDGE_INTERFACE_IMAGE_BASE64)
})

export const DEFAULT_KNOWLEDGE_USED_BYTES = Object.values(DEFAULT_KNOWLEDGE_SEED_SIZES).reduce((total, size) => total + size, 0)

export const getDefaultKnowledgeSeedFile = (relPath: string): DefaultKnowledgeSeedFile | null => {
  if (relPath === DEFAULT_KNOWLEDGE_INTERFACE_IMAGE_REL_PATH) {
    return {
      kind: 'base64',
      base64: DEFAULT_KNOWLEDGE_INTERFACE_IMAGE_BASE64,
      mimeType: DEFAULT_KNOWLEDGE_INTERFACE_IMAGE_MIME,
      size: DEFAULT_KNOWLEDGE_SEED_SIZES[DEFAULT_KNOWLEDGE_INTERFACE_IMAGE_REL_PATH]
    }
  }
  const content = DEFAULT_KNOWLEDGE_SEED_TEXT[relPath]
  if (content === undefined) return null
  return {
    kind: 'text',
    content,
    size: DEFAULT_KNOWLEDGE_SEED_SIZES[relPath]
  }
}
