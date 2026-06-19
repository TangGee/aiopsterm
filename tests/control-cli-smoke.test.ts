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

  it('sends system probe and raw rpc requests over the configured socket', async () => {
    const seen: Record<string, unknown>[] = []
    const socketPath = await startControlServer((request) => {
      seen.push(request)
      return {
        id: request.id,
        ok: true,
        data: {
          protocol: 'aiopsterm-control',
          version: 1,
          app: { name: 'aiopsterm', version: '0.1.0' },
          process: { pid: 123, platform: 'linux', arch: 'x64' },
          socketPath,
          runtime: { windowCount: 0, notificationCount: 0, unreadNotificationCount: 0, eventCount: 0 },
          capabilities: ['system.capabilities', 'system.identify', 'terminal.list']
        }
      }
    })

    const capabilities = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'capabilities'], {
      cwd: process.cwd()
    })
    expect(capabilities.stdout).toContain('aiopsterm-control\tv1\taiopsterm@0.1.0')
    expect(capabilities.stdout).toContain('capabilities\tsystem.capabilities,system.identify,terminal.list')

    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'identify', '--panel', 'panel-1', '--session', 'terminal-1'], {
      cwd: process.cwd()
    })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, '--json', 'rpc', 'terminal.list', '--params-json', '{"limit":2}'], {
      cwd: process.cwd()
    })

    expect(seen).toEqual([
      expect.objectContaining({ method: 'system.capabilities' }),
      expect.objectContaining({
        method: 'system.identify',
        params: expect.objectContaining({ caller: { panelId: 'panel-1', sessionId: 'terminal-1' } })
      }),
      expect.objectContaining({ method: 'terminal.list', params: { limit: 2 } })
    ])
  })

  it('sends agent hook installer requests over the configured socket', async () => {
    const seen: Record<string, unknown>[] = []
    const socketPath = await startControlServer((request) => {
      seen.push(request)
      const installed = request.method === 'agent.hooks.setup'
      return {
        id: request.id,
        ok: true,
        data: {
          operation: request.method === 'agent.hooks.uninstall' ? 'uninstall' : request.method === 'agent.hooks.setup' ? 'setup' : undefined,
          installed: installed ? 1 : undefined,
          uninstalled: request.method === 'agent.hooks.uninstall' ? 1 : undefined,
          failed: 0,
          results:
            request.method === 'agent.hooks.setup' || request.method === 'agent.hooks.uninstall'
              ? [{ source: 'codex', ok: true }]
              : [],
          skipped: [],
          installers: [
            {
              source: 'codex',
              label: 'Codex',
              binaryName: 'codex',
              binaryPath: '/usr/bin/codex',
              configPath: '/home/test/.codex/hooks.json',
              configExists: installed,
              installed,
              scriptPath: '/opt/aiopsterm/aiopsterm-agent-hook.js',
              warnings: []
            }
          ],
          count: 1,
          installedCount: installed ? 1 : 0,
          readyCount: 1,
          missingCount: 0
        }
      }
    })

    const listed = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'hooks', 'list'], {
      cwd: process.cwd()
    })
    expect(listed.stdout).toContain('agent-hooks\tinstalled=0\tready=1\tmissing=0\ttotal=1')

    const setup = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'hooks', 'setup', '--agent', 'codex'], {
      cwd: process.cwd()
    })
    expect(setup.stdout).toContain('hook-result\tok\tcodex')
    expect(setup.stdout).toContain('hook\tinstalled\tcodex')

    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'hooks', 'uninstall', 'codex'], {
      cwd: process.cwd()
    })

    expect(seen).toEqual([
      expect.objectContaining({ method: 'agent.hooks.list' }),
      expect.objectContaining({ method: 'agent.hooks.setup', params: expect.objectContaining({ source: 'codex', sources: ['codex'] }) }),
      expect.objectContaining({ method: 'agent.hooks.uninstall', params: expect.objectContaining({ source: 'codex', sources: ['codex'] }) })
    ])
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
    const preview = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'agent-hibernation', 'preview'], {
      cwd: process.cwd()
    })
    expect(preview.stdout).toContain('agent-hibernation\ton\tmax=12\tidle=300')
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'agent-hibernation', 'sweep', '--no-confirm', '--reason', 'test-reaper'], {
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
      }),
      expect.objectContaining({ method: 'agent-hibernation.preview' }),
      expect.objectContaining({
        method: 'agent-hibernation.sweep',
        params: expect.objectContaining({ confirm: false, reason: 'test-reaper' })
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

  it('sends managed AI session requests over the configured socket', async () => {
    const seen: Record<string, unknown>[] = []
    const socketPath = await startControlServer((request) => {
      seen.push(request)
      const session = {
        source: 'claude-code',
        sessionId: 'claude-cli-1',
        id: 'claude-cli-1',
        title: 'Deploy review',
        summary: 'Approve deploy command',
        state: request.method === 'agent.session.reply' || request.method === 'agent.session.handle' ? 'idle' : 'needsInput',
        needsInput: request.method !== 'agent.session.reply' && request.method !== 'agent.session.handle',
        requestKind: 'permission',
        panelId: 'panel-ai',
        eventCount: 1,
        decisionCount: request.method === 'agent.session.reply' || request.method === 'agent.session.handle' ? 1 : 0,
        events: [{ event: 'permission_request', requestKind: 'permission', actionable: true, receivedAt: 1717200000000, summary: 'Approve deploy command' }],
        decisions:
          request.method === 'agent.session.reply' || request.method === 'agent.session.handle'
            ? [{ kind: request.method === 'agent.session.reply' ? 'deny' : 'handled', createdAt: 1717200000100, message: (request.params as any)?.message }]
            : []
      }
      if (request.method === 'agent.session.list') {
        return { id: request.id, ok: true, data: { sessions: [session], count: 1, total: 1, needsInputCount: 1 } }
      }
      if (request.method === 'agent.session.show') return { id: request.id, ok: true, data: { session } }
      return { id: request.id, ok: true, data: { session, count: 1, needsInputCount: session.needsInput ? 1 : 0 } }
    })

    const listed = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'agent', 'session', 'list', '--needs-input', '--source', 'claude-code'], {
      cwd: process.cwd()
    })
    expect(listed.stdout).toContain('agent-sessions\t1/1\tneeds_input=1')
    expect(listed.stdout).toContain('claude-code\tclaude-cli-1\tneedsInput')

    const shown = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'agent-session', 'show', 'claude-cli-1', '--source', 'claude-code'], {
      cwd: process.cwd()
    })
    expect(shown.stdout).toContain('event\tpermission_request\tpermission\tactionable')

    const replied = await execFileAsync(
      process.execPath,
      ['resources/aiopsterm-control.js', '--socket', socketPath, 'agent', 'session', 'reply', 'claude-cli-1', '--source', 'claude-code', '--kind', 'deny', '--message', 'Use staging first'],
      { cwd: process.cwd() }
    )
    expect(replied.stdout).toContain('decision\tdeny')

    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'agent', 'session', 'handle', 'claude-cli-1', '--source', 'claude-code'], {
      cwd: process.cwd()
    })

    expect(seen).toEqual([
      expect.objectContaining({
        method: 'agent.session.list',
        params: expect.objectContaining({ needsInput: true, needs_input: true, source: 'claude-code' })
      }),
      expect.objectContaining({
        method: 'agent.session.show',
        params: expect.objectContaining({ sessionId: 'claude-cli-1', session_id: 'claude-cli-1', source: 'claude-code' })
      }),
      expect.objectContaining({
        method: 'agent.session.reply',
        params: expect.objectContaining({ sessionId: 'claude-cli-1', source: 'claude-code', kind: 'deny', message: 'Use staging first' })
      }),
      expect.objectContaining({
        method: 'agent.session.handle',
        params: expect.objectContaining({ sessionId: 'claude-cli-1', source: 'claude-code' })
      })
    ])
  })

  it('sends agent vault requests over the configured socket', async () => {
    const seen: Record<string, unknown>[] = []
    const socketPath = await startControlServer((request) => {
      seen.push(request)
      if (request.method === 'agent.vault.identify') {
        return {
          id: request.id,
          ok: true,
          data: {
            matches: [
              {
                agent: {
                  id: 'my-agent',
                  name: 'My Agent',
                  resumeCommand: 'my-agent --session {{sessionId}}'
                },
                matched: true,
                sessionId: 'session-1',
                canResume: true,
                canFork: false,
                resumeCommand: 'my-agent --session session-1'
              }
            ]
          }
        }
      }
      if (request.method === 'agent.vault.scan') {
        return {
          id: request.id,
          ok: true,
          data: {
            matches: [
              {
                agent: {
                  id: 'my-agent',
                  name: 'My Agent',
                  resumeCommand: 'my-agent --session {{sessionId}}'
                },
                matched: true,
                sessionId: 'session-1',
                panelId: 'panel-1',
                terminalSessionId: 'terminal-1',
                canResume: true,
                canFork: false,
                resumeCommand: 'my-agent --session session-1'
              }
            ],
            scannedProcessCount: 1
          }
        }
      }
      return {
        id: request.id,
        ok: true,
        data: {
          agent: {
            id: 'my-agent',
            name: 'My Agent',
            detect: { processName: 'my-agent', argvContains: ['--session'] },
            sessionIdSource: { type: 'argvOption', argvOption: '--session' },
            launchCommand: 'my-agent --index {{index}} {{prompt}}',
            resumeCommand: 'my-agent --session {{sessionId}}'
          },
          agents: [
            {
              id: 'my-agent',
              name: 'My Agent',
              detect: { processName: 'my-agent', argvContains: ['--session'] },
              sessionIdSource: { type: 'argvOption', argvOption: '--session' },
              launchCommand: 'my-agent --index {{index}} {{prompt}}',
              resumeCommand: 'my-agent --session {{sessionId}}'
            }
          ],
          command: 'my-agent --session session-1'
        }
      }
    })

    const register = await execFileAsync(
      process.execPath,
      [
        'resources/aiopsterm-control.js',
        '--socket',
        socketPath,
        'agent',
        'vault',
        'register',
        '--id',
        'my-agent',
        '--name',
        'My Agent',
        '--process-name',
        'my-agent',
        '--argv-contains',
        '--session',
        '--session-option',
        '--session',
        '--launch-command',
        'my-agent --index {{index}} {{prompt}}',
        '--resume-command',
        'my-agent --session {{sessionId}}'
      ],
      { cwd: process.cwd() }
    )
    expect(register.stdout).toContain('agent-vault\tmy-agent\tMy Agent\tlaunch\tresume')
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'agent', 'vault', 'list'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'agent', 'vault', 'render', '--id', 'my-agent', '--kind', 'resume', '--session', 'session-1'], {
      cwd: process.cwd()
    })
    const identify = await execFileAsync(
      process.execPath,
      [
        'resources/aiopsterm-control.js',
        '--socket',
        socketPath,
        'agent',
        'vault',
        'identify',
        '--process-name',
        'my-agent',
        '--argv',
        '/usr/local/bin/my-agent',
        '--argv',
        '--session',
        '--argv',
        'session-1'
      ],
      { cwd: process.cwd() }
    )
    expect(identify.stdout).toContain('agent-match\tmy-agent\tMy Agent\tsession-1\tresume')
    const scan = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'agent', 'vault', 'scan', '--source', 'my-agent', '--panel', 'panel-1'], {
      cwd: process.cwd()
    })
    expect(scan.stdout).toContain('agent-match\tmy-agent\tMy Agent\tsession-1\tresume')
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'agent', 'vault', 'remove', '--id', 'my-agent'], { cwd: process.cwd() })

    expect(seen).toEqual([
      expect.objectContaining({
        method: 'agent.vault.register',
        params: expect.objectContaining({
          id: 'my-agent',
          name: 'My Agent',
          processName: 'my-agent',
          process_name: 'my-agent',
          argvContains: ['--session'],
          argv_contains: ['--session'],
          sessionIdSource: { type: 'argvOption', argvOption: '--session' },
          session_id_source: { type: 'argvOption', argvOption: '--session' },
          launchCommand: 'my-agent --index {{index}} {{prompt}}',
          launch_command: 'my-agent --index {{index}} {{prompt}}',
          resumeCommand: 'my-agent --session {{sessionId}}',
          resume_command: 'my-agent --session {{sessionId}}'
        })
      }),
      expect.objectContaining({ method: 'agent.vault.list' }),
      expect.objectContaining({ method: 'agent.vault.render', params: expect.objectContaining({ id: 'my-agent', kind: 'resume', sessionId: 'session-1' }) }),
      expect.objectContaining({
        method: 'agent.vault.identify',
        params: expect.objectContaining({
          process: expect.objectContaining({
            processName: 'my-agent',
            argv: ['/usr/local/bin/my-agent', '--session', 'session-1']
          })
        })
      }),
      expect.objectContaining({ method: 'agent.vault.scan', params: expect.objectContaining({ id: 'my-agent', panelId: 'panel-1' }) }),
      expect.objectContaining({ method: 'agent.vault.remove', params: expect.objectContaining({ id: 'my-agent' }) })
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
          ...(request.method === 'surface.resume.preview' || request.method === 'surface.resume.autorun'
            ? {
                candidates: [
                  {
                    surface: { panelId: 'panel-1' },
                    resumeBinding: { command: 'tmux attach -t work' },
                    trusted: request.method === 'surface.resume.autorun',
                    ready: request.method === 'surface.resume.autorun',
                    reason: request.method === 'surface.resume.autorun' ? 'ready' : 'untrusted'
                  }
                ],
                count: 1,
                readyCount: request.method === 'surface.resume.autorun' ? 1 : 0,
                trustedCount: request.method === 'surface.resume.autorun' ? 1 : 0,
                ranCount: request.method === 'surface.resume.autorun' ? 1 : 0
              }
            : {}),
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
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'surface', 'resume', 'trust', '--panel', 'panel-1', '--policy', 'auto', '--reason', 'test'], {
      cwd: process.cwd()
    })
    const preview = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'surface', 'resume', 'preview', '--panel', 'panel-1'], {
      cwd: process.cwd()
    })
    expect(preview.stdout).toContain('resume-candidates\t0/1\ttrusted=0')
    const autorun = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'surface', 'resume', 'autorun', '--panel', 'panel-1'], {
      cwd: process.cwd()
    })
    expect(autorun.stdout).toContain('resume-candidates\t1/1\ttrusted=1\tran=1')
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
      expect.objectContaining({ method: 'surface.resume.trust', params: expect.objectContaining({ panelId: 'panel-1', policy: 'auto', reason: 'test' }) }),
      expect.objectContaining({ method: 'surface.resume.preview', params: expect.objectContaining({ panelId: 'panel-1' }) }),
      expect.objectContaining({ method: 'surface.resume.autorun', params: expect.objectContaining({ panelId: 'panel-1' }) }),
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
