import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { codexBinaryName } from './codex-runtime-paths.mjs'

const platform = process.argv.includes('--platform')
  ? process.argv[process.argv.indexOf('--platform') + 1]
  : process.platform
const distDir = resolve('dist')

const unpackedDirForPlatform = () => {
  if (platform === 'win32') return join(distDir, 'win-unpacked')
  if (platform === 'darwin') return join(distDir, 'mac', 'aiopsterm.app')
  return join(distDir, 'linux-unpacked')
}

const resourcesDirForPlatform = (unpackedDir) => {
  if (platform === 'darwin') return join(unpackedDir, 'Contents', 'Resources')
  return join(unpackedDir, 'resources')
}

const nativeModuleFilesForPlatform = (resourcesDir) => {
  const root = join(resourcesDir, 'app.asar.unpacked', 'node_modules', 'node-pty')
  if (platform === 'win32') {
    return [join(root, 'lib', 'index.js'), join(root, 'lib', 'windowsTerminal.js'), join(root, 'build', 'Release', 'pty.node')]
  }
  return [join(root, 'lib', 'index.js'), join(root, 'lib', 'unixTerminal.js'), join(root, 'build', 'Release', 'pty.node')]
}

const sizeOf = (target) => {
  const stat = statSync(target)
  if (stat.isFile()) return stat.size
  return readdirSync(target).reduce((size, entry) => size + sizeOf(join(target, entry)), 0)
}

const unpackedDir = unpackedDirForPlatform()
const resourcesDir = resourcesDirForPlatform(unpackedDir)
const codexPackage = join(resourcesDir, 'codex')
const codexBinary = join(codexPackage, 'bin', codexBinaryName(platform))
const requiredFiles = [
  join(resourcesDir, 'app.asar'),
  join(resourcesDir, 'app.asar.unpacked'),
  join(codexPackage, 'codex-package.json'),
  codexBinary,
  join(codexPackage, 'codex-path', platform === 'win32' ? 'rg.exe' : 'rg'),
  ...nativeModuleFilesForPlatform(resourcesDir)
]
if (platform === 'linux') requiredFiles.push(join(codexPackage, 'codex-resources', 'bwrap'))
if (platform === 'win32') {
  requiredFiles.push(
    join(codexPackage, 'codex-resources', 'codex-command-runner.exe'),
    join(codexPackage, 'codex-resources', 'codex-windows-sandbox-setup.exe')
  )
}

const missing = requiredFiles.filter((file) => !existsSync(file))
if (missing.length) {
  throw new Error(`Missing required packaged files for ${platform}:\n${missing.join('\n')}`)
}

if (platform !== 'win32' && (statSync(codexBinary).mode & 0o111) === 0) {
  throw new Error(`Packaged Codex CLI binary is not executable: ${codexBinary}`)
}

const codexVersion = execFileSync(codexBinary, ['--version'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  timeout: 10000
}).trim()
if (!/^codex-cli\s+\S+/.test(codexVersion)) {
  throw new Error(`Packaged Codex CLI binary returned an unexpected --version value: ${codexVersion}`)
}

const sizeLine = (label, file) => `${label}: ${Math.ceil(sizeOf(file) / 1024)} KiB`
console.log('packaged-app-audit-ok')
console.log(`platform: ${platform}`)
console.log(sizeLine('app.asar', join(resourcesDir, 'app.asar')))
console.log(sizeLine('app.asar.unpacked', join(resourcesDir, 'app.asar.unpacked')))
console.log(sizeLine('codex', codexBinary))
