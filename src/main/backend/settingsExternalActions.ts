import { mkdir, stat as fsStat, writeFile as fsWriteFile } from 'fs/promises'
import { join, resolve } from 'path'
import type { Stats } from 'fs'
import type { OpenPathResult } from '@shared/preload'

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

const documentationCandidates = (runtime: SettingsExternalActionRuntime) =>
  uniquePaths([runtime.cwd, runtime.appPath, runtime.moduleDir ? resolve(runtime.moduleDir, '..', '..') : undefined]).map((root) => join(root, 'docs', 'index.md'))

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

const openPath = async (path: string, runtime: SettingsExternalActionRuntime): Promise<OpenPathResult> => {
  if (!runtime.skipOpen) {
    const error = await runtime.openPath(path)
    if (typeof error === 'string' && error.trim()) throw new SettingsExternalActionError(error)
  }
  return { path }
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

export const openSettingsDocumentation = async (runtime: SettingsExternalActionRuntime): Promise<OpenPathResult> => {
  const docsPath = await resolveDocumentationPath(runtime)
  return openPath(docsPath, runtime)
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
  feedbackFileName
}
