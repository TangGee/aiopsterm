import type { Component } from 'vue'
import { Bell, BookOpen, Bot, Box, CreditCard, Info, Keyboard, Lock, Server, Settings, Share2, Smartphone, SquareTerminal } from 'lucide-vue-next'
import { localeDisplayNames, supportedLocales, type I18nKey } from '@/i18n/messages'
import { themeSelectionOptions } from '@/services/app/themeRuntime'
import auroraGlassBackground from '@/assets/backgrounds/aurora-glass.webp'
import coastDuskSoftBackground from '@/assets/backgrounds/coast-dusk-soft.webp'
import dawnGlassBackground from '@/assets/backgrounds/dawn-glass.webp'
import graphiteSignalBackground from '@/assets/backgrounds/graphite-signal.webp'
import midnightTopographyBackground from '@/assets/backgrounds/midnight-topography.webp'

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
    id: 'mist-lake',
    label: 'mist lake',
    css: 'radial-gradient(circle at 18% 16%, rgb(214 244 235 / 0.62), transparent 34%), radial-gradient(circle at 82% 18%, rgb(132 177 191 / 0.48), transparent 36%), linear-gradient(145deg, #273845 0%, #617985 48%, #16202a 100%)'
  },
  {
    id: 'snow-peak',
    label: 'snow peak',
    css: 'radial-gradient(circle at 28% 20%, rgb(248 252 255 / 0.7), transparent 30%), radial-gradient(circle at 72% 40%, rgb(134 190 201 / 0.38), transparent 42%), linear-gradient(150deg, #263b4d 0%, #8eb1bd 52%, #1a2533 100%)'
  },
  {
    id: 'sunset-ridge',
    label: 'sunset ridge',
    css: 'radial-gradient(circle at 20% 18%, rgb(247 180 92 / 0.58), transparent 34%), radial-gradient(circle at 78% 34%, rgb(98 142 116 / 0.36), transparent 40%), linear-gradient(148deg, #352d2d 0%, #596b54 48%, #151d28 100%)'
  },
  {
    id: 'coast-dusk',
    label: 'coast dusk',
    css: 'radial-gradient(circle at 18% 24%, rgb(232 136 95 / 0.5), transparent 34%), radial-gradient(circle at 78% 26%, rgb(107 169 154 / 0.42), transparent 40%), linear-gradient(145deg, #372b35 0%, #5f7f7b 48%, #172230 100%)'
  },
  {
    id: 'star-field',
    label: 'star field',
    css: 'radial-gradient(circle at 30% 30%, rgb(247 250 252 / 0.68) 0 1px, transparent 2px), radial-gradient(circle at 70% 55%, rgb(207 216 227 / 0.55) 0 1px, transparent 2px), radial-gradient(circle at 18% 70%, rgb(86 182 194 / 0.24), transparent 34%), linear-gradient(145deg, #050814, #111827 56%, #1f2937)'
  },
  {
    id: 'dark-grid',
    label: 'dark grid',
    css: 'linear-gradient(rgb(255 255 255 / 0.045) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.035) 1px, transparent 1px), radial-gradient(circle at 18% 20%, rgb(86 182 194 / 0.26), transparent 34%), linear-gradient(145deg, #11151d 0%, #202837 52%, #10141b 100%)'
  },
  {
    id: 'aurora-terminal',
    label: 'aurora terminal',
    css: 'radial-gradient(circle at 20% 22%, rgb(80 203 180 / 0.42), transparent 32%), radial-gradient(circle at 78% 28%, rgb(159 133 204 / 0.34), transparent 36%), radial-gradient(circle at 62% 78%, rgb(230 180 80 / 0.18), transparent 34%), linear-gradient(150deg, #131820 0%, #232332 48%, #0f151d 100%)'
  },
  {
    id: 'graphite-signal',
    label: 'graphite signal',
    css: 'radial-gradient(circle at 18% 70%, rgb(140 207 126 / 0.32), transparent 34%), radial-gradient(circle at 82% 18%, rgb(86 182 194 / 0.28), transparent 35%), linear-gradient(160deg, #191b1f 0%, #323840 46%, #101217 100%)'
  },
  {
    id: 'dawn-glass',
    label: 'dawn glass',
    css: 'radial-gradient(circle at 20% 18%, rgb(242 166 112 / 0.46), transparent 30%), radial-gradient(circle at 78% 22%, rgb(112 186 177 / 0.34), transparent 38%), radial-gradient(circle at 58% 82%, rgb(139 160 199 / 0.26), transparent 36%), linear-gradient(150deg, #2b2a34 0%, #495d62 50%, #151922 100%)'
  },
  {
    id: 'aurora-glass-image',
    label: 'aurora glass',
    css: `url("${auroraGlassBackground}")`,
    image: auroraGlassBackground
  },
  {
    id: 'graphite-signal-image',
    label: 'graphite signal',
    css: `url("${graphiteSignalBackground}")`,
    image: graphiteSignalBackground
  },
  {
    id: 'dawn-glass-image',
    label: 'dawn glass image',
    css: `url("${dawnGlassBackground}")`,
    image: dawnGlassBackground
  },
  {
    id: 'coast-dusk-soft-image',
    label: 'coast dusk soft',
    css: `url("${coastDuskSoftBackground}")`,
    image: coastDuskSoftBackground
  },
  {
    id: 'midnight-topography-image',
    label: 'midnight topography',
    css: `url("${midnightTopographyBackground}")`,
    image: midnightTopographyBackground
  }
]

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
