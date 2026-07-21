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

const runCliCompletion = async (args: string[]) => {
  const result = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', ...args], {
    cwd: process.cwd(),
    env: { ...process.env, AIOPSTERM_CONTROL_SOCKET: '' }
  })
  return result.stdout.split(/\r?\n/).filter(Boolean)
}

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

describe('aio CLI', () => {
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
    await Promise.all(socketPaths.splice(0).map((socketPath) => rm(socketPath, { force: true })))
  })

  it('prints help and reports unknown commands without a stack trace', async () => {
    const help = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', 'help'], {
      cwd: process.cwd(),
      env: { ...process.env, AIOPSTERM_CONTROL_SOCKET: '' }
    })
    expect(help.stdout).toContain('aio [--socket <path>] [--json] <command>')
    expect(help.stdout).toContain('help')
    expect(help.stderr).toBe('')

    try {
      await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', 'missing-command'], {
        cwd: process.cwd(),
        env: { ...process.env, AIOPSTERM_CONTROL_SOCKET: '' }
      })
      throw new Error('expected missing command to fail')
    } catch (error) {
      expect(error).toMatchObject({
        code: 2,
        stdout: '',
        stderr: expect.stringContaining('Unknown command: missing-command')
      })
      expect(String((error as { stderr?: unknown }).stderr || '')).not.toContain('at methodParams')
    }

    try {
      await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--json', 'missing-command'], {
        cwd: process.cwd(),
        env: { ...process.env, AIOPSTERM_CONTROL_SOCKET: '' }
      })
      throw new Error('expected missing json command to fail')
    } catch (error) {
      expect(error).toMatchObject({ code: 2, stderr: '' })
      expect(JSON.parse(String((error as { stdout?: unknown }).stdout || ''))).toEqual(
        expect.objectContaining({
          ok: false,
          errorCode: 'AIO_CONTROL_COMMAND_INVALID',
          errorMessage: 'Unknown command: missing-command'
        })
      )
    }
  })

  it('prints automation recipes without requiring a control socket', async () => {
    const all = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', 'recipes'], {
      cwd: process.cwd(),
      env: { ...process.env, AIOPSTERM_CONTROL_SOCKET: '' }
    })
    expect(all.stdout).toContain('aio recipes')
    expect(all.stdout).toContain('aio context')
    expect(all.stdout).toContain('aio notify --source ci')
    expect(all.stdout).toContain('aio agent session list --needs-input')

    const remote = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', 'recipes', 'remote'], {
      cwd: process.cwd(),
      env: { ...process.env, AIOPSTERM_CONTROL_SOCKET: '' }
    })
    expect(remote.stdout).toContain('Visible SSH Remote (remote)')
    expect(remote.stdout).toContain('workspace remote reconnect')
    expect(remote.stdout).not.toContain('AI Sessions (agent)')

    const unknown = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', 'recipes', '--topic', 'missing'], {
      cwd: process.cwd(),
      env: { ...process.env, AIOPSTERM_CONTROL_SOCKET: '' }
    })
    expect(unknown.stdout).toContain('Unknown recipe topic: missing')
    expect(unknown.stdout).toContain('Available topics: context, notify, agent, terminal, remote, session')
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

  it('routes managed host ssh shortcuts and completion requests', async () => {
    const seen: Record<string, unknown>[] = []
    const socketPath = await startControlServer((request) => {
      seen.push(request)
      if (request.method === 'asset.complete') {
        return {
          id: request.id,
          ok: true,
          data: {
            completions: ['prod-bastion', 'prod-api'],
            candidates: [],
            count: 2
          }
        }
      }
      return {
        id: request.id,
        ok: true,
        data: {
          connected: true,
          configured: true,
          asset: { id: 'asset-1', name: 'prod-bastion', host: '10.24.8.12', username: 'ops', port: 22 },
          surfaceId: 'panel-prod',
          remote: { connection_state: 'connected', host: '10.24.8.12', remote_display_target: 'ops@10.24.8.12' }
        }
      }
    })

    const ssh = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'ssh', 'prod-bastion'], {
      cwd: process.cwd()
    })
    expect(ssh.stdout).toContain('remote')

    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'host', 'switch', 'prod-bastion'], {
      cwd: process.cwd()
    })

    const completion = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'ssh', '--complete', 'prod'], {
      cwd: process.cwd()
    })
    expect(completion.stdout).toBe('prod-bastion\nprod-api\n')

    const genericSshCompletion = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'complete', 'cli', '--index', '2', '--', 'aio', 'ssh', 'prod'], {
      cwd: process.cwd()
    })
    expect(genericSshCompletion.stdout).toBe('prod-bastion\nprod-api\n')

    const directAiosshCompletion = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'complete', 'cli', '--index', '1', '--', 'aiossh', 'prod'], {
      cwd: process.cwd()
    })
    expect(directAiosshCompletion.stdout).toBe('prod-bastion\nprod-api\n')

    const directAiswitchCompletion = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'complete', 'cli', '--index', '1', '--', 'aiswitch', 'prod'], {
      cwd: process.cwd()
    })
    expect(directAiswitchCompletion.stdout).toBe('prod-bastion\nprod-api\n')

    const noSocketCompletion = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', 'ssh', '--complete', 'prod'], {
      cwd: process.cwd(),
      env: { ...process.env, AIOPSTERM_CONTROL_SOCKET: '' }
    })
    expect(noSocketCompletion.stdout).toBe('')
    expect(noSocketCompletion.stderr).toBe('')

    expect(seen).toEqual([
      expect.objectContaining({ method: 'asset.ssh.connect', params: expect.objectContaining({ target: 'prod-bastion', auto_connect: true, reuse: false }) }),
      expect.objectContaining({ method: 'asset.ssh.connect', params: expect.objectContaining({ target: 'prod-bastion', auto_connect: false, reuse: true, require_existing: true }) }),
      expect.objectContaining({ method: 'asset.complete', params: expect.objectContaining({ prefix: 'prod', connectable_only: true }) }),
      expect.objectContaining({ method: 'asset.complete', params: expect.objectContaining({ prefix: 'prod', connectable_only: true }) }),
      expect.objectContaining({ method: 'asset.complete', params: expect.objectContaining({ prefix: 'prod', connectable_only: true }) }),
      expect.objectContaining({ method: 'asset.complete', params: expect.objectContaining({ prefix: 'prod', connectable_only: true }) })
    ])
  })

  it('completes aio command paths and options through the generic completion target', async () => {
    const topLevel = await runCliCompletion(['complete', 'cli', '--index', '1', '--', 'aio', ''])
    expect(topLevel).toEqual([
      'help',
      'context',
      'terminal',
      'ssh',
      'host',
      'settings',
      'agent',
      'feed',
      'workspace',
      'surface',
      'pane',
      'session',
      'project',
      'file',
      'system',
      'window',
      'notify',
      'list-notifications',
      'open-notification',
      'recipes',
      'completion'
    ])
    expect(topLevel).not.toContain('capture-pane')

    const topLevelImplicitEmpty = await runCliCompletion(['complete', 'cli', '--index', '1', '--', 'aio'])
    expect(topLevelImplicitEmpty).toEqual(topLevel)

    const prefixedTopLevel = await runCliCompletion(['complete', 'cli', '--index', '1', '--', 'aio', 'capture'])
    expect(prefixedTopLevel).toEqual(expect.arrayContaining(['capture-pane']))

    const agent = await runCliCompletion(['complete', 'cli', '--index', '2', '--', 'aio', 'agent', ''])
    expect(agent).toEqual(expect.arrayContaining(['session', 'vault', 'team', 'hibernate', 'resume']))

    const agentVault = await runCliCompletion(['complete', 'cli', '--index', '3', '--', 'aio', 'agent', 'vault', ''])
    expect(agentVault).toEqual(expect.arrayContaining(['register', 'list', 'scan', 'scan-processes']))

    const terminal = await runCliCompletion(['complete', 'cli', '--index', '2', '--', 'aio', 'terminal', ''])
    expect(terminal).toEqual(expect.arrayContaining(['list', 'focus', 'create', 'paste', 'viewport', 'read-screen', 'send-key']))

    const host = await runCliCompletion(['complete', 'cli', '--index', '2', '--', 'aio', 'host', ''])
    expect(host).toEqual(expect.arrayContaining(['list', 'add', 'ssh', 'switch', 'complete']))

    const workspaceRemote = await runCliCompletion(['complete', 'cli', '--index', '3', '--', 'aio', 'workspace', 'remote', ''])
    expect(workspaceRemote).toEqual(expect.arrayContaining(['status', 'configure', 'foreground-auth-ready', 'pty-bridge', 'pty-resize']))

    const terminalFocusOptions = await runCliCompletion(['complete', 'cli', '--index', '3', '--', 'aio', 'terminal', 'focus', '--p'])
    expect(terminalFocusOptions).toEqual(expect.arrayContaining(['--panel', '--panel-id']))

    const notifyOptions = await runCliCompletion(['complete', 'cli', '--index', '2', '--', 'aio', 'notify', '--t'])
    expect(notifyOptions).toEqual(expect.arrayContaining(['--title', '--type']))

    const mobileChat = await runCliCompletion(['complete', 'cli', '--index', '3', '--', 'aio', 'mobile', 'chat', ''])
    expect(mobileChat).toEqual(expect.arrayContaining(['sessions', 'history', 'send', 'interrupt', 'answer']))

    const surfaceResume = await runCliCompletion(['complete', 'cli', '--index', '3', '--', 'aio', 'surface', 'resume', ''])
    expect(surfaceResume).toEqual(expect.arrayContaining(['set', 'get', 'trust', 'preview', 'autorun', 'run']))
  })

  it('emits shell completion scripts that delegate to generic aio completion', async () => {
    const bash = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', 'completion', 'bash'], {
      cwd: process.cwd(),
      env: { ...process.env, AIOPSTERM_CONTROL_SOCKET: '' }
    })
    expect(bash.stdout).toContain('complete cli --index "$COMP_CWORD"')
    expect(bash.stdout).toContain('complete -F _aiopsterm_control_complete aio aictl aiopsterm-control aiossh aiswitch')

    const zsh = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', 'completion', 'zsh'], {
      cwd: process.cwd(),
      env: { ...process.env, AIOPSTERM_CONTROL_SOCKET: '' }
    })
    expect(zsh.stdout).toContain('complete cli --index "$index"')
    expect(zsh.stdout).toContain('compdef _aiopsterm_control_complete aio aictl aiopsterm-control aiossh aiswitch')

    const fish = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', 'completion', 'fish'], {
      cwd: process.cwd(),
      env: { ...process.env, AIOPSTERM_CONTROL_SOCKET: '' }
    })
    expect(fish.stdout).toContain('complete cli --index $index')
    expect(fish.stdout).toContain('complete -c aiopsterm-control')
    expect(fish.stdout).toContain('complete -c aiswitch')
  })

  it('sends control_compat-style system, settings, app, and window requests from the CLI helper', async () => {
    const seen: Record<string, unknown>[] = []
    const socketPath = await startControlServer((request) => {
      seen.push(request)
      return {
        id: request.id,
        ok: true,
        data: {
          method: request.method,
          params: request.params,
          windows: request.method === 'window.list' ? [{ id: 'window:1', key: true, visible: true }] : undefined
        }
      }
    })

    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'auth', 'login'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'auth', 'status'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'auth', 'sign-in-url'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'auth', 'begin-sign-in', '--timeout-seconds', '2'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'auth', 'sign-out'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'settings', 'open', '--target', 'models'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'settings', 'get', 'terminal.fontSize'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'settings', 'put', 'terminal.fontSize', '14'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'feedback', 'open'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'feedback', 'submit', '--email', 'dev@example.test', '--body', 'hello', '--image-path', '/tmp/a.png'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'sidebar', 'snapshot', '--window', 'window:1'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'sidebar', 'custom', 'validate', 'ops'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'sidebar', 'custom', 'reload', '--name', 'ops'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'sidebar', 'custom', 'select', 'ops'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'system', 'ping'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'system', 'tree', '--workspace', 'main'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'system', 'top', '--include-processes', '--top-group-limit', '5'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'system', 'memory', '--group-limit', '4'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'vm', 'list'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'vm', 'create', '--image', 'ubuntu', '--provider', 'test', '--idempotency-key', 'key-1'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'vm', 'exec', 'vm-1', '--timeout-ms', '2500', '--', 'echo hello'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'vm', 'ssh-info', 'vm-1'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'remotes', 'list'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'remotes', 'add', 'desk', '--route', 'host.example:22', '--tag', 'lab'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'remotes', 'remove', 'desk'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'app', 'focus-override', 'active'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'app', 'simulate-active'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'window', 'list'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'window', 'focus', '--window', 'window:1'], { cwd: process.cwd() })

    expect(seen).toEqual([
      expect.objectContaining({ method: 'auth.login' }),
      expect.objectContaining({ method: 'auth.status' }),
      expect.objectContaining({ method: 'auth.sign_in_url' }),
      expect.objectContaining({ method: 'auth.begin_sign_in', params: expect.objectContaining({ timeout_seconds: 2, timeoutSeconds: 2 }) }),
      expect.objectContaining({ method: 'auth.sign_out' }),
      expect.objectContaining({ method: 'settings.open', params: expect.objectContaining({ target: 'models', activate: true }) }),
      expect.objectContaining({ method: 'settings.get', params: expect.objectContaining({ path: 'terminal.fontSize' }) }),
      expect.objectContaining({ method: 'settings.put', params: expect.objectContaining({ path: 'terminal.fontSize', value: 14 }) }),
      expect.objectContaining({ method: 'feedback.open', params: expect.objectContaining({ activate: true }) }),
      expect.objectContaining({ method: 'feedback.submit', params: expect.objectContaining({ email: 'dev@example.test', body: 'hello', image_paths: ['/tmp/a.png'] }) }),
      expect.objectContaining({ method: 'extension.sidebar.snapshot', params: expect.objectContaining({ windowId: 'window:1' }) }),
      expect.objectContaining({ method: 'sidebar.custom.validate', params: expect.objectContaining({ name: 'ops' }) }),
      expect.objectContaining({ method: 'sidebar.custom.reload', params: expect.objectContaining({ name: 'ops' }) }),
      expect.objectContaining({ method: 'sidebar.custom.select', params: expect.objectContaining({ name: 'ops' }) }),
      expect.objectContaining({ method: 'system.ping' }),
      expect.objectContaining({ method: 'system.tree', params: expect.objectContaining({ workspaceId: 'main' }) }),
      expect.objectContaining({ method: 'system.top', params: expect.objectContaining({ includeProcesses: true, include_processes: true, topGroupLimit: 5, top_group_limit: 5 }) }),
      expect.objectContaining({ method: 'system.memory', params: expect.objectContaining({ includeProcesses: false, include_processes: false, topGroupLimit: 4, top_group_limit: 4 }) }),
      expect.objectContaining({ method: 'vm.list' }),
      expect.objectContaining({ method: 'vm.create', params: expect.objectContaining({ image: 'ubuntu', provider: 'test', idempotency_key: 'key-1' }) }),
      expect.objectContaining({ method: 'vm.exec', params: expect.objectContaining({ id: 'vm-1', command: 'echo hello', timeout_ms: 2500 }) }),
      expect.objectContaining({ method: 'vm.ssh_info', params: expect.objectContaining({ id: 'vm-1' }) }),
      expect.objectContaining({ method: 'remotes.list' }),
      expect.objectContaining({ method: 'remotes.add', params: expect.objectContaining({ name: 'desk', routes: ['host.example:22'], tag: 'lab' }) }),
      expect.objectContaining({ method: 'remotes.remove', params: expect.objectContaining({ target: 'desk' }) }),
      expect.objectContaining({ method: 'app.focus_override.set', params: expect.objectContaining({ state: 'active' }) }),
      expect.objectContaining({ method: 'app.simulate_active' }),
      expect.objectContaining({ method: 'window.list' }),
      expect.objectContaining({ method: 'window.focus', params: expect.objectContaining({ windowId: 'window:1' }) })
    ])
  })

  it('sends project, markdown, and file compatibility requests from the CLI helper', async () => {
    const seen: Record<string, unknown>[] = []
    const socketPath = await startControlServer((request) => {
      seen.push(request)
      return {
        id: request.id,
        ok: true,
        data:
          request.method === 'project.get_state' || String(request.method).startsWith('project.')
            ? {
                projectUrl: '/work/project',
                surfaceId: 'panel-project',
                activeTab: (request.params as any)?.tab || 'files',
                unsupported: true
              }
            : {
                opened: true,
                surfaceId: 'kb:commands/diagnose.md',
                relPath: 'commands/diagnose.md',
                surfaces: [{ panelId: 'kb:commands/diagnose.md', title: 'diagnose.md', knowledge: { relPath: 'commands/diagnose.md' } }]
              }
      }
    })

    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'project', 'open', '/work/project', '--surface', 'panel-1', '--no-focus'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'project', 'set-tab', 'targets', '--surface', 'panel-project'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'project', 'get-state', '--surface', 'panel-project'], { cwd: process.cwd() })
    const markdown = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'markdown', 'open', 'commands/diagnose.md', '--line', '2', '--end-line', '8'], {
      cwd: process.cwd()
    })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'file', 'open', 'commands/diagnose.md', 'Markdown语法指南.md', '--surface', 'panel-1'], {
      cwd: process.cwd()
    })

    expect(markdown.stdout).toContain('file\topened\tkb:commands/diagnose.md\tcommands/diagnose.md')
    expect(seen).toEqual([
      expect.objectContaining({ method: 'project.open', params: expect.objectContaining({ path: '/work/project', surfaceId: 'panel-1', focus: false }) }),
      expect.objectContaining({ method: 'project.set_tab', params: expect.objectContaining({ tab: 'targets', surfaceId: 'panel-project' }) }),
      expect.objectContaining({ method: 'project.get_state', params: expect.objectContaining({ surfaceId: 'panel-project' }) }),
      expect.objectContaining({ method: 'markdown.open', params: expect.objectContaining({ path: 'commands/diagnose.md', line: 2, startLine: 2, endLine: 8 }) }),
      expect.objectContaining({ method: 'file.open', params: expect.objectContaining({ paths: ['commands/diagnose.md', 'Markdown语法指南.md'], surfaceId: 'panel-1' }) })
    ])
  })

  it('sends terminal text and key input requests over the configured socket', async () => {
    const seen: Record<string, unknown>[] = []
    const socketPath = await startControlServer((request) => {
      seen.push(request)
      return {
        id: request.id,
        ok: true,
        data: {
          id: (request.params as any)?.sessionId || 'terminal-1',
          bytes: request.method === 'terminal.send_key' ? 1 : 4,
          key: request.method === 'terminal.send_key' ? (request.params as any)?.key : undefined
        }
      }
    })

    const sentText = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'terminal', 'send', '--session', 'terminal-1', '--text', 'pwd\\n'], {
      cwd: process.cwd()
    })
    expect(sentText.stdout).toContain('terminal-write\tterminal-1\tbytes=4')

    const sentKey = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'send-key-panel', '--panel', 'panel-1', 'ctrl+c'], {
      cwd: process.cwd()
    })
    expect(sentKey.stdout).toContain('terminal-write\tterminal-1\tbytes=1\tctrl+c')

    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'send-panel', '--panel', 'panel-1', 'echo hello\\n'], {
      cwd: process.cwd()
    })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'terminal', 'send-key', '--session', 'terminal-2', 'enter'], {
      cwd: process.cwd()
    })

    expect(seen).toEqual([
      expect.objectContaining({ method: 'terminal.send_text', params: expect.objectContaining({ sessionId: 'terminal-1', text: 'pwd\n' }) }),
      expect.objectContaining({ method: 'terminal.send_key', params: expect.objectContaining({ panelId: 'panel-1', surfaceId: 'panel-1', key: 'ctrl+c' }) }),
      expect.objectContaining({ method: 'terminal.send_text', params: expect.objectContaining({ panelId: 'panel-1', text: 'echo hello\n' }) }),
      expect.objectContaining({ method: 'terminal.send_key', params: expect.objectContaining({ sessionId: 'terminal-2', key: 'enter' }) })
    ])
  })

  it('captures and pipes terminal screen text from the CLI helper', async () => {
    const seen: Record<string, unknown>[] = []
    const socketPath = await startControlServer((request) => {
      seen.push(request)
      if (request.method === 'surface.clear_history') return { id: request.id, ok: true, data: { cleared: true, terminal: { panelId: (request.params as any)?.panelId } } }
      if (request.method === 'surface.respawn') {
        return {
          id: request.id,
          ok: true,
          data: {
            surface: { panelId: (request.params as any)?.panelId || 'panel-1' },
            terminal: { panelId: (request.params as any)?.panelId || 'panel-1', sessionId: 'terminal-1' },
            command: (request.params as any)?.command,
            decision: { status: 'allow' }
          }
        }
      }
      return {
        id: request.id,
        ok: true,
        data: {
          text: 'alpha\nbeta\n',
          tailLines: (request.params as any)?.tailLines || 2
        }
      }
    })

    const captured = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'capture-pane', '--panel', 'panel-1', '--lines', '2'], {
      cwd: process.cwd()
    })
    expect(captured.stdout).toBe('alpha\nbeta\n')

    const piped = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'pipe-pane', '--panel', 'panel-1', '--command', 'wc -l'], {
      cwd: process.cwd()
    })
    expect(piped.stdout.trim()).toBe('2')

    const cleared = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'clear-history', '--panel', 'panel-1'], {
      cwd: process.cwd()
    })
    expect(cleared.stdout).toContain('"cleared":true')

    const respawn = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'respawn-pane', '--panel', 'panel-1', '--command', 'exec bash -l'], {
      cwd: process.cwd()
    })
    expect(respawn.stdout).toContain('respawn\tallow\tpanel-1\tterminal-1\texec bash -l')

    expect(seen).toEqual([
      expect.objectContaining({ method: 'terminal.read_screen', params: expect.objectContaining({ panelId: 'panel-1', tailLines: 2, lines: 2 }) }),
      expect.objectContaining({ method: 'terminal.read_screen', params: expect.objectContaining({ panelId: 'panel-1', scrollback: true }) }),
      expect.objectContaining({ method: 'surface.clear_history', params: expect.objectContaining({ panelId: 'panel-1', surfaceId: 'panel-1' }) }),
      expect.objectContaining({ method: 'surface.respawn', params: expect.objectContaining({ panelId: 'panel-1', surfaceId: 'panel-1', command: 'exec bash -l' }) })
    ])
  })

  it('sends control_compat-style mobile terminal requests from the CLI helper', async () => {
    const seen: Record<string, unknown>[] = []
    const socketPath = await startControlServer((request) => {
      seen.push(request)
      const params = (request.params as any) || {}
      if (request.method === 'mobile.host.status') {
        return { id: request.id, ok: true, data: { app: 'aiopsterm', workspace_count: 1, terminal_count: 1, capabilities: ['terminal.input.v1'] } }
      }
      if (request.method === 'terminal.create') {
        return { id: request.id, ok: true, data: { createdPane: { panelId: 'panel-new', title: params.title || 'New' }, surface: { panelId: 'panel-new' }, action: 'surface.create' } }
      }
      return {
        id: request.id,
        ok: true,
        data: {
          workspace_id: 'main',
          surface_id: params.surface_id || params.surfaceId || 'panel-1',
          session_id: params.session_id || params.sessionId || 'terminal-1',
          queued: request.method === 'terminal.input' ? false : undefined,
          submitted: request.method === 'terminal.paste' ? params.submit_key !== 'none' : undefined,
          snapshot_format: request.method === 'terminal.replay' ? 'aiopsterm.text' : undefined,
          columns: request.method === 'terminal.replay' || request.method === 'terminal.viewport' ? 80 : undefined,
          rows: request.method === 'terminal.replay' || request.method === 'terminal.viewport' ? 24 : undefined
        }
      }
    })

    const status = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, '--json', 'mobile', 'host-status'], { cwd: process.cwd() })
    expect(JSON.parse(status.stdout)).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ terminal_count: 1 }) }))
    const created = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'terminal', 'create', '--title', 'Mobile Shell', '--cwd', '/tmp/mobile'], { cwd: process.cwd() })
    expect(created.stdout).toContain('created\tpanel-new\tMobile Shell')
    const input = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'terminal', 'input', '--surface', 'panel-1', '--text', 'pwd'], { cwd: process.cwd() })
    expect(input.stdout).toContain('terminal-mobile\tinput\tpanel-1\tterminal-1')
    const paste = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'terminal', 'paste', '--surface', 'panel-1', '--text', 'hello', '--submit-key', 'none'], { cwd: process.cwd() })
    expect(paste.stdout).toContain('terminal-mobile\tpaste\tpanel-1\tterminal-1')
    expect(paste.stdout).toContain('submitted=false')
    const replay = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'terminal', 'replay', '--surface', 'panel-1', '--lines', '5'], { cwd: process.cwd() })
    expect(replay.stdout).toContain('terminal-mobile\treplay\tpanel-1\tterminal-1\t80x24')
    const viewport = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'terminal', 'viewport', '--surface', 'panel-1', '--columns', '120', '--rows', '40'], { cwd: process.cwd() })
    expect(viewport.stdout).toContain('terminal-mobile\tviewport\tpanel-1\tterminal-1\t80x24')

    expect(seen).toEqual([
      expect.objectContaining({ method: 'mobile.host.status' }),
      expect.objectContaining({ method: 'terminal.create', params: expect.objectContaining({ title: 'Mobile Shell', cwd: '/tmp/mobile', focus: true }) }),
      expect.objectContaining({ method: 'terminal.input', params: expect.objectContaining({ surface_id: 'panel-1', text: 'pwd' }) }),
      expect.objectContaining({ method: 'terminal.paste', params: expect.objectContaining({ surface_id: 'panel-1', text: 'hello', submit_key: 'none' }) }),
      expect.objectContaining({ method: 'terminal.replay', params: expect.objectContaining({ surface_id: 'panel-1', tailLines: 5, lines: 5 }) }),
      expect.objectContaining({ method: 'terminal.viewport', params: expect.objectContaining({ surface_id: 'panel-1', viewport_columns: 120, viewport_rows: 40 }) })
    ])
  })

  it('sends control_compat-style mobile chat requests from the CLI helper', async () => {
    const seen: Record<string, unknown>[] = []
    const socketPath = await startControlServer((request) => {
      seen.push(request)
      const params = (request.params as any) || {}
      const session = {
        session_id: 'claude-mobile-cli-1',
        id: 'claude-mobile-cli-1',
        agent_kind: 'claude',
        source: 'claude-code',
        kind: 'agent',
        title: 'Deploy review',
        terminal_id: 'panel-ai',
        terminal_session_id: 'terminal-ai',
        workspace_id: 'main',
        cwd: '/work/project',
        state: { state: 'needs_input', since: '2024-06-01T00:00:00.000Z' },
        needs_input: true
      }
      if (request.method === 'mobile.chat.sessions') return { id: request.id, ok: true, data: { sessions: [session], count: 1, total: 1, needs_input_count: 1 } }
      if (request.method === 'mobile.chat.history') {
        return {
          id: request.id,
          ok: true,
          data: {
            source: 'managed-ai-events',
            messages: [{ id: 'event-1', seq: 0, role: 'agent', timestamp: '2024-06-01T00:00:00.000Z', kind: { type: 'permission_request', subject: 'Approve deploy command' } }],
            has_more: false
          }
        }
      }
      if (request.method === 'mobile.chat.send') return { id: request.id, ok: true, data: { sent: true, submitted: true, session_id: params.session_id } }
      if (request.method === 'mobile.chat.interrupt') return { id: request.id, ok: true, data: { interrupted: true, hard: params.hard === true, session_id: params.session_id } }
      if (request.method === 'mobile.chat.answer') return { id: request.id, ok: true, data: { answered: true, option_index: params.option_index, session_id: params.session_id } }
      if (request.method === 'chat.sessions.dump') return { id: request.id, ok: true, data: { sessions: [session], count: 1, needs_input_count: 1 } }
      return { id: request.id, ok: false, errorCode: 'UNKNOWN', errorMessage: String(request.method) }
    })

    const listed = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'mobile', 'chat', 'sessions', '--workspace', 'main'], { cwd: process.cwd() })
    expect(listed.stdout).toContain('mobile-chat-sessions\t1/1\tneeds_input=1')
    expect(listed.stdout).toContain('mobile-chat\t!\tclaude\tclaude-mobile-cli-1')
    const history = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'mobile', 'chat', 'history', '--session', 'claude-mobile-cli-1', '--limit', '5'], {
      cwd: process.cwd()
    })
    expect(history.stdout).toContain('mobile-chat-history\t1\thas_more=false')
    expect(history.stdout).toContain('permission_request\tApprove deploy command')
    const sent = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'mobile', 'chat', 'send', '--session', 'claude-mobile-cli-1', '--text', 'Ship it'], {
      cwd: process.cwd()
    })
    expect(sent.stdout).toContain('mobile-chat-send\tclaude-mobile-cli-1\tsubmitted')
    const interrupted = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'mobile', 'chat', 'interrupt', '--session', 'claude-mobile-cli-1', '--hard'], {
      cwd: process.cwd()
    })
    expect(interrupted.stdout).toContain('mobile-chat-interrupt\tclaude-mobile-cli-1\thard')
    const answered = await execFileAsync(
      process.execPath,
      ['resources/aiopsterm-control.js', '--socket', socketPath, 'mobile', 'chat', 'answer', '--session', 'claude-mobile-cli-1', '--option-index', '1'],
      { cwd: process.cwd() }
    )
    expect(answered.stdout).toContain('mobile-chat-answer\tclaude-mobile-cli-1\toption=1')
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'chat', 'sessions', 'dump'], { cwd: process.cwd() })

    expect(seen).toEqual([
      expect.objectContaining({ method: 'mobile.chat.sessions', params: expect.objectContaining({ workspace_id: 'main' }) }),
      expect.objectContaining({ method: 'mobile.chat.history', params: expect.objectContaining({ session_id: 'claude-mobile-cli-1', limit: 5 }) }),
      expect.objectContaining({ method: 'mobile.chat.send', params: expect.objectContaining({ session_id: 'claude-mobile-cli-1', text: 'Ship it' }) }),
      expect.objectContaining({ method: 'mobile.chat.interrupt', params: expect.objectContaining({ session_id: 'claude-mobile-cli-1', hard: true }) }),
      expect.objectContaining({ method: 'mobile.chat.answer', params: expect.objectContaining({ session_id: 'claude-mobile-cli-1', option_index: 1 }) }),
      expect.objectContaining({ method: 'chat.sessions.dump' })
    ])
  })

  it('sends control_compat-style mobile attach ticket requests from the CLI helper', async () => {
    const seen: Record<string, unknown>[] = []
    const socketPath = await startControlServer((request) => {
      seen.push(request)
      return {
        id: request.id,
        ok: true,
        data: {
          ticket: {
            version: 1,
            workspaceID: 'main',
            terminalID: 'panel-ai',
            macDeviceID: 'aiopsterm-test',
            routes: [{ id: 'local_control_socket', kind: 'websocket', endpoint: { type: 'url', url: 'aiopsterm-control://local' }, priority: 0 }],
            expiresAt: '2024-06-01T00:10:00.000Z',
            auth_token: 'secret-token'
          },
          attach_url: 'aiopsterm-control://attach?v=1',
          routes: [{ id: 'local_control_socket', kind: 'websocket', endpoint: { type: 'url', url: 'aiopsterm-control://local' }, local_socket_path: socketPath }],
          expires_at: '2024-06-01T00:10:00.000Z',
          ttl_seconds: 600,
          unsupported_remote: true,
          unsupported_reason: 'local only'
        }
      }
    })

    const result = await execFileAsync(
      process.execPath,
      ['resources/aiopsterm-control.js', '--socket', socketPath, 'mobile', 'attach-ticket', 'create', '--workspace', 'main', '--terminal', 'panel-ai', '--ttl-seconds', '120'],
      { cwd: process.cwd() }
    )
    expect(result.stdout).toContain('mobile-attach-ticket\tmain\t2024-06-01T00:10:00.000Z\tlocal-only')
    expect(result.stdout).toContain('mobile-route\tlocal_control_socket\twebsocket\turl\taiopsterm-control://local')
    expect(result.stdout).not.toContain('secret-token')
    expect(seen).toEqual([
      expect.objectContaining({
        method: 'mobile.attach_ticket.create',
        params: expect.objectContaining({ workspace_id: 'main', terminal_id: 'panel-ai', ttl_seconds: 120 })
      })
    ])
  })

  it('sends tmux-style buffer requests from the CLI helper', async () => {
    const seen: Record<string, unknown>[] = []
    const savePath = join(tmpdir(), `aiopsterm-buffer-${process.pid}-${Date.now()}.txt`)
    const socketPath = await startControlServer((request) => {
      seen.push(request)
      if (request.method === 'terminal.buffer.paste') {
        return {
          id: request.id,
          ok: true,
          data: {
            id: (request.params as any)?.sessionId || 'terminal-1',
            bytes: 33,
            buffer: { name: (request.params as any)?.name || 'default', size: 33 },
            bufferName: (request.params as any)?.name || 'default'
          }
        }
      }
      if (request.method === 'terminal.buffer.show' || request.method === 'terminal.buffer.save') {
        return {
          id: request.id,
          ok: true,
          data: {
            buffer: { name: (request.params as any)?.name || 'deploy', size: 33 },
            text: 'kubectl rollout status deploy/api\n',
            path: (request.params as any)?.path
          }
        }
      }
      return {
        id: request.id,
        ok: true,
        data: {
          buffer: { name: (request.params as any)?.name || 'deploy', size: ((request.params as any)?.text || '').length || 33 },
          buffers: [{ name: (request.params as any)?.name || 'deploy', size: ((request.params as any)?.text || '').length || 33 }],
          count: 1
        }
      }
    })

    const set = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'set-buffer', '--name', 'deploy', 'kubectl rollout status deploy/api\\n'], {
      cwd: process.cwd()
    })
    expect(set.stdout).toContain('buffer\tdeploy')

    const list = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'list-buffers'], {
      cwd: process.cwd()
    })
    expect(list.stdout).toContain('buffer\tdeploy')

    const shown = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'show-buffer', '-b', 'deploy'], {
      cwd: process.cwd()
    })
    expect(shown.stdout).toBe('kubectl rollout status deploy/api\n')

    const saved = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'save-buffer', '-b', 'deploy', savePath], {
      cwd: process.cwd()
    })
    expect(saved.stdout).toContain(`saved\t${savePath}`)
    await expect(readFile(savePath, 'utf-8')).resolves.toBe('kubectl rollout status deploy/api\n')
    await rm(savePath, { force: true })

    const paste = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'paste-buffer', '--name', 'deploy', '--panel', 'panel-1'], {
      cwd: process.cwd()
    })
    expect(paste.stdout).toContain('terminal-write\tterminal-1\tbytes=33')

    expect(seen).toEqual([
      expect.objectContaining({ method: 'terminal.buffer.set', params: expect.objectContaining({ name: 'deploy', text: 'kubectl rollout status deploy/api\\n' }) }),
      expect.objectContaining({ method: 'terminal.buffer.list' }),
      expect.objectContaining({ method: 'terminal.buffer.show', params: expect.objectContaining({ name: 'deploy' }) }),
      expect.objectContaining({ method: 'terminal.buffer.save', params: expect.objectContaining({ name: 'deploy', path: savePath }) }),
      expect.objectContaining({ method: 'terminal.buffer.paste', params: expect.objectContaining({ name: 'deploy', panelId: 'panel-1', surfaceId: 'panel-1' }) })
    ])
  })

  it('sends tmux-compatible hook and option requests from the CLI helper', async () => {
    const seen: Record<string, unknown>[] = []
    const socketPath = await startControlServer((request) => {
      seen.push(request)
      if (request.method === 'tmux.option.show') {
        return { id: request.id, ok: true, data: { option: { name: (request.params as any)?.option || 'extended-keys', value: 'on' }, valueOnly: (request.params as any)?.valueOnly } }
      }
      if (request.method === 'tmux.hook.list') {
        return { id: request.id, ok: true, data: { hooks: [{ event: 'after-split-window', command: 'display-message split' }], count: 1 } }
      }
      if (request.method === 'tmux.hook.unset') {
        return { id: request.id, ok: true, data: { hooks: [], count: 0, event: (request.params as any)?.event, removed: true } }
      }
      if (request.method === 'popup') {
        return {
          id: request.id,
          ok: false,
          errorCode: 'TMUX_COMPAT_UNSUPPORTED',
          errorMessage: 'popup is not supported yet in aiopsterm tmux compatibility mode.',
          data: { command: 'popup', unsupported: true, unsupportedReason: 'popup is a recognized tmux compatibility placeholder but is not supported yet.' }
        }
      }
      return {
        id: request.id,
        ok: true,
        data: {
          hook: { event: (request.params as any)?.event, command: (request.params as any)?.command },
          hooks: [{ event: (request.params as any)?.event, command: (request.params as any)?.command }],
          count: 1
        }
      }
    })

    const option = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'show-options', '-v', 'extended-keys'], { cwd: process.cwd() })
    expect(option.stdout).toBe('on\n')
    const hookSet = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'set-hook', 'after-split-window', 'display-message', 'split'], { cwd: process.cwd() })
    expect(hookSet.stdout).toContain('hook\tafter-split-window\tdisplay-message split')
    const hookList = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'set-hook', '--list'], { cwd: process.cwd() })
    expect(hookList.stdout).toContain('hook\tafter-split-window\tdisplay-message split')
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'set-hook', '--unset', 'after-split-window'], { cwd: process.cwd() })
    await expect(execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'popup'], { cwd: process.cwd() })).rejects.toMatchObject({
      stdout: expect.stringContaining('unsupported\tpopup')
    })

    expect(seen).toEqual([
      expect.objectContaining({ method: 'tmux.option.show', params: expect.objectContaining({ option: 'extended-keys', valueOnly: true }) }),
      expect.objectContaining({ method: 'tmux.hook.set', params: expect.objectContaining({ event: 'after-split-window', command: 'display-message split' }) }),
      expect.objectContaining({ method: 'tmux.hook.list' }),
      expect.objectContaining({ method: 'tmux.hook.unset', params: expect.objectContaining({ event: 'after-split-window', unset: true }) }),
      expect.objectContaining({ method: 'popup', params: expect.objectContaining({ command: 'popup' }) })
    ])
  })

  it('sends tmux-style pane layout requests from the CLI helper', async () => {
    const seen: Record<string, unknown>[] = []
    const socketPath = await startControlServer((request) => {
      seen.push(request)
      const params = (request.params as any) || {}
      return {
        id: request.id,
        ok: true,
        data: {
          pane: { panelId: params.paneId || params.panelId || 'panel-2', title: 'Pane 2', surfaceKind: 'terminal' },
          targetPane: params.targetPaneId ? { panelId: params.targetPaneId, title: 'Main', surfaceKind: 'terminal' } : undefined,
          changed: request.method !== 'pane.resize',
          unsupported: request.method === 'pane.resize',
          unsupportedReason: request.method === 'pane.resize' ? 'equal-size layout' : undefined,
          direction: params.direction
        }
      }
    })

    const joined = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'join-pane', '--pane', 'panel-2', '--target-pane', 'panel-1', '--direction', 'below', '--focus', 'true'], {
      cwd: process.cwd()
    })
    expect(joined.stdout).toContain('pane\tok\tpanel-2\tpanel-1\tbelow')

    const broken = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'break-pane', '--pane', 'panel-2', '--no-focus'], {
      cwd: process.cwd()
    })
    expect(broken.stdout).toContain('pane\tok\tpanel-2')

    const swapped = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'swap-pane', '--pane', 'panel-2', '--target-pane', 'panel-1'], {
      cwd: process.cwd()
    })
    expect(swapped.stdout).toContain('pane\tok\tpanel-2\tpanel-1')

    const resized = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'resize-pane', '--pane', 'panel-1', '-R', '--amount', '5'], {
      cwd: process.cwd()
    })
    expect(resized.stdout).toContain('pane\tunsupported\tpanel-1')

    expect(seen).toEqual([
      expect.objectContaining({ method: 'pane.join', params: expect.objectContaining({ paneId: 'panel-2', targetPaneId: 'panel-1', direction: 'below', focus: true }) }),
      expect.objectContaining({ method: 'pane.break', params: expect.objectContaining({ paneId: 'panel-2', focus: false }) }),
      expect.objectContaining({ method: 'pane.swap', params: expect.objectContaining({ paneId: 'panel-2', targetPaneId: 'panel-1', focus: false }) }),
      expect.objectContaining({ method: 'pane.resize', params: expect.objectContaining({ paneId: 'panel-1', direction: 'right', amount: 5 }) })
    ])
  })

  it('sends tmux-style pane navigation requests from the CLI helper', async () => {
    const seen: Record<string, unknown>[] = []
    const socketPath = await startControlServer((request) => {
      seen.push(request)
      if (request.method === 'workspace.find') {
        return {
          id: request.id,
          ok: true,
          data: {
            matches: [{ panelId: 'panel-2', title: 'Deploy', kind: 'terminal', active: false, reason: (request.params as any)?.content ? 'content' : 'title' }],
            count: 1,
            query: (request.params as any)?.query
          }
        }
      }
      return {
        id: request.id,
        ok: true,
        data: {
          selectedPane: { panelId: (request.params as any)?.paneId || (request.params as any)?.panelId || 'panel-2', title: 'Pane 2', surfaceKind: 'terminal' },
          activePanelId: (request.params as any)?.paneId || (request.params as any)?.panelId || 'panel-2',
          action: String(request.method)
        }
      }
    })

    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'next-window'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'previous-window'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'last-window'], { cwd: process.cwd() })

    const selected = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'select-pane', '--target', 'panel-3'], {
      cwd: process.cwd()
    })
    expect(selected.stdout).toContain('selected\tpanel-3')

    const found = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'find-window', '--content', '--select', 'deploy'], {
      cwd: process.cwd()
    })
    expect(found.stdout).toContain('panel-2\tterminal\tDeploy')

    expect(seen).toEqual([
      expect.objectContaining({ method: 'workspace.next' }),
      expect.objectContaining({ method: 'workspace.previous' }),
      expect.objectContaining({ method: 'workspace.last' }),
      expect.objectContaining({ method: 'pane.focus', params: expect.objectContaining({ paneId: 'panel-3' }) }),
      expect.objectContaining({ method: 'workspace.find', params: expect.objectContaining({ query: 'deploy', content: true, select: true }) })
    ])
  })

  it('sends tmux-style pane management requests from the CLI helper', async () => {
    const seen: Record<string, unknown>[] = []
    const socketPath = await startControlServer((request) => {
      seen.push(request)
      const params = (request.params as any) || {}
      if (request.method === 'workspace.list') {
        return { id: request.id, ok: true, data: { workspaces: [{ id: 'main', active: true, title: 'Main', mode: 'terminal', activeModule: 'workspace' }] } }
      }
      if (request.method === 'workspace.current') {
        return { id: request.id, ok: true, data: { workspace: { panelId: 'panel-1', title: 'Main', active: true }, activePanelId: 'panel-1' } }
      }
      if (request.method === 'pane.list') {
        return { id: request.id, ok: true, data: { panes: [{ panelId: 'panel-1', title: 'Main', surfaceKind: 'terminal', active: true }], count: 1 } }
      }
      if (request.method === 'workspace.has_session') {
        return { id: request.id, ok: true, data: { exists: true, target: params.panelId || 'panel-1' } }
      }
      if (request.method === 'workspace.select_layout') {
        return { id: request.id, ok: true, data: { layout: params.layout, applied: true } }
      }
      if (request.method === 'workspace.rename') {
        return { id: request.id, ok: true, data: { renamedPane: { panelId: params.panelId || 'panel-1', title: params.title }, action: 'rename-window' } }
      }
      if (request.method === 'workspace.env') {
        return { id: request.id, ok: true, data: { workspace_id: 'main', env: { SAFE_ENV: 'yes' }, count: 1, keys: ['SAFE_ENV'] } }
      }
      if (request.method === 'workspace.set_auto_title') {
        return { id: request.id, ok: true, data: { enabled: true, title: params.title, workspaceApplied: true, workspace_applied: true, panelId: params.panelId || 'panel-1', panel_id: params.panelId || 'panel-1' } }
      }
      if (request.method === 'workspace.close' || request.method === 'surface.close') {
        return { id: request.id, ok: true, data: { closedPane: { panelId: params.panelId || params.paneId || 'panel-1', title: 'Closed' }, action: request.method === 'workspace.close' ? 'kill-window' : 'kill-pane' } }
      }
      return { id: request.id, ok: true, data: { createdPane: { panelId: 'panel-new', title: params.title || 'New' }, action: request.method } }
    })

    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'list-windows'], { cwd: process.cwd() })
    const current = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'current-window'], { cwd: process.cwd() })
    expect(current.stdout).toContain('selected\tpanel-1')
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'list-panes'], { cwd: process.cwd() })
    const created = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'new-window', '--name', 'Scratch', '--no-focus', '--workspace-env', 'SAFE_ENV=yes'], { cwd: process.cwd() })
    expect(created.stdout).toContain('created\tpanel-new\tScratch')
    const env = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'workspace', 'env'], { cwd: process.cwd() })
    expect(env.stdout).toContain('workspace-env\tmain\t1')
    const autoTitle = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'workspace', 'set-auto-title', '--panel', 'panel-1', 'Generated Main'], { cwd: process.cwd() })
    expect(autoTitle.stdout).toContain('auto-title\tenabled\tapplied\tpanel-1\tGenerated Main')
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'split-window', '-h', '--target', 'panel-1'], { cwd: process.cwd() })
    const renamed = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'rename-window', '--target', 'panel-1', 'Main Ops'], { cwd: process.cwd() })
    expect(renamed.stdout).toContain('renamed\tpanel-1\tMain Ops')
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'kill-window', '--target', 'panel-1'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'kill-pane', '--target', 'panel-2'], { cwd: process.cwd() })
    const has = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'has-session', '--target', 'panel-1'], { cwd: process.cwd() })
    expect(has.stdout).toContain('session\texists\tpanel-1')
    const layout = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'select-layout', 'main-vertical'], { cwd: process.cwd() })
    expect(layout.stdout).toContain('layout\tmain-vertical\tapplied')

    expect(seen).toEqual([
      expect.objectContaining({ method: 'workspace.list' }),
      expect.objectContaining({ method: 'workspace.current' }),
      expect.objectContaining({ method: 'pane.list' }),
      expect.objectContaining({ method: 'workspace.create', params: expect.objectContaining({ title: 'Scratch', focus: false, workspace_env: { SAFE_ENV: 'yes' } }) }),
      expect.objectContaining({ method: 'workspace.env', params: expect.objectContaining({ workspaceId: 'main' }) }),
      expect.objectContaining({ method: 'workspace.set_auto_title', params: expect.objectContaining({ panelId: 'panel-1', title: 'Generated Main' }) }),
      expect.objectContaining({ method: 'surface.split', params: expect.objectContaining({ targetPaneId: 'panel-1', direction: 'right' }) }),
      expect.objectContaining({ method: 'workspace.rename', params: expect.objectContaining({ panelId: 'panel-1', title: 'Main Ops' }) }),
      expect.objectContaining({ method: 'workspace.close', params: expect.objectContaining({ panelId: 'panel-1' }) }),
      expect.objectContaining({ method: 'surface.close', params: expect.objectContaining({ paneId: 'panel-2' }) }),
      expect.objectContaining({ method: 'workspace.has_session', params: expect.objectContaining({ panelId: 'panel-1' }) }),
      expect.objectContaining({ method: 'workspace.select_layout', params: expect.objectContaining({ layout: 'main-vertical' }) })
    ])
  })

  it('sends control_compat-style surface and workspace aliases from the CLI helper', async () => {
    const seen: Record<string, unknown>[] = []
    const socketPath = await startControlServer((request) => {
      seen.push(request)
      const params = (request.params as any) || {}
      if (request.method === 'workspace.current') {
        return { id: request.id, ok: true, data: { workspace: { panelId: 'panel-1', title: 'Main', active: true }, activePanelId: 'panel-1' } }
      }
      if (request.method === 'workspace.select') {
        return { id: request.id, ok: true, data: { selectedPane: { panelId: params.panelId || 'panel-1', title: 'Main', active: true }, activePanelId: params.panelId || 'panel-1', action: 'select-workspace' } }
      }
      if (request.method === 'surface.list') {
        return { id: request.id, ok: true, data: { surfaces: [{ panelId: 'panel-1', title: 'Main', surfaceKind: 'terminal', active: true, connected: true }], count: 1 } }
      }
      if (request.method === 'pane.surfaces') {
        return { id: request.id, ok: true, data: { paneId: params.paneId || 'panel-1', surfaces: [{ panelId: params.paneId || 'panel-1', title: 'Main', surfaceKind: 'terminal', selected: true }], count: 1 } }
      }
      if (request.method === 'workspace.close' || request.method === 'surface.close') {
        return { id: request.id, ok: true, data: { closedPane: { panelId: params.panelId || params.paneId || 'panel-1', title: 'Closed' }, action: request.method } }
      }
      return { id: request.id, ok: true, data: { createdPane: { panelId: 'panel-new', title: params.title || 'New' }, action: request.method } }
    })

    const createdWorkspace = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'new-workspace', '--name', 'Scratch', '--cwd', '/tmp/scratch', '--no-focus'], { cwd: process.cwd() })
    expect(createdWorkspace.stdout).toContain('created\tpanel-new\tScratch')
    const currentWorkspace = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'current-workspace'], { cwd: process.cwd() })
    expect(currentWorkspace.stdout).toContain('selected\tpanel-1')
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'select-workspace', '--workspace', 'panel-2'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'close-workspace', '--workspace', 'panel-2'], { cwd: process.cwd() })
    const panels = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'list-panels'], { cwd: process.cwd() })
    expect(panels.stdout).toContain('panel-1\tterminal\tconnected')
    const paneSurfaces = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'list-pane-surfaces', '--pane', 'panel-1'], { cwd: process.cwd() })
    expect(paneSurfaces.stdout).toContain('panel-1\tterminal')
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'close-surface', '--surface', 'panel-1'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'new-split', 'below', '--surface', 'panel-1', '--focus', 'true'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'new-pane', '--direction', 'right'], { cwd: process.cwd() })

    expect(seen).toEqual([
      expect.objectContaining({ method: 'workspace.create', params: expect.objectContaining({ title: 'Scratch', cwd: '/tmp/scratch', focus: false }) }),
      expect.objectContaining({ method: 'workspace.current' }),
      expect.objectContaining({ method: 'workspace.select', params: expect.objectContaining({ workspaceId: 'panel-2', panelId: 'panel-2' }) }),
      expect.objectContaining({ method: 'workspace.close', params: expect.objectContaining({ workspaceId: 'panel-2', panelId: 'panel-2' }) }),
      expect.objectContaining({ method: 'surface.list' }),
      expect.objectContaining({ method: 'pane.surfaces', params: expect.objectContaining({ paneId: 'panel-1' }) }),
      expect.objectContaining({ method: 'surface.close', params: expect.objectContaining({ paneId: 'panel-1', surfaceId: 'panel-1' }) }),
      expect.objectContaining({ method: 'surface.split', params: expect.objectContaining({ surfaceId: 'panel-1', targetPaneId: 'panel-1', direction: 'below', focus: true }) }),
      expect.objectContaining({ method: 'surface.split', params: expect.objectContaining({ direction: 'right', focus: false }) })
    ])
  })

  it('sends control_compat-style surface operation requests from the CLI helper', async () => {
    const seen: Record<string, unknown>[] = []
    const socketPath = await startControlServer((request) => {
      seen.push(request)
      const params = (request.params as any) || {}
      if (request.method === 'surface.health') {
        return { id: request.id, ok: true, data: { surfaces: [{ panelId: 'panel-1', title: 'Main', surfaceKind: 'terminal', mounted: true }], count: 1 } }
      }
      if (request.method === 'workspace.move_to_window') {
        return { id: request.id, ok: true, data: { unsupported: true, unsupportedReason: 'single window', workspaceId: params.workspaceId, windowId: params.windowId } }
      }
      return {
        id: request.id,
        ok: true,
        data: {
          surface: { panelId: params.surfaceId || params.panelId || params.workspaceId || 'panel-1', title: 'Main', surfaceKind: 'terminal' },
          movedSurface: { panelId: params.surfaceId || params.panelId || params.workspaceId || 'panel-1', title: 'Main', surfaceKind: 'terminal' },
          action: request.method,
          changed: true,
          toIndex: params.index ?? 0
        }
      }
    })

    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'move-surface', '--surface', 'panel-2', '--pane', 'panel-1', '--focus', 'true'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'reorder-surface', '--surface', 'panel-2', '--before', 'panel-1'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'split-off', '--surface', 'panel-2', 'below'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'drag-surface-to-split', '--surface', 'panel-3', 'right'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'refresh-surfaces'], { cwd: process.cwd() })
    const health = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'surface-health'], { cwd: process.cwd() })
    expect(health.stdout).toContain('panel-1\tterminal')
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'trigger-flash', '--surface', 'panel-1'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'reorder-workspace', '--workspace', 'panel-2', '--index', '0', '--dry-run'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'reorder-workspaces', '--order', 'panel-2,panel-1'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'move-workspace-to-window', '--workspace', 'panel-2', '--window', 'window-1'], { cwd: process.cwd() })

    expect(seen).toEqual([
      expect.objectContaining({ method: 'surface.move', params: expect.objectContaining({ surfaceId: 'panel-2', paneId: 'panel-1', focus: true }) }),
      expect.objectContaining({ method: 'surface.reorder', params: expect.objectContaining({ surfaceId: 'panel-2', beforeSurfaceId: 'panel-1' }) }),
      expect.objectContaining({ method: 'surface.split_off', params: expect.objectContaining({ surfaceId: 'panel-2', direction: 'below' }) }),
      expect.objectContaining({ method: 'surface.drag_to_split', params: expect.objectContaining({ surfaceId: 'panel-3', direction: 'right' }) }),
      expect.objectContaining({ method: 'surface.refresh' }),
      expect.objectContaining({ method: 'surface.health' }),
      expect.objectContaining({ method: 'surface.trigger_flash', params: expect.objectContaining({ surfaceId: 'panel-1' }) }),
      expect.objectContaining({ method: 'workspace.reorder', params: expect.objectContaining({ workspaceId: 'panel-2', index: 0, dryRun: true }) }),
      expect.objectContaining({ method: 'workspace.reorder_many', params: expect.objectContaining({ order: 'panel-2,panel-1', workspaceIds: ['panel-2', 'panel-1'] }) }),
      expect.objectContaining({ method: 'workspace.move_to_window', params: expect.objectContaining({ workspaceId: 'panel-2', windowId: 'window-1' }) })
    ])
  })

  it('sends wait-for synchronization requests over the configured socket', async () => {
    const seen: Record<string, unknown>[] = []
    const socketPath = await startControlServer((request) => {
      seen.push(request)
      return {
        id: request.id,
        ok: true,
        data: {
          name: (request.params as any)?.name,
          status: 'signaled',
          waitedMs: 0,
          waiterCount: (request.params as any)?.signal ? 1 : 0
        }
      }
    })

    const result = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'wait-for', '--signal', 'build-ready', '--timeout', '2'], {
      cwd: process.cwd()
    })
    expect(result.stdout).toContain('wait-for\tsignaled\tbuild-ready\twaited=0')
    expect(seen).toEqual([
      expect.objectContaining({
        method: 'sync.wait_for',
        params: expect.objectContaining({ name: 'build-ready', signal: true, timeout: 2, timeoutMs: 2000 })
      })
    ])
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

  it('prints the current automation context over the configured socket', async () => {
    const seen: Record<string, unknown>[] = []
    const socketPath = await startControlServer((request) => {
      seen.push(request)
      return {
        id: request.id,
        ok: true,
        data: {
          activeSurface: { panelId: 'panel-1', kind: 'terminal', connected: true, title: 'Local API' },
          activeTerminal: { panelId: 'panel-1', sessionId: 'terminal-1', kind: 'local', cwd: '/work/api', title: 'Local API' },
          writableTerminals: [{ panelId: 'panel-1', sessionId: 'terminal-1', kind: 'local', connected: true }],
          pendingAiSessions: [
            {
              source: 'claude-code',
              sessionId: 'claude-approval-1',
              id: 'claude-approval-1',
              title: 'Deploy approval',
              summary: 'Approve rollout',
              state: 'needsInput',
              needsInput: true,
              requestKind: 'permission',
              decisionMode: 'blocking',
              panelId: 'panel-1'
            }
          ],
          unreadNotifications: [{ id: 'notify-1', source: 'ci', level: 'success', title: 'Deploy done' }],
          counts: { writableTerminals: 1, pendingAiSessions: 1, unreadNotifications: 1 },
          suggestions: [{ label: 'Read active terminal screen', command: 'aio terminal read-screen --panel panel-1 --lines 80' }]
        }
      }
    })

    const result = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'context'], {
      cwd: process.cwd()
    })
    expect(result.stdout).toContain('context\tactive=panel-1\tterminal=terminal-1\twritable=1\tpending_ai=1\tunread=1')
    expect(result.stdout).toContain('active-terminal\tpanel-1\tterminal-1\tlocal\t/work/api\tLocal API')
    expect(result.stdout).toContain('pending-ai\t!\tclaude-code\tclaude-approval-1\tneedsInput\tpermission\tpanel-1\tDeploy approval')
    expect(result.stdout).toContain('suggest\tRead active terminal screen\taio terminal read-screen --panel panel-1 --lines 80')
    expect(seen).toEqual([expect.objectContaining({ method: 'workspace.context' })])
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

  it('sends workspace remote and remote tmux compatibility requests from the CLI helper', async () => {
    const seen: Record<string, unknown>[] = []
    const socketPath = await startControlServer((request) => {
      seen.push(request)
      const params = (request.params as any) || {}
      return {
        id: request.id,
        ok: true,
        data: {
          method: request.method,
          params,
          configured: request.method === 'workspace.remote.configure',
          reconnected: request.method === 'workspace.remote.reconnect',
          disconnected: request.method === 'workspace.remote.disconnect',
          unsupported: String(request.method || '').startsWith('remote.tmux.'),
          unsupportedReason: String(request.method || '').startsWith('remote.tmux.') ? 'unsupported compatibility path' : undefined,
          remote: {
            configured: true,
            state: 'disconnected',
            connection_state: 'disconnected',
            remote_display_target: 'root@example.com:2222',
            destination: params.destination || params.host || 'example.com'
          },
          sessions: request.method === 'workspace.remote.pty_sessions' ? [{ surface_id: 'panel-remote', connected: false }] : undefined
        }
      }
    })

    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'workspace', 'remote', 'status'], { cwd: process.cwd() })
    await execFileAsync(
      process.execPath,
      ['resources/aiopsterm-control.js', '--socket', socketPath, 'workspace', 'remote', 'configure', 'root@example.com', '--port', '2222', '--title', 'Example Remote', '--connect'],
      { cwd: process.cwd() }
    )
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'workspace', 'remote', 'reconnect', '--surface', 'panel-remote'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'workspace', 'remote', 'disconnect', '--surface', 'panel-remote', '--clear'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'workspace', 'remote', 'pty-sessions', '--all-workspaces'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'workspace', 'remote', 'pty-bridge', 'ssh-1', '--attachment', 'attach-1', '--require-existing'], {
      cwd: process.cwd()
    })
    await execFileAsync(
      process.execPath,
      ['resources/aiopsterm-control.js', '--socket', socketPath, 'workspace', 'remote', 'pty-resize', 'ssh-1', '--attachment', 'attach-1', '--token', 'token-1', '--cols', '100', '--rows', '40'],
      { cwd: process.cwd() }
    )
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'remote', 'tmux', 'sessions', '--host', 'example.com', '--port', '2222', '--identity-file', '/tmp/id_rsa'], {
      cwd: process.cwd()
    })

    expect(seen).toEqual([
      expect.objectContaining({ method: 'workspace.remote.status', params: expect.objectContaining({ workspaceId: 'main' }) }),
      expect.objectContaining({
        method: 'workspace.remote.configure',
        params: expect.objectContaining({ destination: 'root@example.com', host: 'root@example.com', port: 2222, title: 'Example Remote', autoConnect: true, auto_connect: true })
      }),
      expect.objectContaining({ method: 'workspace.remote.reconnect', params: expect.objectContaining({ surfaceId: 'panel-remote', surface_id: 'panel-remote' }) }),
      expect.objectContaining({ method: 'workspace.remote.disconnect', params: expect.objectContaining({ surfaceId: 'panel-remote', clear: true, clear_configuration: true }) }),
      expect.objectContaining({ method: 'workspace.remote.pty_sessions', params: expect.objectContaining({ allWorkspaces: true, all_workspaces: true }) }),
      expect.objectContaining({ method: 'workspace.remote.pty_bridge', params: expect.objectContaining({ session_id: 'ssh-1', attachment_id: 'attach-1', require_existing: true }) }),
      expect.objectContaining({ method: 'workspace.remote.pty_resize', params: expect.objectContaining({ session_id: 'ssh-1', attachment_id: 'attach-1', attachment_token: 'token-1', cols: 100, rows: 40 }) }),
      expect.objectContaining({ method: 'remote.tmux.sessions', params: expect.objectContaining({ host: 'example.com', destination: 'example.com', port: 2222, identity_file: '/tmp/id_rsa' }) })
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

  it('sends control_compat-style surface telemetry and create/focus requests from the CLI helper', async () => {
    const seen: Record<string, unknown>[] = []
    const socketPath = await startControlServer((request) => {
      seen.push(request)
      const params = (request.params as any) || {}
      if (request.method === 'surface.focus') {
        return { id: request.id, ok: true, data: { surface: { panelId: params.surfaceId || 'panel-1', surfaceKind: 'terminal' }, selectedPane: { panelId: params.surfaceId || 'panel-1', surfaceKind: 'terminal' }, action: 'surface.focus' } }
      }
      if (request.method === 'surface.create') {
        return { id: request.id, ok: true, data: { createdPane: { panelId: 'panel-new', title: params.title || 'New', surfaceKind: 'terminal' }, surface: { panelId: 'panel-new', surfaceKind: 'terminal' }, action: 'surface.create' } }
      }
      if (request.method === 'pane.create') {
        return { id: request.id, ok: true, data: { createdPane: { panelId: 'panel-split', title: params.title || 'Split', surfaceKind: 'terminal' }, pane: { panelId: 'panel-split', surfaceKind: 'terminal' }, action: 'pane.create' } }
      }
      return {
        id: request.id,
        ok: true,
        data: {
          surface: { panelId: params.surfaceId || 'panel-1', title: 'Main', surfaceKind: 'terminal' },
          action: request.method,
          ttyName: params.ttyName,
          state: params.state,
          reason: params.reason || 'command',
          published: request.method === 'surface.report_shell_state',
          kicked: request.method === 'surface.ports_kick'
        }
      }
    })

    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'surface', 'focus', '--surface', 'panel-1'], { cwd: process.cwd() })
    const created = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'surface', 'create', '--title', 'Scratch', '--cwd', '/tmp/scratch', '--focus', 'true'], { cwd: process.cwd() })
    expect(created.stdout).toContain('created\tpanel-new\tScratch')
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'pane', 'create', '--surface', 'panel-1', '--direction', 'below', '--title', 'Split'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'surface', 'report-tty', '--surface', 'panel-1', '/dev/pts/7'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'surface', 'report-shell-state', '--surface', 'panel-1', 'prompt'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'surface', 'ports-kick', '--surface', 'panel-1', '--reason', 'refresh'], { cwd: process.cwd() })

    expect(seen).toEqual([
      expect.objectContaining({ method: 'surface.focus', params: expect.objectContaining({ surfaceId: 'panel-1' }) }),
      expect.objectContaining({ method: 'surface.create', params: expect.objectContaining({ title: 'Scratch', cwd: '/tmp/scratch', focus: true }) }),
      expect.objectContaining({ method: 'pane.create', params: expect.objectContaining({ surfaceId: 'panel-1', direction: 'below', title: 'Split' }) }),
      expect.objectContaining({ method: 'surface.report_tty', params: expect.objectContaining({ surfaceId: 'panel-1', ttyName: '/dev/pts/7' }) }),
      expect.objectContaining({ method: 'surface.report_shell_state', params: expect.objectContaining({ surfaceId: 'panel-1', state: 'prompt' }) }),
      expect.objectContaining({ method: 'surface.ports_kick', params: expect.objectContaining({ surfaceId: 'panel-1', reason: 'refresh' }) })
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

    const result = await execFileAsync(
      process.execPath,
      [
        'resources/aiopsterm-control.js',
        '--socket',
        socketPath,
        '--json',
        'notify',
        '--title',
        'Done',
        '--body',
        'All green',
        '--source',
        'ci',
        '--level',
        'success',
        '--group',
        'build',
        '--key',
        'main',
        '--url',
        'https://example.test/build'
      ],
      {
        cwd: process.cwd()
      }
    )
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'list-notifications', '--source', 'ci', '--level', 'success', '--group', 'build', '--query', 'main', '--limit', '5'], {
      cwd: process.cwd()
    })
    expect(JSON.parse(result.stdout)).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ notification: expect.objectContaining({ title: 'Done' }) }) }))
    expect(seen).toEqual([
      expect.objectContaining({
        method: 'notification.create',
        params: expect.objectContaining({ title: 'Done', body: 'All green', source: 'ci', level: 'success', group: 'build', key: 'main', url: 'https://example.test/build' })
      }),
      expect.objectContaining({ method: 'notification.list', params: expect.objectContaining({ source: 'ci', level: 'success', group: 'build', query: 'main', limit: 5 }) })
    ])
  })

  it('sends targeted notification requests over the configured socket', async () => {
    const seen: Record<string, unknown>[] = []
    const socketPath = await startControlServer((request) => {
      seen.push(request)
      const params = (request.params as any) || {}
      return {
        id: request.id,
        ok: true,
        data: {
          notification: {
            id: 'notification-1',
            title: params.title,
            panelId: params.surfaceId || params.panelId,
            workspaceId: params.workspaceId || 'main',
            read: false
          },
          targeted: true
        }
      }
    })

    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'notify-surface', '--surface', 'panel-1', '--title', 'Needs review'], {
      cwd: process.cwd()
    })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'notify-caller', '--panel', 'panel-3', '--title', 'Caller'], {
      cwd: process.cwd()
    })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'notify-target', '--workspace', 'main', '--surface', 'panel-2', '--title', 'Done'], {
      cwd: process.cwd()
    })

    expect(seen).toEqual([
      expect.objectContaining({ method: 'notification.create_for_surface', params: expect.objectContaining({ surfaceId: 'panel-1', surface_id: 'panel-1', title: 'Needs review' }) }),
      expect.objectContaining({ method: 'notification.create_for_caller', params: expect.objectContaining({ caller: expect.objectContaining({ panelId: 'panel-3', surfaceId: 'panel-3' }), title: 'Caller' }) }),
      expect.objectContaining({ method: 'notification.create_for_target', params: expect.objectContaining({ workspaceId: 'main', surfaceId: 'panel-2', title: 'Done' }) })
    ])
  })

  it('prints or sends display-message through the notification bridge', async () => {
    const printed = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', 'display-message', '--print', 'hello', 'operator'], {
      cwd: process.cwd()
    })
    expect(printed.stdout).toBe('hello operator\n')

    const seen: Record<string, unknown>[] = []
    const socketPath = await startControlServer((request) => {
      seen.push(request)
      return {
        id: request.id,
        ok: true,
        data: { notification: { id: 'notification-1', title: 'aiopsterm', body: (request.params as any)?.body, read: false } }
      }
    })

    const displayed = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'display-message', 'deploy', 'done'], {
      cwd: process.cwd()
    })
    expect(displayed.stdout).toBe('deploy done\n')
    expect(seen).toEqual([
      expect.objectContaining({ method: 'notification.create', params: expect.objectContaining({ title: 'aiopsterm', body: 'deploy done' }) })
    ])
  })

  it('sends sidebar-style status, progress, and log metadata requests', async () => {
    const seen: Record<string, unknown>[] = []
    const socketPath = await startControlServer((request) => {
      seen.push(request)
      const method = String(request.method || '')
      const workspaceId = (request.params as any)?.workspaceId || 'main'
      return {
        id: request.id,
        ok: true,
        data: {
          statuses:
            method === 'sidebar.status.clear'
              ? []
              : [{ workspaceId, key: (request.params as any)?.key || 'build', value: (request.params as any)?.value || 'compiling', priority: (request.params as any)?.priority || 0 }],
          progress: method === 'sidebar.progress.clear' ? null : method === 'sidebar.progress.set' ? { workspaceId, value: (request.params as any)?.value, label: (request.params as any)?.label } : null,
          logs: method === 'sidebar.log.append' ? [{ workspaceId, level: (request.params as any)?.level || 'info', source: (request.params as any)?.source, message: (request.params as any)?.message }] : [],
          removed: method.includes('clear'),
          changed: method === 'sidebar.log.clear' ? 1 : undefined
        }
      }
    })

    const status = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'set-status', 'build', 'compiling', '--priority', '80'], {
      cwd: process.cwd()
    })
    expect(status.stdout).toContain('status\tmain\tbuild\tcompiling')

    const progress = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'set-progress', '0.5', '--label', 'Building'], {
      cwd: process.cwd()
    })
    expect(progress.stdout).toContain('progress\tmain\t0.5\tBuilding')

    const log = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'log', '--level', 'success', '--source', 'test', 'All green'], {
      cwd: process.cwd()
    })
    expect(log.stdout).toContain('log\tmain\tsuccess\ttest\tAll green')

    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'list-status'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'list-log', '--limit', '5'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'sidebar-state'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'clear-status', 'build'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'clear-progress'], { cwd: process.cwd() })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'clear-log'], { cwd: process.cwd() })

    expect(seen).toEqual([
      expect.objectContaining({ method: 'sidebar.status.set', params: expect.objectContaining({ key: 'build', value: 'compiling', priority: 80 }) }),
      expect.objectContaining({ method: 'sidebar.progress.set', params: expect.objectContaining({ value: 0.5, label: 'Building' }) }),
      expect.objectContaining({ method: 'sidebar.log.append', params: expect.objectContaining({ level: 'success', source: 'test', message: 'All green' }) }),
      expect.objectContaining({ method: 'sidebar.status.list' }),
      expect.objectContaining({ method: 'sidebar.log.list', params: expect.objectContaining({ limit: 5 }) }),
      expect.objectContaining({ method: 'sidebar.state' }),
      expect.objectContaining({ method: 'sidebar.status.clear', params: expect.objectContaining({ key: 'build' }) }),
      expect.objectContaining({ method: 'sidebar.progress.clear' }),
      expect.objectContaining({ method: 'sidebar.log.clear' })
    ])
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

  it('sends feed and bulk managed AI session requests over the configured socket', async () => {
    const seen: Record<string, unknown>[] = []
    const socketPath = await startControlServer((request) => {
      seen.push(request)
      if (request.method === 'feed.jump') {
        return {
          id: request.id,
          ok: true,
          data: {
            workstream_id: (request.params as any)?.workstream_id,
            matched: true,
            panelId: 'panel-ai',
            session: {
              source: 'claude-code',
              sessionId: 'claude-feed-1',
              id: 'claude-feed-1',
              title: 'Deploy review',
              summary: 'Approve deploy command',
              state: 'needsInput',
              needsInput: true,
              requestKind: 'permission',
              panelId: 'panel-ai'
            }
          }
        }
      }
      if (request.method === 'feed.push') {
        return {
          id: request.id,
          ok: true,
          data: {
            status: 'acknowledged',
            waited: false,
            session_id: (request.params as any)?.sessionId,
            request_id: (request.params as any)?.requestId,
            workstream_id: (request.params as any)?.sessionId,
            session: {
              source: (request.params as any)?.source,
              sessionId: (request.params as any)?.sessionId,
              id: (request.params as any)?.sessionId,
              title: 'Deploy review',
              summary: (request.params as any)?.summary,
              state: 'needsInput',
              needsInput: true,
              requestKind: 'permission',
              panelId: 'panel-ai'
            }
          }
        }
      }
      if (request.method === 'feed.permission.reply' || request.method === 'feed.question.reply' || request.method === 'feed.exit_plan.reply') {
        return {
          id: request.id,
          ok: true,
          data: {
            delivered: true,
            request_id: (request.params as any)?.request_id,
            kind: request.method === 'feed.permission.reply' ? 'deny' : request.method === 'feed.question.reply' ? 'reply' : 'bypass',
            mode: (request.params as any)?.mode || 'reply',
            session: {
              source: 'claude-code',
              sessionId: 'claude-feed-1',
              id: 'claude-feed-1',
              title: 'Deploy review',
              summary: 'Approve deploy command',
              state: 'idle',
              needsInput: false,
              requestKind: 'permission',
              panelId: 'panel-ai',
              eventCount: 1,
              decisionCount: 1
            },
            count: 1,
            needsInputCount: 0
          }
        }
      }
      return {
        id: request.id,
        ok: true,
        data: {
          operation: request.method === 'feed.list' ? undefined : (request.params as any)?.operation || 'mark-handled',
          changed: request.method === 'feed.list' ? undefined : 1,
          sessions: [
            {
              source: 'claude-code',
              sessionId: 'claude-feed-1',
              id: 'claude-feed-1',
              title: 'Deploy review',
              summary: 'Approve deploy command',
              state: request.method === 'feed.list' ? 'needsInput' : 'idle',
              needsInput: request.method === 'feed.list',
              requestKind: 'permission',
              eventCount: 1,
              decisionCount: request.method === 'feed.list' ? 0 : 1
            }
          ],
          count: 1,
          needsInputCount: request.method === 'feed.list' ? 1 : 0
        }
      }
    })

    const listed = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'feed', 'list'], {
      cwd: process.cwd()
    })
    expect(listed.stdout).toContain('agent-sessions\t1/1\tneeds_input=1')

    const handled = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'feed', 'mark-handled'], {
      cwd: process.cwd()
    })
    expect(handled.stdout).toContain('agent-session-bulk\tmark-handled\tchanged=1')

    const jumped = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'feed', 'jump', 'permission-request-1'], {
      cwd: process.cwd()
    })
    expect(jumped.stdout).toContain('feed-jump\tmatched\tpermission-request-1\tpanel-ai')

    const pushed = await execFileAsync(
      process.execPath,
      [
        'resources/aiopsterm-control.js',
        '--socket',
        socketPath,
        'feed',
        'push',
        '--source',
        'claude-code',
        '--session',
        'claude-feed-1',
        '--request',
        'permission-request-1',
        '--event',
        'PermissionRequest',
        '--summary',
        'Approve deploy command'
      ],
      { cwd: process.cwd() }
    )
    expect(pushed.stdout).toContain('feed-push\tacknowledged\tclaude-feed-1\tpermission-request-1\tnonblocking')

    const permissionReply = await execFileAsync(
      process.execPath,
      ['resources/aiopsterm-control.js', '--socket', socketPath, 'feed', 'permission-reply', 'permission-request-1', '--mode', 'deny', '--message', 'Use staging first'],
      { cwd: process.cwd() }
    )
    expect(permissionReply.stdout).toContain('feed-reply\tdeny\tdeny\tpermission-request-1')

    const questionReply = await execFileAsync(
      process.execPath,
      ['resources/aiopsterm-control.js', '--socket', socketPath, 'feed', 'question-reply', 'question-request-1', '--selection', 'staging'],
      { cwd: process.cwd() }
    )
    expect(questionReply.stdout).toContain('feed-reply\treply\treply\tquestion-request-1')

    const planReply = await execFileAsync(
      process.execPath,
      ['resources/aiopsterm-control.js', '--socket', socketPath, 'feed', 'exit-plan-reply', 'plan-request-1', '--mode', 'bypassPermissions'],
      { cwd: process.cwd() }
    )
    expect(planReply.stdout).toContain('feed-reply\tbypass\tbypassPermissions\tplan-request-1')

    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'agent', 'session', 'clear-ended'], {
      cwd: process.cwd()
    })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'feed', 'clear', '--yes'], {
      cwd: process.cwd()
    })

    expect(seen).toEqual([
      expect.objectContaining({ method: 'feed.list', params: expect.objectContaining({ needsInput: true }) }),
      expect.objectContaining({ method: 'feed.mark-handled' }),
      expect.objectContaining({ method: 'feed.jump', params: expect.objectContaining({ workstream_id: 'permission-request-1' }) }),
      expect.objectContaining({
        method: 'feed.push',
        params: expect.objectContaining({ source: 'claude-code', sessionId: 'claude-feed-1', requestId: 'permission-request-1', event: 'PermissionRequest' })
      }),
      expect.objectContaining({ method: 'feed.permission.reply', params: expect.objectContaining({ request_id: 'permission-request-1', mode: 'deny', message: 'Use staging first' }) }),
      expect.objectContaining({ method: 'feed.question.reply', params: expect.objectContaining({ request_id: 'question-request-1', selections: ['staging'] }) }),
      expect.objectContaining({ method: 'feed.exit_plan.reply', params: expect.objectContaining({ request_id: 'plan-request-1', mode: 'bypassPermissions' }) }),
      expect.objectContaining({ method: 'agent.session.bulk', params: expect.objectContaining({ operation: 'clear-ended' }) }),
      expect.objectContaining({ method: 'feed.clear', params: expect.objectContaining({ confirm: true, yes: true }) })
    ])
  })

  it('sends surface and workspace action requests over the configured socket', async () => {
    const seen: Record<string, unknown>[] = []
    const socketPath = await startControlServer((request) => {
      seen.push(request)
      return {
        id: request.id,
        ok: true,
        data: {
          action: (request.params as any)?.action,
          surface: {
            source: 'terminal',
            panelId: (request.params as any)?.surfaceId || (request.params as any)?.panelId || 'panel-1',
            id: (request.params as any)?.surfaceId || (request.params as any)?.panelId || 'panel-1',
            title: (request.params as any)?.title || 'Main',
            state: 'idle'
          }
        }
      }
    })

    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'surface', 'action', 'new-terminal-right', '--surface', 'panel-1', '--no-focus'], {
      cwd: process.cwd()
    })
    await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'workspace', 'action', 'rename', '--workspace', 'panel-1', '--title', 'Ops'], {
      cwd: process.cwd()
    })

    expect(seen).toEqual([
      expect.objectContaining({ method: 'surface.action', params: expect.objectContaining({ action: 'new_terminal_right', surfaceId: 'panel-1', focus: false }) }),
      expect.objectContaining({ method: 'workspace.action', params: expect.objectContaining({ action: 'rename', workspaceId: 'panel-1', title: 'Ops' }) })
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

  it('sends control_compat-style mobile event subscription probes from the CLI helper', async () => {
    const seen: Record<string, unknown>[] = []
    const socketPath = await startControlServer((request) => {
      seen.push(request)
      const params = (request.params as any) || {}
      if (request.method === 'mobile.events.subscribe') {
        return {
          id: request.id,
          ok: true,
          data: {
            stream_id: params.stream_id || 'generated-stream',
            topics: params.topics || [],
            already_subscribed: false,
            event_stream_method: 'events.stream'
          }
        }
      }
      return {
        id: request.id,
        ok: true,
        data: {
          stream_id: params.stream_id || '',
          removed: params.stream_id === 'mobile-stream-1'
        }
      }
    })

    const subscribed = await execFileAsync(
      process.execPath,
      ['resources/aiopsterm-control.js', '--socket', socketPath, 'mobile', 'events', 'subscribe', '--stream', 'mobile-stream-1', '--topic', 'terminal.render_grid', 'workspace.updated'],
      { cwd: process.cwd() }
    )
    expect(subscribed.stdout).toContain('mobile-events\tsubscribe\tmobile-stream-1\tnew\tterminal.render_grid,workspace.updated')

    const unsubscribed = await execFileAsync(process.execPath, ['resources/aiopsterm-control.js', '--socket', socketPath, 'mobile', 'events', 'unsubscribe', 'mobile-stream-1'], {
      cwd: process.cwd()
    })
    expect(unsubscribed.stdout).toContain('mobile-events\tunsubscribe\tmobile-stream-1\tremoved')

    expect(seen).toEqual([
      expect.objectContaining({
        method: 'mobile.events.subscribe',
        params: expect.objectContaining({
          stream_id: 'mobile-stream-1',
          topics: ['terminal.render_grid', 'workspace.updated']
        })
      }),
      expect.objectContaining({
        method: 'mobile.events.unsubscribe',
        params: expect.objectContaining({
          stream_id: 'mobile-stream-1'
        })
      })
    ])
  })
})
