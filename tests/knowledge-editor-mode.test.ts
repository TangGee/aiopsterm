import { afterEach, describe, expect, it } from 'vitest'
import {
  initialKnowledgeEditorMode,
  isKnowledgeEditorMarkdownPath,
  knowledgeEditorModeStorageKey,
  readStoredKnowledgeEditorMode,
  storeKnowledgeEditorMode
} from '@/services/knowledge/knowledgeEditorRuntime'

describe('knowledge editor view-mode persistence', () => {
  afterEach(() => {
    window.localStorage.removeItem(knowledgeEditorModeStorageKey)
  })

  it('detects markdown knowledge paths', () => {
    expect(isKnowledgeEditorMarkdownPath('使用指南/zh-CN/01-getting-started.md')).toBe(true)
    expect(isKnowledgeEditorMarkdownPath('notes/readme.MARKDOWN')).toBe(true)
    expect(isKnowledgeEditorMarkdownPath('images/main-window.png')).toBe(false)
    expect(isKnowledgeEditorMarkdownPath('config.json')).toBe(false)
  })

  it('round-trips the stored mode and rejects invalid stored values', () => {
    expect(readStoredKnowledgeEditorMode()).toBeNull()
    storeKnowledgeEditorMode('preview')
    expect(readStoredKnowledgeEditorMode()).toBe('preview')
    window.localStorage.setItem(knowledgeEditorModeStorageKey, 'bogus')
    expect(readStoredKnowledgeEditorMode()).toBeNull()
  })

  it('reuses the stored mode for markdown documents only', () => {
    storeKnowledgeEditorMode('preview')
    expect(initialKnowledgeEditorMode('使用指南/zh-CN/02-terminal-workspace.md')).toBe('preview')
    expect(initialKnowledgeEditorMode('scripts/tool.py')).toBe('editor')
    expect(initialKnowledgeEditorMode('images/photo.md', true)).toBe('editor')
  })

  it('defaults markdown documents to the source editor when nothing is stored', () => {
    expect(initialKnowledgeEditorMode('使用指南/index.md')).toBe('editor')
  })
})
