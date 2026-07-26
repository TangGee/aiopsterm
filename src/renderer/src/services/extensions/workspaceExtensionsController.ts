import { computed, ref, type Ref } from 'vue'
import {
  isExtensionInstallProgressData,
  isExtensionPluginCancelData,
  isExtensionPluginListData,
  isExtensionPluginOperationData,
  isExtensionSubscriptionData,
  malformedExtensionBackendResultMessage
} from '@/services/extensions/extensionBackendGuards'
import { extensionsClient } from '@/services/extensions/extensionsClient'
import type {
  ExtensionInstallProgress as BackendExtensionInstallProgress,
  ExtensionInstallStage,
  ExtensionPluginOperation,
  ExtensionPluginRuntimeConfig
} from '@shared/contracts/extensions'

export type WorkspaceExtensionInstallProgress = {
  pluginId: string
  stage: ExtensionInstallStage
  percent: number
}

export type WorkspaceExtensionPlugin = ExtensionPluginRuntimeConfig

type WorkspaceExtensionsControllerState = {
  extensionSearchQuery: Ref<string>
  extensionPlugins: Ref<WorkspaceExtensionPlugin[]>
  selectedExtensionId: Ref<string>
  extensionDetailTab: Ref<'details' | 'features'>
  extensionNotice: Ref<string>
  extensionInstallLoadingMap: Ref<Record<string, boolean>>
  extensionUpdateLoadingMap: Ref<Record<string, boolean>>
  extensionInstallProgressMap: Ref<Record<string, WorkspaceExtensionInstallProgress>>
  extensionDragActive: Ref<boolean>
  extensionInstallingPackageName: Ref<string>
}

