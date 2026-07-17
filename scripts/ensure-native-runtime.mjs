import { spawnSync } from 'node:child_process'
import { randomUUID, createHash } from 'node:crypto'
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  lockOwnedBy,
  mergeNativeManifest,
  parseNativeManifest,
  sanitizeNativeRebuildEnvironment,
  shadowBindingPaths,
  shouldRecoverLock
} from './native-runtime-helpers.mjs'

const require = createRequire(import.meta.url)
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const target = process.argv[2] || ''
const checkOnly = process.argv.includes('--check')
const force = process.argv.includes('--force')
const supportedTargets = new Set(['node', 'electron'])

if (!supportedTargets.has(target) || (checkOnly && force)) {
  console.error('Usage: node scripts/ensure-native-runtime.mjs <node|electron> [--check|--force]')
  process.exit(2)
}

const sqlitePackagePath = require.resolve('better-sqlite3/package.json')
const sqliteRoot = dirname(sqlitePackagePath)
const sqlitePackage = JSON.parse(readFileSync(sqlitePackagePath, 'utf8'))
const bindingRoot = resolve(sqliteRoot, 'lib', 'binding')
const manifestPath = resolve(bindingRoot, 'aiopsterm-native-manifest.json')
const lockRoot = resolve(projectRoot, '.cache', 'aiopsterm-native-runtime')
const lockPath = resolve(lockRoot, 'prepare.lock')
const lockWaitTimeoutMs = 120_000
const malformedLockStaleMs = 30_000
const sleepState = new Int32Array(new SharedArrayBuffer(4))
const runtimeNames = target === 'electron' ? ['node', 'electron'] : ['node']
let electronRuntime

const electron = () => {
  if (!electronRuntime) {
    const executable = require('electron')
    const packageJson = JSON.parse(readFileSync(require.resolve('electron/package.json'), 'utf8'))
    electronRuntime = { executable, version: packageJson.version }
  }
  return electronRuntime
}

const runRuntime = (runtime, source) => {
  const env = { ...process.env }
  if (runtime === 'electron') env.ELECTRON_RUN_AS_NODE = '1'
  else delete env.ELECTRON_RUN_AS_NODE
  return spawnSync(runtime === 'electron' ? electron().executable : process.execPath, ['-e', source], {
    cwd: projectRoot,
    env,
    encoding: 'utf8'
  })
}

const runtimeInfo = (runtime) => {
  const result = runRuntime(runtime, `process.stdout.write(JSON.stringify({
    node: process.versions.node,
    modules: process.versions.modules,
    napi: process.versions.napi,
    electron: process.versions.electron || '',
    platform: process.platform,
    arch: process.arch
  }))`)
  if (result.status !== 0) {
    throw new Error(`Cannot inspect ${runtime} runtime: ${result.stderr || result.error?.message || `exit ${result.status}`}`)
  }
  return JSON.parse(result.stdout)
}

const runtimes = Object.fromEntries(runtimeNames.map((runtime) => [runtime, runtimeInfo(runtime)]))

const bindingPathForInfo = (info) =>
  resolve(bindingRoot, `node-v${info.modules}-${info.platform}-${info.arch}`, 'better_sqlite3.node')
const bindingPathFor = (runtime) => bindingPathForInfo(runtimes[runtime])

const probeSource = (nativeBinding, includePty) => `
const Database = require('better-sqlite3')
const database = new Database(':memory:'${nativeBinding ? `, { nativeBinding: ${JSON.stringify(nativeBinding)} }` : ''})
const row = database.prepare('SELECT 1 AS ok').get()
database.close()
if (row.ok !== 1) throw new Error('better-sqlite3 in-memory probe returned an unexpected result.')
${includePty ? `
const pty = require('node-pty')
if (typeof pty.spawn !== 'function') throw new Error('node-pty did not expose spawn().')
` : ''}
process.stdout.write(JSON.stringify({ modules: process.versions.modules, node: process.versions.node, electron: process.versions.electron || '' }))
`

const probe = (runtime, nativeBinding, includePty = true) => runRuntime(runtime, probeSource(nativeBinding, includePty))
const probeFailure = (result) =>
  [result.error?.message, result.stderr, result.stdout].filter(Boolean).join('\n').trim() || `probe exited with status ${result.status}`
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')

const readManifest = () => {
  try {
    return parseNativeManifest(readFileSync(manifestPath, 'utf8'))
  } catch {
    return null
  }
}

const manifestRecordIntegrityValid = (_runtime, record) => {
  if (
    !record ||
    !/^\d+$/.test(record.modules) ||
    !/^[a-z0-9_.-]+$/i.test(record.platform) ||
    !/^[a-z0-9_.-]+$/i.test(record.arch) ||
    typeof record.sha256 !== 'string'
  ) return false
  const bindingPath = bindingPathForInfo(record)
  if (record.bindingPath !== relative(sqliteRoot, bindingPath) || !existsSync(bindingPath)) return false
  try {
    return record.sha256 === sha256(bindingPath)
  } catch {
    return false
  }
}

