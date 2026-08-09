import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  electronRebuildInvocation,
  electronHeadersUrl,
  lockOwnedBy,
  mergeNativeManifest,
  nativeCompilerEnvironment,
  npmRebuildInvocation,
  parseLockOwner,
  parseNativeManifest,
  sanitizeNativeRebuildEnvironment,
  shadowBindingPaths,
  shouldRebuildPty,
  shouldRecoverLock
} from '../scripts/native-runtime-helpers.mjs'

const lockOwner = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  pid: 4242,
  ownerToken: 'owner-token-4242',
  createdAt: 1_000,
  ...overrides
})

describe('native runtime helpers', () => {
  it('forces node-pty rebuilds only for the requested target runtime', () => {
    expect(shouldRebuildPty({ force: true, target: 'electron', runtime: 'electron', probeStatus: 0 })).toBe(true)
    expect(shouldRebuildPty({ force: true, target: 'electron', runtime: 'node', probeStatus: 0 })).toBe(false)
    expect(shouldRebuildPty({ force: false, target: 'electron', runtime: 'electron', probeStatus: 0 })).toBe(false)
    expect(shouldRebuildPty({ force: false, target: 'electron', runtime: 'node', probeStatus: 1 })).toBe(true)
  })

  it('limits electron-rebuild to the requested native modules', () => {
    expect(electronRebuildInvocation({
      cliPath: 'C:\\project\\node_modules\\@electron\\rebuild\\lib\\cli.js',
      modules: ['better-sqlite3'],
      electronVersion: '31.7.7',
      headersUrl: 'http://127.0.0.1:48177',
      buildFromSource: true
    })).toEqual({
      commandArgs: [
        'C:\\project\\node_modules\\@electron\\rebuild\\lib\\cli.js',
        '-f',
        '--build-from-source',
        '-o',
        'better-sqlite3',
        '-v',
        '31.7.7',
        '-d',
        'http://127.0.0.1:48177'
      ]
    })
  })

  it('keeps Electron runtime mirrors separate from native headers', () => {
    expect(electronHeadersUrl({
      npm_config_electron_mirror: 'https://npmmirror.com/mirrors/electron/',
      ELECTRON_MIRROR: 'https://fallback.invalid/',
      AIOPSTERM_ELECTRON_HEADERS_URL: 'http://127.0.0.1:48177'
    })).toBe('http://127.0.0.1:48177')
    expect(electronHeadersUrl({
      npm_config_electron_mirror: 'https://npmmirror.com/mirrors/electron/'
    })).toBe('https://artifacts.electronjs.org/headers/dist')
  })

  it('runs npm rebuild through Node instead of a Windows cmd shim', () => {
    expect(npmRebuildInvocation({
      platform: 'win32',
      nodeExecutable: 'C:\\node\\node.exe',
      npmExecPath: 'C:\\node\\node_modules\\npm\\bin\\npm-cli.js',
      modules: ['better-sqlite3', 'node-pty']
    })).toEqual({
      command: 'C:\\node\\node.exe',
      args: [
        'C:\\node\\node_modules\\npm\\bin\\npm-cli.js',
        'rebuild',
        'better-sqlite3',
        'node-pty'
      ]
    })
  })

  it('selects GCC 10 for Linux C++20 native builds without overriding configured compilers', () => {
    expect(nativeCompilerEnvironment({
      platform: 'linux',
      env: { PATH: '/usr/bin' },
      gcc10Available: true
    })).toEqual({ PATH: '/usr/bin', CC: 'gcc-10', CXX: 'g++-10' })
    expect(nativeCompilerEnvironment({
      platform: 'linux',
      env: { CC: 'clang', CXX: 'clang++' },
      gcc10Available: true
    })).toEqual({ CC: 'clang', CXX: 'clang++' })
    expect(nativeCompilerEnvironment({
      platform: 'linux',
      env: { CC: 'clang' },
      gcc10Available: true
    })).toEqual({ CC: 'clang', CXX: 'g++-10' })
    expect(nativeCompilerEnvironment({
      platform: 'darwin',
      env: { PATH: '/usr/bin' },
      gcc10Available: true
    })).toEqual({ PATH: '/usr/bin' })
  })

  it('treats damaged or non-object native manifests as absent', () => {
    expect(parseNativeManifest('{"schemaVersion":')).toBeNull()
    expect(parseNativeManifest('null')).toBeNull()
    expect(parseNativeManifest('[]')).toBeNull()
    expect(parseNativeManifest('"manifest"')).toBeNull()
    expect(parseNativeManifest('{"schemaVersion":1,"node":{"modules":"127"}}')).toEqual({
      schemaVersion: 1,
      node: { modules: '127' }
    })
  })

  it('enumerates every better-sqlite3 path that bindings checks before the ABI-keyed path', () => {
    const sqliteRoot = resolve('fixture', 'node_modules', 'better-sqlite3')
    const bindingName = 'better_sqlite3.node'

    expect(shadowBindingPaths({
      sqliteRoot,
      nodeVersion: '22.14.0',
      platform: 'linux',
      arch: 'x64'
    })).toEqual([
      resolve(sqliteRoot, 'build', bindingName),
      resolve(sqliteRoot, 'build', 'Debug', bindingName),
      resolve(sqliteRoot, 'build', 'Release', bindingName),
      resolve(sqliteRoot, 'out', 'Debug', bindingName),
      resolve(sqliteRoot, 'Debug', bindingName),
      resolve(sqliteRoot, 'out', 'Release', bindingName),
      resolve(sqliteRoot, 'Release', bindingName),
      resolve(sqliteRoot, 'build', 'default', bindingName),
      resolve(sqliteRoot, 'compiled', '22.14.0', 'linux', 'x64', bindingName),
      resolve(sqliteRoot, 'addon-build', 'release', 'install-root', bindingName),
      resolve(sqliteRoot, 'addon-build', 'debug', 'install-root', bindingName),
      resolve(sqliteRoot, 'addon-build', 'default', 'install-root', bindingName)
    ])
  })

  it('recovers a dead owner immediately but never steals a lock from a live owner', () => {
    const contents = JSON.stringify(lockOwner())
    const deadOwnerProbe = vi.fn(() => false)
    const liveOwnerProbe = vi.fn(() => true)

    expect(shouldRecoverLock({
      lockContents: contents,
      lockMtimeMs: 999,
      now: 1_001,
      staleAfterMs: 30_000,
      isProcessAlive: deadOwnerProbe
    })).toBe(true)
    expect(deadOwnerProbe).toHaveBeenCalledWith(4242)

    expect(shouldRecoverLock({
      lockContents: contents,
      lockMtimeMs: 0,
      now: 1_000_000,
      staleAfterMs: 30_000,
      isProcessAlive: liveOwnerProbe
    })).toBe(false)
    expect(liveOwnerProbe).toHaveBeenCalledWith(4242)
  })

  it('recovers malformed locks only after their file timestamp is clearly stale', () => {
    const processProbe = vi.fn(() => false)

    expect(shouldRecoverLock({
      lockContents: '{not-json',
      lockMtimeMs: 80_001,
      now: 100_000,
      staleAfterMs: 30_000,
      isProcessAlive: processProbe
    })).toBe(false)
    expect(shouldRecoverLock({
      lockContents: '{not-json',
      lockMtimeMs: 70_000,
      now: 100_000,
      staleAfterMs: 30_000,
      isProcessAlive: processProbe
    })).toBe(true)
    expect(processProbe).not.toHaveBeenCalled()
  })

  it('releases a lock only for the process token that acquired it', () => {
    const contents = JSON.stringify(lockOwner())

    expect(parseLockOwner(contents)).toEqual(lockOwner())
    expect(lockOwnedBy(contents, 'owner-token-4242')).toBe(true)
    expect(lockOwnedBy(contents, 'different-owner-token')).toBe(false)
    expect(lockOwnedBy('{not-json', 'owner-token-4242')).toBe(false)
  })

  it('preserves the verified Electron ABI record during a Node-only force refresh', () => {
    const previousNode = {
      modules: '127',
      platform: 'linux',
      arch: 'x64',
      bindingPath: 'lib/binding/node-v127-linux-x64/better_sqlite3.node',
      sha256: 'old-node-sha'
    }
    const electron = {
      modules: '125',
      platform: 'linux',
      arch: 'x64',
      bindingPath: 'lib/binding/node-v125-linux-x64/better_sqlite3.node',
      sha256: 'electron-sha'
    }
    const refreshedNode = { ...previousNode, sha256: 'refreshed-node-sha' }
    const currentManifest = {
      schemaVersion: 1,
      betterSqlite3Version: '12.2.0',
      electronVersion: '31.7.7',
      generatedAt: '2026-07-11T00:00:00.000Z',
      node: previousNode,
      electron
    }
    const isRecordValid = vi.fn((runtime: string, record: unknown) => runtime === 'electron' && record === electron)

    const merged = mergeNativeManifest({
      currentManifest,
      base: {
        schemaVersion: 1,
        betterSqlite3Version: '12.2.0',
        generatedAt: '2026-07-12T00:00:00.000Z'
      },
      records: { node: refreshedNode },
      isRecordValid
    })

    expect(merged).toMatchObject({
      node: refreshedNode,
      electron,
      electronVersion: '31.7.7'
    })
    expect(merged.node).not.toBe(previousNode)
    expect(isRecordValid).toHaveBeenCalledWith('electron', electron)
  })

  it('does not preserve another ABI record when its integrity check fails', () => {
    const merged = mergeNativeManifest({
      currentManifest: {
        schemaVersion: 1,
        betterSqlite3Version: '12.2.0',
        electronVersion: '31.7.7',
        electron: { modules: '125', sha256: 'damaged' }
      },
      base: {
        schemaVersion: 1,
        betterSqlite3Version: '12.2.0',
        generatedAt: '2026-07-12T00:00:00.000Z'
      },
      records: {
        node: { modules: '127', sha256: 'node-sha' }
      },
      isRecordValid: () => false
    })

    expect(merged).not.toHaveProperty('electron')
    expect(merged).not.toHaveProperty('electronVersion')
  })

  it('removes inherited Node/Electron cross-build settings without mutating the caller environment', () => {
    const source = {
      PATH: '/usr/bin',
      npm_config_runtime: 'electron',
      NPM_CONFIG_TARGET: '31.7.7',
      npm_config_arch: 'arm64',
      npm_config_target_arch: 'arm64',
      npm_config_platform: 'darwin',
      npm_config_target_platform: 'darwin',
      npm_config_disturl: 'https://electronjs.org/headers',
      npm_config_dist_url: 'https://electronjs.org/headers',
      npm_config_nodedir: '/tmp/node-headers',
      npm_config_devdir: '/tmp/dev-headers',
      Electron_Run_As_Node: '1'
    }

    expect(sanitizeNativeRebuildEnvironment(source)).toEqual({ PATH: '/usr/bin' })
    expect(source).toHaveProperty('npm_config_runtime', 'electron')
    expect(source).toHaveProperty('Electron_Run_As_Node', '1')
  })
})
