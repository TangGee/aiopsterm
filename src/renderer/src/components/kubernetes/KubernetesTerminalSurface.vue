<template>
  <section class="k8s-terminal-surface">
    <div class="k8s-terminal-tabs">
      <div class="k8s-tabs-list">
        <div
          v-for="tab in workspace.k8sTerminalTabs"
          :key="tab.id"
          class="k8s-tab-item"
          :class="{ active: tab.id === workspace.k8sActiveTerminalId }"
          @click="workspace.setActiveK8sTerminal(tab.id)"
        >
          <span class="k8s-tab-name">{{ tab.name }}</span>
          <small>{{ tab.namespace }} · {{ tab.status }}</small>
          <button
            title="关闭"
            @click.stop="void workspace.closeK8sTerminalTab(tab.id)"
          >
            <X />
          </button>
        </div>
      </div>
      <button
        class="k8s-workspace-button"
        title="新增终端"
        @click="createTerminalTab"
      >
        <Plus />
      </button>
    </div>
    <div
      v-if="workspace.k8sActiveTerminal"
      class="k8s-terminal-meta"
    >
      <span>Session: {{ workspace.k8sActiveTerminal.sessionId }}</span>
      <span>Namespace: {{ workspace.k8sActiveTerminal.namespace }}</span>
      <span>Size: {{ workspace.k8sActiveTerminal.cols }}x{{ workspace.k8sActiveTerminal.rows }}</span>
      <span>Status: {{ workspace.k8sActiveTerminal.status }}</span>
      <button
        title="同步尺寸"
        @click="syncActiveTerminalSize"
      >
        Resize
      </button>
      <button
        title="采集命令输出到 AI"
        :disabled="workspace.k8sActiveTerminal.status !== 'connected'"
        @click="sendAiCommand"
      >
        AI Command
      </button>
      <button
        title="结束会话"
        :disabled="workspace.k8sActiveTerminal.status === 'ended'"
        @click="void workspace.endK8sTerminalSession(workspace.k8sActiveTerminal.id)"
      >
        End
      </button>
    </div>
    <div class="k8s-terminal-container">
      <pre v-if="workspace.k8sActiveTerminal">{{ workspace.k8sActiveTerminal.output }}</pre>
      <div
        v-else
        class="empty-state"
      >
        选择集群打开 Kubernetes 终端
      </div>
    </div>
    <form
      class="k8s-command-line"
      @submit.prevent="sendCommand"
    >
      <span>$</span>
      <input
        v-model="command"
        placeholder="输入 kubectl 命令"
        :disabled="workspace.k8sActiveTerminal?.status !== 'connected'"
      />
    </form>
    <div
      v-if="workspace.k8sActiveTerminal?.commandHistory.length"
      class="k8s-terminal-history"
    >
      <button
        v-for="history in workspace.k8sActiveTerminal.commandHistory.slice(0, 4)"
        :key="history"
        @click="command = history"
      >
        {{ history }}
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { useKubernetesWorkspaceRuntimeContext } from '@/services/kubernetesWorkspaceContext'

const { workspace, command, createTerminalTab, syncActiveTerminalSize, sendAiCommand, sendCommand, Plus, X } = useKubernetesWorkspaceRuntimeContext()
</script>