export const createWorkspaceExtensionsController = (state: WorkspaceExtensionsControllerState) => {
  const {
    extensionSearchQuery,
    extensionPlugins,
    selectedExtensionId,
    extensionDetailTab,
    extensionNotice,
    extensionInstallLoadingMap,
    extensionUpdateLoadingMap,
    extensionInstallProgressMap,
    extensionDragActive,
    extensionInstallingPackageName
  } = state

  const extensionActiveOperations = ref<Record<string, ExtensionPluginOperation>>({})
  const extensionPendingPackageRequestId = ref('')
  let extensionPluginsRefreshPromise: Promise<boolean> | null = null
  let extensionPackageInstallRequestSequence = 0
  let removeExtensionInstallProgressListener: (() => void) | null = null

  const nextExtensionPackageInstallRequestId = () => `extension-package-install-${(extensionPackageInstallRequestSequence += 1)}`

  const visibleExtensionPlugins = computed(() =>
    extensionPlugins.value
      .filter((plugin) => plugin.show)
      .sort((a, b) => {
        const rank = (plugin: WorkspaceExtensionPlugin) => {
          if (!plugin.isPlugin) return 0
          if (plugin.installed) return 1
          if (plugin.hasUpdate) return 2
          return 3
        }
        const aRank = rank(a)
        const bRank = rank(b)
        if (aRank !== bRank) return aRank - bRank
        return a.name.localeCompare(b.name)
      })
  )

  const filteredExtensionPlugins = computed(() => {
    const query = extensionSearchQuery.value.trim().toLowerCase()
    const visible = visibleExtensionPlugins.value
    if (!query) return visible
    return visible.filter((plugin) =>
      [plugin.name, plugin.description, plugin.pluginId, plugin.source || '', ...(plugin.categories || [])].some((value) => value.toLowerCase().includes(query))
    )
  })

  const selectedExtension = computed(() => visibleExtensionPlugins.value.find((plugin) => plugin.pluginId === selectedExtensionId.value) || null)

  const selectedExtensionInstallProgress = computed(() =>
    selectedExtension.value ? extensionInstallProgressMap.value[selectedExtension.value.pluginId] || null : null
  )

  const ensureSelectedExtensionVisible = () => {
    if (visibleExtensionPlugins.value.some((plugin) => plugin.pluginId === selectedExtensionId.value)) return
    selectedExtensionId.value = visibleExtensionPlugins.value[0]?.pluginId || ''
    extensionDetailTab.value = 'details'
  }

  const selectExtension = (pluginId: string) => {
    if (!visibleExtensionPlugins.value.some((plugin) => plugin.pluginId === pluginId)) return
    selectedExtensionId.value = pluginId
    extensionDetailTab.value = 'details'
  }

  const setExtensionNotice = (text: string) => {
    extensionNotice.value = text
    if (!text) return
    window.setTimeout(() => {
      if (extensionNotice.value === text) extensionNotice.value = ''
    }, 2400)
  }

  const setExtensionDragActive = (active: boolean) => {
    extensionDragActive.value = active
  }

  const confirmTrustedExecutableCode = (name: string) => {
    if (import.meta.env.MODE === 'test') return true
    return window.confirm(
      `${name} 可能包含在 aiopsterm 主进程中运行的受信任代码。安装者需要自行确认插件来源、安全性和稳定性。是否继续？`
    )
  }

  const setExtensionInstallLoading = (pluginId: string, loading: boolean) => {
    const next = { ...extensionInstallLoadingMap.value }
    if (loading) next[pluginId] = true
    else delete next[pluginId]
    extensionInstallLoadingMap.value = next
  }

  const setExtensionUpdateLoading = (pluginId: string, loading: boolean) => {
    const next = { ...extensionUpdateLoadingMap.value }
    if (loading) next[pluginId] = true
    else delete next[pluginId]
    extensionUpdateLoadingMap.value = next
  }

  const setExtensionInstallProgress = (pluginId: string, stage: ExtensionInstallStage, percent = 0) => {
    const next = { ...extensionInstallProgressMap.value }
    if (!stage || ['done', 'error', 'cancelled'].includes(stage)) {
      if (stage) next[pluginId] = { pluginId, stage, percent: Math.max(0, Math.min(100, Math.round(percent))) }
      else delete next[pluginId]
    } else {
      next[pluginId] = {
        pluginId,
        stage,
        percent: Math.max(0, Math.min(100, Math.round(percent)))
      }
    }
    extensionInstallProgressMap.value = next
  }

  const setExtensionActiveOperation = (pluginId: string, operation: ExtensionPluginOperation | null) => {
    if (!pluginId) return
    const next = { ...extensionActiveOperations.value }
    if (operation) next[pluginId] = operation
    else delete next[pluginId]
    extensionActiveOperations.value = next
  }

  const clearExtensionActiveOperation = (pluginId: string) => {
    setExtensionActiveOperation(pluginId, null)
  }

  const extensionHasActiveOperation = (pluginId: string) =>
    Boolean(extensionInstallLoadingMap.value[pluginId] || extensionUpdateLoadingMap.value[pluginId] || extensionActiveOperations.value[pluginId])

  const isExpectedExtensionProgress = (event: BackendExtensionInstallProgress) => {
    if (event.operation === 'package') {
      const expectedRequestId = extensionPendingPackageRequestId.value
      if (expectedRequestId) {
        if (event.requestId !== expectedRequestId) return false
        setExtensionActiveOperation(event.pluginId, 'package')
        return true
      }
    }
    const expectedOperation = extensionActiveOperations.value[event.pluginId]
    if (expectedOperation) return expectedOperation === event.operation
    if (!extensionInstallLoadingMap.value[event.pluginId] && !extensionUpdateLoadingMap.value[event.pluginId]) return false
    return event.operation === 'update' ? Boolean(extensionUpdateLoadingMap.value[event.pluginId]) : Boolean(extensionInstallLoadingMap.value[event.pluginId])
  }

  const handleExtensionInstallProgress = (event: BackendExtensionInstallProgress) => {
    if (!isExtensionInstallProgressData(event)) {
      setExtensionNotice(malformedExtensionBackendResultMessage)
      return
    }
    if (!isExpectedExtensionProgress(event)) {
      setExtensionNotice(malformedExtensionBackendResultMessage)
      return
    }
    if (event.operation === 'update') {
      setExtensionUpdateLoading(event.pluginId, !['done', 'error', 'cancelled'].includes(event.stage))
    } else {
      setExtensionInstallLoading(event.pluginId, !['done', 'error', 'cancelled'].includes(event.stage))
    }
    setExtensionInstallProgress(event.pluginId, event.stage, event.percent)
    if (['done', 'error', 'cancelled'].includes(event.stage)) clearExtensionActiveOperation(event.pluginId)
  }

  const installExtensionInstallProgressListener = () => {
    const onExtensionInstallProgress = extensionsClient.onExtensionInstallProgress()
    if (removeExtensionInstallProgressListener || !onExtensionInstallProgress) return
    removeExtensionInstallProgressListener = onExtensionInstallProgress(handleExtensionInstallProgress)
  }

  const clearExtensionInstallProgressLater = (pluginId: string) => {
    window.setTimeout(() => {
      const current = extensionInstallProgressMap.value[pluginId]
      if (!current || !['done', 'error', 'cancelled'].includes(current.stage)) return
      const next = { ...extensionInstallProgressMap.value }
      delete next[pluginId]
      extensionInstallProgressMap.value = next
    }, 900)
  }

  const cloneExtensionPluginForBackend = (plugin: WorkspaceExtensionPlugin): ExtensionPluginRuntimeConfig => ({
    ...plugin,
    categories: plugin.categories ? [...plugin.categories] : undefined,
    functions: plugin.functions ? plugin.functions.map((item) => ({ ...item })) : undefined,
    commands: plugin.commands ? plugin.commands.map((item) => ({ ...item })) : undefined,
    assetProviders: plugin.assetProviders
      ? plugin.assetProviders.map((provider) => ({ ...provider, fields: provider.fields.map((field) => ({ ...field })) }))
      : undefined,
    guideSteps: plugin.guideSteps ? [...plugin.guideSteps] : undefined,
    connectionLog: plugin.connectionLog ? plugin.connectionLog.map((item) => ({ ...item })) : undefined,
    packageUrl: plugin.packageUrl || undefined,
    packageSha256: plugin.packageSha256 || undefined
  })

  const applyExtensionPluginFromBackend = (plugin: ExtensionPluginRuntimeConfig) => {
    const nextPlugin: WorkspaceExtensionPlugin = {
      ...plugin,
      iconKey: plugin.iconKey || 'local',
      categories: plugin.categories ? [...plugin.categories] : undefined,
      functions: plugin.functions ? plugin.functions.map((item) => ({ ...item })) : undefined,
      commands: plugin.commands ? plugin.commands.map((item) => ({ ...item })) : undefined,
      assetProviders: plugin.assetProviders
        ? plugin.assetProviders.map((provider) => ({ ...provider, fields: provider.fields.map((field) => ({ ...field })) }))
        : undefined,
      guideSteps: plugin.guideSteps ? [...plugin.guideSteps] : undefined,
      connectionLog: plugin.connectionLog ? plugin.connectionLog.map((item) => ({ ...item })) : undefined,
      packageUrl: plugin.packageUrl || undefined,
      packageSha256: plugin.packageSha256 || undefined
    }
    const index = extensionPlugins.value.findIndex((item) => item.pluginId === nextPlugin.pluginId)
    if (nextPlugin.show === false && nextPlugin.source === 'local') {
      if (index >= 0) extensionPlugins.value = extensionPlugins.value.filter((item) => item.pluginId !== nextPlugin.pluginId)
      ensureSelectedExtensionVisible()
      return
    }
    if (index >= 0) {
      extensionPlugins.value[index] = { ...extensionPlugins.value[index], ...nextPlugin }
    } else {
      extensionPlugins.value.push(nextPlugin)
    }
  }

  const refreshExtensionPlugins = async () => {
    const listExtensionPluginsBridge = extensionsClient.listExtensionPlugins()
    if (!listExtensionPluginsBridge) {
      setExtensionNotice('插件列表加载服务不可用')
      ensureSelectedExtensionVisible()
      return false
    }
    if (extensionPluginsRefreshPromise) return extensionPluginsRefreshPromise
    extensionPluginsRefreshPromise = (async () => {
      try {
        const result = await listExtensionPluginsBridge()
        if (!result?.ok) {
          setExtensionNotice(result?.errorMessage || '插件列表加载失败')
          return false
        }
        if (!isExtensionPluginListData(result.data)) {
          setExtensionNotice(malformedExtensionBackendResultMessage)
          return false
        }
        extensionPlugins.value = result.data.map((plugin) => ({
          ...plugin,
          iconKey: plugin.iconKey || 'local',
          categories: plugin.categories ? [...plugin.categories] : undefined,
          functions: plugin.functions ? plugin.functions.map((item) => ({ ...item })) : undefined,
          commands: plugin.commands ? plugin.commands.map((item) => ({ ...item })) : undefined,
          assetProviders: plugin.assetProviders
            ? plugin.assetProviders.map((provider) => ({ ...provider, fields: provider.fields.map((field) => ({ ...field })) }))
            : undefined,
          guideSteps: plugin.guideSteps ? [...plugin.guideSteps] : undefined,
          connectionLog: plugin.connectionLog ? plugin.connectionLog.map((item) => ({ ...item })) : undefined,
          packageUrl: plugin.packageUrl || undefined,
          packageSha256: plugin.packageSha256 || undefined
        }))
        ensureSelectedExtensionVisible()
        return true
      } catch (error) {
        setExtensionNotice(error instanceof Error ? error.message : '插件列表加载失败')
        ensureSelectedExtensionVisible()
        return false
      }
    })().finally(() => {
      extensionPluginsRefreshPromise = null
    })
    return extensionPluginsRefreshPromise
  }

  const installExtensionPlugin = async (pluginId: string) => {
    const plugin = extensionPlugins.value.find((item) => item.pluginId === pluginId)
    if (!plugin || !plugin.isPlugin) return
    if (plugin.installable === false) {
      setExtensionNotice('该插件需要订阅后安装')
      return
    }
    if (!confirmTrustedExecutableCode(plugin.name)) {
      setExtensionNotice(`${plugin.name} 安装已取消`)
      return
    }
    const installExtensionPluginBridge = extensionsClient.installExtensionPlugin()
    if (!installExtensionPluginBridge) {
      setExtensionNotice(`${plugin.name} 安装服务不可用`)
      return
    }
    installExtensionInstallProgressListener()
    setExtensionActiveOperation(pluginId, 'install')
    setExtensionInstallLoading(pluginId, true)
    setExtensionNotice(`正在安装 ${plugin.name}`)
    try {
      const result = await installExtensionPluginBridge({ plugin: cloneExtensionPluginForBackend(plugin) })
      if (!result?.ok) {
        const cancelled = result?.errorCode === 'EXTENSION_PLUGIN_OPERATION_CANCELLED'
        setExtensionInstallProgress(pluginId, cancelled ? 'cancelled' : 'error', 0)
        setExtensionNotice(cancelled ? `${plugin.name} 安装已取消` : result?.errorMessage || `${plugin.name} 安装失败`)
        clearExtensionInstallProgressLater(pluginId)
        return
      }
      if (!isExtensionPluginOperationData(result.data, 'install') || result.data.plugin.pluginId !== pluginId) {
        setExtensionInstallProgress(pluginId, 'error', 0)
        setExtensionNotice(malformedExtensionBackendResultMessage)
        clearExtensionInstallProgressLater(pluginId)
        return
      }
      applyExtensionPluginFromBackend(result.data.plugin)
      setExtensionInstallProgress(pluginId, 'done', 100)
      setExtensionNotice(`${result.data.plugin.name} 安装成功`)
      clearExtensionInstallProgressLater(pluginId)
    } catch (error) {
      setExtensionInstallProgress(pluginId, 'error', 0)
      setExtensionNotice(error instanceof Error ? error.message : `${plugin.name} 安装失败`)
      clearExtensionInstallProgressLater(pluginId)
    } finally {
      setExtensionInstallLoading(pluginId, false)
      clearExtensionActiveOperation(pluginId)
    }
  }

  const updateExtensionPlugin = async (pluginId: string) => {
    const plugin = extensionPlugins.value.find((item) => item.pluginId === pluginId)
    if (!plugin || !plugin.isPlugin || !plugin.installed || !plugin.hasUpdate) return
    if (!confirmTrustedExecutableCode(plugin.name)) {
      setExtensionNotice(`${plugin.name} 更新已取消`)
      return
    }
    const updateExtensionPluginBridge = extensionsClient.updateExtensionPlugin()
    if (!updateExtensionPluginBridge) {
      setExtensionNotice(`${plugin.name} 更新服务不可用`)
      return
    }
    installExtensionInstallProgressListener()
    setExtensionActiveOperation(pluginId, 'update')
    setExtensionUpdateLoading(pluginId, true)
    setExtensionNotice(`正在更新 ${plugin.name}`)
    try {
      const result = await updateExtensionPluginBridge({ plugin: cloneExtensionPluginForBackend(plugin) })
      if (!result?.ok) {
        const cancelled = result?.errorCode === 'EXTENSION_PLUGIN_OPERATION_CANCELLED'
        setExtensionInstallProgress(pluginId, cancelled ? 'cancelled' : 'error', 0)
        setExtensionNotice(cancelled ? `${plugin.name} 安装已取消` : result?.errorMessage || `${plugin.name} 更新失败`)
        clearExtensionInstallProgressLater(pluginId)
        return
      }
      if (!isExtensionPluginOperationData(result.data, 'update') || result.data.plugin.pluginId !== pluginId) {
        setExtensionInstallProgress(pluginId, 'error', 0)
        setExtensionNotice(malformedExtensionBackendResultMessage)
        clearExtensionInstallProgressLater(pluginId)
        return
      }
      applyExtensionPluginFromBackend(result.data.plugin)
      setExtensionInstallProgress(pluginId, 'done', 100)
      setExtensionNotice(`${result.data.plugin.name} 已更新`)
      clearExtensionInstallProgressLater(pluginId)
    } catch (error) {
      setExtensionInstallProgress(pluginId, 'error', 0)
      setExtensionNotice(error instanceof Error ? error.message : `${plugin.name} 更新失败`)
      clearExtensionInstallProgressLater(pluginId)
    } finally {
      setExtensionUpdateLoading(pluginId, false)
      clearExtensionActiveOperation(pluginId)
    }
  }

  const uninstallExtensionPlugin = async (pluginId: string) => {
    const plugin = extensionPlugins.value.find((item) => item.pluginId === pluginId)
    if (!plugin || !plugin.isPlugin || plugin.required) return
    const uninstallExtensionPluginBridge = extensionsClient.uninstallExtensionPlugin()
    if (!uninstallExtensionPluginBridge) {
      setExtensionNotice(`${plugin.name} 卸载服务不可用`)
      return
    }
    try {
      const removeData =
        import.meta.env.MODE !== 'test' &&
        window.confirm(`是否同时删除 ${plugin.name} 保存的状态、配置、密钥和日志？选择取消将只卸载插件代码。`)
      const result = await uninstallExtensionPluginBridge({
        plugin: cloneExtensionPluginForBackend(plugin),
        ...(removeData ? { removeData: true } : {})
      })
      if (!result?.ok) {
        setExtensionNotice(result?.errorMessage || `${plugin.name} 卸载失败`)
        return
      }
      if (!isExtensionPluginOperationData(result.data, 'uninstall') || result.data.plugin.pluginId !== pluginId) {
        setExtensionNotice(malformedExtensionBackendResultMessage)
        return
      }
      applyExtensionPluginFromBackend(result.data.plugin)
      setExtensionNotice(`${result.data.plugin.name} 已卸载`)
    } catch (error) {
      setExtensionNotice(error instanceof Error ? error.message : `${plugin.name} 卸载失败`)
    }
  }

  const subscribeExtensionPlugin = async (pluginId: string) => {
    const plugin = extensionPlugins.value.find((item) => item.pluginId === pluginId)
    if (!plugin || !plugin.isPlugin) return
    const openExtensionSubscriptionBridge = extensionsClient.openExtensionSubscription()
    if (!openExtensionSubscriptionBridge) {
      setExtensionNotice(`${plugin.name} 订阅服务不可用`)
      return
    }
    try {
      const result = await openExtensionSubscriptionBridge({ plugin: cloneExtensionPluginForBackend(plugin) })
      if (!result?.ok) {
        setExtensionNotice(result?.errorMessage || `${plugin.name} 订阅入口打开失败`)
        return
      }
      if (!isExtensionSubscriptionData(result.data) || result.data.pluginId !== pluginId) {
        setExtensionNotice(malformedExtensionBackendResultMessage)
        return
      }
      setExtensionNotice(`${plugin.name} 已打开订阅入口`)
    } catch (error) {
      setExtensionNotice(error instanceof Error ? error.message : `${plugin.name} 订阅入口打开失败`)
    }
  }

  const cancelExtensionInstall = async (pluginId: string) => {
    if (!extensionHasActiveOperation(pluginId)) return
    const plugin = extensionPlugins.value.find((item) => item.pluginId === pluginId)
    const cancelExtensionInstallBridge = extensionsClient.cancelExtensionInstall()
    if (!cancelExtensionInstallBridge) {
      setExtensionNotice(`${plugin?.name || '插件'} 取消服务不可用`)
      return
    }
    try {
      const result = await cancelExtensionInstallBridge(pluginId)
      if (!result?.ok) {
        setExtensionNotice(result?.errorMessage || `${plugin?.name || '插件'} 取消失败`)
        return
      }
      if (!isExtensionPluginCancelData(result.data) || result.data.pluginId !== pluginId) {
        setExtensionNotice(malformedExtensionBackendResultMessage)
        return
      }
      setExtensionInstallLoading(pluginId, false)
      setExtensionUpdateLoading(pluginId, false)
      setExtensionInstallProgress(pluginId, 'cancelled', 0)
      clearExtensionActiveOperation(pluginId)
      setExtensionNotice(`${plugin?.name || '插件'} 安装已取消`)
      clearExtensionInstallProgressLater(pluginId)
    } catch (error) {
      setExtensionNotice(error instanceof Error ? error.message : `${plugin?.name || '插件'} 取消失败`)
    }
  }

  const dropExtensionPackage = async (file: string | { name?: string; path?: string; size?: number }) => {
    extensionDragActive.value = false
    const rawPath = typeof file === 'string' ? file : file?.path || ''
    const pathLooksLocal = rawPath.includes('/') || rawPath.includes('\\')
    const filePath = typeof file === 'string' ? (pathLooksLocal ? rawPath : '') : rawPath
    const pathFileName = rawPath.split(/[\\/]/).pop() || ''
    const fileName = typeof file === 'string' ? pathFileName || file : file?.name || pathFileName
    const size = typeof file === 'string' ? undefined : file?.size
    if (!fileName.endsWith('.aiopsterm-plugin')) {
      setExtensionNotice('插件包格式错误，请拖入 .aiopsterm-plugin 文件')
      return false
    }
    const packageName = fileName.replace(/\.aiopsterm-plugin$/i, '').replace(/[-_]+/g, ' ').trim() || 'Local Plugin'
    if (!filePath) {
      setExtensionNotice(`${packageName} 安装需要真实本地路径，请从桌面客户端拖入 .aiopsterm-plugin 文件`)
      return false
    }
    if (!confirmTrustedExecutableCode(packageName)) {
      setExtensionNotice(`${packageName} 安装已取消`)
      return false
    }
    const installExtensionPackageBridge = extensionsClient.installExtensionPackage()
    if (!installExtensionPackageBridge) {
      setExtensionNotice(`${packageName} 安装服务不可用`)
      return false
    }
    installExtensionInstallProgressListener()
    const requestId = nextExtensionPackageInstallRequestId()
    extensionPendingPackageRequestId.value = requestId
    extensionInstallingPackageName.value = packageName
    setExtensionNotice(`正在安装 ${packageName}`)
    let pendingPluginId = ''
    try {
      const result = await installExtensionPackageBridge({
        fileName,
        filePath,
        size,
        existingPluginIds: extensionPlugins.value.map((plugin) => plugin.pluginId),
        requestId
      })
      if (!result?.ok) {
        setExtensionNotice(result?.errorCode === 'EXTENSION_PLUGIN_OPERATION_CANCELLED' ? `${packageName} 安装已取消` : result?.errorMessage || `${packageName} 安装失败`)
        return false
      }
      if (!isExtensionPluginOperationData(result.data, 'package')) {
        setExtensionNotice(malformedExtensionBackendResultMessage)
        return false
      }
      pendingPluginId = result.data.plugin.pluginId
      setExtensionActiveOperation(pendingPluginId, 'package')
      applyExtensionPluginFromBackend(result.data.plugin)
      selectedExtensionId.value = result.data.plugin.pluginId
      setExtensionInstallProgress(result.data.plugin.pluginId, 'done', 100)
      setExtensionNotice(`${result.data.plugin.name} 安装成功`)
      clearExtensionInstallProgressLater(result.data.plugin.pluginId)
      return true
    } catch (error) {
      setExtensionNotice(error instanceof Error ? error.message : `${packageName} 安装失败`)
      return false
    } finally {
      if (pendingPluginId) setExtensionInstallLoading(pendingPluginId, false)
      if (pendingPluginId) clearExtensionActiveOperation(pendingPluginId)
      if (extensionPendingPackageRequestId.value === requestId) extensionPendingPackageRequestId.value = ''
      extensionInstallingPackageName.value = ''
    }
  }

  return {
    filteredExtensionPlugins,
    selectedExtension,
    selectedExtensionInstallProgress,
    ensureSelectedExtensionVisible,
    selectExtension,
    setExtensionNotice,
    setExtensionDragActive,
    refreshExtensionPlugins,
    installExtensionPlugin,
    updateExtensionPlugin,
    uninstallExtensionPlugin,
    subscribeExtensionPlugin,
    cancelExtensionInstall,
    dropExtensionPackage
  }
}
