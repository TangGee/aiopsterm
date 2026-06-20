import { afterEach, describe, expect, it, vi } from 'vitest'
import { terminalClient } from '@/services/terminalClient'

const originalAiops = window.aiops

const terminalSession = {
  id: 'terminal-1',
  shell: '/bin/bash',
  cwd: '/workspace',
  kind: 'local' as const
}

const commandRecord = {
  id: 'command-1',
  panelId: 'panel-1',
  instruction: 'check disk',
  command: 'df -h',
  modelName: 'ops-model',
  context: {
    host: '127.0.0.1',
    username: 'local',
    cwd: '/workspace',
    shell: 'bash',
    connectionType: 'local' as const
  },
  status: 'done' as const,
  createdAt: 1781884800000,
  provider: 'aiopsterm-local' as const
}

afterEach(() => {
  window.aiops = originalAiops
})

describe('terminalClient', () => {
  it('returns undefined for unavailable bridge methods and binds Terminal bridge methods', async () => {
    const offData = vi.fn()
    const offLifecycle = vi.fn()
    const offExit = vi.fn()
    const offKeyboardRequest = vi.fn()
    const offKeyboardResult = vi.fn()

    window.aiops = {
      ...originalAiops,
      createTerminal: vi.fn(async () => terminalSession),
      writeTerminal: vi.fn(async (id: string, data: string) => ({ ok: true, data: { id, bytes: new TextEncoder().encode(data).length } })),
      writeTerminalBinary: vi.fn(async (id: string, data: number[] | Uint8Array | ArrayBuffer) => ({
        ok: true,
        data: {
          id,
          bytes: data instanceof ArrayBuffer ? data.byteLength : data.length
        }
      })),
      resizeTerminal: vi.fn(async () => undefined),
      killTerminal: vi.fn(async (id: string) => ({ ok: true, data: { id } })),
      generateTerminalCommand: vi.fn(async () => ({ ok: true, data: commandRecord })),
      onTerminalData: vi.fn(() => offData),
      onTerminalLifecycle: vi.fn(() => offLifecycle),
      onTerminalExit: vi.fn(() => offExit),
      onTerminalKeyboardInteractiveRequest: vi.fn(() => offKeyboardRequest),
      onTerminalKeyboardInteractiveResult: vi.fn(() => offKeyboardResult)
    }

    await expect(terminalClient.createTerminal()?.({ kind: 'local', panelId: 'panel-1' })).resolves.toEqual(terminalSession)
    await expect(terminalClient.writeTerminal()?.('terminal-1', 'pwd\n')).resolves.toEqual({ ok: true, data: { id: 'terminal-1', bytes: 4 } })
    await expect(terminalClient.writeTerminalBinary()?.('terminal-1', [1, 2, 3])).resolves.toEqual({ ok: true, data: { id: 'terminal-1', bytes: 3 } })
    await expect(terminalClient.resizeTerminal()?.('terminal-1', 120, 32)).resolves.toBeUndefined()
    await expect(terminalClient.killTerminal()?.('terminal-1')).resolves.toEqual({ ok: true, data: { id: 'terminal-1' } })
    await expect(
      terminalClient.generateTerminalCommand()?.({
        panelId: commandRecord.panelId,
        instruction: commandRecord.instruction,
        modelName: commandRecord.modelName,
        context: commandRecord.context
      })
    ).resolves.toEqual({ ok: true, data: commandRecord })

    const onData = vi.fn()
    const onLifecycle = vi.fn()
    const onExit = vi.fn()
    const onKeyboardRequest = vi.fn()
    const onKeyboardResult = vi.fn()
    expect(terminalClient.onTerminalData()?.(onData)).toBe(offData)
    expect(terminalClient.onTerminalLifecycle()?.(onLifecycle)).toBe(offLifecycle)
    expect(terminalClient.onTerminalExit()?.(onExit)).toBe(offExit)
    expect(terminalClient.onTerminalKeyboardInteractiveRequest()?.(onKeyboardRequest)).toBe(offKeyboardRequest)
    expect(terminalClient.onTerminalKeyboardInteractiveResult()?.(onKeyboardResult)).toBe(offKeyboardResult)

    expect(window.aiops.createTerminal).toHaveBeenCalledWith({ kind: 'local', panelId: 'panel-1' })
    expect(window.aiops.writeTerminal).toHaveBeenCalledWith('terminal-1', 'pwd\n')
    expect(window.aiops.writeTerminalBinary).toHaveBeenCalledWith('terminal-1', [1, 2, 3])
    expect(window.aiops.resizeTerminal).toHaveBeenCalledWith('terminal-1', 120, 32)
    expect(window.aiops.killTerminal).toHaveBeenCalledWith('terminal-1')
    expect(window.aiops.generateTerminalCommand).toHaveBeenCalledWith({
      panelId: commandRecord.panelId,
      instruction: commandRecord.instruction,
      modelName: commandRecord.modelName,
      context: commandRecord.context
    })
    expect(window.aiops.onTerminalData).toHaveBeenCalledWith(onData)
    expect(window.aiops.onTerminalLifecycle).toHaveBeenCalledWith(onLifecycle)
    expect(window.aiops.onTerminalExit).toHaveBeenCalledWith(onExit)
    expect(window.aiops.onTerminalKeyboardInteractiveRequest).toHaveBeenCalledWith(onKeyboardRequest)
    expect(window.aiops.onTerminalKeyboardInteractiveResult).toHaveBeenCalledWith(onKeyboardResult)

    window.aiops = {
      ...originalAiops,
      createTerminal: undefined as any,
      writeTerminal: undefined as any,
      writeTerminalBinary: undefined as any,
      resizeTerminal: undefined as any,
      killTerminal: undefined as any,
      generateTerminalCommand: undefined as any,
      onTerminalData: undefined as any,
      onTerminalLifecycle: undefined as any,
      onTerminalExit: undefined as any,
      onTerminalKeyboardInteractiveRequest: undefined as any,
      onTerminalKeyboardInteractiveResult: undefined as any
    }
    expect(terminalClient.createTerminal()).toBeUndefined()
    expect(terminalClient.writeTerminal()).toBeUndefined()
    expect(terminalClient.writeTerminalBinary()).toBeUndefined()
    expect(terminalClient.resizeTerminal()).toBeUndefined()
    expect(terminalClient.killTerminal()).toBeUndefined()
    expect(terminalClient.generateTerminalCommand()).toBeUndefined()
    expect(terminalClient.onTerminalData()).toBeUndefined()
    expect(terminalClient.onTerminalLifecycle()).toBeUndefined()
    expect(terminalClient.onTerminalExit()).toBeUndefined()
    expect(terminalClient.onTerminalKeyboardInteractiveRequest()).toBeUndefined()
    expect(terminalClient.onTerminalKeyboardInteractiveResult()).toBeUndefined()
  })
})
