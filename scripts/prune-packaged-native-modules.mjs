import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const removeIfExists = (target) => {
  if (existsSync(target)) {
    rmSync(target, { recursive: true, force: true })
  }
}

export default async function prunePackagedNativeModules(context) {
  const appOutDir = context?.appOutDir
  const platform = context?.electronPlatformName
  if (!appOutDir) return
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
