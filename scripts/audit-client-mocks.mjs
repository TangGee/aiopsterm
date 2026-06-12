import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRootFromArg = () => {
  const args = process.argv.slice(2)
  const rootIndex = args.indexOf('--root')
  if (rootIndex !== -1 && args[rootIndex + 1]) {
    return resolve(args[rootIndex + 1])
  }
  return process.cwd()
}

const scriptPath = fileURLToPath(import.meta.url)

const skippedDirs = new Set(['.git', 'node_modules', 'out', 'dist', 'test-results', 'playwright-report', 'coverage', 'external-reference'])
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.json'])

const toPosix = (value) => value.split(sep).join('/')

const isUnder = (target, root) => {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/') && rel !== '..')
}

const walkFiles = (root) => {
  if (!existsSync(root)) return []
  const files = []
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && skippedDirs.has(entry.name)) continue
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        visit(fullPath)
        continue
      }
      if (!entry.isFile()) continue
      if (!sourceExtensions.has(extname(entry.name))) continue
      files.push(fullPath)
    }
  }
  visit(root)
  return files
}

const rendererForbiddenFileNamePattern = /mockData|mockSettings|mockAssets|mockFiles|mockKnowledge|mockKubernetes|mockDatabase|mockMcp|mockSkills|mockRules|mockShortcuts|mockUser|mockChat|mockCommands|mockExtensions|(^|[-_.])(mock|mocks|fixture|fixtures|dummy|fake|seed|seeds)([-_.]|$)/i

const rendererContentRules = [
  {
    id: 'renderer-data-import',
    pattern: /(?:from\s+['"]@\/data(?:\/|['"])|from\s+['"][^'"]*\/data\/|import\s*\(\s*['"]@\/data(?:\/|['"]))/,
    message: 'Renderer code must not import business data fixtures from src/renderer/src/data.'
  },
  {
    id: 'renderer-mock-data-token',
    pattern: /\bmockData\b|\bmockSettings[A-Z]\w*|\bmockAssets[A-Z]\w*|\bmockFiles[A-Z]\w*|\bmockKnowledge[A-Z]\w*|\bmockKubernetes[A-Z]\w*|\bmockDatabase[A-Z]\w*|\bmockMcp[A-Z]\w*|\bmockSkills[A-Z]\w*|\bmockRules[A-Z]\w*|\bmockShortcuts[A-Z]\w*|\bmockUser[A-Z]\w*|\bmockChat[A-Z]\w*|\bmockCommands[A-Z]\w*|\bmockExtensions[A-Z]\w*/,
    message: 'Renderer code must not define or consume page-level business mock fixtures.'
  },
  {
    id: 'renderer-backend-double-switch',
    pattern: /AIOPSTERM_[A-Z0-9_]*(?:BACKEND_DOUBLE|ENABLE_SEED|DIALOG_FIXTURES|DISCOVERY_DISABLE)/,
    message: 'Backend double and seed switches must stay outside renderer code.'
  },
  {
    id: 'renderer-shared-seed-import',
    pattern: /from\s+['"]@shared\/[A-Za-z0-9_-]*Seed['"]|from\s+['"][^'"]*shared\/[A-Za-z0-9_-]*Seed['"]/,
    message: 'Renderer code must not import backend seed modules.'
  }
]

const external-referenceImportPattern = /(?:from|require|import)\s*\(?\s*['"][^'"]*(?:^|\/|\.\.)external-reference(?:\/|['"])/

export const auditClientMocks = (root = repoRootFromArg()) => {
  const repoRoot = resolve(root)
  const rendererRoot = join(repoRoot, 'src', 'renderer', 'src')
  const rendererDataRoot = join(rendererRoot, 'data')
  const sourceRoots = [join(repoRoot, 'src'), join(repoRoot, 'scripts')]
  const failures = []

  for (const filePath of walkFiles(rendererDataRoot)) {
    failures.push({
      filePath,
      rule: 'renderer-data-file',
      message: 'src/renderer/src/data must remain empty; business data belongs behind preload/main/backend boundaries.'
    })
  }

  for (const filePath of walkFiles(rendererRoot)) {
    const rel = toPosix(relative(repoRoot, filePath))
    if (rendererForbiddenFileNamePattern.test(basename(filePath))) {
      failures.push({
        filePath,
        rule: 'renderer-business-mock-file-name',
        message: 'Renderer source file names must not introduce mock, fixture, fake, dummy, or seed business modules.'
      })
    }
    const content = readFileSync(filePath, 'utf8')
    rendererContentRules.forEach((rule) => {
      if (rule.pattern.test(content)) {
        failures.push({ filePath, rule: rule.id, message: rule.message })
      }
    })
    if (rel.includes('/__fixtures__/') || rel.includes('/fixtures/')) {
      failures.push({
        filePath,
        rule: 'renderer-fixture-directory',
        message: 'Renderer fixture directories are not allowed for product business data.'
      })
    }
  }

  for (const rootPath of sourceRoots) {
    for (const filePath of walkFiles(rootPath)) {
      if (filePath === scriptPath) continue
      const content = readFileSync(filePath, 'utf8')
      if (external-referenceImportPattern.test(content)) {
        failures.push({
          filePath,
          rule: 'external-reference-source-import',
          message: 'external-reference/ is reference-only and must not be imported, required, or packaged by aiopsterm source.'
        })
      }
    }
  }

  return failures.map((failure) => ({
    ...failure,
    relativePath: toPosix(relative(repoRoot, failure.filePath))
  }))
}

const main = () => {
  const failures = auditClientMocks()
  if (failures.length) {
    console.error('client-mock-audit-failed')
    failures.forEach((failure) => {
      console.error(`${failure.relativePath}: ${failure.rule}: ${failure.message}`)
    })
    process.exitCode = 1
    return
  }
  console.log('client-mock-audit-ok')
}

if (isUnder(scriptPath, resolve('scripts')) && process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  main()
}
