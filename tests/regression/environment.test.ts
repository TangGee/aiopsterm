import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it, expect, vi } from 'vitest'
import { isolatedEnvironment } from './support/environment'

it('does not inherit live agent credentials, user homes or shell startup hooks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aio-environment-'))
  try {
    for (const key of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'SSH_AUTH_SOCK', 'BASH_ENV', 'ZDOTDIR']) vi.stubEnv(key, 'synthetic-live-secret')
    vi.stubEnv('CODEX_HOME', '/synthetic-live-agent')
    vi.stubEnv('XAUTHORITY', '/synthetic-display-cookie')
    const env = await isolatedEnvironment(root)
    expect(JSON.stringify(env)).not.toContain('synthetic-live')
    expect(env.HOME).toBe(join(root, 'home'))
    expect(env.USERPROFILE).toBe(env.HOME)
    expect(env.CODEX_HOME).toBe(join(root, 'home', '.codex'))
    expect(env.CLAUDE_CONFIG_DIR).toBe(join(root, 'home', '.claude'))
    expect(env.XAUTHORITY).toBe('/synthetic-display-cookie')
    expect(new URL(env.AIOPSTERM_TELEMETRY_ENDPOINT!).hostname).toBe('127.0.0.1')
  } finally {
    vi.unstubAllEnvs()
    await rm(root, { recursive: true, force: true })
  }
})
