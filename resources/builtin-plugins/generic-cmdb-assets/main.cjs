'use strict'

const text = function text(value) {
  return String(value || '').trim()
}

const fetchAssets = async function fetchAssets(context) {
  const endpoint = await context.configuration.get('endpoint', '')
  const token = await context.configuration.get('token', '')
  if (!endpoint) throw new Error('请先配置 CMDB 地址')
  const response = await fetch(endpoint, {
    headers: token ? { authorization: `Bearer ${token}` } : {}
  })
  if (!response.ok) throw new Error(`CMDB 请求失败: HTTP ${response.status}`)
  const body = await response.json()
  const rows = Array.isArray(body) ? body : Array.isArray(body.assets) ? body.assets : null
  if (!rows) throw new Error('CMDB 响应必须是数组或包含 assets 数组')
  return rows
}

exports.activate = async function activate(context) {
  context.logger.info('HTTP CMDB Provider activating')

  const testConnection = context.commands.registerCommand('aiopsterm.http-cmdb-provider.test', async function testConnection() {
    const rows = await fetchAssets(context)
    return { message: `CMDB 连接成功，共 ${rows.length} 个资产` }
  })

  const provider = context.assets.registerProvider('aiopsterm.http-cmdb-provider.assets', {
    sync: async function syncAssets() {
      const rows = await fetchAssets(context)
      const defaultGroup = await context.configuration.get('defaultGroup', 'CMDB')
      return rows.map(function normalizeAsset(row, index) {
        const externalId = text(row.externalId || row.id || row.uuid || index + 1)
        const name = text(row.name || row.title || row.hostname || externalId)
        const host = text(row.host || row.address || row.ip)
        if (!name || !host) throw new Error(`第 ${index + 1} 个资产缺少 name 或 host`)
        return {
          id: `http-cmdb-${externalId.replace(/[^a-zA-Z0-9._-]+/g, '-')}`,
          name,
          title: name,
          host,
          ip: host,
          port: Number(row.port || 22),
          username: text(row.username || row.user || 'root'),
          group: text(row.group || defaultGroup),
          group_name: text(row.group || defaultGroup),
          status: row.status === 'offline' ? 'offline' : 'online',
          asset_type: 'person',
          auth_type: 'password',
          data_source: 'refresh',
          comment: text(row.comment || 'Imported by HTTP CMDB Provider'),
          tags: Array.isArray(row.tags) ? row.tags.map(text).filter(Boolean) : []
        }
      })
    }
  })

  context.subscriptions.push(testConnection, provider)
}

exports.deactivate = function deactivate() {}
