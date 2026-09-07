import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { it, expect } from 'vitest'

it('release gate refuses empty artifacts and detects changed build hashes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aio-release-gate-'))
  const script = resolve('scripts/release-test-gate.mjs')
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' })
  const run = (...args: string[]) => spawnSync(process.execPath, [script, 'dist', ...args], { cwd: root, encoding: 'utf8' })
  try {
    git('init')
    await writeFile(join(root, '.gitignore'), 'dist/\n')
    git('add', '.gitignore')
    git('-c', 'user.name=Regression', '-c', 'user.email=regression@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'Synthetic fixture')
    await mkdir(join(root, 'dist'))
    expect(run().status).not.toBe(0)
    const artifact = join(root, 'dist', process.platform === 'win32' ? 'app.exe' : process.platform === 'darwin' ? 'app.dmg' : 'app.AppImage')
    await writeFile(artifact, 'synthetic-artifact-v1')
    const unpacked = join(root, 'dist', process.platform === 'win32' ? 'win-unpacked'
      : process.platform === 'darwin' ? (process.arch === 'arm64' ? 'mac-arm64' : 'mac') : 'linux-unpacked')
    await mkdir(unpacked)
    const executable = join(unpacked, 'synthetic-app')
    await writeFile(executable, 'unpacked-v1')
    const recorded = run()
    expect(recorded.status, recorded.stderr).toBe(0)
    expect(run('--verify').status).toBe(0)
    await writeFile(artifact, 'synthetic-artifact-v2')
    const changed = run('--verify')
    expect(changed.status).not.toBe(0)
    expect(changed.stderr).toContain('do not match')
    await writeFile(artifact, 'synthetic-artifact-v1')
    await writeFile(executable, 'unpacked-v2')
    expect(run('--verify').stderr).toContain('do not match')
    await writeFile(join(root, 'uncommitted-source.ts'), 'export const changed = true')
    expect(run().stderr).toContain('uncommitted')
  } finally { await rm(root, { recursive: true, force: true }) }
})
