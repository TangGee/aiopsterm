import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function readFlowLogs(directory: string, sessionIds: string[]) {
  const bySession: Record<string, { paused: number; resumed: number; safetyResumed: number }> = {}
  const seen = new Set<string>()
  let complete = true
  for (const id of sessionIds) bySession[id] = { paused: 0, resumed: 0, safetyResumed: 0 }
  const files = (await readdir(directory)).filter((name) => /^aiopsterm-runtime\.log(?:\.\d+)?$/.test(name))
    .sort((a, b) => Number(b.match(/\.(\d+)$/)?.[1] || 0) - Number(a.match(/\.(\d+)$/)?.[1] || 0))
  for (const file of files) {
    const text = await readFile(join(directory, file), 'utf8')
    for (const line of text.split('\n')) {
      let entry: { id?: string; event?: string; pauseCount?: number }
      try { entry = JSON.parse(line) } catch { continue }
      const state = entry?.id ? bySession[entry.id] : undefined
      if (!state || !['terminal.flow.paused', 'terminal.flow.resumed', 'terminal.flow.safety-resume'].includes(entry.event || '')) continue
      if (!seen.has(entry.id!)) {
        // Do not report success if log retention has discarded the start of a session.
        complete &&= entry.event === 'terminal.flow.paused' && entry.pauseCount === 1
        seen.add(entry.id!)
      }
      if (entry.event === 'terminal.flow.paused') state.paused++
      if (entry.event === 'terminal.flow.resumed') state.resumed++
      if (entry.event === 'terminal.flow.safety-resume') state.safetyResumed++
    }
  }
  return {
    paused: Object.values(bySession).reduce((sum, state) => sum + state.paused, 0),
    resumed: Object.values(bySession).reduce((sum, state) => sum + state.resumed, 0),
    safetyResumed: Object.values(bySession).reduce((sum, state) => sum + state.safetyResumed, 0),
    complete: complete && seen.size === sessionIds.length, files, bySession
  }
}
