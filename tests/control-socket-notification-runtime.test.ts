import { beforeEach, describe, expect, it, vi } from 'vitest'

type NotificationRuntime = {
  configureControlSocketNotificationRuntime: (config?: {
    dispatchRendererControlRequest?: (method: string, params?: Record<string, unknown>, options?: { focus?: boolean }) => Promise<Record<string, unknown>> | Record<string, unknown>
    showNotification?: (notification: Record<string, unknown>) => void
    publishControlEvent?: (input: Record<string, unknown>) => unknown
  }) => void
  createNotification: (params: Record<string, unknown>) => Record<string, unknown>
  createCallerNotification: (params: Record<string, unknown>) => Record<string, unknown>
  createTargetedNotification: (method: string, params: Record<string, unknown>) => Record<string, unknown>
  listNotifications: (params: Record<string, unknown>) => Record<string, unknown>
  markNotificationRead: (params: Record<string, unknown>) => Record<string, unknown>
  dismissNotification: (params: Record<string, unknown>) => Record<string, unknown>
  clearNotifications: () => Record<string, unknown>
  openNotification: (params: Record<string, unknown>) => Promise<Record<string, unknown>>
  jumpToUnreadNotification: () => Promise<Record<string, unknown>>
  controlSocketNotificationSummary: () => Record<string, unknown>
  listNotificationsForTesting: () => Array<Record<string, unknown>>
  resetControlSocketNotificationRuntime: () => void
}

const loadRuntime = async () => {
  const modulePath = '../src/main/backend/controlSocketNotificationRuntime'
  return (await import(modulePath)) as unknown as NotificationRuntime
}

const responseData = (response: Record<string, unknown>) => (response.data && typeof response.data === 'object' ? (response.data as Record<string, unknown>) : {})

const notificationFrom = (response: Record<string, unknown>) => responseData(response).notification as Record<string, unknown>

beforeEach(async () => {
  const runtime = await loadRuntime()
  runtime.resetControlSocketNotificationRuntime()
  runtime.configureControlSocketNotificationRuntime({
    dispatchRendererControlRequest: () => ({ ok: true, data: {} }),
    showNotification: undefined,
    publishControlEvent: undefined
  })
})

