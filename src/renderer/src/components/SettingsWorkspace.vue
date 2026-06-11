<template>
  <section
    class="settings-workspace"
    :style="workspace.config.background.mode !== 'none' ? workspaceBackgroundStyle : undefined"
  >
    <header class="settings-workspace-title">
      <h2>设置</h2>
      <button
        class="settings-tab-close"
        title="关闭"
        @click="workspace.setActiveModule('workspace')"
      >
        <X />
      </button>
    </header>

    <main class="settings-workspace-body">
      <SettingsPanel />

      <div class="settings-content-scroll">
        <section
          v-if="workspace.onboardingGuideOpen"
          class="settings-content-page"
        >
          <OnboardingGuide />
        </section>

        <section
          v-else-if="workspace.keywordHighlightEditorOpen"
          class="settings-content-page keyword-highlight-page"
        >
          <KeywordHighlightEditorPage />
        </section>

        <section
          v-else-if="workspace.securityConfigEditorOpen"
          class="settings-content-page security-config-page"
        >
          <SecurityConfigEditorPage />
        </section>

        <section
          v-else-if="workspace.mcpConfigEditorOpen"
          class="settings-content-page mcp-config-page"
        >
          <McpConfigEditorPage />
        </section>

        <section
          v-else-if="workspace.activeSettingsSection === 'general'"
          class="settings-content-page"
          data-onboarding-id="settings-general-content"
        >
          <GeneralSettings />
        </section>

        <section
          v-else-if="workspace.activeSettingsSection === 'terminal'"
          class="settings-content-page"
          data-onboarding-id="settings-terminal-options"
        >
          <TerminalSettings />
        </section>

        <section
          v-else-if="workspace.activeSettingsSection === 'models'"
          class="settings-content-page"
        >
          <ModelSettings />
        </section>

        <section
          v-else-if="workspace.activeSettingsSection === 'ai'"
          class="settings-content-page"
          data-onboarding-id="settings-ai-preferences-content"
        >
          <AiPreferenceSettings />
        </section>

        <section
          v-else-if="workspace.activeSettingsSection === 'extensions'"
          class="settings-content-page"
        >
          <ExtensionSettingsPage />
        </section>

        <section
          v-else-if="workspace.activeSettingsSection === 'billing'"
          class="settings-content-page"
        >
          <BillingSettingsPage />
        </section>

        <section
          v-else-if="workspace.activeSettingsSection === 'mcp'"
          class="settings-content-page"
        >
          <McpSettingsPage />
        </section>

        <section
          v-else-if="workspace.activeSettingsSection === 'skills'"
          class="settings-content-page"
        >
          <SkillsSettingsPage />
        </section>

        <section
          v-else-if="workspace.activeSettingsSection === 'rules'"
          class="settings-content-page"
        >
          <RulesSettingsPage />
        </section>

        <section
          v-else-if="workspace.activeSettingsSection === 'shortcuts'"
          class="settings-content-page"
        >
          <ShortcutsSettingsPage />
        </section>

        <section
          v-else-if="workspace.activeSettingsSection === 'trustedDevices'"
          class="settings-content-page"
        >
          <TrustedDevicesSettingsPage />
        </section>

        <section
          v-else-if="workspace.activeSettingsSection === 'privacy'"
          class="settings-content-page"
        >
          <PrivacySettingsPage />
        </section>

        <section
          v-else-if="workspace.activeSettingsSection === 'about'"
          class="settings-content-page"
        >
          <AboutSettingsPage />
        </section>

        <section
          v-else
          class="settings-content-page"
        >
          <GeneralSettings />
        </section>
      </div>
    </main>

    <div
      v-if="workspace.settingsNotice"
      class="settings-toast"
    >
      {{ workspace.settingsNotice }}
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, defineComponent, h } from 'vue'
import { BookOpen, Brain, ExternalLink, FolderOpen, LockKeyhole, MessageSquare, Monitor, Play, Trash2, Upload, X } from 'lucide-vue-next'
import {
  settingsBackgroundPresets,
  settingsLanguageOptions,
  settingsNavItems,
  settingsSecretPatterns,
  settingsThemeOptions
} from '@/config/settings'
import { useWorkspaceStore } from '@/stores/workspace'
import SettingsPanel from '@/components/panels/SettingsPanel.vue'
import SettingsJsonEditor from '@/components/settings/SettingsJsonEditor.vue'
import OnboardingGuide from '@/components/onboarding/OnboardingGuide.vue'

const workspace = useWorkspaceStore()

const terminalTypes = ['xterm', 'xterm-256color', 'vt100', 'vt102', 'vt220', 'vt320', 'linux', 'scoansi', 'ansi']
const terminalFonts = [
  { value: 'Menlo, Monaco, "Courier New", Consolas, Courier, monospace', label: 'Menlo' },
  { value: 'Monaco, "Courier New", Consolas, Courier, monospace', label: 'Monaco' },
  { value: '"MesloLGS NF", "Courier New", Courier, monospace', label: 'Meslo Nerd Font' },
  { value: 'Consolas, "Courier New", Courier, monospace', label: 'Consolas' },
  { value: '"JetBrains Mono", "Courier New", Courier, monospace', label: 'JetBrains Mono' },
  { value: '"Source Code Pro", "Courier New", Courier, monospace', label: 'Source Code Pro' }
]
const cursorStyles = [
  { value: 'block' as const, label: '块状光标' },
  { value: 'bar' as const, label: '竖线光标' },
  { value: 'underline' as const, label: '下划线光标' }
]
type SettingsModelProviderKey = 'litellm' | 'openai' | 'bedrock' | 'deepseek' | 'anthropic' | 'ollama'
const modelProviderCards: Array<{ provider: SettingsModelProviderKey; title: string }> = [
  { provider: 'litellm', title: 'LiteLLM' },
  { provider: 'openai', title: 'OpenAI Compatible & Responses' },
  { provider: 'bedrock', title: 'Amazon Bedrock' },
  { provider: 'deepseek', title: 'DeepSeek' },
  { provider: 'anthropic', title: 'Anthropic' },
  { provider: 'ollama', title: 'Ollama' }
]
const awsRegionOptions = [
  'us-east-1',
  'us-east-2',
  'us-west-2',
  'ap-south-1',
  'ap-northeast-1',
  'ap-northeast-2',
  'ap-northeast-3',
  'ap-southeast-1',
  'ap-southeast-2',
  'ca-central-1',
  'eu-central-1',
  'eu-central-2',
  'eu-west-1',
  'eu-west-2',
  'eu-west-3',
  'eu-north-1',
  'sa-east-1',
  'us-gov-east-1',
  'us-gov-west-1'
]

const mcpToolArgumentsPlaceholder = (parameters: Array<{ name: string; required?: boolean }>) => {
  const sample = Object.fromEntries(parameters.filter((parameter) => parameter.required).map((parameter) => [parameter.name, '']))
  return JSON.stringify(sample, null, 2)
}

const renderMcpOperationResult = (record: (typeof workspace.mcpOperationResults)[string] | undefined) => {
  if (!record) return null
  return h('div', { class: ['mcp-operation-result', record.status] }, [
    h('div', { class: 'mcp-operation-result-header' }, [
      h('strong', record.status === 'running' ? 'Running' : record.status === 'success' ? 'Result' : 'Error'),
      record.durationMs !== undefined ? h('span', `${Math.round(record.durationMs)} ms`) : null
    ]),
    record.status === 'running' ? h('pre', 'Waiting for MCP response...') : h('pre', record.error || record.output || '[]')
  ])
}

type PersistResult = void | boolean | Promise<void | boolean>

const restoreCheckboxOnFailedSave = async (event: Event, checked: boolean, onChange: (checked: boolean) => PersistResult) => {
  const input = event.target as HTMLInputElement
  const saved = await onChange(input.checked)
  if (saved === false) input.checked = checked
}

const restoreInputOnFailedSave = async (event: Event, value: string | number, onChange: (value: string) => PersistResult) => {
  const input = event.target as HTMLInputElement
  const nextValue = input.value
  const saved = await onChange(nextValue)
  if (saved === false) input.value = String(value)
}

const restoreSelectOnFailedSave = async (event: Event, value: string, onChange: (value: string) => PersistResult) => {
  const select = event.target as HTMLSelectElement
  const saved = await onChange(select.value)
  if (saved === false) select.value = value
}
const themeGroups = computed(() => ({
  system: settingsThemeOptions.filter((item) => item.group === 'system'),
  default: settingsThemeOptions.filter((item) => item.group === 'default'),
  official: settingsThemeOptions.filter((item) => item.group === 'official')
}))

const customBackgroundImage = computed(() =>
  workspace.config.background.lastCustomImage || (workspace.config.background.mode === 'custom' ? workspace.config.background.image : '')
)

const hasSelectedBackgroundImage = computed(() => Boolean(workspace.config.background.image && workspace.config.background.mode !== 'none'))

const backgroundImageCss = (image: string) => {
  if (!image) return 'none'
  if (/^(?:file|https?|data|blob):/i.test(image)) return `url("${image.replace(/"/g, '\\"')}")`
  return `url("${image.replace(/"/g, '\\"')}")`
}

const workspaceBackgroundStyle = computed(() => {
  const preset = settingsBackgroundPresets.find((item) => item.id === workspace.config.background.image)
  const background = workspace.config.background.mode === 'custom' ? backgroundImageCss(workspace.config.background.image) : preset?.css || 'none'
  return {
    '--settings-bg-image': background,
    '--settings-bg-opacity': `${workspace.config.background.opacity}`,
    '--settings-bg-brightness': `${workspace.config.background.brightness}`
  }
})

