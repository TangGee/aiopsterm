import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

describe('AI command card styles', () => {
  it('keeps the primary command action filled and readable over app backgrounds', () => {
    const styles = readFileSync(
      resolve(__dirname, '../src/renderer/src/styles/ai-panel-message-command-card.less'),
      'utf8'
    )

    expect(styles).toContain('.app-shell.has-app-background .message-command-actions button.primary {')
    expect(styles).toContain('color: var(--theme-module-active-panel-bg);')
    expect(styles).toContain('background: var(--theme-module-active-accent);')
  })

  it('uses a neutral non-interactive style for disabled primary command actions', () => {
    const styles = readFileSync(
      resolve(__dirname, '../src/renderer/src/styles/ai-panel-message-command-card.less'),
      'utf8'
    )

    expect(styles).toContain('.message-command-actions button.primary:not(:disabled):hover {')
    expect(styles).toContain('.message-command-actions button.primary:disabled,\n.app-shell.has-app-background .message-command-actions button.primary:disabled {')
    expect(styles).toContain('opacity: 1;\n  cursor: not-allowed;')
    expect(styles).toContain('background: color-mix(in srgb, var(--theme-module-active-text-muted) 8%, var(--theme-module-active-card-strong-bg));')
    expect(styles).toContain('.message-command-actions button.primary:disabled svg {')
  })
})
