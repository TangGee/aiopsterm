import type { EditorUserConfig } from '@shared/preload'

export type EditorRuntimeSettings = EditorUserConfig

const fontFamilies: Record<string, string> = {
  'cascadia-mono': '"Cascadia Mono", "Cascadia Code", Consolas, "Courier New", monospace',
  'jetbrains-mono': '"JetBrains Mono", "SFMono-Regular", Consolas, "Courier New", monospace',
  'source-code-pro': '"Source Code Pro", "SFMono-Regular", Consolas, "Courier New", monospace',
  'sf-mono': '"SF Mono", Menlo, Monaco, "Courier New", monospace',
  menlo: 'Menlo, Monaco, "Courier New", monospace',
  monaco: 'Monaco, Menlo, "Courier New", monospace',
  consolas: 'Consolas, "Courier New", monospace',
  'ubuntu-mono': '"Ubuntu Mono", "DejaVu Sans Mono", "Liberation Mono", monospace',
  'dejavu-sans-mono': '"DejaVu Sans Mono", "Liberation Mono", monospace',
  'liberation-mono': '"Liberation Mono", "DejaVu Sans Mono", monospace',
  'system-default': 'monospace'
}

export const resolveEditorFontFamily = (fontKey: string) => fontFamilies[fontKey] || fontFamilies['system-default']

export const editorLineHeightPx = (settings: Pick<EditorRuntimeSettings, 'fontSize' | 'lineHeight'>) =>
  settings.lineHeight > 0 ? settings.lineHeight : Math.round(settings.fontSize * 1.45)

export const editorIndent = (settings: Pick<EditorRuntimeSettings, 'tabSize'>) => ' '.repeat(Math.max(1, Math.min(8, Math.round(settings.tabSize))))

export const applyEditorSettingsToDocument = (settings: EditorRuntimeSettings) => {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const lineHeight = editorLineHeightPx(settings)
  root.dataset.editorWordWrap = settings.wordWrap
  root.dataset.editorMinimap = settings.minimap ? 'on' : 'off'
  root.dataset.editorMouseWheelZoom = settings.mouseWheelZoom ? 'on' : 'off'
  root.style.setProperty('--editor-font-family', resolveEditorFontFamily(settings.fontFamily))
  root.style.setProperty('--editor-font-size', `${settings.fontSize}px`)
  root.style.setProperty('--editor-line-height', `${lineHeight}px`)
  root.style.setProperty('--editor-tab-size', `${settings.tabSize}`)
}