const GeneralSettings = defineComponent({
  name: 'GeneralSettings',
  setup() {
    return () =>
      h('div', [
        h('h3', '基础设置'),
        h('div', { class: 'settings-form-card' }, [
          h('div', { class: 'settings-form-row' }, [
            h('label', '主题'),
            h(
              'select',
              {
                class: 'settings-select theme-select',
                value: workspace.config.theme,
                onChange: (event: Event) => restoreSelectOnFailedSave(event, workspace.config.theme, (value) => workspace.selectTheme(value))
              },
              [
                h('optgroup', { label: '系统' }, themeGroups.value.system.map((option) => h('option', { value: option.value }, option.label))),
                h('optgroup', { label: '默认' }, themeGroups.value.default.map((option) => h('option', { value: option.value }, option.label))),
                h('optgroup', { label: '官方主题' }, themeGroups.value.official.map((option) => h('option', { value: option.value }, option.label)))
              ]
            )
          ]),
          h('div', { class: 'settings-form-row align-start', 'data-onboarding-id': 'settings-background-section' }, [
            h('label', '背景'),
            h('div', { class: 'settings-backgrounds' }, [
              h('div', { class: 'settings-bg-grid' }, [
                h(
                  'button',
                  {
                    class: ['settings-bg-tile default', { active: workspace.config.background.mode === 'none' }],
                    onClick: () => workspace.selectBackground('none')
                  },
                  [h(Monitor), h('span', '默认背景')]
                ),
                ...settingsBackgroundPresets.map((preset) =>
                  h('button', {
                    key: preset.id,
                    class: ['settings-bg-tile preset', { active: workspace.config.background.image === preset.id }],
                    style: { background: preset.css },
                    title: preset.label,
                    'data-onboarding-id': preset.id === settingsBackgroundPresets[0]?.id ? 'settings-background-preset' : undefined,
                    onClick: () => workspace.selectBackground('preset', preset.id)
                  })
                )
              ]),
              h('div', { class: 'settings-upload-section' }, [
                h('span', '自定义上传（支持JPG、PNG、WebP、GIF）'),
                h('div', { class: 'settings-bg-grid compact' }, [
                  customBackgroundImage.value
                    ? h(
                        'button',
                        {
                          class: ['settings-bg-tile preset custom-preview', { active: workspace.config.background.mode === 'custom' }],
                          style: { backgroundImage: backgroundImageCss(customBackgroundImage.value) },
                          title: '自定义背景',
                          onClick: () => workspace.selectCustomBackground()
                        },
                        [
                          h(
                            'span',
                            {
                              class: 'settings-bg-delete',
                              title: '删除自定义背景',
                              onClick: (event: MouseEvent) => {
                                event.stopPropagation()
                                workspace.clearCustomBackground()
                              }
                            },
                            [h(Trash2)]
                          )
                        ]
                      )
                    : null,
                  h(
                    'button',
                    {
                      class: 'settings-bg-tile upload',
                      title: '上传',
                      onClick: () => workspace.uploadCustomBackground()
                    },
                    [h(Upload)]
                  )
                ])
              ]),
              hasSelectedBackgroundImage.value
                ? h('div', { class: 'settings-sliders' }, [
                    h('label', [
                      h('span', '透明度'),
                      h('input', {
                        value: workspace.config.background.opacity,
                        min: 0,
                        max: 1,
                        step: 0.05,
                        type: 'range',
                        onChange: (event: Event) =>
                          restoreInputOnFailedSave(event, workspace.config.background.opacity, (value) =>
                            workspace.updateBackgroundTuning({ opacity: Number(value) })
                          )
                      })
                    ]),
                    h('label', [
                      h('span', '亮度'),
                      h('input', {
                        value: workspace.config.background.brightness,
                        min: 0,
                        max: 1,
                        step: 0.05,
                        type: 'range',
                        onChange: (event: Event) =>
                          restoreInputOnFailedSave(event, workspace.config.background.brightness, (value) =>
                            workspace.updateBackgroundTuning({ brightness: Number(value) })
                          )
                      })
                    ])
                  ])
                : null
            ])
          ]),
          radioRow('默认布局', 'defaultLayout', [
            { label: 'Terminal', checked: workspace.config.defaultMode === 'terminal', onChange: () => workspace.updateDefaultLayout('terminal') },
            { label: 'Agents', checked: workspace.config.defaultMode === 'agents', onChange: () => workspace.updateDefaultLayout('agents') }
          ]),
          h('div', { class: 'settings-form-row' }, [
            h('label', '语言'),
            h(
              'select',
              {
                class: 'settings-select',
                value: workspace.config.language,
                onChange: (event: Event) => restoreSelectOnFailedSave(event, workspace.config.language, (value) => workspace.updateLanguage(value))
              },
              settingsLanguageOptions.map((language) => h('option', { value: language.value }, language.label))
            )
          ]),
          radioRow('水印', 'watermark', [
            { label: '开启', checked: workspace.config.watermark === 'open', onChange: () => workspace.updateWatermark('open') },
            { label: '关闭', checked: workspace.config.watermark === 'close', onChange: () => workspace.updateWatermark('close') }
          ]),
          h('div', { class: 'settings-form-row' }, [
            h('label', '入门引导'),
            h(
              'button',
              {
                class: 'settings-button primary',
                onClick: () => workspace.openOnboardingGuide()
              },
              '打开入门引导'
            )
          ])
        ]),
        h('h3', '编辑器设置'),
        h('div', { class: 'settings-form-card' }, [
          numberRow('字体大小', workspace.editorSettings.fontSize, 8, 32, (value) => workspace.updateEditorSettings({ fontSize: value })),
          numberRow('行高', workspace.editorSettings.lineHeight, 0, 48, (value) => workspace.updateEditorSettings({ lineHeight: value })),
          h('div', { class: 'settings-form-row' }, [
            h('label', '字体'),
            h(
              'select',
              {
                class: 'settings-select',
                value: workspace.editorSettings.fontFamily,
                onChange: (event: Event) =>
                  restoreSelectOnFailedSave(event, workspace.editorSettings.fontFamily, (value) => workspace.updateEditorSettings({ fontFamily: value }))
              },
              [h('option', { value: 'cascadia-mono' }, 'Cascadia Mono'), h('option', { value: 'jetbrains-mono' }, 'JetBrains Mono'), h('option', { value: 'source-code-pro' }, 'Source Code Pro')]
            )
          ]),
          numberRow('Tab Size(空格)', workspace.editorSettings.tabSize, 1, 8, (value) => workspace.updateEditorSettings({ tabSize: value })),
          radioRow('自动换行', 'wordWrap', [
            { label: '开启', checked: workspace.editorSettings.wordWrap === 'on', onChange: () => workspace.updateEditorSettings({ wordWrap: 'on' }) },
            { label: '关闭', checked: workspace.editorSettings.wordWrap === 'off', onChange: () => workspace.updateEditorSettings({ wordWrap: 'off' }) }
          ]),
          radioRow('Minimap', 'minimap', [
            { label: '开启', checked: workspace.editorSettings.minimap, onChange: () => workspace.updateEditorSettings({ minimap: true }) },
            { label: '关闭', checked: !workspace.editorSettings.minimap, onChange: () => workspace.updateEditorSettings({ minimap: false }) }
          ]),
          radioRow('Mouse Wheel Zoom', 'mouseWheelZoom', [
            { label: '开启', checked: workspace.editorSettings.mouseWheelZoom, onChange: () => workspace.updateEditorSettings({ mouseWheelZoom: true }) },
            { label: '关闭', checked: !workspace.editorSettings.mouseWheelZoom, onChange: () => workspace.updateEditorSettings({ mouseWheelZoom: false }) }
          ])
        ])
      ])
  }
})

