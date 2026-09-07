import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it, expect } from 'vitest'
import { readFlowLogs } from './support/flow-log'

it('counts flow pairs across rotated logs without concealing missing history or an unmatched pause', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aio-flow-log-'))
  const event = (kind: string, pauseCount: number) => JSON.stringify({ id: 'session', event: `terminal.flow.${kind}`, pauseCount }) + '\n'
  try {
    await writeFile(join(root, 'aiopsterm-runtime.log.1'), event('paused', 1))
    await writeFile(join(root, 'aiopsterm-runtime.log'), event('resumed', 1) + event('paused', 2) + event('resumed', 2))
    expect(await readFlowLogs(root, ['session'])).toMatchObject({ paused: 2, resumed: 2, complete: true, safetyResumed: 0 })
    await writeFile(join(root, 'aiopsterm-runtime.log'), event('resumed', 1) + event('paused', 2))
    expect(await readFlowLogs(root, ['session'])).toMatchObject({ paused: 2, resumed: 1, complete: true })
    await writeFile(join(root, 'aiopsterm-runtime.log.1'), '')
    expect((await readFlowLogs(root, ['session'])).complete).toBe(false)
  } finally { await rm(root, { recursive: true, force: true }) }
})
