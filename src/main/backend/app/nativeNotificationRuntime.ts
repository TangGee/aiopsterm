export type NativeNotificationInput = {
  title: string
  body?: string
  silent?: boolean
  onClick?: () => void
}

export type NativeNotificationInstance = {
  on: (event: 'click', listener: () => void) => void
  show: () => void
}

export type NativeNotificationRuntime = {
  isSupported: () => boolean
  create: (input: Pick<NativeNotificationInput, 'title' | 'body' | 'silent'>) => NativeNotificationInstance
}

const cleanText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

export const shouldShowNativeNotification = (enabled: boolean, isSupported: () => boolean) => Boolean(enabled && isSupported())

export const showNativeNotification = (
  runtime: NativeNotificationRuntime,
  input: NativeNotificationInput,
  enabled = true
) => {
  const title = cleanText(input.title) || 'aiopsterm'
  if (!shouldShowNativeNotification(enabled, runtime.isSupported)) return false
  const notification = runtime.create({
    title,
    ...(cleanText(input.body) ? { body: cleanText(input.body) } : {}),
    silent: input.silent ?? false
  })
  if (input.onClick) notification.on('click', input.onClick)
  notification.show()
  return true
}
