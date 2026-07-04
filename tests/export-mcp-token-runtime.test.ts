import { mkdtemp, readFile, rm, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const cleanupDirs: string[] = []

const loadRuntime = async () => {
  const modulePath = '../src/main/backend/codex/exportMcpTokenRuntime'
  return import(modulePath)
}

afterEach(async () => {
  const runtime = await loadRuntime()
  runtime.configureExportMcpTokenRuntime()
  await Promise.all(cleanupDirs.map((dir) => rm(dir, { recursive: true, force: true })))
  cleanupDirs.length = 0
})

describe('Export MCP token runtime', () => {
  it('generates a persistent token once and reuses the stored value', async () => {
    const runtime = await loadRuntime()
    const userDataPath = await mkdtemp(join(tmpdir(), 'aiopsterm-export-mcp-token-'))
    cleanupDirs.push(userDataPath)
    const generateToken = vi.fn(() => 'generated-token-a')
    runtime.configureExportMcpTokenRuntime({
      userDataPath,
      getEnv: () => ({}),
      now: () => 123,
      generateToken
    })

    expect(runtime.getEffectiveExportMcpToken()).toBe('generated-token-a')
    expect(runtime.getEffectiveExportMcpToken()).toBe('generated-token-a')
    expect(generateToken).toHaveBeenCalledTimes(1)

    const tokenPath = runtime.getExportMcpTokenFilePath()
    expect(JSON.parse(await readFile(tokenPath, 'utf-8'))).toEqual({
      token: 'generated-token-a',
      createdAt: 123
    })
    if (process.platform !== 'win32') {
      expect((await stat(tokenPath)).mode & 0o777).toBe(0o600)
      expect((await stat(join(userDataPath, 'external-codex-mcp'))).mode & 0o777).toBe(0o700)
    }

    runtime.configureExportMcpTokenRuntime({
      userDataPath,
      getEnv: () => ({}),
      generateToken: () => 'generated-token-b'
    })
    expect(runtime.getEffectiveExportMcpToken()).toBe('generated-token-a')
  })

  it('lets an environment token override storage and blocks app-managed rotation while overridden', async () => {
    const runtime = await loadRuntime()
    const userDataPath = await mkdtemp(join(tmpdir(), 'aiopsterm-export-mcp-token-'))
    cleanupDirs.push(userDataPath)
    runtime.configureExportMcpTokenRuntime({
      userDataPath,
      getEnv: () => ({ AIOPSTERM_EXTERNAL_CODEX_MCP_TOKEN: 'env-token' }),
      generateToken: () => 'generated-token'
    })

    expect(runtime.getEffectiveExportMcpToken()).toBe('env-token')
    expect(() => runtime.rotateStoredExportMcpToken()).toThrow('AIOPSTERM_EXTERNAL_CODEX_MCP_TOKEN is set')
  })

  it('rotates the app-managed token when no environment override is present', async () => {
    const runtime = await loadRuntime()
    const userDataPath = await mkdtemp(join(tmpdir(), 'aiopsterm-export-mcp-token-'))
    cleanupDirs.push(userDataPath)
    const tokens = ['token-a', 'token-b']
    runtime.configureExportMcpTokenRuntime({
      userDataPath,
      getEnv: () => ({}),
      generateToken: () => tokens.shift() || 'token-fallback'
    })

    expect(runtime.getEffectiveExportMcpToken()).toBe('token-a')
    expect(runtime.rotateStoredExportMcpToken()).toBe('token-b')
    expect(runtime.getEffectiveExportMcpToken()).toBe('token-b')
  })
})
