import { defineComponent, h } from 'vue'
import { Monitor, Trash2, Upload } from 'lucide-vue-next'
import { settingsBackgroundPresets, settingsLanguageOptions } from '@/config/settings'
import { backgroundImageCss } from '@/services/app/backgroundRuntime'
import type { SettingsWorkspacePageContext, SettingsWorkspaceStore, SettingsWorkspaceTranslate } from '@/services/settings/settingsWorkspacePageContext'

export const createSettingsWorkspaceGeneralTerminalPages = (
  workspace: SettingsWorkspaceStore,
  t: SettingsWorkspaceTranslate,
  context: SettingsWorkspacePageContext
) => {
  const {
    cursorStyles,
    customBackgroundImage,
    hasSelectedBackgroundImage,
    numberRow,
    radioRow,
    restoreInputOnFailedSave,
    restoreSelectOnFailedSave,
    selectRow,
    settingsPageTitle,
    switchRow,
    terminalFonts,
    terminalTypes,
    themeGroups
  } = context

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
                      style: { backgroundImage: preset.css },
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
            ]),
            switchRow(
              t('settings.general.idleCleanup'),
              workspace.config.workspaceIdleCleanup?.enabled ?? false,
              (enabled) => workspace.saveConfig({
                workspaceIdleCleanup: {
                  enabled,
                  timeoutMinutes: workspace.config.workspaceIdleCleanup?.timeoutMinutes ?? 20
                }
              })
            ),
            numberRow(
              t('settings.general.idleCleanupTimeout'),
              workspace.config.workspaceIdleCleanup?.timeoutMinutes ?? 20,
              1,
              1440,
              (timeoutMinutes) => workspace.saveConfig({
                workspaceIdleCleanup: {
                  enabled: workspace.config.workspaceIdleCleanup?.enabled ?? false,
                  timeoutMinutes
                }
              })
            )
          ]),
          h('h3', t('settings.general.editor')),
          h('p', { class: 'settings-description' }, t('settings.general.editorScope')),
          h('div', { class: 'settings-form-card' }, [
            numberRow(
              t('settings.general.fontSize'),
              workspace.editorSettings.fontSize,
              8,
              32,
              (value) => workspace.updateEditorSettings({ fontSize: value }),
              1,
              false,
              'editor.fontSize'
            ),
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

  return {
    GeneralSettings,
    TerminalSettings
  }
}
