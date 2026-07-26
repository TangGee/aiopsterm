import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { ExtensionPluginRuntimeConfig } from '@shared/contracts/extensions'

let activateExtension: any
let configureExtensionHostRuntime: any
let deactivateExtension: any
let executeExtensionCommand: any
let getExtensionConfiguration: any
let getExtensionBastionDefinitions: any
let getExtensionContexts: any
let getExtensionTreeChildren: any
let invokeExtensionBastion: any
let resetExtensionHostRuntimeForTests: any
let setExtensionEnabled: any
let syncRuntimeAssetProvider: any
let updateExtensionConfiguration: any

const roots: string[] = []

beforeAll(async () => {
  const modulePath = '../src/main/backend/extensions/extensionHostRuntime'
  const runtime = await import(modulePath)
  activateExtension = runtime.activateExtension
  configureExtensionHostRuntime = runtime.configureExtensionHostRuntime
  deactivateExtension = runtime.deactivateExtension
  executeExtensionCommand = runtime.executeExtensionCommand
  getExtensionConfiguration = runtime.getExtensionConfiguration
  getExtensionBastionDefinitions = runtime.getExtensionBastionDefinitions
  getExtensionContexts = runtime.getExtensionContexts
  getExtensionTreeChildren = runtime.getExtensionTreeChildren
  invokeExtensionBastion = runtime.invokeExtensionBastion
  resetExtensionHostRuntimeForTests = runtime.resetExtensionHostRuntimeForTests
  setExtensionEnabled = runtime.setExtensionEnabled
  syncRuntimeAssetProvider = runtime.syncRuntimeAssetProvider
  updateExtensionConfiguration = runtime.updateExtensionConfiguration
})

const makePlugin = () => {
  const root = mkdtempSync(join(tmpdir(), 'aiopsterm-plugin-host-'))
  roots.push(root)
  const pluginPath = join(root, 'plugin')
  const mainPath = join(pluginPath, 'main.cjs')
  require('fs').mkdirSync(pluginPath, { recursive: true })
  writeFileSync(
    mainPath,
    `
'use strict'
exports.activate = async function activate(context) {
  context.contexts.set('example.runtime.ready', true)
  context.subscriptions.push(context.commands.registerCommand('example.runtime.ping', async function ping(value) {
    const count = await context.globalState.get('count', 0)
    await context.globalState.update('count', count + 1)
    return { value: value, count: count + 1 }
  }))
  context.subscriptions.push(context.views.registerTreeDataProvider('example.runtime.tree', {
    getChildren: function getChildren(parentId) {
      return [{ id: parentId || 'root', label: parentId ? 'Child' : 'Root', collapsibleState: 'none' }]
    }
  }))
  context.subscriptions.push(context.assets.registerProvider('example.runtime.assets', {
    sync: function sync() {
      return [{ id: 'asset-1', name: 'Host 1', host: '192.0.2.30' }]
    }
  }))
  context.subscriptions.push(context.bastions.registerProvider('example.runtime.bastion', {
    connect: function connect(input) {
      return { sessionId: input.sessionId, connected: true }
    },
    resize: function resize(input) {
      return { cols: input.cols, rows: input.rows }
    },
    disconnect: function disconnect() {
      return { disconnected: true }
    }
  }))
  context.subscriptions.push(context.bastions.registerDefinition({
    type: 'example.runtime.bastion',
    name: 'Example Bastion',
    description: 'Example bastion integration'
  }))
}
exports.deactivate = function deactivate() {}
`,
    'utf8'
  )
  const plugin: ExtensionPluginRuntimeConfig = {
    pluginId: 'example.runtime',
    name: 'Example Runtime',
    description: 'Runtime fixture',
    kind: 'runtime',
    iconKey: 'local',
    tabName: 'Example',
    show: true,
    isPlugin: true,
    installed: true,
    hasUpdate: false,
    installedVersion: '1.0.0',
    latestVersion: '1.0.0',
    source: 'local',
    packagePath: pluginPath,
    manifestVersion: 2,
    main: 'main.cjs',
    enabled: true,
    runtimeStatus: 'inactive',
    views: [{ id: 'example.runtime.tree', name: 'Tree' }],
    configuration: {
      title: 'Configuration',
      properties: [
        { key: 'endpoint', title: 'Endpoint', type: 'text', defaultValue: 'https://example.invalid' },
        { key: 'token', title: 'Token', type: 'password' }
      ]
    }
  }
  return { root, plugin }
}

