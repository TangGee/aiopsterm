import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

describe('package configuration audit', () => {
  it('keeps macOS and deb packaging entry points configured', async () => {
    const result = await execFileAsync(process.execPath, ['scripts/audit-package-config.mjs'], { cwd: process.cwd() })
    expect(`${result.stdout}${result.stderr}`).toContain('package-config-audit-ok')
  })
})
