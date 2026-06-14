import type { Component } from 'vue'
import { BookOpen, Bot, Box, CreditCard, Info, Keyboard, Lock, Plug, Settings, ShieldCheck, SlidersHorizontal, Smartphone, SquareTerminal, Zap } from 'lucide-vue-next'
import { localeDisplayNames, supportedLocales, type I18nKey } from '@/i18n/messages'

export type SettingSectionKey =
  | 'general'
  | 'terminal'
  | 'extensions'
  | 'models'
  | 'billing'
  | 'ai'
  | 'mcp'
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
  { key: 'ai', label: 'AI 偏好设置', labelKey: 'settings.nav.ai', icon: SlidersHorizontal },
  { key: 'mcp', label: 'MCP', labelKey: 'settings.nav.mcp', icon: Plug },
  { key: 'skills', label: 'Skills', labelKey: 'settings.nav.skills', icon: Zap },
  { key: 'rules', label: '规则', labelKey: 'settings.nav.rules', icon: ShieldCheck },
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

export const settingsThemeOptions: ThemeOption[] = [
  { value: 'auto', label: '自动', group: 'system', background: 'linear-gradient(135deg, #111827 0 49%, #f7fafc 51% 100%)', surface: '#2c2f36', accent: '#4ea7ff' },
  { value: 'dark', label: '深色', group: 'default', background: '#111827', surface: '#1f2937', accent: '#4ea7ff' },
  { value: 'light', label: '浅色', group: 'default', background: '#f7fafc', surface: '#e8edf4', accent: '#1677ff' },
  { value: 'termius-dark', label: 'Termius Dark', group: 'official', background: '#111417', surface: '#202830', accent: '#6c9cf4' },
  { value: 'termius-light', label: 'Termius Light', group: 'official', background: '#ffffff', surface: '#eef3f8', accent: '#0366d6' },
  { value: 'flexoki-dark', label: 'Flexoki Dark', group: 'official', background: '#100f0f', surface: '#1c1b1a', accent: '#da702c' },
  { value: 'flexoki-light', label: 'Flexoki Light', group: 'official', background: '#fffcf0', surface: '#f2edda', accent: '#205ea6' },
  { value: 'kanagawa-wave', label: 'Kanagawa Wave', group: 'official', background: '#1f1f28', surface: '#2a2a37', accent: '#7e9cd8' },
  { value: 'kanagawa-dragon', label: 'Kanagawa Dragon', group: 'official', background: '#181616', surface: '#282424', accent: '#8ba4b0' },
  { value: 'kanagawa-lotus', label: 'Kanagawa Lotus', group: 'official', background: '#f2ecbc', surface: '#ebe3b1', accent: '#4d699b' },
  { value: 'hacker-blue', label: 'Hacker Blue', group: 'official', background: '#000814', surface: '#00203d', accent: '#4d9fff' },
  { value: 'hacker-green', label: 'Hacker Green', group: 'official', background: '#001000', surface: '#002400', accent: '#00ff41' },
  { value: 'dracula-night', label: 'Dracula Night', group: 'official', background: '#282a36', surface: '#343746', accent: '#bd93f9' },
  { value: 'catppuccin-mocha', label: 'Catppuccin Mocha', group: 'official', background: '#1e1e2e', surface: '#313244', accent: '#89b4fa' },
  { value: 'catppuccin-latte', label: 'Catppuccin Latte', group: 'official', background: '#eff1f5', surface: '#e6e9ef', accent: '#1e66f5' },
  { value: 'gruvbox-dark', label: 'Gruvbox Dark', group: 'official', background: '#282828', surface: '#3c3836', accent: '#83a598' },
  { value: 'nord-frost', label: 'Nord Frost', group: 'official', background: '#2e3440', surface: '#3b4252', accent: '#88c0d0' }
]

export type BackgroundPreset = {
  id: string
  label: string
  css: string
}

export const settingsBackgroundPresets: BackgroundPreset[] = [
  {
    id: 'mist-lake',
    label: 'mist lake',
    css: 'linear-gradient(150deg, #d7e7ea 0%, #8fb1bc 42%, #24313d 100%)'
  },
  {
    id: 'snow-peak',
    label: 'snow peak',
    css: 'linear-gradient(145deg, #e8f6ff 0%, #9ac6d5 48%, #344b63 100%)'
  },
  {
    id: 'sunset-ridge',
    label: 'sunset ridge',
    css: 'linear-gradient(145deg, #f7c36b 0%, #596f42 42%, #1c2530 100%)'
  },
  {
    id: 'coast-dusk',
    label: 'coast dusk',
    css: 'linear-gradient(145deg, #f0a36b 0%, #7aa097 46%, #26313d 100%)'
  },
  {
    id: 'star-field',
    label: 'star field',
    css: 'radial-gradient(circle at 30% 30%, #f7fafc 0 1px, transparent 2px), radial-gradient(circle at 70% 55%, #cfd8e3 0 1px, transparent 2px), linear-gradient(145deg, #020617, #111827 55%, #1e293b)'
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