const TerminalSettings = defineComponent({
  name: 'TerminalSettings',
  setup() {
    return () =>
      h('div', [
        h('h3', '终端设置'),
        h('div', { class: 'settings-form-card' }, [
          selectRow('终端类型', workspace.terminalSettings.terminalType, terminalTypes.map((item) => ({ value: item, label: item })), (value) => workspace.updateTerminalSettings({ terminalType: value })),
          selectRow('字体', workspace.terminalSettings.fontFamily, terminalFonts, (value) => workspace.updateTerminalSettings({ fontFamily: value })),
          numberRow('字体大小', workspace.terminalSettings.fontSize, 8, 64, (value) => workspace.updateTerminalSettings({ fontSize: value })),
          numberRow('ScrollBack', workspace.terminalSettings.scrollBack, 1, undefined, (value) => workspace.updateTerminalSettings({ scrollBack: value })),
          h('div', { class: 'settings-form-row' }, [
            h('label', '光标样式'),
            h(
              'div',
              { class: 'cursor-style-group' },
              cursorStyles.map((cursor) =>
                h(
                  'button',
                  {
                    class: ['cursor-style-button', { active: workspace.terminalSettings.cursorStyle === cursor.value }],
                    title: cursor.label,
                    onClick: () => workspace.updateTerminalSettings({ cursorStyle: cursor.value })
                  },
                  [h('span', { class: `cursor-preview ${cursor.value}` })]
                )
              )
            )
          ]),
          switchRow('光标闪烁', workspace.terminalSettings.cursorBlink, (checked) => workspace.updateTerminalSettings({ cursorBlink: checked })),
          numberRow('行高', workspace.terminalSettings.lineHeight, 1, 3, (value) => workspace.updateTerminalSettings({ lineHeight: value }), 0.1),
          switchRow('Pinch Zoom', workspace.terminalSettings.pinchZoomStatus, (checked) => workspace.updateTerminalSettings({ pinchZoomStatus: checked })),
          switchRow('显示关闭按钮', workspace.terminalSettings.showCloseButton, (checked) => workspace.updateTerminalSettings({ showCloseButton: checked })),
          switchRow('SSH Agents', workspace.terminalSettings.sshAgentsStatus, (checked) => workspace.updateTerminalSettings({ sshAgentsStatus: checked })),
          workspace.terminalSettings.sshAgentsStatus
            ? h('div', { class: 'settings-form-row' }, [
                h('label', 'SSH Agent 设置'),
                h('button', { class: 'settings-button', onClick: () => workspace.openSshAgentConfig() }, '设置')
              ])
            : null,
          h('div', { class: 'settings-form-row' }, [
            h('label', '代理设置'),
            h('button', { class: 'settings-button', onClick: () => workspace.openSshProxyConfig() }, '设置')
          ]),
          h('div', { class: 'settings-form-row align-start' }, [
            h('label', '鼠标事件'),
            h('div', { class: 'mouse-event-settings' }, [
              h('label', [
                h('span', '中键:'),
                h(
                  'select',
                  {
                    class: 'settings-select small',
                    value: workspace.terminalSettings.middleMouseEvent,
                    onChange: (event: Event) =>
                      restoreSelectOnFailedSave(event, workspace.terminalSettings.middleMouseEvent, (value) =>
                        workspace.updateTerminalSettings({ middleMouseEvent: value as any })
                      )
                  },
                  [
                    h('option', { value: 'none' }, '无'),
                    h('option', { value: 'paste' }, '粘贴剪贴板'),
                    h('option', { value: 'contextMenu' }, '显示右键菜单'),
                    h('option', { value: 'closeTab' }, '关闭当前标签')
                  ]
                )
              ]),
              h('label', [
                h('span', '右键:'),
                h(
                  'select',
                  {
                    class: 'settings-select small',
                    value: workspace.terminalSettings.rightMouseEvent,
                    onChange: (event: Event) =>
                      restoreSelectOnFailedSave(event, workspace.terminalSettings.rightMouseEvent, (value) =>
                        workspace.updateTerminalSettings({ rightMouseEvent: value as any })
                      )
                  },
                  [h('option', { value: 'none' }, '无'), h('option', { value: 'paste' }, '粘贴剪贴板'), h('option', { value: 'contextMenu' }, '显示右键菜单')]
                )
              ])
            ])
          ])
        ]),
        workspace.sshAgentConfigModalOpen
          ? h('div', { class: 'settings-modal agent-config-modal' }, [
              h('div', { class: 'settings-modal-card agent-config-card' }, [
                h('header', [h('h3', 'SSH Agent 设置'), h('button', { title: '关闭', onClick: () => workspace.closeSshAgentConfig() }, '×')]),
                workspace.sshAgentKeys.length
                  ? h('div', { class: 'settings-table agent-config-table' }, [
                      h('div', { class: 'settings-table-row head' }, [
                        h('span', '指纹'),
                        h('span', '备注'),
                        h('span', '类型'),
                        h('span', '操作')
                      ]),
                      ...workspace.sshAgentKeys.map((key) =>
                        h('div', { class: 'settings-table-row', key: key.id }, [
                          h('span', key.fingerprint),
                          h('span', key.comment),
                          h('span', key.keyType),
                          h('span', [
                            h(
                              'button',
                              {
                                class: 'settings-link-button danger',
                                onClick: () => workspace.removeSshAgentKey(key.id)
                              },
                              '删除'
                            )
                          ])
                        ])
                      )
                    ])
                  : h('div', { class: 'settings-empty-state' }, '暂无密钥添加'),
                h('div', { class: 'agent-key-form' }, [
                  h('label', [
                    h('span', '密钥'),
                    h(
                      'select',
                      {
                        class: 'settings-select',
                        value: workspace.sshAgentSelectedKey,
                        onChange: (event: Event) => workspace.setSshAgentSelectedKey((event.target as HTMLSelectElement).value)
                      },
                      [
                        h('option', { value: '' }, '请选择密钥'),
                        ...workspace.sshAgentKeyChainOptions.map((option) =>
                          h(
                            'option',
                            {
                              value: option.key,
                              disabled: workspace.sshAgentKeys.some((key) => key.keyChainId === option.key)
                            },
                            option.label
                          )
                        )
                      ]
                    )
                  ]),
                  h('button', { class: 'settings-button primary', onClick: () => workspace.addSshAgentKey() }, '添加')
                ]),
                h('footer', [h('button', { class: 'settings-button', onClick: () => workspace.closeSshAgentConfig() }, '关闭')])
              ])
            ])
          : null,
        workspace.sshProxyConfigModalOpen
          ? h('div', { class: 'settings-modal proxy-config-modal' }, [
              h('div', { class: 'settings-modal-card proxy-config-card' }, [
                h('header', [h('h3', '代理设置'), h('button', { title: '关闭', onClick: () => workspace.closeSshProxyConfig() }, '×')]),
                workspace.sshProxyConfigs.length
                  ? h('div', { class: 'settings-table proxy-config-table' }, [
                      h('div', { class: 'settings-table-row head' }, [
                        h('span', '代理名称'),
                        h('span', '代理类型'),
                        h('span', '代理主机'),
                        h('span', '代理端口'),
                        h('span', '代理用户名'),
                        h('span', '操作')
                      ]),
                      ...workspace.sshProxyConfigs.map((config) =>
                        h('div', { class: 'settings-table-row', key: config.name }, [
                          h('span', config.name),
                          h('span', config.type),
                          h('span', config.host),
                          h('span', String(config.port)),
                          h('span', config.enableProxyIdentity ? config.username || '-' : '-'),
                          h('span', [
                            h(
                              'button',
                              {
                                class: 'settings-link-button danger',
                                onClick: () => workspace.removeSshProxyConfig(config.name)
                              },
                              '删除'
                            )
                          ])
                        ])
                      )
                    ])
                  : h('div', { class: 'settings-empty-state' }, '暂无代理配置，请添加'),
                h('footer', [
                  h('button', { class: 'settings-button primary', onClick: () => workspace.openAddSshProxyConfig() }, '添加'),
                  h('button', { class: 'settings-button', onClick: () => workspace.closeSshProxyConfig() }, '关闭')
                ])
              ])
            ])
          : null,
        workspace.sshProxyAddModalOpen
          ? h('div', { class: 'settings-modal proxy-config-add-modal' }, [
              h('div', { class: 'settings-modal-card small proxy-add-card' }, [
                h('header', [h('h3', '添加代理'), h('button', { title: '关闭', onClick: () => workspace.closeAddSshProxyConfig() }, '×')]),
                h('label', [
                  h('span', '代理名称'),
                  h('input', {
                    class: 'settings-input',
                    value: workspace.sshProxyForm.name,
                    placeholder: '代理名称',
                    onInput: (event: Event) => workspace.updateSshProxyForm({ name: (event.target as HTMLInputElement).value })
                  })
                ]),
                h('label', [
                  h('span', '代理类型'),
                  h(
                    'select',
                    {
                      class: 'settings-select',
                      value: workspace.sshProxyForm.type,
                      onChange: (event: Event) => workspace.updateSshProxyForm({ type: (event.target as HTMLSelectElement).value as any })
                    },
                    ['HTTP', 'HTTPS', 'SOCKS4', 'SOCKS5'].map((type) => h('option', { value: type }, type))
                  )
                ]),
                h('label', [
                  h('span', '代理主机'),
                  h('input', {
                    class: 'settings-input',
                    value: workspace.sshProxyForm.host,
                    placeholder: '代理主机',
                    onInput: (event: Event) => workspace.updateSshProxyForm({ host: (event.target as HTMLInputElement).value })
                  })
                ]),
                h('label', [
                  h('span', '代理端口'),
                  h('input', {
                    class: 'settings-input',
                    type: 'number',
                    min: 1,
                    max: 65535,
                    value: workspace.sshProxyForm.port,
                    placeholder: '代理端口',
                    onInput: (event: Event) => workspace.updateSshProxyForm({ port: Number((event.target as HTMLInputElement).value) })
                  })
                ]),
                h('label', { class: 'settings-check-line' }, [
                  h('input', {
                    type: 'checkbox',
                    checked: workspace.sshProxyForm.enableProxyIdentity,
                    onChange: (event: Event) => workspace.updateSshProxyForm({ enableProxyIdentity: (event.target as HTMLInputElement).checked })
                  }),
                  '代理身份认证'
                ]),
                workspace.sshProxyForm.enableProxyIdentity
                  ? [
                      h('label', [
                        h('span', '代理用户名'),
                        h('input', {
                          class: 'settings-input',
                          value: workspace.sshProxyForm.username,
                          placeholder: '代理用户名',
                          onInput: (event: Event) => workspace.updateSshProxyForm({ username: (event.target as HTMLInputElement).value })
                        })
                      ]),
                      h('label', [
                        h('span', '代理密码'),
                        h('input', {
                          class: 'settings-input',
                          type: 'password',
                          value: workspace.sshProxyForm.password,
                          placeholder: '代理密码',
                          onInput: (event: Event) => workspace.updateSshProxyForm({ password: (event.target as HTMLInputElement).value })
                        })
                      ])
                    ]
                  : null,
                h('footer', [
                  h('button', { class: 'settings-button', onClick: () => workspace.closeAddSshProxyConfig() }, '取消'),
                  h('button', { class: 'settings-button primary', onClick: () => workspace.saveSshProxyForm() }, '确认')
                ])
              ])
            ])
          : null
      ])
  }
})

