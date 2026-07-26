<template>
  <section class="extension_contribution_section extension_runtime_section">
    <header class="extension_runtime_header">
      <div>
        <h3>插件运行时</h3>
        <p>
          状态: {{ plugin.runtimeStatus || 'inactive' }}
          <span v-if="plugin.runtimeError">, {{ plugin.runtimeError }}</span>
        </p>
      </div>
      <div class="extension_runtime_actions">
        <button
          v-if="plugin.enabled === false"
          class="op_btn primary"
          :disabled="runtimeBusy"
          @click="runRuntimeAction('enable')"
        >
          启用
        </button>
        <button
          v-else
          class="op_btn"
          :disabled="runtimeBusy || plugin.required"
          @click="runRuntimeAction('disable')"
        >
          禁用
        </button>
        <button
          class="op_btn"
          :disabled="runtimeBusy || plugin.enabled === false"
          @click="runRuntimeAction('reload')"
        >
          重新加载
        </button>
      </div>
    </header>

    <article
      v-for="welcome in visibleWelcome"
      :key="`${welcome.view}:${welcome.content}`"
      class="extension_runtime_welcome"
    >
      <p>{{ welcome.content }}</p>
    </article>

    <div
      v-if="runtimeCommands.length"
      class="extension_runtime_commands"
    >
      <button
        v-for="command in runtimeCommands"
        :key="command.id"
        class="op_btn"
        @click="executeCommand(command.id)"
      >
        {{ command.title }}
      </button>
    </div>

    <article
      v-for="view in plugin.views || []"
      :key="view.id"
      class="extension_runtime_view"
    >
      <header>
        <strong>{{ view.name }}</strong>
        <span>
          <button
            v-for="menu in visibleMenus('view/title', view.id)"
            :key="menu.command"
            class="op_btn"
            @click="executeCommand(menu.command)"
          >
            {{ commandTitle(menu.command) }}
          </button>
          <button
            class="op_btn"
            @click="loadChildren(view.id)"
          >
            刷新
          </button>
        </span>
      </header>
      <p v-if="viewErrors[view.id]">{{ viewErrors[view.id] }}</p>
      <ul class="extension_runtime_tree">
        <li
          v-for="entry in displayItems(view.id)"
          :key="entry.item.id"
          :style="{ paddingLeft: `${entry.depth * 18}px` }"
        >
          <button
            class="extension_runtime_tree_item"
            @click="activateTreeItem(view.id, entry.item)"
          >
            <span>{{ entry.item.label }}</span>
            <small>{{ entry.item.description }}</small>
          </button>
          <span class="extension_runtime_tree_actions">
            <button
              v-for="menu in visibleMenus('view/item/context', view.id, entry.item.contextValue)"
              :key="menu.command"
              class="op_btn"
              @click="executeCommand(menu.command, entry.item.id)"
            >
              {{ commandTitle(menu.command) }}
            </button>
          </span>
        </li>
      </ul>
    </article>

    <form
      v-if="plugin.configuration"
      class="extension_runtime_configuration"
      @submit.prevent="saveConfiguration"
    >
      <h3>{{ plugin.configuration.title }}</h3>
      <label
        v-for="field in plugin.configuration.properties"
        :key="field.key"
      >
        <span>{{ field.title }}</span>
        <small v-if="field.description">{{ field.description }}</small>
        <input
          v-if="field.type === 'text' || field.type === 'password'"
          :value="String(configurationValues[field.key] === true ? '' : configurationValues[field.key] || '')"
          :type="field.type === 'password' ? 'password' : 'text'"
          :placeholder="configurationPlaceholder(field)"
          @input="configurationValues[field.key] = ($event.target as HTMLInputElement).value"
        />
        <textarea
          v-else-if="field.type === 'textarea'"
          :value="String(configurationValues[field.key] || '')"
          rows="5"
          @input="configurationValues[field.key] = ($event.target as HTMLTextAreaElement).value"
        ></textarea>
        <input
          v-else-if="field.type === 'checkbox'"
          v-model="configurationValues[field.key]"
          type="checkbox"
        />
        <select
          v-else
          :value="String(configurationValues[field.key] || '')"
          @change="configurationValues[field.key] = ($event.target as HTMLSelectElement).value"
        >
          <option
            v-for="option in field.options || []"
            :key="option.value"
            :value="option.value"
          >
            {{ option.label }}
          </option>
        </select>
      </label>
      <button
        class="op_btn primary"
        :disabled="configurationBusy"
        type="submit"
      >
        保存配置
      </button>
    </form>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { extensionsClient } from '@/services/extensions/extensionsClient'
