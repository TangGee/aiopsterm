import type { AiopsAssetInput, AiopsAssetRecord } from '@shared/contracts/assets'

export type JumpserverFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export type JumpserverClientConfig = {
  apiUrl: string
  privateToken: string
  organizationId?: string
}

export const createJumpserverSeedFetch = (): JumpserverFetch =>
  (async () =>
    new Response(
      JSON.stringify({
        count: 1,
        next: null,
        results: [
          {
            id: 'seed-asset',
            name: 'jumpserver-org-synced-asset',
            address: '10.90.0.15',
            is_active: true,
            connectivity: { value: 'ok' },
            category: { value: 'host' },
            type: { value: 'linux' },
            protocols: [{ name: 'ssh', port: 22, primary: true }],
            nodes_display: [{ full_value: '企业' }],
            comment: '刷新来源资产'
          }
        ]
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    )) as JumpserverFetch

type JumpserverProtocol = {
  name?: unknown
  port?: unknown
  primary?: unknown
}

type JumpserverHost = {
  id?: unknown
  name?: unknown
  address?: unknown
  comment?: unknown
  is_active?: unknown
  connectivity?: unknown
  category?: unknown
  type?: unknown
  platform?: unknown
  protocols?: unknown
  nodes?: unknown
  nodes_display?: unknown
}

type JumpserverPage = {
  results: JumpserverHost[]
  next: string | null
  count?: number
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const labeledValue = (value: unknown) => {
  if (typeof value === 'string') return value.trim()
  if (!value || typeof value !== 'object') return ''
  const record = value as Record<string, unknown>
  return text(record.value) || text(record.label) || text(record.name)
}

const jumpserverError = (code: string, message: string) => Object.assign(new Error(message), { code })

export const normalizeJumpserverApiUrl = (value: string) => {
  const candidate = value.trim()
  if (!candidate) throw jumpserverError('JUMPSERVER_API_URL_REQUIRED', '请填写 JumpServer API 地址。')
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    throw jumpserverError('JUMPSERVER_API_URL_INVALID', 'JumpServer API 地址无效。')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw jumpserverError('JUMPSERVER_API_URL_INVALID', 'JumpServer API 地址必须是无凭据的 HTTP 或 HTTPS 地址。')
  }
  url.hash = ''
  url.search = ''
  url.pathname = url.pathname.replace(/\/+$/, '')
  return url
}

const parsePage = (value: unknown): JumpserverPage => {
  if (Array.isArray(value)) return { results: value as JumpserverHost[], next: null }
  if (!value || typeof value !== 'object') {
    throw jumpserverError('JUMPSERVER_API_MALFORMED', 'JumpServer 返回了无法识别的资产列表。')
  }
  const record = value as Record<string, unknown>
  const nested = record.data && typeof record.data === 'object' ? (record.data as Record<string, unknown>) : null
  const results = Array.isArray(record.results)
    ? record.results
    : Array.isArray(record.data)
      ? record.data
      : Array.isArray(nested?.results)
        ? nested.results
        : null
  if (!results) throw jumpserverError('JUMPSERVER_API_MALFORMED', 'JumpServer 返回的资产列表缺少 results。')
  const nextValue = record.next ?? nested?.next
  const countValue = record.count ?? nested?.count
  return {
    results: results as JumpserverHost[],
    next: typeof nextValue === 'string' && nextValue.trim() ? nextValue.trim() : null,
    ...(Number.isFinite(Number(countValue)) ? { count: Number(countValue) } : {})
  }
}

const responseErrorText = async (response: Response) => {
  try {
    const value = await response.json()
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>
      return text(record.detail) || text(record.error) || text(record.message)
    }
  } catch {}
  return ''
}

const resolveNextUrl = (base: URL, current: URL, next: string) => {
  const url = new URL(next, current)
  if (url.origin !== base.origin) {
    throw jumpserverError('JUMPSERVER_API_MALFORMED', 'JumpServer 分页地址跳转到了不同的服务。')
  }
  return url
}

export const fetchJumpserverHosts = async (
  fetchRuntime: JumpserverFetch,
  config: JumpserverClientConfig
): Promise<JumpserverHost[]> => {
  const base = normalizeJumpserverApiUrl(config.apiUrl)
  const token = config.privateToken.trim()
  if (!token) throw jumpserverError('JUMPSERVER_TOKEN_REQUIRED', '请填写 JumpServer Private Token。')
  let pageUrl = new URL(`${base.pathname}/api/v1/assets/hosts/`.replace(/\/{2,}/g, '/'), base)
  pageUrl.searchParams.set('limit', '100')
  pageUrl.searchParams.set('offset', '0')
  const hosts: JumpserverHost[] = []
  const visited = new Set<string>()

  for (let pageIndex = 0; pageIndex < 100; pageIndex += 1) {
    if (visited.has(pageUrl.href)) throw jumpserverError('JUMPSERVER_API_PAGINATION_LOOP', 'JumpServer 资产分页出现循环。')
    visited.add(pageUrl.href)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000)
    let response: Response
    try {
      response = await fetchRuntime(pageUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Token ${token}`,
          ...(config.organizationId?.trim() ? { 'X-JMS-ORG': config.organizationId.trim() } : {})
        },
        signal: controller.signal
      })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw jumpserverError('JUMPSERVER_API_UNREACHABLE', `无法访问 JumpServer API：${detail}`)
    } finally {
      clearTimeout(timeout)
    }
    if (!response.ok) {
      const detail = await responseErrorText(response)
      const suffix = detail ? `：${detail}` : ''
      const code = response.status === 401 || response.status === 403 ? 'JUMPSERVER_API_AUTH_FAILED' : 'JUMPSERVER_API_REQUEST_FAILED'
      throw jumpserverError(code, `JumpServer API 请求失败，HTTP ${response.status}${suffix}`)
    }
    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw jumpserverError('JUMPSERVER_API_MALFORMED', 'JumpServer API 返回的不是 JSON。')
    }
    const page = parsePage(body)
    hosts.push(...page.results)
    if (page.next) {
      pageUrl = resolveNextUrl(base, pageUrl, page.next)
      continue
    }
    if (page.count !== undefined && hosts.length < page.count && page.results.length) {
      const offset = Number(pageUrl.searchParams.get('offset') || 0) + page.results.length
      pageUrl.searchParams.set('offset', String(offset))
      continue
    }
    return hosts
  }
  throw jumpserverError('JUMPSERVER_API_PAGE_LIMIT', 'JumpServer 资产分页超过 100 页。')
}

const nodeName = (value: unknown): string => {
  if (typeof value === 'string') return value.trim()
  if (!value || typeof value !== 'object') return ''
  const record = value as Record<string, unknown>
  return text(record.full_value) || text(record.value) || text(record.name) || text(record.label)
}

const hostGroup = (host: JumpserverHost, fallback: string) => {
  const displays = Array.isArray(host.nodes_display) ? host.nodes_display : []
  const nodes = Array.isArray(host.nodes) ? host.nodes : []
  return displays.map(nodeName).find(Boolean) || nodes.map(nodeName).find(Boolean) || fallback
}

const sshPort = (host: JumpserverHost) => {
  const protocols = Array.isArray(host.protocols) ? (host.protocols as JumpserverProtocol[]) : []
  const ssh = protocols.find((protocol) => text(protocol.name).toLowerCase() === 'ssh')
  const port = Number(ssh?.port)
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : 22
}

const hostStatus = (host: JumpserverHost): AiopsAssetRecord['status'] => {
  if (host.is_active === false) return 'offline'
  const connectivity = labeledValue(host.connectivity).toLowerCase()
  if (['ok', 'success', 'connected', 'reachable'].includes(connectivity)) return 'online'
  if (['failed', 'error', 'unreachable'].includes(connectivity)) return 'offline'
  return host.is_active === true ? 'online' : 'unknown'
}

export const jumpserverHostToAssetInput = (
  organization: AiopsAssetRecord,
  host: JumpserverHost
): AiopsAssetInput | null => {
  const remoteId = text(host.id)
  const address = text(host.address)
  if (!remoteId || !address) return null
  const title = text(host.name) || address
  const group = hostGroup(host, organization.group_name || organization.group || '企业')
  const category = labeledValue(host.category).toLowerCase()
  const type = labeledValue(host.type).toLowerCase()
  return {
    id: `jumpserver-${organization.uuid || organization.id}-${remoteId}`,
    name: title,
    title,
    host: address,
    ip: address,
    group,
    group_name: group,
    status: hostStatus(host),
    tags: ['jumpserver', 'synced', category, type].filter(Boolean),
    username: organization.username,
    port: sshPort(host),
    asset_type: 'person',
    auth_type: 'password',
    comment: text(host.comment),
    data_source: 'refresh',
    organizationId: organization.uuid || organization.id,
    jumpHostId: organization.id,
    jumpserverAssetId: remoteId
  }
}
