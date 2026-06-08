<template>
  <section class="extensions-workspace">
    <template v-if="workspace.selectedExtension">
      <div
        v-if="workspace.selectedExtension.pluginId === 'Alias'"
        class="alias-config"
      >
        <div class="alias-config-container">
          <header class="alias-config-toolbar">
            <label class="alias-search-input">
              <input
                v-model="workspace.aliasSearchQuery"
                placeholder="模糊搜索"
              />
              <Search />
            </label>
            <button
              class="workspace-button primary"
              @click="workspace.createAliasCommand"
            >
              <Plus />
              添加命令
            </button>
            <span class="alias-config-hint">Enter 保存编辑，取消会恢复原值。</span>
          </header>

          <table class="alias-config-table">
            <thead>
              <tr>
                <th>Alias</th>
                <th>Command</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="record in workspace.filteredAliasCommands"
                :key="record.id"
              >
                <td>
                  <input
                    :value="record.alias"
                    :disabled="!record.edit"
                    :class="{ 'editable-input': record.edit }"
                    @input="workspace.updateAliasDraft(record.id, { alias: ($event.target as HTMLInputElement).value })"
                  />
                </td>
                <td>
                  <textarea
                    :value="record.command"
                    :disabled="!record.edit"
                    :class="{ 'editable-input': record.edit }"
                    spellcheck="false"
                    rows="1"
                    @input="workspace.updateAliasDraft(record.id, { command: ($event.target as HTMLTextAreaElement).value })"
                  ></textarea>
                </td>
                <td>
                  <div class="alias-row-actions">
                    <template v-if="record.edit">
                      <button
                        title="保存"
                        @click="workspace.saveAliasCommand(record.id)"
                      >
                        <Check />
                      </button>
                      <button
                        title="取消"
                        @click="workspace.cancelAliasEdit(record.id)"
                      >
                        <SquareX />
                      </button>
                    </template>
                    <template v-else>
                      <button
                        title="编辑"
                        @click="workspace.startAliasEdit(record.id)"
                      >
                        <Pencil />
                      </button>
                      <button
                        class="danger"
                        title="删除"
                        @click="workspace.deleteAliasCommand(record.id)"
                      >
                        <X />
                      </button>
                    </template>
                  </div>
                </td>
              </tr>
              <tr v-if="workspace.filteredAliasCommands.length === 0">
                <td colspan="3">暂无数据</td>
              </tr>
            </tbody>
          </table>
          <div
            v-if="workspace.extensionNotice"
            class="alias-config-notice"
          >
            {{ workspace.extensionNotice }}
          </div>
        </div>
      </div>

      <div
        v-else-if="workspace.selectedExtension.pluginId === 'jumpserverSupport'"
        class="plugin_detail_view"
      >
        <PluginHeader
          :name="workspace.selectedExtension.name"
          :description="workspace.selectedExtension.description"
          icon-key="jumpserver"
        />

        <div class="detail_body">
          <main class="main_content">
            <TabSwitch />
            <div
              v-if="workspace.extensionDetailTab === 'details'"
              class="markdown_readme_container"
            >
              <div class="rendered_markdown">
                <h2>{{ workspace.selectedExtension.name }}</h2>
                <p>{{ workspace.selectedExtension.detailSummary || workspace.selectedExtension.description }}</p>
                <h3>插件能力</h3>
                <ul
                  v-if="workspace.selectedExtension.functions?.length"
                  class="feature_bullets"
                >
                  <li
                    v-for="item in workspace.selectedExtension.functions"
                    :key="item.title"
                  >
                    <b>{{ item.title }}：</b>{{ item.desc }}
                  </li>
                </ul>
                <div
                  v-else
                  class="empty_readme"
                >
                  暂无功能说明
                </div>
                <h3>接入步骤</h3>
                <ul
                  v-if="workspace.selectedExtension.guideSteps?.length"
                  class="guide_list"
                >
                  <li
                    v-for="step in workspace.selectedExtension.guideSteps"
                    :key="step"
                  >
                    {{ step }}
                  </li>
                </ul>
                <div
                  v-else
                  class="empty_readme"
                >
                  暂无接入步骤
                </div>
                <h3>连接日志</h3>
                <div
                  v-if="workspace.selectedExtension.connectionLog?.length"
                  class="connection_log_terminal"
                >
                  <p
                    v-for="entry in workspace.selectedExtension.connectionLog"
                    :key="`${entry.time}-${entry.message}`"
                    :class="`connection_log_${entry.status}`"
                  >
                    <span>[{{ entry.time }}]</span>
                    <b>{{ connectionLogStatusMark(entry.status) }}</b>
                    {{ entry.message }}
                  </p>
                </div>
                <div
                  v-else
                  class="empty_readme"
                >
                  暂无连接日志
                </div>
              </div>
            </div>
            <FeatureList v-else />
          </main>
          <PluginSidebar
            identifier="jumpserver-support"
            version="N/A"
            last-updated="N/A"
            source="Preinstalled"
            size="N/A"
            :tags="workspace.selectedExtension.categories || ['SSH', 'Tools']"
          />
        </div>
      </div>

      <div
        v-else
        class="plugin_detail_view"
      >
        <PluginHeader
          :name="workspace.selectedExtension.name"
          :description="workspace.selectedExtension.description"
          :icon-key="workspace.selectedExtension.iconKey"
        >
          <template #actions>
            <button
              v-if="workspace.selectedExtension.isPlugin && !workspace.selectedExtension.installed && workspace.selectedExtension.installable !== false"
              class="op_btn primary"
              :class="{ download_progress_btn: downloadProgressVisible }"
              :style="downloadProgressButtonStyle"
              :disabled="isSelectedBusy"
              @click="workspace.installExtensionPlugin(workspace.selectedExtension.pluginId)"
            >
              {{ installButtonText }}
            </button>
            <button
              v-else-if="workspace.selectedExtension.isPlugin && !workspace.selectedExtension.installed"
              class="op_btn primary"
              :disabled="isSelectedBusy"
              @click="workspace.subscribeExtensionPlugin(workspace.selectedExtension.pluginId)"
            >
              订阅
            </button>
            <template v-else-if="workspace.selectedExtension.isPlugin">
              <button
                v-if="!workspace.selectedExtension.required"
                class="op_btn danger"
                :disabled="isSelectedBusy"
                @click="workspace.uninstallExtensionPlugin(workspace.selectedExtension.pluginId)"
              >
                卸载
              </button>
              <button
                v-if="workspace.selectedExtension.hasUpdate"
                class="op_btn"
                :class="{ download_progress_btn: downloadProgressVisible }"
                :style="downloadProgressButtonStyle"
                :disabled="isSelectedBusy"
                @click="workspace.updateExtensionPlugin(workspace.selectedExtension.pluginId)"
              >
                {{ updateButtonText }}
              </button>
            </template>
            <button
              v-if="isSelectedBusy"
              class="op_btn"
              @click="workspace.cancelExtensionInstall(workspace.selectedExtension.pluginId)"
            >
              取消
            </button>
          </template>
        </PluginHeader>

        <div class="detail_body">
          <main class="main_content">
            <TabSwitch />
            <div
              v-if="workspace.extensionDetailTab === 'details'"
              class="markdown_readme_container"
            >
              <div class="rendered_markdown">
                <p>{{ workspace.selectedExtension.readme || '暂无 README' }}</p>
              </div>
              <div
                v-if="workspace.selectedExtensionInstallProgress"
                class="plugin_install_progress"
              >
                <span>{{ progressStageText }}</span>
                <b>{{ workspace.selectedExtensionInstallProgress.percent }}%</b>
                <i :style="{ width: `${workspace.selectedExtensionInstallProgress.percent}%` }"></i>
              </div>
            </div>
            <FeatureList v-else />
          </main>
          <PluginSidebar
            :identifier="workspace.selectedExtension.pluginId"
            :version="workspace.selectedExtension.installedVersion || workspace.selectedExtension.latestVersion || '0.0.0'"
            :last-updated="workspace.selectedExtension.lastUpdated || 'N/A'"
            :source="sourceText(workspace.selectedExtension)"
            :size="formatSize(workspace.selectedExtension.size)"
            :tags="workspace.selectedExtension.categories || [workspace.selectedExtension.source || 'store', workspace.selectedExtension.installed ? 'installed' : 'available']"
          />
        </div>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, type Component, type PropType } from 'vue'
