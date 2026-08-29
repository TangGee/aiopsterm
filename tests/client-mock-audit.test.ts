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
  await mkdir(join(root, 'src', 'renderer', 'src', 'config'), { recursive: true })
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

  it('rejects renderer access to backend double switches and seed imports', async () => {
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
    const result = await runAudit(root)
    expect(result.ok).toBe(false)
    expect(result.output).toContain('renderer-backend-double-switch')
    expect(result.output).toContain('renderer-shared-seed-import')
  })

  it('rejects renderer imports from Electron and main or preload implementation modules', async () => {
    const root = await createAuditRepo()
    await writeFile(
      join(root, 'src', 'renderer', 'src', 'components', 'BadBoundaries.vue'),
      [
        '<script setup lang="ts">',
        "import { ipcRenderer } from 'electron'",
        "import { createWindow } from '../../../main/index'",
        "const preload = await import('../../../preload/index')",
        'void ipcRenderer',
        'void createWindow',
        'void preload',
        '</script>'
      ].join('\n')
    )

    const result = await runAudit(root)
    expect(result.ok).toBe(false)
    expect(result.output).toContain('renderer-electron-import')
    expect(result.output).toContain('renderer-main-preload-import')
    expect(result.output).toContain('BadBoundaries.vue')
  })

  it('rejects new oversized source files outside the recorded large-file baseline', async () => {
    const root = await createAuditRepo()
    await writeFile(
      join(root, 'src', 'renderer', 'src', 'components', 'Oversized.vue'),
      Array.from({ length: 1801 }, (_, index) => (index === 0 ? '<template><div>large</div></template>' : `<!-- ${index} -->`)).join('\n')
    )

    const result = await runAudit(root)
    expect(result.ok).toBe(false)
    expect(result.output).toContain('large-source-file')
    expect(result.output).toContain('Oversized.vue')
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

  it('rejects untyped renderer id helpers that can bypass TypeScript prefix unions', async () => {
    const rejectedRoot = await createAuditRepo()
    await writeFile(
      join(rejectedRoot, 'src', 'renderer', 'src', 'components', 'UntypedIdHelper.vue'),
      [
        '<script setup>',
        "const createId = (prefix) => `${prefix}-${Math.random().toString(36).slice(2)}`",
        "function generateRuntimeId(kind) { return `${kind}-${Date.now()}` }",
        "const buildRuntimeId = function(type) { return `${type}-${Date.now()}` }",
        "const createLocalId = (prefix) => prefix === 'panel' ? `panel-${Date.now()}` : ''",
        'void createId',
        'void generateRuntimeId',
        'void buildRuntimeId',
        'void createLocalId',
        '</script>'
      ].join('\n')
    )

    const result = await runAudit(rejectedRoot)
    expect(result.ok).toBe(false)
    expect(result.output).toContain('renderer-generic-id-helper')
    expect(result.output).toContain('UntypedIdHelper.vue')
  })

  it('keeps renderer config limited to static UI metadata instead of hidden business fixtures', async () => {
    const allowedRoot = await createAuditRepo()
    await writeFile(
      join(allowedRoot, 'src', 'renderer', 'src', 'config', 'navigation.ts'),
      [
        "export const menuItems = [",
        "  { key: 'workspace', label: '工作区', icon: Server, position: 'main' },",
        "  { id: 'terminal-tab', targetId: 'settings-terminal-tab', title: '终端设置', description: '打开终端设置。' }",
        "]"
      ].join('\n')
    )
    await expect(runAudit(allowedRoot)).resolves.toMatchObject({ ok: true, output: expect.stringContaining('client-mock-audit-ok') })

    const rejectedRoot = await createAuditRepo()
    await writeFile(
      join(rejectedRoot, 'src', 'renderer', 'src', 'config', 'assets.ts'),
      [
        'export const defaultAssetHosts = [',
        "  { host: '10.0.0.8', ip: '10.0.0.8', username: 'root', password: 'secret', asset_type: 'person' }",
        ']'
      ].join('\n')
    )
    await writeFile(
      join(rejectedRoot, 'src', 'renderer', 'src', 'config', 'settings.ts'),
      [
        'export const sampleDatabaseConnections = [',
        "  { connectionId: 'conn-1', dbType: 'mysql', databaseName: 'ops' }",
        ']'
      ].join('\n')
    )

    const result = await runAudit(rejectedRoot)
    expect(result.ok).toBe(false)
    expect(result.output).toContain('renderer-config-business-field')
    expect(result.output).toContain('renderer-config-fixture-export')
    expect(result.output).toContain('src/renderer/src/config/assets.ts')
    expect(result.output).toContain('src/renderer/src/config/settings.ts')
  })
})
