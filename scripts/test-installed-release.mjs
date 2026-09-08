import { spawnSync } from 'node:child_process'
import { mkdtemp, readdir, cp, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import payloadAudit from './regression-installed-payload.cjs'

// Native installers may modify OS registration. Run only on disposable CI machines.
if (process.env.CI !== 'true') throw new Error('Installer regression requires a disposable CI runner.')
const dist = resolve(process.argv[2] || 'dist')
const previous = process.env.AIOPSTERM_PREVIOUS_INSTALLER
if (!previous) throw new Error('An actual previous release installer is required for upgrade regression.')
const stage = await mkdtemp(join(tmpdir(), 'aiopsterm-install-regression-'))
const installed = join(stage, 'installed')
const state = join(stage, 'user-state')
const run = (command, args, extra = {}) => {
  const result = spawnSync(command, args, { stdio: 'inherit', timeout: 15 * 60 * 1000, ...extra })
  if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.error || result.status}`)
}
const entries = await readdir(dist)
const suffix = process.platform === 'win32' ? '.exe' : process.platform === 'darwin' ? '.dmg' : '.deb'
const candidates = entries.filter((name) => name.endsWith(suffix))
if (candidates.length !== 1) throw new Error(`Expected one ${suffix} installer, found ${candidates.length}.`)
const current = join(dist, candidates[0])
const install = async (artifact) => {
  if (process.platform === 'win32') {
    run(artifact, ['/S', `/D=${installed}`])
    return join(installed, 'aiopsterm.exe')
  }
  if (process.platform === 'darwin') {
    const mount = join(stage, 'mounted')
    run('hdiutil', ['attach', artifact, '-nobrowse', '-readonly', '-mountpoint', mount])
    try {
      const apps = (await readdir(mount)).filter((name) => name.endsWith('.app'))
      if (apps.length !== 1) throw new Error('Expected one application in DMG.')
      await rm(join(installed, 'aiopsterm.app'), { recursive: true, force: true })
      await cp(join(mount, apps[0]), join(installed, 'aiopsterm.app'), { recursive: true, verbatimSymlinks: true })
    } finally { run('hdiutil', ['detach', mount]) }
    return join(installed, 'aiopsterm.app', 'Contents', 'MacOS', 'aiopsterm')
  }
  const privilege = process.getuid?.() === 0 ? [] : ['sudo']
  run(privilege[0] || 'dpkg', [...privilege.slice(1), ...(privilege.length ? ['dpkg'] : []), '-i', artifact])
  return '/opt/aiopsterm/aiopsterm'
}
const smoke = (executable, phase) => {
  const args = [resolve('node_modules/@playwright/test/cli.js'), 'test', '-c', 'playwright.install.config.ts']
  const env = { ...process.env, AIOPSTERM_PACKAGED_APP: executable, AIOPSTERM_INSTALL_STATE: state, AIOPSTERM_INSTALL_PHASE: phase }
  if (process.platform === 'linux' && !process.env.DISPLAY) run('xvfb-run', ['-a', process.execPath, ...args], { env })
  else run(process.execPath, args, { env })
}
const uninstall = async (executable) => {
  if (process.platform === 'win32') {
    const uninstallers = (await readdir(installed)).filter((name) => /^Uninstall.*\.exe$/i.test(name))
    if (uninstallers.length !== 1) throw new Error('Missing uninstaller.')
    run(join(installed, uninstallers[0]), ['/S'])
  } else if (process.platform === 'darwin') {
    await rm(join(installed, 'aiopsterm.app'), { recursive: true })
  } else {
    const args = ['--remove', 'aiopsterm']
    if (process.getuid?.() === 0) run('dpkg', args)
    else run('sudo', ['dpkg', ...args])
  }
  const deadline = Date.now() + 30000
  while (await access(executable).then(() => true, () => false)) {
    if (Date.now() >= deadline) throw new Error('Uninstaller did not remove the application executable.')
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}
try {
  smoke(await install(resolve(previous)), 'seed-old')
  const executable = await install(current)
  const unpacked = join(dist, process.platform === 'win32' ? 'win-unpacked' : process.platform === 'darwin' ? (process.arch === 'arm64' ? 'mac-arm64' : 'mac') : 'linux-unpacked')
  const payload = process.platform === 'linux' ? '/opt/aiopsterm' : installed
  await payloadAudit.compareInstalledPayload(unpacked, payload)
  smoke(executable, 'verify-upgrade')
  await uninstall(executable)
  // Reinstall proves the explicitly isolated user settings survive removal.
  const reinstalled = await install(current)
  await payloadAudit.compareInstalledPayload(unpacked, payload)
  smoke(reinstalled, 'verify-reinstall')
  await uninstall(reinstalled)
} finally {
  await rm(stage, { recursive: true, force: true })
}
