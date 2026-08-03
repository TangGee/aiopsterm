import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  captureUiFocus,
  installUiFocusCoordinator,
  preserveContentFocusOnPointerDown,
  registerUiFocusScope,
  requestUiFocus,
  resetUiFocusCoordinatorForTests,
  restoreUiFocus
} from '@/services/app/uiFocusCoordinator'

const flushFocusFrames = async () => {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
}

describe('uiFocusCoordinator', () => {
  beforeAll(() => installUiFocusCoordinator())

  afterEach(() => {
    document.body.innerHTML = ''
    resetUiFocusCoordinatorForTests()
  })

  it('hands navigation focus from application chrome to the target scope', async () => {
    const chrome = document.createElement('button')
    chrome.setAttribute('data-ui-focus-chrome', '')
    const root = document.createElement('section')
    root.setAttribute('data-ui-focus-scope', 'workspace-terminal')
    const input = document.createElement('textarea')
    root.appendChild(input)
    document.body.append(chrome, root)
    chrome.focus()

    const unregister = registerUiFocusScope({
      id: 'workspace-terminal',
      root: () => root,
      focusPrimary: () => {
        input.focus()
        return true
      }
    })
    requestUiFocus({
      scopeId: 'workspace-terminal',
      policy: 'target-primary',
      cause: 'navigation'
    })
    await flushFocusFrames()

    expect(document.activeElement).toBe(input)
    unregister()
  })

  it('targets the current primary element instead of restoring an older focus in the same scope', async () => {
    const root = document.createElement('section')
    root.setAttribute('data-ui-focus-scope', 'workspace-terminal')
    const previous = document.createElement('textarea')
    const target = document.createElement('textarea')
    root.append(previous, target)
    document.body.appendChild(root)
    previous.focus()

    registerUiFocusScope({
      id: 'workspace-terminal',
      root: () => root,
      focusPrimary: () => {
        target.focus()
        return document.activeElement === target
      },
      isPrimaryFocused: () => document.activeElement === target
    })
    requestUiFocus({
      scopeId: 'workspace-terminal',
      policy: 'target-primary',
      cause: 'navigation'
    })
    await flushFocusFrames()

    expect(document.activeElement).toBe(target)
  })

  it('retries a primary focus request until the target is ready', async () => {
    const root = document.createElement('section')
    root.setAttribute('data-ui-focus-scope', 'workspace-terminal')
    document.body.appendChild(root)
    const target = document.createElement('textarea')
    let attempts = 0

    registerUiFocusScope({
      id: 'workspace-terminal',
      root: () => root,
      focusPrimary: () => {
        attempts += 1
        if (attempts < 2) return false
        root.appendChild(target)
        target.focus()
        return document.activeElement === target
      },
      isPrimaryFocused: () => document.activeElement === target
    })
    requestUiFocus({
      scopeId: 'workspace-terminal',
      policy: 'target-primary',
      cause: 'navigation'
    })
    await flushFocusFrames()

    expect(attempts).toBe(2)
    expect(document.activeElement).toBe(target)
  })

  it('does not let an old navigation request steal a newer user interaction', async () => {
    const chrome = document.createElement('button')
    chrome.setAttribute('data-ui-focus-chrome', '')
    const root = document.createElement('section')
    root.setAttribute('data-ui-focus-scope', 'workspace-terminal')
    const terminalInput = document.createElement('textarea')
    root.appendChild(terminalInput)
    const userInput = document.createElement('input')
    document.body.append(chrome, root, userInput)
    chrome.focus()

    registerUiFocusScope({
      id: 'workspace-terminal',
      root: () => root,
      focusPrimary: () => {
        terminalInput.focus()
        return true
      }
    })
    requestUiFocus({
      scopeId: 'workspace-terminal',
      policy: 'target-primary',
      cause: 'navigation'
    })
    userInput.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    userInput.focus()
    await flushFocusFrames()

    expect(document.activeElement).toBe(userInput)
  })

  it('restores a captured owner after a temporary input is removed', () => {
    const source = document.createElement('textarea')
    source.setAttribute('data-ui-focus-scope', 'ai-panel')
    document.body.appendChild(source)
    source.focus()
    const snapshot = captureUiFocus()
    const temporary = document.createElement('textarea')
    document.body.appendChild(temporary)
    temporary.focus()
    temporary.remove()

    expect(restoreUiFocus(snapshot)).toBe(true)
    expect(document.activeElement).toBe(source)
  })

  it('keeps pointer window controls from becoming the content focus owner', () => {
    const event = new MouseEvent('mousedown', { button: 0, cancelable: true })
    const preventDefault = vi.spyOn(event, 'preventDefault')

    preserveContentFocusOnPointerDown(event)

    expect(preventDefault).toHaveBeenCalled()
  })

  it('focuses a modal and restores the previous owner when it closes', async () => {
    const source = document.createElement('textarea')
    source.setAttribute('data-ui-focus-scope', 'workspace-terminal')
    document.body.appendChild(source)
    source.focus()

    const dialog = document.createElement('section')
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    const dialogInput = document.createElement('input')
    dialog.appendChild(dialogInput)
    document.body.appendChild(dialog)
    dialogInput.focus()
    await flushFocusFrames()
    expect(document.activeElement).toBe(dialogInput)

    dialog.remove()
    await flushFocusFrames()
    expect(document.activeElement).toBe(source)
  })
})
