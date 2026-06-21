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
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.json', '.less', '.css'])
const largeFileThresholds = [
  { root: ['src', 'main'], extensions: new Set(['.ts']), maxLines: 1800 },
  { root: ['src', 'preload'], extensions: new Set(['.ts']), maxLines: 800 },
  { root: ['src', 'shared'], extensions: new Set(['.ts']), maxLines: 2500 },
  { root: ['src', 'renderer', 'src', 'stores'], extensions: new Set(['.ts']), maxLines: 2500 },
  { root: ['src', 'renderer', 'src', 'components'], extensions: new Set(['.vue']), maxLines: 1800 },
  { root: ['src', 'renderer', 'src', 'styles'], extensions: new Set(['.less', '.css']), maxLines: 2500 }
]
const largeFileBaselines = new Map(
  Object.entries({
    'src/renderer/src/styles/database.less': 2834,
    'src/renderer/src/stores/workspace.ts': 15723,
    'src/renderer/src/components/DatabaseWorkspace.vue': 8463,
    'src/shared/database.ts': 6941,
    'src/renderer/src/components/AiPanel.vue': 5938,
    'src/renderer/src/components/TerminalWorkspace.vue': 5899,
    'src/main/backend/controlSocket.ts': 5073,
    'src/shared/preload.ts': 4304,
    'src/main/index.ts': 4220,
    'src/renderer/src/components/panels/WorkspacePanel.vue': 3112,
    'src/renderer/src/components/panels/AssetsPanel.vue': 3070,
    'src/shared/kubernetes.ts': 2791,
    'src/main/backend/files.ts': 2596,
    'src/renderer/src/components/SettingsWorkspace.vue': 2462,
    'src/main/backend/agentSessions.ts': 2428,
    'src/main/backend/sshTerminal.ts': 1851,
    'src/main/backend/assets.ts': 1818
  })
)
const rootBoundaryFiles = [
  'package.json',
  'electron.vite.config.ts',
  'vite.config.ts',
  'vitest.config.ts',
  'playwright.config.ts',
  'electron-builder.yml',
  'electron-builder.yaml',
  'tsconfig.json',
  'tsconfig.node.json',
  'tsconfig.web.json'
]

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

