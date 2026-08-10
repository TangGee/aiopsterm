import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, join, relative, resolve } from 'node:path'
import { codexBinaryName, codexTargetTriple } from './codex-runtime-paths.mjs'

const require = createRequire(import.meta.url)
const { listPackage } = require('@electron/asar')

const platform = process.argv.includes('--platform')
  ? process.argv[process.argv.indexOf('--platform') + 1]
  : process.platform
const distDir = resolve('dist')

const unpackedDirForPlatform = () => {
  if (platform === 'win32') return join(distDir, 'win-unpacked')
  if (platform === 'darwin') return join(distDir, process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'aiopsterm.app')
  return join(distDir, 'linux-unpacked')
}

const resourcesDirForPlatform = (unpackedDir) => {
  if (platform === 'darwin') return join(unpackedDir, 'Contents', 'Resources')
  return join(unpackedDir, 'resources')
}

const executableForPlatform = (unpackedDir) => {
  if (platform === 'win32') return join(unpackedDir, 'aiopsterm.exe')
  if (platform === 'darwin') return join(unpackedDir, 'Contents', 'MacOS', 'aiopsterm')
  return join(unpackedDir, 'aiopsterm')
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

const listFiles = (target) => {
  if (!existsSync(target)) return []
  const stat = statSync(target)
  if (stat.isFile()) return [target]
  return readdirSync(target).flatMap((entry) => listFiles(join(target, entry)))
}

const portableRelative = (root, target) => relative(root, target).replaceAll('\\', '/')

const compareVersions = (left, right) => {
  const leftParts = left.split('.').map(Number)
  const rightParts = right.split('.').map(Number)
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0)
    if (difference !== 0) return difference
  }
  return 0
}

const requiredGlibcVersions = (target) => {
  const output = execFileSync('readelf', ['--version-info', target], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024
  })
  return [...new Set([...output.matchAll(/\bGLIBC_(\d+(?:\.\d+)+)\b/g)].map((match) => match[1]))]
}

const readJson = (target, label) => {
  try {
    return JSON.parse(readFileSync(target, 'utf8'))
  } catch (error) {
    throw new Error(`Cannot read ${label}: ${target}\n${error instanceof Error ? error.message : String(error)}`)
  }
}

