export type NativeNotificationInput = {
  title: string
  body?: string
  silent?: boolean
  key?: string
  onClick?: () => void
}

export type NativeNotificationInstance = {
  on: (event: 'click', listener: () => void) => void
  show: () => void
  close?: () => void
}

export type NativeNotificationRuntime = {
  isSupported: () => boolean
  create: (input: Pick<NativeNotificationInput, 'title' | 'body' | 'silent'>) => NativeNotificationInstance
}

const cleanText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const keyedNotifications = new Map<string, NativeNotificationInstance>()

const closeNotification = (notification: NativeNotificationInstance | undefined) => {
  try {
    notification?.close?.()
  } catch {
    // Best effort only; OS notification backends may reject late close calls.
  }
}

export const syncNativeNotificationKeys = (activeKeys: Iterable<string>) => {
  const active = new Set([...activeKeys].map(cleanText).filter(Boolean))
  keyedNotifications.forEach((notification, key) => {
    if (active.has(key)) return
    closeNotification(notification)
    keyedNotifications.delete(key)
  })
}

export const shouldShowNativeNotification = (enabled: boolean, isSupported: () => boolean) => Boolean(enabled && isSupported())

export const showNativeNotification = (
  runtime: NativeNotificationRuntime,
  input: NativeNotificationInput,
  enabled = true
) => {
  const title = cleanText(input.title) || 'aiopsterm'
  if (!shouldShowNativeNotification(enabled, runtime.isSupported)) return false
  const key = cleanText(input.key)
  if (key) {
    closeNotification(keyedNotifications.get(key))
    keyedNotifications.delete(key)
  }
  const notification = runtime.create({
    title,
    ...(cleanText(input.body) ? { body: cleanText(input.body) } : {}),
    silent: input.silent ?? false
  })
  if (input.onClick) notification.on('click', input.onClick)
  if (key) keyedNotifications.set(key, notification)
  notification.show()
  return true
}
