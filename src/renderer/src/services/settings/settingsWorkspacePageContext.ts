import { computed, defineComponent, h } from 'vue'
import { CircleHelp } from 'lucide-vue-next'
import { settingsThemeOptions } from '@/config/settings'
import type { useWorkspaceStore } from '@/stores/workspace'
import { renderMarkdownDocumentHtml } from '@/services/common/markdownRuntime'
import type { I18nKey } from '@/i18n'
import type { AgentHookInstallerStatus } from '@shared/contracts/agentHooks'
import type { ExportMcpBridgeStatus, ExportMcpClientStatus } from '@shared/contracts/exportMcp'
import type { SettingsDocumentationPage } from '@shared/contracts/appRuntime'

export type SettingsWorkspaceStore = ReturnType<typeof useWorkspaceStore>
export type SettingsWorkspaceTranslate = (key: I18nKey, params?: Record<string, string | number>) => string
export type SettingsModelProviderKey = 'litellm' | 'openai' | 'bedrock' | 'deepseek' | 'anthropic' | 'ollama' | 'lmstudio'
export type PersistResult = void | boolean | Promise<void | boolean>

export const createSettingsWorkspacePageContext = (workspace: SettingsWorkspaceStore, t: SettingsWorkspaceTranslate) => {
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

  const exportMcpBridgeFallback: ExportMcpBridgeStatus = {
    enabled: false,
    listening: false,
    tokenConfigured: false,
    socketPath: '',
    serverName: 'aiopsterm_hosts'
  }

  const exportMcpInstallerFallbacks: ExportMcpClientStatus[] = [
    {
      source: 'codex',
      label: 'Codex',
      binaryName: 'codex',
      binaryPath: '',
      configPath: '~/.codex/config.toml',
      configExists: false,
      installed: false,
      scriptPath: '',
      runtimePath: '',
      serverName: 'aiopsterm_hosts',
      bridge: exportMcpBridgeFallback,
      warnings: []
    },
    {
      source: 'claude-code',
      label: 'Claude Code',
      binaryName: 'claude',
      binaryPath: '',
      configPath: '~/.claude.json',
      configExists: false,
      installed: false,
      scriptPath: '',
      runtimePath: '',
      serverName: 'aiopsterm_hosts',
      bridge: exportMcpBridgeFallback,
      warnings: []
    }
  ]

  const exportMcpInstallerRows = () =>
    exportMcpInstallerFallbacks.map((fallback) => {
      const client = workspace.exportMcpInstallers.find((installer) => installer.source === fallback.source)
      if (client) return client
      const bridge = workspace.exportMcpInstallerBridge || exportMcpBridgeFallback
      return { ...fallback, bridge, warnings: [t('settings.ai.exportMcp.statusNotLoaded')] }
    })

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
      value: 'aio list-notifications'
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
    SettingsCheckbox,
    SettingsDocumentationReaderPage,
    SettingsPageHelpButton,
    agentHibernationLimits,
    agentHookInstallerRows,
    automationSnippetRows,
    awsRegionOptions,
    cursorStyles,
    customBackgroundImage,
    displayModelLabel,
    exportMcpInstallerRows,
    hasSelectedBackgroundImage,
    infoRow,
    mcpToolArgumentsPlaceholder,
    modelProviderCards,
    modelProviderLabels,
    numberRow,
    providerConfigSummary,
    radioRow,
    renderMcpOperationResult,
    restoreCheckboxOnFailedSave,
    restoreInputOnFailedSave,
    restoreSelectOnFailedSave,
    selectRow,
    settingsPageTitle,
    switchRow,
    terminalFonts,
    terminalTypes,
    themeGroups
  }
}

export type SettingsWorkspacePageContext = ReturnType<typeof createSettingsWorkspacePageContext>