import {
  Check,
  Cloud,
  FileText,
  Layers,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  SquareX,
  WandSparkles,
  X
} from 'lucide-vue-next'
import { useWorkspaceStore } from '@/stores/workspace'
import type { ExtensionIconKey, ExtensionInstallStage, ExtensionPluginRuntimeConfig } from '@shared/preload'

type ExtensionPlugin = ExtensionPluginRuntimeConfig

const workspace = useWorkspaceStore()

const iconMap: Record<ExtensionIconKey, Component> = {
  jumpserver: Layers,
  alias: Pencil,
  runbook: FileText,
  cloud: Cloud,
  private: ShieldCheck,
  local: WandSparkles
}

const sourceText = (plugin: ExtensionPlugin) => {
  if (plugin.source === 'preinstalled') return 'Preinstalled'
  if (plugin.source === 'local') return 'Local'
  return 'Store'
}

const formatSize = (size?: number) => {
  if (!size) return '未知'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = size
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index++
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`
}

const connectionLogStatusMark = (status: 'progress' | 'success' | 'error') => {
  if (status === 'success') return '✓'
  if (status === 'error') return '!'
  return '●'
}

const installStageText = (stage?: ExtensionInstallStage) => {
  if (stage === 'downloading') return 'Downloading'
  if (stage === 'verifying') return 'Verifying'
  if (stage === 'installing') return 'Installing'
  if (stage === 'done') return 'Done'
  if (stage === 'cancelled') return 'Cancelled'
  if (stage === 'error') return 'Error'
  return ''
}

const isSelectedBusy = computed(() => {
  const id = workspace.selectedExtension?.pluginId
  return Boolean(id && (workspace.extensionInstallLoadingMap[id] || workspace.extensionUpdateLoadingMap[id]))
})

const selectedStageText = computed(() => installStageText(workspace.selectedExtensionInstallProgress?.stage))
const progressStageText = computed(() => selectedStageText.value || 'Installing')
const downloadProgressVisible = computed(() => workspace.selectedExtensionInstallProgress?.stage === 'downloading')
const downloadProgressButtonStyle = computed(() => ({ '--download-progress': `${workspace.selectedExtensionInstallProgress?.percent || 0}%` }))
const installButtonText = computed(() => {
  if (!isSelectedBusy.value) return '安装'
  return selectedStageText.value || 'Installing'
})
const updateButtonText = computed(() => {
  if (!isSelectedBusy.value) return '更新'
  return selectedStageText.value || 'Updating'
})

const PluginHeader = defineComponent({
  name: 'PluginHeader',
  props: {
    name: { type: String, required: true },
    description: { type: String, required: true },
    iconKey: { type: String as PropType<ExtensionIconKey>, required: true }
  },
  setup(props, { slots }) {
    return () =>
      h('header', { class: 'detail_header' }, [
        h('div', { class: 'header_content' }, [
          h('div', { class: 'title_group' }, [
            h('div', { class: ['plugin_icon_large', `icon-${props.iconKey}`] }, [h(iconMap[props.iconKey])]),
            h('div', { class: 'text_group' }, [
              h('h1', { class: 'plugin_name' }, props.name),
              h('p', { class: 'plugin_description' }, props.description),
              h('div', { class: 'action_buttons' }, slots.actions?.())
            ])
          ])
        ])
      ])
  }
})

const TabSwitch = defineComponent({
  name: 'TabSwitch',
  setup() {
    const store = useWorkspaceStore()
    return () =>
      h('div', { class: 'detail_tabs' }, [
        h(
          'button',
          {
            class: { active: store.extensionDetailTab === 'details' },
            onClick: () => {
              store.extensionDetailTab = 'details'
            }
          },
          '详情'
        ),
        h(
          'button',
          {
            class: { active: store.extensionDetailTab === 'features' },
            onClick: () => {
              store.extensionDetailTab = 'features'
            }
          },
          '插件功能'
        )
      ])
  }
})

const FeatureList = defineComponent({
  name: 'FeatureList',
  setup() {
    const store = useWorkspaceStore()
    const features = computed(() => store.selectedExtension?.functions || [])
    return () =>
      h(
        'div',
        { class: 'feature_list' },
        features.value.length
          ? features.value.map((item) =>
              h('div', { class: 'feature_item', key: item.title }, [h('strong', item.title), h('p', item.desc)])
            )
          : h('div', { class: 'empty_readme' }, '暂无功能说明')
      )
  }
})

const PluginSidebar = defineComponent({
  name: 'PluginSidebar',
  props: {
    identifier: { type: String, required: true },
    version: { type: String, required: true },
    lastUpdated: { type: String, required: true },
    source: { type: String, required: true },
    size: { type: String, required: true },
    tags: { type: Array as PropType<string[]>, required: true }
  },
  setup(props) {
    return () =>
      h('aside', { class: 'sidebar' }, [
        h('div', { class: 'sidebar_block installation_block' }, [
          h('h3', { class: 'sidebar_title' }, '安装'),
          h('dl', { class: 'metadata_descriptions' }, [
            h('dt', '插件标识'),
            h('dd', props.identifier),
            h('dt', '插件版本'),
            h('dd', props.version),
            h('dt', '最后更新'),
            h('dd', props.lastUpdated),
            h('dt', '插件来源'),
            h('dd', props.source),
            h('dt', '插件大小'),
            h('dd', props.size)
          ])
        ]),
        h('div', { class: 'sidebar_block categories_block' }, [
          h('h3', { class: 'sidebar_title' }, '插件分类'),
          h('div', { class: 'categories_tags' }, props.tags.map((tag) => h('span', { key: tag }, tag)))
        ])
      ])
  }
})
</script>
