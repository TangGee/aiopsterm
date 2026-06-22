
import { Bot, ChevronRight, Clipboard, Cloud, FileText, Link, LoaderCircle, Plus, RefreshCw, ScrollText, Search, Settings, Terminal, Trash2, Unplug, X } from 'lucide-vue-next'
import { K8sAddClusterModal, K8sDeleteConfirmModal, K8sEditClusterModal, K8sProxyConfigModal, K8sStatusTag } from '@/services/kubernetesWorkspaceModals'
import { useKubernetesWorkspaceInteractionRuntime } from '@/services/kubernetesWorkspaceInteractionRuntime'
import { useWorkspaceStore } from '@/stores/workspace'

export const useKubernetesWorkspaceRuntime = () => {
  const workspace = useWorkspaceStore()
  const interaction = useKubernetesWorkspaceInteractionRuntime(workspace)

  return {
    workspace,
    ...interaction,
    K8sStatusTag,
    K8sAddClusterModal,
    K8sEditClusterModal,
    K8sProxyConfigModal,
    K8sDeleteConfirmModal,
    Bot,
    ChevronRight,
    Clipboard,
    Cloud,
    FileText,
    Link,
    LoaderCircle,
    Plus,
    RefreshCw,
    ScrollText,
    Search,
    Settings,
    Terminal,
    Trash2,
    Unplug,
    X
  }
}
