import type { Component } from 'vue'
import { Boxes, Cloud, Code2, Database, FileText, FolderGit2, Plug, Server, Settings, UserCircle } from 'lucide-vue-next'

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
  icon: Component
  position: 'main' | 'bottom'
}

export const menuItems: MenuItem[] = [
  { key: 'workspace', label: '工作区', icon: Server, position: 'main' },
  { key: 'assets', label: '资产', icon: Cloud, position: 'main' },
  { key: 'files', label: '文件', icon: FolderGit2, position: 'main' },
  { key: 'snippets', label: '片段', icon: Code2, position: 'main' },
  { key: 'knowledge', label: '知识库', icon: FileText, position: 'main' },
  { key: 'extensions', label: '扩展', icon: Plug, position: 'main' },
  { key: 'kubernetes', label: 'Kubernetes', icon: Boxes, position: 'main' },
  { key: 'database', label: '数据库', icon: Database, position: 'main' },
  { key: 'settings', label: '设置', icon: Settings, position: 'bottom' },
  { key: 'user', label: '用户', icon: UserCircle, position: 'bottom' }
]
