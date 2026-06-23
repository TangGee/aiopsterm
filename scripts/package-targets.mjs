import { spawnSync } from 'node:child_process'

export const packageTargets = {
  'linux-appimage': {
    platform: 'linux',
    buildScript: 'build:linux:appimage',
    verifyScript: 'verify:package:linux-appimage',
    artifacts: ['dist/aiopsterm-${version}-linux-${arch}.AppImage']
  },
  'linux-deb': {
    platform: 'linux',
    buildScript: 'build:deb',
    verifyScript: 'verify:package:linux-deb',
    artifacts: ['dist/aiopsterm-${version}-linux-${arch}.deb']
  },
  macos: {
    platform: 'darwin',
    buildScript: 'build:mac',
    verifyScript: 'verify:package:macos',
    artifacts: ['dist/aiopsterm-${version}-macos-${arch}.dmg', 'dist/aiopsterm-${version}-macos-${arch}.zip']
  },
  windows: {
    platform: 'win32',
    buildScript: 'build:win',
    verifyScript: 'verify:package:windows',
    artifacts: ['dist/aiopsterm-${version}-setup-${arch}.exe']
  }
}

export const packageTargetNames = Object.keys(packageTargets)

export const runNpmScript = (script, args = []) => {
  const executable = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  return spawnSync(executable, ['run', script, ...args], {
    stdio: 'inherit',
    env: process.env
  })
}

export const isPackageTargetName = (value) => Object.prototype.hasOwnProperty.call(packageTargets, value)
