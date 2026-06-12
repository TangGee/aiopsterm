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

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const isModuleTarget = (value: unknown): value is AiopstermDeepLinkModule => typeof value === 'string' && moduleTargets.has(value as AiopstermDeepLinkModule)
const isDeepLinkTarget = (value: unknown): value is AiopstermDeepLinkTarget => value === 'agents' || isModuleTarget(value)
const isSettingsSection = (value: unknown): value is AiopstermDeepLinkSettingsSection => typeof value === 'string' && settingsTargets.has(value as AiopstermDeepLinkSettingsSection)

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

export const isAiopstermDeepLinkPayload = (value: unknown): value is AiopstermDeepLinkPayload => {
  if (!isRecord(value)) return false
  if (typeof value.url !== 'string' || !value.url.startsWith(aiopstermProtocolPrefix)) return false
  if (value.action !== 'open') return false
  if (!isDeepLinkTarget(value.target)) return false
  if (typeof value.acceptedAt !== 'number' || !Number.isFinite(value.acceptedAt) || value.acceptedAt < 0) return false
  if (value.source !== undefined && typeof value.source !== 'string') return false

  const parsed = parseAiopstermDeepLink(value.url)
  if (!parsed.valid) return false
  if (parsed.payload.url !== value.url) return false
  if (parsed.payload.action !== value.action) return false
  if (parsed.payload.target !== value.target) return false
  if ((parsed.payload.source ?? undefined) !== (value.source ?? undefined)) return false

  if (value.target === 'agents') {
    return value.module === undefined && value.settingsSection === undefined
  }

  if (value.module !== undefined && value.module !== value.target) return false
  if (parsed.payload.module !== value.target) return false

  if (value.target === 'settings') {
    return value.settingsSection !== undefined && isSettingsSection(value.settingsSection) && value.settingsSection === parsed.payload.settingsSection
  }

  return value.settingsSection === undefined
}
