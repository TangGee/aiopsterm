type WindowWebContents = {
  isDestroyed?: () => boolean
  send: (channel: string, ...args: unknown[]) => void
}

export type WindowEventTarget = {
  isDestroyed?: () => boolean
  webContents?: WindowWebContents
}

const isDestroyedObject = (target?: { isDestroyed?: () => boolean }) => {
  try {
    return Boolean(target?.isDestroyed?.())
  } catch {
    return true
  }
}

export const sendWindowEvent = (target: WindowEventTarget | null | undefined, channel: string, ...args: unknown[]) => {
  if (!target || isDestroyedObject(target)) return false
  return sendWebContentsEvent(target.webContents, channel, ...args)
}

export const sendWebContentsEvent = (webContents: WindowWebContents | null | undefined, channel: string, ...args: unknown[]) => {
  if (!webContents || isDestroyedObject(webContents)) return false
  try {
    webContents.send(channel, ...args)
    return true
  } catch (error) {
    if (error instanceof Error && error.message.includes('Object has been destroyed')) return false
    throw error
  }
}

export const broadcastWindowEvent = (targets: WindowEventTarget[], channel: string, ...args: unknown[]) => {
  for (const target of targets) sendWindowEvent(target, channel, ...args)
}
