import { computed, defineComponent, h, ref } from 'vue'
import { Brain, Copy, Eye, EyeOff, LockKeyhole, X } from 'lucide-vue-next'
import type { AgentHookInstallerStatus } from '@shared/contracts/agentHooks'
import type { SettingsModelProviderKey, SettingsWorkspacePageContext, SettingsWorkspaceStore, SettingsWorkspaceTranslate } from '@/services/settings/settingsWorkspacePageContext'

export const createSettingsWorkspaceModelAiPages = (
  workspace: SettingsWorkspaceStore,
  t: SettingsWorkspaceTranslate,
  context: SettingsWorkspacePageContext
) => {
  const {
    SettingsCheckbox,
    agentHibernationLimits,
    agentHookInstallerRows,
    automationSnippetRows,
    awsRegionOptions,
    displayModelLabel,
    modelProviderCards,
    modelProviderLabels,
    numberRow,
    providerConfigSummary,
    restoreCheckboxOnFailedSave,
    restoreInputOnFailedSave,
    restoreSelectOnFailedSave,
    selectRow,
    settingsPageTitle
  } = context

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

  return {
    AiPreferenceSettings,
    ModelSettings
  }
}
