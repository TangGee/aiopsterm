import { computed, defineComponent, h, reactive, ref, watch } from 'vue'
import { FileSearch, LoaderCircle, X } from 'lucide-vue-next'
import { localFilesClient } from '@/services/app/localFilesClient'
import { useWorkspaceStore } from '@/stores/workspace'
import type { KubernetesAgentProxyConfig, KubernetesConnectionStatus, KubernetesImportContextInfo } from '@shared/contracts/kubernetes'

const proxyTypes: Array<KubernetesAgentProxyConfig['type']> = ['HTTP', 'HTTPS', 'SOCKS4', 'SOCKS5']

const updateInputValue = (event: Event) => (event.target as HTMLInputElement).value
const updateTextareaValue = (event: Event) => (event.target as HTMLTextAreaElement).value
const updateCheckedValue = (event: Event) => (event.target as HTMLInputElement).checked
const updateSelectValue = (event: Event) => (event.target as HTMLSelectElement).value

export const K8sStatusTag = defineComponent({
  name: 'K8sStatusTag',
  props: {
    status: { type: String, required: true }
  },
  setup(props) {
    const label = () => {
      if (props.status === 'connected') return 'Connected'
      if (props.status === 'connecting') return 'Connecting'
      if (props.status === 'error') return 'Error'
      return 'Disconnected'
    }
    return () => h('span', { class: ['k8s-status-tag', props.status] }, label())
  }
})

