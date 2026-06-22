<template>
  <div class="asset-proxy-management-page">
    <div class="asset-search-container">
      <div class="asset-search-row">
        <div class="asset-management-title">
          <strong>代理管理</strong>
          <small>SSH 代理作为资源配置供主机、数据库和文件会话复用。</small>
        </div>
        <button
          class="asset-action-button"
          @click="openProxyAddPanel()"
        >
          <Network />
          新增代理
        </button>
      </div>
    </div>
    <div class="asset-proxy-list">
      <div
        v-if="workspace.sshProxyConfigs.length"
        class="asset-table-scroll"
      >
        <table>
          <thead>
            <tr>
              <th>名称</th>
              <th>类型</th>
              <th>地址</th>
              <th>认证</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="proxy in workspace.sshProxyConfigs"
              :key="proxy.name"
            >
              <td>{{ proxy.name }}</td>
              <td>{{ proxy.type }}</td>
              <td>{{ proxy.host }}:{{ proxy.port }}</td>
              <td>{{ proxy.enableProxyIdentity ? proxy.username || '-' : '无' }}</td>
              <td>
                <button @click="workspace.removeSshProxyConfig(proxy.name)">删除</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div
        v-else
        class="asset-empty-state"
      >
        <Network />
        <strong>暂无代理配置</strong>
        <small>添加后可在主机、数据库和远程文件会话中选择。</small>
        <div>
          <button @click="openProxyAddPanel()">新增代理</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Network } from 'lucide-vue-next'
import { useAssetsPanelRuntimeContext } from '@/services/assetsPanelContext'

const {
  workspace,
  openProxyAddPanel
} = useAssetsPanelRuntimeContext()
</script>
