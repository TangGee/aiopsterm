import { ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { createDatabaseWorkspaceConnectionStateRuntime } from '@/services/databaseWorkspaceConnectionStateRuntime'
import type { ContextMenu } from '@/services/databaseWorkspaceTypes'
import type { SshProxyConfig } from '@shared/contracts/appRuntime'
import type { DatabaseConnectionInfo, DatabaseGroupInfo } from '@shared/contracts/database'

const groups: DatabaseGroupInfo[] = [
  { id: 'group-default', name: 'Default Group' },
  { id: 'group-prod', name: 'Production' },
  { id: 'group-team', name: 'Team' },
  { id: 'group-child', name: 'Child' }
]

const connection = (input: Partial<DatabaseConnectionInfo> = {}): DatabaseConnectionInfo => ({
  id: 'conn-orders',
  name: 'orders-db',
  dbType: 'postgresql',
  env: 'Production',
  groupId: 'group-prod',
  host: '127.0.0.1',
  port: 5432,
  authentication: 'UserAndPassword',
  user: 'ops',
  database: 'orders',
  status: 'connected',
  catalogs: [],
  ...input
})

const proxy = (name: string): SshProxyConfig => ({
  name,
  type: 'SOCKS5',
  host: '127.0.0.1',
  port: 1080,
  enableProxyIdentity: false,
  username: '',
  password: ''
})

describe('databaseWorkspaceConnectionStateRuntime', () => {
  it('owns connection modal defaults, proxy projection, and connection menu capabilities', () => {
    const sshProxyConfigs = ref([proxy('z-proxy'), proxy('a-proxy')])
    const runtime = createDatabaseWorkspaceConnectionStateRuntime({
      connections: ref([connection()]),
      groups: ref(groups),
      groupParentById: {
        'group-default': null,
        'group-prod': null,
        'group-team': null,
        'group-child': 'group-team'
      },
      contextMenu: ref<ContextMenu | null>({ type: 'connection', connectionId: 'conn-orders', label: 'orders-db', x: 0, y: 0 }),
      sshProxyConfigs
    })

    expect(runtime.connectionModalOpen.value).toBe(false)
    expect(runtime.connectionDraft).toEqual(
      expect.objectContaining({
        dbType: 'mysql',
        host: '127.0.0.1',
        port: 3306,
        authentication: 'UserAndPassword'
      })
    )
    expect(runtime.createDatabaseModal).toEqual(expect.objectContaining({ open: false, dbType: 'mysql', feedbackKind: 'info' }))
    expect(runtime.ddlModal).toEqual(expect.objectContaining({ open: false, errorCode: '' }))
    expect(runtime.dangerConfirm).toEqual(expect.objectContaining({ open: false, action: 'drop', confirmText: '' }))
    expect(runtime.operationConfirm).toEqual(expect.objectContaining({ open: false, action: '', confirmLabel: 'Delete' }))

    expect(runtime.databaseSshProxyOptions.value.map((item) => item.name)).toEqual(['a-proxy', 'z-proxy'])
    runtime.databaseSshProxyOptions.value[0].name = 'mutated'
    expect(sshProxyConfigs.value.map((item) => item.name)).toEqual(['z-proxy', 'a-proxy'])
    expect(runtime.contextConnectionConnected.value).toBe(true)
    expect(runtime.contextConnectionCanCreateDatabase.value).toBe(true)
    expect(runtime.connectionRootMoveDisabled.value).toBe(false)
    expect(runtime.connectionMoveTargets.value).toEqual([
      { id: 'group-team', name: 'Team' },
      { id: 'group-child', name: 'Team / Child' }
    ])
  })

  it('owns group move target projection without allowing self, descendants, or default root', () => {
    const contextMenu = ref<ContextMenu | null>({ type: 'group', groupId: 'group-team', label: 'Team', x: 0, y: 0 })
    const runtime = createDatabaseWorkspaceConnectionStateRuntime({
      connections: ref([connection({ groupId: 'group-default' })]),
      groups: ref(groups),
      groupParentById: {
        'group-default': null,
        'group-prod': null,
        'group-team': null,
        'group-child': 'group-team'
      },
      contextMenu,
      sshProxyConfigs: ref([])
    })

    expect(runtime.groupRootMoveDisabled.value).toBe(true)
    expect(runtime.groupMoveTargets.value).toEqual([{ id: 'group-prod', name: 'Production' }])

    contextMenu.value = { type: 'connection', connectionId: 'conn-orders', label: 'orders-db', x: 0, y: 0 }
    expect(runtime.connectionRootMoveDisabled.value).toBe(true)
    expect(runtime.connectionMoveTargets.value).toEqual([
      { id: 'group-prod', name: 'Production' },
      { id: 'group-team', name: 'Team' },
      { id: 'group-child', name: 'Team / Child' }
    ])
  })
})
