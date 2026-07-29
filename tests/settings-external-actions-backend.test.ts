import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeAll, describe, expect, it } from 'vitest'

type OpenSettingsDocumentationTestInput = { page?: string; locale?: string; documentPath?: string; basePath?: string }

type SettingsExternalActionsBackend = {
  openSettingsDocumentation: (runtime: ReturnType<typeof makeRuntime>, input?: OpenSettingsDocumentationTestInput) => Promise<{ path: string; title: string; content: string }>
  submitSettingsFeedbackReport: (runtime: ReturnType<typeof makeRuntime> & { now?: () => Date }) => Promise<{ path: string }>
}

let backend: SettingsExternalActionsBackend

const makeRuntime = (root: string, opened: string[] = []) => ({
  userDataPath: join(root, 'user-data'),
  cwd: root,
  version: '0.1.0',
  platform: 'linux',
  arch: 'x64',
  openPath: async (path: string) => {
    opened.push(path)
    return ''
  }
})

describe('settings external action backend boundary', () => {
  beforeAll(async () => {
    const modulePath = '../src/main/backend/settings/settingsExternalActions'
    backend = (await import(modulePath)) as SettingsExternalActionsBackend
  })

  it('reads the self-owned local documentation entry instead of requiring a placeholder URL or OS opener', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-settings-docs-'))
    try {
      const docsPath = join(root, 'docs', 'index.md')
      await mkdir(join(root, 'docs'), { recursive: true })
      await writeFile(docsPath, '# aiopsterm Docs\n', 'utf-8')
      const opened: string[] = []

      const result = await backend.openSettingsDocumentation(makeRuntime(root, opened))

      expect(result).toEqual({ path: docsPath, title: 'aiopsterm Docs', content: '# aiopsterm Docs\n' })
      expect(opened).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('opens whitelisted settings page Markdown for the requested locale', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-settings-page-docs-'))
    try {
      const docsPath = join(root, 'docs', 'index.md')
      const generalZhPath = join(root, 'docs', 'usage', 'settings', 'zh-CN', 'general.md')
      const generalEnPath = join(root, 'docs', 'usage', 'settings', 'en-US', 'general.md')
      const aiNotificationsZhPath = join(root, 'docs', 'usage', 'settings', 'zh-CN', 'ai-notifications.md')
      const aiNotificationsEnPath = join(root, 'docs', 'usage', 'settings', 'en-US', 'ai-notifications.md')
      const aiRemoteZhPath = join(root, 'docs', 'usage', 'settings', 'zh-CN', 'ai-remote-host-management.md')
      const aiRemoteEnPath = join(root, 'docs', 'usage', 'settings', 'en-US', 'ai-remote-host-management.md')
      const commandSecurityZhPath = join(root, 'docs', 'usage', 'settings', 'zh-CN', 'command-security.md')
      const commandSecurityEnPath = join(root, 'docs', 'usage', 'settings', 'en-US', 'command-security.md')
      const exportMcpZhPath = join(root, 'docs', 'usage', 'settings', 'zh-CN', 'export-mcp.md')
      const exportMcpEnPath = join(root, 'docs', 'usage', 'settings', 'en-US', 'export-mcp.md')
      await mkdir(join(root, 'docs', 'usage', 'settings', 'zh-CN'), { recursive: true })
      await mkdir(join(root, 'docs', 'usage', 'settings', 'en-US'), { recursive: true })
      await writeFile(docsPath, '# aiopsterm Docs\n', 'utf-8')
      await writeFile(generalZhPath, '# 通用设置\n', 'utf-8')
      await writeFile(generalEnPath, '# General Settings\n', 'utf-8')
      await writeFile(aiNotificationsZhPath, '# AI 通知\n', 'utf-8')
      await writeFile(aiNotificationsEnPath, '# AI Notifications\n', 'utf-8')
      await writeFile(aiRemoteZhPath, '# 主机Agent\n', 'utf-8')
      await writeFile(aiRemoteEnPath, '# Host Agent\n', 'utf-8')
      await writeFile(commandSecurityZhPath, '# 命令安全设置\n', 'utf-8')
      await writeFile(commandSecurityEnPath, '# Command Security Settings\n', 'utf-8')
      await writeFile(exportMcpZhPath, '# 导出 MCP\n', 'utf-8')
      await writeFile(exportMcpEnPath, '# Export MCP\n', 'utf-8')
      const opened: string[] = []

      const zhResult = await backend.openSettingsDocumentation(makeRuntime(root, opened), { page: 'general', locale: 'zh-CN' })
      const enResult = await backend.openSettingsDocumentation(makeRuntime(root, opened), { page: 'general', locale: 'en-US' })
      const zhNotificationsResult = await backend.openSettingsDocumentation(makeRuntime(root, opened), { page: 'aiNotifications', locale: 'zh-CN' })
      const enNotificationsResult = await backend.openSettingsDocumentation(makeRuntime(root, opened), { page: 'aiNotifications', locale: 'en-US' })
      const zhRemoteResult = await backend.openSettingsDocumentation(makeRuntime(root, opened), { page: 'aiRemoteHostManagement', locale: 'zh-CN' })
      const enRemoteResult = await backend.openSettingsDocumentation(makeRuntime(root, opened), { page: 'aiRemoteHostManagement', locale: 'en-US' })
      const zhCommandSecurityResult = await backend.openSettingsDocumentation(makeRuntime(root, opened), { page: 'commandSecurity', locale: 'zh-CN' })
      const enCommandSecurityResult = await backend.openSettingsDocumentation(makeRuntime(root, opened), { page: 'commandSecurity', locale: 'en-US' })
      const zhExportResult = await backend.openSettingsDocumentation(makeRuntime(root, opened), { page: 'exportMcp', locale: 'zh-CN' })
      const enExportResult = await backend.openSettingsDocumentation(makeRuntime(root, opened), { page: 'exportMcp', locale: 'en-US' })
      const unknownResult = await backend.openSettingsDocumentation(makeRuntime(root, opened), { page: '../general', locale: 'zh-CN' })

      expect(zhResult).toEqual({ path: generalZhPath, title: '通用设置', content: '# 通用设置\n' })
      expect(enResult).toEqual({ path: generalEnPath, title: 'General Settings', content: '# General Settings\n' })
      expect(zhNotificationsResult).toEqual({ path: aiNotificationsZhPath, title: 'AI 通知', content: '# AI 通知\n' })
      expect(enNotificationsResult).toEqual({ path: aiNotificationsEnPath, title: 'AI Notifications', content: '# AI Notifications\n' })
      expect(zhRemoteResult).toEqual({ path: aiRemoteZhPath, title: '主机Agent', content: '# 主机Agent\n' })
      expect(enRemoteResult).toEqual({ path: aiRemoteEnPath, title: 'Host Agent', content: '# Host Agent\n' })
      expect(zhCommandSecurityResult).toEqual({ path: commandSecurityZhPath, title: '命令安全设置', content: '# 命令安全设置\n' })
      expect(enCommandSecurityResult).toEqual({ path: commandSecurityEnPath, title: 'Command Security Settings', content: '# Command Security Settings\n' })
      expect(zhExportResult).toEqual({ path: exportMcpZhPath, title: '导出 MCP', content: '# 导出 MCP\n' })
      expect(enExportResult).toEqual({ path: exportMcpEnPath, title: 'Export MCP', content: '# Export MCP\n' })
      expect(unknownResult).toEqual({ path: docsPath, title: 'aiopsterm Docs', content: '# aiopsterm Docs\n' })
      expect(opened).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('opens relative Markdown links only inside the self-owned documentation tree', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-settings-linked-docs-'))
    try {
      const docsPath = join(root, 'docs', 'index.md')
      const usagePath = join(root, 'docs', 'usage', 'index.md')
      const outsidePath = join(root, 'outside.md')
      await mkdir(join(root, 'docs', 'usage'), { recursive: true })
      await writeFile(docsPath, '# aiopsterm Docs\n\n[Usage](usage/index.md)\n', 'utf-8')
      await writeFile(usagePath, '# Usage Docs\n', 'utf-8')
      await writeFile(outsidePath, '# Outside\n', 'utf-8')
      const opened: string[] = []

      const result = await backend.openSettingsDocumentation(makeRuntime(root, opened), { documentPath: 'usage/index.md', basePath: docsPath })

      expect(result).toEqual({ path: usagePath, title: 'Usage Docs', content: '# Usage Docs\n' })
      expect(opened).toEqual([])
      await expect(backend.openSettingsDocumentation(makeRuntime(root, opened), { documentPath: '../outside.md', basePath: docsPath })).rejects.toThrow(
        'documentation file was not found'
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('creates and opens a local feedback report with diagnostics metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-settings-feedback-'))
    try {
      await mkdir(join(root, 'docs'), { recursive: true })
      await writeFile(join(root, 'docs', 'index.md'), '# docs\n', 'utf-8')
      const opened: string[] = []

      const result = await backend.submitSettingsFeedbackReport({
        ...makeRuntime(root, opened),
        now: () => new Date('2026-06-12T10:11:12.000Z')
      })

      expect(result.path).toBe(join(root, 'user-data', 'feedback', 'aiopsterm-feedback-2026-06-12T10-11-12-000Z.md'))
      expect(opened).toEqual([result.path])
      const content = await readFile(result.path, 'utf-8')
      expect(content).toContain('# aiopsterm Feedback Report')
      expect(content).toContain('Version: 0.1.0')
      expect(content).toContain(`Log Directory: ${join(root, 'user-data', 'logs')}`)
      expect(content).toContain(`Documentation: ${join(root, 'docs', 'index.md')}`)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('fails when documentation is missing but does not use the OS opener for docs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-settings-open-fail-'))
    try {
      await expect(backend.openSettingsDocumentation(makeRuntime(root))).rejects.toThrow('documentation entry was not found')

      await mkdir(join(root, 'docs'), { recursive: true })
      await writeFile(join(root, 'docs', 'index.md'), '# docs\n', 'utf-8')
      await expect(
        backend.openSettingsDocumentation({
          ...makeRuntime(root),
          openPath: async () => 'no opener'
        })
      ).resolves.toEqual({ path: join(root, 'docs', 'index.md'), title: 'docs', content: '# docs\n' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
