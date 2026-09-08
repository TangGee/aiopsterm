import { it, expect } from 'vitest'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { descendants, sampleProcessTree } from './support/process-tree'

it('follows grandchildren without including unrelated processes', () => {
  const rows = [{ pid: 1, parent: 0 }, { pid: 2, parent: 1 }, { pid: 3, parent: 2 }, { pid: 4, parent: 0 }].map((row) => ({ ...row, rssKb: 1, handles: 1 }))
  expect(descendants(rows, [1]).map((row) => row.pid)).toEqual([1, 2, 3])
})
it('measures a real external child and confirms its exit', async () => {
  const child = spawn(process.execPath, ['-e', 'process.stdout.write("ready");setInterval(()=>{},1000)'], { stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    await once(child.stdout!, 'data')
    const rows = await sampleProcessTree([process.pid])
    const measured = rows.find((row) => row.pid === child.pid)
    expect(measured).toBeTruthy()
    expect(measured!.rssKb).toBeGreaterThan(0)
    expect(measured!.handles).toBeGreaterThan(0)
  } finally {
    const exited = once(child, 'exit')
    child.kill()
    await exited
  }
  expect((await sampleProcessTree([process.pid])).some((row) => row.pid === child.pid)).toBe(false)
}, 30000)
