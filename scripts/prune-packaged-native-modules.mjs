import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const removeIfExists = (target) => {
  if (existsSync(target)) {
    rmSync(target, { recursive: true, force: true })
  }
}

const codexBinaryName = (platform) => (platform === 'win32' ? 'codex.exe' : 'codex')

const packagedResourcesDir = (context) => {
  const appOutDir = context?.appOutDir
  if (!appOutDir) return ''
  if (context?.electronPlatformName === 'darwin') {
    const productFilename = context?.packager?.appInfo?.productFilename || context?.packager?.appInfo?.productName || 'aiopsterm'
    return join(appOutDir, `${productFilename}.app`, 'Contents', 'Resources')
  }
  return join(appOutDir, 'resources')
}

const copyCodexCliBinary = (context) => {
  const platform = context?.electronPlatformName || process.platform
  const projectDir = context?.packager?.projectDir || process.cwd()
  const source =
    process.env.AIOPSTERM_CODEX_BIN ||
    join(projectDir, 'codex', 'codex-rs', 'target', 'release', codexBinaryName(platform))
  if (!existsSync(source)) {
    throw new Error(`Codex CLI binary is required for packaging but was not found: ${source}`)
  }
  const resourcesDir = packagedResourcesDir(context)
  if (!resourcesDir) throw new Error('Cannot resolve packaged resources directory for Codex CLI binary.')
  const targetDir = join(resourcesDir, 'codex')
  const target = join(targetDir, codexBinaryName(platform))
  mkdirSync(targetDir, { recursive: true })
  copyFileSync(source, target)
  chmodSync(target, 0o755)
}

export default async function prunePackagedNativeModules(context) {
  const appOutDir = context?.appOutDir
  const platform = context?.electronPlatformName
  if (!appOutDir) return

  copyCodexCliBinary(context)

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
