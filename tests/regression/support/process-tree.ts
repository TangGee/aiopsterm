import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readdir } from 'node:fs/promises'

const execute = promisify(execFile)
export type ProcessSample = { pid: number; parent: number; rssKb: number; handles: number }
export function descendants(rows: ProcessSample[], roots: number[]) {
  const selected = new Set(roots)
  let size = -1
  while (size !== selected.size) {
    size = selected.size
    for (const row of rows) if (selected.has(row.parent)) selected.add(row.pid)
  }
  return rows.filter((row) => selected.has(row.pid))
}
export async function sampleProcessTree(roots: number[]): Promise<ProcessSample[]> {
  if (roots.some((pid) => !Number.isInteger(pid) || pid <= 0)) throw new Error('Invalid process root')
  let rows: ProcessSample[]
  if (process.platform === 'win32') {
    const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$p=Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID } | Select-Object ProcessId,ParentProcessId,WorkingSetSize,HandleCount; ConvertTo-Json -Compress -InputObject @($p)'], { timeout: 15000, maxBuffer: 8 * 1024 * 1024 })
    rows = JSON.parse(stdout.replace(/^\uFEFF/, '')).map((row: any) => ({ pid: Number(row.ProcessId), parent: Number(row.ParentProcessId), rssKb: Number(row.WorkingSetSize) / 1024, handles: Number(row.HandleCount) }))
  } else {
    const { stdout } = await execute('ps', ['-axo', 'pid=,ppid=,rss=,comm='], { timeout: 10000, maxBuffer: 8 * 1024 * 1024 })
    rows = stdout.trim().split('\n').map((line) => {
      const [pid, parent, rssKb, command] = line.trim().split(/\s+/)
      return { pid: Number(pid), parent: Number(parent), rssKb: Number(rssKb), handles: 0, command }
    }).filter((row) => row.command !== 'ps')
  }
  const selected = descendants(rows, roots)
  if (!selected.some((row) => roots.includes(row.pid))) throw new Error('Process roots disappeared during resource sampling')
  const live: ProcessSample[] = []
  for (const row of selected) {
    if (process.platform === 'linux') {
      try { row.handles = (await readdir(`/proc/${row.pid}/fd`)).length }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error }
    } else if (process.platform === 'darwin') {
      try {
        const { stdout } = await execute('lsof', ['-nP', '-a', '-p', String(row.pid), '-Ff'], { timeout: 10000, maxBuffer: 4 * 1024 * 1024 })
        row.handles = stdout.split('\n').filter((line) => /^f\d/.test(line)).length
      } catch (error) {
        try { process.kill(row.pid, 0) } catch { continue }
        throw error
      }
    }
    if (![row.rssKb, row.handles].every(Number.isFinite)) throw new Error('Invalid OS process resource measurement')
    live.push(row)
  }
  return live
}
