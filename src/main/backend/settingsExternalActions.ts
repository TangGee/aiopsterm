import { mkdir, readFile as fsReadFile, stat as fsStat, writeFile as fsWriteFile } from 'fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'path'
import type { Stats } from 'fs'
import type { OpenPathResult, OpenSettingsDocumentationInput, SettingsDocumentationPage, SettingsDocumentationResult } from '@shared/preload'

type SettingsExternalActionRuntime = {
  userDataPath: string
  appPath?: string
  cwd?: string
  moduleDir?: string
  version: string
  platform: string
  arch: string
  openPath: (path: string) => Promise<string | void>
  skipOpen?: boolean
  now?: () => Date
  mkdir?: typeof mkdir
  readFile?: typeof fsReadFile
  writeFile?: typeof fsWriteFile
  stat?: typeof fsStat
}

class SettingsExternalActionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SettingsExternalActionError'
  }
}

const uniquePaths = (paths: Array<string | undefined>) => {
  const seen = new Set<string>()
  return paths
    .filter((item): item is string => Boolean(item && item.trim()))
    .map((item) => resolve(item))
    .filter((item) => {
      if (seen.has(item)) return false
      seen.add(item)
      return true
    })
}

const settingsDocumentationFiles: Record<SettingsDocumentationPage, string> = {
  general: 'general.md',
  terminal: 'terminal.md',
  extensions: 'extensions.md',
  models: 'models.md',
  billing: 'billing.md',
  ai: 'ai.md',
  mcp: 'mcp.md',
  skills: 'skills.md',
  rules: 'rules.md',
  shortcuts: 'shortcuts.md',
  trustedDevices: 'trusted-devices.md',
  privacy: 'privacy.md',
  about: 'about.md'
}

const supportedDocumentationLocales = ['zh-CN', 'zh-TW', 'en-US'] as const
type SupportedDocumentationLocale = (typeof supportedDocumentationLocales)[number]

const isSettingsDocumentationPage = (page: unknown): page is SettingsDocumentationPage =>
  typeof page === 'string' && Object.prototype.hasOwnProperty.call(settingsDocumentationFiles, page)

const normalizeDocumentationLocale = (locale: unknown): SupportedDocumentationLocale | undefined => {
  if (typeof locale !== 'string') return undefined
  if (supportedDocumentationLocales.includes(locale as SupportedDocumentationLocale)) return locale as SupportedDocumentationLocale
  return undefined
}

const documentationRoots = (runtime: SettingsExternalActionRuntime) =>
  uniquePaths([runtime.cwd, runtime.appPath, runtime.moduleDir ? resolve(runtime.moduleDir, '..', '..') : undefined]).map((root) => join(root, 'docs'))

const documentationCandidates = (runtime: SettingsExternalActionRuntime) =>
  documentationRoots(runtime).map((root) => join(root, 'index.md'))

const isPathInside = (parent: string, child: string) => {
  const relPath = relative(parent, child)
  return Boolean(relPath) && !relPath.startsWith('..') && !isAbsolute(relPath)
}

const isMarkdownDocumentPath = (path: string) => /\.(md|markdown)$/i.test(path)

const settingsDocumentationCandidates = (runtime: SettingsExternalActionRuntime, page: SettingsDocumentationPage, locale?: SupportedDocumentationLocale) => {
  const fileName = settingsDocumentationFiles[page]
  const locales: SupportedDocumentationLocale[] =
    locale === 'zh-CN' ? ['zh-CN', 'en-US', 'zh-TW'] : locale === 'zh-TW' ? ['zh-TW', 'zh-CN', 'en-US'] : ['en-US', 'zh-CN', 'zh-TW']
  return documentationRoots(runtime).flatMap((root) => locales.map((candidateLocale) => join(root, 'usage', 'settings', candidateLocale, fileName)))
}

const isFile = async (path: string, statFn: typeof fsStat) => {
  try {
    const stats: Stats = await statFn(path)
    return stats.isFile()
  } catch {
    return false
  }
}

const resolveDocumentationPath = async (runtime: SettingsExternalActionRuntime) => {
  const statFn = runtime.stat || fsStat
  for (const candidate of documentationCandidates(runtime)) {
    if (await isFile(candidate, statFn)) return candidate
  }
  throw new SettingsExternalActionError('aiopsterm documentation entry was not found.')
}

