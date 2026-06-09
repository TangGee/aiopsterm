import type { AiopsAssetRecord, TerminalCreateOptions, TerminalKillResult, TerminalSshConnectionInfo, TerminalWriteResult } from '@shared/preload'

export type SshTerminalConnectionTarget = {
  asset?: Partial<
    Pick<AiopsAssetRecord, 'id' | 'name' | 'title' | 'asset_type' | 'organizationId' | 'group_name' | 'auth_type' | 'needProxy' | 'proxyName'>
  > | null
  host: string
  port: number
  username: string
  title?: string
}

const cleanOptional = (value: unknown): string | undefined => {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || undefined
}

export const createSshTerminalConnectionInfo = (
  terminalId: string,
  target: SshTerminalConnectionTarget,
  options: TerminalCreateOptions = {},
  createdAt = Date.now()
): TerminalSshConnectionInfo => {
  const asset = target.asset || null
  const host = cleanOptional(target.host) || ''
  const username = cleanOptional(target.username) || ''
  const title = cleanOptional(target.title) || cleanOptional(asset?.name) || cleanOptional(asset?.title) || host
  return {
    connectionId: `ssh-${terminalId}`,
    host,
    port: Number.isFinite(target.port) ? Math.max(1, Math.min(65535, Math.round(target.port))) : 22,
    username,
    ...(cleanOptional(asset?.id) || cleanOptional(options.assetId) ? { assetId: cleanOptional(asset?.id) || cleanOptional(options.assetId) } : {}),
    assetName: title || host || username || 'ssh',
    ...(cleanOptional(asset?.asset_type) ? { assetType: cleanOptional(asset?.asset_type) } : {}),
    ...(cleanOptional(asset?.organizationId) || cleanOptional(asset?.group_name)
      ? { organizationId: cleanOptional(asset?.organizationId) || cleanOptional(asset?.group_name) }
      : {}),
    ...(cleanOptional(asset?.auth_type) ? { authType: cleanOptional(asset?.auth_type) } : {}),
    ...(asset?.needProxy ? { needProxy: true } : {}),
    ...(asset?.needProxy && cleanOptional(asset?.proxyName) ? { proxyName: cleanOptional(asset?.proxyName) } : {}),
    ...(title ? { title } : {}),
    createdAt,
    ...(cleanOptional(options.ssh?.forkFromConnectionId) ? { forkFromConnectionId: cleanOptional(options.ssh?.forkFromConnectionId) } : {})
  }
}

export const createTerminalWriteResult = (id: string, data: string, exists: boolean): TerminalWriteResult => {
  const sessionId = cleanOptional(id) || ''
  if (!sessionId || !exists) {
    return {
      ok: false,
      errorCode: 'TERMINAL_SESSION_NOT_FOUND',
      errorMessage: 'Terminal session is not available.'
    }
  }
  return {
    ok: true,
    data: {
      id: sessionId,
      bytes: Buffer.byteLength(String(data || ''), 'utf8')
    }
  }
}

export const createTerminalKillResult = (id: string, exists: boolean): TerminalKillResult => {
  const sessionId = cleanOptional(id) || ''
  if (!sessionId || !exists) {
    return {
      ok: false,
      errorCode: 'TERMINAL_SESSION_NOT_FOUND',
      errorMessage: 'Terminal session is not available.'
    }
  }
  return {
    ok: true,
    data: {
      id: sessionId
    }
  }
}
