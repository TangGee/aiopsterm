import { settingsBackgroundPresets } from '@/config/settings'
import type { UserConfig } from '@shared/contracts/userConfig'

const backgroundNumber = (value: number | undefined, fallback: number) => (Number.isFinite(value) ? String(value) : String(fallback))

export const backgroundImageCss = (image: string) => {
  if (!image) return 'none'
  const escaped = image.replace(/"/g, '\\"')
  return `url("${escaped}")`
}

export const backgroundStyleVars = (background: UserConfig['background']) => {
  const preset = settingsBackgroundPresets.find((item) => item.id === background.image)
  const image = background.mode === 'custom' ? backgroundImageCss(background.image) : preset?.image ? backgroundImageCss(preset.image) : preset?.css || 'none'
  return {
    '--app-bg-image': image,
    '--app-bg-opacity': background.mode === 'none' ? '0' : backgroundNumber(background.opacity, 0),
    '--app-bg-brightness': backgroundNumber(background.brightness, 1)
  }
}

export const modalSurfaceBackgroundVars = (background: UserConfig['background']) => {
  if (background.mode === 'none') {
    return {
      '--theme-module-active-modal-surface-bg': 'var(--theme-module-active-modal-bg)',
      '--theme-module-active-modal-surface-size': 'auto',
      '--theme-module-active-modal-surface-position': '0 0',
      '--theme-module-active-modal-surface-repeat': 'repeat'
    }
  }
  return {
    '--theme-module-active-modal-surface-bg':
      'linear-gradient(color-mix(in srgb, var(--theme-module-active-modal-bg) 84%, transparent), color-mix(in srgb, var(--theme-module-active-modal-bg) 84%, transparent)), var(--app-bg-image), var(--theme-module-active-modal-bg)',
    '--theme-module-active-modal-surface-size': 'auto, cover, auto',
    '--theme-module-active-modal-surface-position': '0 0, center, 0 0',
    '--theme-module-active-modal-surface-repeat': 'repeat, no-repeat, repeat'
  }
}

const appliedBackgroundVariables = new WeakMap<HTMLElement, Record<string, string>>()

export const applyBackgroundToDocument = (background: UserConfig['background']) => {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.classList.toggle('has-app-background', background.mode !== 'none')
  const variables = {
    ...backgroundStyleVars(background),
    ...modalSurfaceBackgroundVars(background)
  }
  const applied = appliedBackgroundVariables.get(root) || {}
  for (const [key, value] of Object.entries(variables)) {
    if (applied[key] === value) continue
    root.style.setProperty(key, value)
  }
  for (const key of Object.keys(applied)) {
    if (!(key in variables)) root.style.removeProperty(key)
  }
  appliedBackgroundVariables.set(root, variables)
}