const unpackedDir = unpackedDirForPlatform()
const resourcesDir = resourcesDirForPlatform(unpackedDir)
const appExecutable = executableForPlatform(unpackedDir)
const codexPackage = join(resourcesDir, 'codex')
const codexBinary = join(codexPackage, 'bin', codexBinaryName(platform))
const clineSidecar = join(resourcesDir, 'cline-sidecar')
const clineNode = join(clineSidecar, platform === 'win32' ? 'node.exe' : 'node')
const sqliteRoot = join(resourcesDir, 'app.asar.unpacked', 'node_modules', 'better-sqlite3')
const sqlitePackagePath = join(sqliteRoot, 'package.json')
const sqliteBindingRoot = join(sqliteRoot, 'lib', 'binding')
const sqliteManifestPath = join(sqliteBindingRoot, 'aiopsterm-native-manifest.json')
const requiredFiles = [
  appExecutable,
  join(resourcesDir, 'app.asar'),
  join(resourcesDir, 'app.asar.unpacked'),
  join(resourcesDir, 'product-telemetry-worker.js'),
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
  join(resourcesDir, 'builtin-plugins', 'linux-incident-runbook', 'aiopsterm.plugin.json'),
  join(resourcesDir, 'builtin-plugins', 'generic-cmdb-assets', 'aiopsterm.plugin.json'),
  sqlitePackagePath,
  sqliteManifestPath,
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

if (platform === 'linux') {
  const glibcBaseline = '2.31'
  const nativeBindings = listFiles(join(resourcesDir, 'app.asar.unpacked')).filter((file) => file.endsWith('.node'))
  const electronElfFiles = listFiles(unpackedDir).filter((file) => /\.so(?:\.\d+)*$/.test(basename(file)))
  const compatibilityFiles = [
    appExecutable,
    join(unpackedDir, 'chrome-sandbox'),
    join(unpackedDir, 'chrome_crashpad_handler'),
    clineNode,
    codexBinary,
    join(codexPackage, 'codex-resources', 'bwrap'),
    ...electronElfFiles,
    ...nativeBindings
  ].filter((file, index, files) => existsSync(file) && files.indexOf(file) === index)
  const incompatibleFiles = compatibilityFiles.flatMap((file) => {
    const versions = requiredGlibcVersions(file)
    const newest = versions.sort(compareVersions).at(-1)
    return newest && compareVersions(newest, glibcBaseline) > 0
      ? [`${portableRelative(unpackedDir, file)} requires GLIBC_${newest}`]
      : []
  })
  if (incompatibleFiles.length) {
    throw new Error(
      `Packaged Linux ELF files exceed the Ubuntu 20.04 GLIBC_${glibcBaseline} baseline:\n${incompatibleFiles.join('\n')}`
    )
  }
}

const sqlitePackage = readJson(sqlitePackagePath, 'packaged better-sqlite3 package metadata')
const sqliteManifest = readJson(sqliteManifestPath, 'packaged better-sqlite3 native manifest')
const sqliteElectron = sqliteManifest?.electron
const sqliteModules = String(sqliteElectron?.modules || '')
const sqliteArch = String(sqliteElectron?.arch || '')
const sqliteBindingDirName = `node-v${sqliteModules}-${platform}-${sqliteArch}`
const sqliteBindingRelativePath = `lib/binding/${sqliteBindingDirName}/better_sqlite3.node`
const sqliteBindingPath = join(sqliteBindingRoot, sqliteBindingDirName, 'better_sqlite3.node')

if (
  sqliteManifest?.schemaVersion !== 1 ||
  sqliteManifest?.betterSqlite3Version !== sqlitePackage.version ||
  sqliteManifest?.electronVersion !== sqliteElectron?.electron ||
  Object.prototype.hasOwnProperty.call(sqliteManifest, 'node') ||
  !/^\d+$/.test(sqliteModules) ||
  !sqliteElectron?.node ||
  !sqliteElectron?.electron ||
  sqliteElectron?.platform !== platform ||
  !sqliteArch ||
  String(sqliteElectron?.bindingPath || '').replaceAll('\\', '/') !== sqliteBindingRelativePath ||
  !/^[a-f0-9]{64}$/i.test(sqliteElectron?.sha256 || '')
) {
  throw new Error(`Packaged better-sqlite3 native manifest is invalid: ${JSON.stringify(sqliteManifest)}`)
}
if (!existsSync(sqliteBindingPath) || !statSync(sqliteBindingPath).isFile()) {
  throw new Error(`Packaged better-sqlite3 Electron binding is missing: ${sqliteBindingPath}`)
}

const packagedSha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
if (packagedSha256(sqliteBindingPath) !== sqliteElectron.sha256) {
  throw new Error('Packaged better-sqlite3 Electron binding does not match its manifest hash.')
}

const shadowSqliteBindings = [
  join(sqliteRoot, 'build', 'better_sqlite3.node'),
  join(sqliteRoot, 'build', 'Debug', 'better_sqlite3.node'),
  join(sqliteRoot, 'build', 'Release', 'better_sqlite3.node'),
  join(sqliteRoot, 'out', 'Debug', 'better_sqlite3.node'),
  join(sqliteRoot, 'Debug', 'better_sqlite3.node'),
  join(sqliteRoot, 'out', 'Release', 'better_sqlite3.node'),
  join(sqliteRoot, 'Release', 'better_sqlite3.node'),
  join(sqliteRoot, 'build', 'default', 'better_sqlite3.node'),
  join(sqliteRoot, 'compiled', sqliteElectron.node, platform, sqliteArch, 'better_sqlite3.node'),
  join(sqliteRoot, 'addon-build', 'release', 'install-root', 'better_sqlite3.node'),
  join(sqliteRoot, 'addon-build', 'debug', 'install-root', 'better_sqlite3.node'),
  join(sqliteRoot, 'addon-build', 'default', 'install-root', 'better_sqlite3.node')
].filter(existsSync)
if (shadowSqliteBindings.length) {
  throw new Error(`Packaged better-sqlite3 contains binding paths that shadow ABI selection:\n${shadowSqliteBindings.join('\n')}`)
}

const sqliteNativeBindings = listFiles(sqliteRoot).filter((file) => basename(file) === 'better_sqlite3.node')
const unexpectedSqliteBindings = sqliteNativeBindings.filter((file) => resolve(file) !== resolve(sqliteBindingPath))
if (sqliteNativeBindings.length !== 1 || unexpectedSqliteBindings.length) {
  throw new Error(
    `Packaged better-sqlite3 must contain only its Electron ABI binding:\n${sqliteNativeBindings.join('\n') || '(none)'}`
  )
}

const unexpectedBindingEntries = readdirSync(sqliteBindingRoot).filter(
  (entry) => entry !== 'aiopsterm-native-manifest.json' && entry !== sqliteBindingDirName
)
const unexpectedTargetBindingFiles = listFiles(join(sqliteBindingRoot, sqliteBindingDirName)).filter(
  (file) => portableRelative(join(sqliteBindingRoot, sqliteBindingDirName), file) !== 'better_sqlite3.node'
)
if (unexpectedBindingEntries.length || unexpectedTargetBindingFiles.length) {
  throw new Error(
    `Packaged better-sqlite3 lib/binding contains unexpected entries: ${[
      ...unexpectedBindingEntries,
      ...unexpectedTargetBindingFiles.map((file) => portableRelative(sqliteBindingRoot, file))
    ].join(', ')}`
  )
}

const sqliteProbeEnvironment = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
delete sqliteProbeEnvironment.ELECTRON_NO_ASAR
delete sqliteProbeEnvironment.NODE_BINDINGS_COMPILED_DIR
const sqliteProbeSource = `
const Database = require(${JSON.stringify(join(resourcesDir, 'app.asar', 'node_modules', 'better-sqlite3'))})
const database = new Database(':memory:')
const row = database.prepare('SELECT 1 AS ok').get()
database.close()
if (row.ok !== 1) throw new Error('Unexpected packaged better-sqlite3 SELECT 1 result.')
process.stdout.write(JSON.stringify({
  node: process.versions.node,
  modules: process.versions.modules,
  electron: process.versions.electron || '',
  platform: process.platform,
  arch: process.arch,
  ok: row.ok
}))
`
let sqliteProbe
try {
  sqliteProbe = JSON.parse(
    execFileSync(appExecutable, ['-e', sqliteProbeSource], {
      cwd: unpackedDir,
      encoding: 'utf8',
      env: sqliteProbeEnvironment,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10000,
      windowsHide: true
    })
  )
} catch (error) {
  const detail = [error instanceof Error ? error.message : String(error), error?.stderr, error?.stdout].filter(Boolean).join('\n')
  throw new Error(`Packaged Electron better-sqlite3 probe failed:\n${detail}`)
}
if (
  sqliteProbe.ok !== 1 ||
  sqliteProbe.modules !== sqliteModules ||
  sqliteProbe.node !== sqliteElectron.node ||
  sqliteProbe.electron !== sqliteElectron.electron ||
  sqliteProbe.platform !== sqliteElectron.platform ||
  sqliteProbe.arch !== sqliteElectron.arch
) {
  throw new Error(`Packaged Electron runtime does not match the better-sqlite3 manifest: ${JSON.stringify(sqliteProbe)}`)
}

const rawNodeRuntimePrefixes = ['node-linux-', 'node-darwin-', 'node-bin-darwin-', 'node-win-']
const duplicateAsarRuntimeFiles = listPackage(join(resourcesDir, 'app.asar')).filter((entry) =>
  rawNodeRuntimePrefixes.some((prefix) => entry.replaceAll('\\', '/').includes(`/node_modules/${prefix}`))
)
const unusedFigTypeScriptFiles = listPackage(join(resourcesDir, 'app.asar')).filter((entry) =>
  entry.replaceAll('\\', '/').includes('/node_modules/@fig/autocomplete-helpers/node_modules/typescript/')
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
if (unusedFigTypeScriptFiles.length) {
  throw new Error(`Unused Fig TypeScript compiler files were packaged:\n${unusedFigTypeScriptFiles.join('\n')}`)
}

const codexMetadata = readJson(join(codexPackage, 'codex-package.json'), 'packaged Codex metadata')
const expectedCodexTarget = codexTargetTriple(platform, process.arch)
if (codexMetadata?.target !== expectedCodexTarget) {
  throw new Error(`Packaged Codex target mismatch: expected ${expectedCodexTarget}, found ${codexMetadata?.target || 'missing'}`)
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