const ModelSettings = defineComponent({
  name: 'ModelSettings',
  setup() {
    const handleModelOptionChange = async (event: Event, name: string) => {
      const input = event.target as HTMLInputElement
      const saved = await workspace.updateModelOption(name, input.checked)
      if (!saved) {
        input.checked = Boolean(workspace.settingModelOptions.find((model) => model.name === name)?.checked)
      }
    }
    const handleAddModelSwitchChange = async (event: Event) => {
      const input = event.target as HTMLInputElement
      const saved = await workspace.toggleAddModelSwitch(input.checked)
      if (!saved) input.checked = workspace.addModelSwitch
    }
    return () =>
      h('div', [
        h('h3', '模型名称'),
        h(
          'div',
          { class: 'settings-section-card model-names-card' },
          workspace.settingModelOptions.map((model) =>
            h('label', { class: ['model-check-row', { locked: model.locked }] }, [
              h('input', {
                type: 'checkbox',
                checked: model.checked,
                disabled: model.locked,
                onChange: (event: Event) => handleModelOptionChange(event, model.name)
              }),
              model.locked ? h(LockKeyhole) : null,
              h('span', model.name.replace(/-Thinking$/, '')),
              model.name.endsWith('-Thinking') ? h(Brain, { class: 'thinking-icon' }) : null,
              model.checked && model.type === 'custom' && !model.locked
                ? h(
                    'button',
                    {
                      title: '移除',
                      onClick: (event: Event) => {
                        event.preventDefault()
                        void workspace.removeModelOption(model.name)
                      }
                    },
                    [h(X)]
                  )
                : null
            ])
          )
        ),
        h('div', { class: 'settings-switch-row' }, [
          h('span', '添加模型'),
          h('label', { class: 'settings-switch' }, [
            h('input', {
              type: 'checkbox',
              checked: workspace.addModelSwitch,
              onChange: handleAddModelSwitchChange
            }),
            h('span')
          ])
        ]),
        workspace.addModelSwitch
          ? h('div', [h('h3', 'API 配置'), ...modelProviderCards.map((item) => h(ProviderCard, { key: item.provider, provider: item.provider, title: item.title }))])
          : null
      ])
  }
})

const AiPreferenceSettings = defineComponent({
  name: 'AiPreferenceSettings',
  setup() {
    return () =>
      h('div', [
        h('h3', '通用'),
        h('div', { class: 'settings-section-card ai-preferences' }, [
          h('label', { class: 'settings-check-line' }, [
            h('input', {
              type: 'checkbox',
              checked: workspace.aiPreferences.enableExtendedThinking,
              onChange: (event: Event) =>
                restoreCheckboxOnFailedSave(event, workspace.aiPreferences.enableExtendedThinking, (checked) =>
                  workspace.updateAiPreferences({ enableExtendedThinking: checked })
                )
            }),
            '启用 Extended Thinking'
          ]),
          workspace.aiPreferences.enableExtendedThinking
            ? h('div', { class: 'settings-budget' }, [
                h('strong', `Budget: ${workspace.aiPreferences.thinkingBudgetTokens.toLocaleString()} tokens`),
                h('input', {
                  type: 'range',
                  value: workspace.aiPreferences.thinkingBudgetTokens,
                  min: 1024,
                  max: 6553,
                  step: 1,
                  onInput: (event: Event) =>
                    restoreInputOnFailedSave(event, workspace.aiPreferences.thinkingBudgetTokens, (value) =>
                      workspace.updateAiPreferences({ thinkingBudgetTokens: Number(value) })
                    )
                }),
                h('small', '为推理模型保留更多 token 预算。')
              ])
            : null,
          h(SettingsCheckbox, {
            label: '自动执行只读命令',
            description: '只读命令可在确认范围内自动执行。',
            checked: workspace.aiPreferences.autoExecuteReadOnlyCommands,
            onChange: (checked: boolean) => workspace.updateAiPreferences({ autoExecuteReadOnlyCommands: checked })
          }),
          h(SettingsCheckbox, {
            label: '命令输出过滤',
            description: '压缩长输出，保留和任务相关的片段。',
            checked: workspace.aiPreferences.commandOutputFilteringEnabled,
            onChange: (checked: boolean) => workspace.updateAiPreferences({ commandOutputFilteringEnabled: checked })
          }),
          h(SettingsCheckbox, {
            label: '知识库搜索',
            description: '允许 AI 在上下文中检索知识库条目。',
            checked: workspace.aiPreferences.kbSearchEnabled,
            onChange: (checked: boolean) => workspace.updateAiPreferences({ kbSearchEnabled: checked })
          }),
          h(SettingsCheckbox, {
            label: '经验抽取',
            description: '从对话和命令执行中提取可复用经验。',
            checked: workspace.aiPreferences.experienceExtractionEnabled,
            onChange: (checked: boolean) => workspace.updateAiPreferences({ experienceExtractionEnabled: checked })
          }),
          h(SettingsCheckbox, {
            label: '自动批准',
            description: '为低风险动作保留自动审批入口。',
            checked: workspace.aiPreferences.autoApproval,
            onboardingId: 'settings-ai-auto-approval',
            onChange: (checked: boolean) => workspace.updateAiPreferences({ autoApproval: checked })
          }),
          h('div', { class: 'security-config-row' }, [
            h('span', '安全配置'),
            h('button', { class: 'settings-button', onClick: () => workspace.openSecurityConfigEditor() }, '打开安全配置')
          ])
        ]),
        h('h3', '功能'),
        h('div', { class: 'settings-section-card' }, [
          selectRow(
            'OpenAI Reasoning Effort',
            workspace.aiPreferences.reasoningEffort,
            [
              { value: 'low', label: '低' },
              { value: 'medium', label: '中' },
              { value: 'high', label: '高' }
            ],
            (value) => workspace.updateAiPreferences({ reasoningEffort: value as any }),
            true
          )
        ]),
        h('h3', '代理设置'),
        h('div', { class: 'settings-section-card' }, [
          h('label', { class: 'settings-check-line' }, [
            h('input', {
              type: 'checkbox',
              checked: workspace.aiPreferences.needProxy,
              onChange: (event: Event) =>
                restoreCheckboxOnFailedSave(event, workspace.aiPreferences.needProxy, (checked) => workspace.updateAiPreferences({ needProxy: checked }))
            }),
            '启用代理'
          ]),
          workspace.aiPreferences.needProxy
            ? h('div', [
                h('div', { class: 'proxy-grid' }, [
                  h('label', [
                    h('span', '代理类型'),
                    h(
                      'select',
                      {
                        class: 'settings-select',
                        value: workspace.aiPreferences.proxy.type,
                        onChange: (event: Event) =>
                          restoreSelectOnFailedSave(event, workspace.aiPreferences.proxy.type, (value) =>
                            workspace.updateAiPreferences({ proxy: { type: value as any } })
                          )
                      },
                      ['HTTP', 'HTTPS', 'SOCKS4', 'SOCKS5'].map((item) => h('option', { value: item }, item))
                    )
                  ]),
                  h('label', [
                    h('span', 'Host'),
                    h('input', {
                      class: 'settings-input',
                      value: workspace.aiPreferences.proxy.host,
                      onChange: (event: Event) =>
                        restoreInputOnFailedSave(event, workspace.aiPreferences.proxy.host, (value) => workspace.updateAiPreferences({ proxy: { host: value } }))
                    })
                  ]),
                  h('label', [
                    h('span', 'Port'),
                    h('input', {
                      class: 'settings-input',
                      type: 'number',
                      min: 1,
                      max: 65535,
                      value: workspace.aiPreferences.proxy.port,
                      onChange: (event: Event) =>
                        restoreInputOnFailedSave(event, workspace.aiPreferences.proxy.port, (value) =>
                          workspace.updateAiPreferences({ proxy: { port: Number(value) } })
                        )
                    })
                  ])
                ]),
                h('label', { class: 'settings-check-line' }, [
                  h('input', {
                    type: 'checkbox',
                    checked: workspace.aiPreferences.proxy.enableProxyIdentity,
                    onChange: (event: Event) =>
                      restoreCheckboxOnFailedSave(event, workspace.aiPreferences.proxy.enableProxyIdentity, (checked) =>
                        workspace.updateAiPreferences({ proxy: { enableProxyIdentity: checked } })
                      )
                  }),
                  '启用代理身份'
                ]),
                workspace.aiPreferences.proxy.enableProxyIdentity
                  ? h('div', { class: 'proxy-grid credentials' }, [
                      h('label', [
                        h('span', 'Username'),
                        h('input', {
                          class: 'settings-input',
                          value: workspace.aiPreferences.proxy.username,
                          onChange: (event: Event) =>
                            restoreInputOnFailedSave(event, workspace.aiPreferences.proxy.username, (value) =>
                              workspace.updateAiPreferences({ proxy: { username: value } })
                            )
                        })
                      ]),
                      h('label', [
                        h('span', 'Password'),
                        h('input', {
                          class: 'settings-input',
                          type: 'password',
                          value: workspace.aiPreferences.proxy.password,
                          onChange: (event: Event) =>
                            restoreInputOnFailedSave(event, workspace.aiPreferences.proxy.password, (value) =>
                              workspace.updateAiPreferences({ proxy: { password: value } })
                            )
                        })
                      ])
                    ])
                  : null
              ])
            : null
        ]),
        h('h3', '终端'),
        h('div', { class: 'settings-section-card' }, [
          numberRow('Shell Integration Timeout', workspace.aiPreferences.shellIntegrationTimeout, 1, 300, (value) => workspace.updateAiPreferences({ shellIntegrationTimeout: value }), 1, true),
          h('p', { class: 'setting-description-no-padding' }, 'Shell integration command detection timeout in seconds.')
        ])
      ])
  }
})

const ExtensionSettingsPage = defineComponent({
  name: 'ExtensionSettingsPage',
  setup() {
    return () =>
      h('div', [
        h('h3', '扩展'),
        h('div', { class: 'settings-form-card' }, [
          switchRow('自动补全', workspace.extensionSettings.autoCompleteStatus, (checked) => workspace.updateExtensionSettings({ autoCompleteStatus: checked })),
          switchRow('Visual Vim Editor', workspace.extensionSettings.quickVimStatus, (checked) => workspace.updateExtensionSettings({ quickVimStatus: checked })),
          switchRow('Alias', workspace.extensionSettings.aliasStatus, (checked) => workspace.updateExtensionSettings({ aliasStatus: checked })),
          switchRow('关键词高亮', workspace.extensionSettings.highlightStatus, (checked) => workspace.updateExtensionSettings({ highlightStatus: checked })),
          h('div', { class: 'settings-form-row' }, [
            h('label', 'Keyword Highlighting Configuration'),
            h('button', { class: 'settings-button', onClick: () => workspace.openKeywordHighlightEditor() }, '打开配置')
          ])
        ])
      ])
  }
})

