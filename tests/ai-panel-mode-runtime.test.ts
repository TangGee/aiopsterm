import { beforeEach, describe, expect, it } from 'vitest'
import { aiPanelModeStorageKey, normalizeAiPanelMode, readStoredAiPanelMode, storeAiPanelMode } from '@/services/ai/aiPanelModeRuntime'

describe('AI panel mode runtime', () => {
  beforeEach(() => {
    window.localStorage.removeItem(aiPanelModeStorageKey)
  })

  it('defaults to Codex mode and normalizes unsupported stored values', () => {
    expect(normalizeAiPanelMode('classic')).toBe('classic')
    expect(normalizeAiPanelMode('codex')).toBe('codex')
    expect(normalizeAiPanelMode('unknown')).toBe('codex')
    expect(readStoredAiPanelMode()).toBe('codex')

    window.localStorage.setItem(aiPanelModeStorageKey, 'unsupported')

    expect(readStoredAiPanelMode()).toBe('codex')
  })

  it('persists the selected AI panel mode', () => {
    storeAiPanelMode('classic')
    expect(window.localStorage.getItem(aiPanelModeStorageKey)).toBe('classic')
    expect(readStoredAiPanelMode()).toBe('classic')

    storeAiPanelMode('codex')
    expect(window.localStorage.getItem(aiPanelModeStorageKey)).toBe('codex')
    expect(readStoredAiPanelMode()).toBe('codex')
  })
})