describe('controlSocketNotificationRuntime', () => {
  it('creates, lists, syncs, shows, and publishes redacted notification events', async () => {
    const runtime = await loadRuntime()
    const dispatchRendererControlRequest = vi.fn(() => ({ ok: true, data: { synced: true } }))
    const showNotification = vi.fn()
    const publishControlEvent = vi.fn()
    runtime.configureControlSocketNotificationRuntime({
      dispatchRendererControlRequest,
      showNotification,
      publishControlEvent
    })

    const secretBody = 'full notification body should not be copied into event payload'
    const created = runtime.createNotification({
      title: 'Build done',
      subtitle: 'tests',
      body: secretBody,
      panelId: 'panel-1',
      sessionId: 'terminal-1',
      workspaceId: 'workspace-1',
      source: 'ci',
      level: 'success',
      group: 'build',
      key: 'project-main',
      action: 'done',
      url: 'https://example.test/build/1'
    })

    expect(created).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          unreadCount: 1,
          total: 1,
          notification: expect.objectContaining({
            title: 'Build done',
            body: secretBody,
            panelId: 'panel-1',
            sessionId: 'terminal-1',
            terminalSessionId: 'terminal-1',
            workspaceId: 'workspace-1',
            source: 'ci',
            level: 'success',
            group: 'build',
            key: 'project-main',
            read: false
          })
        })
      })
    )
    expect(dispatchRendererControlRequest).toHaveBeenCalledWith(
      'notification.sync',
      expect.objectContaining({ unreadCount: 1, total: 1 }),
      {}
    )
    expect(showNotification).toHaveBeenCalledWith(expect.objectContaining({ title: 'Build done', source: 'ci' }))
    expect(publishControlEvent).toHaveBeenCalledWith({
      name: 'notification.created',
      category: 'notification',
      source: 'notification.store',
      surfaceId: 'panel-1',
      workspaceId: 'workspace-1',
      payload: expect.objectContaining({
        title_preview: 'Build done',
        title_length: 'Build done'.length,
        body_length: secretBody.length,
        panel_id: 'panel-1',
        session_id: 'terminal-1',
        source: 'ci'
      })
    })
    expect(JSON.stringify(publishControlEvent.mock.calls)).not.toContain(secretBody)

    expect(runtime.listNotifications({ unread: true, source: 'ci', level: 'success', group: 'build', query: 'project-main' })).toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ count: 1, total: 1, unreadCount: 1 }) })
    )
  })

  it('scopes key-based notification identity by source and group', async () => {
    const runtime = await loadRuntime()

    const first = runtime.createNotification({ title: 'Tuple 1', source: 'ci:build', group: 'main', key: 'same' })
    const second = runtime.createNotification({ title: 'Tuple 2', source: 'ci', group: 'build:main', key: 'same' })
    const firstUpdate = runtime.createNotification({ title: 'Tuple 1 updated', source: 'ci:build', group: 'main', key: 'same' })

    const firstId = notificationFrom(first).id
    const secondId = notificationFrom(second).id
    const firstUpdateId = notificationFrom(firstUpdate).id
    expect(firstId).not.toBe(secondId)
    expect(firstUpdateId).toBe(firstId)
    expect(runtime.listNotifications({ query: 'Tuple' })).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ count: 2, total: 2 }) }))
  })

  it('marks, dismisses, clears, and reports notification summary', async () => {
    const runtime = await loadRuntime()
    const first = runtime.createNotification({ id: 'first', title: 'First' })
    runtime.createNotification({ id: 'second', title: 'Second' })
    expect(runtime.controlSocketNotificationSummary()).toEqual({ notificationCount: 2, unreadNotificationCount: 2 })

    expect(runtime.dismissNotification({ id: 'first' })).toEqual(expect.objectContaining({ ok: false, errorCode: 'NOTIFICATION_UNREAD' }))
    expect(runtime.markNotificationRead({ id: 'first' })).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          changed: 1,
          notification: expect.objectContaining({ id: 'first', read: true, isRead: true })
        })
      })
    )
    expect(runtime.dismissNotification({ id: notificationFrom(first).id })).toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ changed: 1, total: 1, unreadCount: 1 }) })
    )
    expect(runtime.markNotificationRead({ all: true })).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ changed: 1, unreadCount: 0 }) }))
    expect(runtime.clearNotifications()).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ changed: 1, total: 0 }) }))
    expect(runtime.controlSocketNotificationSummary()).toEqual({ notificationCount: 0, unreadNotificationCount: 0 })
  })

  it('opens and jumps to unread notifications through injected renderer focus', async () => {
    const runtime = await loadRuntime()
    const dispatchRendererControlRequest = vi.fn((method: string) => ({ ok: true, data: { focused: method === 'notification.open' } }))
    const publishControlEvent = vi.fn()
    runtime.configureControlSocketNotificationRuntime({ dispatchRendererControlRequest, publishControlEvent })

    runtime.createNotification({ id: 'read-first', title: 'Read first' })
    runtime.createNotification({ id: 'jump-target', title: 'Jump target', panelId: 'panel-2', sessionId: 'terminal-2' })
    runtime.markNotificationRead({ id: 'read-first' })

    await expect(runtime.jumpToUnreadNotification()).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          changed: 1,
          notification: expect.objectContaining({ id: 'jump-target', read: true }),
          focusRequest: expect.objectContaining({ panelId: 'panel-2', sessionId: 'terminal-2', terminalSessionId: 'terminal-2' }),
          focus: { focused: true },
          unreadCount: 0
        })
      })
    )
    expect(dispatchRendererControlRequest).toHaveBeenCalledWith('notification.open', expect.objectContaining({ panelId: 'panel-2', sessionId: 'terminal-2' }), { focus: true })
    expect(publishControlEvent).toHaveBeenCalledWith(expect.objectContaining({ name: 'notification.opened', surfaceId: 'panel-2' }))
    await expect(runtime.jumpToUnreadNotification()).resolves.toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ changed: 0, unreadCount: 0 }) }))
  })

  it('fails open when no renderer dispatch dependency is configured', async () => {
    const runtime = await loadRuntime()
    runtime.configureControlSocketNotificationRuntime({ dispatchRendererControlRequest: undefined })
    runtime.createNotification({ id: 'no-window', title: 'No window' })

    await expect(runtime.openNotification({ id: 'no-window' })).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        errorCode: 'NO_APP_WINDOW'
      })
    )
  })

  it('wraps targeted and caller notification metadata', async () => {
    const runtime = await loadRuntime()

    expect(runtime.createTargetedNotification('notification.create_for_surface', { title: 'Missing' })).toEqual(expect.objectContaining({ ok: false, errorCode: 'NOTIFICATION_SURFACE_REQUIRED' }))
    expect(runtime.createTargetedNotification('notification.create_for_target', { title: 'Target', surface_id: 'panel-1', workspace_id: 'main' })).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          targeted: true,
          surface_id: 'panel-1',
          workspace_ref: 'workspace:1',
          notification: expect.objectContaining({ panelId: 'panel-1', workspaceId: 'main' })
        })
      })
    )
    expect(runtime.createCallerNotification({ title: 'Caller', caller: { panelId: 'panel-2', workspaceId: 'workspace-2' } })).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          targeted: true,
          surface_id: 'panel-2',
          workspace_id: 'workspace-2',
          caller: { panelId: 'panel-2', workspaceId: 'workspace-2' },
          method: 'notification.create_for_caller'
        })
      })
    )
  })
})
