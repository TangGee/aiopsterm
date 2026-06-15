import { describe, expect, it, vi } from 'vitest'
import { broadcastWindowEvent, sendWebContentsEvent, sendWindowEvent, type WindowEventTarget } from '../src/shared/windowEvents'

type TestSend = (channel: string, ...args: unknown[]) => void

const activeTarget = (send: TestSend = vi.fn()): WindowEventTarget => ({
  isDestroyed: () => false,
  webContents: {
    isDestroyed: () => false,
    send
  }
})

describe('main window event sending', () => {
  it('sends events to active windows', () => {
    const send = vi.fn()
    const sent = sendWindowEvent(activeTarget(send), 'terminal:lifecycle', { id: 'term-1' })

    expect(sent).toBe(true)
    expect(send).toHaveBeenCalledWith('terminal:lifecycle', { id: 'term-1' })
  })

  it('skips destroyed windows and destroyed webContents', () => {
    const destroyedWindowSend = vi.fn()
    const destroyedWebContentsSend = vi.fn()

    expect(
      sendWindowEvent(
        {
          isDestroyed: () => true,
          webContents: {
            isDestroyed: () => false,
            send: destroyedWindowSend
          }
        },
        'terminal:lifecycle',
        { id: 'term-1' }
      )
    ).toBe(false)
    expect(
      sendWindowEvent(
        {
          isDestroyed: () => false,
          webContents: {
            isDestroyed: () => true,
            send: destroyedWebContentsSend
          }
        },
        'terminal:lifecycle',
        { id: 'term-2' }
      )
    ).toBe(false)
    expect(destroyedWindowSend).not.toHaveBeenCalled()
    expect(destroyedWebContentsSend).not.toHaveBeenCalled()
  })

  it('treats Electron destroyed-object send failures as a skipped event', () => {
    const sent = sendWindowEvent(
      activeTarget(() => {
        throw new Error('Object has been destroyed')
      }),
      'terminal:lifecycle',
      { id: 'term-1' }
    )

    expect(sent).toBe(false)
  })

  it('rethrows non-destroyed send failures', () => {
    expect(() =>
      sendWindowEvent(
        activeTarget(() => {
          throw new Error('permission denied')
        }),
        'terminal:lifecycle',
        { id: 'term-1' }
      )
    ).toThrow('permission denied')
  })

  it('broadcasts only to live targets', () => {
    const liveSend = vi.fn()
    const destroyedSend = vi.fn()

    broadcastWindowEvent(
      [
        activeTarget(liveSend),
        {
          isDestroyed: () => true,
          webContents: {
            isDestroyed: () => false,
            send: destroyedSend
          }
        }
      ],
      'skills:update',
      [{ name: 'ops' }]
    )

    expect(liveSend).toHaveBeenCalledWith('skills:update', [{ name: 'ops' }])
    expect(destroyedSend).not.toHaveBeenCalled()
  })

  it('skips destroyed direct webContents progress targets', () => {
    const send = vi.fn()
    const sent = sendWebContentsEvent(
      {
        isDestroyed: () => true,
        send
      },
      'app:update-progress',
      { percent: 25 }
    )

    expect(sent).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })
})
