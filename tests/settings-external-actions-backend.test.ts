import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeAll, describe, expect, it } from 'vitest'

type SettingsExternalActionsBackend = {
  openSettingsDocumentation: (runtime: ReturnType<typeof makeRuntime>) => Promise<{ path: string }>
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
    const modulePath = '../src/main/backend/settingsExternalActions'
    backend = (await import(modulePath)) as SettingsExternalActionsBackend
  })

  it('opens the self-owned local documentation entry instead of requiring a placeholder URL', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-settings-docs-'))
    try {
      const docsPath = join(root, 'docs', 'index.md')
      await mkdir(join(root, 'docs'), { recursive: true })
      await writeFile(docsPath, '# aiopsterm Docs\n', 'utf-8')
      const opened: string[] = []

      const result = await backend.openSettingsDocumentation(makeRuntime(root, opened))

      expect(result).toEqual({ path: docsPath })
      expect(opened).toEqual([docsPath])
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

  it('fails when documentation is missing or the OS opener rejects the target', async () => {
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
      ).rejects.toThrow('no opener')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
