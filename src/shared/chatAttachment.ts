export const normalizeChatAttachmentTaskId = (taskId: string) => taskId.trim().replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 96)

export const normalizeChatAttachmentPath = (value: string) => value.replace(/\\/g, '/')

export const chatAttachmentPathSegments = (value: string) => normalizeChatAttachmentPath(value).split('/').filter(Boolean)

const chatAttachmentRefPrefix = 'aiopsterm://chat-attachment/'

export const parseChatAttachmentRef = (refPath: string): { taskId: string; name: string } | null => {
  if (!refPath.startsWith(chatAttachmentRefPrefix)) return null
  const parts = refPath.slice(chatAttachmentRefPrefix.length).split('/').filter(Boolean)
  if (parts.length < 2) return null
  try {
    return {
      taskId: decodeURIComponent(parts[0]),
      name: decodeURIComponent(parts.at(-1) || '')
    }
  } catch {
    return null
  }
}
