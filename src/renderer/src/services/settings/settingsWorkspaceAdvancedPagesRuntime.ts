import { computed, defineComponent, h } from 'vue'
import { BookOpen, Copy, ExternalLink, FolderOpen, MessageSquare, Play } from 'lucide-vue-next'
import { settingsSecretPatterns } from '@/config/settings'
import SettingsJsonEditor from '@/components/settings/SettingsJsonEditor.vue'
import type { SettingsWorkspacePageContext, SettingsWorkspaceStore, SettingsWorkspaceTranslate } from '@/services/settings/settingsWorkspacePageContext'
import type { ExportMcpClientStatus, ExportMcpServerId } from '@shared/contracts/exportMcp'

export const createSettingsWorkspaceAdvancedPages = (
  workspace: SettingsWorkspaceStore,
  t: SettingsWorkspaceTranslate,
  context: SettingsWorkspacePageContext
) => {
  const {
    automationSnippetRows,
    exportMcpInstallerRows,
    infoRow,
    mcpToolArgumentsPlaceholder,
    radioRow,
    renderMcpOperationResult,
    settingsPageTitle,
    switchRow
  } = context

  const ExtensionSettingsPage = defineComponent({
    name: 'ExtensionSettingsPage',
    setup() {
      return () =>
        h('div', [
          settingsPageTitle('扩展', 'extensions'),
          h('div', { class: 'settings-form-card' }, [
            switchRow('自动补全', workspace.extensionSettings.autoCompleteStatus, (checked) => workspace.updateExtensionSettings({ autoCompleteStatus: checked })),
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
              h('button', { class: 'settings-button', onClick: () => workspace.openSettingsPageDocumentation('commandSecurity') }, t('settings.ai.commandSecurity.help')),
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

  const ExportMcpSettingsPage = defineComponent({
    name: 'ExportMcpSettingsPage',
    setup() {
      void workspace.refreshExportMcpInstallers({ silent: true })
      const externalCodexMcpRows = automationSnippetRows.filter((item) => item.value.startsWith('AIOPSTERM_EXTERNAL_CODEX_MCP'))
      const tokenPlaceholder = '<aiopsterm-managed-token>'
      const socketPlaceholder = '<AIOPSTERM_EXTERNAL_CODEX_MCP_SOCKET>'
      const scriptPlaceholder = '<path-to-aiopsterm-external-codex-mcp.js>'
      const runtimePlaceholder = '<path-to-aiopsterm-executable>'
      const shellQuote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`
      const exportMcpServers: Array<{
        id: ExportMcpServerId
        name: string
        titleKey:
          | 'settings.ai.exportMcp.hostsTitle'
          | 'settings.ai.exportMcp.aiSessionsTitle'
          | 'settings.ai.exportMcp.databasesTitle'
        descriptionKey:
          | 'settings.ai.exportMcp.hostsDescription'
          | 'settings.ai.exportMcp.aiSessionsDescription'
          | 'settings.ai.exportMcp.databasesDescription'
        toolCount: number
      }> = [
        {
          id: 'hosts',
          name: 'aiopsterm_hosts',
          titleKey: 'settings.ai.exportMcp.hostsTitle',
          descriptionKey: 'settings.ai.exportMcp.hostsDescription',
          toolCount: 14
        },
        {
          id: 'ai-sessions',
          name: 'aiopsterm_ai_sessions',
          titleKey: 'settings.ai.exportMcp.aiSessionsTitle',
          descriptionKey: 'settings.ai.exportMcp.aiSessionsDescription',
          toolCount: 17
        },
        {
          id: 'databases',
          name: 'aiopsterm_databases',
          titleKey: 'settings.ai.exportMcp.databasesTitle',
          descriptionKey: 'settings.ai.exportMcp.databasesDescription',
          toolCount: 12
        }
      ]

      const manualTemplateState = () => {
        const rows = exportMcpInstallerRows()
        const bridge = workspace.exportMcpInstallerBridge || rows[0]?.bridge
        const scriptPath = rows.find((client) => client.scriptPath)?.scriptPath || scriptPlaceholder
        const runtimePath = rows.find((client) => client.runtimePath)?.runtimePath || runtimePlaceholder
        const socketPath = bridge?.socketPath || socketPlaceholder
        return { bridge, scriptPath, runtimePath, socketPath }
      }

      const manualJsonTemplate = (serverId: ExportMcpServerId, serverName: string) => {
        const { scriptPath, runtimePath, socketPath } = manualTemplateState()
        return JSON.stringify(
          {
            mcpServers: {
              [serverName]: {
                type: 'stdio',
                command: runtimePath,
                args: [scriptPath],
                env: {
                  ELECTRON_RUN_AS_NODE: '1',
                  AIOPSTERM_EXTERNAL_CODEX_MCP_SOCKET: socketPath,
                  AIOPSTERM_EXTERNAL_CODEX_MCP_TOKEN: tokenPlaceholder,
                  AIOPSTERM_EXTERNAL_CODEX_MCP_SCOPE: serverId
                }
              }
            }
          },
          null,
          2
        )
      }

      const manualCommandTemplate = (serverId: ExportMcpServerId) => {
        const { scriptPath, runtimePath, socketPath } = manualTemplateState()
        return [
          `ELECTRON_RUN_AS_NODE=${shellQuote('1')}`,
          `AIOPSTERM_EXTERNAL_CODEX_MCP_SOCKET=${shellQuote(socketPath)}`,
          `AIOPSTERM_EXTERNAL_CODEX_MCP_TOKEN=${shellQuote(tokenPlaceholder)}`,
          `AIOPSTERM_EXTERNAL_CODEX_MCP_SCOPE=${shellQuote(serverId)}`,
          shellQuote(runtimePath),
          shellQuote(scriptPath)
        ].join(' ')
      }

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

      const renderManualTemplateRow = (
        serverId: ExportMcpServerId,
        label: string,
        description: string,
        value: string,
        kind: 'json' | 'command'
      ) =>
        h('div', { class: 'automation-snippet-row export-mcp-copy-row' }, [
          h('div', [
            h('strong', label),
            h('small', description),
            h('code', value)
          ]),
          h(
            'button',
            {
              class: 'settings-button icon-button',
              title: label,
              onClick: () => workspace.copyExportMcpConfig(serverId, kind)
            },
            [h(Copy)]
          )
        ])

      const resetToken = () => {
        if (!window.confirm(t('settings.ai.exportMcp.resetTokenConfirm'))) return
        void workspace.resetExportMcpToken()
      }

      const updateAgentSshAuthSubmit = (checked: boolean) =>
        workspace.saveConfig({
          exportMcp: {
            allowDatabaseRead: workspace.config.exportMcp?.allowDatabaseRead === true,
            allowAgentSshAuthSubmit: checked
          }
        })

      const renderAgentSshAuthSubmit = () =>
        h('div', { class: 'export-mcp-auth-toggle' }, [
          h('div', [
            h('strong', t('settings.ai.exportMcp.agentSshAuthSubmitTitle')),
            h('small', t('settings.ai.exportMcp.agentSshAuthSubmitDescription')),
            h('em', t('settings.ai.exportMcp.agentSshAuthSubmitWarning'))
          ]),
          h('label', { class: 'settings-switch' }, [
            h('input', {
              type: 'checkbox',
              checked: workspace.config.exportMcp?.allowAgentSshAuthSubmit === true,
              onChange: async (event: Event) => {
                const input = event.target as HTMLInputElement
                const checked = input.checked
                await updateAgentSshAuthSubmit(checked)
                input.checked = workspace.config.exportMcp?.allowAgentSshAuthSubmit === true
              }
            }),
            h('span')
          ])
        ])

      const updateDatabaseRead = (checked: boolean) =>
        workspace.saveConfig({
          exportMcp: {
            allowAgentSshAuthSubmit: workspace.config.exportMcp?.allowAgentSshAuthSubmit === true,
            allowDatabaseRead: checked
          }
        })

      const renderDatabaseRead = () =>
        h('div', { class: 'export-mcp-auth-toggle' }, [
          h('div', [
            h('strong', t('settings.ai.exportMcp.databaseReadTitle')),
            h('small', t('settings.ai.exportMcp.databaseReadDescription')),
            h('em', t('settings.ai.exportMcp.databaseReadWarning'))
          ]),
          h('label', { class: 'settings-switch' }, [
            h('input', {
              type: 'checkbox',
              checked: workspace.config.exportMcp?.allowDatabaseRead === true,
              onChange: async (event: Event) => {
                const input = event.target as HTMLInputElement
                const checked = input.checked
                await updateDatabaseRead(checked)
                input.checked = workspace.config.exportMcp?.allowDatabaseRead === true
              }
            }),
            h('span')
          ])
        ])

      const renderStatusPill = (client: ExportMcpClientStatus) =>
        h(
          'span',
          {
            class: ['agent-hook-status-pill', client.installed ? 'installed' : client.error ? 'error' : client.binaryPath && client.bridge.tokenConfigured ? 'ready' : 'missing']
          },
          client.installed
            ? t('settings.ai.exportMcp.installed')
            : client.error
              ? t('settings.ai.exportMcp.configError')
              : client.binaryPath && client.bridge.tokenConfigured
                ? t('settings.ai.exportMcp.ready')
                : t('settings.ai.exportMcp.notReady')
        )

      const renderMeta = (label: string, value: string) =>
        h('div', { class: 'agent-hook-meta-row' }, [
          h('span', label),
          h('code', { title: value || t('settings.ai.exportMcp.detectedMissing') }, value || t('settings.ai.exportMcp.detectedMissing'))
        ])

      const renderBridgeStatus = () => {
        const bridge = workspace.exportMcpInstallerBridge || exportMcpInstallerRows()[0]?.bridge
        return h('div', { class: 'export-mcp-bridge-summary' }, [
          renderMeta(t('settings.ai.exportMcp.socket'), bridge?.socketPath || ''),
          renderMeta(t('settings.ai.exportMcp.service'), bridge?.enabled ? (bridge.listening ? t('settings.ai.exportMcp.listening') : t('settings.ai.exportMcp.enabledNotListening')) : t('settings.ai.exportMcp.disabled')),
          renderMeta(t('settings.ai.exportMcp.token'), bridge?.tokenConfigured ? t('settings.ai.exportMcp.configured') : t('settings.ai.exportMcp.missing'))
        ])
      }

      const renderInstaller = (client: ExportMcpClientStatus) => {
        const busy = workspace.exportMcpInstallerBusySource === `${client.serverId}:${client.source}`
        const baseDisabled = busy || workspace.exportMcpInstallersLoading || !client.scriptPath || !client.binaryPath
        const installDisabled = baseDisabled || !client.bridge.tokenConfigured
        return h('article', { class: 'agent-hook-installer-row export-mcp-installer-row' }, [
          h('div', { class: 'agent-hook-installer-main' }, [
            h('header', [
              h('div', [h('strong', client.label), h('small', `${t('settings.ai.agentHook.launchCommand')}: ${client.binaryName}`)]),
              renderStatusPill(client)
            ]),
            h('p', { class: 'agent-hook-description' }, t('settings.ai.exportMcp.clientDescription')),
            h('div', { class: 'agent-hook-meta-grid' }, [
              renderMeta('CLI', client.binaryPath),
              renderMeta(t('settings.ai.exportMcp.config'), client.configPath),
              renderMeta(t('settings.ai.exportMcp.serverName'), client.serverName),
              renderMeta(t('settings.ai.exportMcp.helper'), client.scriptPath)
            ]),
            client.error ? h('p', { class: 'agent-hook-error' }, client.error) : null,
            client.warnings.length ? h('ul', { class: 'agent-hook-warnings' }, client.warnings.map((warning) => h('li', warning))) : null
          ]),
          h('div', { class: 'agent-hook-installer-actions' }, [
            h(
              'button',
              {
                class: ['settings-button', client.installed ? '' : 'primary'],
                disabled: installDisabled,
                onClick: () => workspace.installExportMcpInstaller(client.source, client.serverId)
              },
              busy ? t('common.processing') : client.installed ? t('common.reinstall') : t('common.install')
            ),
            h(
              'button',
              {
                class: 'settings-button danger',
                disabled: baseDisabled || !client.installed,
                onClick: () => workspace.uninstallExportMcpInstaller(client.source, client.serverId)
              },
              t('common.uninstall')
            )
          ])
        ])
      }

      const renderServerCard = (server: (typeof exportMcpServers)[number]) => {
        const installers = exportMcpInstallerRows().filter((client) => client.serverId === server.id)
        return h('div', { class: 'settings-section-card agent-hook-installer-card export-mcp-card external-codex-mcp-card' }, [
          h('header', { class: 'agent-hook-card-header' }, [
            h('div', [
              h('strong', t(server.titleKey)),
              h('small', t(server.descriptionKey)),
              h('code', server.name),
              h('small', t('settings.ai.exportMcp.toolCount', { count: server.toolCount }))
            ])
          ]),
          server.id === 'hosts' ? renderAgentSshAuthSubmit() : null,
          server.id === 'databases' ? renderDatabaseRead() : null,
          ...installers.map((client) => renderInstaller(client)),
          h('div', { class: 'export-mcp-manual-config' }, [
            h('strong', t('settings.ai.exportMcp.manualTitle')),
            h('small', t('settings.ai.exportMcp.manualTokenNotice')),
            renderManualTemplateRow(
              server.id,
              t('settings.ai.exportMcp.copyJsonTemplate'),
              t('settings.ai.exportMcp.copyJsonTemplateDescription'),
              manualJsonTemplate(server.id, server.name),
              'json'
            ),
            renderManualTemplateRow(
              server.id,
              t('settings.ai.exportMcp.copyCommandTemplate'),
              t('settings.ai.exportMcp.copyCommandTemplateDescription'),
              manualCommandTemplate(server.id),
              'command'
            )
          ])
        ])
      }

      return () =>
        h('div', [
          h('div', { class: 'settings-section-title-row' }, [
            h('div', { class: 'settings-section-title-with-help' }, [
              settingsPageTitle(t('settings.ai.exportMcp.title'), 'exportMcp', { compact: true }),
              h('small', t('settings.ai.exportMcp.subtitle'))
            ]),
            h(
              'button',
              {
                class: 'settings-button',
                disabled: workspace.exportMcpInstallersLoading,
                onClick: () => workspace.refreshExportMcpInstallers()
              },
              workspace.exportMcpInstallersLoading ? t('common.refreshing') : t('common.refresh')
            )
          ]),
          h('div', { class: 'settings-section-card agent-hook-installer-card export-mcp-card' }, [
            h('header', { class: 'agent-hook-card-header' }, [
              h('div', [
                h('strong', t('settings.ai.exportMcp.installerTitle')),
                h('small', t('settings.ai.exportMcp.installerSubtitle'))
              ]),
              h('div', { class: 'export-mcp-card-actions' }, [
                h(
                  'button',
                  {
                    class: 'settings-button danger export-mcp-docs-button',
                    disabled: workspace.exportMcpInstallersLoading,
                    title: t('settings.ai.exportMcp.resetTokenDescription'),
                    onClick: resetToken
                  },
                  t('settings.ai.exportMcp.resetToken')
                ),
                h(
                  'button',
                  {
                    class: 'settings-button export-mcp-docs-button',
                    onClick: () => workspace.openSettingsDocumentationFile('technical/external-codex-mcp.md')
                  },
                  t('settings.ai.automation.externalCodexMcpDocs')
                )
              ])
            ]),
            workspace.exportMcpInstallerError ? h('p', { class: 'agent-hook-error' }, workspace.exportMcpInstallerError) : null,
            renderBridgeStatus()
          ]),
          ...exportMcpServers.map((server) => renderServerCard(server)),
          h('div', { class: 'settings-section-card automation-settings-card export-mcp-snippets-card' }, [
            h('p', { class: 'setting-description-no-padding' }, t('settings.ai.exportMcp.envDescription')),
            ...externalCodexMcpRows.map((item) => renderSnippet(item))
          ])
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
            h('p', { class: 'settings-description' }, '默认发送匿名安装和每日活跃信息，不包含终端内容、命令、路径或日志。可随时关闭。'),
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
            h('small', 'Prepare a local diagnostics report, review it, and submit an issue manually.'),
            h('button', { class: 'settings-button', onClick: () => workspace.openSettingsExternalAction('反馈页面') }, [h(ExternalLink), 'Prepare Report and Open Issue'])
          ]),
          h('div', { class: 'settings-section-card diagnostics-card' }, [
            h('div', { class: 'diagnostics-card-header' }, [h(ExternalLink, { class: 'diagnostics-icon' }), h('strong', 'Official Links')]),
            h('small', 'Website, documentation, community, support, security, and privacy resources.'),
            h('div', { class: 'settings-action-row' }, [
              h('button', { class: 'settings-button', onClick: () => window.aiops.openOfficialExternalLink('website') }, 'Website'),
              h('button', { class: 'settings-button', onClick: () => window.aiops.openOfficialExternalLink('documentation') }, 'Documentation'),
              h('button', { class: 'settings-button', onClick: () => window.aiops.openOfficialExternalLink('discussions') }, 'Discussions'),
              h('button', { class: 'settings-button', onClick: () => window.aiops.openOfficialExternalLink('discord') }, 'Discord'),
              h('button', { class: 'settings-button', onClick: () => window.aiops.openOfficialExternalLink('wechat') }, 'WeChat'),
              h('button', { class: 'settings-button', onClick: () => window.aiops.openOfficialExternalLink('supportEmail') }, 'Support'),
              h('button', { class: 'settings-button', onClick: () => window.aiops.openOfficialExternalLink('securityEmail') }, 'Security'),
              h('button', { class: 'settings-button', onClick: () => window.aiops.openOfficialExternalLink('privacyPolicy') }, 'Privacy')
            ])
          ])
        ])
    }
  })

  return {
    AboutSettingsPage,
    BillingSettingsPage,
    ExtensionSettingsPage,
    ExportMcpSettingsPage,
    KeywordHighlightEditorPage,
    McpConfigEditorPage,
    McpSettingsPage,
    PrivacySettingsPage,
    RulesSettingsPage,
    SecurityConfigEditorPage,
    ShortcutsSettingsPage,
    SkillsSettingsPage,
    TrustedDevicesSettingsPage
  }
}
