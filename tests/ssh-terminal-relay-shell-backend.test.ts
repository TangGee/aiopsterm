import { describe, expect, it, vi } from 'vitest'
import { createHiddenTextFilter } from '../src/main/backend/ssh/sshTerminalRelayShell'

describe('relay bootstrap echo filtering', () => {
  const command = "ssh -tt -- 'root@target.internal'"

  it.each(['\n', '\r\n', '\r'])('hides a fragmented bootstrap echo once with %j line endings', (ending) => {
    const onData = vi.fn()
    const filter = createHiddenTextFilter(onData)
    filter.addHiddenText(`${command}\n`)
    filter.handle('relay$ s')
    expect(onData.mock.calls.flat().join('')).toBe('relay$ ')
    filter.handle('s')
    filter.handle(`${command.slice(2)}${ending}Password: `)
    expect(onData.mock.calls.flat().join('')).toBe('relay$ Password: ')

    onData.mockClear()
    filter.handle('s')
    expect(onData.mock.calls).toEqual([['s']])
    filter.handle(`${command.slice(1)}\n`)
    expect(onData.mock.calls.flat().join('')).toBe(`${command}\n`)
  })

  it('releases non-matching output without losing characters', () => {
    const onData = vi.fn()
    const filter = createHiddenTextFilter(onData)
    filter.addHiddenText(`${command}\n`)
    filter.handle('s')
    filter.handle('erver banner\r\n')
    expect(onData.mock.calls.flat().join('')).toBe('server banner\r\n')
  })

  it('stops filtering at shell readiness even when the bootstrap command was not echoed', () => {
    const onData = vi.fn()
    const filter = createHiddenTextFilter(onData)
    filter.addHiddenText(`${command}\n`)
    filter.handle('root@target:~# s')
    filter.stop()
    expect(onData.mock.calls.flat().join('')).toBe('root@target:~# s')
    onData.mockClear()
    filter.handle('s')
    expect(onData.mock.calls).toEqual([['s']])
    filter.stop()
    expect(onData.mock.calls).toEqual([['s']])
  })

  it('flushes an incomplete match on exit', () => {
    const onData = vi.fn()
    const filter = createHiddenTextFilter(onData)
    filter.addHiddenText(`${command}\n`)
    filter.handle('ss')
    filter.flush()
    filter.flush()
    expect(onData.mock.calls).toEqual([['ss']])
  })
})