const KeywordHighlightEditorPage = defineComponent({
  name: 'KeywordHighlightEditorPage',
  setup() {
    return () =>
      h('div', { class: 'keyword-highlight-editor' }, [
        h('div', { class: 'keyword-highlight-toolbar' }, [
          h('div', { class: 'keyword-highlight-path', title: workspace.keywordHighlightConfigPath }, workspace.keywordHighlightConfigPath),
          h('div', { class: 'settings-action-row' }, [
            workspace.keywordHighlightEditorLastSaved ? h('span', { class: 'keyword-highlight-saved' }, 'Saved') : null,
            h('button', { class: 'settings-button', onClick: () => workspace.resetKeywordHighlightEditor() }, 'Reset'),
            h('button', { class: 'settings-button primary', disabled: Boolean(workspace.keywordHighlightEditorError), onClick: () => workspace.saveKeywordHighlightEditor() }, 'Save'),
            h('button', { class: 'settings-button', onClick: () => workspace.closeKeywordHighlightEditor() }, 'Close')
          ])
        ]),
        h(SettingsJsonEditor, {
          modelValue: workspace.keywordHighlightEditorContent,
          editorClass: 'keyword-highlight-json-editor',
          'onUpdate:modelValue': (value: string) => workspace.updateKeywordHighlightEditorContent(value),
          onSave: () => workspace.saveKeywordHighlightEditor()
        }),
        workspace.keywordHighlightEditorError ? h('div', { class: 'editor-error keyword-highlight-error' }, workspace.keywordHighlightEditorError) : null
      ])
  }
})

const SecurityConfigEditorPage = defineComponent({
  name: 'SecurityConfigEditorPage',
  setup() {
    return () =>
      h('div', { class: 'security-config-editor' }, [
        h('div', { class: 'security-config-toolbar' }, [
          h('div', { class: 'security-config-path', title: workspace.securityConfigPath }, workspace.securityConfigPath),
          h('div', { class: 'settings-action-row' }, [
            workspace.securityConfigEditorLastSaved ? h('span', { class: 'security-config-saved' }, 'Saved') : null,
            h('button', { class: 'settings-button', onClick: () => workspace.resetSecurityConfigEditor() }, 'Reset'),
            h('button', { class: 'settings-button primary', disabled: Boolean(workspace.securityConfigEditorError), onClick: () => workspace.saveSecurityConfigEditor() }, 'Save'),
            h('button', { class: 'settings-button', onClick: () => workspace.closeSecurityConfigEditor() }, 'Close')
          ])
        ]),
        h(SettingsJsonEditor, {
          modelValue: workspace.securityConfigEditorContent,
          editorClass: 'security-config-json-editor',
          'onUpdate:modelValue': (value: string) => workspace.updateSecurityConfigEditorContent(value),
          onSave: () => workspace.saveSecurityConfigEditor()
        }),
        workspace.securityConfigEditorError ? h('div', { class: 'editor-error security-config-error' }, workspace.securityConfigEditorError) : null
      ])
  }
})

const BillingSettingsPage = defineComponent({
  name: 'BillingSettingsPage',
  setup() {
    return () =>
      h('div', [
        h('h3', '计费概览'),
        h(
          'div',
          { class: 'settings-section-card billing-card' },
          workspace.billingSettings.skippedLogin
            ? [
                h('div', { class: 'settings-empty-state' }, [
                  h('p', '登录后可查看账户订阅、预算和用量比例。'),
                  h('button', { class: 'settings-button primary', onClick: () => workspace.openUserLogin() }, '登录')
                ])
              ]
            : [
                infoRow('账户中心', h('button', { class: 'settings-button', onClick: () => workspace.openSettingsExternalAction('账户中心') }, '打开')),
                infoRow('Email', workspace.billingSettings.email),
                infoRow('Subscription', h('span', { class: 'subscription-type' }, workspace.billingSettings.subscription)),
                infoRow('Subscription Expires At', workspace.billingSettings.subscriptionExpiresAt || 'Never'),
                infoRow('Budget Reset At', workspace.billingSettings.budgetResetAt || '-'),
                h('div', { class: 'billing-ratio-row' }, [
                  h('span', 'Ratio'),
                  h('div', { class: 'settings-progress' }, [
                    h('div', { style: { width: `${Math.round(workspace.billingSettings.ratio * 100)}%` } }),
                    h('em', `${Math.round(workspace.billingSettings.ratio * 100)}%`)
                  ])
                ])
              ]
        )
      ])
  }
})

const McpSettingsPage = defineComponent({
  name: 'McpSettingsPage',
  setup() {
    return () =>
      h('div', [
        h('div', { class: 'settings-section-title-row' }, [
          h('div', [h('h3', 'MCP Servers'), h('small', '管理 Agent 可用的 MCP servers、tools 和 resources。')]),
          h('button', { class: 'settings-button primary', onClick: () => workspace.openMcpConfigEditor() }, '+ Add Server')
        ]),
        workspace.mcpServers.length === 0
          ? h('div', { class: 'settings-section-card settings-empty-state' }, 'No MCP Servers')
          : h(
              'div',
              { class: 'mcp-server-list' },
              workspace.mcpServers.map((server) => {
                const expanded = workspace.expandedMcpServerNames.includes(server.name)
                const tab = workspace.activeMcpServerTab[server.name] || 'tools'
                const statusLabel = server.disabled ? 'disabled' : server.status
                return h('div', { class: ['settings-section-card mcp-server-card', { disabled: server.disabled }] }, [
                  h('div', { class: 'mcp-server-header' }, [
                    h('button', { class: 'mcp-server-title', onClick: () => workspace.toggleMcpServerExpanded(server.name) }, [
                      h('span', { class: ['mcp-expand-caret', { expanded }] }, '›'),
                      h('strong', server.name),
                      h('em', { class: ['mcp-status-badge', statusLabel] }, statusLabel)
                    ]),
                    h('div', { class: 'mcp-actions' }, [
                      h('button', { class: 'settings-button', onClick: () => workspace.openMcpConfigEditor() }, '编辑'),
                      h('button', { class: 'settings-button danger', onClick: () => workspace.deleteMcpServer(server.name) }, '删除'),
                      h('label', { class: 'settings-switch' }, [
                        h('input', { type: 'checkbox', checked: !server.disabled, onChange: () => workspace.toggleMcpServerDisabled(server.name) }),
                        h('span')
                      ])
                    ])
                  ]),
                  expanded
                    ? h('div', { class: 'mcp-server-content' }, [
                        server.error ? h('div', { class: 'settings-error' }, server.error) : null,
                        h('div', { class: 'settings-tab-bar' }, [
                          h('button', { class: { active: tab === 'tools' }, onClick: () => workspace.setMcpServerTab(server.name, 'tools') }, `Tools (${server.tools.length})`),
                          h('button', { class: { active: tab === 'resources' }, onClick: () => workspace.setMcpServerTab(server.name, 'resources') }, `Resources (${server.resources.length})`)
                        ]),
                        tab === 'tools'
                          ? h(
                              'div',
                              { class: 'mcp-tool-list' },
                              server.tools.length
                                ? server.tools.map((tool) => {
                                    const operationKey = workspace.getMcpToolOperationKey(server.name, tool.name)
                                    const operationResult = workspace.mcpOperationResults[operationKey]
                                    const operationRunning = operationResult?.status === 'running'
                                    const operationDisabled = server.disabled || server.status !== 'connected' || !tool.enabled || operationRunning
                                    return h('div', { key: `${server.name}:${tool.name}`, class: ['mcp-tool-item', { disabled: !tool.enabled }] }, [
                                      h('div', { class: 'mcp-tool-header' }, [
                                        h('span', { class: 'mcp-tool-icon' }, 'tool'),
                                        h('button', { onClick: () => workspace.toggleMcpTool(server.name, tool.name) }, tool.name),
                                        h('em', { class: ['mcp-tool-state', tool.enabled ? 'success' : 'default'] }, tool.enabled ? 'success' : 'default')
                                      ]),
                                      tool.description ? h('small', tool.description) : null,
                                      h('div', { class: 'mcp-auto-approve-row' }, [
                                        h('span', { title: 'Auto-approved tools run without confirmation.' }, 'Auto Approve'),
                                        h('label', { class: 'settings-switch' }, [
                                          h('input', {
                                            type: 'checkbox',
                                            checked: Boolean(tool.autoApprove),
                                            disabled: operationRunning,
                                            onChange: () => workspace.toggleMcpToolAutoApprove(server.name, tool.name)
                                          }),
                                          h('span')
                                        ])
                                      ]),
                                      tool.parameters.length
                                        ? h('div', { class: 'mcp-parameters' }, [
                                            h('strong', `PARAMETERS (${tool.parameters.length})`),
                                            ...tool.parameters.map((parameter) =>
                                              h('p', [
                                                h('span', parameter.name),
                                                parameter.required ? h('b', '*') : null,
                                                h('small', parameter.description || 'No description')
                                              ])
                                            )
                                          ])
                                        : null,
                                      h('div', { class: 'mcp-operation-panel' }, [
                                        h('textarea', {
                                          class: 'mcp-operation-input',
                                          rows: 4,
                                          spellcheck: 'false',
                                          disabled: operationDisabled,
                                          value: workspace.getMcpToolArgumentDraft(server.name, tool.name),
                                          placeholder: mcpToolArgumentsPlaceholder(tool.parameters),
                                          onInput: (event: Event) => workspace.updateMcpToolArgumentDraft(server.name, tool.name, (event.target as HTMLTextAreaElement).value)
                                        }),
                                        h('div', { class: 'mcp-operation-actions' }, [
                                          h(
                                            'button',
                                            {
                                              class: 'settings-button primary',
                                              disabled: operationDisabled,
                                              onClick: () => workspace.runMcpTool(server.name, tool.name)
                                            },
                                            [h(Play), operationRunning ? 'Running' : 'Run']
                                          )
                                        ]),
                                        renderMcpOperationResult(operationResult)
                                      ])
                                    ])
                                  })
                                : [h('div', { class: 'settings-empty-state' }, 'No Tools')]
                            )
                          : h(
                              'div',
                              { class: 'mcp-tool-list' },
                              server.resources.length
                                ? server.resources.map((resource) => {
                                    const operationKey = workspace.getMcpResourceOperationKey(server.name, resource.uri)
                                    const operationResult = workspace.mcpOperationResults[operationKey]
                                    const operationRunning = operationResult?.status === 'running'
                                    const operationDisabled = server.disabled || server.status !== 'connected' || operationRunning
                                    return h('div', { key: `${server.name}:${resource.uri}`, class: 'mcp-resource-item' }, [
                                      h('div', { class: 'mcp-resource-header' }, [
                                        h('span', { class: 'mcp-tool-icon' }, 'resource'),
                                        h('strong', resource.name),
                                        h(
                                          'button',
                                          {
                                            class: 'settings-button primary',
                                            disabled: operationDisabled,
                                            onClick: () => workspace.readMcpResource(server.name, resource.uri)
                                          },
                                          [h(BookOpen), operationRunning ? 'Reading' : 'Read']
                                        )
                                      ]),
                                      resource.description ? h('small', resource.description) : null,
                                      h('code', resource.uri),
                                      renderMcpOperationResult(operationResult)
                                    ])
                                  })
                                : [h('div', { class: 'settings-empty-state' }, 'No Resources')]
                            )
                      ])
                    : null
                ])
              })
            )
      ])
  }
})

