import type { Component } from 'vue'
import { Boxes, Cloud, Code2, Database, FileText, FolderGit2, Plug, Server, Settings, UserCircle } from 'lucide-vue-next'
import type { I18nKey } from '@/i18n'

export type ModuleKey =
  | 'workspace'
  | 'assets'
  | 'files'
  | 'snippets'
  | 'knowledge'
  | 'extensions'
  | 'kubernetes'
  | 'database'
  | 'settings'
  | 'user'

export type MenuItem = {
  key: ModuleKey
  label: string
  labelKey: I18nKey
  icon: Component
  position: 'main' | 'bottom'
}

export const menuItems: MenuItem[] = [
  { key: 'workspace', label: '工作区', labelKey: 'module.workspace', icon: Server, position: 'main' },
  { key: 'assets', label: '资产', labelKey: 'module.assets', icon: Cloud, position: 'main' },
  { key: 'files', label: '文件', labelKey: 'module.files', icon: FolderGit2, position: 'main' },
  { key: 'snippets', label: '快捷命令', labelKey: 'module.snippets', icon: Code2, position: 'main' },
  { key: 'knowledge', label: '知识库', labelKey: 'module.knowledge', icon: FileText, position: 'main' },
  { key: 'extensions', label: '扩展', labelKey: 'module.extensions', icon: Plug, position: 'main' },
  { key: 'kubernetes', label: 'Kubernetes', labelKey: 'module.kubernetes', icon: Boxes, position: 'main' },
  { key: 'database', label: '数据库', labelKey: 'module.database', icon: Database, position: 'main' },
  { key: 'settings', label: '设置', labelKey: 'module.settings', icon: Settings, position: 'bottom' },
  { key: 'user', label: '用户', labelKey: 'module.user', icon: UserCircle, position: 'bottom' }
]
