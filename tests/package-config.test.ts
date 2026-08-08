import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

const evalBuildCodexCliModule = async (source: string) => {
  const result = await execFileAsync(process.execPath, ['--input-type=module', '-e', source], { cwd: process.cwd() })
  return result.stdout.trim()
}

describe('package configuration audit', () => {
  it('runs package target npm scripts through Node on Windows', async () => {
    const stdout = await evalBuildCodexCliModule(`
      import { npmScriptInvocation } from './scripts/package-targets.mjs'
      console.log(JSON.stringify(npmScriptInvocation({
        platform: 'win32',
        nodeExecutable: 'C:\\\\node\\\\node.exe',
        npmExecPath: 'C:\\\\node\\\\node_modules\\\\npm\\\\bin\\\\npm-cli.js',
        script: 'audit:packaged-app',
        args: ['--', 'windows']
      })))
    `)

    expect(JSON.parse(stdout)).toEqual({
      command: 'C:\\node\\node.exe',
      args: [
        'C:\\node\\node_modules\\npm\\bin\\npm-cli.js',
        'run',
        'audit:packaged-app',
        '--',
        'windows'
      ]
    })
  })

  it('kills active terminal sessions before asynchronous app shutdown work', () => {
    const mainSource = readFileSync('src/main/index.ts', 'utf8')
    const beforeQuitHandler = mainSource.slice(
      mainSource.indexOf("app.on('before-quit'"),
      mainSource.indexOf("app.on('before-quit'") + 800
    )

    expect(beforeQuitHandler).toContain('terminalRuntime.killAllSessions()')
    expect(beforeQuitHandler.indexOf('terminalRuntime.killAllSessions()')).toBeLessThan(
      beforeQuitHandler.indexOf('event.preventDefault()')
    )
  })

  it('keeps macOS and deb packaging entry points configured', async () => {
    const result = await execFileAsync(process.execPath, ['scripts/audit-package-config.mjs'], { cwd: process.cwd() })
    expect(`${result.stdout}${result.stderr}`).toContain('package-config-audit-ok')
  })

  it('keeps the static AppImage runtime configured', () => {
    const builderConfig = readFileSync('electron-builder.yml', 'utf8')
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as { devDependencies?: Record<string, string> }

    expect(packageJson.devDependencies?.['electron-builder']).toBe('^26.11.1')
    expect(builderConfig).toContain('appimage: "1.0.3"')
    expect(builderConfig).toContain('compression: zstd')
  })

  it('resolves the exported electron-rebuild executable from package metadata', () => {
    const script = readFileSync('scripts/ensure-native-runtime.mjs', 'utf8')
    expect(script).toContain("resolvePackageBin('@electron/rebuild', 'electron-rebuild')")
    expect(script).not.toContain("require.resolve('@electron/rebuild/lib/cli.js')")
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

  it('passes the packaged Codex binary to the runtime audit', async () => {
    const stdout = await evalBuildCodexCliModule(`
      import { buildCodexRuntimeAuditArgs } from './scripts/build-codex-cli.mjs'
      console.log(JSON.stringify(buildCodexRuntimeAuditArgs(
        'C:\\\\aiopsterm\\\\codex-package\\\\bin\\\\codex.exe',
        'x86_64-pc-windows-msvc'
      )))
    `)
    const args = JSON.parse(stdout) as string[]

    expect(args).toEqual([
      'C:\\aiopsterm\\codex-package\\bin\\codex.exe',
      '--expected-target',
      'x86_64-pc-windows-msvc'
    ])
  })

  it('keeps a pinned Node license fallback for incomplete Windows runtime packages', () => {
    const expectedHash = 'e991d81497a85bb24fc6bffae0a3637a6accd6c6bc5ce1f2c5698bd555cf9d49'
    const buildSource = readFileSync('scripts/build-cline-sidecar.mjs', 'utf8')
    const license = readFileSync('resources/licenses/cline-sidecar/node-22.20.0-LICENSE')

    expect(buildSource).toContain('node-22.20.0-LICENSE')
    expect(buildSource).toContain(expectedHash)
    expect(createHash('sha256').update(license).digest('hex')).toBe(expectedHash)
    expect(license.toString('utf8')).toMatch(/^Node\.js is licensed for use as follows:/)
  })

  it('keeps macOS bundler binaries installable despite npm optional dependency pruning', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as { optionalDependencies?: Record<string, string> }

    expect(packageJson.optionalDependencies?.['@esbuild/darwin-arm64']).toBe('0.21.5')
    expect(packageJson.optionalDependencies?.['@esbuild/darwin-x64']).toBe('0.21.5')
    expect(packageJson.optionalDependencies?.['@rollup/rollup-darwin-arm64']).toBe('4.61.0')
    expect(packageJson.optionalDependencies?.['@rollup/rollup-darwin-x64']).toBe('4.61.0')
    expect(packageJson.optionalDependencies?.['dmg-license']).toBe('1.0.11')
  })

  it('runs the Bun executable directly when building the Windows sidecar', () => {
    const buildSource = readFileSync('scripts/build-cline-sidecar.mjs', 'utf8')

    expect(buildSource).toContain("join(root, 'node_modules', 'bun', 'bin', 'bun.exe')")
    expect(buildSource).not.toContain("join(root, 'node_modules', '.bin', 'bun.cmd')")
  })

  it('uses the Node mirror for generic node-gyp rebuilds', () => {
    const npmrc = readFileSync('.npmrc', 'utf8')

    expect(npmrc).toContain('registry=https://registry.npmjs.org/')
    expect(npmrc).toContain('disturl=https://nodejs.org/dist')
    expect(npmrc).not.toContain('disturl=https://npmmirror.com/mirrors/electron/')
  })

  it('keeps the local Windows build entrypoints available without a remote CI service', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts?: Record<string, string> }
    const script = readFileSync('scripts/build-windows.ps1', 'utf8')
    expect(packageJson.scripts?.['build:windows:one-click']).toContain('scripts/build-windows.ps1')
    expect(readFileSync('scripts/build-windows.cmd', 'utf8')).toContain('build-windows.ps1')
    expect(script).toContain('[switch]$ChinaMirror')
    expect(script).toContain("@('run', 'package:build'")
    expect(script).toContain("@('run', 'package:verify'")
    expect(script).toContain('https://registry.npmjs.org/')
    expect(script).toContain('https://registry.npmmirror.com/')
    expect(script).toContain('function Update-ProcessPath')
    expect(script).toContain('Get-VisualStudioInstallationPath')
  })

  it('keeps the local Linux one-click build entrypoint available', async () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts?: Record<string, string> }
    const script = readFileSync('scripts/build-linux.sh', 'utf8')
    const fastScript = readFileSync('scripts/build-linux-fast.sh', 'utf8')
    const help = await execFileAsync('bash', ['scripts/build-linux.sh', '--help'], { cwd: process.cwd() })
    await expect(execFileAsync('bash', ['scripts/build-linux.sh', '--npm-registry'], { cwd: process.cwd() })).rejects.toMatchObject({
      code: 2,
      stderr: expect.stringContaining('--npm-registry requires a URL')
    })
    expect(packageJson.scripts?.['build:linux:one-click']).toContain('scripts/build-linux.sh')
    expect(packageJson.scripts?.['build:linux:fast']).toContain('scripts/build-linux-fast.sh')
    expect(fastScript).toContain('build-linux.sh" --skip-dependencies "$@"')
    expect(help.stdout).toContain('--npm-registry URL')
    expect(script).toContain('can only run on Linux')
    expect(script).toContain('--china-mirror')
    expect(script).toContain('export npm_config_registry="${npm_registry}"')
    expect(script).toContain('if ! command_exists rustup; then')
    expect(script).toContain('local -a system_required=(curl python3 git pkg-config musl-gcc clang ld.lld dpkg-deb xvfb-run)')
    expect(script).toContain('run_npm run build:linux')
    expect(script).toContain('package:verify -- linux-appimage')
    expect(script).toContain('package:verify -- linux-deb')
  })

  it('keeps the local macOS one-click build entrypoint available', async () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts?: Record<string, string> }
    const script = readFileSync('scripts/build-macos.sh', 'utf8')
    const help = await execFileAsync('bash', ['scripts/build-macos.sh', '--help'], { cwd: process.cwd() })
    await expect(execFileAsync('bash', ['scripts/build-macos.sh', '--npm-registry'], { cwd: process.cwd() })).rejects.toMatchObject({
      code: 2,
      stderr: expect.stringContaining('--npm-registry requires a URL')
    })
    expect(packageJson.scripts?.['build:mac:one-click']).toContain('scripts/build-macos.sh')
    expect(help.stdout).toContain('--china-mirror')
    expect(help.stdout).toContain('--npm-registry URL')
    expect(help.stdout).toContain('--codex-package-dir DIR')
    expect(script).toContain('can only run on macOS')
    expect(script).toContain('https://registry.npmmirror.com/')
    expect(script).toContain('https://npmmirror.com/mirrors/node/v${node_version}')
    expect(script).toContain('https://rsproxy.cn/rustup-init.sh')
    expect(script).toContain('HOMEBREW_BOTTLE_DOMAIN')
    expect(script).toContain('HOMEBREW_NO_AUTO_UPDATE=1')
    expect(script).toContain('major >= 20 && major <= 24 && major % 2 === 0')
    expect(script).toContain('shasum -a 256 -c SHASUMS256.selected')
    expect(script).toContain("-c 'import distutils'")
    expect(script).toContain('export npm_config_python=')
    expect(script).toContain('prepare_china_codex_assets')
    expect(script).toContain('scripts/prepare-codex-dev-assets.mjs')
    expect(script).toContain('export AIOPSTERM_CODEX_PACKAGE_DIR=')
    expect(script).toContain('run_npm run package:build -- macos')
    expect(script).toContain('run_npm run package:verify -- macos')
  })

  it('loads the native runtime entrypoint before validating its target', async () => {
    await expect(execFileAsync(process.execPath, ['scripts/ensure-native-runtime.mjs', 'invalid'], {
      cwd: process.cwd()
    })).rejects.toMatchObject({
      code: 2,
      stderr: expect.stringContaining('Usage: node scripts/ensure-native-runtime.mjs')
    })
  })
})
