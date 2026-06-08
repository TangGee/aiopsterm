export const aiopstermProtocolScheme = 'aiopsterm'
export const aiopstermProtocolPrefix = `${aiopstermProtocolScheme}://`

export type AiopstermDeepLinkAction = 'open'
export type AiopstermDeepLinkTarget =
  | 'workspace'
  | 'assets'
  | 'files'
  | 'snippets'
  | 'knowledge'
  | 'extensions'
  | 'kubernetes'
  | 'database'
  | 'settings'
  | 'user'
  | 'agents'
export type AiopstermDeepLinkModule = Exclude<AiopstermDeepLinkTarget, 'agents'>
export type AiopstermDeepLinkSettingsSection =
  | 'general'
  | 'terminal'
  | 'extensions'
  | 'models'
  | 'billing'
  | 'ai'
  | 'mcp'
  | 'skills'
  | 'rules'
  | 'shortcuts'
  | 'trustedDevices'
  | 'privacy'
  | 'about'
  | 'docs'

export type AiopstermDeepLinkPayload = {
  url: string
  action: AiopstermDeepLinkAction
  target: AiopstermDeepLinkTarget
  module?: AiopstermDeepLinkModule
  settingsSection?: AiopstermDeepLinkSettingsSection
  source?: string
  acceptedAt: number
}

export type AiopstermDeepLinkParseResult =
  | { valid: true; payload: Omit<AiopstermDeepLinkPayload, 'acceptedAt'> }
  | { valid: false; reason: 'invalid-url' | 'unsupported-protocol' | 'internal-ref' | 'unsupported-action' | 'unsupported-target' | 'unsupported-settings-section' }

const moduleTargets = new Set<AiopstermDeepLinkModule>(['workspace', 'assets', 'files', 'snippets', 'knowledge', 'extensions', 'kubernetes', 'database', 'settings', 'user'])
const settingsTargets = new Set<AiopstermDeepLinkSettingsSection>([
  'general',
  'terminal',
  'extensions',
  'models',
  'billing',
  'ai',
  'mcp',
  'skills',
  'rules',
  'shortcuts',
  'trustedDevices',
  'privacy',
  'about',
  'docs'
])
const internalHosts = new Set(['chat-attachment'])

const normalizeModuleTarget = (value: string | null | undefined): AiopstermDeepLinkTarget | null => {
  const normalized = (value || '').trim()
  if (normalized === 'agents') return 'agents'
  if (moduleTargets.has(normalized as AiopstermDeepLinkModule)) return normalized as AiopstermDeepLinkModule
  return null
}

const normalizeSettingsSection = (value: string | null | undefined): AiopstermDeepLinkSettingsSection | null => {
  const normalized = (value || '').trim()
  if (!normalized) return null
  if (settingsTargets.has(normalized as AiopstermDeepLinkSettingsSection)) return normalized as AiopstermDeepLinkSettingsSection
  return null
}

export const parseAiopstermDeepLink = (rawUrl: string): AiopstermDeepLinkParseResult => {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return { valid: false, reason: 'invalid-url' }
  }

  if (parsed.protocol !== `${aiopstermProtocolScheme}:`) {
    return { valid: false, reason: 'unsupported-protocol' }
  }

  const host = parsed.hostname
  if (internalHosts.has(host)) {
    return { valid: false, reason: 'internal-ref' }
  }

  const action = host || parsed.pathname.replace(/^\/+/, '').split('/')[0] || 'open'
  if (action !== 'open') {
    return { valid: false, reason: 'unsupported-action' }
  }

  const pathParts = parsed.pathname.split('/').filter(Boolean)
  const pathTarget = host === 'open' ? pathParts[0] : host
  const queryTarget = parsed.searchParams.get('target') || parsed.searchParams.get('module')
  const target = normalizeModuleTarget(queryTarget || pathTarget || 'workspace')
  if (!target) {
    return { valid: false, reason: 'unsupported-target' }
  }

  const sectionCandidate = parsed.searchParams.get('section') || (target === 'settings' ? pathParts[1] : null)
  const settingsSection = sectionCandidate ? normalizeSettingsSection(sectionCandidate) : null
  if (sectionCandidate && !settingsSection) {
    return { valid: false, reason: 'unsupported-settings-section' }
  }

  return {
    valid: true,
    payload: {
      url: parsed.toString(),
      action: 'open',
      target,
      module: target === 'agents' ? undefined : target,
      settingsSection: target === 'settings' ? settingsSection || 'general' : undefined,
      source: parsed.searchParams.get('source') || undefined
    }
  }
}
