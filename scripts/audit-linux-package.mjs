import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
const version = packageJson.version
const distDir = resolve('dist')
const unpackedDir = join(distDir, 'linux-unpacked')
const nodePtyRoot = join(unpackedDir, 'resources', 'app.asar.unpacked', 'node_modules', 'node-pty')
const appAsar = join(unpackedDir, 'resources', 'app.asar')
const appAsarUnpacked = join(unpackedDir, 'resources', 'app.asar.unpacked')
const appImage = join(distDir, `aiopsterm-${version}-linux-x86_64.AppImage`)
const deb = join(distDir, `aiopsterm-${version}-linux-amd64.deb`)

const requiredFiles = [
  appAsar,
  appAsarUnpacked,
  appImage,
  deb,
  join(nodePtyRoot, 'LICENSE'),
  join(nodePtyRoot, 'package.json'),
  join(nodePtyRoot, 'lib', 'index.js'),
  join(nodePtyRoot, 'lib', 'unixTerminal.js'),
  join(nodePtyRoot, 'lib', 'terminal.js'),
  join(nodePtyRoot, 'lib', 'utils.js'),
  join(nodePtyRoot, 'build', 'Release', 'pty.node')
]

const forbiddenPaths = [
  join(nodePtyRoot, 'bin'),
  join(nodePtyRoot, 'scripts'),
  join(nodePtyRoot, 'src'),
  join(nodePtyRoot, 'deps'),
  join(nodePtyRoot, 'prebuilds'),
  join(nodePtyRoot, 'build', 'node_gyp_bins'),
  join(nodePtyRoot, 'lib', 'eventEmitter2.test.js'),
  join(nodePtyRoot, 'lib', 'terminal.test.js'),
  join(nodePtyRoot, 'lib', 'testUtils.test.js'),
  join(nodePtyRoot, 'lib', 'unixTerminal.test.js'),
  join(nodePtyRoot, 'lib', 'windowsPtyAgent.test.js'),
  join(nodePtyRoot, 'lib', 'windowsTerminal.test.js')
]

const missing = requiredFiles.filter((file) => !existsSync(file))
const presentForbidden = forbiddenPaths.filter((file) => existsSync(file))

if (missing.length) {
  throw new Error(`Missing required packaged files:\n${missing.join('\n')}`)
}

if (presentForbidden.length) {
  throw new Error(`Forbidden packaged node-pty files remain:\n${presentForbidden.join('\n')}`)
}

const extractDir = mkdtempSync(join(tmpdir(), 'aiopsterm-deb-audit-'))
try {
  execFileSync('dpkg-deb', ['-x', deb, extractDir], { stdio: 'pipe' })
  const desktopFile = join(extractDir, 'usr', 'share', 'applications', 'aiopsterm.desktop')
  const desktop = execFileSync('sed', ['-n', '1,120p', desktopFile], { encoding: 'utf8' })
  if (!desktop.includes('MimeType=x-scheme-handler/aiopsterm;')) {
    throw new Error('Deb desktop file is missing aiopsterm scheme registration')
  }
  if (!desktop.includes('Exec=/opt/aiopsterm/aiopsterm %U')) {
    throw new Error('Deb desktop file is missing %U URL argument handling')
  }
} finally {
  rmSync(extractDir, { recursive: true, force: true })
}

const sizeOf = (target) => {
  const stat = statSync(target)
  if (stat.isFile()) return stat.size
  return readdirSync(target).reduce((size, entry) => size + sizeOf(join(target, entry)), 0)
}

const sizeLine = (label, file) => `${label}: ${Math.ceil(sizeOf(file) / 1024)} KiB`
console.log('linux-package-audit-ok')
console.log(sizeLine('app.asar', appAsar))
console.log(sizeLine('app.asar.unpacked', appAsarUnpacked))
console.log(sizeLine('AppImage', appImage))
console.log(sizeLine('deb', deb))