const resolveSettingsDocumentationPath = async (runtime: SettingsExternalActionRuntime, input: OpenSettingsDocumentationInput = {}) => {
  const documentPath = typeof input.documentPath === 'string' ? input.documentPath.trim().split(/[?#]/, 1)[0] : ''
  if (documentPath) {
    const statFn = runtime.stat || fsStat
    const basePath = typeof input.basePath === 'string' && input.basePath.trim() ? input.basePath.trim() : ''
    const docsRoots = documentationRoots(runtime)
    const candidates = docsRoots.map((root) => {
      const absoluteBase = basePath && isAbsolute(basePath) && isPathInside(root, basePath) ? dirname(basePath) : root
      return resolve(absoluteBase, documentPath)
    })
    for (const candidate of candidates) {
      if (!isMarkdownDocumentPath(candidate)) continue
      if (!docsRoots.some((root) => isPathInside(root, candidate))) continue
      if (await isFile(candidate, statFn)) return candidate
    }
    throw new SettingsExternalActionError('aiopsterm documentation file was not found.')
  }
  if (!isSettingsDocumentationPage(input.page)) return resolveDocumentationPath(runtime)
  const statFn = runtime.stat || fsStat
  const locale = normalizeDocumentationLocale(input.locale)
  for (const candidate of settingsDocumentationCandidates(runtime, input.page, locale)) {
    if (await isFile(candidate, statFn)) return candidate
  }
  throw new SettingsExternalActionError(`aiopsterm settings documentation for ${input.page} was not found.`)
}

const openPath = async (path: string, runtime: SettingsExternalActionRuntime): Promise<OpenPathResult> => {
  if (!runtime.skipOpen) {
    const error = await runtime.openPath(path)
    if (typeof error === 'string' && error.trim()) throw new SettingsExternalActionError(error)
  }
  return { path }
}

const titleFromMarkdown = (content: string, fallback: string) => {
  const heading = content.split(/\r?\n/).find((line) => /^#\s+\S/.test(line))
  return heading?.replace(/^#\s+/, '').trim() || fallback
}

const feedbackFileName = (date: Date) => `aiopsterm-feedback-${date.toISOString().replace(/[:.]/g, '-')}.md`

const feedbackReportContent = async (runtime: SettingsExternalActionRuntime, generatedAt: Date) => {
  let docsPath = 'unavailable'
  try {
    docsPath = await resolveDocumentationPath(runtime)
  } catch {
    docsPath = 'unavailable'
  }
  return [
    '# aiopsterm Feedback Report',
    '',
    `Generated At: ${generatedAt.toISOString()}`,
    `Version: ${runtime.version}`,
    `Platform: ${runtime.platform}`,
    `Architecture: ${runtime.arch}`,
    `Log Directory: ${join(runtime.userDataPath, 'logs')}`,
    `Documentation: ${docsPath}`,
    '',
    'Describe the issue, expected behavior, actual behavior, and reproduction steps below.',
    ''
  ].join('\n')
}

export const openSettingsDocumentation = async (runtime: SettingsExternalActionRuntime, input: OpenSettingsDocumentationInput = {}): Promise<SettingsDocumentationResult> => {
  const docsPath = await resolveSettingsDocumentationPath(runtime, input)
  const content = await (runtime.readFile || fsReadFile)(docsPath, 'utf-8')
  return {
    path: docsPath,
    title: titleFromMarkdown(String(content), docsPath.split(/[\\/]/).pop() || 'Documentation'),
    content: String(content)
  }
}

export const submitSettingsFeedbackReport = async (runtime: SettingsExternalActionRuntime): Promise<OpenPathResult> => {
  if (!runtime.userDataPath?.trim()) throw new SettingsExternalActionError('User data path is unavailable.')
  const mkdirFn = runtime.mkdir || mkdir
  const writeFileFn = runtime.writeFile || fsWriteFile
  const generatedAt = runtime.now?.() || new Date()
  const feedbackDir = join(runtime.userDataPath, 'feedback')
  await mkdirFn(feedbackDir, { recursive: true })
  const reportPath = join(feedbackDir, feedbackFileName(generatedAt))
  await writeFileFn(reportPath, await feedbackReportContent(runtime, generatedAt), 'utf-8')
  return openPath(reportPath, runtime)
}

export const __testing = {
  documentationCandidates,
  settingsDocumentationCandidates,
  feedbackFileName
}