import type {
  ExtensionConfigurationField,
  ExtensionConfigurationValue,
  ExtensionMenuContribution,
  ExtensionPluginRuntimeConfig,
  ExtensionRuntimeAction,
  ExtensionTreeItem
} from '@shared/contracts/extensions'

const props = defineProps<{ plugin: ExtensionPluginRuntimeConfig }>()
const emit = defineEmits<{
  notice: [message: string]
  runTerminalText: [command: string]
  refreshPlugins: []
}>()

const runtimeBusy = ref(false)
const configurationBusy = ref(false)
const contexts = ref<Record<string, boolean | string | number>>({})
const treeItems = reactive<Record<string, ExtensionTreeItem[]>>({})
const childTreeItems = reactive<Record<string, ExtensionTreeItem[]>>({})
const expandedTreeItems = reactive<Record<string, boolean>>({})
const viewErrors = reactive<Record<string, string>>({})
const configurationValues = reactive<Record<string, ExtensionConfigurationValue>>({})
let stopRuntimeEvents: (() => void) | undefined

const commandTitle = (commandId: string) =>
  props.plugin.commands?.find((command) => command.id === commandId)?.title || commandId

const configurationPlaceholder = (field: ExtensionConfigurationField) =>
  field.type === 'password' && configurationValues[field.key] === true ? '已保存，留空保持不变' : ''

const evaluateWhen = (expression: string | undefined, viewId?: string, contextValue?: string) => {
  const value = String(expression || '').trim()
  if (!value) return true
  return value.split(/\s*\|\|\s*/).some((alternative) =>
    alternative.split(/\s*&&\s*/).every((term) => {
      const normalized = term.trim()
      const negated = normalized.startsWith('!')
      const body = negated ? normalized.slice(1).trim() : normalized
      const equality = body.match(/^([a-zA-Z0-9._-]+)\s*(==|!=)\s*([a-zA-Z0-9._-]+)$/)
      let result: boolean
      if (equality) {
        const actual = equality[1] === 'view' ? viewId : equality[1] === 'viewItem' ? contextValue : contexts.value[equality[1]]
        result = String(actual ?? '') === equality[3]
        if (equality[2] === '!=') result = !result
      } else {
        result = Boolean(contexts.value[body])
      }
      return negated ? !result : result
    })
  )
}

const visibleWelcome = computed(() =>
  (props.plugin.viewsWelcome || []).filter((welcome) => evaluateWhen(welcome.when, welcome.view))
)

const runtimeCommands = computed(() => (props.plugin.commands || []).filter((command) => !command.command))

const visibleMenus = (location: string, viewId: string, contextValue?: string): ExtensionMenuContribution[] =>
  (props.plugin.menus?.[location] || []).filter((menu) => evaluateWhen(menu.when, viewId, contextValue))

const executeCommand = async (commandId: string, ...args: unknown[]) => {
  const bridge = extensionsClient.executeExtensionCommand()
  if (!bridge) return
  try {
    const result = await bridge({ commandId, args })
    if (!result.ok) {
      emit('notice', result.errorMessage || '插件命令执行失败')
      return
    }
    const value = result.data?.value
    if (value && typeof value === 'object' && 'terminalText' in value) {
      emit('runTerminalText', String((value as { terminalText: unknown }).terminalText || ''))
    }
    if (value && typeof value === 'object' && 'message' in value) {
      emit('notice', String((value as { message: unknown }).message || ''))
    }
  } catch (error) {
    emit('notice', error instanceof Error ? error.message : '插件命令执行失败')
  }
}