afterEach(async () => {
  await deactivateExtension('example.runtime')
  resetExtensionHostRuntimeForTests()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('executable extension host runtime', () => {
  it('activates commands, tree views, namespaced state, encrypted secrets, assets and bastions', async () => {
    const { root, plugin } = makePlugin()
    const saveAsset = vi.fn((asset) => ({
      ok: true as const,
      data: {
        ...asset,
        uuid: asset.id,
        title: asset.title || asset.name,
        ip: asset.ip || asset.host,
        group: asset.group || 'Plugin',
        group_name: asset.group_name || asset.group || 'Plugin',
        status: asset.status || 'online',
        username: asset.username || 'root',
        port: asset.port || 22,
        asset_type: asset.asset_type || 'person',
        auth_type: asset.auth_type || 'password',
        comment: asset.comment || '',
        data_source: asset.data_source || 'refresh',
        tags: asset.tags || []
      }
    }))
    configureExtensionHostRuntime({ rootDir: root, saveAsset })

    await expect(activateExtension(plugin)).resolves.toMatchObject({ runtimeStatus: 'active' })
    await expect(executeExtensionCommand('example.runtime.ping', ['ok'])).resolves.toMatchObject({
      ok: true,
      data: { value: { value: 'ok', count: 1 } }
    })
    await expect(executeExtensionCommand('example.runtime.ping', ['again'])).resolves.toMatchObject({
      ok: true,
      data: { value: { value: 'again', count: 2 } }
    })
    await expect(getExtensionTreeChildren('example.runtime.tree')).resolves.toMatchObject({
      ok: true,
      data: { items: [{ id: 'root', label: 'Root' }] }
    })
    await expect(getExtensionContexts()).resolves.toMatchObject({
      ok: true,
      data: { 'example.runtime.ready': true }
    })

    await updateExtensionConfiguration(plugin, {
      pluginId: plugin.pluginId,
      values: { endpoint: 'https://cmdb.example.test/assets', token: 'top-secret' }
    })
    await expect(getExtensionConfiguration(plugin)).resolves.toEqual({
      ok: true,
      data: { endpoint: 'https://cmdb.example.test/assets', token: true }
    })
    expect(readFileSync(join(root, 'runtime-state.json'), 'utf8')).not.toContain('top-secret')

    await expect(syncRuntimeAssetProvider(plugin.pluginId, 'example.runtime.assets', {})).resolves.toMatchObject({
      ok: true,
      data: { imported: 1, assets: [{ id: 'asset-1' }] }
    })
    expect(saveAsset).toHaveBeenCalledWith(expect.objectContaining({
      id: 'asset-1',
      tags: ['plugin:example.runtime', 'provider:example.runtime.assets']
    }))

    await expect(invokeExtensionBastion('example.runtime.bastion', 'connect', { sessionId: 'session-1' })).resolves.toEqual({
      ok: true,
      data: { sessionId: 'session-1', connected: true }
    })
    await expect(invokeExtensionBastion('example.runtime.bastion', 'resize', { cols: 120, rows: 40 })).resolves.toEqual({
      ok: true,
      data: { cols: 120, rows: 40 }
    })
    await expect(invokeExtensionBastion('example.runtime.bastion', 'disconnect', {})).resolves.toEqual({
      ok: true,
      data: { disconnected: true }
    })
    expect(getExtensionBastionDefinitions()).toEqual([
      {
        pluginId: 'example.runtime',
        type: 'example.runtime.bastion',
        name: 'Example Bastion',
        description: 'Example bastion integration'
      }
    ])
  })

  it('disposes every registration when disabled and can activate again', async () => {
    const { root, plugin } = makePlugin()
    configureExtensionHostRuntime({ rootDir: root })
    await activateExtension(plugin)

    await expect(setExtensionEnabled(plugin, false)).resolves.toMatchObject({ enabled: false, runtimeStatus: 'disabled' })
    await expect(executeExtensionCommand('example.runtime.ping')).resolves.toMatchObject({
      ok: false,
      errorCode: 'EXTENSION_COMMAND_FAILED'
    })
    await expect(getExtensionTreeChildren('example.runtime.tree')).resolves.toMatchObject({
      ok: false,
      errorCode: 'EXTENSION_VIEW_UNAVAILABLE'
    })

    await expect(setExtensionEnabled(plugin, true)).resolves.toMatchObject({ enabled: true, runtimeStatus: 'active' })
    await expect(executeExtensionCommand('example.runtime.ping')).resolves.toMatchObject({ ok: true })
  })

  it('reports activation errors without leaving partial registrations', async () => {
    const { root, plugin } = makePlugin()
    writeFileSync(join(plugin.packagePath!, 'main.cjs'), `exports.activate = function () { throw new Error('activation failed') }`, 'utf8')
    configureExtensionHostRuntime({ rootDir: root })

    await expect(activateExtension(plugin)).resolves.toMatchObject({
      runtimeStatus: 'error',
      runtimeError: 'activation failed'
    })
    await expect(executeExtensionCommand('example.runtime.ping')).resolves.toMatchObject({ ok: false })
  })
})