const McpConfigEditorPage = defineComponent({
  name: 'McpConfigEditorPage',
  setup() {
    return () =>
      h('div', { class: 'mcp-config-editor' }, [
        h('div', { class: 'mcp-config-toolbar' }, [
          h('div', { class: 'mcp-config-path', title: workspace.mcpConfigPath }, workspace.mcpConfigPath),
          h('div', { class: 'settings-action-row' }, [
            workspace.mcpConfigEditorLastSaved ? h('span', { class: 'mcp-config-saved' }, 'Saved') : null,
            h('button', { class: 'settings-button primary', disabled: Boolean(workspace.mcpConfigEditorError), onClick: () => workspace.saveMcpConfigEditor(true) }, 'Save'),
            h('button', { class: 'settings-button', onClick: () => workspace.closeMcpConfigEditor() }, 'Close')
          ])
        ]),
        h(SettingsJsonEditor, {
          modelValue: workspace.mcpConfigEditorContent,
          editorClass: 'mcp-config-json-editor',
          'onUpdate:modelValue': (value: string) => workspace.updateMcpConfigEditorContent(value),
          onSave: () => workspace.saveMcpConfigEditor(true)
        }),
        workspace.mcpConfigEditorError ? h('div', { class: 'editor-error mcp-config-error' }, workspace.mcpConfigEditorError) : null
      ])
  }
})

const SkillsSettingsPage = defineComponent({
  name: 'SkillsSettingsPage',
  setup() {
    return () =>
      h('div', [
        h('div', { class: 'settings-section-title-row' }, [
          h('div', [h('h3', 'Skills'), h('p', { class: 'settings-path-hint' }, workspace.skillsUserPath)]),
          h('div', { class: 'settings-action-row' }, [
            h('button', { class: 'settings-button', onClick: () => void workspace.openSkillsFolder() }, '打开文件夹'),
            h('button', { class: 'settings-button', onClick: () => void workspace.reloadSkills() }, 'Reload'),
            h('button', { class: 'settings-button', onClick: () => workspace.importSkillZip() }, 'Import'),
            h('button', { class: 'settings-button primary', onClick: () => void workspace.openSkillModal('create') }, 'Create')
          ])
        ]),
        h(
          'div',
          { class: 'settings-section-card skills-list' },
          workspace.settingsSkills.length
            ? workspace.settingsSkills.map((skill) =>
                h('div', { class: ['skill-item', { disabled: !skill.enabled }] }, [
                  h('div', { class: 'skill-main' }, [h('strong', skill.name), h('small', skill.description)]),
                  h('div', { class: 'settings-action-row' }, [
                    h('label', { class: 'settings-switch' }, [h('input', { type: 'checkbox', checked: skill.enabled, onChange: () => void workspace.toggleSkillEnabled(skill.name) }), h('span')]),
                    skill.editable ? h('button', { class: 'settings-button', onClick: () => void workspace.openSkillModal('edit', skill.name) }, '编辑') : null,
                    h('button', { class: 'settings-button', onClick: () => void workspace.exportSkillZip(skill.name) }, '导出'),
                    h('button', { class: 'settings-button danger', onClick: () => void workspace.deleteSkill(skill.name) }, '删除')
                  ])
                ])
              )
            : [h('div', { class: 'settings-empty-state' }, 'No Skills Yet')]
        ),
        workspace.skillModal.mode
          ? h('div', { class: 'settings-modal' }, [
              h('div', { class: 'settings-modal-card' }, [
                h('header', [h('h3', workspace.skillModal.mode === 'create' ? 'Create Skill' : 'Edit Skill'), h('button', { title: '关闭', onClick: () => workspace.closeSkillModal() }, '×')]),
                h('label', [h('span', 'Skill Name'), h('input', { class: 'settings-input', value: workspace.skillModal.name, disabled: workspace.skillModal.mode === 'edit', onInput: (event: Event) => (workspace.skillModal.name = (event.target as HTMLInputElement).value) })]),
                h('label', [h('span', 'Description'), h('textarea', { value: workspace.skillModal.description, onInput: (event: Event) => (workspace.skillModal.description = (event.target as HTMLTextAreaElement).value) })]),
                h('label', [h('span', 'Content'), h('textarea', { rows: 8, value: workspace.skillModal.content, onInput: (event: Event) => (workspace.skillModal.content = (event.target as HTMLTextAreaElement).value) })]),
                h('footer', [h('button', { class: 'settings-button', onClick: () => workspace.closeSkillModal() }, '取消'), h('button', { class: 'settings-button primary', onClick: () => void workspace.saveSkillModal() }, workspace.skillModal.mode === 'create' ? '创建' : '保存')])
              ])
            ])
          : null
      ])
  }
})

const RulesSettingsPage = defineComponent({
  name: 'RulesSettingsPage',
  setup() {
    return () =>
      h('div', [
        h('div', { class: 'settings-section-title-row' }, [h('h3', '规则'), h('button', { class: 'settings-button', onClick: () => workspace.addSettingsRule() }, '+ 添加规则')]),
        h('div', { class: 'settings-section-card rules-card' }, [
          h('p', { class: 'settings-description' }, 'User Rules 会作为 Agent 行为约束参与对话和命令生成。'),
          workspace.settingsRules.length
            ? h(
                'div',
                { class: 'rules-list' },
                workspace.settingsRules.map((rule) =>
                  h('div', { class: ['rule-item', { disabled: !rule.enabled }] }, [
                    rule.isEditing
                      ? h('div', { class: 'rule-edit' }, [
                          h('textarea', { value: rule.content, rows: 4, placeholder: '输入规则', onInput: (event: Event) => workspace.updateSettingsRuleDraft(rule.id, (event.target as HTMLTextAreaElement).value) }),
                          h('div', { class: 'settings-action-row' }, [
                            h('button', { class: 'settings-button', onClick: () => workspace.cancelSettingsRuleEdit(rule.id) }, '取消'),
                            h('button', { class: 'settings-button primary', onClick: () => workspace.saveSettingsRule(rule.id) }, '完成')
                          ])
                        ])
                      : h('div', { class: 'rule-display' }, [
                          h('button', { class: 'rule-content', onClick: () => workspace.editSettingsRule(rule.id) }, rule.content),
                          h('div', { class: 'settings-action-row' }, [
                            h('label', { class: 'settings-switch' }, [h('input', { type: 'checkbox', checked: rule.enabled, onChange: () => workspace.toggleSettingsRule(rule.id) }), h('span')]),
                            h('button', { class: 'settings-button', onClick: () => workspace.editSettingsRule(rule.id) }, '编辑'),
                            h('button', { class: 'settings-button danger', onClick: () => workspace.deleteSettingsRule(rule.id) }, '删除')
                          ])
                        ])
                  ])
                )
              )
            : h('div', { class: 'settings-empty-state' }, [h('p', 'No Rules Yet'), h('button', { class: 'settings-button', onClick: () => workspace.addSettingsRule() }, '添加规则')])
        ])
      ])
  }
})

const ShortcutsSettingsPage = defineComponent({
  name: 'ShortcutsSettingsPage',
  setup() {
    return () =>
      h('div', [
        h('h3', '快捷键设置'),
        h('div', { class: 'settings-section-card shortcuts-card' }, [
          h('div', { class: 'shortcuts-table' }, [
            h('div', { class: 'shortcuts-header' }, [h('span', 'Shortcut Key'), h('span', 'Action')]),
            ...workspace.settingsShortcuts.map((shortcut) =>
              h('div', { class: 'shortcuts-row' }, [
                h('div', { class: 'shortcut-cell' }, [
                  h(
                    'button',
                    {
                      class: ['shortcut-display', { recording: workspace.shortcutRecording.actionId === shortcut.id, 'is-empty': !shortcut.shortcut }],
                      onClick: () => workspace.startShortcutRecording(shortcut.id)
                    },
                    workspace.shortcutRecording.actionId === shortcut.id
                      ? 'Recording'
                      : shortcut.shortcut
                        ? shortcut.shortcut.split('+').map((token) => h('kbd', token))
                        : '点击修改'
                  ),
                  shortcut.suffix ? h('kbd', { class: 'key-chip-range' }, shortcut.suffix) : null
                ]),
                h('div', shortcut.action)
              ])
            )
          ]),
          h('div', { class: 'shortcuts-footer' }, [h('button', { class: 'settings-button', onClick: () => workspace.resetAllShortcuts() }, '重置全部')])
        ]),
        workspace.shortcutRecording.actionId
          ? h('div', { class: 'settings-modal shortcut-modal' }, [
              h('div', { class: 'settings-modal-card small' }, [
                h('h3', 'Press Keys'),
                h('input', { class: 'settings-input', value: workspace.shortcutRecording.tempShortcut, placeholder: 'Ctrl+Shift+K', onInput: (event: Event) => workspace.updateShortcutRecording((event.target as HTMLInputElement).value) }),
                h('footer', [h('button', { class: 'settings-button', onClick: () => workspace.cancelShortcutRecording() }, '取消'), h('button', { class: 'settings-button primary', onClick: () => workspace.saveShortcutRecording() }, '保存')])
              ])
            ])
          : null
      ])
  }
})

