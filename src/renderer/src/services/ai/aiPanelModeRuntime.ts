export type AiPanelMode = 'codex' | 'classic'
export type AiPanelWorkspaceLinkMode = 'follow-workspace' | 'manual'

export const aiPanelModeStorageKey = 'aiopsterm.aiPanelMode'
export const aiPanelWorkspaceLinkModeStorageKey = 'aiopsterm.aiPanelWorkspaceLinkMode'

export const normalizeAiPanelMode = (value: unknown): AiPanelMode => (value === 'classic' || value === 'codex' ? value : 'codex')
export const normalizeAiPanelWorkspaceLinkMode = (value: unknown): AiPanelWorkspaceLinkMode =>
  value === 'manual' || value === 'follow-workspace' ? value : 'follow-workspace'

export const readStoredAiPanelMode = (): AiPanelMode => {
  try {
    return normalizeAiPanelMode(window.localStorage?.getItem(aiPanelModeStorageKey))
  } catch {
    return 'codex'
  }
}

export const readStoredAiPanelWorkspaceLinkMode = (): AiPanelWorkspaceLinkMode => {
  try {
    return normalizeAiPanelWorkspaceLinkMode(window.localStorage?.getItem(aiPanelWorkspaceLinkModeStorageKey))
  } catch {
    return 'follow-workspace'
  }
}

export const storeAiPanelMode = (mode: AiPanelMode) => {
  try {
    window.localStorage?.setItem(aiPanelModeStorageKey, mode)
  } catch {
    /* Storage can be unavailable in hardened browser contexts. */
  }
}

export const storeAiPanelWorkspaceLinkMode = (mode: AiPanelWorkspaceLinkMode) => {
  try {
    window.localStorage?.setItem(aiPanelWorkspaceLinkModeStorageKey, mode)
  } catch {
    /* Storage can be unavailable in hardened browser contexts. */
  }
}
