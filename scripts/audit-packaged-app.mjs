import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { codexBinaryName } from './codex-runtime-paths.mjs'

const require = createRequire(import.meta.url)
const { listPackage } = require('@electron/asar')

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
const clineSidecar = join(resourcesDir, 'cline-sidecar')
const clineNode = join(clineSidecar, platform === 'win32' ? 'node.exe' : 'node')
const requiredFiles = [
  join(resourcesDir, 'app.asar'),
  join(resourcesDir, 'app.asar.unpacked'),
  join(codexPackage, 'codex-package.json'),
  codexBinary,
  join(codexPackage, 'codex-path', platform === 'win32' ? 'rg.exe' : 'rg'),
  clineNode,
  join(clineSidecar, 'cline-agent-sidecar.cjs'),
  join(clineSidecar, 'manifest.json'),
  join(clineSidecar, 'metafile.json'),
  join(clineSidecar, 'sbom.cdx.json'),
  join(clineSidecar, 'THIRD-PARTY-NOTICES.txt'),
  join(clineSidecar, 'NODE-LICENSE'),
  join(clineSidecar, 'CLINE-LICENSE'),
  join(clineSidecar, 'CLINE-ATTRIBUTION.txt'),
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

const rawNodeRuntimePrefixes = ['node-linux-', 'node-darwin-', 'node-bin-darwin-', 'node-win-']
const duplicateAsarRuntimeFiles = listPackage(join(resourcesDir, 'app.asar')).filter((entry) =>
  rawNodeRuntimePrefixes.some((prefix) => entry.replaceAll('\\', '/').includes(`/node_modules/${prefix}`))
)
const unpackedNodeModules = join(resourcesDir, 'app.asar.unpacked', 'node_modules')
const duplicateUnpackedRuntimes = existsSync(unpackedNodeModules)
  ? readdirSync(unpackedNodeModules).filter((entry) => rawNodeRuntimePrefixes.some((prefix) => entry.startsWith(prefix)))
  : []
if (duplicateAsarRuntimeFiles.length || duplicateUnpackedRuntimes.length) {
  throw new Error(`Raw Node runtime npm packages were duplicated outside cline-sidecar: ${[
    ...duplicateAsarRuntimeFiles,
    ...duplicateUnpackedRuntimes
  ].join(', ')}`)
}

if (platform !== 'win32' && (statSync(codexBinary).mode & 0o111) === 0) {
  throw new Error(`Packaged Codex CLI binary is not executable: ${codexBinary}`)
}
if (platform !== 'win32' && (statSync(clineNode).mode & 0o111) === 0) {
  throw new Error(`Packaged Cline sidecar Node runtime is not executable: ${clineNode}`)
}

const codexVersion = execFileSync(codexBinary, ['--version'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  timeout: 10000
}).trim()
if (!/^codex-cli\s+\S+/.test(codexVersion)) {
  throw new Error(`Packaged Codex CLI binary returned an unexpected --version value: ${codexVersion}`)
}

const clineNodeVersion = execFileSync(clineNode, ['--version'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  timeout: 10000
}).trim()
if (clineNodeVersion !== 'v22.20.0') {
  throw new Error(`Packaged Cline sidecar Node runtime returned an unexpected --version value: ${clineNodeVersion}`)
}
const clineManifest = JSON.parse(readFileSync(join(clineSidecar, 'manifest.json'), 'utf8'))
const clineRuntimePackage = {
  'linux:x64': 'node-linux-x64',
  'linux:arm64': 'node-linux-arm64',
  'darwin:x64': 'node-darwin-x64',
  'darwin:arm64': 'node-bin-darwin-arm64',
  'win32:x64': 'node-win-x64',
  'win32:arm64': 'node-win-arm64'
}[`${platform}:${process.arch}`]
if (
  clineManifest.nodeVersion !== '22.20.0' ||
  clineManifest.runtimePackage !== clineRuntimePackage ||
  clineManifest.bundle !== 'cline-agent-sidecar.cjs' ||
  clineManifest.distributionReady !== true
) {
  throw new Error(`Packaged Cline sidecar manifest is invalid: ${JSON.stringify(clineManifest)}`)
}
const packagedSha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
if (
  packagedSha256(clineNode) !== clineManifest.runtimeSha256 ||
  packagedSha256(join(clineSidecar, 'cline-agent-sidecar.cjs')) !== clineManifest.bundleSha256
) {
  throw new Error('Packaged Cline sidecar hashes do not match its manifest.')
}
if (platform === 'linux') {
  const dynamicLinks = execFileSync('ldd', [clineNode], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10000
  })
  if (/\bnot found\b|lib(?:ssl|crypto)\.so\.1\.1\b/i.test(dynamicLinks)) {
    throw new Error(`Packaged Cline sidecar Node runtime has unsupported dynamic links:\n${dynamicLinks}`)
  }
}

const sizeLine = (label, file) => `${label}: ${Math.ceil(sizeOf(file) / 1024)} KiB`
console.log('packaged-app-audit-ok')
console.log(`platform: ${platform}`)
console.log(sizeLine('app.asar', join(resourcesDir, 'app.asar')))
console.log(sizeLine('app.asar.unpacked', join(resourcesDir, 'app.asar.unpacked')))
console.log(sizeLine('codex', codexBinary))
console.log(sizeLine('cline-sidecar', clineSidecar))