const loadChildren = async (viewId: string, parentId?: string) => {
  const bridge = extensionsClient.listExtensionTreeChildren()
  if (!bridge) return
  const result = await bridge({ viewId, parentId })
  if (!result.ok || !result.data) {
    viewErrors[viewId] = result.errorMessage || '插件视图加载失败'
    return
  }
  if (parentId) childTreeItems[`${viewId}:${parentId}`] = result.data.items
  else treeItems[viewId] = result.data.items
  viewErrors[viewId] = ''
}

const displayItems = (viewId: string) => {
  const flattened: Array<{ item: ExtensionTreeItem; depth: number }> = []
  const append = (items: ExtensionTreeItem[], depth: number) => {
    for (const item of items) {
      flattened.push({ item, depth })
      if (expandedTreeItems[`${viewId}:${item.id}`]) append(childTreeItems[`${viewId}:${item.id}`] || [], depth + 1)
    }
  }
  append(treeItems[viewId] || [], 0)
  return flattened
}

const activateTreeItem = async (viewId: string, item: ExtensionTreeItem) => {
  if (item.command) {
    await executeCommand(item.command, ...(item.commandArgs || []))
    return
  }
  if (item.collapsibleState && item.collapsibleState !== 'none') {
    const key = `${viewId}:${item.id}`
    expandedTreeItems[key] = !expandedTreeItems[key]
    if (expandedTreeItems[key] && !childTreeItems[key]) await loadChildren(viewId, item.id)
  }
}

const loadContexts = async () => {
  const bridge = extensionsClient.listExtensionContexts()
  const result = await bridge?.()
  if (result?.ok && result.data) contexts.value = result.data
}

const loadConfiguration = async () => {
  const bridge = extensionsClient.getExtensionConfiguration()
  const result = await bridge?.(props.plugin.pluginId)
  if (!result?.ok || !result.data) return
  for (const [key, value] of Object.entries(result.data)) configurationValues[key] = value
}

const saveConfiguration = async () => {
  const bridge = extensionsClient.saveExtensionConfiguration()
  if (!bridge || configurationBusy.value) return
  const values: Record<string, ExtensionConfigurationValue> = {}
  for (const field of props.plugin.configuration?.properties || []) {
    const value = configurationValues[field.key]
    if (field.type === 'password' && value === true) continue
    values[field.key] = value ?? ''
  }
  configurationBusy.value = true
  try {
    const result = await bridge({ pluginId: props.plugin.pluginId, values })
    emit('notice', result.ok ? '插件配置已保存，重新加载插件后生效' : result.errorMessage || '插件配置保存失败')
    if (result.ok) await runRuntimeAction('reload')
  } finally {
    configurationBusy.value = false
  }
}

const runRuntimeAction = async (action: ExtensionRuntimeAction) => {
  const bridge = extensionsClient.runExtensionRuntimeAction()
  if (!bridge || runtimeBusy.value) return
  runtimeBusy.value = true
  try {
    const result = await bridge({ pluginId: props.plugin.pluginId, action })
    emit('notice', result.ok ? result.data?.message || '插件运行状态已更新' : result.errorMessage || '插件运行操作失败')
    emit('refreshPlugins')
  } finally {
    runtimeBusy.value = false
  }
}

const initialize = async () => {
  await Promise.all([loadContexts(), loadConfiguration(), ...(props.plugin.views || []).map((view) => loadChildren(view.id))])
}

watch(() => props.plugin.pluginId, initialize)

onMounted(() => {
  void initialize()
  stopRuntimeEvents = extensionsClient.onExtensionRuntimeEvent()?.((event) => {
    if (event.type === 'view-refresh' && event.pluginId === props.plugin.pluginId) void loadChildren(event.viewId)
    if (event.type === 'context-changed') void loadContexts()
    if (event.type === 'message' && event.pluginId === props.plugin.pluginId) emit('notice', event.message)
    if (event.type === 'provider-progress' && event.pluginId === props.plugin.pluginId) {
      emit('notice', event.message ? `${event.percent}% ${event.message}` : `资产导入进度 ${event.percent}%`)
    }
    if (event.type === 'runtime-changed' && event.pluginId === props.plugin.pluginId) emit('refreshPlugins')
  })
})

onBeforeUnmount(() => stopRuntimeEvents?.())
</script>