export const K8sAddClusterModal = defineComponent({
  name: 'K8sAddClusterModal',
  setup() {
    const store = useWorkspaceStore()
    const importing = ref(false)
    const testing = ref(false)
    const saving = ref(false)
    const formError = ref('')
    const firstImportContext = store.k8sImportContexts[0]
    const form = reactive({
      kubeconfigPath: '~/.kube/config',
      contextName: firstImportContext?.name || '',
      name: firstImportContext?.cluster || '',
      serverUrl: firstImportContext?.server || '',
      defaultNamespace: 'default',
      kubeconfigContent: ''
    })

    const applyContext = (contextName: string) => {
      const context = store.selectK8sImportContext(contextName)
      form.contextName = contextName
      if (!context) return
      form.name = context.cluster
      form.serverUrl = context.server
      form.defaultNamespace = context.namespace || 'default'
    }

    const applyImportedContexts = (contexts: KubernetesImportContextInfo[] = store.k8sImportContexts) => {
      const current = contexts.find((context) => context.name === form.contextName) || contexts[0]
      if (current) applyContext(current.name)
    }

    const browseKubeconfig = async () => {
      formError.value = ''
      const showOpenDialog = localFilesClient.showOpenDialog()
      if (!showOpenDialog) {
        formError.value = 'Kubeconfig 文件选择服务不可用'
        return
      }
      const result = await showOpenDialog({
        defaultPath: form.kubeconfigPath.includes('/') ? form.kubeconfigPath.slice(0, form.kubeconfigPath.lastIndexOf('/')) : undefined,
        properties: ['openFile'],
        filters: [
          { name: 'All Files', extensions: ['*'] },
          { name: 'YAML Files', extensions: ['yaml', 'yml'] }
        ]
      })
      if (!result || result.canceled || !result.filePaths.length) return
      form.kubeconfigPath = result.filePaths[0]
      importing.value = true
      store.updateK8sUiState({ testResult: null })
      const importResult = await store.importK8sKubeconfigFile(form.kubeconfigPath)
      importing.value = false
      if (!importResult.success) {
        formError.value = importResult.error || 'Kubeconfig 导入失败'
        return
      }
      form.kubeconfigContent = importResult.kubeconfigContent
      applyImportedContexts(importResult.contexts)
    }

    const switchAddMode = (mode: 'import' | 'manual') => {
      store.updateK8sUiState({ addMode: mode, testResult: null })
      formError.value = ''
      if (mode === 'import') {
        const context = store.k8sImportContexts[0]
        if (context) applyContext(context.name)
        return
      }
      form.contextName = ''
      form.name = ''
      form.serverUrl = ''
      form.defaultNamespace = 'default'
      form.kubeconfigContent = ''
    }

    const hydrateManualKubeconfig = async () => {
      if (store.k8sAddMode !== 'manual' || !form.kubeconfigContent.trim()) return true
      const parsed = await store.importK8sKubeconfigContent(form.kubeconfigContent)
      if (!parsed.success) {
        formError.value = parsed.error || 'Kubeconfig 导入失败'
        return false
      }
      applyImportedContexts(parsed.contexts)
      return true
    }

    const validateForm = () => {
      if (store.k8sAddMode === 'import') {
        if (!form.kubeconfigPath.trim() || !form.contextName.trim()) return '请选择 kubeconfig 文件和 Context'
        if (!form.name.trim() || !form.serverUrl.trim()) return '请补全集群名称和 Server URL'
        return ''
      }
      if (!form.kubeconfigContent.trim()) return '请输入 kubeconfig 内容，或通过导入模式选择 kubeconfig 文件'
      if (!form.name.trim() || !form.contextName.trim() || !form.serverUrl.trim()) return '请补全集群名称、Context Name 和 Server URL'
      return ''
    }

    const testConnection = async () => {
      formError.value = ''
      if (!(await hydrateManualKubeconfig())) {
        store.updateK8sUiState({ testResult: false, clusterNotice: formError.value })
        return
      }
      const error = validateForm()
      if (error) {
        formError.value = error
        store.updateK8sUiState({ testResult: false, clusterNotice: error })
        return
      }
      testing.value = true
      try {
        await store.testK8sClusterConnection({
          contextName: form.contextName,
          serverUrl: form.serverUrl,
          kubeconfigPath: store.k8sAddMode === 'import' ? form.kubeconfigPath : null,
          kubeconfigContent: form.kubeconfigContent || null
        })
      } finally {
        testing.value = false
      }
    }

    const submit = async () => {
      if (!(await hydrateManualKubeconfig())) {
        store.updateK8sUiState({ clusterNotice: formError.value })
        return
      }
      formError.value = validateForm()
      if (formError.value) {
        store.updateK8sUiState({ clusterNotice: formError.value })
        return
      }
      saving.value = true
      try {
        await store.addK8sCluster({
          name: form.name,
          contextName: form.contextName,
          serverUrl: form.serverUrl,
          defaultNamespace: form.defaultNamespace,
          kubeconfigPath: store.k8sAddMode === 'import' ? form.kubeconfigPath : null,
          kubeconfigContent: store.k8sAddMode === 'manual' ? form.kubeconfigContent : null
        })
      } finally {
        saving.value = false
      }
    }

    return () =>
      h('div', { class: 'file-modal' }, [
        h('div', { class: 'file-modal-card k8s-add-cluster-modal' }, [
          h('header', [
            h('strong', '添加集群'),
            h(
              'button',
              {
                title: '关闭',
                onClick: () => {
                  store.updateK8sUiState({ addModalOpen: false })
                }
              },
              [h(X)]
            )
          ]),
          h('div', { class: 'k8s-modal-tabs' }, [
            h(
              'button',
              {
                class: { active: store.k8sAddMode === 'import' },
                onClick: () => switchAddMode('import')
              },
              '导入 Kubeconfig'
            ),
            h(
              'button',
              {
                class: { active: store.k8sAddMode === 'manual' },
                onClick: () => switchAddMode('manual')
              },
              '手动配置'
            )
          ]),
          h('div', { class: 'k8s-modal-form' }, [
            store.k8sAddMode === 'import'
              ? h('div', { class: 'k8s-file-picker-row' }, [
                  h('label', [h('span', 'Kubeconfig 文件'), h('input', { value: form.kubeconfigPath, readonly: true })]),
                  h(
                    'button',
                    {
                      title: '浏览',
                      disabled: importing.value,
                      onClick: browseKubeconfig
                    },
                    [importing.value ? h(LoaderCircle) : h(FileSearch), h('span', importing.value ? '导入中' : '浏览')]
                  )
                ])
              : h('label', [
                  h('span', 'Kubeconfig 内容'),
                  h('textarea', {
                    value: form.kubeconfigContent,
                    rows: 5,
                    onInput: (event: Event) => {
                      form.kubeconfigContent = updateTextareaValue(event)
                    }
                  })
                ]),
            store.k8sAddMode === 'import' && store.k8sImportContexts.length
              ? h('label', [
                  h('span', 'Context'),
                  h(
                    'select',
                    {
                      value: form.contextName,
                      onChange: (event: Event) => applyContext(updateSelectValue(event))
                    },
                    store.k8sImportContexts.map((context) => h('option', { key: context.name, value: context.name }, `${context.name} (${context.cluster})`))
                  )
                ])
              : null,
            h('label', [
              h('span', '集群名称'),
              h('input', {
                value: form.name,
                onInput: (event: Event) => {
                  form.name = updateInputValue(event)
                }
              })
            ]),
            h('label', [
              h('span', 'Context Name'),
              h('input', {
                value: form.contextName,
                onInput: (event: Event) => {
                  form.contextName = updateInputValue(event)
                }
              })
            ]),
            h('label', [
              h('span', 'Server URL'),
              h('input', {
                value: form.serverUrl,
                onInput: (event: Event) => {
                  form.serverUrl = updateInputValue(event)
                }
              })
            ]),
            h('label', [
              h('span', '默认 Namespace'),
              h('input', {
                value: form.defaultNamespace,
                onInput: (event: Event) => {
                  form.defaultNamespace = updateInputValue(event)
                }
              })
            ])
          ]),
          formError.value ? h('p', { class: 'k8s-form-error' }, formError.value) : null,
          h('div', { class: 'k8s-test-connection' }, [
            h(
              'button',
              {
                disabled: importing.value || testing.value,
                onClick: testConnection
              },
              testing.value ? '测试中' : '测试连接'
            ),
            store.k8sTestResult === null
              ? null
              : h('span', { class: store.k8sTestResult ? 'success' : 'error' }, store.k8sTestResult ? '连接成功' : '连接失败')
          ]),
          h('footer', [
            h('button', { onClick: () => store.updateK8sUiState({ addModalOpen: false }) }, '取消'),
            h('button', { class: 'primary', disabled: importing.value || saving.value, onClick: submit }, saving.value ? '保存中' : '保存')
          ])
        ])
      ])
  }
})

