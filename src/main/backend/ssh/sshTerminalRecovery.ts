import type { TerminalCreateOptions, TerminalLifecycleEvent } from '@shared/contracts/terminalSessions'
import type { SshTerminalCreateResult, SshTerminalEventSink, SshTerminalSession } from './sshTerminalTypes'
import { createSshCwdTracker } from './sshShellRecovery'

type Factory = (id: string, options: TerminalCreateOptions, sink: SshTerminalEventSink) => SshTerminalCreateResult

export const createRecoveringSshTerminalSession = (
  id: string,
  options: TerminalCreateOptions,
  sink: SshTerminalEventSink,
  create: Factory
): SshTerminalCreateResult => {
  let active: SshTerminalSession | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let generation = 0
  let stopped = false
  let ready = false
  let hasConnected = false
  let attempt = 0
  let paused = false
  let cwd = options.cwd
  let cols = options.cols
  let rows = options.rows
  let lastEvent: TerminalLifecycleEvent = { id, panelId: options.panelId, kind: 'ssh', stage: 'connecting', at: Date.now() }
  const finish = (event: TerminalLifecycleEvent, code?: number | null) => {
    if (stopped) return
    stopped = true
    ready = false
    generation++
    if (timer) clearTimeout(timer)
    timer = undefined
    sink.closed?.(id)
    sink.lifecycle(event)
    sink.exit(event, code)
  }
  const start = (): SshTerminalCreateResult => {
    const current = ++generation
    let terminalEvent: TerminalLifecycleEvent | undefined
    const trackCwd = createSshCwdTracker((path) => {
      if (cwd === path) return
      cwd = path
      lastEvent = { ...lastEvent, cwd: path, cwdVerified: true, at: Date.now() }
      sink.lifecycle(lastEvent)
    })
    const result = create(id, { ...options, cwd, cols, rows }, {
      keyboardInteractive: sink.keyboardInteractive ? (request) => {
        if (stopped || current !== generation) return Promise.reject(new Error('SSH attempt is no longer active.'))
        return sink.keyboardInteractive!(request)
      } : undefined,
      keyboardInteractiveResult: (result) => {
        if (!stopped && current === generation) sink.keyboardInteractiveResult?.(result)
      },
      lifecycle: (event) => {
        if (stopped || current !== generation) return
        lastEvent = event
        if (event.stage === 'error' || event.stage === 'closed') {
          terminalEvent = event
          ready = false
          return
        }
        if (event.stage === 'shell-ready') {
          // DECRST 1049 restores a saved cursor even in the normal buffer.
          // Save its current position first; in the alternate buffer this only
          // updates the alternate cursor and preserves the normal saved cursor.
          if (hasConnected) sink.data('\x1b7\x1b[?1049l\x1b[?1047l\x1b[?1l\x1b[?25h\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?2004l\x1b[0m\r\n')
          ready = true
          hasConnected = true
          attempt = 0
          if (paused) active?.pause?.()
        }
        sink.lifecycle(cwd ? { ...event, cwd } : event)
      },
      data: (data) => {
        if (stopped || current !== generation) return
        trackCwd(data)
        sink.data(data)
      },
      closed: () => {},
      exit: (event, code) => {
        if (stopped || current !== generation) return
        ready = false
        const ended = terminalEvent || event
        const retry = options.sshAutoReconnect !== false && hasConnected && (ended.reason === 'network' || ended.isNetworkDisconnect === true)
        if (!retry) {
          finish(ended, code)
          return
        }
        // Invalidate late callbacks immediately, including channel output after close.
        generation++
        active = null
        const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempt++, 5))
        lastEvent = { ...ended, stage: 'connecting', reason: undefined, code: undefined, errorCode: undefined, errorMessage: undefined, cwd, at: Date.now(), message: `SSH reconnecting (attempt ${attempt}). ${ended.errorMessage || ended.message || ''}`.trim() }
        sink.lifecycle(lastEvent)
        timer = setTimeout(() => {
          timer = undefined
          if (!stopped) {
            try { start() } catch (error) {
              finish({ ...lastEvent, stage: 'error', reason: 'error', at: Date.now(), errorMessage: error instanceof Error ? error.message : 'SSH reconnect failed.' })
            }
          }
        }, delay)
        timer.unref?.()
      }
    })
    if (!stopped && current === generation) {
      active = result.session
      if (paused) active?.pause?.()
    }
    return result
  }
  const result = start()
  if (!result.session || stopped) return { ...result, session: null }
  const requireReady = () => {
    if (!ready || !active || stopped) throw new Error('SSH is reconnecting or unavailable. Input was not sent.')
    return active
  }
  return { ...result, session: {
    write: (data) => requireReady().write(data),
    runBackgroundCommand: (command) => {
      const session = requireReady()
      if (!session.runBackgroundCommand) return Promise.reject(new Error('Background commands are unavailable.'))
      return session.runBackgroundCommand(command)
    },
    resize: (nextCols, nextRows) => {
      cols = nextCols
      rows = nextRows
      active?.resize(cols, rows)
    },
    pause: () => { paused = true; active?.pause?.() },
    resume: () => { paused = false; active?.resume?.() },
    kill: (reason = 'manual') => {
      if (stopped) return
      const session = active
      finish({ ...lastEvent, stage: 'closed', at: Date.now(), reason, isNetworkDisconnect: reason === 'network', errorCode: undefined, errorMessage: undefined, message: 'SSH session closed.' }, 0)
      session?.kill(reason)
    }
  } }
}
