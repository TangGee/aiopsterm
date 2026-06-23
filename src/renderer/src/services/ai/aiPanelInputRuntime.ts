import type {
  AiChipContentPart,
  AiContentPart,
  AiContextOption,
  AiDocChipContentPart,
  AiImageContentPart,
  AiSupportedImageType
} from '@shared/contracts/aiChat'

export const aiPanelImagePartMediaTypes: AiSupportedImageType[] = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml']

export type AiContentPartPlainTextMode = 'display' | 'exchange'

export const plainTextForAiContentPart = (part: AiContentPart, options: { compactImage?: boolean; mode?: AiContentPartPlainTextMode } = {}) => {
  if (options.mode === 'exchange') {
    if (part.type === 'text') return part.text
    if (part.type === 'image') return '[image]'
    if (part.chipType === 'doc') return `@${part.ref.absPath || ''}`
    if (part.chipType === 'chat') {
      const taskName = part.ref.title || ''
      return taskName ? `@${part.ref.taskId}_${taskName}` : `@${part.ref.taskId}`
    }
    if (part.chipType === 'command') return part.ref.command
    return `@skill:${part.ref.skillName}`
  }
  if (part.type === 'text') return part.text
  if (part.type === 'image') return options.compactImage ? '[image]' : `[image: ${part.name || part.mediaType}]`
  if (part.chipType === 'doc') return `@${part.ref.name || part.ref.relPath || part.ref.absPath}`
  if (part.chipType === 'chat') return `@${part.ref.title || part.ref.taskId}`
  if (part.chipType === 'command') return part.ref.label || part.ref.command
  return `@skill:${part.ref.skillName}`
}

export const plainTextFromAiContentParts = (parts: AiContentPart[], options: { compactImage?: boolean; mode?: AiContentPartPlainTextMode } = {}) =>
  parts.map((part) => plainTextForAiContentPart(part, options)).join('')

export const sendableAiContentParts = (parts?: AiContentPart[]) => parts?.filter((part) => part.type !== 'text' || part.text.trim()) || []

export const hasStructuredAiContentParts = (parts: AiContentPart[]) => parts.some((part) => part.type !== 'text')

export const hasSendableAiContent = (parts: AiContentPart[]) => parts.some((part) => part.type !== 'text' || part.text.trim())

export const mergeAdjacentTextContentParts = (parts: AiContentPart[]) =>
  parts.reduce<AiContentPart[]>((acc, part) => {
    const previous = acc.at(-1)
    if (part.type === 'text' && previous?.type === 'text') {
      previous.text += part.text
      return acc
    }
    acc.push(part)
    return acc
  }, [])

export const fallbackAiContentPartsForMessage = (message: { text: string; contentParts?: AiContentPart[] }) =>
  message.contentParts?.length ? message.contentParts.map((part) => ({ ...part })) : [{ type: 'text' as const, text: message.text }]

export const aiMediaTypeFromContext = (context: AiContextOption): AiSupportedImageType =>
  aiPanelImagePartMediaTypes.includes(context.mediaType as AiSupportedImageType) ? (context.mediaType as AiSupportedImageType) : 'image/png'

export const aiChipPartFromContext = (context: AiContextOption): AiChipContentPart | null => {
  if (context.kind === 'docs') {
    const absPath = context.relPath || context.detail || context.label
    return {
      type: 'chip',
      chipType: 'doc',
      ref: {
        absPath,
        relPath: context.relPath,
        name: context.label,
        type: 'file'
      }
    }
  }
  if (context.kind === 'chats') {
    return {
      type: 'chip',
      chipType: 'chat',
      ref: {
        taskId: context.id.replace(/^chat:/, ''),
        title: context.label
      }
    }
  }
  if (context.kind === 'skills') {
    return {
      type: 'chip',
      chipType: 'skill',
      ref: {
        skillName: context.label,
        description: context.detail
      }
    }
  }
  return null
}

export const aiImagePartFromContext = (context: AiContextOption): AiImageContentPart | null => {
  if (context.kind !== 'images' || !context.data) return null
  return {
    type: 'image',
    mediaType: aiMediaTypeFromContext(context),
    data: context.data,
    name: context.label
  }
}

export const cloneAiContextOption = (context: AiContextOption): AiContextOption => ({ ...context })

export const hostContextFromAiOption = (context: AiContextOption): AiContextOption | null =>
  context.kind === 'hosts' ? cloneAiContextOption(context) : null

export const isLocalhostAiContext = (context: AiContextOption) => context.label === '127.0.0.1' || context.id === 'opened-local'

export const toggleHostAiContextInList = (contexts: AiContextOption[], context: AiContextOption, maxHostContexts: number) => {
  const host = hostContextFromAiOption(context)
  if (!host) return contexts
  if (contexts.some((item) => item.id === host.id)) {
    return contexts.filter((item) => item.id !== host.id)
  }
  let nextContexts = [...contexts]
  if (!isLocalhostAiContext(host)) {
    nextContexts = nextContexts.filter((item) => !isLocalhostAiContext(item))
  }
  if (nextContexts.filter((item) => item.kind === 'hosts').length >= maxHostContexts) {
    return nextContexts
  }
  return [...nextContexts, host]
}

export const selectedVisibleHostAiContexts = (currentHosts: AiContextOption[], visibleHosts: AiContextOption[], maxHostContexts: number) => {
  const hasRemoteHost = visibleHosts.some((context) => !isLocalhostAiContext(context))
  let nextHosts = currentHosts.map(cloneAiContextOption)
  if (hasRemoteHost) {
    nextHosts = nextHosts.filter((context) => !isLocalhostAiContext(context))
  }
  for (const context of visibleHosts) {
    if (hasRemoteHost && isLocalhostAiContext(context)) continue
    if (nextHosts.some((item) => item.id === context.id)) continue
    if (nextHosts.length >= maxHostContexts) break
    nextHosts = [...nextHosts, cloneAiContextOption(context)]
  }
  return nextHosts.slice(0, maxHostContexts)
}

export const extractEditablePlainTextFromNode = (node: Node): string => {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent || ''
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return ''
  const element = node as HTMLElement
  if (element.classList.contains('mention-chip')) return ''
  if (element.dataset.imageType) return ''
  if (element.tagName === 'BR') return '\n'
  return Array.from(element.childNodes).map(extractEditablePlainTextFromNode).join('')
}

export const editablePlainTextFromElement = (editable: HTMLElement | null) => {
  if (!editable) return ''
  return Array.from(editable.childNodes).map(extractEditablePlainTextFromNode).join('').replace(/\u00a0/g, ' ').trim()
}

export const splitAiContentInputParts = (parts: AiContentPart[]) => ({
  images: parts.filter((part): part is AiImageContentPart => part.type === 'image'),
  docs: parts.filter((part): part is AiDocChipContentPart => part.type === 'chip' && part.chipType === 'doc')
})
