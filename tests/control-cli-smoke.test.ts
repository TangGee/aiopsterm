import { createServer, type Server } from 'net'
import { execFile } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'
import { rm } from 'fs/promises'
import { promisify } from 'util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

const servers: Server[] = []
const socketPaths: string[] = []

const startControlServer = async (handler: (request: Record<string, unknown>) => Record<string, unknown>) => {
  const socketPath = join(tmpdir(), `aiopsterm-control-cli-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.sock`)
  const server = createServer((socket) => {
    let buffer = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk) => {
      buffer += chunk
      const newline = buffer.indexOf('\n')
      if (newline < 0) return
      const request = JSON.parse(buffer.slice(0, newline)) as Record<string, unknown>
      socket.write(`${JSON.stringify(handler(request))}\n`)
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.once('listening', () => resolve())
    server.listen(socketPath)
  })
  servers.push(server)
  socketPaths.push(socketPath)
  return socketPath
}

describe('aiopsterm-control CLI', () => {
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
    await Promise.all(socketPaths.splice(0).map((socketPath) => rm(socketPath, { force: true })))
  })

  it('sends terminal list requests over the configured socket', async () => {
    const seen: Record<string, unknown>[] = []
    const socketPath = await startControlServer((request) => {
      seen.push(request)
      return {
        id: request.id,
        ok: true,
        data: {
          terminals: [{ panelId: 'panel-1', sessionId: 'terminal-1', kind: 'local', connected: true, active: true, title: 'Local' }]
        }
      }
    })

    const result = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, '--json', 'terminal', 'list'], {
      cwd: process.cwd()
    })
    expect(JSON.parse(result.stdout)).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          terminals: [expect.objectContaining({ panelId: 'panel-1', sessionId: 'terminal-1' })]
        })
      })
    )
    expect(seen).toEqual([expect.objectContaining({ method: 'terminal.list' })])
  })

  it('sends workspace snapshot requests over the configured socket', async () => {
    const seen: Record<string, unknown>[] = []
    const socketPath = await startControlServer((request) => {
      seen.push(request)
      return {
        id: request.id,
        ok: true,
        data: {
          snapshot: {
            mode: 'terminal',
            activeModule: 'workspace',
            activePanelId: 'panel-1',
            counts: { terminals: 1, surfaces: 1, splitGroups: 0, managedAiSessions: 0, attentionItems: 0 },
            surfaces: [{ panelId: 'panel-1', surfaceKind: 'terminal', connected: true, active: true, title: 'Local' }],
            attention: { unreadCount: 0, items: [] }
          }
        }
      }
    })

    const result = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'workspace', 'snapshot'], {
      cwd: process.cwd()
    })
    expect(result.stdout).toContain('workspace\tterminal\tworkspace\tactive=panel-1')
    expect(result.stdout).toContain('counts\tterminals=1')
    expect(seen).toEqual([expect.objectContaining({ method: 'workspace.snapshot' })])
  })

  it('sends workspace group requests over the configured socket', async () => {
    const seen: Record<string, unknown>[] = []
    const socketPath = await startControlServer((request) => {
      seen.push(request)
      return {
        id: request.id,
        ok: true,
        data: {
          group: {
            id: 'group-1',
            ref: 'workspace_group:1',
            name: request.params && typeof request.params === 'object' ? (request.params as Record<string, unknown>).name || 'Ops' : 'Ops',
            memberCount: 2
          },
          groups: [{ id: 'group-1', ref: 'workspace_group:1', name: 'Ops', memberCount: 2, collapsed: false, pinned: false }]
        }
      }
    })

    const result = await execFileAsync(
      process.execPath,
      ['resources/aiopsterm-control.js', '--socket', socketPath, 'workspace-group', 'create', '--name', 'Ops', '--from', 'panel-1,panel-2'],
      { cwd: process.cwd() }
    )
    expect(result.stdout).toContain('OK\tworkspace_group:1\tOps\t2 members')
    expect(seen).toEqual([
      expect.objectContaining({
        method: 'workspace.group.create',
        params: expect.objectContaining({ name: 'Ops', from: 'panel-1,panel-2', childWorkspaceIds: 'panel-1,panel-2' })
      })
    ])
  })

  it('requires an explicit confirm flag for workspace group delete commands', async () => {
    const seen: Record<string, unknown>[] = []
    const socketPath = await startControlServer((request) => {
      seen.push(request)
      return { id: request.id, ok: true, data: { groups: [] } }
    })

    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'workspace-group', 'delete', 'workspace_group:1', '--confirm'], {
      cwd: process.cwd()
    })
    expect(seen).toEqual([
      expect.objectContaining({
        method: 'workspace.group.delete',
        params: expect.objectContaining({ groupId: 'workspace_group:1', group_id: 'workspace_group:1', confirm: true })
      })
    ])
  })

  it('sends notification requests over the configured socket', async () => {
    const seen: Record<string, unknown>[] = []
    const socketPath = await startControlServer((request) => {
      seen.push(request)
      return {
        id: request.id,
        ok: true,
        data: {
          notification: {
            id: 'notification-1',
            title: request.params && typeof request.params === 'object' ? (request.params as Record<string, unknown>).title : 'Notification',
            read: false
          },
          notifications: []
        }
      }
    })

    const result = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, '--json', 'notify', '--title', 'Done', '--body', 'All green'], {
      cwd: process.cwd()
    })
    expect(JSON.parse(result.stdout)).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ notification: expect.objectContaining({ title: 'Done' }) }) }))
    expect(seen).toEqual([expect.objectContaining({ method: 'notification.create', params: expect.objectContaining({ title: 'Done', body: 'All green' }) })])
  })

  it('sends agent hibernation requests over the configured socket', async () => {
    const seen: Record<string, unknown>[] = []
    const socketPath = await startControlServer((request) => {
      seen.push(request)
      return {
        id: request.id,
        ok: true,
        data: {
          config: { enabled: true, idleSeconds: 300, maxLiveTerminals: 12, confirmationSeconds: 60 },
          session: { source: 'codex', id: 'codex-session-1', hibernated: true }
        }
      }
    })

    const status = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'agent-hibernation', 'status'], {
      cwd: process.cwd()
    })
    expect(status.stdout).toContain('agent-hibernation\ton\tmax=12\tidle=300')

    await execFileAsync(
      process.execPath,
      ['resources/aiopsterm-control.js', '--socket', socketPath, 'agent', 'hibernate', '--session', 'codex-session-1', '--source', 'codex', '--reason', 'manual-test'],
      { cwd: process.cwd() }
    )
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'agent', 'resume', '--session', 'codex-session-1', '--source', 'codex'], {
      cwd: process.cwd()
    })

    expect(seen).toEqual([
      expect.objectContaining({ method: 'agent-hibernation.status' }),
      expect.objectContaining({
        method: 'agent.hibernate',
        params: expect.objectContaining({ sessionId: 'codex-session-1', session_id: 'codex-session-1', source: 'codex', reason: 'manual-test' })
      }),
      expect.objectContaining({
        method: 'agent.resume',
        params: expect.objectContaining({ sessionId: 'codex-session-1', session_id: 'codex-session-1', source: 'codex' })
      })
    ])
  })
})
