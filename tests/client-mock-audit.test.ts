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

  it('rejects scripts and build config that copy or package the reference external-reference tree', async () => {
    const root = await createAuditRepo()
    await writeFile(join(root, 'electron-builder.yml'), "files:\n  - out/**\n  - '!external-reference/**'\n")
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify(
        {
          scripts: {
            build: 'electron-vite build',
            'bad:copy-reference': 'cp -R external-reference/src copied-reference'
          }
        },
        null,
        2
      )
    )
    await writeFile(join(root, 'scripts', 'bad-reference.mjs'), "export const source = 'external-reference/src/renderer'\n")
    await writeFile(
      join(root, 'src', 'main', 'extension-copy.ts'),
      "export const pluginExtension = '.external-reference'\nexport const referenceTree = '../external-reference/src/main/index.ts'\n"
    )

    const result = await runAudit(root)
    expect(result.ok).toBe(false)
    expect(result.output).toContain('external-reference-tree-reference')
    expect(result.output).toContain('package.json')
    expect(result.output).toContain('scripts/bad-reference.mjs')
    expect(result.output).toContain('src/main/extension-copy.ts')
    expect(result.output).not.toContain('electron-builder.yml')
  })

  it('rejects renderer-generated backend business identities while allowing local UI and request ids', async () => {
    const allowedRoot = await createAuditRepo()
    await writeFile(
      join(allowedRoot, 'src', 'renderer', 'src', 'components', 'AllowedUiIds.vue'),
      [
        '<script setup lang="ts">',
        'const panelId = `panel-${Math.random().toString(36).slice(2)}`',
        'const sqlTabId = `tab-sql-${Date.now()}`',
        'const dataTabId = `tab-data-${table.id}-${Date.now()}`',
        'const rowDraftId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`',
        'const resultId = `result-${seq}`',
        'const diagnosisRequestId = `dbai-diagnose-${result.id}-${Date.now().toString(36)}`',
        'void panelId',
        'void sqlTabId',
        'void dataTabId',
        'void rowDraftId',
        'void resultId',
        'void diagnosisRequestId',
        '</script>'
      ].join('\n')
    )
    await expect(runAudit(allowedRoot)).resolves.toMatchObject({ ok: true, output: expect.stringContaining('client-mock-audit-ok') })

    const rejectedRoot = await createAuditRepo()
    await writeFile(
      join(rejectedRoot, 'src', 'renderer', 'src', 'components', 'BusinessIds.vue'),
      [
        '<script setup lang="ts">',
        'const assetId = `asset-${Date.now()}`',
        'const historyId = `conv-${Math.random().toString(36).slice(2)}`',
        'void assetId',
        'void historyId',
        '</script>'
      ].join('\n')
    )

    const result = await runAudit(rejectedRoot)
    expect(result.ok).toBe(false)
    expect(result.output).toContain('renderer-business-id-generation')
    expect(result.output).toContain('BusinessIds.vue')
  })

  it('rejects generic renderer id helpers that can mint backend business identities by prefix', async () => {
    const rejectedRoot = await createAuditRepo()
    await writeFile(
      join(rejectedRoot, 'src', 'renderer', 'src', 'components', 'GenericIdHelper.vue'),
      [
        '<script setup lang="ts">',
        "const createId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2)}`",
        "function generateRecordId(kind: string) { return `${kind}-${Date.now()}` }",
        "const makeRecordId = function(type: string) { return `${type}-${Date.now()}` }",
        "const createLocalId = (prefix: 'panel' | 'tmp') => `${prefix}-${Math.random().toString(36).slice(2)}`",
        "const panelId = createLocalId('panel')",
        'void createId',
        'void generateRecordId',
        'void makeRecordId',
        'void panelId',
        '</script>'
      ].join('\n')
    )

    const result = await runAudit(rejectedRoot)
    expect(result.ok).toBe(false)
    expect(result.output).toContain('renderer-generic-id-helper')
    expect(result.output).toContain('GenericIdHelper.vue')
  })
})
