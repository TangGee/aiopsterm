import { createRequire } from 'module'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type {
  ProductSessionCreateInput,
  ProductSessionListInput,
  ProductSessionNativeBindingSelector,
  ProductSessionRecord,
  ProductSessionUpdateInput
} from '../src/shared/contracts/productSessions'

type ProductSessionRegistry = {
  create(input: ProductSessionCreateInput): ProductSessionRecord
  get(id: string): ProductSessionRecord | null
  list(input?: ProductSessionListInput): ProductSessionRecord[]
  update(input: ProductSessionUpdateInput): ProductSessionRecord | null
  delete(id: string): boolean
  deleteIfUnchanged(id: string, updatedAt: number): boolean
  findByNativeBinding(selector: ProductSessionNativeBindingSelector): ProductSessionRecord | null
  replaceProjectionMessages(id: string, messages: Array<{ messageId: string; payload: unknown }>): number
  upsertProjectionMessages(id: string, messages: Array<{ messageId: string; payload: unknown }>): number
  reviseProjectionMessages(id: string, input: {
    fromMessageId: string
    replacementMessages: Array<{ messageId: string; payload: unknown }>
  }): {
    deletedMessages: number
    appendedMessages: number
    totalMessages: number
    seedMessages: Array<{ messageId: string; ordinal: number; payload: unknown }>
    seedTotalMessages: number
    seedOmittedMessages: number
    seedPayloadBytes: number
  }
  listProjectionMessages(id: string, input?: { beforeOrdinal?: number; limit?: number }): {
    messages: Array<{ messageId: string; ordinal: number; payload: unknown }>
    hasMore: boolean
    nextBeforeOrdinal: number | null
    totalMessages: number
  }
  subscribe(listener: (event: unknown) => void): () => void
  close(): void
}

type ProductSessionRegistryModule = {
  ProductSessionRegistryError: new (...args: any[]) => Error & { code: string }
  createProductSessionRegistry(config: {
    userDataPath?: string
    databasePath?: string
    sqliteFactory?: new (path: string) => unknown
    now?: () => number
    createId?: () => string
  }): ProductSessionRegistry
  productSessionRegistryPathFor(userDataPath: string): string
  productSessionRegistrySchemaVersion: number
}

let ProductSessionRegistryError: ProductSessionRegistryModule['ProductSessionRegistryError']
let createProductSessionRegistry: ProductSessionRegistryModule['createProductSessionRegistry']
let productSessionRegistryPathFor: ProductSessionRegistryModule['productSessionRegistryPathFor']
let productSessionRegistrySchemaVersion: ProductSessionRegistryModule['productSessionRegistrySchemaVersion']

const requireNative = createRequire(__filename)
const { DatabaseSync } = requireNative('node:sqlite') as {
  DatabaseSync: new (path: string, options?: { readOnly?: boolean }) => {
    exec(sql: string): void
    prepare(sql: string): {
      all(...args: unknown[]): unknown[]
      get(...args: unknown[]): unknown
      run(...args: unknown[]): { changes: number; lastInsertRowid: number | bigint }
    }
    close(): void
  }
}

class TestSqliteDatabase extends DatabaseSync {}

beforeAll(async () => {
  const modulePath = '../src/main/backend/agent/productSessionRegistry'
  const registryModule = (await import(modulePath)) as ProductSessionRegistryModule
  ProductSessionRegistryError = registryModule.ProductSessionRegistryError
  createProductSessionRegistry = registryModule.createProductSessionRegistry
  productSessionRegistryPathFor = registryModule.productSessionRegistryPathFor
  productSessionRegistrySchemaVersion = registryModule.productSessionRegistrySchemaVersion
})

