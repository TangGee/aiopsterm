import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'yaml'
import { it, expect } from 'vitest'

const workflow = (name: string) => parse(readFileSync(resolve('.github/workflows', name), 'utf8'))
it('runs core desktop checks on every platform and long/fault coverage nightly', () => {
  const ci = workflow('ci.yml')
  expect(ci.jobs.desktop.strategy.matrix.os).toEqual(['ubuntu-22.04', 'windows-latest', 'macos-latest'])
  expect(ci.jobs.desktop.steps.some((step: any) => step.run === 'npm run test:regression -- core')).toBe(true)
  const nightly = workflow('regression-nightly.yml')
  expect(nightly.on.schedule.length).toBeGreaterThan(0)
  expect(nightly.jobs.full.steps.some((step: any) => step.run === 'npm run test:regression -- full')).toBe(true)
  expect(nightly.jobs.stress.steps.some((step: any) => step.run === 'npm run test:regression -- lifecycle')).toBe(true)
  const runner = readFileSync(resolve('scripts/run-regression.mjs'), 'utf8')
  expect(runner).toContain("'--grep-invert', '@lifecycle'")
  for (const file of ['notifications.spec.ts', 'mcp-business.spec.ts']) expect(readFileSync(resolve('tests/regression', file), 'utf8')).toContain('@core')
  expect(readFileSync(resolve('tests/regression/content-faults.spec.ts'), 'utf8')).toContain('@faults')
  for (const [file, job] of [['regression-nightly.yml', 'full'], ['regression-packaged.yml', 'packaged'], ['regression-release-signed.yml', 'signed']]) {
    const commands = workflow(file).jobs[job].steps.map((step: any) => step.run || '').join('\n')
    expect(commands).toContain('@anthropic-ai/claude-code@2.1.220 @moonshot-ai/kimi-code@0.29.1')
    expect(commands).toContain('GITHUB_PATH')
  }
})
it('keeps signing acceptance manual, scoped to master, fail-closed and non-publishing', () => {
  const signed = workflow('regression-release-signed.yml')
  expect(Object.keys(signed.on)).toEqual(['workflow_dispatch'])
  expect(signed.permissions).toEqual({ contents: 'read' })
  expect(signed.jobs.signed.if).toBe("github.ref == 'refs/heads/master'")
  expect(signed.jobs.signed.environment).toContain('release-signing-')
  const commands = signed.jobs.signed.steps.flatMap((step: any) => step.run ? [step.run] : [])
  expect(commands).toContain('npm run test:release:gate -- dist --verify --require-signatures')
  expect(commands).toContain('node scripts/test-installed-release.mjs dist')
  expect(commands.join('\n')).not.toContain('notarize=false')
  expect(commands.find((command: string) => command.includes('electron-builder'))).toContain('--publish never')
  const capture = workflow('regression-visual-baselines.yml')
  expect(capture.permissions).toEqual({ contents: 'read' })
  expect(JSON.stringify(capture)).not.toMatch(/git (?:push|commit)/)
})
