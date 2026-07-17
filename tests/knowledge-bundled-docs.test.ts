import { afterEach, describe, expect, it } from 'vitest'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { KnowledgeBaseUserConfig } from '../src/shared/contracts/knowledgeBase'
import type { UserConfig } from '../src/shared/contracts/userConfig'

type KnowledgeBaseRuntimeHarness = {
  ensureKnowledgeBaseDirectory: () => Promise<string>
}

type KnowledgeBaseRuntimeModule = {
  BUNDLED_DOCS_TARGET_DIR: string
  createKnowledgeBaseRuntime: (options: {
    userDataPath: () => string
    getConfig: () => UserConfig
    saveKnowledgeBase: (knowledgeBase: KnowledgeBaseUserConfig) => void
    defaultKnowledgeBase: KnowledgeBaseUserConfig
    bundledDocsPath?: () => string
    bundledDocsVersion?: () => string
  }) => KnowledgeBaseRuntimeHarness
}

// Main-process module: load dynamically so the renderer/web TS project does not pull src/main into its file list.
const loadRuntimeModule = async () => {
  const modulePath = '../src/main/backend/knowledge/knowledgeBaseRuntime'
  return (await import(modulePath)) as KnowledgeBaseRuntimeModule
}

const tempDirs: string[] = []

const createTempDir = async (prefix: string) => {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

const exists = async (absPath: string) => {
  try {
    await access(absPath)
    return true
  } catch {
    return false
  }
}

const createBundledDocsFixture = async () => {
  const bundled = await createTempDir('aiopsterm-bundled-docs-')
  await mkdir(join(bundled, 'zh-CN'), { recursive: true })
  await mkdir(join(bundled, 'images'), { recursive: true })
  await writeFile(join(bundled, 'index.md'), '# index\n', 'utf-8')
  await writeFile(join(bundled, 'zh-CN', '01-getting-started.md'), '# 快速上手\n', 'utf-8')
  await writeFile(join(bundled, 'images', 'main-window.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  await writeFile(join(bundled, '.hidden.md'), 'hidden\n', 'utf-8')
  return bundled
}

const createRuntime = async (userData: string, bundled: string, version: string) => {
  const { createKnowledgeBaseRuntime } = await loadRuntimeModule()
  return createKnowledgeBaseRuntime({
    userDataPath: () => userData,
    getConfig: () => ({}) as UserConfig,
    saveKnowledgeBase: () => {},
    defaultKnowledgeBase: { tree: [], usedBytes: 0, totalBytes: 1024 * 1024 * 1024 },
    bundledDocsPath: () => bundled,
    bundledDocsVersion: () => version
  })
}

describe('bundled best-practices docs sync', () => {
  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('imports bundled docs into the knowledge base target directory on first ensure', async () => {
    const { BUNDLED_DOCS_TARGET_DIR } = await loadRuntimeModule()
    const userData = await createTempDir('aiopsterm-kb-user-')
    const bundled = await createBundledDocsFixture()
    const runtime = await createRuntime(userData, bundled, '1.0.0')

    await runtime.ensureKnowledgeBaseDirectory()

    const kbRoot = join(userData, 'knowledgebase', BUNDLED_DOCS_TARGET_DIR)
    expect(await exists(join(kbRoot, 'index.md'))).toBe(true)
    expect(await exists(join(kbRoot, 'zh-CN', '01-getting-started.md'))).toBe(true)
    expect(await exists(join(kbRoot, 'images', 'main-window.png'))).toBe(true)
    expect(await exists(join(kbRoot, '.hidden.md'))).toBe(false)
    expect((await readFile(join(userData, 'knowledgebase', '.aiopsterm-bundled-docs-synced'), 'utf-8')).trim()).toBe('1.0.0')
  })

  it('does not overwrite user-edited files when re-syncing after a version change', async () => {
    const { BUNDLED_DOCS_TARGET_DIR } = await loadRuntimeModule()
    const userData = await createTempDir('aiopsterm-kb-user-')
    const bundled = await createBundledDocsFixture()

    await (await createRuntime(userData, bundled, '1.0.0')).ensureKnowledgeBaseDirectory()

    const editedPath = join(userData, 'knowledgebase', BUNDLED_DOCS_TARGET_DIR, 'zh-CN', '01-getting-started.md')
    await writeFile(editedPath, '# 用户自己的修改\n', 'utf-8')
    await writeFile(join(bundled, 'zh-CN', '02-new-doc.md'), '# 新文档\n', 'utf-8')

    await (await createRuntime(userData, bundled, '1.1.0')).ensureKnowledgeBaseDirectory()

    expect(await readFile(editedPath, 'utf-8')).toBe('# 用户自己的修改\n')
    expect(await exists(join(userData, 'knowledgebase', BUNDLED_DOCS_TARGET_DIR, 'zh-CN', '02-new-doc.md'))).toBe(true)
  })

  it('skips re-scanning while the sync marker matches the current version', async () => {
    const { BUNDLED_DOCS_TARGET_DIR } = await loadRuntimeModule()
    const userData = await createTempDir('aiopsterm-kb-user-')
    const bundled = await createBundledDocsFixture()

    await (await createRuntime(userData, bundled, '1.0.0')).ensureKnowledgeBaseDirectory()
    await writeFile(join(bundled, 'zh-CN', '02-new-doc.md'), '# 新文档\n', 'utf-8')
    await (await createRuntime(userData, bundled, '1.0.0')).ensureKnowledgeBaseDirectory()

    expect(await exists(join(userData, 'knowledgebase', BUNDLED_DOCS_TARGET_DIR, 'zh-CN', '02-new-doc.md'))).toBe(false)
  })

  it('leaves the knowledge base untouched when no bundled docs path is configured', async () => {
    const { BUNDLED_DOCS_TARGET_DIR, createKnowledgeBaseRuntime } = await loadRuntimeModule()
    const userData = await createTempDir('aiopsterm-kb-user-')
    const runtime = createKnowledgeBaseRuntime({
      userDataPath: () => userData,
      getConfig: () => ({}) as UserConfig,
      saveKnowledgeBase: () => {},
      defaultKnowledgeBase: { tree: [], usedBytes: 0, totalBytes: 1024 }
    })

    await runtime.ensureKnowledgeBaseDirectory()

    expect(await exists(join(userData, 'knowledgebase', BUNDLED_DOCS_TARGET_DIR))).toBe(false)
    expect(await exists(join(userData, 'knowledgebase', '.aiopsterm-bundled-docs-synced'))).toBe(false)
  })
})
