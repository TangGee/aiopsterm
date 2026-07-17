import { mkdtemp, rm, utimes } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'

const cleanupPaths: string[] = []

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

const fixture = async (now = Date.now()) => {
  const modulePath = '../src/main/backend/agent/clineAgentOutputStore'
  const { createClineAgentOutputStore } = await import(modulePath) as any
  const rootPath = await mkdtemp(join(tmpdir(), 'aiopsterm-cline-output-'))
  cleanupPaths.push(rootPath)
  return {
    rootPath,
    store: createClineAgentOutputStore({
      rootPath,
      now: () => now,
      randomToken: () => '0123456789abcdef0123456789abcdef'
    })
  }
}

describe('Cline Agent output store', () => {
  it('writes an opaque session-bound reference and reads bounded UTF-8 chunks', async () => {
    const { store } = await fixture()
    const saved = await store.write({
      sessionId: 'session-a',
      taskId: 'task-a',
      turnId: 'turn-a',
      toolCallId: 'tool-a',
      content: 'alpha-中文-omega'
    })

    expect(saved.fileRef).toMatch(/^cline-output:[a-f0-9]{24}:[a-f0-9]{32}$/)
    expect(saved.fileRef).not.toContain('session-a')
    const first = await store.read({ sessionId: 'session-a', fileRef: saved.fileRef, maxBytes: 8 })
    expect(first.content).toBe('alpha-')
    expect(first.eof).toBe(false)
    const second = await store.read({
      sessionId: 'session-a',
      fileRef: saved.fileRef,
      offset: first.nextOffset,
      maxBytes: 128
    })
    expect(second.content).toBe('中文-omega')
    expect(second.eof).toBe(true)
    const wholeCharacter = await store.read({
      sessionId: 'session-a',
      fileRef: saved.fileRef,
      offset: 6,
      maxBytes: 1
    })
    expect(wholeCharacter.content).toBe('中')
    expect(wholeCharacter.nextOffset).toBe(9)
  })

  it('rejects cross-session reads and removes output with its native session', async () => {
    const { store } = await fixture()
    const saved = await store.write({
      sessionId: 'session-a',
      taskId: 'task-a',
      turnId: 'turn-a',
      toolCallId: 'tool-a',
      content: 'captured output'
    })

    await expect(store.read({ sessionId: 'session-b', fileRef: saved.fileRef })).rejects.toThrow('invalid for this session')
    await store.deleteSession('session-a')
    await expect(store.read({ sessionId: 'session-a', fileRef: saved.fileRef })).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('prunes expired output pairs without touching recent files', async () => {
    const now = Date.now()
    const { rootPath, store } = await fixture(now)
    const saved = await store.write({
      sessionId: 'session-a',
      taskId: 'task-a',
      turnId: 'turn-a',
      toolCallId: 'tool-a',
      content: 'old output'
    })
    const [, digest, token] = saved.fileRef.split(':')
    const old = new Date(now - 120_000)
    await utimes(join(rootPath, digest, `${token}.json`), old, old)

    await expect(store.prune(60_000)).resolves.toBe(1)
    await expect(store.read({ sessionId: 'session-a', fileRef: saved.fileRef })).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
