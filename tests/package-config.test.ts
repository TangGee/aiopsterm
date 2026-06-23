import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

const evalBuildCodexCliModule = async (source: string) => {
  const result = await execFileAsync(process.execPath, ['--input-type=module', '-e', source], { cwd: process.cwd() })
  return result.stdout.trim()
}

describe('package configuration audit', () => {
  it('keeps macOS and deb packaging entry points configured', async () => {
    const result = await execFileAsync(process.execPath, ['scripts/audit-package-config.mjs'], { cwd: process.cwd() })
    expect(`${result.stdout}${result.stderr}`).toContain('package-config-audit-ok')
  })

  it('keeps Windows Codex package builder arguments wired to source build helpers', async () => {
    const stdout = await evalBuildCodexCliModule(`
      import { buildCodexPackageArgs } from './scripts/build-codex-cli.mjs'
      const args = buildCodexPackageArgs({
        targetTriple: 'x86_64-pc-windows-msvc',
        packageDir: 'C:\\\\aiopsterm\\\\codex-package',
        cargoBin: 'C:\\\\Users\\\\dev\\\\.rustup\\\\toolchains\\\\stable\\\\bin\\\\cargo.exe',
        env: {
          AIOPSTERM_CODEX_RG_BIN: 'C:\\\\tools\\\\rg.exe',
          AIOPSTERM_CODEX_COMMAND_RUNNER_BIN: 'C:\\\\tools\\\\codex-command-runner.exe',
          AIOPSTERM_CODEX_WINDOWS_SANDBOX_SETUP_BIN: 'C:\\\\tools\\\\codex-windows-sandbox-setup.exe'
        }
      })
      console.log(JSON.stringify(args))
    `)
    const args = JSON.parse(stdout) as string[]

    expect(args).toContain('x86_64-pc-windows-msvc')
    expect(args).toContain('--cargo-profile')
    expect(args).toContain('release')
    expect(args).toContain('--cargo')
    expect(args).toContain('--codex-command-runner-bin')
    expect(args).toContain('--codex-windows-sandbox-setup-bin')
    expect(args).toContain('--rg-bin')
  })

  it('reads the Codex Rust toolchain channel from rust-toolchain TOML', async () => {
    const toolchain = await evalBuildCodexCliModule(`
      import { readCodexRustToolchainFromText } from './scripts/build-codex-cli.mjs'
      console.log(readCodexRustToolchainFromText('[toolchain]\\nchannel = "1.89.0"\\n'))
    `)
    expect(toolchain).toBe('1.89.0')
  })
})
