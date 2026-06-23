export type KnowledgeEditorMode = 'editor' | 'preview'

export type KnowledgeTextEditorApi = {
  revealLineRange: (startLine: number, endLine?: number) => void
  insertAtCursor: (value: string) => void
}

export type KnowledgeImageViewerApi = {
  resetZoom: () => void
}

export type KnowledgeMarkdownPreviewApi = {
  renderMermaid: (theme: 'dark' | 'default') => Promise<void>
}