export const K8sEditClusterModal = defineComponent({
  name: 'K8sEditClusterModal',
  setup() {
    const store = useWorkspaceStore()
    const cluster = computed(() => store.k8sClusters.find((item) => item.id === store.k8sEditingClusterId) || null)
    const form = reactive({ name: '', defaultNamespace: '', autoConnect: false, kubeconfigPath: '', kubeconfigContent: '' })
    const supportsKubeconfig = computed(() => Boolean(cluster.value && cluster.value.source_type !== 'jumpserver' && cluster.value.auth_type !== 'jumpserver'))
    watch(
      cluster,
      (value) => {
        if (!value) return
        form.name = value.name
        form.defaultNamespace = value.default_namespace
        form.autoConnect = value.auto_connect === 1
        form.kubeconfigPath = value.kubeconfig_path || ''
        form.kubeconfigContent = value.kubeconfig_content || ''
      },
      { immediate: true }
    )
    const submit = async () => {
      if (!cluster.value) return
      const patch: Parameters<typeof store.updateK8sCluster>[1] = {
        name: form.name,
        defaultNamespace: form.defaultNamespace,
        autoConnect: form.autoConnect
      }
      // 仅当字段实际变化时才提交,undefined 表示保持后端原值(证书轮换只改动到的那一项)。
      if (supportsKubeconfig.value) {
        if (form.kubeconfigPath !== (cluster.value.kubeconfig_path || '')) patch.kubeconfigPath = form.kubeconfigPath.trim() || null
        if (form.kubeconfigContent !== (cluster.value.kubeconfig_content || '')) patch.kubeconfigContent = form.kubeconfigContent.trim() ? form.kubeconfigContent : null
      }
      await store.updateK8sCluster(cluster.value.id, patch)
    }
    return () =>
      cluster.value
        ? h('div', { class: 'file-modal' }, [
            h('div', { class: 'file-modal-card k8s-edit-cluster-modal' }, [
              h('header', [
                h('strong', '集群设置'),
                h(
                  'button',
                  {
                    title: '关闭',
                    onClick: () => {
                      store.updateK8sUiState({ editModalOpen: false })
                    }
                  },
                  [h(X)]
                )
              ]),
              h('div', { class: 'k8s-modal-form' }, [
                h('label', [
                  h('span', '集群名称'),
                  h('input', {
                    value: form.name,
                    onInput: (event: Event) => {
                      form.name = updateInputValue(event)
                    }
                  })
                ]),
                h('label', [h('span', 'Context Name'), h('input', { value: cluster.value.context_name, disabled: true })]),
                h('label', [h('span', 'Server URL'), h('input', { value: cluster.value.server_url, disabled: true })]),
                h('label', [
                  h('span', '默认 Namespace'),
                  h('input', {
                    value: form.defaultNamespace,
                    onInput: (event: Event) => {
                      form.defaultNamespace = updateInputValue(event)
                    }
                  })
                ]),
                h('label', { class: 'k8s-switch-row' }, [
                  h('span', '自动连接'),
                  h('input', {
                    type: 'checkbox',
                    checked: form.autoConnect,
                    onInput: (event: Event) => {
                      form.autoConnect = updateCheckedValue(event)
                    }
                  })
                ]),
                supportsKubeconfig.value
                  ? h('label', [
                      h('span', 'Kubeconfig 路径'),
                      h('input', {
                        value: form.kubeconfigPath,
                        placeholder: '~/.kube/config',
                        onInput: (event: Event) => {
                          form.kubeconfigPath = updateInputValue(event)
                        }
                      })
                    ])
                  : null,
                supportsKubeconfig.value
                  ? h('label', [
                      h('span', 'Kubeconfig 内容'),
                      h('textarea', {
                        value: form.kubeconfigContent,
                        rows: 6,
                        placeholder: '粘贴 kubeconfig 内容以替换(留空则使用路径)',
                        onInput: (event: Event) => {
                          form.kubeconfigContent = updateTextareaValue(event)
                        }
                      })
                    ])
                  : null,
                h('div', { class: 'k8s-form-status' }, [h('span', '连接状态'), h(K8sStatusTag, { status: cluster.value.connection_status as KubernetesConnectionStatus })])
              ]),
              h('footer', [
                h('button', { onClick: () => store.updateK8sUiState({ editModalOpen: false }) }, '取消'),
                h('button', { class: 'primary', onClick: submit }, '保存')
              ])
            ])
          ])
        : null
  }
})

