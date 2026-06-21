import type {
  KubernetesBastionGroup,
  KubernetesClusterRecord,
  KubernetesContextInfo,
  KubernetesImportContextInfo,
  KubernetesNamespaceInfo,
  KubernetesResource
} from './contracts/kubernetes'

export const defaultKubernetesContexts: KubernetesContextInfo[] = [
  {
    name: 'prod/admin',
    cluster: 'prod-cluster',
    namespace: 'default',
    server: 'https://prod.k8s.local:6443',
    isActive: true
  },
  {
    name: 'staging/devops',
    cluster: 'staging-cluster',
    namespace: 'staging',
    server: 'https://staging.k8s.local:6443',
    isActive: false
  }
]

export const defaultKubernetesBastions: KubernetesBastionGroup[] = [
  { uuid: 'org-1', label: 'jumpserver-org', ip: 'bastion.internal' },
  { uuid: 'org-prod', label: 'prod-bastion', ip: '10.24.8.12' }
]

export const defaultKubernetesClusters: KubernetesClusterRecord[] = [
  {
    id: 'k8s-1',
    name: 'prod-cluster',
    kubeconfig_path: '~/.kube/config',
    kubeconfig_content: null,
    context_name: 'prod/admin',
    server_url: 'https://prod.k8s.local:6443',
    auth_type: 'kubeconfig',
    is_active: 1,
    connection_status: 'connected',
    auto_connect: 1,
    default_namespace: 'default',
    created_at: '2026-05-28 10:20',
    updated_at: '2026-06-03 09:30',
    source_type: 'local',
    bastion_uuid: null,
    bastion_asset_address: null,
    bastion_asset_name: null,
    bastion_asset_id_last: null
  },
  {
    id: 'k8s-2',
    name: 'staging-cluster',
    kubeconfig_path: '~/.kube/staging',
    kubeconfig_content: null,
    context_name: 'staging/devops',
    server_url: 'https://staging.k8s.local:6443',
    auth_type: 'kubeconfig',
    is_active: 0,
    connection_status: 'disconnected',
    auto_connect: 0,
    default_namespace: 'staging',
    created_at: '2026-05-28 11:20',
    updated_at: '2026-06-01 12:10',
    source_type: 'local',
    bastion_uuid: null,
    bastion_asset_address: null,
    bastion_asset_name: null,
    bastion_asset_id_last: null
  },
  {
    id: 'k8s-3',
    name: 'jumpserver-prod',
    kubeconfig_path: null,
    kubeconfig_content: null,
    context_name: 'jumpserver/prod',
    server_url: '172.16.20.14:6443',
    auth_type: 'jumpserver',
    is_active: 0,
    connection_status: 'error',
    auto_connect: 0,
    default_namespace: 'ops',
    created_at: '2026-05-30 15:00',
    updated_at: '2026-06-02 18:10',
    source_type: 'jumpserver',
    bastion_uuid: 'org-1',
    bastion_asset_address: '172.16.20.14',
    bastion_asset_name: 'jumpserver-prod',
    bastion_asset_id_last: 1014
  }
]

export const developmentKubernetesSeedClusterIds = new Set(defaultKubernetesClusters.map((cluster) => cluster.id))

export const defaultKubernetesNamespaces: KubernetesNamespaceInfo[] = [
  { id: 'k8s-ns-prod-default', clusterId: 'k8s-1', name: 'default', status: 'Active', age: '92d' },
  { id: 'k8s-ns-prod-ops', clusterId: 'k8s-1', name: 'ops', status: 'Active', age: '77d' },
  { id: 'k8s-ns-prod-ingress', clusterId: 'k8s-1', name: 'ingress-nginx', status: 'Active', age: '64d' },
  { id: 'k8s-ns-staging', clusterId: 'k8s-2', name: 'staging', status: 'Active', age: '48d' },
  { id: 'k8s-ns-staging-ci', clusterId: 'k8s-2', name: 'ci', status: 'Active', age: '48d' },
  { id: 'k8s-ns-jump-ops', clusterId: 'k8s-3', name: 'ops', status: 'Active', age: '31d' }
]

