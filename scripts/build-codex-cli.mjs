import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { codexBinaryName, codexPackageDir, codexTargetTriple } from './codex-runtime-paths.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(scriptDir, '..')
const rustArtifactExtensions = ['.rlib', '.rmeta', '.o', '.obj', '.a', '.lib', '.so', '.dylib', '.dll']

const packageDirFromBinary = (binaryPath) => {
  const binDir = dirname(binaryPath)
  const packageDir = dirname(binDir)
  if (basename(binDir) !== 'bin') return ''
  return existsSync(join(packageDir, 'codex-package.json')) ? packageDir : ''
}

const codexBuildPaths = (projectDir = appRoot, env = process.env) => {
  const packageDir = resolve(env.AIOPSTERM_CODEX_PACKAGE_DIR || codexPackageDir(projectDir))
  const explicitBinary = env.AIOPSTERM_CODEX_BIN ? resolve(env.AIOPSTERM_CODEX_BIN) : ''
  const binaryPath = explicitBinary || join(packageDir, 'bin', codexBinaryName())
  return { packageDir, explicitBinary, binaryPath }
}

const assertCodexPackage = (projectDir = appRoot, env = process.env) => {
  const { packageDir, explicitBinary, binaryPath } = codexBuildPaths(projectDir, env)
  const detectedPackageDir = explicitBinary ? packageDirFromBinary(binaryPath) : packageDir
  if (!detectedPackageDir || !existsSync(join(detectedPackageDir, 'codex-package.json'))) {
    throw new Error(`Codex package metadata is missing: ${detectedPackageDir || packageDir}`)
  }
  if (!existsSync(binaryPath) || !statSync(binaryPath).isFile()) {
    throw new Error(`Codex CLI binary is missing: ${binaryPath}`)
  }
  console.log(`[aiopsterm] using Codex package: ${detectedPackageDir}`)
  console.log(`[aiopsterm] using Codex CLI binary: ${binaryPath}`)
}

export const readCodexRustToolchainFromText = (text) => {
  const match = text.match(/^[ \t]*channel[ \t]*=[ \t]*"([^"]+)"/m)
  return match?.[1] || ''
}

export const readCodexRustToolchain = (projectDir = appRoot, env = process.env) => {
  if (env.AIOPSTERM_CODEX_RUST_TOOLCHAIN) return env.AIOPSTERM_CODEX_RUST_TOOLCHAIN
  const toolchainFile = join(projectDir, 'codex', 'codex-rs', 'rust-toolchain.toml')
  if (!existsSync(toolchainFile)) {
    throw new Error(`Codex Rust toolchain file is missing: ${toolchainFile}`)
  }
  const toolchain = readCodexRustToolchainFromText(readFileSync(toolchainFile, 'utf8'))
  if (!toolchain) {
    throw new Error(`Unable to read Codex Rust toolchain channel from ${toolchainFile}`)
  }
  return toolchain
}

const spawnStatus = (command, args, options = {}) =>
  spawnSync(command, args, { stdio: 'inherit', env: process.env, ...options }).status ?? 1

const spawnOutput = (command, args, options = {}) =>
  spawnSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: process.env, ...options })

const rustupMirrorEnv = (env = process.env) => ({
  ...env,
  RUSTUP_DIST_SERVER: env.RUSTUP_DIST_SERVER || 'https://rsproxy.cn',
  RUSTUP_UPDATE_ROOT: env.RUSTUP_UPDATE_ROOT || 'https://rsproxy.cn/rustup'
})

const runRustupWithMirrorRetry = (args, description, env = process.env) => {
  if (spawnStatus('rustup', args, { env }) === 0) return
  if (!env.RUSTUP_DIST_SERVER && !env.RUSTUP_UPDATE_ROOT) {
    console.log(`[aiopsterm] rustup default endpoint failed while ${description}; retrying with rsproxy.cn mirror`)
    if (spawnStatus('rustup', args, { env: rustupMirrorEnv(env) }) === 0) return
  }
  throw new Error(`[aiopsterm] Failed while ${description}: rustup ${args.join(' ')}`)
}

const assertRustupAvailable = (env = process.env) => {
  const result = spawnOutput('rustup', ['--version'], { env })
  if ((result.status ?? 1) === 0) return
  throw new Error('[aiopsterm] Windows Codex source build requires rustup. Install rustup, then rerun npm run build:win.')
}

