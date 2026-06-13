import type { Component } from 'vue'
import { Database, KeyRound, Network, Server } from 'lucide-vue-next'

export type AssetManagementEntry = {
  key: 'assetConfig' | 'assetManagement' | 'keyManagement' | 'proxyManagement'
  name: string
  description: string
  icon: Component
}

export const assetManagementEntries: AssetManagementEntry[] = [
  {
    key: 'assetConfig',
    name: '主机管理',
    description: '管理 SSH 主机、分组、导入导出和连接动作。',
    icon: Server
  },
  {
    key: 'assetManagement',
    name: '堡垒机管理',
    description: '管理堡垒机组织资产、刷新来源资产和人工资产。',
    icon: Database
  },
  {
    key: 'keyManagement',
    name: '密钥管理',
    description: '管理本地密钥链和主机认证方式。',
    icon: KeyRound
  },
  {
    key: 'proxyManagement',
    name: '代理管理',
    description: '管理 SSH 代理配置，供主机、数据库和文件会话复用。',
    icon: Network
  }
]
