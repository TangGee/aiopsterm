import { join, resolve } from 'node:path'

export const codexBinaryName = (platform = process.platform) => (platform === 'win32' ? 'codex.exe' : 'codex')

export const normalizeNodeArch = (arch = process.arch) => {
  if (arch === 1 || arch === '1' || arch === 'x64') return 'x64'
  if (arch === 3 || arch === '3' || arch === 'arm64') return 'arm64'
  if (arch === 0 || arch === '0' || arch === 'ia32') return 'ia32'
  if (arch === 2 || arch === '2' || arch === 'armv7l') return 'armv7l'
  if (arch === 4 || arch === '4' || arch === 'universal') return 'universal'
  return String(arch)
}

export const codexTargetTriple = (platform = process.platform, arch = process.arch) => {
  arch = normalizeNodeArch(arch)
  if (platform === 'linux' || platform === 'android') {
    if (arch === 'x64') return 'x86_64-unknown-linux-musl'
    if (arch === 'arm64') return 'aarch64-unknown-linux-musl'
  }
  if (platform === 'darwin') {
    if (arch === 'x64') return 'x86_64-apple-darwin'
    if (arch === 'arm64') return 'aarch64-apple-darwin'
  }
  if (platform === 'win32') {
    if (arch === 'x64') return 'x86_64-pc-windows-msvc'
    if (arch === 'arm64') return 'aarch64-pc-windows-msvc'
  }
  throw new Error(`Unsupported Codex target platform: ${platform} (${arch})`)
}

export const codexDevTargetTriple = (platform = process.platform, arch = process.arch) => {
  arch = normalizeNodeArch(arch)
  if (platform === 'linux' || platform === 'android') {
    if (arch === 'x64') return 'x86_64-unknown-linux-gnu'
    if (arch === 'arm64') return 'aarch64-unknown-linux-gnu'
  }
  return codexTargetTriple(platform, arch)
}

export const codexPackageDir = (projectDir = process.cwd(), platform = process.platform, arch = process.arch) =>
  resolve(
    projectDir,
    'codex',
    'codex-rs',
    'target',
    codexTargetTriple(platform, arch),
    'aiopsterm-codex-package'
  )

export const codexDevPackageDir = (projectDir = process.cwd(), platform = process.platform, arch = process.arch) =>
  resolve(
    projectDir,
    'codex',
    'codex-rs',
    'target',
    codexDevTargetTriple(platform, arch),
    'aiopsterm-codex-dev-package'
  )

export const codexBuildBinaryPath = (projectDir = process.cwd(), platform = process.platform, arch = process.arch) =>
  join(codexPackageDir(projectDir, platform, arch), 'bin', codexBinaryName(platform))

export const codexDevBuildBinaryPath = (projectDir = process.cwd(), platform = process.platform, arch = process.arch) =>
  join(codexDevPackageDir(projectDir, platform, arch), 'bin', codexBinaryName(platform))

export const codexLegacyCargoBinaryPath = (projectDir = process.cwd(), platform = process.platform, arch = process.arch) =>
  resolve(
    projectDir,
    'codex',
    'codex-rs',
    'target',
    codexTargetTriple(platform, arch),
    'release',
    codexBinaryName(platform)
  )

export const packagedCodexPackageDir = (resourcesDir) => join(resourcesDir, 'codex')

export const packagedCodexBinaryPath = (resourcesDir, platform = process.platform) =>
  join(packagedCodexPackageDir(resourcesDir), 'bin', codexBinaryName(platform))
