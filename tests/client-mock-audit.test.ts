import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

const runAudit = async (root: string) => {
  try {
    const result = await execFileAsync(process.execPath, ['scripts/audit-client-mocks.mjs', '--root', root], { cwd: process.cwd() })
    return { ok: true as const, output: `${result.stdout}${result.stderr}` }
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string }
    return { ok: false as const, output: `${failure.stdout || ''}${failure.stderr || ''}` }
  }
}

const createAuditRepo = async () => {
  const root = await mkdtemp(join(tmpdir(), 'aiopsterm-client-mock-audit-'))
  await mkdir(join(root, 'src', 'renderer', 'src', 'components'), { recursive: true })
  await mkdir(join(root, 'src', 'renderer', 'src', 'data'), { recursive: true })
  await mkdir(join(root, 'src', 'main'), { recursive: true })
  await mkdir(join(root, 'scripts'), { recursive: true })
  await writeFile(join(root, 'src', 'renderer', 'src', 'components', 'App.vue'), '<script setup lang="ts">\nconst title = "ok"\n</script>\n')
  return root
}

describe('client mock audit', () => {
  it('passes the current repository without renderer business mock modules', () => {
    return expect(runAudit(process.cwd())).resolves.toMatchObject({ ok: true, output: expect.stringContaining('client-mock-audit-ok') })
  })

  it('rejects renderer data files and page-level business mock imports', async () => {
    const root = await createAuditRepo()
    await writeFile(join(root, 'src', 'renderer', 'src', 'data', 'mockData.ts'), 'export const mockSettingsSkills = []\n')
    await writeFile(join(root, 'src', 'renderer', 'src', 'components', 'Settings.vue'), "import { mockSettingsSkills } from '@/data/mockData'\n")

    const result = await runAudit(root)
    expect(result.ok).toBe(false)
    expect(result.output).toContain('renderer-data-file')
    expect(result.output).toContain('renderer-business-mock-file-name')
    expect(result.output).toContain('renderer-data-import')
    expect(result.output).toContain('renderer-mock-data-token')
  })

  it('rejects renderer access to backend double switches, seed imports, and external-reference source imports', async () => {
    const root = await createAuditRepo()
    await writeFile(
      join(root, 'src', 'renderer', 'src', 'components', 'AiPanel.vue'),
      [
        '<script setup lang="ts">',
        "import { defaultSkillsConfig } from '@shared/skillsSeed'",
        "const flag = 'AIOPSTERM_AI_CHAT_BACKEND_DOUBLE'",
        'void defaultSkillsConfig',
        'void flag',
        '</script>'
      ].join('\n')
    )
    await writeFile(join(root, 'src', 'main', 'bad-import.ts'), "import '../external-reference/src/main/index'\n")

    const result = await runAudit(root)
    expect(result.ok).toBe(false)
    expect(result.output).toContain('renderer-backend-double-switch')
    expect(result.output).toContain('renderer-shared-seed-import')
    expect(result.output).toContain('external-reference-source-import')
  })
})