export const K8sProxyConfigModal = defineComponent({
  name: 'K8sProxyConfigModal',
  setup() {
    const store = useWorkspaceStore()
    return () =>
      h('div', { class: 'file-modal' }, [
        h('div', { class: 'file-modal-card small k8s-proxy-config-modal' }, [
          h('header', [
            h('strong', 'Kubernetes Agent 代理设置'),
            h(
              'button',
              {
                title: '关闭',
                onClick: store.closeK8sProxyConfig
              },
              [h(X)]
            )
          ]),
          h('div', { class: 'k8s-modal-form' }, [
            h('label', { class: 'k8s-switch-row' }, [
              h('span', '启用代理'),
              h('input', {
                type: 'checkbox',
                checked: store.k8sProxyConfig.enabled,
                onInput: (event: Event) => store.updateK8sProxyConfig({ enabled: updateCheckedValue(event) })
              })
            ]),
            h('label', [
              h('span', '代理类型'),
              h(
                'select',
                {
                  value: store.k8sProxyConfig.type,
                  disabled: !store.k8sProxyConfig.enabled,
                  onChange: (event: Event) => store.updateK8sProxyConfig({ type: updateSelectValue(event) as KubernetesAgentProxyConfig['type'] })
                },
                proxyTypes.map((type) => h('option', { value: type }, type))
              )
            ]),
            h('label', [
              h('span', '代理主机'),
              h('input', {
                value: store.k8sProxyConfig.host,
                disabled: !store.k8sProxyConfig.enabled,
                onInput: (event: Event) => store.updateK8sProxyConfig({ host: updateInputValue(event) })
              })
            ]),
            h('label', [
              h('span', '代理端口'),
              h('input', {
                type: 'number',
                min: 1,
                max: 65535,
                value: store.k8sProxyConfig.port,
                disabled: !store.k8sProxyConfig.enabled,
                onInput: (event: Event) => store.updateK8sProxyConfig({ port: Number(updateInputValue(event)) })
              })
            ]),
            h('label', { class: 'k8s-switch-row' }, [
              h('span', '代理身份'),
              h('input', {
                type: 'checkbox',
                checked: store.k8sProxyConfig.enableProxyIdentity,
                disabled: !store.k8sProxyConfig.enabled,
                onInput: (event: Event) => store.updateK8sProxyConfig({ enableProxyIdentity: updateCheckedValue(event) })
              })
            ]),
            store.k8sProxyConfig.enabled && store.k8sProxyConfig.enableProxyIdentity
              ? [
                  h('label', [
                    h('span', '用户名'),
                    h('input', {
                      value: store.k8sProxyConfig.username,
                      onInput: (event: Event) => store.updateK8sProxyConfig({ username: updateInputValue(event) })
                    })
                  ]),
                  h('label', [
                    h('span', '密码'),
                    h('input', {
                      type: 'password',
                      value: store.k8sProxyConfig.password,
                      onInput: (event: Event) => store.updateK8sProxyConfig({ password: updateInputValue(event) })
                    })
                  ])
                ]
              : null
          ]),
          h('p', { class: 'k8s-proxy-hint' }, '连接集群时会把该代理配置应用到本地 Kubernetes Agent 配置状态。'),
          h('footer', [
            h('button', { onClick: store.closeK8sProxyConfig }, '取消'),
            h('button', { class: 'primary', onClick: store.saveK8sProxyConfig }, '保存')
          ])
        ])
      ])
  }
})

export const K8sDeleteConfirmModal = defineComponent({
  name: 'K8sDeleteConfirmModal',
  setup() {
    const store = useWorkspaceStore()
    return () =>
      store.k8sDeleteConfirmCluster
        ? h('div', { class: 'file-modal' }, [
            h('div', { class: 'file-modal-card small k8s-delete-confirm' }, [
              h('header', [
                h('strong', '删除集群'),
                h(
                  'button',
                  {
                    title: '关闭',
                    onClick: store.cancelDeleteK8sCluster
                  },
                  [h(X)]
                )
              ]),
              h('p', [h('span', '确定删除集群 '), h('strong', store.k8sDeleteConfirmCluster.name), h('span', ' 吗？')]),
              h('p', '关联的 Kubernetes 终端标签和本地 context 记录会一并移除。'),
              h('footer', [
                h('button', { onClick: store.cancelDeleteK8sCluster }, '取消'),
                h('button', { class: 'danger', onClick: store.confirmDeleteK8sCluster }, '删除')
              ])
            ])
          ])
        : null
  }
})