const cachedBindingValid = (runtime, manifest = readManifest()) => {
  const info = runtimes[runtime]
  const record = manifest?.[runtime]
  if (
    manifest?.schemaVersion !== 1 ||
    manifest?.betterSqlite3Version !== sqlitePackage.version ||
    (runtime === 'electron' && manifest?.electronVersion !== electron().version) ||
    record?.modules !== info.modules ||
    record?.platform !== info.platform ||
    record?.arch !== info.arch ||
    !manifestRecordIntegrityValid(runtime, record)
  ) return false
  return probe(runtime, bindingPathFor(runtime), false).status === 0
}

const isProcessAlive = (pid) => {
  if (pid === process.pid) return true
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code !== 'ESRCH'
  }
}

const removeLockSnapshot = (contents, stats) => {
  try {
    const currentStats = statSync(lockPath)
    const currentContents = readFileSync(lockPath, 'utf8')
    if (
      currentContents !== contents ||
      currentStats.size !== stats.size ||
      currentStats.mtimeMs !== stats.mtimeMs
    ) return false
    rmSync(lockPath)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return true
    throw error
  }
}

const acquireLock = () => {
  mkdirSync(lockRoot, { recursive: true })
  const deadline = Date.now() + lockWaitTimeoutMs
  while (true) {
    const owner = {
      schemaVersion: 1,
      pid: process.pid,
      ownerToken: randomUUID(),
      createdAt: Date.now()
    }
    try {
      const descriptor = openSync(lockPath, 'wx')
      try {
        writeFileSync(descriptor, `${JSON.stringify(owner)}\n`)
      } catch (error) {
        rmSync(lockPath, { force: true })
        throw error
      } finally {
        closeSync(descriptor)
      }
      return owner
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      try {
        const stats = statSync(lockPath)
        const contents = readFileSync(lockPath, 'utf8')
        if (shouldRecoverLock({
          lockContents: contents,
          lockMtimeMs: stats.mtimeMs,
          now: Date.now(),
          staleAfterMs: malformedLockStaleMs,
          isProcessAlive
        }) && removeLockSnapshot(contents, stats)) continue
      } catch (lockError) {
        if (lockError?.code === 'ENOENT') continue
        throw lockError
      }
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for native runtime lock: ${lockPath}`)
      Atomics.wait(sleepState, 0, 0, 250)
    }
  }
}

const releaseLock = (owner) => {
  try {
    const contents = readFileSync(lockPath, 'utf8')
    if (lockOwnedBy(contents, owner.ownerToken)) rmSync(lockPath, { force: true })
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

const runRebuild = (runtime, modules) => {
  const env = sanitizeNativeRebuildEnvironment(process.env)
  let result
  if (runtime === 'node') {
    const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    result = spawnSync(npmExecutable, ['rebuild', ...modules], {
      cwd: projectRoot,
      env,
      stdio: 'inherit'
    })
  } else {
    result = spawnSync(
      process.execPath,
      [
        require.resolve('@electron/rebuild/lib/cli.js'),
        '-f',
        '-w',
        modules.join(','),
        '-v',
        electron().version,
        '-d',
        'https://www.electronjs.org/headers'
      ],
      {
        cwd: projectRoot,
        env,
        stdio: 'inherit'
      }
    )
  }
  if (result.error || result.status !== 0) {
    throw new Error(`Failed to rebuild ${modules.join(', ')} for ${runtime}: ${result.error?.message || `exit ${result.status}`}`)
  }
}

const replaceFile = (temporary, destination, description) => {
  if (!existsSync(destination)) {
    renameSync(temporary, destination)
    return
  }
  if (process.platform !== 'win32') {
    renameSync(temporary, destination)
    return
  }

  const backup = `${destination}.old-${process.pid}-${Date.now()}`
  try {
    renameSync(destination, backup)
  } catch (error) {
    throw new Error(`Cannot replace ${description} on Windows. Exit every process using the target runtime and retry. ${error.message}`)
  }
  try {
    renameSync(temporary, destination)
    rmSync(backup, { force: true })
  } catch (error) {
    if (!existsSync(destination) && existsSync(backup)) renameSync(backup, destination)
    throw error
  }
}

const copyBindingSafely = (source, destination) => {
  mkdirSync(dirname(destination), { recursive: true })
  const temporary = `${destination}.tmp-${process.pid}-${Date.now()}`
  copyFileSync(source, temporary)
  try {
    if (existsSync(destination) && sha256(destination) === sha256(temporary)) {
      rmSync(temporary, { force: true })
      return
    }
    replaceFile(temporary, destination, `better-sqlite3 binding ${destination}`)
  } finally {
    rmSync(temporary, { force: true })
  }
}

const shadowPathsFor = (names = runtimeNames) => [...new Set(names.flatMap((runtime) => {
  const info = runtimes[runtime]
  return shadowBindingPaths({
    sqliteRoot,
    nodeVersion: info.node,
    platform: info.platform,
    arch: info.arch
  })
}))]

const ensureSqliteBinding = (runtime, shouldForce, manifest) => {
  if (!shouldForce && cachedBindingValid(runtime, manifest)) return
  const bindingPath = bindingPathFor(runtime)
  const genericBindingPath = resolve(sqliteRoot, 'build', 'Release', 'better_sqlite3.node')
  if (!shouldForce && existsSync(genericBindingPath) && probe(runtime, genericBindingPath, false).status === 0) {
    copyBindingSafely(genericBindingPath, bindingPath)
    return
  }
  runRebuild(runtime, ['better-sqlite3'])
  const rebuiltProbe = probe(runtime, genericBindingPath, false)
  if (!existsSync(genericBindingPath) || rebuiltProbe.status !== 0) {
    throw new Error(`Rebuilt better-sqlite3 probe failed for ${runtime}:\n${probeFailure(rebuiltProbe)}`)
  }
  copyBindingSafely(genericBindingPath, bindingPath)
}

const removeShadowBindings = () => {
  shadowPathsFor().forEach((path) => rmSync(path, { force: true }))
  for (const entry of ['build', 'out', 'Debug', 'Release', 'compiled', 'addon-build']) {
    rmSync(resolve(sqliteRoot, entry), { recursive: true, force: true })
  }
}

const nativeRecord = (runtime) => ({
  ...runtimes[runtime],
  bindingPath: relative(sqliteRoot, bindingPathFor(runtime)),
  sha256: sha256(bindingPathFor(runtime))
})

const writeManifest = (currentManifest) => {
  mkdirSync(bindingRoot, { recursive: true })
  const records = Object.fromEntries(runtimeNames.map((runtime) => [runtime, nativeRecord(runtime)]))
  const base = {
    schemaVersion: 1,
    betterSqlite3Version: sqlitePackage.version,
    ...(target === 'electron' ? { electronVersion: electron().version } : {}),
    generatedAt: new Date().toISOString()
  }
  const manifest = mergeNativeManifest({
    currentManifest,
    base,
    records,
    isRecordValid: manifestRecordIntegrityValid
  })
  const temporary = `${manifestPath}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`)
  try {
    replaceFile(temporary, manifestPath, `native manifest ${manifestPath}`)
  } finally {
    rmSync(temporary, { force: true })
  }
  return manifest
}

const verifyRuntime = (runtime, manifest = readManifest()) => {
  if (!cachedBindingValid(runtime, manifest)) {
    throw new Error(`The ABI-keyed better-sqlite3 binding is missing or invalid for ${runtime}.`)
  }
  const shadows = shadowPathsFor([runtime]).filter((path) => existsSync(path))
  if (shadows.length) {
    throw new Error(`Shadowing better-sqlite3 bindings must be absent:\n${shadows.join('\n')}`)
  }
  const result = probe(runtime)
  if (result.status !== 0) throw new Error(`Native module probe failed for ${runtime}:\n${probeFailure(result)}`)
  return result.stdout.trim()
}

const prepareRuntimes = () => {
  const currentManifest = readManifest()
  for (const runtime of runtimeNames) {
    ensureSqliteBinding(runtime, force && runtime === target, currentManifest)
  }

  for (const runtime of runtimeNames) {
    if (probe(runtime, bindingPathFor(runtime), false).status !== 0) ensureSqliteBinding(runtime, true, null)
  }

  removeShadowBindings()
  const nextManifest = writeManifest(currentManifest)

  for (const runtime of runtimeNames) {
    let result = probe(runtime)
    if (result.status !== 0) {
      runRebuild(runtime, ['node-pty'])
      result = probe(runtime)
    }
    if (result.status !== 0) {
      throw new Error(`${runtime} native module probe failed after preparation:\n${probeFailure(result)}`)
    }
  }

  for (const runtime of runtimeNames) {
    if (!cachedBindingValid(runtime, nextManifest)) {
      throw new Error(`The ${runtime} ABI-keyed better-sqlite3 binding failed final integrity validation.`)
    }
  }
}

const lockOwner = acquireLock()
try {
  if (checkOnly) {
    console.log(`[aiopsterm] native modules match ${target}: ${verifyRuntime(target)}`)
  } else {
    prepareRuntimes()
    for (const runtime of runtimeNames) {
      console.log(`[aiopsterm] native modules match ${runtime}: ${verifyRuntime(runtime)}`)
    }
  }
} catch (error) {
  console.error(`[aiopsterm] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  releaseLock(lockOwner)
}
