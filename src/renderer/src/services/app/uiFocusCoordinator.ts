export type UiFocusPolicy = 'target-primary' | 'preserve' | 'restore' | 'none'
export type UiFocusCause = 'navigation' | 'pointer' | 'keyboard' | 'overlay' | 'window' | 'external'

export type UiFocusSnapshot = {
  element: HTMLElement | null
  scopeId: string
  interaction: number
}

export type UiFocusScope = {
  id: string
  root: () => HTMLElement | null
  isActive?: () => boolean
  focusPrimary?: () => boolean | void
}

export type UiFocusRequest = {
  scopeId: string
  policy: UiFocusPolicy
  cause: UiFocusCause
  frames?: number
}

const focusScopeAttribute = 'data-ui-focus-scope'
const focusChromeSelector = '[data-ui-focus-chrome]'
const modalSelector = '[role="dialog"][aria-modal="true"]'
const implicitScopeSelectors: Record<string, string> = {
  'ai-panel': '.ai-panel',
  'project-files': '.project-files-panel'
}
const focusableSelector = [
  '[data-ui-focus-primary]',
  '[autofocus]',
  'input:not([disabled]):not([type="hidden"])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[contenteditable="true"]',
  '[contenteditable="plaintext-only"]',
  'button:not([disabled])',
  '[href]',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

const scopes = new Map<string, UiFocusScope>()
const lastFocusedByScope = new Map<string, HTMLElement>()
const modalSnapshots = new WeakMap<Element, UiFocusSnapshot>()
let installed = false
let interactionSequence = 0
let requestSequence = 0
let windowSnapshot: UiFocusSnapshot | null = null
let modalObserver: MutationObserver | null = null
let focusHistory: UiFocusSnapshot[] = []

const elementScopeId = (element: Element | null) => {
  const explicit = element?.closest<HTMLElement>(`[${focusScopeAttribute}]`)?.getAttribute(focusScopeAttribute) || ''
  if (explicit) return explicit
  return Object.entries(implicitScopeSelectors).find(([, selector]) => element?.closest(selector))?.[0] || ''
}

const isElementVisible = (element: HTMLElement | null) => {
  if (!element?.isConnected) return false
  if (element.closest('[hidden], [aria-hidden="true"], [inert]')) return false
  let current: HTMLElement | null = element
  while (current) {
    const style = globalThis.getComputedStyle?.(current)
    if (style?.display === 'none' || style?.visibility === 'hidden') return false
    current = current.parentElement
  }
  return true
}

const focusElement = (element: HTMLElement | null) => {
  if (!element || !isElementVisible(element)) return false
  element.focus({ preventScroll: true })
  return document.activeElement === element || element.contains(document.activeElement)
}

const activeModal = () => document.querySelector<HTMLElement>(modalSelector)

const scopeRootForId = (scopeId: string) => {
  const registered = scopes.get(scopeId)?.root() || null
  if (registered) return registered
  const explicit = document.querySelector<HTMLElement>(`[${focusScopeAttribute}="${scopeId}"]`)
  if (explicit) return explicit
  const implicitSelector = implicitScopeSelectors[scopeId]
  return implicitSelector ? document.querySelector<HTMLElement>(implicitSelector) : null
}

const focusPrimaryInRoot = (root: HTMLElement | null) => {
  if (!root || !isElementVisible(root)) return false
  if (root.hasAttribute('data-ui-focus-primary') && focusElement(root)) return true
  const target = root.querySelector<HTMLElement>(focusableSelector)
  if (focusElement(target)) return true
  if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1')
  return focusElement(root)
}

const scopeIsActive = (scope: UiFocusScope) => scope.isActive?.() !== false && isElementVisible(scope.root())

const requestFrame = (callback: () => void) => {
  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(callback)
    return
  }
  window.setTimeout(callback, 0)
}

const findModalElements = (node: Node) => {
  if (!(node instanceof Element)) return []
  const elements: Element[] = []
  if (node.matches(modalSelector)) elements.push(node)
  elements.push(...node.querySelectorAll(modalSelector))
  return elements
}

const focusModal = (modal: HTMLElement) => {
  requestFrame(() => {
    if (!modal.isConnected || modal.contains(document.activeElement)) return
    focusPrimaryInRoot(modal)
  })
}

const handleAddedNode = (node: Node) => {
  findModalElements(node).forEach((modal) => {
    const current = captureUiFocus()
    const snapshot = current.element && modal.contains(current.element)
      ? focusHistory.find((item) => item.element && !modal.contains(item.element)) || current
      : current
    modalSnapshots.set(modal, snapshot)
    focusModal(modal as HTMLElement)
  })
}

const handleRemovedNode = (node: Node) => {
  findModalElements(node).forEach((modal) => {
    const snapshot = modalSnapshots.get(modal)
    if (snapshot) restoreUiFocus(snapshot, true)
  })
}