const TrustedDevicesSettingsPage = defineComponent({
  name: 'TrustedDevicesSettingsPage',
  setup() {
    const maskMac = (mac: string) => {
      const hex = mac.replace(/[-:]/g, '').toLowerCase()
      if (hex.length < 8) return hex
      return `${hex.slice(0, 2)}:${hex.slice(2, 4)}:**:**:${hex.slice(-4, -2)}:${hex.slice(-2)}`
    }
    return () =>
      h('div', [
        h('h3', '可信设备'),
        workspace.userProfile.skippedLogin || workspace.userProfile.lastLoginMethod === 'skip'
          ? h('div', { class: 'settings-section-card trusted-devices-card settings-empty-state' }, [
              h('p', '登录后可查看和管理当前账户的可信设备。'),
              h('button', { class: 'settings-button primary', onClick: () => workspace.openUserLogin() }, '登录')
            ])
          : h('div', { class: 'settings-section-card trusted-devices-card' }, [
              h('p', { class: 'settings-description' }, '管理允许登录当前账户的可信设备。'),
              h(
                'div',
                { class: 'trusted-device-list' },
                workspace.trustedDevices.length
                  ? workspace.trustedDevices.map((device) =>
                      h('div', { class: 'trusted-device-item' }, [
                        h('div', { class: 'trusted-device-info' }, [
                          h('div', [h('strong', device.deviceName || 'Unknown Device'), device.current ? h('span', { class: 'current-tag' }, '当前设备') : null]),
                          h('small', `${device.lastLoginUserAgent} · IP: ${device.lastLoginIp}, ${device.location}, ${maskMac(device.macAddress)}`)
                        ]),
                        h('button', { class: 'settings-button danger', disabled: device.current, onClick: () => workspace.openTrustedDeviceRevoke(device.id) }, '移除')
                      ])
                    )
                  : [h('div', { class: 'settings-empty-state' }, '暂无可信设备')]
              ),
              h('div', { class: 'trusted-count' }, `${workspace.trustedDevices.length}/3`)
            ]),
        workspace.trustedDeviceModal.open
          ? h('div', { class: 'settings-modal' }, [
              h('div', { class: 'settings-modal-card small' }, [
                h('h3', '移除可信设备'),
                h('p', '确认移除该可信设备？'),
                h('footer', [
                  h('button', { class: 'settings-button', onClick: () => (workspace.trustedDeviceModal.open = false) }, '取消'),
                  h('button', { class: 'settings-button primary', onClick: () => workspace.confirmTrustedDeviceRevoke() }, '完成')
                ])
              ])
            ])
          : null
      ])
  }
})

const PrivacySettingsPage = defineComponent({
  name: 'PrivacySettingsPage',
  setup() {
    return () =>
      h('div', [
        h('h3', '隐私'),
        h('div', { class: 'settings-form-card' }, [
          radioRow('Telemetry', 'telemetry', [
            { label: '启用', checked: workspace.privacySettings.telemetry === 'enabled', onChange: () => workspace.updatePrivacySettings({ telemetry: 'enabled' }) },
            { label: '禁用', checked: workspace.privacySettings.telemetry === 'disabled', onChange: () => workspace.updatePrivacySettings({ telemetry: 'disabled' }) }
          ]),
          h('p', { class: 'settings-description' }, 'Telemetry 会帮助改进产品体验，可查看隐私策略。'),
          radioRow('Secret Redaction', 'secretRedaction', [
            { label: '启用', checked: workspace.privacySettings.secretRedaction === 'enabled', onChange: () => workspace.updatePrivacySettings({ secretRedaction: 'enabled' }) },
            { label: '禁用', checked: workspace.privacySettings.secretRedaction === 'disabled', onChange: () => workspace.updatePrivacySettings({ secretRedaction: 'disabled' }) }
          ]),
          h('p', { class: 'settings-description' }, '启用后会在输出和上下文中脱敏常见密钥、Token 和地址。'),
          workspace.privacySettings.secretRedaction === 'enabled'
            ? h('div', { class: 'patterns-list' }, [h('strong', 'Supported Patterns'), ...settingsSecretPatterns.map((pattern) => h('p', [pattern.name, h('code', pattern.regex)]))])
            : null,
          radioRow('Data Sync', 'dataSync', [
            { label: '启用', checked: workspace.privacySettings.dataSync === 'enabled', onChange: () => workspace.updatePrivacySettings({ dataSync: 'enabled' }) },
            { label: '禁用', checked: workspace.privacySettings.dataSync === 'disabled', onChange: () => workspace.updatePrivacySettings({ dataSync: 'disabled' }) }
          ]),
          h('div', { class: 'account-management-section' }, [
            h('div', [h('strong', 'Account Management'), h('small', '停用账户会关闭同步和登录状态。')]),
            h('button', { class: 'settings-button danger', onClick: () => workspace.updatePrivacySettings({ deactivateModalOpen: true }) }, '停用账户')
          ])
        ]),
        workspace.privacySettings.deactivateModalOpen
          ? h('div', { class: 'settings-modal' }, [
              h('div', { class: 'settings-modal-card small' }, [
                h('h3', '确认停用账户'),
                h('p', '请输入 DEACTIVATE 以确认。'),
                h('input', { class: 'settings-input', value: workspace.privacySettings.deactivateConfirmationInput, onInput: (event: Event) => (workspace.privacySettings.deactivateConfirmationInput = (event.target as HTMLInputElement).value) }),
                h('footer', [
                  h('button', { class: 'settings-button', onClick: () => workspace.updatePrivacySettings({ deactivateModalOpen: false, deactivateConfirmationInput: '' }) }, '取消'),
                  h(
                    'button',
                    {
                      class: 'settings-button danger',
                      disabled: workspace.privacySettings.deactivateConfirmationInput.trim() !== 'DEACTIVATE',
                      onClick: () => workspace.updatePrivacySettings({ deactivateModalOpen: false, deactivateConfirmationInput: '' })
                    },
                    '停用账户'
                  )
                ])
              ])
            ])
          : null
      ])
  }
})

const AboutSettingsPage = defineComponent({
  name: 'AboutSettingsPage',
  setup() {
    const updateButtonText = computed(() => {
      switch (workspace.aboutSettings.updateStatus) {
        case 'checking':
          return 'Checking'
        case 'latest':
          return 'Check Update (Latest Version)'
        case 'available':
          return `Download Update (${workspace.aboutSettings.newVersion || workspace.aboutSettings.version})`
        case 'downloading':
          return 'Downloading'
        case 'downloaded':
          return 'Install'
        case 'install-requested':
          return 'Install Requested'
        case 'error':
          return 'Check Update Error'
        default:
          return 'Check Update'
      }
    })
    const updateDescription = computed(() => {
      if (workspace.aboutSettings.updateStatus === 'available') return `New Version ${workspace.aboutSettings.newVersion || workspace.aboutSettings.version}`
      if (workspace.aboutSettings.updateStatus === 'downloaded') return 'Download complete. Install can be requested through the update bridge.'
      if (workspace.aboutSettings.updateStatus === 'install-requested') return `Install request submitted for ${workspace.aboutSettings.newVersion || workspace.aboutSettings.version}.`
      if (workspace.aboutSettings.updateStatus === 'error') return 'Update check failed. Try again when the local update bridge is available.'
      return `Version ${workspace.aboutSettings.version}`
    })
    return () =>
      h('div', { class: 'about-settings-page' }, [
        h('div', { class: 'about-card settings-section-card' }, [
          h('div', { class: 'about-logo-self' }, 'A'),
          h('h3', 'aiopsterm'),
          h('p', updateDescription.value),
          workspace.aboutSettings.updateStatus === 'downloading'
            ? h('div', { class: 'about-download-progress' }, [
                h('div', { class: 'about-progress-track' }, [
                  h('span', {
                    style: { width: `${workspace.aboutSettings.progress}%` }
                  })
                ]),
                h('small', `Downloading (${workspace.aboutSettings.progress}%)`)
              ])
            : null,
          h(
            'button',
            {
              class: 'settings-button',
              disabled:
                workspace.aboutSettings.updateStatus === 'checking' ||
                workspace.aboutSettings.updateStatus === 'downloading' ||
                workspace.aboutSettings.updateStatus === 'install-requested',
              onClick: () => workspace.checkAboutUpdate()
            },
            updateButtonText.value
          ),
          h('small', { class: 'about-copyright' }, `Copyright © ${new Date().getFullYear()} aiopsterm All rights reserved.`)
        ]),
        h('div', { class: 'settings-section-card diagnostics-card' }, [
          h('div', { class: 'diagnostics-card-header' }, [h(FolderOpen, { class: 'diagnostics-icon' }), h('strong', 'Log Diagnostics')]),
          h('small', 'Open the local log directory for troubleshooting.'),
          h('button', { class: 'settings-button', onClick: () => workspace.openSettingsExternalAction('日志目录') }, [h(FolderOpen), 'Open Log Dir'])
        ]),
        h('div', { class: 'settings-section-card diagnostics-card' }, [
          h('div', { class: 'diagnostics-card-header' }, [h(MessageSquare, { class: 'diagnostics-icon' }), h('strong', 'Feedback')]),
          h('small', 'Submit feedback through the product issue channel.'),
          h('button', { class: 'settings-button', onClick: () => workspace.openSettingsExternalAction('反馈页面') }, [h(ExternalLink), 'Submit Feedback'])
        ])
      ])
  }
})

