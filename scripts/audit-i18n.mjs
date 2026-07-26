import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const trackedFiles = execFileSync('git', ['ls-files', 'src/renderer/src'], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .filter((file) => /\.(vue|ts)$/.test(file))
  .filter((file) => !file.includes('/i18n/locales/'))
  .filter((file) => !file.endsWith('/i18n/messages.ts'))
  .filter((file) => !file.endsWith('/i18n/staticText.ts'))
  .filter((file) => !file.includes('/styles/'))

const staticTextSource = readFileSync('src/renderer/src/i18n/staticText.ts', 'utf8')
const exactStaticText = new Set([...staticTextSource.matchAll(/^\s*'([^']+)':/gm)].map((match) => match[1]))
const staticPatternSources = [...staticTextSource.matchAll(/\[\/\^([^/]+?)\/,\s*'[^']*'\]/g)].map((match) => match[1])
const staticPatterns = staticPatternSources.map((source) => new RegExp(`^${source.replace(/\\\//g, '/')}`))
const legacyStaticTextBaseline = JSON.parse(readFileSync('scripts/i18n-legacy-static-text-baseline.json', 'utf8'))
const registeredLegacyStaticTextHashes = new Set(Array.isArray(legacyStaticTextBaseline.hashes) ? legacyStaticTextBaseline.hashes : [])
const localeDirectory = 'src/renderer/src/i18n/locales'
const explicitLocaleFiles = ['enUS', 'jaJP', 'koKR', 'deDE', 'frFR', 'itIT', 'ptPT', 'ruRU', 'arAR']
const localeKeys = (file) =>
  new Set([...readFileSync(`${localeDirectory}/${file}.ts`, 'utf8').matchAll(/^\s*'([^']+)':/gm)].map((match) => match[1]))
const requiredLocaleKeys = localeKeys('zhCN')

const stripTemplateExpressions = (value) => value.replace(/\{\{[^}]+?\}\}/g, ' ').replace(/\$\{[^}]+?\}/g, ' ')
const normalize = (value) => stripTemplateExpressions(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const legacyTextHash = (value) => createHash('sha256').update(value).digest('hex').slice(0, 24)

const hasStaticTranslation = (value) => {
  const text = normalize(value)
  if (!text || !/[\u3400-\u9fff]/.test(text)) return true
  if (exactStaticText.has(text)) return true
  if (staticPatterns.some((pattern) => pattern.test(text))) return true
  return registeredLegacyStaticTextHashes.has(legacyTextHash(text))
}

const isNonUiLine = (line) =>
  [
    /localeDisplayNames/,
    /language:\s*['"]zh-CN['"]/,
    /localeCompare\([^)]*['"]zh-CN['"]/,
    /['"]zh-CN['"]/,
    /['"]zh-TW['"]/,
    /targetId:\s*['"]/,
    /data-testid=/,
    /data-onboarding-id=/,
    /id:\s*['"][a-z0-9_-]+['"]/i,
    /key:\s*['"][a-z0-9_-]+['"]/i,
    /source:\s*['"][a-z0-9_-]+['"]/i,
    /command:\s*['"]/,
    /sql:\s*['"]/,
    /regex:\s*['"]/,
    /host:\s*['"]/,
    /username:\s*['"]/,
    /filename:\s*['"]/,
    /relPath:\s*['"]/,
    /cwd:\s*['"]/,
    /sessionId:\s*['"]/
  ].some((pattern) => pattern.test(line))

const isLocaleTitleAliasLine = (line) =>
  /workspaceAiChatHistoryRuntime\.ts/.test(currentFile) && /['"](新建對話|未命名對話|新しいチャット|無題のチャット)['"]/.test(line)

const extractQuotedText = (line) => {
  const values = []
  const quoteRegex = /(['"`])((?:\\.|(?!\1).)*?[\u3400-\u9fff](?:\\.|(?!\1).)*?)\1/g
  for (const match of line.matchAll(quoteRegex)) values.push(match[2])
  return values
}

const extractTemplateText = (line) => {
  if (!/<[^>]+>/.test(line) || !/[\u3400-\u9fff]/.test(line)) return []
  if (extractQuotedText(line).length > 0) return []
  const text = normalize(line)
  return text ? [text] : []
}

const findings = []
const localeFindings = []
let currentFile = ''

for (const file of explicitLocaleFiles) {
  const declaredKeys = localeKeys(file)
  for (const key of requiredLocaleKeys) {
    if (!declaredKeys.has(key)) localeFindings.push(`${file}.ts: missing ${key}`)
  }
}

for (const file of trackedFiles) {
  const lines = readFileSync(file, 'utf8').split('\n')
  currentFile = file
  lines.forEach((line, index) => {
    if (!/[\u3400-\u9fff]/.test(line)) return
    if (isLocaleTitleAliasLine(line)) return
    if (isNonUiLine(line)) return
    const candidates = [...extractQuotedText(line), ...extractTemplateText(line)]
      .map(normalize)
      .filter((value) => value && /[\u3400-\u9fff]/.test(value))
    for (const candidate of candidates) {
      if (!hasStaticTranslation(candidate)) findings.push(`${file}:${index + 1}: ${candidate}`)
    }
  })
}

if (localeFindings.length || findings.length) {
  if (localeFindings.length) {
    console.error('Renderer i18n audit found locale source files with missing explicit translations:')
    console.error(localeFindings.slice(0, 200).join('\n'))
  }
  console.error('Renderer i18n audit found CJK UI text that is not covered by explicit i18n keys, exact static text entries, registered legacy static text, or static text patterns:')
  console.error([...new Set(findings)].slice(0, 200).join('\n'))
  if (findings.length > 200) console.error(`... ${findings.length - 200} more`)
  process.exit(1)
}

console.log(`Renderer i18n audit passed (${trackedFiles.length} files checked).`)
