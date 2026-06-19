import { createServer, type Server } from 'net'
import { execFile } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'
import { readFile, rm } from 'fs/promises'
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

const startControlStreamServer = async (handler: (request: Record<string, unknown>) => Record<string, unknown>[]) => {
  const socketPath = join(tmpdir(), `aiopsterm-control-cli-stream-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.sock`)
  const server = createServer((socket) => {
    let buffer = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk) => {
      buffer += chunk
      const newline = buffer.indexOf('\n')
      if (newline < 0) return
      const request = JSON.parse(buffer.slice(0, newline)) as Record<string, unknown>
      for (const frame of handler(request)) socket.write(`${JSON.stringify(frame)}\n`)
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

  it('sends agent team launch requests over the configured socket', async () => {
    const seen: Record<string, unknown>[] = []
    const socketPath = await startControlServer((request) => {
      seen.push(request)
      return {
        id: request.id,
        ok: true,
        data: {
          team: {
            source: 'codex',
            requestedCount: 2,
            launchedCount: 2,
            approvalCount: 0,
            failedCount: 0,
            group: { ref: 'workspace_group:1', name: 'Review Team', memberCount: 2 },
            members: [
              { index: 1, status: 'launched', panel: { panelId: 'panel-1' }, terminal: { sessionId: 'terminal-1' }, command: 'codex' },
              { index: 2, status: 'launched', panel: { panelId: 'panel-2' }, terminal: { sessionId: 'terminal-2' }, command: 'codex' }
            ]
          }
        }
      }
    })

    const result = await execFileAsync(
      process.execPath,
      [
        'resources/aiopsterm-control.js',
        '--socket',
        socketPath,
        'agent',
        'team',
        'launch',
        '--source',
        'codex',
        '--count',
        '2',
        '--cwd',
        '/work/project',
        '--prompt',
        'review this repo',
        '--name',
        'Review Team'
      ],
      { cwd: process.cwd() }
    )

    expect(result.stdout).toContain('agent-team\tcodex\tlaunched=2\tapproval=0\tfailed=0')
    expect(result.stdout).toContain('group\tworkspace_group:1\tReview Team\t2 members')
    expect(seen).toEqual([
      expect.objectContaining({
        method: 'agent.team.launch',
        params: expect.objectContaining({
          source: 'codex',
          count: 2,
          cwd: '/work/project',
          prompt: 'review this repo',
          name: 'Review Team'
        })
      })
    ])
  })

  it('sends surface resume requests over the configured socket', async () => {
    const seen: Record<string, unknown>[] = []
    const socketPath = await startControlServer((request) => {
      seen.push(request)
      return {
        id: request.id,
        ok: true,
        data: {
          surfaceId: 'panel-1',
          surface_id: 'panel-1',
          resumeBinding: {
            kind: 'tmux',
            command: "tmux attach -t work",
            checkpointId: 'work',
            autoResume: false
          },
          resume_binding: {
            kind: 'tmux',
            command: "tmux attach -t work",
            checkpoint_id: 'work',
            auto_resume: false
          }
        }
      }
    })

    const set = await execFileAsync(
      process.execPath,
      ['resources/aiopsterm-control.js', '--socket', socketPath, 'surface', 'resume', 'set', '--panel', 'panel-1', '--kind', 'tmux', '--checkpoint', 'work', '--shell', 'tmux attach -t work'],
      { cwd: process.cwd() }
    )
    expect(set.stdout).toContain('resume\tpanel-1\ttmux\twork\tmanual\ttmux attach -t work')
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'surface', 'resume', 'show', '--panel', 'panel-1'], {
      cwd: process.cwd()
    })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'surface', 'resume', 'clear', '--panel', 'panel-1', '--checkpoint', 'work'], {
      cwd: process.cwd()
    })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'surface', 'resume', 'run', '--panel', 'panel-1'], {
      cwd: process.cwd()
    })

    expect(seen).toEqual([
      expect.objectContaining({
        method: 'surface.resume.set',
        params: expect.objectContaining({
          panelId: 'panel-1',
          surfaceId: 'panel-1',
          kind: 'tmux',
          command: 'tmux attach -t work',
          checkpointId: 'work',
          checkpoint_id: 'work',
          source: 'manual'
        })
      }),
      expect.objectContaining({ method: 'surface.resume.get', params: expect.objectContaining({ panelId: 'panel-1' }) }),
      expect.objectContaining({ method: 'surface.resume.clear', params: expect.objectContaining({ panelId: 'panel-1', checkpointId: 'work', checkpoint_id: 'work' }) }),
      expect.objectContaining({ method: 'surface.resume.run', params: expect.objectContaining({ panelId: 'panel-1' }) })
    ])
  })

  it('streams events and persists the cursor from the CLI helper', async () => {
    const seen: Record<string, unknown>[] = []
    const cursorPath = join(tmpdir(), `aiopsterm-events-cursor-${process.pid}-${Date.now()}.seq`)
    const socketPath = await startControlStreamServer((request) => {
      seen.push(request)
      return [
        {
          type: 'ack',
          protocol: 'aiopsterm-events',
          version: 1,
          boot_id: 'boot-test',
          subscription_id: 'sub-test',
          replay_count: 1,
          resume: { latest_seq: 41, next_seq: 42 }
        },
        {
          type: 'event',
          protocol: 'aiopsterm-events',
          version: 1,
          boot_id: 'boot-test',
          seq: 42,
          id: 'boot-test-42',
          name: 'notification.created',
          category: 'notification',
          source: 'notification.store',
          occurred_at: '2026-06-19T10:00:00.000Z',
          payload: { notification_id: 'notification-1' }
        }
      ]
    })

    const result = await execFileAsync(
      process.execPath,
      ['resources/aiopsterm-control.js', '--socket', socketPath, 'events', '--category', 'notification', '--limit', '1', '--no-ack', '--no-heartbeat', '--cursor-file', cursorPath],
      { cwd: process.cwd() }
    )
    expect(result.stdout).not.toContain('"type":"ack"')
    expect(result.stdout).toContain('"type":"event"')
    expect(await readFile(cursorPath, 'utf8')).toBe('42\n')
    expect(seen).toEqual([
      expect.objectContaining({
        method: 'events.stream',
        params: expect.objectContaining({
          categories: ['notification'],
          include_heartbeats: false
        })
      })
    ])
    await rm(cursorPath, { force: true })
  })
})