const ProviderCard = defineComponent({
  name: 'ProviderCard',
  props: {
    provider: {
      type: String as () => SettingsModelProviderKey,
      required: true
    },
    title: {
      type: String,
      required: true
    }
  },
  setup(props) {
    const providerState = computed(() => workspace.modelProviders[props.provider])
    const checkLabel = computed(() => (workspace.modelCheckState[props.provider] === 'checking' ? 'Checking' : 'Check'))
    const openAiUrlPreview = computed(() => {
      if (props.provider !== 'openai') return ''
      const url = providerState.value.baseUrl.trim()
      if (!url) return ''
      let baseUrl = url
      if (url.endsWith('#')) {
        baseUrl = url.slice(0, -1)
      } else {
        let hasV1 = false
        try {
          hasV1 = new URL(url).pathname.split('/').filter(Boolean).includes('v1')
        } catch {
          hasV1 = false
        }
        if (!hasV1) {
          baseUrl = `${url}${url.endsWith('/') ? '' : '/'}v1`
        }
      }
      const apiPath = providerState.value.apiFormat === 'responses' ? 'responses' : 'chat/completions'
      return `${baseUrl}${baseUrl.endsWith('/') ? '' : '/'}${apiPath}`
    })
    const update = (patch: Partial<typeof providerState.value>) => workspace.updateModelProviderConfig(props.provider, patch)
    const field = (label: string, key: keyof typeof providerState.value, options: { type?: string; placeholder?: string; wide?: boolean } = {}) =>
      h('label', { class: ['provider-field', { wide: options.wide }] }, [
        h('span', label),
        h('input', {
          class: 'settings-input',
          type: options.type || 'text',
          value: providerState.value[key] as string,
          placeholder: options.placeholder,
          onChange: (event: Event) => update({ [key]: (event.target as HTMLInputElement).value })
        })
      ])
    const checkbox = (label: string, key: keyof typeof providerState.value) =>
      h('label', { class: 'settings-check-line provider-check-line' }, [
        h('input', {
          type: 'checkbox',
          checked: Boolean(providerState.value[key]),
          onChange: (event: Event) => update({ [key]: (event.target as HTMLInputElement).checked })
        }),
        label
      ])
    return () =>
      h('div', { class: 'settings-section-card provider-card' }, [
        h('header', [h('h4', props.title)]),
        props.provider === 'litellm' ? field('LiteLLM Base URL', 'baseUrl', { placeholder: 'http://localhost:4000', wide: true }) : null,
        props.provider === 'openai'
          ? [
              field('OpenAI Base URL', 'baseUrl', { placeholder: 'https://api.openai.com/v1', wide: true }),
              h('small', { class: 'provider-help' }, '末尾追加 # 可跳过自动 /v1 拼接。'),
              openAiUrlPreview.value ? h('small', { class: 'provider-help url-preview' }, `Preview: ${openAiUrlPreview.value}`) : null,
              h('label', { class: 'provider-field' }, [
                h('span', 'API Format'),
                h(
                  'select',
                  {
                    class: 'settings-select',
                    value: providerState.value.apiFormat,
                    onChange: (event: Event) =>
                      update({ apiFormat: (event.target as HTMLSelectElement).value as 'chat-completions' | 'responses' })
                  },
                  [h('option', { value: 'chat-completions' }, 'Chat Completions'), h('option', { value: 'responses' }, 'Responses')]
                )
              ])
            ]
          : null,
        props.provider === 'bedrock'
          ? [
              h('div', { class: 'provider-grid two' }, [
                field('AWS Access Key', 'awsAccessKey', { placeholder: 'AKIA...' }),
                field('AWS Secret Key', 'awsSecretKey', { type: 'password' }),
                field('AWS Session Token', 'awsSessionToken'),
                h('label', { class: 'provider-field' }, [
                  h('span', 'AWS Region'),
                  h(
                    'select',
                    {
                      class: 'settings-select',
                      value: providerState.value.awsRegion,
                      onChange: (event: Event) => update({ awsRegion: (event.target as HTMLSelectElement).value })
                    },
                    awsRegionOptions.map((region) => h('option', { value: region }, region))
                  )
                ])
              ]),
              checkbox('AWS VPC Endpoint', 'awsEndpointSelected'),
              providerState.value.awsEndpointSelected
                ? field('Bedrock Endpoint', 'awsBedrockEndpoint', { placeholder: 'https://bedrock-runtime...', wide: true })
                : null,
              checkbox('Cross Region Inference', 'awsUseCrossRegionInference')
            ]
          : null,
        props.provider === 'deepseek' ? field('DeepSeek API Key', 'apiKey', { type: 'password' }) : null,
        props.provider === 'anthropic'
          ? [field('Anthropic Base URL', 'baseUrl', { placeholder: 'https://api.anthropic.com', wide: true }), field('Anthropic API Key', 'apiKey', { type: 'password' })]
          : null,
        props.provider === 'ollama' ? field('Ollama Base URL', 'baseUrl', { placeholder: 'http://localhost:11434', wide: true }) : null,
        props.provider === 'litellm' || props.provider === 'openai' ? field('API Key', 'apiKey', { type: 'password' }) : null,
        h('label', { class: 'provider-field' }, [
          h('span', 'Model'),
          h('div', { class: 'model-input-container' }, [
            h('input', {
              class: 'settings-input',
              value: providerState.value.modelId,
              onChange: (event: Event) => update({ modelId: (event.target as HTMLInputElement).value })
            }),
            h(
              'button',
              {
                class: 'settings-button',
                disabled: workspace.modelCheckState[props.provider] === 'checking',
                onClick: () => workspace.checkModelProvider(props.provider)
              },
              checkLabel.value
            ),
            h('button', { class: 'settings-button primary', onClick: () => workspace.saveModelProvider(props.provider) }, 'Save')
          ])
        ])
      ])
  }
})

const SettingsCheckbox = defineComponent({
  name: 'SettingsCheckbox',
  props: {
    label: { type: String, required: true },
    description: { type: String, required: true },
    checked: { type: Boolean, required: true },
    onboardingId: { type: String, default: '' },
    onChange: { type: Function, required: true }
  },
  setup(props) {
    return () =>
      h('div', { class: 'settings-checkbox-item', 'data-onboarding-id': props.onboardingId || undefined }, [
        h('label', { class: 'settings-check-line' }, [
          h('input', {
            type: 'checkbox',
            checked: props.checked,
            onChange: (event: Event) => restoreCheckboxOnFailedSave(event, props.checked, props.onChange as (checked: boolean) => PersistResult)
          }),
          props.label
        ]),
        h('small', props.description)
      ])
  }
})

const radioRow = (label: string, name: string, options: Array<{ label: string; checked: boolean; onChange: () => PersistResult }>) =>
  h('div', { class: 'settings-form-row' }, [
    h('label', label),
    h(
      'div',
      { class: 'settings-radio-group' },
      options.map((option, index) =>
        h('label', [
          h('input', {
            type: 'radio',
            name,
            checked: option.checked,
            onChange: async (event: Event) => {
              const saved = await option.onChange()
              if (saved === false) {
                const input = event.target as HTMLInputElement
                const radios = Array.from(input.closest('.settings-radio-group')?.querySelectorAll<HTMLInputElement>('input[type="radio"]') || [])
                if (radios.length) {
                  radios.forEach((radio, radioIndex) => {
                    radio.checked = Boolean(options[radioIndex]?.checked)
                  })
                } else {
                  input.checked = Boolean(options[index]?.checked)
                }
              }
            }
          }),
          option.label
        ])
      )
    )
  ])

const infoRow = (label: string, value: string | ReturnType<typeof h>) => h('div', { class: 'info-row' }, [h('span', label), typeof value === 'string' ? h('span', value) : value])

const switchRow = (label: string, checked: boolean, onChange: (checked: boolean) => void | boolean | Promise<void | boolean>) =>
  h('div', { class: 'settings-form-row' }, [
    h('label', label),
    h('label', { class: 'settings-switch' }, [
      h('input', {
        type: 'checkbox',
        checked,
        onChange: async (event: Event) => {
          const input = event.target as HTMLInputElement
          const saved = await onChange(input.checked)
          if (saved === false) {
            input.checked = checked
          }
        }
      }),
      h('span')
    ])
  ])

const numberRow = (label: string, value: number, min: number, max: number | undefined, onChange: (value: number) => PersistResult, step = 1, fullLabel = false) =>
  h('div', { class: ['settings-form-row', { 'full-label': fullLabel }] }, [
    h('label', label),
    h('input', {
      class: ['settings-number', { wide: fullLabel }],
      type: 'number',
      min,
      max,
      step,
      value,
      onChange: async (event: Event) => {
        const input = event.target as HTMLInputElement
        const saved = await onChange(Number(input.value))
        if (saved === false) input.value = String(value)
      }
    })
  ])

const selectRow = (
  label: string,
  value: string,
  options: Array<{ value: string; label: string }>,
  onChange: (value: string) => PersistResult,
  fullLabel = false
) =>
  h('div', { class: ['settings-form-row', { 'full-label': fullLabel }] }, [
    h('label', label),
    h(
      'select',
      {
        class: 'settings-select',
        value,
        onChange: (event: Event) => restoreSelectOnFailedSave(event, value, onChange)
      },
      options.map((option) => h('option', { value: option.value }, option.label))
    )
  ])
</script>