const handleFocusIn = (event: FocusEvent) => {
  const element = event.target instanceof HTMLElement ? event.target : null
  if (!element) return
  const scopeId = elementScopeId(element)
  if (scopeId) lastFocusedByScope.set(scopeId, element)
  focusHistory = [
    {
      element,
      scopeId,
      interaction: interactionSequence
    },
    ...focusHistory.filter((item) => item.element !== element)
  ].slice(0, 16)
}

const handleInteraction = () => {
  interactionSequence += 1
  requestSequence += 1
}

const handleWindowBlur = () => {
  windowSnapshot = captureUiFocus()
}

const handleWindowFocus = () => {
  const snapshot = windowSnapshot
  windowSnapshot = null
  if (!snapshot) return
  requestFrame(() => {
    const active = document.activeElement
    if (active && active !== document.body && isElementVisible(active as HTMLElement)) return
    restoreUiFocus(snapshot, true)
  })
}

export const installUiFocusCoordinator = () => {
  if (installed || typeof document === 'undefined') return
  installed = true
  document.addEventListener('focusin', handleFocusIn, true)
  document.addEventListener('pointerdown', handleInteraction, true)
  document.addEventListener('keydown', handleInteraction, true)
  window.addEventListener('blur', handleWindowBlur)
  window.addEventListener('focus', handleWindowFocus)
  modalObserver = new MutationObserver((records) => {
    records.forEach((record) => {
      record.addedNodes.forEach(handleAddedNode)
      record.removedNodes.forEach(handleRemovedNode)
    })
  })
  if (document.body) modalObserver.observe(document.body, { childList: true, subtree: true })
}

export const registerUiFocusScope = (scope: UiFocusScope) => {
  scopes.set(scope.id, scope)
  return () => {
    if (scopes.get(scope.id) === scope) scopes.delete(scope.id)
    lastFocusedByScope.delete(scope.id)
  }
}

export const captureUiFocus = (): UiFocusSnapshot => {
  const element = document.activeElement instanceof HTMLElement ? document.activeElement : null
  return {
    element,
    scopeId: elementScopeId(element),
    interaction: interactionSequence
  }
}

export const restoreUiFocus = (snapshot: UiFocusSnapshot | null, onlyWhenUnowned = false) => {
  if (!snapshot) return false
  const modal = activeModal()
  if (modal && (!snapshot.element || !modal.contains(snapshot.element))) return false
  if (onlyWhenUnowned) {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (active && active !== document.body && isElementVisible(active) && !active.closest(focusChromeSelector)) return false
  }
  if (focusElement(snapshot.element)) return true
  if (snapshot.scopeId) {
    const remembered = lastFocusedByScope.get(snapshot.scopeId) || null
    if (focusElement(remembered)) return true
    const scope = scopes.get(snapshot.scopeId)
    if (scope && scopeIsActive(scope)) {
      if (scope.focusPrimary && scope.focusPrimary() !== false) return true
      return focusPrimaryInRoot(scope.root())
    }
    return focusPrimaryInRoot(scopeRootForId(snapshot.scopeId))
  }
  return false
}

export const requestUiFocus = ({ scopeId, policy, frames = 8 }: UiFocusRequest) => {
  if (policy === 'none' || policy === 'preserve') return 0
  const requestId = ++requestSequence
  const interactionAtRequest = interactionSequence
  const run = (remaining: number) => {
    if (requestId !== requestSequence || interactionAtRequest !== interactionSequence) return
    const modal = activeModal()
    const scope = scopes.get(scopeId)
    const root = scopeRootForId(scopeId)
    if (modal && !root?.contains(modal)) return
    if (!root || (scope && !scopeIsActive(scope)) || !isElementVisible(root)) {
      if (remaining > 1) requestFrame(() => run(remaining - 1))
      return
    }
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (active && root.contains(active) && isElementVisible(active)) return
    if (
      active &&
      active !== document.body &&
      isElementVisible(active) &&
      !active.closest(focusChromeSelector) &&
      elementScopeId(active) !== scopeId
    ) {
      return
    }
    const remembered = lastFocusedByScope.get(scopeId) || null
    if (focusElement(remembered)) return
    if (scope?.focusPrimary && scope.focusPrimary() !== false) return
    if (focusPrimaryInRoot(root)) return
    if (remaining > 1) requestFrame(() => run(remaining - 1))
  }
  requestFrame(() => run(Math.max(1, frames)))
  return requestId
}

export const cancelUiFocusRequests = () => {
  requestSequence += 1
}

export const preserveContentFocusOnPointerDown = (event: PointerEvent | MouseEvent) => {
  if (event.button !== 0) return
  event.preventDefault()
}

export const resetUiFocusCoordinatorForTests = () => {
  requestSequence += 1
  interactionSequence = 0
  scopes.clear()
  lastFocusedByScope.clear()
  focusHistory = []
  windowSnapshot = null
}
