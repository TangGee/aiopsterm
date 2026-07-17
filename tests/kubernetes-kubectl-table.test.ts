import { describe, expect, it } from 'vitest'
import type { KubernetesClusterRecord } from '@shared/contracts/kubernetes'
import { idPart } from '@shared/kubernetesKubeconfigRuntime'
import { parseKubectlResources } from '@shared/kubernetesKubectlRuntime'

const cluster: KubernetesClusterRecord = {
  id: 'k8s-table',
  name: 'table-cluster',
  kubeconfig_path: null,
  kubeconfig_content: 'apiVersion: v1',
  context_name: 'table/ctx',
  server_url: 'https://table.k8s.local:6443',
  auth_type: 'kubeconfig',
  is_active: 0,
  connection_status: 'disconnected',
  auto_connect: 0,
  default_namespace: 'default',
  created_at: '刚刚',
  updated_at: '刚刚',
  source_type: 'local',
  bastion_uuid: null,
  bastion_asset_address: null,
  bastion_asset_name: null,
  bastion_asset_id_last: null
}

describe('kubectl table parsing', () => {
  it('parses tabwriter-aligned pod rows with spaced RESTARTS values', () => {
    // kubectl >= 1.23 的 RESTARTS 列可能是 "3 (5m ago)":tabwriter 列间至少 2 空格,单元格内是单空格。
    const output = [
      'NAME               READY   STATUS             RESTARTS      AGE',
      'billing-worker-1   1/1     Running            3 (5m ago)    2d1h',
      'billing-worker-2   0/1     CrashLoopBackOff   12 (18s ago)  9h'
    ].join('\n')

    const parsed = parseKubectlResources(cluster, 'pods', output, 'ops', idPart)

    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toMatchObject({ name: 'billing-worker-1', restarts: 3, age: '2d1h', status: 'Running' })
    expect(parsed[1]).toMatchObject({ name: 'billing-worker-2', restarts: 12, age: '9h', status: 'CrashLoopBackOff' })
  })

  it('parses -o wide pod tables where headers contain spaces', () => {
    const output = [
      'NAME    READY   STATUS    RESTARTS   AGE   IP           NODE      NOMINATED NODE   READINESS GATES',
      'api-0   1/1     Running   0          9d    10.244.0.5   worker1   <none>           <none>'
    ].join('\n')

    const parsed = parseKubectlResources(cluster, 'pods', output, 'default', idPart)

    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toMatchObject({ name: 'api-0', node: 'worker1', restarts: 0, age: '9d' })
  })

  it('still parses single-space tables emitted by test doubles', () => {
    const output = ['NAME READY STATUS RESTARTS AGE', 'api-0 1/1 Running 3 2d'].join('\n')

    const parsed = parseKubectlResources(cluster, 'pods', output, 'default', idPart)

    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toMatchObject({ name: 'api-0', restarts: 3, age: '2d' })
  })
})
