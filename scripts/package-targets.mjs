import { spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

export const packageTargets = {
  'linux-appimage': {
    platform: 'linux',
    buildScript: 'build:linux:appimage',
    artifacts: ['dist/aiopsterm-${version}-linux-${arch}.AppImage'],
    unpackedDirs: ['dist/linux-unpacked']
  },
  'linux-deb': {
    platform: 'linux',
    buildScript: 'build:deb',
    artifacts: ['dist/aiopsterm-${version}-linux-${arch}.deb'],
    unpackedDirs: ['dist/linux-unpacked']
  },
  macos: {
    platform: 'darwin',
    buildScript: 'build:mac',
    artifacts: ['dist/aiopsterm-${version}-macos-${arch}.dmg', 'dist/aiopsterm-${version}-macos-${arch}.zip'],
    unpackedDirs: ['dist/mac']
  },
  windows: {
    platform: 'win32',
    buildScript: 'build:win',
    artifacts: ['dist/aiopsterm-${version}-setup-${arch}.exe'],
    unpackedDirs: ['dist/win-unpacked']
  }
}

export const packageTargetNames = Object.keys(packageTargets)

export const packageArtifactArch = (targetName, nodeArch = process.arch) => {
  if (nodeArch === 'x64' && targetName === 'linux-appimage') return 'x86_64'
  if (nodeArch === 'x64' && targetName === 'linux-deb') return 'amd64'
  return nodeArch
}

export const expandPackageTargetArtifact = (targetName, pattern, version, nodeArch = process.arch) =>
  pattern.replace('${version}', version).replace('${arch}', packageArtifactArch(targetName, nodeArch))

export const packageTargetArtifactPaths = (targetName, version, cwd = process.cwd(), nodeArch = process.arch) =>
  packageTargets[targetName].artifacts.map((pattern) => resolve(cwd, expandPackageTargetArtifact(targetName, pattern, version, nodeArch)))

export const packageTargetUnpackedPaths = (targetName, cwd = process.cwd()) =>
  (packageTargets[targetName].unpackedDirs || []).map((dir) => resolve(cwd, dir))

export const cleanPackageTargetOutput = (targetName, version, cwd = process.cwd()) => {
  for (const outputPath of [...packageTargetArtifactPaths(targetName, version, cwd), ...packageTargetUnpackedPaths(targetName, cwd)]) {
    if (existsSync(outputPath)) rmSync(outputPath, { recursive: true, force: true })
  }
}

export const runNpmScript = (script, args = []) => {
  const executable = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  return spawnSync(executable, ['run', script, ...args], {
    stdio: 'inherit',
    env: process.env
  })
}

export const isPackageTargetName = (value) => Object.prototype.hasOwnProperty.call(packageTargets, value)
