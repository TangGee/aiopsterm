import { describe, expect, it, vi } from 'vitest'

import {
  fetchJumpserverHosts,
  jumpserverHostToAssetInput,
  normalizeJumpserverApiUrl
} from '../src/shared/jumpserverClient'
import type { AiopsAssetRecord } from '../src/shared/contracts/assets'

const organization: AiopsAssetRecord = {
  id: 'org-local',
  uuid: 'org-remote',
  name: 'jumpserver-prod',
  title: 'jumpserver-prod',
  host: 'jumpserver.example.com',
  ip: 'jumpserver.example.com',
  group: '企业',
  group_name: '企业',
  status: 'online',
  tags: ['jumpserver'],
  username: 'ops',
  port: 22,
  asset_type: 'organization',
  auth_type: 'password',
  comment: '',
  data_source: 'refresh',
  bastionType: 'jumpserver',
  jumpserverApiUrl: 'https://jumpserver.example.com'
}

describe('JumpServer API client', () => {
  it('loads all host pages with PrivateToken and organization headers', async () => {
    const calls: Array<{ url: string; headers: Headers }> = []
    const fetchRuntime = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, headers: new Headers(init?.headers) })
      if (calls.length === 1) {
        return new Response(
          JSON.stringify({
            count: 2,
            next: '/api/v1/assets/hosts/?limit=1&offset=1',
            results: [{ id: 'host-1', name: 'prod-1', address: '10.0.0.1' }]
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }
      return new Response(
        JSON.stringify({
          count: 2,
          next: null,
          results: [{ id: 'host-2', name: 'prod-2', address: '10.0.0.2' }]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }) as typeof fetch

    const hosts = await fetchJumpserverHosts(fetchRuntime, {
      apiUrl: 'https://jumpserver.example.com/',
      privateToken: 'private-token',
      organizationId: 'org-id'
    })

    expect(hosts).toHaveLength(2)
    expect(calls[0].url).toContain('/api/v1/assets/hosts/?limit=100&offset=0')
    expect(calls[0].headers.get('Authorization')).toBe('PrivateToken private-token')
    expect(calls[0].headers.get('X-JMS-ORG')).toBe('org-id')
    expect(calls[1].url).toBe('https://jumpserver.example.com/api/v1/assets/hosts/?limit=1&offset=1')
  })

  it('maps JumpServer host metadata into a stable synced asset', () => {
    const asset = jumpserverHostToAssetInput(organization, {
      id: 'remote-host',
      name: 'prod-api',
      address: '10.20.0.8',
      is_active: true,
      connectivity: { value: 'ok' },
      category: { value: 'host' },
      type: { value: 'linux' },
      protocols: [{ name: 'ssh', port: 2202 }],
      nodes_display: [{ full_value: '生产/应用' }],
      comment: 'production api'
    })

    expect(asset).toMatchObject({
      id: 'jumpserver-org-remote-remote-host',
      title: 'prod-api',
      host: '10.20.0.8',
      port: 2202,
      username: 'ops',
      group: '生产/应用',
      status: 'online',
      organizationId: 'org-remote',
      jumpHostId: 'org-local',
      jumpserverAssetId: 'remote-host'
    })
    expect(asset?.tags).toEqual(['jumpserver', 'synced', 'host', 'linux'])
  })

  it('rejects invalid configuration, authorization failures, and cross-origin pagination', async () => {
    expect(() => normalizeJumpserverApiUrl('file:///tmp/jumpserver')).toThrow('HTTP')
    await expect(
      fetchJumpserverHosts(vi.fn(async () => new Response('{}', { status: 401 })) as typeof fetch, {
        apiUrl: 'https://jumpserver.example.com',
        privateToken: 'bad-token'
      })
    ).rejects.toMatchObject({ code: 'JUMPSERVER_API_AUTH_FAILED' })
    await expect(
      fetchJumpserverHosts(
        vi.fn(
          async () =>
            new Response(JSON.stringify({ results: [], next: 'https://other.example.com/api/v1/assets/hosts/' }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            })
        ) as typeof fetch,
        {
          apiUrl: 'https://jumpserver.example.com',
          privateToken: 'private-token'
        }
      )
    ).rejects.toMatchObject({ code: 'JUMPSERVER_API_MALFORMED' })
  })
})
