<template>
  <div
    class="app-shell"
    :class="{
      'has-app-background': workspace.config.background.mode !== 'none',
      'watermark-enabled': workspace.config.watermark === 'open'
    }"
    :style="appBackgroundStyle"
  >
    <TopBar />
    <main
      class="app-body"
      :class="[
        `mode-${workspace.mode}`,
        `module-${workspace.activeModule}`,
        `surface-${workspace.activeCenterSurface}`,
        { 'has-left-pane': hasLeftPane, 'has-right-pane': hasRightPane }
      ]"
    >
      <SideRail />
      <div
        v-if="showAgentsLeftPane"
        class="layout-pane layout-pane-left agents-sidebar-pane"
        :style="{ width: `${displayAgentsLeftWidth}px` }"
        data-layout-pane="agents-left"
      >
        <AgentsSidebar @request-product-session="handleProductSessionRequest" />
      </div>
      <button
        v-if="showAgentsLeftPane"
        class="layout-resizer layout-resizer-left"
        :class="{ dragging: draggingSide === 'agents-left' }"
        data-layout-resizer="agents-left"
        title="调整会话侧栏宽度"
        aria-label="调整会话侧栏宽度"
        @mousedown="startResize('agents-left', $event)"
      ></button>
      <div
        v-if="showTerminalLeftPane"
        class="layout-pane layout-pane-left module-panel-pane"
        :style="{ width: `${displayLeftPanelWidth}px` }"
        data-onboarding-id="left-function-panel"
        data-layout-pane="terminal-left"
      >
        <ModulePanel />
      </div>
      <button
        v-if="showTerminalLeftPane"
        class="layout-resizer layout-resizer-left"
        :class="{ dragging: draggingSide === 'left' }"
        data-layout-resizer="terminal-left"
        title="调整左侧面板宽度"
        aria-label="调整左侧面板宽度"
        @mousedown="startResize('left', $event)"
      ></button>
      <FilesWorkspace v-if="workspace.mode === 'terminal' && workspace.activeCenterSurface === 'files'" />
      <AssetsWorkspace v-else-if="workspace.mode === 'terminal' && workspace.activeCenterSurface === 'assets'" />
      <ExtensionsWorkspace v-else-if="workspace.mode === 'terminal' && workspace.activeCenterSurface === 'extensions'" />
      <KubernetesWorkspace v-else-if="workspace.mode === 'terminal' && workspace.activeCenterSurface === 'kubernetes'" />
      <SettingsWorkspace v-else-if="workspace.mode === 'terminal' && workspace.activeCenterSurface === 'settings'" />
      <UserPanel v-else-if="workspace.mode === 'terminal' && workspace.activeCenterSurface === 'user'" />
      <KeepAlive>
        <DatabaseWorkspace
          v-if="workspace.mode === 'terminal' && workspace.activeCenterSurface === 'database'"
          :product-session-request="productSessionRequest"
          @product-session-request-consumed="handleProductSessionRequestConsumed"
        />
      </KeepAlive>
      <TerminalWorkspace v-show="showTerminalWorkspace" />
      <div
        v-if="workspace.mode === 'agents' || !['assets', 'database', 'user'].includes(workspace.activeCenterSurface)"
        v-show="showRightPane"
        class="layout-pane layout-pane-right ai-panel-pane"
        :style="{ width: `${displayRightPanelWidth}px` }"
        data-onboarding-id="right-ai-sidebar"
        :data-layout-pane="workspace.mode === 'agents' ? 'agents-right' : 'terminal-right'"
      >
        <button
          class="layout-resizer layout-resizer-right"
          :class="{ dragging: draggingSide === 'right' }"
          :data-layout-resizer="workspace.mode === 'agents' ? 'agents-right' : 'terminal-right'"
          title="调整 AI 侧栏宽度"
          aria-label="调整 AI 侧栏宽度"
          @mousedown="startResize('right', $event)"
        ></button>
        <RightAssistantPanel
          :agent-mode="workspace.mode === 'agents'"
          :product-session-request="productSessionRequest"
          @product-session-request-consumed="handleProductSessionRequestConsumed"
        />
      </div>
      <OnboardingSpotlight v-if="workspace.mode === 'terminal'" />
    </main>
    <RecentWorkspacePanels />
    <div
      v-if="terminalMfaDialog.open && terminalMfaDialog.request"
      class="terminal-mfa-backdrop"
      data-testid="terminal-mfa-dialog"
    >
      <section
        class="terminal-mfa-dialog"
        role="dialog"
        aria-modal="true"
        :aria-label="terminalAuthTitle"
      >
        <header>
          <div>
            <span>{{ terminalAuthRequired }}</span>
            <strong>{{ terminalAuthTitle }}</strong>
          </div>
          <button
            type="button"
            :title="t('common.close')"
            @click="cancelTerminalMfa"
          >
            <X />
          </button>
        </header>
        <p>
          {{ terminalAuthDescription }}
        </p>
        <form @submit.prevent="submitTerminalMfa">
          <label
            v-for="(prompt, index) in terminalMfaPrompts"
            :key="`${terminalMfaDialog.request.id}-${index}`"
          >
            <span>{{ prompt.prompt || terminalAuthPromptFallback }}</span>
            <input
              v-model="terminalMfaDialog.responses[index]"
              :ref="(element) => setTerminalMfaInputRef(element, index)"
              :type="prompt.echo ? 'text' : 'password'"
              autocomplete="one-time-code"
              :aria-label="prompt.prompt || terminalAuthPromptFallback"
              :disabled="terminalMfaDialog.submitting"
              data-testid="terminal-mfa-input"
            />
          </label>
          <label
            v-if="showTerminalPasswordRemember"
            class="terminal-mfa-remember"
          >
            <input
              v-model="terminalMfaDialog.rememberPassword"
              type="checkbox"
              :disabled="terminalMfaDialog.submitting"
              data-testid="terminal-password-remember"
            />
            <span>{{ t('terminal.passwordRemember') }}</span>
          </label>
          <p
            v-if="terminalMfaDialog.error"
            class="terminal-mfa-error"
            data-testid="terminal-mfa-error"
          >
            {{ terminalMfaDialog.error }}
          </p>
          <footer>
            <button
              type="button"
              :disabled="terminalMfaDialog.submitting"
              @click="cancelTerminalMfa"
            >
              {{ t('common.cancel') }}
            </button>
            <button
              type="submit"
              class="primary"
              :disabled="terminalMfaDialog.submitting"
              data-testid="terminal-mfa-submit"
            >
              {{ terminalMfaDialog.submitting ? t('terminal.mfaSubmitting') : t('terminal.mfaSubmit') }}
            </button>
          </footer>
        </form>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { X } from 'lucide-vue-next'