const rustupWhich = (toolchain, binary, env = process.env) => {
  const result = spawnOutput('rustup', ['which', '--toolchain', toolchain, binary], { env })
  if ((result.status ?? 1) !== 0) {
    throw new Error(`[aiopsterm] Unable to resolve ${binary} for Rust toolchain ${toolchain}.\n${result.stderr || ''}`)
  }
  return result.stdout.trim()
}

const ensureCodexRustToolchain = (projectDir, targetTriple, env = process.env) => {
  const toolchain = readCodexRustToolchain(projectDir, env)
  assertRustupAvailable(env)
  const rustcVersion = spawnOutput('rustup', ['run', toolchain, 'rustc', '--version'], { env })
  if ((rustcVersion.status ?? 1) !== 0) {
    runRustupWithMirrorRetry(
      ['toolchain', 'install', toolchain, '--component', 'clippy', '--component', 'rustfmt', '--component', 'rust-src'],
      `installing Codex Rust toolchain ${toolchain}`,
      env
    )
  }
  runRustupWithMirrorRetry(['target', 'add', targetTriple, '--toolchain', toolchain], `installing Rust target ${targetTriple}`, env)
  const cargoBin = rustupWhich(toolchain, 'cargo', env)
  const rustcBin = rustupWhich(toolchain, 'rustc', env)
  const rustcResolvedVersion = spawnOutput(rustcBin, ['--version'], { env }).stdout.trim()
  console.log(`[aiopsterm] using Codex Rust toolchain ${toolchain} (${rustcResolvedVersion})`)
  return { toolchain, cargoBin, rustcBin }
}

const cargoProfileDirname = (profile) => {
  if (profile === 'dev') return 'debug'
  if (profile === 'release') return 'release'
  return profile
}

const codexCargoTargetDir = (projectDir, env = process.env) => {
  if (!env.CARGO_TARGET_DIR) return join(projectDir, 'codex', 'codex-rs', 'target')
  return resolve(join(projectDir, 'codex', 'codex-rs'), env.CARGO_TARGET_DIR)
}

const hasRustArtifactExtension = (name) => rustArtifactExtensions.some((extension) => name.toLowerCase().endsWith(extension))

const findZeroSizedRustArtifact = (dirs) => {
  const stack = dirs.filter((dir) => existsSync(dir))
  while (stack.length) {
    const current = stack.pop()
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(path)
      } else if (entry.isFile() && hasRustArtifactExtension(entry.name) && statSync(path).size === 0) {
        return path
      }
    }
  }
  return ''
}

const cleanCorruptCodexCargoProfile = (projectDir, targetTriple, profile, env = process.env) => {
  const targetRoot = codexCargoTargetDir(projectDir, env)
  const profileDir = cargoProfileDirname(profile)
  const hostProfileDir = join(targetRoot, profileDir)
  const targetProfileDir = join(targetRoot, targetTriple, profileDir)
  const corruptArtifact = findZeroSizedRustArtifact([hostProfileDir, targetProfileDir])
  if (!corruptArtifact) return
  console.error(`[aiopsterm] detected corrupt zero-byte Cargo artifact: ${corruptArtifact}`)
  console.error(`[aiopsterm] cleaning Codex Cargo profile cache: ${hostProfileDir} ${targetProfileDir}`)
  rmSync(hostProfileDir, { recursive: true, force: true })
  rmSync(targetProfileDir, { recursive: true, force: true })
}

export const buildCodexPackageArgs = ({ targetTriple, packageDir, cargoBin = '', env = process.env }) => {
  const args = [
    '--target',
    targetTriple,
    '--variant',
    'codex',
    '--cargo-profile',
    'release',
    '--package-dir',
    packageDir,
    '--force'
  ]
  if (cargoBin) args.push('--cargo', cargoBin)
  if (env.AIOPSTERM_CODEX_RG_BIN) args.push('--rg-bin', resolve(env.AIOPSTERM_CODEX_RG_BIN))
  if (env.AIOPSTERM_CODEX_COMMAND_RUNNER_BIN) {
    args.push('--codex-command-runner-bin', resolve(env.AIOPSTERM_CODEX_COMMAND_RUNNER_BIN))
  }
  if (env.AIOPSTERM_CODEX_WINDOWS_SANDBOX_SETUP_BIN) {
    args.push('--codex-windows-sandbox-setup-bin', resolve(env.AIOPSTERM_CODEX_WINDOWS_SANDBOX_SETUP_BIN))
  }
  return args
}

