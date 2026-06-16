import { chmodSync, cpSync, existsSync, rmSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { codexBinaryName, codexPackageDir, packagedCodexBinaryPath, packagedCodexPackageDir } from './codex-runtime-paths.mjs'

const removeIfExists = (target) => {
  if (existsSync(target)) {
    rmSync(target, { recursive: true, force: true })
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

export default async function prunePackagedNativeModules(context) {
  const appOutDir = context?.appOutDir
  const platform = context?.electronPlatformName
  if (!appOutDir) return

  copyCodexCliPackage(context)

  if (platform && platform !== 'linux') return

  const nodePtyRoot = join(appOutDir, 'resources', 'app.asar.unpacked', 'node_modules', 'node-pty')
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

  const sqliteRoot = join(appOutDir, 'resources', 'app.asar.unpacked', 'node_modules', 'better-sqlite3')
  if (!existsSync(sqliteRoot)) return

  ;[
    'deps',
    'src',
    'test',
    'benchmark',
    'build/node_gyp_bins',
    'binding.gyp'
  ].forEach((entry) => removeIfExists(join(sqliteRoot, entry)))
}