describe('product session registry', () => {
  const cleanupPaths: string[] = []
  const openRegistries: ProductSessionRegistry[] = []

  const createFixture = async (options: { now?: () => number; createId?: () => string } = {}) => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'aiopsterm-product-sessions-'))
    cleanupPaths.push(userDataPath)
    const registry = createProductSessionRegistry({
      userDataPath,
      sqliteFactory: TestSqliteDatabase,
      ...options
    })
    openRegistries.push(registry)
    return { userDataPath, databasePath: productSessionRegistryPathFor(userDataPath), registry }
  }

  afterEach(async () => {
    openRegistries.splice(0).forEach((registry) => registry.close())
    await Promise.all(cleanupPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
  })

  it('persists independent product context and native binding without conversation content', async () => {
    const fixture = await createFixture({ now: () => 1000, createId: () => 'ps-created' })
    const created = fixture.registry.create({
      surface: 'database',
      title: 'Metrics investigation',
      projectRoot: '/work/aiopsterm',
      lastKnownCwd: '/work/aiopsterm/sql',
      target: {
        kind: 'ssh',
        panelId: 'panel-7',
        terminalSessionId: 'terminal-7',
        assetId: 'asset-7',
        connectionId: 'ssh-connection-7',
        label: 'Production shell'
      },
      database: {
        connectionId: 'database-7',
        databaseName: 'metrics',
        schemaName: 'public'
      },
      nativeBinding: {
        engine: 'cline',
        nativeSessionId: 'cline-session-7',
        profile: 'database',
        scopeKey: 'zh-CN\0database-7\0metrics\0public'
      }
    })

    expect(created).toEqual({
      id: 'ps-created',
      surface: 'database',
      title: 'Metrics investigation',
      isOpen: true,
      projectRoot: '/work/aiopsterm',
      lastKnownCwd: '/work/aiopsterm/sql',
      target: {
        kind: 'ssh',
        panelId: 'panel-7',
        terminalSessionId: 'terminal-7',
        assetId: 'asset-7',
        connectionId: 'ssh-connection-7',
        label: 'Production shell'
      },
      database: {
        connectionId: 'database-7',
        databaseName: 'metrics',
        schemaName: 'public'
      },
      nativeBinding: {
        engine: 'cline',
        nativeSessionId: 'cline-session-7',
        profile: 'database',
        scopeKey: 'zh-CN\0database-7\0metrics\0public'
      },
      createdAt: 1000,
      updatedAt: 1000
    })

    fixture.registry.close()
    openRegistries.splice(openRegistries.indexOf(fixture.registry), 1)
    const reopened = createProductSessionRegistry({ userDataPath: fixture.userDataPath, sqliteFactory: TestSqliteDatabase })
    openRegistries.push(reopened)
    expect(reopened.get('ps-created')).toEqual({ ...created, isOpen: false })

    const db = new TestSqliteDatabase(fixture.databasePath, { readOnly: true })
    const columns = (db.prepare('PRAGMA table_info(product_sessions)').all() as Array<{ name: string }>).map((column) => column.name)
    const schemaVersion = (db.prepare("SELECT value FROM product_session_registry_meta WHERE key = 'schema_version'").get() as { value: string }).value
    db.close()
    expect(Number(schemaVersion)).toBe(productSessionRegistrySchemaVersion)
    expect(columns).toEqual([
      'id',
      'surface',
      'title',
      'is_open',
      'project_root',
      'last_known_cwd',
      'target_kind',
      'target_panel_id',
      'target_terminal_session_id',
      'target_asset_id',
      'target_connection_id',
      'target_label',
      'target_host',
      'target_port',
      'target_username',
      'target_asset_name',
      'database_connection_id',
      'database_name',
      'database_schema_name',
      'native_engine',
      'native_session_id',
      'native_profile',
      'native_scope_key_b64',
      'classic_context_json',
      'created_at',
      'updated_at'
    ])
  })

  it('persists projection messages by Product Session with bounded cursor pages and cascade deletion', async () => {
    const fixture = await createFixture({ now: () => 1000 })
    fixture.registry.create({ id: 'classic-paged', surface: 'classic', title: 'Paged chat' })
    const messages = Array.from({ length: 95 }, (_, index) => ({
      messageId: `message-${index}`,
      payload: { id: `message-${index}`, text: `line-${index}` }
    }))

    expect(fixture.registry.replaceProjectionMessages('classic-paged', messages)).toBe(95)
    const newest = fixture.registry.listProjectionMessages('classic-paged', { limit: 40 })
    expect(newest.totalMessages).toBe(95)
    expect(newest.hasMore).toBe(true)
    expect(newest.messages.map((message) => message.ordinal)).toEqual(Array.from({ length: 40 }, (_, index) => index + 55))
    expect(newest.nextBeforeOrdinal).toBe(55)

    const middle = fixture.registry.listProjectionMessages('classic-paged', {
      beforeOrdinal: newest.nextBeforeOrdinal!,
      limit: 40
    })
    expect(middle.messages[0]).toMatchObject({ messageId: 'message-15', ordinal: 15 })
    expect(middle.messages.at(-1)).toMatchObject({ messageId: 'message-54', ordinal: 54 })
    expect(middle.hasMore).toBe(true)

    expect(fixture.registry.upsertProjectionMessages('classic-paged', [
      { messageId: 'message-94', payload: { id: 'message-94', text: 'updated' } },
      { messageId: 'message-95', payload: { id: 'message-95', text: 'new' } }
    ])).toBe(2)
    const updated = fixture.registry.listProjectionMessages('classic-paged', { limit: 2 })
    expect(updated.messages).toEqual([
      expect.objectContaining({ messageId: 'message-94', ordinal: 94, payload: { id: 'message-94', text: 'updated' } }),
      expect.objectContaining({ messageId: 'message-95', ordinal: 95, payload: { id: 'message-95', text: 'new' } })
    ])

    fixture.registry.close()
    openRegistries.splice(openRegistries.indexOf(fixture.registry), 1)
    const reopened = createProductSessionRegistry({ userDataPath: fixture.userDataPath, sqliteFactory: TestSqliteDatabase })
    openRegistries.push(reopened)
    expect(reopened.listProjectionMessages('classic-paged', { limit: 1 })).toMatchObject({
      totalMessages: 96,
      messages: [expect.objectContaining({ messageId: 'message-95' })]
    })
    expect(reopened.delete('classic-paged')).toBe(true)
    expect(() => reopened.listProjectionMessages('classic-paged')).toThrowError(
      expect.objectContaining({ code: 'PRODUCT_SESSION_NOT_FOUND' })
    )
  })

  it('persists five-image-scale projections while rejecting a message above 40 MiB', async () => {
    const { registry } = await createFixture()
    registry.create({ id: 'large-image-projection', surface: 'classic' })
    const fiveImageScalePayload = 'x'.repeat(34 * 1024 * 1024)

    expect(registry.replaceProjectionMessages('large-image-projection', [{
      messageId: 'five-images',
      payload: { imagesBase64: fiveImageScalePayload }
    }])).toBe(1)
    expect(() => registry.upsertProjectionMessages('large-image-projection', [{
      messageId: 'over-limit',
      payload: { imagesBase64: 'x'.repeat(40 * 1024 * 1024) }
    }])).toThrowError(expect.objectContaining({
      code: 'PRODUCT_SESSION_PROJECTION_MESSAGE_TOO_LARGE'
    }))
  })

  it('atomically revises a durable projection without losing unloaded prefix rows', async () => {
    const { registry } = await createFixture({ now: () => 2000 })
    registry.create({ id: 'classic-revision', surface: 'classic' })
    registry.replaceProjectionMessages(
      'classic-revision',
      Array.from({ length: 500 }, (_, index) => ({
        messageId: `message-${index}`,
        payload: { id: `message-${index}`, text: `message ${index}` }
      }))
    )

    const revised = registry.reviseProjectionMessages('classic-revision', {
      fromMessageId: 'message-450',
      replacementMessages: [
        { messageId: 'replacement-user', payload: { id: 'replacement-user', role: 'user', text: 'edited' } },
        { messageId: 'replacement-assistant', payload: { id: 'replacement-assistant', role: 'assistant', text: 'pending' } }
      ]
    })

    expect(revised).toMatchObject({
      deletedMessages: 50,
      appendedMessages: 2,
      totalMessages: 452,
      seedTotalMessages: 450,
      seedOmittedMessages: 250
    })
    expect(revised.seedMessages).toHaveLength(200)
    expect(revised.seedMessages[0]).toMatchObject({ messageId: 'message-250', ordinal: 250 })
    expect(revised.seedMessages.at(-1)).toMatchObject({ messageId: 'message-449', ordinal: 449 })
    expect(revised.seedPayloadBytes).toBeLessThanOrEqual(2 * 1024 * 1024)

    const newest = registry.listProjectionMessages('classic-revision', { limit: 200 })
    const middle = registry.listProjectionMessages('classic-revision', {
      beforeOrdinal: newest.nextBeforeOrdinal!,
      limit: 200
    })
    const oldest = registry.listProjectionMessages('classic-revision', {
      beforeOrdinal: middle.nextBeforeOrdinal!,
      limit: 200
    })
    const ids = [...oldest.messages, ...middle.messages, ...newest.messages].map((message) => message.messageId)
    expect(ids).toHaveLength(452)
    expect(ids.slice(0, 3)).toEqual(['message-0', 'message-1', 'message-2'])
    expect(ids.slice(-3)).toEqual(['message-449', 'replacement-user', 'replacement-assistant'])
    expect(ids).not.toContain('message-450')
    expect(ids).not.toContain('message-499')
  })

  it('bounds revision seed payloads while always retaining the newest prefix message', async () => {
    const { registry } = await createFixture({ now: () => 3000 })
    registry.create({ id: 'byte-bounded-revision', surface: 'classic' })
    const medium = 'x'.repeat(900 * 1024)
    registry.replaceProjectionMessages('byte-bounded-revision', [
      { messageId: 'medium-0', payload: { text: medium } },
      { messageId: 'medium-1', payload: { text: medium } },
      { messageId: 'medium-2', payload: { text: medium } },
      { messageId: 'medium-target', payload: { text: 'target' } }
    ])
    const bounded = registry.reviseProjectionMessages('byte-bounded-revision', {
      fromMessageId: 'medium-target',
      replacementMessages: [{ messageId: 'medium-replacement', payload: { text: 'replacement' } }]
    })
    expect(bounded.seedMessages.map((message) => message.messageId)).toEqual(['medium-1', 'medium-2'])
    expect(bounded.seedOmittedMessages).toBe(1)
    expect(bounded.seedPayloadBytes).toBeLessThanOrEqual(2 * 1024 * 1024)

    registry.create({ id: 'oversized-latest-revision', surface: 'classic' })
    registry.replaceProjectionMessages('oversized-latest-revision', [
      { messageId: 'small-prefix', payload: { text: 'small' } },
      { messageId: 'large-prefix', payload: { text: 'y'.repeat(3 * 1024 * 1024) } },
      { messageId: 'large-target', payload: { text: 'target' } }
    ])
    const latest = registry.reviseProjectionMessages('oversized-latest-revision', {
      fromMessageId: 'large-target',
      replacementMessages: [{ messageId: 'large-replacement', payload: { text: 'replacement' } }]
    })
    expect(latest.seedMessages.map((message) => message.messageId)).toEqual(['large-prefix'])
    expect(latest.seedOmittedMessages).toBe(1)
    expect(latest.seedPayloadBytes).toBeGreaterThan(2 * 1024 * 1024)
  })

  it('fails closed for a missing revision target and rolls back insertion conflicts', async () => {
    const { registry } = await createFixture({ now: () => 4000 })
    registry.create({ id: 'failed-revision', surface: 'classic' })
    const original = Array.from({ length: 5 }, (_, index) => ({
      messageId: `original-${index}`,
      payload: { id: `original-${index}`, text: `original ${index}` }
    }))
    registry.replaceProjectionMessages('failed-revision', original)

    expect(() => registry.reviseProjectionMessages('failed-revision', {
      fromMessageId: 'missing-target',
      replacementMessages: [{ messageId: 'unused', payload: { text: 'unused' } }]
    })).toThrowError(expect.objectContaining({ code: 'PRODUCT_SESSION_PROJECTION_MESSAGE_NOT_FOUND' }))
    expect(registry.listProjectionMessages('failed-revision', { limit: 10 }).messages.map((message) => message.messageId)).toEqual(
      original.map((message) => message.messageId)
    )

    expect(() => registry.reviseProjectionMessages('failed-revision', {
      fromMessageId: 'original-3',
      replacementMessages: [{ messageId: 'original-0', payload: { text: 'primary-key conflict' } }]
    })).toThrow()
    expect(registry.listProjectionMessages('failed-revision', { limit: 10 }).messages.map((message) => message.messageId)).toEqual(
      original.map((message) => message.messageId)
    )
    expect(() => registry.reviseProjectionMessages('failed-revision', {
      fromMessageId: 'original-3',
      replacementMessages: []
    })).toThrowError(expect.objectContaining({ code: 'PRODUCT_SESSION_PROJECTION_REPLACEMENTS_INVALID' }))
  })

  it('preserves exact opaque identifiers, paths, database names, and scope keys', async () => {
    const { registry } = await createFixture()
    const created = registry.create({
      id: ' product-session ',
      surface: 'classic',
      title: '  Display title  ',
      projectRoot: '/repo/trailing ',
      lastKnownCwd: '/repo/trailing /sql ',
      target: {
        kind: 'ssh',
        panelId: ' panel-id ',
        terminalSessionId: ' terminal-id ',
        assetId: ' asset-id ',
        connectionId: ' ssh-connection ',
        label: '  Display target  '
      },
      database: {
        connectionId: ' database-connection ',
        databaseName: 'metrics ',
        schemaName: ' public'
      },
      nativeBinding: {
        engine: ' cline ',
        nativeSessionId: ' native-session ',
        profile: ' database ',
        scopeKey: ' locale\0database\0scope '
      }
    })

    expect(created).toMatchObject({
      id: ' product-session ',
      title: 'Display title',
      projectRoot: '/repo/trailing ',
      lastKnownCwd: '/repo/trailing /sql ',
      target: {
        panelId: ' panel-id ',
        terminalSessionId: ' terminal-id ',
        assetId: ' asset-id ',
        connectionId: ' ssh-connection ',
        label: 'Display target'
      },
      database: {
        connectionId: ' database-connection ',
        databaseName: 'metrics ',
        schemaName: ' public'
      },
      nativeBinding: {
        engine: 'cline',
        nativeSessionId: ' native-session ',
        profile: 'database',
        scopeKey: ' locale\0database\0scope '
      }
    })
    expect(registry.get('product-session')).toBeNull()
    expect(registry.get(' product-session ')).toEqual(created)
    expect(registry.list({ projectRoot: '/repo/trailing ' })).toHaveLength(1)
    expect(registry.list({ projectRoot: '/repo/trailing' })).toHaveLength(0)
    expect(registry.findByNativeBinding({ engine: 'cline', nativeSessionId: ' native-session ' })?.id).toBe(
      ' product-session '
    )
  })

  it('persists a bounded Classic context projection without transcript content or opaque data', async () => {
    const { registry } = await createFixture()
    const created = registry.create({
      id: 'classic-projection',
      surface: 'classic',
      classicContext: {
        contexts: [
          {
            id: 'asset-prod',
            kind: 'hosts',
            label: 'Production',
            detail: 'Primary host',
            assetId: 'asset-1',
            connectionId: 'connection-1',
            host: '10.0.0.8',
            port: 2222,
            username: 'ops'
          },
          {
            id: 'kb-doc:runbooks/deploy.md',
            kind: 'docs',
            label: 'deploy.md',
            relPath: 'runbooks/deploy.md',
            contextType: 'doc',
            mediaType: 'text/markdown'
          },
          {
            id: 'skill:incident-response',
            kind: 'skills',
            label: 'Incident response',
            skillName: 'incident-response'
          },
          {
            id: 'chat:previous',
            kind: 'chats',
            label: 'Previous investigation',
            chatSessionId: 'previous-session'
          }
        ]
      }
    })

    expect(registry.get(created.id)?.classicContext).toEqual(created.classicContext)
    expect(registry.list({ surface: 'classic' })[0].classicContext?.contexts.map((context) => context.id)).toEqual([
      'asset-prod',
      'kb-doc:runbooks/deploy.md',
      'skill:incident-response',
      'chat:previous'
    ])
    created.classicContext!.contexts[0].label = 'mutated outside registry'
    expect(registry.get(created.id)?.classicContext?.contexts[0].label).toBe('Production')

    expect(registry.update({ id: created.id, classicContext: null })?.classicContext).toBeUndefined()
    expect(registry.get(created.id)?.classicContext).toBeUndefined()
  })

  it('rejects oversized, secret-bearing, and malformed Classic context projections', async () => {
    const { databasePath, registry } = await createFixture()
    expect(() => registry.create({
      id: 'too-many-contexts',
      surface: 'classic',
      classicContext: {
        contexts: Array.from({ length: 65 }, (_, index) => ({ id: `doc-${index}`, kind: 'docs', label: `Doc ${index}` }))
      }
    })).toThrowError(expect.objectContaining({ code: 'PRODUCT_SESSION_CLASSIC_CONTEXT_TOO_LARGE' }))
    expect(() => registry.create({
      id: 'secret-context',
      surface: 'classic',
      classicContext: {
        contexts: [{ id: 'host-1', kind: 'hosts', label: 'Host', content: 'secret', unavailable: false } as any]
      }
    })).toThrowError(expect.objectContaining({ code: 'PRODUCT_SESSION_CLASSIC_CONTEXT_INVALID' }))
    expect(() => registry.create({
      id: 'invalid-port-context',
      surface: 'classic',
      classicContext: {
        contexts: [{ id: 'host-1', kind: 'hosts', label: 'Host', port: 70000 }]
      }
    })).toThrowError(expect.objectContaining({ code: 'PRODUCT_SESSION_FIELD_INVALID' }))

    registry.create({ id: 'corrupt-classic-context', surface: 'classic' })
    const corruptor = new TestSqliteDatabase(databasePath)
    corruptor.prepare('UPDATE product_sessions SET classic_context_json = ? WHERE id = ?').run(
      '{"contexts":[{"id":"doc","kind":"docs","label":"Doc","data":"secret"}]}',
      'corrupt-classic-context'
    )
    corruptor.close()
    expect(() => registry.get('corrupt-classic-context')).toThrowError(
      expect.objectContaining({ code: 'PRODUCT_SESSION_DATA_INVALID' })
    )
  })

  it('fails closed when a stored scope key is not canonical UTF-8 base64', async () => {
    const { databasePath, registry } = await createFixture()
    registry.create({
      id: 'corrupt-scope',
      surface: 'classic',
      nativeBinding: { engine: 'cline', nativeSessionId: 'native-corrupt', scopeKey: 'valid\0scope' }
    })
    const corruptor = new TestSqliteDatabase(databasePath)
    corruptor.prepare('UPDATE product_sessions SET native_scope_key_b64 = ? WHERE id = ?').run('@@@@', 'corrupt-scope')
    corruptor.close()

    expect(() => registry.get('corrupt-scope')).toThrowError(
      expect.objectContaining({ code: 'PRODUCT_SESSION_DATA_INVALID' })
    )
  })

  it('updates and clears context fields independently while preserving identity and creation time', async () => {
    let now = 2000
    const { registry } = await createFixture({ now: () => now })
    registry.create({
      id: 'classic-1',
      surface: 'classic',
      projectRoot: '/work/one',
      lastKnownCwd: '/work/one/src',
      target: { kind: 'local', terminalSessionId: 'terminal-1' },
      nativeBinding: { engine: 'cline', nativeSessionId: 'classic-native-1', profile: 'classic-agent' }
    })

    now = 2000
    const updated = registry.update({
      id: 'classic-1',
      title: 'Renamed',
      projectRoot: '/work/two',
      lastKnownCwd: null,
      target: null,
      database: { connectionId: 'db-2', databaseName: 'orders' },
      nativeBinding: { engine: 'codex', nativeSessionId: 'codex-thread-2' }
    })

    expect(updated).toEqual({
      id: 'classic-1',
      surface: 'classic',
      title: 'Renamed',
      isOpen: true,
      projectRoot: '/work/two',
      database: { connectionId: 'db-2', databaseName: 'orders' },
      nativeBinding: { engine: 'codex', nativeSessionId: 'codex-thread-2' },
      createdAt: 2000,
      updatedAt: 2001
    })
    expect(registry.update({ id: 'missing', title: 'ignored' })).toBeNull()
  })

  it('requires a native rebind when security-scoped context changes', async () => {
    const { registry } = await createFixture()
    registry.create({
      id: 'scoped-session',
      surface: 'database',
      projectRoot: '/repo/a',
      target: {
        kind: 'ssh',
        panelId: 'panel-a',
        terminalSessionId: 'terminal-a',
        assetId: 'asset-a',
        connectionId: 'ssh-a',
        label: 'Original label'
      },
      database: { connectionId: 'db-a', databaseName: 'metrics', schemaName: 'public' },
      nativeBinding: { engine: 'cline', nativeSessionId: 'native-a' }
    })

    const metadataOnly = registry.update({
      id: 'scoped-session',
      lastKnownCwd: '/repo/a/sql',
      target: {
        kind: 'ssh',
        panelId: 'panel-b',
        terminalSessionId: 'terminal-a',
        assetId: 'asset-a',
        connectionId: 'ssh-a',
        label: 'Renamed label'
      }
    })
    expect(metadataOnly).toMatchObject({
      lastKnownCwd: '/repo/a/sql',
      target: { panelId: 'panel-b', label: 'Renamed label' },
      nativeBinding: { engine: 'cline', nativeSessionId: 'native-a' }
    })

    expect(() =>
      registry.update({
        id: 'scoped-session',
        database: { connectionId: 'db-b', databaseName: 'metrics', schemaName: 'public' }
      })
    ).toThrowError(expect.objectContaining({ code: 'PRODUCT_SESSION_CONTEXT_REBIND_REQUIRED' }))
    expect(() =>
      registry.update({
        id: 'scoped-session',
        projectRoot: '/repo/b',
        nativeBinding: { engine: 'cline', nativeSessionId: 'native-a' }
      })
    ).toThrowError(expect.objectContaining({ code: 'PRODUCT_SESSION_CONTEXT_REBIND_REQUIRED' }))
    expect(() =>
      registry.update({
        id: 'scoped-session',
        nativeBinding: {
          engine: 'cline',
          nativeSessionId: 'native-a',
          profile: 'database-zh',
          scopeKey: 'zh-CN\0db-a\0metrics\0public'
        }
      })
    ).toThrowError(expect.objectContaining({ code: 'PRODUCT_SESSION_CONTEXT_REBIND_REQUIRED' }))

    const detached = registry.update({
      id: 'scoped-session',
      database: { connectionId: 'db-b', databaseName: 'metrics', schemaName: 'public' },
      nativeBinding: null
    })
    expect(detached?.database?.connectionId).toBe('db-b')
    expect(detached?.nativeBinding).toBeUndefined()
  })

  it('allows a Classic mode profile change when native identity and scope stay stable', async () => {
    const { registry } = await createFixture()
    registry.create({
      id: 'classic-profile-switch',
      surface: 'classic',
      nativeBinding: {
        engine: 'cline',
        nativeSessionId: 'shared-classic-native',
        profile: 'classic-chat',
        scopeKey: 'classic-profile-switch'
      }
    })

    const updated = registry.update({
      id: 'classic-profile-switch',
      nativeBinding: {
        engine: 'cline',
        nativeSessionId: 'shared-classic-native',
        profile: 'classic-agent',
        scopeKey: 'classic-profile-switch'
      }
    })

    expect(updated?.nativeBinding).toEqual({
      engine: 'cline',
      nativeSessionId: 'shared-classic-native',
      profile: 'classic-agent',
      scopeKey: 'classic-profile-switch'
    })
  })

  it('persists a Classic chat-to-agent response on the shared native session', async () => {
    const { registry } = await createFixture()
    const conversationId = 'classic-real-profile-switch'
    const nativeSessionId = 'aiopsterm-classic-shared'
    registry.create({
      id: conversationId,
      surface: 'classic',
      nativeBinding: {
        engine: 'cline',
        nativeSessionId,
        profile: 'classic-chat',
        scopeKey: conversationId
      }
    })
    const modulePath = '../src/main/backend/agent/classicProductSessionLifecycle'
    const { bindClassicProductSessionResponse } = await import(modulePath)
    const stopNativeSession = vi.fn(async () => undefined)

    await bindClassicProductSessionResponse({
      registry,
      request: { requestId: 'classic-mode-switch', conversationId, prompt: 'continue', mode: 'agent' },
      result: {
        ok: true,
        data: {
          text: 'done',
          provider: 'provider',
          model: 'model',
          durationMs: 1,
          nativeSessionId,
          nativeProfile: 'classic-agent',
          nativeScopeKey: conversationId
        }
      },
      stopNativeSession
    })

    expect(registry.get(conversationId)?.nativeBinding).toMatchObject({
      nativeSessionId,
      profile: 'classic-agent',
      scopeKey: conversationId
    })
    expect(stopNativeSession).not.toHaveBeenCalled()
  })

  it('detects a concurrent update instead of overwriting newer metadata', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'aiopsterm-product-sessions-conflict-'))
    cleanupPaths.push(userDataPath)
    const databasePath = productSessionRegistryPathFor(userDataPath)
    let timestampCalls = 0
    const registry = createProductSessionRegistry({
      userDataPath,
      sqliteFactory: TestSqliteDatabase,
      now: () => {
        timestampCalls += 1
        if (timestampCalls === 2) {
          const concurrent = new TestSqliteDatabase(databasePath)
          concurrent.prepare('UPDATE product_sessions SET updated_at = ? WHERE id = ?').run(5000, 'concurrent')
          concurrent.close()
        }
        return 1000 + timestampCalls
      }
    })
    openRegistries.push(registry)
    registry.create({ id: 'concurrent', surface: 'classic', title: 'Original' })

    expect(() => registry.update({ id: 'concurrent', title: 'Overwritten' })).toThrowError(
      expect.objectContaining({ code: 'PRODUCT_SESSION_UPDATE_CONFLICT' })
    )
    expect(registry.get('concurrent')).toMatchObject({ title: 'Original', updatedAt: 5000 })
  })

  it('lists newest sessions with product-context filters and a bounded limit', async () => {
    let now = 0
    const { registry } = await createFixture({ now: () => ++now })
    registry.create({
      id: 'classic-a',
      surface: 'classic',
      projectRoot: '/repo/a',
      target: { kind: 'ssh', assetId: 'asset-a', connectionId: 'ssh-a' },
      nativeBinding: { engine: 'cline', nativeSessionId: 'native-a' }
    })
    registry.create({
      id: 'database-a',
      surface: 'database',
      projectRoot: '/repo/a',
      database: { connectionId: 'db-a', databaseName: 'main' },
      nativeBinding: { engine: 'cline', nativeSessionId: 'native-b' }
    })
    registry.create({
      id: 'codex-b',
      surface: 'codex',
      isOpen: false,
      projectRoot: '/repo/b',
      nativeBinding: { engine: 'codex', nativeSessionId: 'native-c' }
    })

    expect(registry.list().map((session) => session.id)).toEqual(['codex-b', 'database-a', 'classic-a'])
    expect(registry.list({ projectRoot: '/repo/a' }).map((session) => session.id)).toEqual(['database-a', 'classic-a'])
    expect(registry.list({ surface: 'classic', targetAssetId: 'asset-a', targetConnectionId: 'ssh-a' })).toHaveLength(1)
    expect(registry.list({ databaseConnectionId: 'db-a', nativeEngine: 'cline' }).map((session) => session.id)).toEqual(['database-a'])
    expect(registry.list({ isOpen: false }).map((session) => session.id)).toEqual(['codex-b'])
    expect(registry.list({ limit: 2 })).toHaveLength(2)
    expect(registry.list({ limit: 2, offset: 1 }).map((session) => session.id)).toEqual(['database-a', 'classic-a'])
    expect(() => registry.list({ limit: 0 })).toThrowError(ProductSessionRegistryError)
    expect(() => registry.list({ offset: -1 })).toThrowError(ProductSessionRegistryError)
  })

  it('marks every persisted session closed on startup without changing its ordering timestamp', async () => {
    const fixture = await createFixture({ now: (() => {
      let now = 100
      return () => ++now
    })() })
    const open = fixture.registry.create({ id: 'startup-open', surface: 'classic', isOpen: true })
    const alreadyClosed = fixture.registry.create({ id: 'startup-closed', surface: 'database', isOpen: false })
    fixture.registry.close()
    openRegistries.splice(openRegistries.indexOf(fixture.registry), 1)

    const reopened = createProductSessionRegistry({
      userDataPath: fixture.userDataPath,
      sqliteFactory: TestSqliteDatabase,
      now: () => 999_999
    })
    openRegistries.push(reopened)

    expect(reopened.get(open.id)).toMatchObject({ isOpen: false, updatedAt: open.updatedAt })
    expect(reopened.get(alreadyClosed.id)).toMatchObject({ isOpen: false, updatedAt: alreadyClosed.updatedAt })
    expect(reopened.list().map((record) => record.id)).toEqual(['startup-closed', 'startup-open'])
  })

  it('publishes immutable create, update, and delete projections to registry subscribers', async () => {
    const { registry } = await createFixture()
    const events: any[] = []
    const unsubscribe = registry.subscribe((event) => {
      events.push(event)
      if (event && typeof event === 'object' && 'session' in event) {
        ;(event as any).session.title = 'listener mutation'
      }
    })

    const created = registry.create({ id: 'observed', surface: 'classic', title: 'Created' })
    const updated = registry.update({ id: created.id, title: 'Updated' })
    expect(registry.delete(created.id)).toBe(true)
    unsubscribe()
    registry.create({ id: 'not-observed', surface: 'classic' })

    expect(events.map((event) => event.type)).toEqual(['created', 'updated', 'deleted'])
    expect(events.map((event) => event.id)).toEqual(['observed', 'observed', 'observed'])
    expect(updated?.title).toBe('Updated')
    expect(events[0].session).toMatchObject({ id: 'observed', title: 'listener mutation' })
  })

  it('enforces one product owner for each engine-native session binding', async () => {
    const { registry } = await createFixture()
    registry.create({
      id: 'first',
      surface: 'classic',
      nativeBinding: { engine: 'cline', nativeSessionId: 'shared-native-id' }
    })
    registry.create({ id: 'second', surface: 'database' })

    expect(registry.findByNativeBinding({ engine: 'cline', nativeSessionId: 'shared-native-id' })?.id).toBe('first')
    expect(() =>
      registry.update({
        id: 'second',
        nativeBinding: { engine: 'cline', nativeSessionId: 'shared-native-id' }
      })
    ).toThrowError(expect.objectContaining({ code: 'PRODUCT_SESSION_NATIVE_BINDING_CONFLICT' }))
  })

  it('deletes only the selected product session and validates required binding context', async () => {
    const { registry } = await createFixture()
    registry.create({ id: 'keep', surface: 'classic' })
    registry.create({ id: 'remove', surface: 'database' })

    expect(registry.delete('remove')).toBe(true)
    expect(registry.delete('remove')).toBe(false)
    expect(registry.get('remove')).toBeNull()
    expect(registry.get('keep')?.id).toBe('keep')
    expect(() =>
      registry.create({
        id: 'invalid-db',
        surface: 'database',
        database: { connectionId: '   ' }
      })
    ).toThrowError(expect.objectContaining({ code: 'PRODUCT_SESSION_FIELD_REQUIRED' }))
    expect(() =>
      registry.create({
        id: 'invalid-binding',
        surface: 'codex',
        nativeBinding: { engine: 'codex', nativeSessionId: '' }
      })
    ).toThrowError(expect.objectContaining({ code: 'PRODUCT_SESSION_FIELD_REQUIRED' }))
    expect(() => registry.create({ id: 'invalid\0id', surface: 'classic' })).toThrowError(
      expect.objectContaining({ code: 'PRODUCT_SESSION_FIELD_INVALID' })
    )
    expect(() =>
      registry.create({
        id: 'invalid-label',
        surface: 'classic',
        target: { kind: 'local', label: 'invalid\0label' }
      })
    ).toThrowError(expect.objectContaining({ code: 'PRODUCT_SESSION_FIELD_INVALID' }))
    expect(() =>
      registry.create({
        id: 'invalid-native-id',
        surface: 'classic',
        nativeBinding: { engine: 'cline', nativeSessionId: 'invalid\0native' }
      })
    ).toThrowError(expect.objectContaining({ code: 'PRODUCT_SESSION_FIELD_INVALID' }))
    expect(() => registry.create({ id: 'invalid\uD800unicode', surface: 'classic' })).toThrowError(
      expect.objectContaining({ code: 'PRODUCT_SESSION_FIELD_INVALID' })
    )
    expect(() =>
      registry.create({
        id: 'invalid-scope-unicode',
        surface: 'classic',
        nativeBinding: { engine: 'cline', nativeSessionId: 'valid-native', scopeKey: 'scope\uDC00' }
      })
    ).toThrowError(expect.objectContaining({ code: 'PRODUCT_SESSION_FIELD_INVALID' }))
  })

  it('conditionally deletes only the unchanged registry revision', async () => {
    const { registry } = await createFixture({ now: () => 100 })
    const created = registry.create({ id: 'conditional-delete', surface: 'codex' })
    const updated = registry.update({ id: created.id, title: 'Newer revision' })!

    expect(registry.deleteIfUnchanged(created.id, created.updatedAt)).toBe(false)
    expect(registry.get(created.id)).toMatchObject({ title: 'Newer revision' })
    expect(registry.deleteIfUnchanged(created.id, updated.updatedAt)).toBe(true)
    expect(registry.get(created.id)).toBeNull()
  })

  it('rejects an unsupported schema before applying current DDL', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'aiopsterm-product-sessions-future-'))
    cleanupPaths.push(userDataPath)
    const databasePath = join(userDataPath, 'future-registry.db')
    const future = new TestSqliteDatabase(databasePath)
    future.exec(`
      CREATE TABLE product_session_registry_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO product_session_registry_meta (key, value) VALUES ('schema_version', '${productSessionRegistrySchemaVersion + 1}');
      CREATE TABLE product_sessions (id TEXT PRIMARY KEY, future_only TEXT);
    `)
    future.close()

    expect(() => createProductSessionRegistry({ databasePath, sqliteFactory: TestSqliteDatabase })).toThrowError(
      expect.objectContaining({ code: 'PRODUCT_SESSION_SCHEMA_UNSUPPORTED' })
    )

    const inspected = new TestSqliteDatabase(databasePath, { readOnly: true })
    const columns = (inspected.prepare('PRAGMA table_info(product_sessions)').all() as Array<{ name: string }>).map(
      (column) => column.name
    )
    const indexes = inspected.prepare('PRAGMA index_list(product_sessions)').all() as Array<{ name: string }>
    inspected.close()
    expect(columns).toEqual(['id', 'future_only'])
    expect(indexes.map((index) => index.name)).not.toContain('idx_product_sessions_native_binding')
  })

  it('migrates schema version one rows to closed product sessions', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'aiopsterm-product-sessions-v1-'))
    cleanupPaths.push(userDataPath)
    const databasePath = join(userDataPath, 'registry-v1.db')
    const legacy = new TestSqliteDatabase(databasePath)
    legacy.exec(`
      CREATE TABLE product_session_registry_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO product_session_registry_meta (key, value) VALUES ('schema_version', '1');
      CREATE TABLE product_sessions (
        id TEXT PRIMARY KEY,
        surface TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        project_root TEXT,
        last_known_cwd TEXT,
        target_kind TEXT,
        target_panel_id TEXT,
        target_terminal_session_id TEXT,
        target_asset_id TEXT,
        target_connection_id TEXT,
        target_label TEXT,
        target_host TEXT,
        target_port INTEGER,
        target_username TEXT,
        target_asset_name TEXT,
        database_connection_id TEXT,
        database_name TEXT,
        database_schema_name TEXT,
        native_engine TEXT,
        native_session_id TEXT,
        native_profile TEXT,
        native_scope_key_b64 TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO product_sessions (id, surface, title, created_at, updated_at)
        VALUES ('legacy-codex', 'codex', 'Legacy Codex', 10, 20);
    `)
    legacy.close()

    const registry = createProductSessionRegistry({ databasePath, sqliteFactory: TestSqliteDatabase })
    openRegistries.push(registry)

    expect(registry.get('legacy-codex')).toMatchObject({ isOpen: false, createdAt: 10, updatedAt: 20 })
    expect(registry.list({ isOpen: false }).map((session) => session.id)).toEqual(['legacy-codex'])
    const inspected = new TestSqliteDatabase(databasePath, { readOnly: true })
    expect((inspected.prepare("SELECT value FROM product_session_registry_meta WHERE key = 'schema_version'").get() as { value: string }).value).toBe(
      String(productSessionRegistrySchemaVersion)
    )
    inspected.close()
  })

  it('migrates schema version two with an empty Classic projection and preserves row timestamps', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'aiopsterm-product-sessions-v2-'))
    cleanupPaths.push(userDataPath)
    const databasePath = join(userDataPath, 'registry-v2.db')
    const legacy = new TestSqliteDatabase(databasePath)
    legacy.exec(`
      CREATE TABLE product_session_registry_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO product_session_registry_meta (key, value) VALUES ('schema_version', '2');
      CREATE TABLE product_sessions (
        id TEXT PRIMARY KEY,
        surface TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        is_open INTEGER NOT NULL DEFAULT 1,
        project_root TEXT,
        last_known_cwd TEXT,
        target_kind TEXT,
        target_panel_id TEXT,
        target_terminal_session_id TEXT,
        target_asset_id TEXT,
        target_connection_id TEXT,
        target_label TEXT,
        target_host TEXT,
        target_port INTEGER,
        target_username TEXT,
        target_asset_name TEXT,
        database_connection_id TEXT,
        database_name TEXT,
        database_schema_name TEXT,
        native_engine TEXT,
        native_session_id TEXT,
        native_profile TEXT,
        native_scope_key_b64 TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO product_sessions (id, surface, title, is_open, created_at, updated_at)
        VALUES ('v2-classic', 'classic', 'Version two', 1, 10, 20);
    `)
    legacy.close()

    const registry = createProductSessionRegistry({ databasePath, sqliteFactory: TestSqliteDatabase })
    openRegistries.push(registry)

    expect(registry.get('v2-classic')).toEqual({
      id: 'v2-classic',
      surface: 'classic',
      title: 'Version two',
      isOpen: false,
      createdAt: 10,
      updatedAt: 20
    })
    const inspected = new TestSqliteDatabase(databasePath, { readOnly: true })
    const columns = (inspected.prepare('PRAGMA table_info(product_sessions)').all() as Array<{ name: string }>).map(
      (column) => column.name
    )
    expect(columns).toContain('classic_context_json')
    expect((inspected.prepare("SELECT value FROM product_session_registry_meta WHERE key = 'schema_version'").get() as { value: string }).value).toBe(
      String(productSessionRegistrySchemaVersion)
    )
    inspected.close()
  })

  it('opens the default SQLite driver or reports a stable availability error', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'aiopsterm-product-sessions-default-driver-'))
    cleanupPaths.push(userDataPath)
    try {
      const registry = createProductSessionRegistry({ userDataPath })
      openRegistries.push(registry)
      expect(registry.list()).toEqual([])
    } catch (error) {
      expect(error).toBeInstanceOf(ProductSessionRegistryError)
      expect(error).toMatchObject({ code: 'PRODUCT_SESSION_SQLITE_UNAVAILABLE' })
    }
  })

  it('guards timestamp overflow and keeps close idempotent', async () => {
    const { registry } = await createFixture({ now: () => Number.MAX_SAFE_INTEGER })
    registry.create({ id: 'max-time', surface: 'classic' })
    expect(() => registry.update({ id: 'max-time', title: 'Too late' })).toThrowError(
      expect.objectContaining({ code: 'PRODUCT_SESSION_TIME_INVALID' })
    )

    registry.close()
    expect(() => registry.close()).not.toThrow()
    expect(() => registry.get('max-time')).toThrowError(
      expect.objectContaining({ code: 'PRODUCT_SESSION_REGISTRY_CLOSED' })
    )
  })
})