import TopBar from '@/components/TopBar.vue'
import SideRail from '@/components/SideRail.vue'
import ModulePanel from '@/components/ModulePanel.vue'
import TerminalWorkspace from '@/components/TerminalWorkspace.vue'
import FilesWorkspace from '@/components/FilesWorkspace.vue'
import AssetsWorkspace from '@/components/AssetsWorkspace.vue'
import ExtensionsWorkspace from '@/components/ExtensionsWorkspace.vue'
import KubernetesWorkspace from '@/components/KubernetesWorkspace.vue'
import SettingsWorkspace from '@/components/SettingsWorkspace.vue'
import RightAssistantPanel from '@/components/RightAssistantPanel.vue'
import AgentsSidebar from '@/components/AgentsSidebar.vue'
import DatabaseWorkspace from '@/components/DatabaseWorkspace.vue'
import UserPanel from '@/components/panels/UserPanel.vue'
import OnboardingSpotlight from '@/components/onboarding/OnboardingSpotlight.vue'
import RecentWorkspacePanels from '@/components/RecentWorkspacePanels.vue'
import type { ProductSessionUiRequest, ProductSessionUiRequestInput } from '@/components/productSessionUiTypes'
import { useAppShellRuntime } from '@/services/app/appShellRuntime'
import { isMainWorkspaceSurfaceVisible } from '@/config/navigation'
import { requestUiFocus } from '@/services/app/uiFocusCoordinator'

const {
  appBackgroundStyle,
  cancelTerminalMfa,
  displayAgentsLeftWidth,
  displayLeftPanelWidth,
  displayRightPanelWidth,
  draggingSide,
  hasLeftPane,
  hasRightPane,
  setTerminalMfaInputRef,
  showAgentsLeftPane,
  showTerminalLeftPane,
  showTerminalPasswordRemember,
  showRightPane,
  showTerminalWorkspace,
  startResize,
  submitTerminalMfa,
  terminalAuthDescription,
  terminalAuthPromptFallback,
  terminalAuthRequired,
  terminalAuthTitle,
  terminalMfaDialog,
  terminalMfaPrompts,
  t,
  workspace
} = useAppShellRuntime()

const productSessionRequest = ref<ProductSessionUiRequest | null>(null)
let productSessionRequestSequence = 0

const activeFocusScope = () => {
  if (workspace.mode === 'agents' || isMainWorkspaceSurfaceVisible(workspace.mode, workspace.activeCenterSurface)) {
    return 'workspace-terminal'
  }
  return workspace.activeModule
}

watch(
  () => `${workspace.mode}:${workspace.activeModule}:${workspace.activeCenterSurface}`,
  () => {
    requestUiFocus({
      scopeId: activeFocusScope(),
      policy: 'target-primary',
      cause: 'navigation'
    })
  },
  { immediate: true, flush: 'post' }
)

watch(
  () => workspace.panelFocusRequest?.sequence || 0,
  () => {
    const request = workspace.panelFocusRequest
    if (!request || request.panelId !== workspace.activePanelId) return
    requestUiFocus({
      scopeId: 'workspace-terminal',
      policy: 'target-primary',
      cause: request.cause
    })
  },
  { flush: 'post' }
)

const handleProductSessionRequest = async (request: ProductSessionUiRequestInput) => {
  if (request.surface === 'database') {
    workspace.setWorkspaceMode('terminal')
    workspace.setActiveModule('database')
  } else {
    workspace.setWorkspaceMode('agents')
  }
  await nextTick()
  const sessionRequest: ProductSessionUiRequest = {
    ...request,
    sequence: ++productSessionRequestSequence
  }
  productSessionRequest.value = sessionRequest
}

const handleProductSessionRequestConsumed = (sequence: number) => {
  if (productSessionRequest.value?.sequence === sequence) productSessionRequest.value = null
}
</script>
