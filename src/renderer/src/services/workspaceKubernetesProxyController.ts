import type { Ref } from 'vue'
import { isK8sProxyConfigData, type K8sProxyConfig } from '@/services/kubernetesBackendGuards'
import { kubernetesClient } from '@/services/kubernetesClient'
import { cloneK8sProxyConfig, k8sProxyConfigValid, updateK8sProxyDraft } from '@/services/kubernetesRuntime'

type WorkspaceKubernetesProxyState = {
  savedK8sProxyConfig: Ref<K8sProxyConfig>
  k8sProxyConfig: Ref<K8sProxyConfig>
  k8sProxyConfigOpen: Ref<boolean>
}

type WorkspaceKubernetesProxyDeps = {
  setK8sNotice: (text: string) => void
}

export const createWorkspaceKubernetesProxyController = (state: WorkspaceKubernetesProxyState, deps: WorkspaceKubernetesProxyDeps) => {
  const { savedK8sProxyConfig, k8sProxyConfig, k8sProxyConfigOpen } = state
  const { setK8sNotice } = deps

  const openK8sProxyConfig = () => {
    k8sProxyConfig.value = cloneK8sProxyConfig(savedK8sProxyConfig.value)
    k8sProxyConfigOpen.value = true
  }

  const closeK8sProxyConfig = () => {
    k8sProxyConfig.value = cloneK8sProxyConfig(savedK8sProxyConfig.value)
    k8sProxyConfigOpen.value = false
  }

  const updateK8sProxyConfig = (patch: Partial<K8sProxyConfig>) => {
    k8sProxyConfig.value = updateK8sProxyDraft(k8sProxyConfig.value, patch)
  }

  const saveK8sProxyConfig = async () => {
    if (!k8sProxyConfigValid(k8sProxyConfig.value)) {
      setK8sNotice('请补全 Kubernetes Agent 代理主机和端口')
      return false
    }
    const saveKubernetesAgentProxyConfig = kubernetesClient.saveKubernetesAgentProxyConfig()
    if (!saveKubernetesAgentProxyConfig) {
      setK8sNotice('Kubernetes Agent 代理配置服务不可用')
      return false
    }
    const draft = cloneK8sProxyConfig(k8sProxyConfig.value)
    try {
      const result = await saveKubernetesAgentProxyConfig(draft)
      if (!result?.ok) {
        setK8sNotice(result?.errorMessage || 'Kubernetes Agent 代理配置保存失败')
        return false
      }
      if (!isK8sProxyConfigData(result.data)) {
        setK8sNotice('Kubernetes Agent proxy backend returned malformed result data.')
        return false
      }
      savedK8sProxyConfig.value = cloneK8sProxyConfig(result.data.proxyConfig)
      k8sProxyConfig.value = cloneK8sProxyConfig(result.data.proxyConfig)
    } catch (error) {
      setK8sNotice(error instanceof Error ? error.message : 'Kubernetes Agent 代理配置保存失败')
      return false
    }
    k8sProxyConfigOpen.value = false
    setK8sNotice(savedK8sProxyConfig.value.enabled ? 'Kubernetes Agent 代理配置已应用' : 'Kubernetes Agent 代理已关闭')
    return true
  }

  return {
    openK8sProxyConfig,
    closeK8sProxyConfig,
    updateK8sProxyConfig,
    saveK8sProxyConfig
  }
}