const rendererBusinessIdLiteralPattern =
  /`(?:asset|folder|key|conv|aichat|dbai-pane|dbai-drawer|sql-exec|transfer|files-folder|snippet|snippet-group|alias|rule|k8s-run|k8s-session|k8s-tab|terminal-command)-\$\{/i

const rendererGenericIdHelperPatterns = [
  /\b(?:create|make|build|generate)[A-Za-z0-9_]*Id\s*=\s*\(\s*(?:prefix|kind|type)\s*(?=\)|,|=|:\s*string\b)/,
  /\b(?:const|let|var)\s+(?:create|make|build|generate)[A-Za-z0-9_]*Id\s*=\s*function\s*\(\s*(?:prefix|kind|type)\s*(?=\)|,|=|:\s*string\b)/,
  /\bfunction\s+(?:create|make|build|generate)[A-Za-z0-9_]*Id\s*\(\s*(?:prefix|kind|type)\s*(?=\)|,|=|:\s*string\b)/
]

const rendererConfigBusinessFieldPattern =
  /\b(?:asset_type|group_uuid|snippet_content|host|hostname|ip|username|password|privateKey|passphrase|credential|secret|connectionId|conversationId|dbType|databaseName|catalogName|schemaName|kubeconfig(?:Path|Content)?|contextName|serverUrl)\s*:/

const rendererConfigFixtureExportPattern =
  /\bexport\s+(?:const|let|var)\s+(?=[A-Za-z0-9_]*(?:default|mock|fixture|fake|dummy|seed|sample|demo))(?=[A-Za-z0-9_]*(?:Asset|Assets|Host|Hosts|Connection|Connections|Conversation|Conversations|Chat|Chats|Command|Commands|Snippet|Snippets|Alias|Aliases|Rule|Rules|Skill|Skills|Mcp|Database|Kubernetes|Knowledge|File|Files|User|Credential|Secret))[A-Za-z0-9_]*\s*=/i

const importSpecifierPatterns = [
  /\bfrom\s+['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g
]

const importSpecifiersFromLine = (line) => {
  const specifiers = []
  for (const pattern of importSpecifierPatterns) {
    pattern.lastIndex = 0
    for (;;) {
      const match = pattern.exec(line)
      if (!match) break
      specifiers.push(match[1])
    }
  }
  return specifiers
}

const isRendererMainOrPreloadSpecifier = (specifier) => {
  const normalized = specifier.replace(/\\/g, '/')
  return (
    normalized === '@main' ||
    normalized.startsWith('@main/') ||
    normalized === 'main' ||
    normalized.startsWith('main/') ||
    normalized === 'preload' ||
    normalized.startsWith('preload/') ||
    normalized.includes('/src/main/') ||
    normalized.includes('/src/preload/') ||
    /(?:^|\/)\.\.\/(?:\.\.\/)*(?:main|preload)(?:\/|$)/.test(normalized)
  )
}

const rendererBusinessIdFailures = (filePath, content) => {
  const failures = []
  content.split(/\r?\n/).forEach((line, index) => {
    if (rendererBusinessIdLiteralPattern.test(line)) {
      failures.push({
        filePath,
        rule: 'renderer-business-id-generation',
        message: 'Renderer code must not generate backend-owned business ids; use preload/main/backend creation results and keep renderer ids limited to local UI/request state.',
        lineNumber: index + 1
      })
    }
    if (rendererGenericIdHelperPatterns.some((pattern) => pattern.test(line))) {
      failures.push({
        filePath,
        rule: 'renderer-generic-id-helper',
        message: 'Renderer id helpers must use explicit UI-only prefix unions instead of accepting arbitrary string prefixes.',
        lineNumber: index + 1
      })
    }
  })
  return failures
}

const rendererArchitectureBoundaryFailures = (filePath, content) => {
  const failures = []
  content.split(/\r?\n/).forEach((line, index) => {
    const specifiers = importSpecifiersFromLine(line)
    if (specifiers.some(isRendererMainOrPreloadSpecifier)) {
      failures.push({
        filePath,
        rule: 'renderer-main-preload-import',
        message: 'Renderer source must not import main/preload implementation modules; use shared contracts plus the preload bridge.',
        lineNumber: index + 1
      })
    }
    if (specifiers.includes('electron')) {
      failures.push({
        filePath,
        rule: 'renderer-electron-import',
        message: 'Renderer source must not import Electron directly; expose required capabilities through preload/main boundaries.',
        lineNumber: index + 1
      })
    }
  })
  return failures
}

const rendererConfigStaticMetadataFailures = (filePath, content) => {
  const failures = []
  content.split(/\r?\n/).forEach((line, index) => {
    if (rendererConfigBusinessFieldPattern.test(line)) {
      failures.push({
        filePath,
        rule: 'renderer-config-business-field',
        message: 'Renderer config modules must stay limited to static UI metadata and must not define business fixture fields.',
        lineNumber: index + 1
      })
    }
    if (rendererConfigFixtureExportPattern.test(line)) {
      failures.push({
        filePath,
        rule: 'renderer-config-fixture-export',
        message: 'Renderer config modules must not export business fixture collections; expose runtime data through preload/main/backend boundaries.',
        lineNumber: index + 1
      })
    }
  })
  return failures
}

const external-referenceImportPattern = /(?:from|require|import)\s*\(?\s*['"][^'"]*(?:^|\/|\.\.)external-reference(?:\/|['"])/

const external-referenceTreePathPattern = /(^|[^.\w-])(?:\.{1,2}\/)?external-reference[\\/]/i

const hasExternal referenceTreePathReference = (content) => external-referenceTreePathPattern.test(content.replace(/\\/g, '/'))

const isAllowedExternal referenceTreeExclusion = (line) => {
  const normalized = line.replace(/\\/g, '/').trim()
  const token = normalized
    .replace(/^[-\s,[{]+/, '')
    .replace(/[,\]}]+$/, '')
    .replace(/^['"]|['"]$/g, '')
  return /^!\.?(?:\/)?external-reference\/\*\*$/.test(token)
}

const external-referenceTreeReferenceFailures = (filePath, content, message) => {
  const failures = []
  content.split(/\r?\n/).forEach((line, index) => {
    if (!hasExternal referenceTreePathReference(line) || isAllowedExternal referenceTreeExclusion(line)) return
    failures.push({
      filePath,
      rule: 'external-reference-tree-reference',
      message,
      lineNumber: index + 1
    })
  })
  return failures
}

const countLines = (content) => (content ? content.split(/\r?\n/).filter((line, index, lines) => index < lines.length - 1 || line.length > 0).length : 0)

const largeFileAuditFailures = (repoRoot) => {
  const failures = []
  for (const threshold of largeFileThresholds) {
    const rootPath = join(repoRoot, ...threshold.root)
    for (const filePath of walkFiles(rootPath)) {
      if (!threshold.extensions.has(extname(filePath))) continue
      const relativePath = toPosix(relative(repoRoot, filePath))
      const lines = countLines(readFileSync(filePath, 'utf8'))
      const maxLines = largeFileBaselines.get(relativePath) || threshold.maxLines
      if (lines <= maxLines) continue
      failures.push({
        filePath,
        rule: 'large-source-file',
        message: `Source file has ${lines} lines, above the architecture threshold of ${maxLines}. Split by domain/responsibility before adding more behavior.`
      })
    }
  }
  return failures
}

export const auditClientMocks = (root = repoRootFromArg()) => {
  const repoRoot = resolve(root)
  const rendererRoot = join(repoRoot, 'src', 'renderer', 'src')
  const rendererDataRoot = join(rendererRoot, 'data')
  const rendererConfigRoot = join(rendererRoot, 'config')
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
    failures.push(...rendererArchitectureBoundaryFailures(filePath, content))
    failures.push(...rendererBusinessIdFailures(filePath, content))
    if (isUnder(filePath, rendererConfigRoot)) {
      failures.push(...rendererConfigStaticMetadataFailures(filePath, content))
    }
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
      failures.push(
        ...external-referenceTreeReferenceFailures(
          filePath,
          content,
          'external-reference/ is reference-only and must not be copied, built from, packaged, or treated as an aiopsterm runtime source path.'
        )
      )
    }
  }

  for (const fileName of rootBoundaryFiles) {
    const filePath = join(repoRoot, fileName)
    if (!existsSync(filePath) || !statSync(filePath).isFile()) continue
    failures.push(
      ...external-referenceTreeReferenceFailures(
        filePath,
        readFileSync(filePath, 'utf8'),
        'Build, package, and project configuration must not include external-reference/ reference-tree inputs; explicit !external-reference/** exclusions are allowed.'
      )
    )
  }

  failures.push(...largeFileAuditFailures(repoRoot))

  return failures.map((failure) => ({
    ...failure,
    relativePath: `${toPosix(relative(repoRoot, failure.filePath))}${failure.lineNumber ? `:${failure.lineNumber}` : ''}`
  }))
}

const main = () => {
  const failures = auditClientMocks()
  if (failures.length) {
    console.error('client-mock-and-architecture-audit-failed')
    failures.forEach((failure) => {
      console.error(`${failure.relativePath}: ${failure.rule}: ${failure.message}`)
    })
    process.exitCode = 1
    return
  }
  console.log('client-mock-audit-ok')
  console.log('client-mock-and-architecture-audit-ok')
}

if (isUnder(scriptPath, resolve('scripts')) && process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  main()
}
