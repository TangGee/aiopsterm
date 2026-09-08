import { test, expect } from './support/desktop'
import { writeFile, readFile, mkdir, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const { DatabaseSync } = createRequire(join(process.cwd(), 'package.json'))('node:sqlite')
for (const fault of ['ENOSPC', 'EACCES', 'sqlite-lock', 'crash-before-rename', 'crash-after-rename']) {
  test(`session persistence survives ${fault} without stale Codex projection @faults`, async ({ desktop }) => {
    const home = join(desktop.root, 'home', '.codex')
    await mkdir(home, { recursive: true })
    const path = join(home, 'fault.jsonl'), marker = join(desktop.root, 'fault-reached')
    const sessionId = 'regression-fault'
    const original = JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'REGRESSION_OLD' }] } }) + '\n'
    await writeFile(path, original)
    const databases = [17, 99].map((version) => join(home, `thread_history_${version}.sqlite`))
    for (const file of databases) {
      const db = new DatabaseSync(file)
      try {
        db.exec('PRAGMA journal_mode=WAL; CREATE TABLE thread_items (thread_id TEXT); CREATE TABLE thread_history_projection_state (thread_id TEXT)')
        for (const table of ['thread_items', 'thread_history_projection_state']) {
          db.prepare(`INSERT INTO ${table} VALUES (?)`).run(sessionId)
          db.prepare(`INSERT INTO ${table} VALUES (?)`).run('unrelated')
        }
      } finally { db.close() }
    }
    await desktop.api('publishAiAgentSessionEvent', { source: 'codex', sessionId, event: 'session_start', transcriptPath: path, receivedAt: Date.now() })
    // Establish a durable pre-existing session before faulting its content update.
    await desktop.restart()
    if (fault === 'ENOSPC') {
      await desktop.app.evaluate((_, root) => {
        const threads = (process as any).getBuiltinModule('worker_threads')
        const Original = threads.Worker
        threads.Worker = class extends Original {
          constructor(code: any, options: any) {
            const patch = `const regressionFs=require('node:fs/promises');const regressionWrite=regressionFs.writeFile;regressionFs.writeFile=async(file,data,...args)=>{if(String(file).startsWith(${JSON.stringify(root)})&&String(file).endsWith('.tmp')){await regressionWrite(file,String(data).slice(0,10),...args);throw Object.assign(new Error('Regression partial write ENOSPC'),{code:'ENOSPC'})}return regressionWrite(file,data,...args)};\n`
            super(options?.eval && typeof code === 'string' && code.includes('executeRewrite') ? patch + code : code, options)
          }
        }
      }, home)
    }
    const initial = await desktop.api('listManagedAiSessionContent', { source: 'codex', sessionId })
    const record = initial.data.records.find((item: any) => item.content === 'REGRESSION_OLD')
    expect(record).toBeTruthy()
    let locked: any
    if (fault === 'sqlite-lock') {
      locked = new DatabaseSync(databases[0])
      locked.exec('BEGIN IMMEDIATE')
    } else if (fault !== 'ENOSPC') {
      // Inject only at the filesystem publication boundary, not at the application API.
      await desktop.app.evaluate((_, { path, marker, fault }) => {
        const fs = (process as any).getBuiltinModule('fs/promises')
        const rename = fs.rename
        fs.rename = async (from: string, to: string) => {
          if (to !== path) return rename(from, to)
          if (fault === 'EACCES') throw Object.assign(new Error(`Regression ${fault}`), { code: fault })
          if (fault === 'crash-after-rename') await rename(from, to)
          await fs.writeFile(marker, 'reached')
          return new Promise(() => {})
        }
      }, { path, marker, fault })
    }
    const pending = desktop.api('updateManagedAiSessionContentRecord', { source: 'codex', sessionId, recordId: record.recordId, sourceRevision: record.sourceRevision, content: 'REGRESSION_NEW' }).catch((error) => ({ transportError: String(error) }))
    try {
      if (fault.startsWith('crash-')) {
        await expect.poll(() => existsSync(marker)).toBe(true)
        desktop.app.process().kill('SIGKILL')
        await pending
        await desktop.start()
      } else {
        const result = await pending
        expect(result.ok, JSON.stringify(result)).toBe(false)
        expect(result.errorMessage || result.errorCode).toBeTruthy()
        if (fault === 'ENOSPC') expect(result.errorMessage).toContain('partial write ENOSPC')
      }
    } finally {
      if (locked) { locked.exec('ROLLBACK'); locked.close() }
    }
    const changed = fault === 'crash-after-rename'
    const raw = await readFile(path, 'utf8')
    expect(raw).toContain(changed ? 'REGRESSION_NEW' : 'REGRESSION_OLD')
    expect(() => JSON.parse(raw)).not.toThrow()
    for (const file of databases) {
      const db = new DatabaseSync(file)
      try {
        expect(db.prepare('SELECT count(*) AS n FROM thread_items WHERE thread_id=?').get('unrelated').n).toBe(1)
        if (changed) expect(db.prepare('SELECT count(*) AS n FROM thread_items WHERE thread_id=?').get(sessionId).n).toBe(0)
      } finally { db.close() }
    }
    if (!fault.startsWith('crash-')) expect((await readdir(home)).filter((name) => name.endsWith('.tmp'))).toEqual([])
    await desktop.restart()
    const restored = await desktop.api('listManagedAiSessionContent', { source: 'codex', sessionId })
    expect(restored.ok, JSON.stringify(restored)).toBe(true)
    expect(restored.data.records).toEqual(expect.arrayContaining([expect.objectContaining({ content: changed ? 'REGRESSION_NEW' : 'REGRESSION_OLD' })]))
  })
}
