import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'

const root = resolve('docs/usage/best-practices')
const locales = ['zh-CN', 'en-US']
const expectedFiles = [
  '01-getting-started.md',
  '02-terminal-workspace.md',
  '03-host-agent.md',
  '04-agents-product-sessions.md',
  '05-ai-sessions.md',
  '06-quick-commands.md',
  '07-shortcuts.md',
  '08-export-mcp.md',
  '09-third-party-mcp.md',
  '10-files.md',
  '11-assets.md',
  '12-knowledge-base.md',
  '13-extensions.md',
  '14-kubernetes.md',
  '15-database.md',
  '16-themes.md',
  '17-troubleshooting.md'
]
const failures = []
const localeImageHashes = new Map(locales.map((locale) => [locale, new Map()]))

const requiredContent = {
  '02-terminal-workspace.md': [
    /\baio\b/,
    /\baiopen\b/,
    /\baiossh\b/,
    /\baioic\b/,
    /\baiobc\b/,
    /(新建主机|创建主机|create (?:a )?host|new host)/i,
    /(跳板|堡垒|jump host|bastion|relay)/i
  ],
  '03-host-agent.md': [/OpenAI Compatible/i, /Responses/i, /Check/, /Save/],
  '04-agents-product-sessions.md': [/(Codex|内嵌)/i, /Classic/i, /DB AI/i, /(恢复|restore)/i],
  '05-ai-sessions.md': [/(Hook|插件)/i, /(信任|trust)/i, /(完整对话|complete (?:session|transcript|conversation))/i, /(修改|edit|revise)/i],
  '09-third-party-mcp.md': [/Add Server/i, /mcpServers/, /streamableHttp/],
  '14-kubernetes.md': [/(发送输出到 AI|Send Output to AI)/i, /kubectl/i, /(不会自行调用大模型|does not invoke an LLM)/i],
  '15-database.md': [/DB AI/i, /(Explain|解释)/i, /(Optimize|优化)/i, /(Convert|转换)/i, /(Diagnose|诊断)/i]
}

const forbiddenContent = {
  '08-export-mcp.md': [/Add Server/i, /mcp_settings\.json/i, /streamableHttp/i],
  '17-troubleshooting.md': [/npm run/i, /AIOPSTERM_/, /renderer\./i, /probe:terminal-gpu/i]
}

const fail = (file, message) => failures.push(`${relative(process.cwd(), file)}: ${message}`)

const localTargets = (markdown) => {
  const targets = []
  const pattern = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g
  for (const match of markdown.matchAll(pattern)) targets.push(match[1])
  return targets
}

const imageTargets = (markdown) => [...markdown.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g)].map((match) => match[1])

const resolveLocalTarget = (sourceFile, href) => {
  if (/^(?:https?:|mailto:|tel:)/i.test(href) || href.startsWith('#')) return null
  let decoded = href.split('#', 1)[0].split('?', 1)[0]
  try {
    decoded = decodeURIComponent(decoded)
  } catch {
    fail(sourceFile, `链接不是有效的 URI：${href}`)
    return null
  }
  if (!decoded) return null
  const target = resolve(dirname(sourceFile), decoded)
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    fail(sourceFile, `本地链接越过使用指南目录：${href}`)
    return null
  }
  return target
}

for (const locale of locales) {
  const localeDir = join(root, locale)
  const actualFiles = readdirSync(localeDir).filter((name) => extname(name) === '.md').sort()
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    fail(localeDir, `文章清单必须严格为 01-17，当前为 ${actualFiles.join(', ')}`)
  }

  for (const [fileIndex, name] of actualFiles.entries()) {
    const file = join(localeDir, name)
    const markdown = readFileSync(file, 'utf8')
    const isOverview = name === '01-getting-started.md'
    const entryHeading = locale === 'zh-CN' ? '## 从哪里打开' : '## Where To Open It'
    const entryTrigger = locale === 'zh-CN'
      ? /(点击|双击|右键|菜单|快捷键|设置)/
      : /(click|double-click|right-click|menu|shortcut|settings)/i

    if (isOverview) {
      const entryCount = locale === 'zh-CN'
        ? (markdown.match(/\*\*入口：\*\*/g) || []).length
        : (markdown.match(/\*\*Entry:\*\*/g) || []).length
      if (entryCount < 12) fail(file, `总览至少要说明 12 个功能入口，当前为 ${entryCount}`)
    } else {
      const headingIndex = markdown.indexOf(entryHeading)
      if (headingIndex === -1) {
        fail(file, `缺少“${entryHeading.slice(3)}”章节`)
      } else {
        const entryBody = markdown.slice(headingIndex + entryHeading.length).split('\n## ')[0]
        if (!entryTrigger.test(entryBody)) fail(file, '入口章节没有说明需要操作的按钮、菜单、快捷键或设置项')
      }
    }

    const images = imageTargets(markdown)
    if (images.length === 0) fail(file, '缺少界面截图')
    for (const href of images) {
      const expectedPrefix = `../images/${locale}/`
      if (!href.startsWith(expectedPrefix)) {
        fail(file, `截图必须来自当前文档语言目录 ${expectedPrefix}，当前为 ${href}`)
        continue
      }
      const target = resolveLocalTarget(file, href)
      if (target && existsSync(target)) {
        localeImageHashes.get(locale).set(basename(target), createHash('sha256').update(readFileSync(target)).digest('hex'))
      }
    }
    for (const pattern of requiredContent[name] || []) {
      if (!pattern.test(markdown)) fail(file, `缺少必要内容：${pattern}`)
    }
    for (const pattern of forbiddenContent[name] || []) {
      if (pattern.test(markdown)) fail(file, `包含不属于本章的内容：${pattern}`)
    }
    const previousName = expectedFiles[fileIndex - 1]
    const nextName = expectedFiles[fileIndex + 1]
    if (previousName && !markdown.includes(`(${previousName})`)) fail(file, `缺少上一篇链接：${previousName}`)
    if (nextName && !markdown.includes(`(${nextName})`)) fail(file, `缺少下一篇链接：${nextName}`)
    for (const href of localTargets(markdown)) {
      const target = resolveLocalTarget(file, href)
      if (target && !existsSync(target)) fail(file, `链接目标不存在：${href}`)
    }
  }
}

for (const [name, zhHash] of localeImageHashes.get('zh-CN')) {
  const enHash = localeImageHashes.get('en-US').get(name)
  if (enHash && enHash === zhHash) {
    fail(join(root, 'images', 'en-US', name), '英文截图与中文截图完全相同，必须从英文界面重新截取')
  }
}

const indexFile = join(root, 'index.md')
const indexMarkdown = readFileSync(indexFile, 'utf8')
for (const locale of locales) {
  for (const name of expectedFiles) {
    const href = `${locale}/${name}`
    if (!indexMarkdown.includes(`(${href})`)) fail(indexFile, `目录缺少 ${href}`)
  }
}

if (failures.length > 0) {
  console.error(`Best-practices documentation audit failed (${failures.length}):`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Best-practices documentation audit passed: 17 bilingual guides, locale-specific screenshots, content boundaries, entry paths, and local links are complete.')
