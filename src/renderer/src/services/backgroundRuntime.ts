import { settingsBackgroundPresets } from '@/config/settings'
import type { UserConfig } from '@shared/preload'

export const backgroundImageCss = (image: string) => {
  if (!image) return 'none'
  const escaped = image.replace(/"/g, '\\"')
  return `url("${escaped}")`
}

export const backgroundStyleVars = (background: UserConfig['background']) => {
  const preset = settingsBackgroundPresets.find((item) => item.id === background.image)
  const image = background.mode === 'custom' ? backgroundImageCss(background.image) : preset?.css || 'none'
  return {
    '--app-bg-image': image,
    '--app-bg-opacity': String(background.mode === 'none' ? 0 : background.opacity),
    '--app-bg-brightness': String(background.brightness)
  }
}