export const defaultKubernetesResources: KubernetesResource[] = [
  {
    id: 'k8s-pod-api-1',
    clusterId: 'k8s-1',
    kind: 'pods',
    name: 'api-gateway-6d8c9bb7f6-l6j2m',
    namespace: 'default',
    status: 'Running',
    ready: '2/2',
    age: '3d',
    detail: 'REST ingress workload serving public API traffic.',
    node: 'prod-node-01',
    image: 'registry.internal/api-gateway:2.8.4',
    restarts: 0
  },
  {
    id: 'k8s-pod-worker-1',
    clusterId: 'k8s-1',
    kind: 'pods',
    name: 'billing-worker-7f9d6f9dd9-rx8mm',
    namespace: 'ops',
    status: 'CrashLoopBackOff',
    ready: '0/1',
    age: '18h',
    detail: 'Background billing worker with repeated startup failures.',
    node: 'prod-node-03',
    image: 'registry.internal/billing-worker:1.15.2',
    restarts: 12
  },
  {
    id: 'k8s-pod-ingress-1',
    clusterId: 'k8s-1',
    kind: 'pods',
    name: 'ingress-nginx-controller-66d8f7dbf6-vf9jg',
    namespace: 'ingress-nginx',
    status: 'Running',
    ready: '1/1',
    age: '21d',
    detail: 'Cluster ingress controller.',
    node: 'prod-node-02',
    image: 'registry.k8s.io/ingress-nginx/controller:v1.11.1',
    restarts: 1
  },
  {
    id: 'k8s-deploy-api',
    clusterId: 'k8s-1',
    kind: 'deployments',
    name: 'api-gateway',
    namespace: 'default',
    status: 'Available',
    ready: '4/4',
    age: '38d',
    detail: 'RollingUpdate deployment for the public API gateway.',
    image: 'registry.internal/api-gateway:2.8.4',
    selector: 'app=api-gateway'
  },
  {
    id: 'k8s-deploy-worker',
    clusterId: 'k8s-1',
    kind: 'deployments',
    name: 'billing-worker',
    namespace: 'ops',
    status: 'Progressing',
    ready: '2/3',
    age: '24d',
    detail: 'Worker deployment processing billing queue events.',
    image: 'registry.internal/billing-worker:1.15.2',
    selector: 'app=billing-worker'
  },
  {
    id: 'k8s-svc-api',
    clusterId: 'k8s-1',
    kind: 'services',
    name: 'api-gateway',
    namespace: 'default',
    status: 'ClusterIP',
    ready: '10.96.12.40',
    age: '38d',
    detail: 'Internal service for api-gateway pods.',
    ports: '80/TCP, 443/TCP',
    selector: 'app=api-gateway'
  },
  {
    id: 'k8s-svc-ingress',
    clusterId: 'k8s-1',
    kind: 'services',
    name: 'ingress-nginx-controller',
    namespace: 'ingress-nginx',
    status: 'LoadBalancer',
    ready: '10.96.32.10',
    age: '64d',
    detail: 'Ingress controller service exposing HTTP and HTTPS.',
    ports: '80:32080/TCP, 443:32443/TCP',
    selector: 'app.kubernetes.io/name=ingress-nginx'
  },
  {
    id: 'k8s-node-prod-1',
    clusterId: 'k8s-1',
    kind: 'nodes',
    name: 'prod-node-01',
    namespace: 'cluster',
    status: 'Ready',
    ready: 'v1.29.3',
    age: '92d',
    detail: 'Control-plane capable production worker node.',
    node: '10.24.1.11'
  },
  {
    id: 'k8s-node-prod-2',
    clusterId: 'k8s-1',
    kind: 'nodes',
    name: 'prod-node-02',
    namespace: 'cluster',
    status: 'Ready',
    ready: 'v1.29.3',
    age: '91d',
    detail: 'Production worker node running ingress and API workloads.',
    node: '10.24.1.12'
  },
  {
    id: 'k8s-pod-staging-api',
    clusterId: 'k8s-2',
    kind: 'pods',
    name: 'staging-api-76f7d9cbf7-8l4xf',
    namespace: 'staging',
    status: 'Running',
    ready: '1/1',
    age: '9h',
    detail: 'Staging API pod for pre-release validation.',
    node: 'staging-node-01',
    image: 'registry.internal/api-gateway:2.9.0-rc1',
    restarts: 0
  },
  {
    id: 'k8s-deploy-staging-api',
    clusterId: 'k8s-2',
    kind: 'deployments',
    name: 'staging-api',
    namespace: 'staging',
    status: 'Available',
    ready: '2/2',
    age: '12d',
    detail: 'Staging API deployment.',
    image: 'registry.internal/api-gateway:2.9.0-rc1',
    selector: 'app=staging-api'
  },
  {
    id: 'k8s-svc-staging-api',
    clusterId: 'k8s-2',
    kind: 'services',
    name: 'staging-api',
    namespace: 'staging',
    status: 'ClusterIP',
    ready: '10.100.8.42',
    age: '12d',
    detail: 'Internal staging API service.',
    ports: '8080/TCP',
    selector: 'app=staging-api'
  },
  {
    id: 'k8s-node-staging-1',
    clusterId: 'k8s-2',
    kind: 'nodes',
    name: 'staging-node-01',
    namespace: 'cluster',
    status: 'Ready',
    ready: 'v1.28.8',
    age: '48d',
    detail: 'Staging worker node.',
    node: '10.28.1.11'
  },
  {
    id: 'k8s-pod-jump-ops',
    clusterId: 'k8s-3',
    kind: 'pods',
    name: 'ops-shell-0',
    namespace: 'ops',
    status: 'Pending',
    ready: '0/1',
    age: '42m',
    detail: 'JumpServer imported cluster workload waiting for scheduling.',
    node: '-',
    image: 'registry.internal/ops-shell:latest',
    restarts: 0
  }
]

export const defaultKubernetesImportContexts: KubernetesImportContextInfo[] = [
  { name: 'prod/admin', cluster: 'prod-cluster', server: 'https://prod.k8s.local:6443', namespace: 'default' },
  { name: 'staging/devops', cluster: 'staging-cluster', server: 'https://staging.k8s.local:6443', namespace: 'staging' }
]
