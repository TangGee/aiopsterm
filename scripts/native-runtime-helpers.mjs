import { dirname, resolve } from 'node:path'

const nativeRebuildEnvironmentKeys = new Set([
  'npm_config_runtime',
  'npm_config_target',
  'npm_config_arch',
  'npm_config_target_arch',
  'npm_config_platform',
  'npm_config_target_platform',
  'npm_config_disturl',
  'npm_config_dist_url',
  'npm_config_nodedir',
  'npm_config_devdir'
])

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

export const electronHeadersUrl = (env) =>
  env.AIOPSTERM_ELECTRON_HEADERS_URL || 'https://artifacts.electronjs.org/headers/dist'

export const electronRebuildInvocation = ({ cliPath, modules, electronVersion, headersUrl, buildFromSource = false }) => ({
  commandArgs: [
    cliPath,
    '-f',
    ...(buildFromSource ? ['--build-from-source'] : []),
    '-o',
    modules.join(','),
    '-v',
    electronVersion,
    '-d',
    headersUrl
  ]
})

export const npmRebuildInvocation = ({ platform, nodeExecutable, npmExecPath, modules }) => {
  if (platform !== 'win32') return { command: 'npm', args: ['rebuild', ...modules] }
  const npmCli = npmExecPath || resolve(dirname(nodeExecutable), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  return { command: nodeExecutable, args: [npmCli, 'rebuild', ...modules] }
}

export const nativeCompilerEnvironment = ({ platform, env, gcc10Available }) => {
  const result = { ...env }
  if (platform === 'linux' && gcc10Available) {
    if (!result.CC) result.CC = 'gcc-10'
    if (!result.CXX) result.CXX = 'g++-10'
  }
  return result
}

export const shouldRebuildPty = ({ force, target, runtime, probeStatus }) =>
  probeStatus !== 0 || (force && runtime === target)

export const parseNativeManifest = (raw) => {
  try {
    const parsed = JSON.parse(raw)
    return isObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

export const sanitizeNativeRebuildEnvironment = (source) => {
  const env = { ...source }
  for (const key of Object.keys(env)) {
    if (nativeRebuildEnvironmentKeys.has(key.toLowerCase()) || key.toUpperCase() === 'ELECTRON_RUN_AS_NODE') {
      delete env[key]
    }
  }
  return env
}

export const shadowBindingPaths = ({
  sqliteRoot,
  nodeVersion,
  platform,
  arch,
  bindingName = 'better_sqlite3.node'
}) => [
  resolve(sqliteRoot, 'build', bindingName),
  resolve(sqliteRoot, 'build', 'Debug', bindingName),
  resolve(sqliteRoot, 'build', 'Release', bindingName),
  resolve(sqliteRoot, 'out', 'Debug', bindingName),
  resolve(sqliteRoot, 'Debug', bindingName),
  resolve(sqliteRoot, 'out', 'Release', bindingName),
  resolve(sqliteRoot, 'Release', bindingName),
  resolve(sqliteRoot, 'build', 'default', bindingName),
  resolve(sqliteRoot, 'compiled', nodeVersion, platform, arch, bindingName),
  resolve(sqliteRoot, 'addon-build', 'release', 'install-root', bindingName),
  resolve(sqliteRoot, 'addon-build', 'debug', 'install-root', bindingName),
  resolve(sqliteRoot, 'addon-build', 'default', 'install-root', bindingName)
]

export const parseLockOwner = (lockContents) => {
  try {
    const owner = JSON.parse(lockContents)
    if (
      !isObject(owner) ||
      owner.schemaVersion !== 1 ||
      !Number.isInteger(owner.pid) ||
      owner.pid <= 0 ||
      typeof owner.ownerToken !== 'string' ||
      owner.ownerToken.length < 8 ||
      !Number.isFinite(owner.createdAt)
    ) return null
    return owner
  } catch {
    return null
  }
}

export const shouldRecoverLock = ({
  lockContents,
  lockMtimeMs,
  now,
  staleAfterMs,
  isProcessAlive
}) => {
  const owner = parseLockOwner(lockContents)
  if (owner) return !isProcessAlive(owner.pid)
  return Number.isFinite(lockMtimeMs) && now - lockMtimeMs >= staleAfterMs
}

export const lockOwnedBy = (lockContents, ownerToken) => parseLockOwner(lockContents)?.ownerToken === ownerToken

export const mergeNativeManifest = ({ currentManifest, base, records, isRecordValid }) => {
  const currentMatchesPackage =
    isObject(currentManifest) &&
    currentManifest.schemaVersion === base.schemaVersion &&
    currentManifest.betterSqlite3Version === base.betterSqlite3Version
  const merged = { ...base }

  for (const runtime of ['node', 'electron']) {
    if (records[runtime]) {
      merged[runtime] = records[runtime]
      continue
    }
    const currentRecord = currentMatchesPackage ? currentManifest[runtime] : null
    if (currentRecord && isRecordValid(runtime, currentRecord)) merged[runtime] = currentRecord
  }

  if (!merged.electronVersion && merged.electron && currentMatchesPackage && typeof currentManifest.electronVersion === 'string') {
    merged.electronVersion = currentManifest.electronVersion
  }
  return merged
}
