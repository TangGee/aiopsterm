<template>
  <section class="onboarding-guide">
    <header class="onboarding-guide-header">
      <div>
        <h2>入门引导</h2>
        <p>按模块熟悉 aiopsterm 的界面、设置、资产连接和 AI 会话。</p>
      </div>
      <button
        class="settings-button"
        @click="workspace.resetOnboarding"
      >
        重置进度
      </button>
    </header>

    <div class="onboarding-progress-line">
      已完成 {{ workspace.onboardingCompletedCount }} / {{ onboardingModules.length }}
    </div>

    <div class="onboarding-module-grid">
      <button
        v-for="module in onboardingModules"
        :key="module.id"
        class="onboarding-module-card"
        :class="{ complete: workspace.onboardingCompleted[module.id] }"
        @click="workspace.startOnboardingTour(module.id)"
      >
        <span class="onboarding-module-icon">
          <component :is="module.icon" />
        </span>
        <span class="onboarding-module-copy">
          <strong>{{ module.title }}</strong>
          <small>{{ module.description }}</small>
        </span>
        <CheckCircle2
          v-if="workspace.onboardingCompleted[module.id]"
          class="complete-icon"
        />
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { CheckCircle2 } from 'lucide-vue-next'
import { onboardingModules } from '@/config/onboarding'
import { useWorkspaceStore } from '@/stores/workspace'

const workspace = useWorkspaceStore()
</script>
