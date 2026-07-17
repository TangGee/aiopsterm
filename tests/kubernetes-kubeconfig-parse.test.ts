import { describe, expect, it } from 'vitest'
import { parseKubeconfig, pinKubeconfigCurrentContext } from '@shared/kubernetesKubeconfigRuntime'

// kubectl/client-go 序列化布局:键按字母序,`cluster:`/`context:` 在 `name:` 之前。
// kind、minikube、k3s、EKS 等生成的 kubeconfig 均为此布局。
const canonicalKubeconfig = [
  'apiVersion: v1',
  'clusters:',
  '- cluster:',
  '    certificate-authority-data: LS0tRkFLRQ==',
  '    server: https://127.0.0.1:6443',
  '  name: kind-kind',
  'contexts:',
  '- context:',
  '    cluster: kind-kind',
  '    namespace: kube-system',
  '    user: kind-kind',
  '  name: kind-kind',
  'current-context: kind-kind',
  'kind: Config',
  'preferences: {}',
  'users:',
  '- name: kind-kind',
  '  user:',
  '    client-certificate-data: LS0tRkFLRQ==',
  '    client-key-data: LS0tRkFLRQ=='
].join('\n')

// 手写布局:`- name:` 在前(既有测试与部分手工维护的 kubeconfig)。
const nameFirstKubeconfig = [
  'apiVersion: v1',
  'kind: Config',
  'current-context: qa/dev',
  'clusters:',
  '- name: qa-cluster',
  '  cluster:',
  '    server: https://qa.k8s.local:6443',
  'contexts:',
  '- name: qa/dev',
  '  context:',
  '    cluster: qa-cluster',
  '    namespace: qa'
].join('\n')

describe('kubernetes kubeconfig parsing', () => {
  it('parses canonical kubectl-generated kubeconfig layouts', () => {
    const parsed = parseKubeconfig(canonicalKubeconfig)

    expect(parsed.currentContext).toBe('kind-kind')
    expect(parsed.contexts).toEqual([
      {
        name: 'kind-kind',
        cluster: 'kind-kind',
        server: 'https://127.0.0.1:6443',
        namespace: 'kube-system'
      }
    ])
  })

  it('parses hand-written name-first kubeconfig layouts', () => {
    const parsed = parseKubeconfig(nameFirstKubeconfig)

    expect(parsed.currentContext).toBe('qa/dev')
    expect(parsed.contexts).toEqual([{ name: 'qa/dev', cluster: 'qa-cluster', server: 'https://qa.k8s.local:6443', namespace: 'qa' }])
  })

  it('parses JSON kubeconfig content (kubectl accepts JSON kubeconfigs)', () => {
    const parsed = parseKubeconfig(
      JSON.stringify({
        apiVersion: 'v1',
        kind: 'Config',
        'current-context': 'json/ctx',
        clusters: [{ name: 'json-cluster', cluster: { server: 'https://json.k8s.local:6443' } }],
        contexts: [{ name: 'json/ctx', context: { cluster: 'json-cluster' } }]
      })
    )

    expect(parsed.currentContext).toBe('json/ctx')
    expect(parsed.contexts).toEqual([{ name: 'json/ctx', cluster: 'json-cluster', server: 'https://json.k8s.local:6443', namespace: 'default' }])
  })

  it('deduplicates contexts by name and defaults missing namespaces', () => {
    const parsed = parseKubeconfig(
      [
        'clusters:',
        '- cluster:',
        '    server: https://a.k8s.local:6443',
        '  name: a',
        'contexts:',
        '- context:',
        '    cluster: a',
        '  name: dup',
        '- context:',
        '    cluster: a',
        '    namespace: other',
        '  name: dup'
      ].join('\n')
    )

    expect(parsed.contexts).toEqual([{ name: 'dup', cluster: 'a', server: 'https://a.k8s.local:6443', namespace: 'default' }])
  })

  it('returns an empty context list for unparseable or non-mapping content', () => {
    expect(parseKubeconfig('][ not yaml').contexts).toEqual([])
    expect(parseKubeconfig('- just\n- a\n- list').contexts).toEqual([])
    expect(parseKubeconfig('').contexts).toEqual([])
  })

  it('pins current-context without touching the rest of the document', () => {
    const pinned = pinKubeconfigCurrentContext(canonicalKubeconfig, 'other-context')

    expect(pinned).not.toBeNull()
    const parsed = parseKubeconfig(pinned!)
    expect(parsed.currentContext).toBe('other-context')
    expect(parsed.contexts).toHaveLength(1)
    expect(pinned).toContain('client-certificate-data: LS0tRkFLRQ==')

    expect(pinKubeconfigCurrentContext('][ not yaml', 'x')).toBeNull()
  })
})
