import type { Component } from 'vue'
import { Bell, BookOpen, Bot, Box, CreditCard, Info, Keyboard, Lock, Server, Settings, Share2, Smartphone, SquareTerminal } from 'lucide-vue-next'
import { localeDisplayNames, supportedLocales, type I18nKey } from '@/i18n/messages'
import { themeSelectionOptions } from '@/services/app/themeRuntime'
import auroraVeilBackground from '@/assets/backgrounds/aurora-veil.webp'
import nebulaDustBackground from '@/assets/backgrounds/nebula-dust.webp'
import neonHorizonBackground from '@/assets/backgrounds/neon-horizon.webp'
import kanagawaTideBackground from '@/assets/backgrounds/kanagawa-tide.webp'
import aubergineDuneBackground from '@/assets/backgrounds/aubergine-dune.webp'
import carbonWeaveBackground from '@/assets/backgrounds/carbon-weave.webp'
import paperFogBackground from '@/assets/backgrounds/paper-fog.webp'
import porcelainSkyBackground from '@/assets/backgrounds/porcelain-sky.webp'
import roseDawnBackground from '@/assets/backgrounds/rose-dawn.webp'
import sakuraDriftBackground from '@/assets/backgrounds/sakura-drift.webp'
import jadeMistBackground from '@/assets/backgrounds/jade-mist.webp'

export type SettingSectionKey =
  | 'general'
  | 'terminal'
  | 'extensions'
  | 'models'
  | 'billing'
  | 'ai'
  | 'aiNotifications'
  | 'aiRemoteHostManagement'
  | 'mcp'
  | 'exportMcp'
  | 'skills'
  | 'rules'
  | 'shortcuts'
  | 'trustedDevices'
  | 'privacy'
  | 'about'
  | 'docs'

export type SettingsNavItem = {
  key: SettingSectionKey
  label: string
  labelKey: I18nKey
  icon: Component
  external?: boolean
}

export const settingsNavItems: SettingsNavItem[] = [
  { key: 'general', label: '通用', labelKey: 'settings.nav.general', icon: Settings },
  { key: 'terminal', label: '终端', labelKey: 'settings.nav.terminal', icon: SquareTerminal },
  { key: 'extensions', label: '扩展', labelKey: 'settings.nav.extensions', icon: Box },
  { key: 'models', label: '模型', labelKey: 'settings.nav.models', icon: Bot },
  { key: 'billing', label: '计费概览', labelKey: 'settings.nav.billing', icon: CreditCard },
  { key: 'aiNotifications', label: 'AI 通知', labelKey: 'settings.nav.aiNotifications', icon: Bell },
  { key: 'aiRemoteHostManagement', label: '主机Agent', labelKey: 'settings.nav.aiRemoteHostManagement', icon: Server },
  { key: 'exportMcp', label: '导出 MCP', labelKey: 'settings.nav.exportMcp', icon: Share2 },
  { key: 'shortcuts', label: '快捷键', labelKey: 'settings.nav.shortcuts', icon: Keyboard },
  { key: 'trustedDevices', label: '可信设备', labelKey: 'settings.nav.trustedDevices', icon: Smartphone },
  { key: 'privacy', label: '隐私', labelKey: 'settings.nav.privacy', icon: Lock },
  { key: 'about', label: '关于', labelKey: 'settings.nav.about', icon: Info },
  { key: 'docs', label: '文档', labelKey: 'settings.nav.docs', icon: BookOpen, external: true }
]

export type ThemeOption = {
  value: string
  label: string
  group: 'system' | 'default' | 'official'
  background: string
  surface: string
  accent: string
}

export const settingsThemeOptions: ThemeOption[] = themeSelectionOptions.map((option) =>
  option.value === 'auto' ? { ...option, label: '自动' } : option
)

export type BackgroundPreset = {
  id: string
  label: string
  css: string
  image?: string
}

export const settingsBackgroundPresets: BackgroundPreset[] = [
  {
    id: 'aurora-veil',
    label: 'aurora veil',
    css: `url("${auroraVeilBackground}")`,
    image: auroraVeilBackground
  },
  {
    id: 'nebula-dust',
    label: 'nebula dust',
    css: `url("${nebulaDustBackground}")`,
    image: nebulaDustBackground
  },
  {
    id: 'neon-horizon',
    label: 'neon horizon',
    css: `url("${neonHorizonBackground}")`,
    image: neonHorizonBackground
  },
  {
    id: 'kanagawa-tide',
    label: 'kanagawa tide',
    css: `url("${kanagawaTideBackground}")`,
    image: kanagawaTideBackground
  },
  {
    id: 'aubergine-dune',
    label: 'aubergine dune',
    css: `url("${aubergineDuneBackground}")`,
    image: aubergineDuneBackground
  },
  {
    id: 'carbon-weave',
    label: 'carbon weave',
    css: `url("${carbonWeaveBackground}")`,
    image: carbonWeaveBackground
  },
  {
    id: 'paper-fog',
    label: 'paper fog',
    css: `url("${paperFogBackground}")`,
    image: paperFogBackground
  },
  {
    id: 'porcelain-sky',
    label: 'porcelain sky',
    css: `url("${porcelainSkyBackground}")`,
    image: porcelainSkyBackground
  },
  {
    id: 'rose-dawn',
    label: 'rose dawn',
    css: `url("${roseDawnBackground}")`,
    image: roseDawnBackground
  },
  {
    id: 'sakura-drift',
    label: 'sakura drift',
    css: `url("${sakuraDriftBackground}")`,
    image: sakuraDriftBackground
  },
  {
    id: 'jade-mist',
    label: 'jade mist',
    css: `url("${jadeMistBackground}")`,
    image: jadeMistBackground
  }
]

// 背景 preset 目录整批更换过一次(2de8461),旧配置里的 preset id 需要迁移到
// 观感最接近的新 preset,否则老用户的壁纸会静默丢失。
export const legacyBackgroundPresetAliases: Record<string, string> = {
  'mist-lake': 'jade-mist',
  'snow-peak': 'porcelain-sky',
  'sunset-ridge': 'rose-dawn',
  'coast-dusk': 'kanagawa-tide',
  'star-field': 'nebula-dust',
  'dark-grid': 'carbon-weave',
  'aurora-terminal': 'aurora-veil',
  'graphite-signal': 'carbon-weave',
  'dawn-glass': 'paper-fog',
  'aurora-glass-image': 'aurora-veil',
  'graphite-signal-image': 'carbon-weave',
  'dawn-glass-image': 'paper-fog',
  'coast-dusk-soft-image': 'kanagawa-tide',
  'midnight-topography-image': 'nebula-dust'
}

export const settingsLanguageOptions = [
  { value: 'system', label: '跟随系统', labelKey: 'settings.general.followSystem' as const },
  ...supportedLocales.map((locale) => ({ value: locale, label: localeDisplayNames[locale], labelKey: null }))
]

export const settingsSecretPatterns = [
  { name: 'IPv4 Address', regex: '\\b((25[0-5]|(2[0-4]|1\\d|[1-9]|)\\d)\\.?\\b){4}\\b' },
  { name: 'AWS Access ID', regex: '\\b(AKIA|A3T|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{12,}\\b' },
  { name: 'GitHub Classic Personal Access Token', regex: '\\bghp_[A-Za-z0-9_]{36}\\b' },
  { name: 'Google API Key', regex: '\\bAIza[0-9A-Za-z-_]{35}\\b' }
]
