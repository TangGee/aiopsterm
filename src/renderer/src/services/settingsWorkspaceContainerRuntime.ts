import { computed, defineComponent, h, ref } from 'vue'
import { BookOpen, Brain, CircleHelp, Copy, ExternalLink, Eye, EyeOff, FolderOpen, LockKeyhole, MessageSquare, Monitor, Play, Trash2, Upload, X } from 'lucide-vue-next'
import { settingsBackgroundPresets, settingsLanguageOptions, settingsNavItems, settingsSecretPatterns, settingsThemeOptions } from '@/config/settings'
import { useWorkspaceStore } from '@/stores/workspace'
import { backgroundImageCss } from '@/services/backgroundRuntime'
import { renderMarkdownDocumentHtml } from '@/services/markdownRuntime'
import SettingsPanel from '@/components/panels/SettingsPanel.vue'
import SettingsJsonEditor from '@/components/settings/SettingsJsonEditor.vue'
import OnboardingGuide from '@/components/onboarding/OnboardingGuide.vue'
import { useI18n } from '@/i18n'
import type { AgentHookInstallerStatus } from '@shared/contracts/agentHooks'
import type { SettingsDocumentationPage } from '@shared/contracts/appRuntime'

export const useSettingsWorkspaceContainerRuntime = () => {
  const workspace = useWorkspaceStore()
  const { t } = useI18n()

  const terminalTypes = ['xterm', 'xterm-256color', 'vt100', 'vt102', 'vt220', 'vt320', 'linux', 'scoansi', 'ansi']
  const terminalFonts = [
    { value: '"DejaVu Sans Mono", "Noto Sans Mono", "Liberation Mono", monospace', label: 'DejaVu Sans Mono' },
    { value: '"Liberation Mono", "DejaVu Sans Mono", "Noto Sans Mono", monospace', label: 'Liberation Mono' },
    { value: '"Ubuntu Mono", "Ubuntu Sans Mono", "DejaVu Sans Mono", monospace', label: 'Ubuntu Mono' },
    { value: '"Noto Mono", "Noto Sans Mono", "DejaVu Sans Mono", monospace', label: 'Noto Mono' },
    { value: '"Nimbus Mono PS", "Courier 10 Pitch", "DejaVu Sans Mono", monospace', label: 'Nimbus Mono PS' },
    { value: '"Courier 10 Pitch", "Nimbus Mono PS", "DejaVu Sans Mono", monospace', label: 'Courier 10 Pitch' },
    { value: '"JetBrains Mono", "DejaVu Sans Mono", "Noto Sans Mono", monospace', label: 'JetBrains Mono (if installed)' },
    { value: '"Source Code Pro", "DejaVu Sans Mono", "Noto Sans Mono", monospace', label: 'Source Code Pro (if installed)' },
    { value: 'Menlo, Monaco, "Courier New", Consolas, "DejaVu Sans Mono", monospace', label: 'Menlo / Monaco (if installed)' }
  ]
  const cursorStyles = [
    { value: 'block' as const, labelKey: 'settings.terminal.cursorBlock' as const },
    { value: 'bar' as const, labelKey: 'settings.terminal.cursorBar' as const },
    { value: 'underline' as const, labelKey: 'settings.terminal.cursorUnderline' as const }
  ]
  type SettingsModelProviderKey = 'litellm' | 'openai' | 'bedrock' | 'deepseek' | 'anthropic' | 'ollama' | 'lmstudio'
  const modelProviderCards: Array<{ provider: SettingsModelProviderKey; title: string }> = [
    { provider: 'litellm', title: 'LiteLLM' },
    { provider: 'openai', title: 'OpenAI Compatible & Responses' },
    { provider: 'bedrock', title: 'Amazon Bedrock' },
    { provider: 'deepseek', title: 'DeepSeek' },
    { provider: 'anthropic', title: 'Anthropic' },
    { provider: 'ollama', title: 'Ollama' },
    { provider: 'lmstudio', title: 'LM Studio' }
  ]

  const modelProviderLabels: Record<string, string> = {
    default: 'Built-in',
    litellm: 'LiteLLM',
    openai: 'OpenAI Compatible',
    bedrock: 'Amazon Bedrock',
    deepseek: 'DeepSeek',
    anthropic: 'Anthropic',
    ollama: 'Ollama',
    lmstudio: 'LM Studio'
  }

  const providerConfigSummary = (model: { name: string; apiProvider?: string; type?: string; locked?: boolean; displayName?: string }) => {
    const provider = model.apiProvider || (model.locked ? 'default' : 'openai')
    const providerState = workspace.modelProviders[provider as SettingsModelProviderKey]
    const parts = [modelProviderLabels[provider] || provider]
    if (providerState?.baseUrl) parts.push(providerState.baseUrl)
    if (provider === 'openai' && providerState?.apiFormat) {
      parts.push(providerState.apiFormat === 'responses' ? 'Responses' : 'Chat Completions')
    }
    if (model.locked) parts.push('Locked')
    else if (model.type === 'custom') parts.push('Custom')
    return parts.filter(Boolean).join(' · ')
  }

  const agentHookInstallerFallbacks: AgentHookInstallerStatus[] = [
    {
      source: 'codex',
      label: 'Codex',
      binaryName: 'codex',
      binaryPath: '',
      configPath: '~/.codex/hooks.json',
      configExists: false,
      installed: false,
      scriptPath: '',
      extraConfigPath: '~/.codex/config.toml',
      warnings: []
    },
    {
      source: 'claude-code',
      label: 'Claude Code',
      binaryName: 'claude',
      binaryPath: '',
      configPath: '~/.claude/settings.json',
      configExists: false,
      installed: false,
      scriptPath: '',
      warnings: []
    },
    {
      source: 'cursor',
      label: 'Cursor',
      binaryName: 'cursor-agent',
      binaryPath: '',
      configPath: '~/.cursor/hooks.json',
      configExists: false,
      installed: false,
      scriptPath: '',
      warnings: []
    },
    {
      source: 'gemini',
      label: 'Gemini',
      binaryName: 'gemini',
      binaryPath: '',
      configPath: '~/.gemini/settings.json',
      configExists: false,
      installed: false,
      scriptPath: '',
      warnings: []
    },
    {
      source: 'copilot',
      label: 'Copilot',
      binaryName: 'copilot',
      binaryPath: '',
      configPath: '~/.copilot/config.json',
      configExists: false,
      installed: false,
      scriptPath: '',
      warnings: []
    },
    {
      source: 'grok',
      label: 'Grok',
      binaryName: 'grok',
      binaryPath: '',
      configPath: '~/.grok/hooks/aiopsterm-session.json',
      configExists: false,
      installed: false,
      scriptPath: '',
      warnings: []
    },
    {
      source: 'opencode',
      label: 'OpenCode',
      binaryName: 'opencode',
      binaryPath: '',
      configPath: '~/.config/opencode/plugins/aiopsterm-session.js',
      configExists: false,
      installed: false,
      scriptPath: '',
      warnings: []
    },
    {
      source: 'codebuddy',
      label: 'CodeBuddy',
      binaryName: 'codebuddy',
      binaryPath: '',
      configPath: '~/.codebuddy/settings.json',
      configExists: false,
      installed: false,
      scriptPath: '',
      warnings: []
    },
    {
      source: 'factory',
      label: 'Factory',
      binaryName: 'droid',
      binaryPath: '',
      configPath: '~/.factory/settings.json',
      configExists: false,
      installed: false,
      scriptPath: '',
      warnings: []
    },
    {
      source: 'qoder',
      label: 'Qoder',
      binaryName: 'qodercli',
      binaryPath: '',
      configPath: '~/.qoder/settings.json',
      configExists: false,
      installed: false,
      scriptPath: '',
      warnings: []
    },
    {
      source: 'amp',
      label: 'Amp',
      binaryName: 'amp',
      binaryPath: '',
      configPath: '~/.config/amp/plugins/aiopsterm-session.ts',
      configExists: false,
      installed: false,
      scriptPath: '',
      warnings: []
    },
    {
      source: 'pi',
      label: 'Pi',
      binaryName: 'pi',
      binaryPath: '',
      configPath: '~/.pi/agent/extensions/aiopsterm-session.ts',
      configExists: false,
      installed: false,
      scriptPath: '',
      warnings: []
    },
    {
      source: 'omp',
      label: 'OMP',
      binaryName: 'omp',
      binaryPath: '',
      configPath: '~/.omp/agent/extensions/aiopsterm-omp-session.ts',
      configExists: false,
      installed: false,
      scriptPath: '',
      warnings: []
    },
    {
      source: 'kiro',
      label: 'Kiro',
      binaryName: 'kiro-cli',
      binaryPath: '',
      configPath: '~/.kiro/agents/aiopsterm.json',
      configExists: false,
      installed: false,
      scriptPath: '',
      warnings: []
    },
    {
      source: 'rovodev',
      label: 'Rovo Dev',
      binaryName: 'acli',
      binaryPath: '',
      configPath: '~/.rovodev/config.yml',
      configExists: false,
      installed: false,
      scriptPath: '',
      warnings: []
    }
  ]

  const agentHookInstallerRows = () =>
    agentHookInstallerFallbacks.map((fallback) => workspace.agentHookInstallers.find((installer) => installer.source === fallback.source) || { ...fallback, warnings: [t('settings.ai.agentHook.statusNotLoaded')] })

  const agentHibernationLimits = {
    idleSeconds: { min: 5, max: 604800 },
    maxLiveTerminals: { min: 1, max: 256 },
    confirmationSeconds: { min: 0, max: 3600 }
  }

  const automationSnippetRows = [
    {
      label: 'Control Socket',
      descriptionKey: 'settings.ai.automation.controlSocketDescription' as const,
      value: 'AIOPSTERM_CONTROL_SOCKET'
    },
    {
      label: 'CLI Helper',
      descriptionKey: 'settings.ai.automation.cliHelperDescription' as const,
      value: 'node resources/aiopsterm-control.js list-notifications'
    },
    {
      label: 'External Codex MCP',
      descriptionKey: 'settings.ai.automation.externalCodexMcpDescription' as const,
      value: 'AIOPSTERM_EXTERNAL_CODEX_MCP_ENABLE=1'
    },
    {
      label: 'External Codex MCP Token',
      descriptionKey: 'settings.ai.automation.externalCodexMcpTokenDescription' as const,
      value: 'AIOPSTERM_EXTERNAL_CODEX_MCP_TOKEN'
    },
    {
      label: 'External Codex MCP Socket',
      descriptionKey: 'settings.ai.automation.externalCodexMcpSocketDescription' as const,
      value: 'AIOPSTERM_EXTERNAL_CODEX_MCP_SOCKET'
    }
  ]

  const displayModelLabel = (model: { name: string; displayName?: string }) => model.displayName || model.name.replace(/-Thinking$/, '')
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

  const SettingsPageHelpButton = defineComponent({
    name: 'SettingsPageHelpButton',
    props: {
      helpKey: {
        type: String as () => SettingsDocumentationPage,
        required: true
      }
    },
    setup(props) {
      return () =>
        h('div', { class: 'settings-page-help' }, [
          h(
            'button',
            {
              type: 'button',
              class: 'settings-page-help-button',
              title: t('settings.help.open'),
              'aria-label': t('settings.help.open'),
              onClick: () => void workspace.openSettingsPageDocumentation(props.helpKey)
            },
            [h(CircleHelp)]
          )
        ])
    }
  })

  const settingsPageTitle = (title: string, helpKey: SettingsDocumentationPage, options: { compact?: boolean } = {}) =>
    h('div', { class: ['settings-page-title-row', { compact: options.compact }] }, [h('h3', title), h(SettingsPageHelpButton, { helpKey })])

  const SettingsDocumentationReaderPage = defineComponent({
    name: 'SettingsDocumentationReaderPage',
    setup() {
      const html = computed(() => renderMarkdownDocumentHtml(workspace.settingsDocumentationContent))
      const openDocumentationLink = (event: MouseEvent) => {
        const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[data-settings-doc-link]') : null
        const documentPath = target?.dataset.settingsDocLink
        if (!documentPath) return
        event.preventDefault()
        void workspace.openSettingsDocumentationLink(documentPath)
      }
      return () =>
        h('div', { class: 'settings-documentation' }, [
          h('div', { class: 'settings-documentation-toolbar' }, [
            h('div', [h('h3', workspace.settingsDocumentationTitle || 'Documentation'), h('small', workspace.settingsDocumentationPath)]),
            h('button', { class: 'settings-button', onClick: () => workspace.closeSettingsDocumentation() }, t('settings.help.back'))
          ]),
          h('article', { class: 'kb-markdown-preview settings-documentation-markdown', innerHTML: html.value, onClick: openDocumentationLink })
        ])
    }
  })

  const GeneralSettings = defineComponent({
    name: 'GeneralSettings',
    setup() {
      return () =>
        h('div', [
          settingsPageTitle(t('settings.general.base'), 'general'),
          h('div', { class: 'settings-form-card' }, [
            h('div', { class: 'settings-form-row' }, [
              h('label', t('settings.general.theme')),
              h(
                'select',
                {
                  class: 'settings-select theme-select',
                  value: workspace.config.theme,
                  onChange: (event: Event) => restoreSelectOnFailedSave(event, workspace.config.theme, (value) => workspace.selectTheme(value))
                },
                [
                  h('optgroup', { label: t('settings.general.themeSystem') }, themeGroups.value.system.map((option) => h('option', { value: option.value }, option.label))),
                  h('optgroup', { label: t('settings.general.themeDefault') }, themeGroups.value.default.map((option) => h('option', { value: option.value }, option.label))),
                  h('optgroup', { label: t('settings.general.themeOfficial') }, themeGroups.value.official.map((option) => h('option', { value: option.value }, option.label)))
                ]
              )
            ]),
            h('div', { class: 'settings-form-row align-start', 'data-onboarding-id': 'settings-background-section' }, [
              h('label', t('settings.general.background')),
              h('div', { class: 'settings-backgrounds' }, [
                h('div', { class: 'settings-bg-grid' }, [
                  h(
                    'button',
                    {
                      class: ['settings-bg-tile default', { active: workspace.config.background.mode === 'none' }],
                      onClick: () => workspace.selectBackground('none')
                    },
                    [h(Monitor), h('span', t('settings.general.defaultBackground'))]
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
                  h('span', t('settings.general.customUpload')),
                  h('div', { class: 'settings-bg-grid compact' }, [
                    customBackgroundImage.value
                      ? h(
                          'button',
                          {
                            class: ['settings-bg-tile preset custom-preview', { active: workspace.config.background.mode === 'custom' }],
                            style: { backgroundImage: backgroundImageCss(customBackgroundImage.value) },
                            title: t('settings.general.customBackground'),
                            onClick: () => workspace.selectCustomBackground()
                          },
                          [
                            h(
                              'span',
                              {
                                class: 'settings-bg-delete',
                                title: t('settings.general.deleteCustomBackground'),
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
                        title: t('settings.general.upload'),
                        onClick: () => workspace.uploadCustomBackground()
                      },
                      [h(Upload)]
                    )
                  ])
                ]),
                hasSelectedBackgroundImage.value
                  ? h('div', { class: 'settings-sliders' }, [
                      h('label', [
                        h('span', t('settings.general.opacity')),
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
                        h('span', t('settings.general.brightness')),
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
            radioRow(t('settings.general.defaultLayout'), 'defaultLayout', [
              { label: 'Terminal', checked: workspace.config.defaultMode === 'terminal', onChange: () => workspace.updateDefaultLayout('terminal') },
              { label: 'Agents', checked: workspace.config.defaultMode === 'agents', onChange: () => workspace.updateDefaultLayout('agents') }
            ]),
            h('div', { class: 'settings-form-row' }, [
              h('label', t('settings.general.language')),
              h(
                'select',
                {
                  class: 'settings-select',
                  value: workspace.config.language,
                  onChange: (event: Event) => restoreSelectOnFailedSave(event, workspace.config.language, (value) => workspace.updateLanguage(value))
                },
                settingsLanguageOptions.map((language) => h('option', { value: language.value }, language.labelKey ? t(language.labelKey) : language.label))
              )
            ]),
            radioRow(t('settings.general.watermark'), 'watermark', [
              { label: t('settings.general.enabled'), checked: workspace.config.watermark === 'open', onChange: () => workspace.updateWatermark('open') },
              { label: t('settings.general.disabled'), checked: workspace.config.watermark === 'close', onChange: () => workspace.updateWatermark('close') }
            ]),
            h('div', { class: 'settings-form-row' }, [
              h('label', t('settings.general.onboarding')),
              h(
                'button',
                {
                  class: 'settings-button primary',
                  onClick: () => workspace.openOnboardingGuide()
                },
                t('settings.general.openOnboarding')
              )
            ])
          ]),
          h('h3', t('settings.general.editor')),
          h('p', { class: 'settings-description' }, t('settings.general.editorScope')),
          h('div', { class: 'settings-form-card' }, [
            numberRow(t('settings.general.fontSize'), workspace.editorSettings.fontSize, 8, 32, (value) => workspace.updateEditorSettings({ fontSize: value })),
            numberRow(t('settings.general.lineHeight'), workspace.editorSettings.lineHeight, 0, 48, (value) => workspace.updateEditorSettings({ lineHeight: value })),
            h('div', { class: 'settings-form-row' }, [
              h('label', t('settings.general.font')),
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
          settingsPageTitle(t('settings.terminal.title'), 'terminal'),
          h('p', { class: 'settings-description' }, t('settings.terminal.description')),
          h('div', { class: 'settings-form-card' }, [
            selectRow(t('settings.terminal.terminalType'), workspace.terminalSettings.terminalType, terminalTypes.map((item) => ({ value: item, label: item })), (value) => workspace.updateTerminalSettings({ terminalType: value })),
            selectRow(t('settings.terminal.font'), workspace.terminalSettings.fontFamily, terminalFonts, (value) => workspace.updateTerminalSettings({ fontFamily: value })),
            numberRow(t('settings.terminal.fontSize'), workspace.terminalSettings.fontSize, 8, 64, (value) => workspace.updateTerminalSettings({ fontSize: value })),
            numberRow(t('settings.terminal.scrollBack'), workspace.terminalSettings.scrollBack, 1, undefined, (value) => workspace.updateTerminalSettings({ scrollBack: value })),
            h('div', { class: 'settings-form-row' }, [
              h('label', t('settings.terminal.cursorStyle')),
              h(
                'div',
                { class: 'cursor-style-group' },
                cursorStyles.map((cursor) =>
                  h(
                    'button',
                    {
                      class: ['cursor-style-button', { active: workspace.terminalSettings.cursorStyle === cursor.value }],
                      title: t(cursor.labelKey),
                      onClick: () => workspace.updateTerminalSettings({ cursorStyle: cursor.value })
                    },
                    [h('span', { class: `cursor-preview ${cursor.value}` })]
                  )
                )
              )
            ]),
            switchRow(t('settings.terminal.cursorBlink'), workspace.terminalSettings.cursorBlink, (checked) => workspace.updateTerminalSettings({ cursorBlink: checked })),
            numberRow(t('settings.terminal.lineHeight'), workspace.terminalSettings.lineHeight, 1, 3, (value) => workspace.updateTerminalSettings({ lineHeight: value }), 0.1),
            switchRow(t('settings.terminal.pinchZoom'), workspace.terminalSettings.pinchZoomStatus, (checked) => workspace.updateTerminalSettings({ pinchZoomStatus: checked })),
            switchRow(t('settings.terminal.showCloseButton'), workspace.terminalSettings.showCloseButton, (checked) => workspace.updateTerminalSettings({ showCloseButton: checked })),
            switchRow(t('settings.terminal.sshAgents'), workspace.terminalSettings.sshAgentsStatus, (checked) => workspace.updateTerminalSettings({ sshAgentsStatus: checked })),
            workspace.terminalSettings.sshAgentsStatus
              ? h('div', { class: 'settings-form-row' }, [
                  h('label', t('settings.terminal.sshAgentSettings')),
                  h('button', { class: 'settings-button', onClick: () => workspace.openSshAgentConfig() }, t('common.settings'))
                ])
              : null,
            h('div', { class: 'settings-form-row align-start' }, [
              h('label', t('settings.terminal.mouseEvents')),
              h('div', { class: 'mouse-event-settings' }, [
                h('label', [
                  h('span', t('settings.terminal.middleMouse')),
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
                      h('option', { value: 'none' }, t('settings.terminal.mouseNone')),
                      h('option', { value: 'paste' }, t('settings.terminal.mousePaste')),
                      h('option', { value: 'contextMenu' }, t('settings.terminal.mouseContextMenu')),
                      h('option', { value: 'closeTab' }, t('settings.terminal.mouseCloseTab'))
                    ]
                  )
                ]),
                h('label', [
                  h('span', t('settings.terminal.rightMouse')),
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
                    [h('option', { value: 'none' }, t('settings.terminal.mouseNone')), h('option', { value: 'paste' }, t('settings.terminal.mousePaste')), h('option', { value: 'contextMenu' }, t('settings.terminal.mouseContextMenu'))]
                  )
                ])
              ])
            ])
          ]),
          workspace.sshAgentConfigModalOpen
            ? h('div', { class: 'settings-modal agent-config-modal' }, [
                h('div', { class: 'settings-modal-card agent-config-card' }, [
                  h('header', [h('h3', t('settings.terminal.sshAgentTitle')), h('button', { title: t('common.close'), onClick: () => workspace.closeSshAgentConfig() }, '×')]),
                  workspace.sshAgentKeys.length
                    ? h('div', { class: 'settings-table agent-config-table' }, [
                        h('div', { class: 'settings-table-row head' }, [
                          h('span', t('settings.terminal.sshAgentFingerprint')),
                          h('span', t('settings.terminal.sshAgentComment')),
                          h('span', t('settings.terminal.sshAgentType')),
                          h('span', t('settings.terminal.sshAgentAction'))
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
                                t('common.delete')
                              )
                            ])
                          ])
                        )
                      ])
                    : h('div', { class: 'settings-empty-state' }, t('settings.terminal.sshAgentEmpty')),
                  h('div', { class: 'agent-key-form' }, [
                    h('label', [
                      h('span', t('settings.terminal.sshAgentKey')),
                      h(
                        'select',
                        {
                          class: 'settings-select',
                          value: workspace.sshAgentSelectedKey,
                          onChange: (event: Event) => workspace.setSshAgentSelectedKey((event.target as HTMLSelectElement).value)
                        },
                        [
                          h('option', { value: '' }, t('settings.terminal.sshAgentSelectKey')),
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
                    h('button', { class: 'settings-button primary', onClick: () => workspace.addSshAgentKey() }, t('common.add'))
                  ]),
                  h('footer', [h('button', { class: 'settings-button', onClick: () => workspace.closeSshAgentConfig() }, t('common.close'))])
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
                      ['HTTP', 'HTTPS', 'SOCKS4', 'SOCKS5', 'TCP'].map((type) => h('option', { value: type }, type))
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
      const modelNameDrafts = ref<Record<string, string>>({})
      const handleModelOptionChange = async (event: Event, name: string) => {
        const input = event.target as HTMLInputElement
        const saved = await workspace.updateModelOption(name, input.checked)
        if (!saved) {
          input.checked = Boolean(workspace.settingModelOptions.find((model) => model.name === name)?.checked)
        }
      }
      const getModelNameDraft = (name: string, fallback: string) => {
        if (!(name in modelNameDrafts.value)) {
          modelNameDrafts.value = { ...modelNameDrafts.value, [name]: fallback }
        }
        return modelNameDrafts.value[name]
      }
      const handleModelDisplayNameChange = (name: string, value: string) => {
        modelNameDrafts.value = { ...modelNameDrafts.value, [name]: value }
      }
      const handleModelDisplayNameBlur = async (name: string) => {
        const model = workspace.settingModelOptions.find((item) => item.name === name)
        if (!model || model.locked || model.type !== 'custom') return
        const draft = (modelNameDrafts.value[name] || '').trim()
        const current = (model.displayName || '').trim()
        if (draft === current || (!draft && !current)) return
        const saved = await workspace.renameModelOption(name, draft)
        if (!saved) {
          modelNameDrafts.value = { ...modelNameDrafts.value, [name]: current }
        }
      }
      const handleAddModelSwitchChange = async (event: Event) => {
        const input = event.target as HTMLInputElement
        const saved = await workspace.toggleAddModelSwitch(input.checked)
        if (!saved) input.checked = workspace.addModelSwitch
      }
      return () =>
        h('div', [
          settingsPageTitle('模型名称', 'models'),
          h(
            'div',
            { class: 'settings-section-card model-names-card' },
            workspace.settingModelOptions.map((model) =>
              h('div', { class: ['model-check-row', { locked: model.locked }] }, [
                h('label', { class: 'model-check-control', title: model.locked ? '锁定模型不可关闭' : model.checked ? '停用模型' : '启用模型' }, [
                  h('input', {
                    type: 'checkbox',
                    checked: model.checked,
                    disabled: model.locked,
                    onChange: (event: Event) => handleModelOptionChange(event, model.name)
                  })
                ]),
                h('div', { class: 'model-row-main' }, [
                  h('div', { class: 'model-row-title' }, [
                    model.locked ? h(LockKeyhole) : null,
                    model.name.endsWith('-Thinking') ? h(Brain, { class: 'thinking-icon' }) : null,
                    h('strong', { title: displayModelLabel(model) }, displayModelLabel(model))
                  ]),
                  h('code', { class: 'model-row-id', title: model.name }, model.name),
                  model.type === 'custom' && !model.locked
                    ? h('label', { class: 'model-alias-field' }, [
                        h('span', '管理名称'),
                        h('input', {
                          class: 'settings-input model-alias-input',
                          value: getModelNameDraft(model.name, model.displayName || ''),
                          placeholder: model.name,
                          onInput: (event: Event) => handleModelDisplayNameChange(model.name, (event.target as HTMLInputElement).value),
                          onBlur: () => void handleModelDisplayNameBlur(model.name),
                          onKeydown: (event: KeyboardEvent) => {
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              ;(event.target as HTMLInputElement).blur()
                            }
                          }
                        })
                      ])
                    : null
                ]),
                h('div', { class: 'model-row-meta' }, [
                  h('span', { class: ['model-provider-pill', model.apiProvider || 'default'] }, modelProviderLabels[model.apiProvider || 'default'] || model.apiProvider || 'Provider'),
                  h('small', { title: providerConfigSummary(model) }, providerConfigSummary(model))
                ]),
                model.checked && model.type === 'custom' && !model.locked
                  ? h(
                      'button',
                      {
                        class: 'model-row-remove',
                        title: '移除模型配置',
                        onClick: (event: Event) => {
                          event.preventDefault()
                          void workspace.removeModelOption(model.name)
                        }
                      },
                      [h(X)]
                    )
                  : h('span', { class: 'model-row-action-spacer' })
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
          settingsPageTitle(t('settings.ai.title'), 'ai'),
          h('h3', t('settings.ai.agentHookInstaller')),
          h(AgentHookInstallerCard),
          h('h3', t('settings.ai.hibernation')),
          h(AgentHibernationSettingsCard),
          h('h3', t('settings.ai.notifications')),
          h(NotificationPreferenceSettingsCard),
          h('h3', t('settings.ai.automationDeveloper')),
          h(AutomationDeveloperSettingsCard),
          h('h3', t('settings.ai.general')),
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
              t('settings.ai.extendedThinking')
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
                  h('small', t('settings.ai.thinkingBudgetDescription'))
                ])
              : null,
            h(SettingsCheckbox, {
              label: t('settings.ai.autoExecuteReadOnly'),
              description: t('settings.ai.autoExecuteReadOnlyDescription'),
              checked: workspace.aiPreferences.autoExecuteReadOnlyCommands,
              onChange: (checked: boolean) => workspace.updateAiPreferences({ autoExecuteReadOnlyCommands: checked })
            }),
            h(SettingsCheckbox, {
              label: t('settings.ai.commandOutputFiltering'),
              description: t('settings.ai.commandOutputFilteringDescription'),
              checked: workspace.aiPreferences.commandOutputFilteringEnabled,
              onChange: (checked: boolean) => workspace.updateAiPreferences({ commandOutputFilteringEnabled: checked })
            }),
            h(SettingsCheckbox, {
              label: t('settings.ai.kbSearch'),
              description: t('settings.ai.kbSearchDescription'),
              checked: workspace.aiPreferences.kbSearchEnabled,
              onChange: (checked: boolean) => workspace.updateAiPreferences({ kbSearchEnabled: checked })
            }),
            h(SettingsCheckbox, {
              label: t('settings.ai.experienceExtraction'),
              description: t('settings.ai.experienceExtractionDescription'),
              checked: workspace.aiPreferences.experienceExtractionEnabled,
              onChange: (checked: boolean) => workspace.updateAiPreferences({ experienceExtractionEnabled: checked })
            }),
            h(SettingsCheckbox, {
              label: t('settings.ai.managedAiAutoNaming'),
              description: t('settings.ai.managedAiAutoNamingDescription'),
              checked: workspace.aiPreferences.managedAiAutoNamingEnabled,
              onChange: (checked: boolean) => workspace.updateAiPreferences({ managedAiAutoNamingEnabled: checked })
            }),
            h(SettingsCheckbox, {
              label: t('settings.ai.autoApproval'),
              description: t('settings.ai.autoApprovalDescription'),
              checked: workspace.aiPreferences.autoApproval,
              onboardingId: 'settings-ai-auto-approval',
              onChange: (checked: boolean) => workspace.updateAiPreferences({ autoApproval: checked })
            }),
            h('div', { class: 'security-config-row' }, [
              h('span', t('settings.ai.securityConfig')),
              h('button', { class: 'settings-button', onClick: () => workspace.openSecurityConfigEditor() }, t('settings.ai.openSecurityConfig'))
            ])
          ]),
          h('h3', t('settings.ai.features')),
          h('div', { class: 'settings-section-card' }, [
            selectRow(
              'OpenAI Reasoning Effort',
              workspace.aiPreferences.reasoningEffort,
              [
                { value: 'low', label: t('settings.ai.reasoningLow') },
                { value: 'medium', label: t('settings.ai.reasoningMedium') },
                { value: 'high', label: t('settings.ai.reasoningHigh') }
              ],
              (value) => workspace.updateAiPreferences({ reasoningEffort: value as any }),
              true
            )
          ]),
          h('h3', t('settings.ai.modelProxy')),
          h('div', { class: 'settings-section-card' }, [
            h('label', { class: 'settings-check-line' }, [
              h('input', {
                type: 'checkbox',
                checked: workspace.aiPreferences.needProxy,
                onChange: (event: Event) =>
                  restoreCheckboxOnFailedSave(event, workspace.aiPreferences.needProxy, (checked) => workspace.updateAiPreferences({ needProxy: checked }))
              }),
              t('settings.ai.enableProxy')
            ]),
            workspace.aiPreferences.needProxy
              ? h('div', [
                  h('div', { class: 'proxy-grid' }, [
                    h('label', [
                      h('span', t('settings.ai.proxyType')),
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
                    t('settings.ai.enableProxyIdentity')
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
          h('h3', t('settings.ai.terminal')),
          h('div', { class: 'settings-section-card' }, [
            numberRow(t('settings.ai.shellIntegrationTimeout'), workspace.aiPreferences.shellIntegrationTimeout, 1, 300, (value) => workspace.updateAiPreferences({ shellIntegrationTimeout: value }), 1, true),
            h('p', { class: 'setting-description-no-padding' }, t('settings.ai.shellIntegrationTimeoutDescription'))
          ])
        ])
    }
  })

  const AgentHookInstallerCard = defineComponent({
    name: 'AgentHookInstallerCard',
    setup() {
      const renderStatusPill = (installer: AgentHookInstallerStatus) =>
        h(
          'span',
          {
            class: ['agent-hook-status-pill', installer.installed ? 'installed' : installer.error ? 'error' : installer.binaryPath ? 'ready' : 'missing']
          },
          installer.installed
            ? t('settings.ai.agentHook.installed')
            : installer.error
              ? t('settings.ai.agentHook.configError')
              : installer.binaryPath
                ? t('settings.ai.agentHook.ready')
                : t('settings.ai.agentHook.cliMissing')
        )

      const renderMeta = (label: string, value: string) =>
        h('div', { class: 'agent-hook-meta-row' }, [
          h('span', label),
          h('code', { title: value || t('settings.ai.agentHook.detectedMissing') }, value || t('settings.ai.agentHook.detectedMissing'))
        ])

      const renderInstaller = (installer: AgentHookInstallerStatus) => {
        const busy = workspace.agentHookInstallerBusySource === installer.source
        const disabled = busy || workspace.agentHookInstallersLoading || !installer.scriptPath
        return h('article', { class: 'agent-hook-installer-row' }, [
          h('div', { class: 'agent-hook-installer-main' }, [
            h('header', [
              h('div', [h('strong', installer.label), h('small', `${t('settings.ai.agentHook.launchCommand')}: ${installer.binaryName}`)]),
              renderStatusPill(installer)
            ]),
            h('p', { class: 'agent-hook-description' }, t('settings.ai.agentHook.description')),
            h('div', { class: 'agent-hook-meta-grid' }, [
              renderMeta('CLI', installer.binaryPath),
              renderMeta(t('settings.ai.agentHook.config'), installer.configPath),
              installer.extraConfigPath ? renderMeta(t('settings.ai.agentHook.extraConfig'), installer.extraConfigPath) : null,
              renderMeta(t('settings.ai.agentHook.helper'), installer.scriptPath)
            ]),
            installer.error ? h('p', { class: 'agent-hook-error' }, installer.error) : null,
            installer.warnings.length ? h('ul', { class: 'agent-hook-warnings' }, installer.warnings.map((warning) => h('li', warning))) : null
          ]),
          h('div', { class: 'agent-hook-installer-actions' }, [
            h(
              'button',
              {
                class: ['settings-button', installer.installed ? '' : 'primary'],
                disabled,
                onClick: () => workspace.installAgentHookInstaller(installer.source)
              },
              busy ? t('common.processing') : installer.installed ? t('common.reinstall') : t('common.install')
            ),
            h(
              'button',
              {
                class: 'settings-button danger',
                disabled: disabled || !installer.installed,
                onClick: () => workspace.uninstallAgentHookInstaller(installer.source)
              },
              t('common.uninstall')
            )
          ])
        ])
      }

      return () =>
        h('div', { class: 'settings-section-card agent-hook-installer-card' }, [
          h('header', { class: 'agent-hook-card-header' }, [
            h('div', [
              h('strong', t('settings.ai.agentHook.title')),
              h('small', t('settings.ai.agentHook.subtitle'))
            ]),
            h(
              'button',
              {
                class: 'settings-button',
                disabled: workspace.agentHookInstallersLoading,
                onClick: () => workspace.refreshAgentHookInstallers()
              },
              workspace.agentHookInstallersLoading ? t('common.refreshing') : t('common.refresh')
            )
          ]),
          workspace.agentHookInstallerError ? h('p', { class: 'agent-hook-error' }, workspace.agentHookInstallerError) : null,
          ...agentHookInstallerRows().map((installer) => renderInstaller(installer))
        ])
    }
  })

  const AgentHibernationSettingsCard = defineComponent({
    name: 'AgentHibernationSettingsCard',
    setup() {
      void workspace.refreshAgentHibernationConfig()
      return () =>
        h('div', { class: 'settings-section-card' }, [
          h(SettingsCheckbox, {
            label: t('settings.ai.hibernation.enable'),
            description: t('settings.ai.hibernation.description'),
            checked: workspace.agentHibernationConfig.enabled,
            onChange: (checked: boolean) => workspace.setAgentHibernationEnabled(checked)
          }),
          numberRow(
            t('settings.ai.hibernation.idleSeconds'),
            workspace.agentHibernationConfig.idleSeconds,
            agentHibernationLimits.idleSeconds.min,
            agentHibernationLimits.idleSeconds.max,
            (value) => workspace.updateAgentHibernationConfig({ idleSeconds: value }),
            1,
            true
          ),
          h('p', { class: 'setting-description-no-padding' }, t('settings.ai.hibernation.idleDescription')),
          numberRow(
            t('settings.ai.hibernation.maxLiveTerminals'),
            workspace.agentHibernationConfig.maxLiveTerminals,
            agentHibernationLimits.maxLiveTerminals.min,
            agentHibernationLimits.maxLiveTerminals.max,
            (value) => workspace.updateAgentHibernationConfig({ maxLiveTerminals: value }),
            1,
            true
          ),
          h('p', { class: 'setting-description-no-padding' }, t('settings.ai.hibernation.maxLiveDescription')),
          numberRow(
            t('settings.ai.hibernation.confirmationSeconds'),
            workspace.agentHibernationConfig.confirmationSeconds,
            agentHibernationLimits.confirmationSeconds.min,
            agentHibernationLimits.confirmationSeconds.max,
            (value) => workspace.updateAgentHibernationConfig({ confirmationSeconds: value }),
            1,
            true
          ),
          h('p', { class: 'setting-description-no-padding' }, t('settings.ai.hibernation.confirmationDescription'))
        ])
    }
  })

  const NotificationPreferenceSettingsCard = defineComponent({
    name: 'NotificationPreferenceSettingsCard',
    setup() {
      return () =>
        h('div', { class: 'settings-section-card' }, [
          h(SettingsCheckbox, {
            label: t('settings.ai.notification.desktop'),
            description: t('settings.ai.notification.desktopDescription'),
            checked: workspace.notificationSettings.desktopNotifications,
            onChange: (checked: boolean) => workspace.updateNotificationSettings({ desktopNotifications: checked })
          }),
          h(SettingsCheckbox, {
            label: t('settings.ai.notification.controlBell'),
            description: t('settings.ai.notification.controlBellDescription'),
            checked: workspace.notificationSettings.controlNotificationBell,
            onChange: (checked: boolean) => workspace.updateNotificationSettings({ controlNotificationBell: checked })
          })
        ])
    }
  })

  const AutomationDeveloperSettingsCard = defineComponent({
    name: 'AutomationDeveloperSettingsCard',
    setup() {
      const renderSnippet = (item: (typeof automationSnippetRows)[number]) =>
        h('div', { class: 'automation-snippet-row' }, [
          h('div', [
            h('strong', item.label),
            h('small', t(item.descriptionKey)),
            h('code', item.value)
          ]),
          h(
            'button',
            {
              class: 'settings-button icon-button',
              title: t('settings.ai.automation.copySnippet', { label: item.label }),
              onClick: () => workspace.copySettingsText(item.value, item.label)
            },
            [h(Copy)]
          )
        ])

      return () =>
        h('div', { class: 'settings-section-card automation-settings-card' }, [
          h('p', { class: 'setting-description-no-padding' }, t('settings.ai.automation.description')),
          ...automationSnippetRows.map((item) => renderSnippet(item)),
          h('div', { class: 'settings-action-row' }, [
            h(
              'button',
              {
                class: 'settings-button',
                onClick: () => workspace.openSettingsDocumentationFile('technical/control-socket.md')
              },
              t('settings.ai.automation.controlProtocolDocs')
            ),
            h(
              'button',
              {
                class: 'settings-button',
                onClick: () => workspace.openSettingsDocumentationFile('technical/external-codex-mcp.md')
              },
              t('settings.ai.automation.externalCodexMcpDocs')
            )
          ])
        ])
    }
  })

  const ExtensionSettingsPage = defineComponent({
    name: 'ExtensionSettingsPage',
    setup() {
      return () =>
        h('div', [
          settingsPageTitle('扩展', 'extensions'),
          h('div', { class: 'settings-form-card' }, [
            switchRow('自动补全', workspace.extensionSettings.autoCompleteStatus, (checked) => workspace.updateExtensionSettings({ autoCompleteStatus: checked })),
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
          settingsPageTitle('计费概览', 'billing'),
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
            h('div', { class: 'settings-section-title-with-help' }, [
              settingsPageTitle('MCP Servers', 'mcp', { compact: true }),
              h('small', '管理 Agent 可用的 MCP servers、tools 和 resources。')
            ]),
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
            h('div', { class: 'settings-section-title-with-help' }, [
              settingsPageTitle('Skills', 'skills', { compact: true }),
              h('p', { class: 'settings-path-hint' }, workspace.skillsUserPath)
            ]),
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
          h('div', { class: 'settings-section-title-row' }, [
            settingsPageTitle('规则', 'rules', { compact: true }),
            h('button', { class: 'settings-button', onClick: () => workspace.addSettingsRule() }, '+ 添加规则')
          ]),
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
          settingsPageTitle('快捷键设置', 'shortcuts'),
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
          settingsPageTitle('可信设备', 'trustedDevices'),
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
          settingsPageTitle('隐私', 'privacy'),
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
            h('div', { class: 'privacy-runtime-status' }, [
              h('span', ['Runtime: ', h('strong', workspace.privacySettings.dataSyncRuntime)]),
              h('span', ['Status: ', h('strong', workspace.privacySettings.dataSyncStatus)]),
              workspace.privacySettings.dataSyncLastSyncAt ? h('span', ['Last Sync: ', h('strong', workspace.privacySettings.dataSyncLastSyncAt)]) : null,
              workspace.privacySettings.dataSyncSyncedScopes.length
                ? h('span', ['Scopes: ', h('strong', workspace.privacySettings.dataSyncSyncedScopes.join(', '))])
                : null,
              workspace.privacySettings.dataSyncStateFilePath ? h('small', workspace.privacySettings.dataSyncStateFilePath) : null,
              workspace.privacySettings.dataSyncErrorMessage ? h('small', { class: 'danger-text' }, workspace.privacySettings.dataSyncErrorMessage) : null
            ]),
            h('div', { class: 'account-management-section' }, [
              h('div', [h('strong', 'Account Management'), h('small', '停用账户会关闭同步和登录状态。')]),
              h(
                'button',
                {
                  class: 'settings-button danger',
                  disabled: workspace.privacySettings.deactivateLoading,
                  onClick: () => workspace.updatePrivacySettings({ deactivateModalOpen: true })
                },
                workspace.privacySettings.deactivateLoading ? '停用中' : '停用账户'
              )
            ])
          ]),
          workspace.privacySettings.deactivateModalOpen
            ? h('div', { class: 'settings-modal' }, [
                h('div', { class: 'settings-modal-card small' }, [
                  h('h3', '确认停用账户'),
                  h('p', '请输入 DEACTIVATE 以确认。'),
                  h('input', { class: 'settings-input', value: workspace.privacySettings.deactivateConfirmationInput, onInput: (event: Event) => (workspace.privacySettings.deactivateConfirmationInput = (event.target as HTMLInputElement).value) }),
                  h('footer', [
                    h(
                      'button',
                      {
                        class: 'settings-button',
                        disabled: workspace.privacySettings.deactivateLoading,
                        onClick: () => workspace.updatePrivacySettings({ deactivateModalOpen: false, deactivateConfirmationInput: '' })
                      },
                      '取消'
                    ),
                    h(
                      'button',
                      {
                        class: 'settings-button danger',
                        disabled: workspace.privacySettings.deactivateConfirmationInput.trim() !== 'DEACTIVATE' || workspace.privacySettings.deactivateLoading,
                        onClick: () => workspace.deactivateUserAccount()
                      },
                      workspace.privacySettings.deactivateLoading ? '停用中' : '停用账户'
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
          settingsPageTitle('关于', 'about'),
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
            h('small', 'Prepare a local diagnostics report for feedback.'),
            h('button', { class: 'settings-button', onClick: () => workspace.openSettingsExternalAction('反馈页面') }, [h(ExternalLink), 'Open Feedback Report'])
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
      const visibleSecrets = ref<Record<string, boolean>>({})
      const providerState = computed(() => workspace.modelProviders[props.provider])
      const checkLabel = computed(() => (workspace.modelCheckState[props.provider] === 'checking' ? 'Checking' : 'Check'))
      const openAiUrlPreview = computed(() => {
        if (props.provider !== 'openai') return ''
        const url = providerState.value.baseUrl.trim()
        if (!url) return ''
        let baseUrl = url
        const skipVersionPrefix = url.endsWith('#')
        if (skipVersionPrefix) {
          baseUrl = url.slice(0, -1)
        } else {
          let hasV1 = false
          try {
            hasV1 = new URL(url).pathname.split('/').filter(Boolean).some((segment) => /^v\d+$/i.test(segment))
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
      const field = (label: string, key: keyof typeof providerState.value, options: { type?: string; placeholder?: string; wide?: boolean } = {}) => {
        const secretKey = `${props.provider}:${String(key)}`
        const isPassword = options.type === 'password'
        const input = h('input', {
          class: 'settings-input',
          type: isPassword && visibleSecrets.value[secretKey] ? 'text' : options.type || 'text',
          value: providerState.value[key] as string,
          placeholder: options.placeholder,
          onChange: (event: Event) => update({ [key]: (event.target as HTMLInputElement).value })
        })
        return h('label', { class: ['provider-field', { wide: options.wide }] }, [
          h('span', label),
          isPassword
            ? h('div', { class: 'provider-secret-field' }, [
                input,
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'provider-secret-toggle',
                    title: visibleSecrets.value[secretKey] ? '隐藏明文' : '显示明文',
                    'aria-label': visibleSecrets.value[secretKey] ? '隐藏明文' : '显示明文',
                    'data-testid': `provider-secret-toggle-${props.provider}-${String(key)}`,
                    onClick: (event: Event) => {
                      event.preventDefault()
                      visibleSecrets.value = {
                        ...visibleSecrets.value,
                        [secretKey]: !visibleSecrets.value[secretKey]
                      }
                    }
                  },
                  [h(visibleSecrets.value[secretKey] ? EyeOff : Eye)]
                )
              ])
            : input
        ])
      }
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
                h('small', { class: 'provider-help' }, '末尾追加 # 可跳过自动 /v1 拼接。Codex CLI 只支持 Responses。'),
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
                h('small', { class: 'provider-help' }, '普通 AI 对话使用 Bedrock Runtime；Codex CLI 只支持 Amazon Bedrock 上的 OpenAI 模型 openai.gpt-5.5 / openai.gpt-5.4。'),
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
          props.provider === 'ollama'
            ? [field('Ollama Base URL', 'baseUrl', { placeholder: 'http://localhost:11434', wide: true }), h('small', { class: 'provider-help' }, 'Codex CLI 使用内置 ollama provider，地址会按 OpenAI-compatible /v1 路径传入。')]
            : null,
          props.provider === 'lmstudio'
            ? [
                field('LM Studio Base URL', 'baseUrl', { placeholder: 'http://localhost:1234', wide: true }),
                h('small', { class: 'provider-help' }, '需要 LM Studio 启用 OpenAI Compatible Server。Codex CLI 使用内置 lmstudio provider。')
              ]
            : null,
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

  return {
    AboutSettingsPage,
    AiPreferenceSettings,
    BillingSettingsPage,
    ExtensionSettingsPage,
    GeneralSettings,
    KeywordHighlightEditorPage,
    McpConfigEditorPage,
    McpSettingsPage,
    ModelSettings,
    OnboardingGuide,
    PrivacySettingsPage,
    RulesSettingsPage,
    SecurityConfigEditorPage,
    SettingsDocumentationReaderPage,
    SettingsPanel,
    ShortcutsSettingsPage,
    SkillsSettingsPage,
    TerminalSettings,
    TrustedDevicesSettingsPage,
    X,
    t,
    workspace,
  }
}