const resolvePython = (env = process.env) => {
  const candidates = []
  if (env.PYTHON) candidates.push({ command: env.PYTHON, prefixArgs: [] })
  if (process.platform === 'win32') candidates.push({ command: 'py', prefixArgs: ['-3'] }, { command: 'python', prefixArgs: [] })
  candidates.push({ command: 'python3', prefixArgs: [] }, { command: 'python', prefixArgs: [] })

  for (const candidate of candidates) {
    const result = spawnOutput(candidate.command, [...candidate.prefixArgs, '--version'], { env })
    if ((result.status ?? 1) === 0) return candidate
  }
  throw new Error('[aiopsterm] Codex package build requires Python 3. Install Python, or set PYTHON to a Python 3 executable.')
}

export const buildCodexRuntimeAuditArgs = (binaryPath, targetTriple) => [binaryPath, '--expected-target', targetTriple]

const runCodexRuntimeAudit = (projectDir = appRoot, targetTriple = codexTargetTriple(), env = process.env) =>
  spawnSync(process.execPath, [
    join(projectDir, 'scripts', 'audit-codex-runtime.mjs'),
    ...buildCodexRuntimeAuditArgs(codexBuildPaths(projectDir, env).binaryPath, targetTriple)
  ], {
    cwd: projectDir,
    stdio: 'inherit',
    env
  }).status ?? 1

const buildCodexPackageOnWindows = (projectDir = appRoot, env = process.env) => {
  const { packageDir, explicitBinary, binaryPath } = codexBuildPaths(projectDir, env)
  if (explicitBinary || env.AIOPSTERM_CODEX_PACKAGE_DIR) {
    assertCodexPackage(projectDir, env)
    return runCodexRuntimeAudit(projectDir, codexTargetTriple(process.platform, process.arch), env)
  }
  if (existsSync(binaryPath) && statSync(binaryPath).isFile()) {
    console.log(`[aiopsterm] Codex package exists: ${packageDir}`)
    return runCodexRuntimeAudit(projectDir, codexTargetTriple(process.platform, process.arch), env)
  }
  if (!existsSync(join(projectDir, 'codex', 'scripts', 'codex_package')) || !existsSync(join(projectDir, 'codex', 'codex-rs'))) {
    console.error(`[aiopsterm] Codex source directory is missing: ${join(projectDir, 'codex')}`)
    console.error('[aiopsterm] set AIOPSTERM_CODEX_PACKAGE_DIR/AIOPSTERM_CODEX_BIN or place Codex source at codex/.')
    return 1
  }

  const targetTriple = codexTargetTriple()
  const profile = 'release'
  console.log(`[aiopsterm] building Codex package for ${targetTriple}`)
  const { toolchain, cargoBin } = ensureCodexRustToolchain(projectDir, targetTriple, env)
  cleanCorruptCodexCargoProfile(projectDir, targetTriple, profile, env)
  const python = resolvePython(env)
  const builderArgs = buildCodexPackageArgs({ targetTriple, packageDir, cargoBin, env })
  const build = spawnSync(
    python.command,
    [...python.prefixArgs, join(projectDir, 'codex', 'scripts', 'build_codex_package.py'), ...builderArgs],
    {
      cwd: projectDir,
      stdio: 'inherit',
      env: {
        ...env,
        CARGO_PROFILE_RELEASE_STRIP: env.CARGO_PROFILE_RELEASE_STRIP || 'symbols',
        RUSTUP_TOOLCHAIN: toolchain
      }
    }
  )
  if ((build.status ?? 1) !== 0) return build.status ?? 1
  if (!existsSync(binaryPath) || !statSync(binaryPath).isFile()) {
    console.error(`[aiopsterm] Codex CLI binary is missing: ${binaryPath}`)
    return 1
  }
  return runCodexRuntimeAudit(projectDir, targetTriple, env)
}

const main = () => {
  if (process.platform === 'win32') {
    return buildCodexPackageOnWindows()
  }

  const build = spawnSync('bash', [join(appRoot, 'scripts', 'build-codex-cli.sh')], {
    cwd: appRoot,
    stdio: 'inherit',
    env: process.env
  })
  return build.status ?? 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main())
}

export {
  assertCodexPackage,
  buildCodexPackageOnWindows,
  cleanCorruptCodexCargoProfile,
  codexBuildPaths,
  packageDirFromBinary
}
