export type AiPanelMode = 'codex' | 'classic'

export const aiPanelModeStorageKey = 'aiopsterm.aiPanelMode'

export const normalizeAiPanelMode = (value: unknown): AiPanelMode => (value === 'classic' || value === 'codex' ? value : 'codex')

export const readStoredAiPanelMode = (): AiPanelMode => {
  try {
    return normalizeAiPanelMode(window.localStorage?.getItem(aiPanelModeStorageKey))
  } catch {
    return 'codex'
  }
}

export const storeAiPanelMode = (mode: AiPanelMode) => {
  try {
    window.localStorage?.setItem(aiPanelModeStorageKey, mode)
  } catch {
    /* Storage can be unavailable in hardened browser contexts. */
  }
}
