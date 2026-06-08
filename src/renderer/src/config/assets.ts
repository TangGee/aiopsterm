import type { Component } from 'vue'
import { Database, KeyRound, Server } from 'lucide-vue-next'

export type AssetManagementEntry = {
  key: 'assetConfig' | 'assetManagement' | 'keyManagement'
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
    name: '组织资产管理',
    description: '按表格管理堡垒机同步资产，支持分页、搜索和批量删除。',
    icon: Database
  },
  {
    key: 'keyManagement',
    name: '密钥管理',
    description: '管理本地密钥链和主机认证方式。',
    icon: KeyRound
  }
]
