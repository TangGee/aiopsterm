import { createHash } from 'node:crypto'
import { chmodSync, cpSync, existsSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import {
  codexBinaryName,
  codexPackageDir,
  normalizeNodeArch,
  packagedCodexBinaryPath,
  packagedCodexPackageDir
} from './codex-runtime-paths.mjs'

const removeIfExists = (target) => {
  if (existsSync(target)) {
    rmSync(target, { recursive: true, force: true })
  }
}

const sha256 = (target) => createHash('sha256').update(readFileSync(target)).digest('hex')

const readJson = (target, label) => {
  try {
    return JSON.parse(readFileSync(target, 'utf8'))
  } catch (error) {
    throw new Error(`Cannot read ${label}: ${target}\n${error instanceof Error ? error.message : String(error)}`)
  }
}

const packagedResourcesDir = (context) => {
  const appOutDir = context?.appOutDir
  if (!appOutDir) return ''
  if (context?.electronPlatformName === 'darwin') {
    const productFilename = context?.packager?.appInfo?.productFilename || context?.packager?.appInfo?.productName || 'aiopsterm'
    return join(appOutDir, `${productFilename}.app`, 'Contents', 'Resources')
  }
  return join(appOutDir, 'resources')
}

const inferPackageDirFromBinary = (binaryPath) => {
  const binDir = dirname(binaryPath)
  const packageDir = dirname(binDir)
  if (basename(binDir) !== 'bin') return ''
  return existsSync(join(packageDir, 'codex-package.json')) ? packageDir : ''
}

const resolveCodexPackageSource = (context) => {
  const platform = context?.electronPlatformName || process.platform
  const arch = context?.arch || process.arch
  const projectDir = context?.packager?.projectDir || process.cwd()
  if (process.env.AIOPSTERM_CODEX_PACKAGE_DIR) return process.env.AIOPSTERM_CODEX_PACKAGE_DIR
  if (process.env.AIOPSTERM_CODEX_BIN) {
    const packageDir = inferPackageDirFromBinary(process.env.AIOPSTERM_CODEX_BIN)
    if (!packageDir) {
      throw new Error(
        'AIOPSTERM_CODEX_BIN points at a bare executable. Packaging requires a full Codex package directory; set AIOPSTERM_CODEX_PACKAGE_DIR.'
      )
    }
    return packageDir
  }
  return codexPackageDir(projectDir, platform, arch)
}

const copyCodexCliPackage = (context) => {
  const platform = context?.electronPlatformName || process.platform
  const sourceDir = resolveCodexPackageSource(context)
  const sourceBinary = process.env.AIOPSTERM_CODEX_BIN || join(sourceDir, 'bin', codexBinaryName(platform))
  const sourceMetadata = join(sourceDir, 'codex-package.json')
  if (!existsSync(sourceDir) || !existsSync(sourceMetadata) || !existsSync(sourceBinary)) {
    throw new Error(`Codex package is required for packaging but was not found: ${sourceDir}`)
  }
  const resourcesDir = packagedResourcesDir(context)
  if (!resourcesDir) throw new Error('Cannot resolve packaged resources directory for Codex package.')
  const targetDir = packagedCodexPackageDir(resourcesDir)
  removeIfExists(targetDir)
  cpSync(sourceDir, targetDir, { recursive: true, force: true })
  chmodSync(packagedCodexBinaryPath(resourcesDir, platform), 0o755)
}

const prunePackagedSqlite = (context) => {
  const platform = context?.electronPlatformName || process.platform
  const arch = normalizeNodeArch(context?.arch ?? process.arch)
  const resourcesDir = packagedResourcesDir(context)
  const sqliteRoot = join(resourcesDir, 'app.asar.unpacked', 'node_modules', 'better-sqlite3')
  const bindingRoot = join(sqliteRoot, 'lib', 'binding')
  const manifestPath = join(bindingRoot, 'aiopsterm-native-manifest.json')
  const packagePath = join(sqliteRoot, 'package.json')

  if (!existsSync(sqliteRoot) || !existsSync(packagePath) || !existsSync(manifestPath)) {
    throw new Error(`Packaged better-sqlite3 and its native manifest are required: ${sqliteRoot}`)
  }

  const manifest = readJson(manifestPath, 'packaged better-sqlite3 native manifest')
  const sqlitePackage = readJson(packagePath, 'packaged better-sqlite3 package metadata')
  const electron = manifest?.electron
  const modules = String(electron?.modules || '')
  const targetBindingDirName = `node-v${modules}-${platform}-${arch}`
  const targetBindingRelativePath = `lib/binding/${targetBindingDirName}/better_sqlite3.node`
  const targetBindingPath = join(bindingRoot, targetBindingDirName, 'better_sqlite3.node')

  if (
    manifest?.schemaVersion !== 1 ||
    manifest?.betterSqlite3Version !== sqlitePackage.version ||
    manifest?.electronVersion !== electron?.electron ||
    !electron ||
    !/^\d+$/.test(modules) ||
    !electron.node ||
    electron.platform !== platform ||
    electron.arch !== arch ||
    String(electron.bindingPath || '').replaceAll('\\', '/') !== targetBindingRelativePath ||
    !existsSync(targetBindingPath) ||
    !statSync(targetBindingPath).isFile() ||
    !/^[a-f0-9]{64}$/i.test(electron.sha256 || '') ||
    sha256(targetBindingPath) !== electron.sha256
  ) {
    throw new Error(
      `The packaged better-sqlite3 Electron binding is missing or does not match ${platform}/${arch}: ${targetBindingPath}`
    )
  }

  for (const entry of readdirSync(bindingRoot)) {
    if (entry !== targetBindingDirName && entry !== 'aiopsterm-native-manifest.json') {
      removeIfExists(join(bindingRoot, entry))
    }
  }
  for (const entry of readdirSync(dirname(targetBindingPath))) {
    if (entry !== basename(targetBindingPath)) removeIfExists(join(dirname(targetBindingPath), entry))
  }

  // bindings@1.5.0 checks these roots before its ABI-keyed lib/binding path.
  ;['build', 'out', 'Debug', 'Release', 'compiled', 'addon-build'].forEach((entry) => removeIfExists(join(sqliteRoot, entry)))
  ;['deps', 'src', 'test', 'benchmark', 'binding.gyp'].forEach((entry) => removeIfExists(join(sqliteRoot, entry)))

  const packagedManifest = {
    ...manifest,
    electron: {
      ...electron,
      bindingPath: targetBindingRelativePath
    }
  }
  delete packagedManifest.node
  const temporaryManifestPath = `${manifestPath}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(temporaryManifestPath, `${JSON.stringify(packagedManifest, null, 2)}\n`)
  rmSync(manifestPath, { force: true })
  renameSync(temporaryManifestPath, manifestPath)
}

export default async function prunePackagedNativeModules(context) {
  const appOutDir = context?.appOutDir
  const platform = context?.electronPlatformName || process.platform
  if (!appOutDir) return

  copyCodexCliPackage(context)

  prunePackagedSqlite(context)

  if (platform !== 'linux') return

  const nodePtyRoot = join(packagedResourcesDir(context), 'app.asar.unpacked', 'node_modules', 'node-pty')
  if (!existsSync(nodePtyRoot)) return

  const removeEntries = [
    'bin',
    'scripts',
    'src',
    'deps',
    'prebuilds',
    'build/node_gyp_bins',
    'lib/eventEmitter2.test.js',
    'lib/terminal.test.js',
    'lib/testUtils.test.js',
    'lib/unixTerminal.test.js',
    'lib/windowsPtyAgent.test.js',
    'lib/windowsTerminal.test.js'
  ]

  removeEntries.forEach((entry) => removeIfExists(join(nodePtyRoot, entry)))
}
