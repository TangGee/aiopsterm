import { computed, reactive, ref, type Ref } from 'vue'

import type {
  AiopsSshTunnelMutationResult,
  AiopsSshTunnelType
} from '@shared/contracts/assets'
import { assetsClient } from '@/services/assets/assetsClient'
import {
  isAiopsSshTunnelMutationData,
  malformedAssetBackendResultMessage
} from '@/services/assets/assetBackendGuards'
import type { WorkspacePanelAsset } from '@/services/assets/workspaceAssetTreeRuntime'

type WorkspaceTunnelType = AiopsSshTunnelType

type WorkspacePanelTunnelRuntimeInput = {
  contextMenuAssetId: Ref<string | null>
  findEditableAsset: (assetId: string) => WorkspacePanelAsset | null
  applyWorkspaceAssetSnapshot: (snapshot: unknown) => boolean
  closeContextMenu: () => void
  notice: Ref<string>
}

export const createWorkspacePanelTunnelRuntime = ({
  contextMenuAssetId,
  findEditableAsset,
  applyWorkspaceAssetSnapshot,
  closeContextMenu,
  notice
}: WorkspacePanelTunnelRuntimeInput) => {
  const tunnelModal = reactive({ visible: false, assetId: '' })
  const tunnelForm = reactive({
    type: 'local_forward' as WorkspaceTunnelType,
    localPort: '3306',
    remoteHost: 'localhost',
    remotePort: '3306'
  })
  const tunnelFormError = ref('')
  const tunnelSubmitting = ref(false)

  const tunnelAsset = computed(() => findEditableAsset(tunnelModal.assetId))

  const tunnelTypeOptions: Array<{ value: WorkspaceTunnelType; label: string; description: string }> = [
    {
      value: 'local_forward',
      label: '访问远端服务',
      description: '把远端服务映射成本机端口'
    },
    {
      value: 'remote_forward',
      label: '暴露本地服务',
      description: '把本地端口暴露到远端主机'
    },
    {
      value: 'dynamic_socks',
      label: '动态 SOCKS',
      description: '在本机启动 SOCKS5 代理'
    }
  ]

  const syncTunnelAsset = () => {
    return tunnelAsset.value
  }

  const resetTunnelForm = (type: WorkspaceTunnelType = 'local_forward') => {
    tunnelForm.type = type
    tunnelForm.localPort = type === 'dynamic_socks' ? '1080' : '3306'
    tunnelForm.remoteHost = 'localhost'
    tunnelForm.remotePort = type === 'dynamic_socks' ? '' : '3306'
    tunnelFormError.value = ''
    tunnelSubmitting.value = false
  }

  const closeTunnelModal = () => {
    tunnelModal.visible = false
    tunnelModal.assetId = ''
    resetTunnelForm()
  }

  const applyTunnelResult = (result: AiopsSshTunnelMutationResult, fallbackMessage: string) => {
    if (!result.ok) throw new Error(result.errorMessage || fallbackMessage)
    if (!isAiopsSshTunnelMutationData(result.data)) throw new Error(malformedAssetBackendResultMessage)
    applyWorkspaceAssetSnapshot(result.data)
    notice.value = result.data.message || fallbackMessage
  }

  const parseTunnelPort = (value: string, label: string) => {
    const port = Number(value.trim())
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      tunnelFormError.value = `${label}必须是 1-65535 的整数`
      return null
    }
    return port
  }

  const openTunnelModal = (asset: WorkspacePanelAsset) => {
    tunnelModal.visible = true
    tunnelModal.assetId = asset.id
    resetTunnelForm('local_forward')
  }

  const toggleTunnel = async () => {
    const asset = findEditableAsset(contextMenuAssetId.value || '')
    closeContextMenu()
    if (!asset) return
    try {
      if (asset.tunnelState === 'active') {
        const stopTunnel = assetsClient.stopSshTunnel()
        if (typeof stopTunnel !== 'function') {
          notice.value = '隧道运行时服务不可用'
          return
        }
        applyTunnelResult(await stopTunnel({ assetId: asset.id }), '隧道停止失败')
        return
      }
      openTunnelModal(asset)
    } catch (error) {
      notice.value = error instanceof Error ? error.message : '隧道运行失败'
    }
  }

  const startTunnelFromModal = async () => {
    const asset = syncTunnelAsset()
    if (!asset) {
      tunnelFormError.value = '隧道主机不存在'
      return
    }
    const startTunnel = assetsClient.startSshTunnel()
    if (typeof startTunnel !== 'function') {
      tunnelFormError.value = '隧道运行时服务不可用'
      return
    }
    const localPort = parseTunnelPort(tunnelForm.localPort, tunnelForm.type === 'remote_forward' ? '本地服务端口' : '本地监听端口')
    if (localPort === null) return
    const remotePort =
      tunnelForm.type === 'dynamic_socks'
        ? undefined
        : parseTunnelPort(tunnelForm.remotePort, tunnelForm.type === 'remote_forward' ? '远端监听端口' : '远端服务端口')
    if (remotePort === null) return
    const remoteHost = tunnelForm.remoteHost.trim() || 'localhost'
    tunnelSubmitting.value = true
    tunnelFormError.value = ''
    try {
      applyTunnelResult(
        await startTunnel({
          assetId: asset.id,
          type: tunnelForm.type,
          localPort,
          ...(tunnelForm.type === 'dynamic_socks' ? {} : { remoteHost, remotePort })
        }),
        '隧道连接失败'
      )
      closeTunnelModal()
    } catch (error) {
      tunnelFormError.value = error instanceof Error ? error.message : '隧道连接失败'
    } finally {
      tunnelSubmitting.value = false
    }
  }

  const handleTunnelTypeChange = (type: WorkspaceTunnelType, previousType: WorkspaceTunnelType) => {
    if (!tunnelModal.visible || type === previousType) return
    tunnelForm.localPort = type === 'dynamic_socks' ? '1080' : '3306'
    tunnelForm.remoteHost = 'localhost'
    tunnelForm.remotePort = type === 'dynamic_socks' ? '' : '3306'
    tunnelFormError.value = ''
  }

  return {
    tunnelModal,
    tunnelForm,
    tunnelFormError,
    tunnelSubmitting,
    tunnelAsset,
    tunnelTypeOptions,
    closeTunnelModal,
    toggleTunnel,
    startTunnelFromModal,
    handleTunnelTypeChange
  }
}
