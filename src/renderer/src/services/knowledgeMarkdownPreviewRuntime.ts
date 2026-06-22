import { marked } from 'marked'
import hljs from 'highlight.js'
import {
  createKnowledgeEditorRelPath,
  getKnowledgeEditorParentRelDir,
  normalizeKnowledgeEditorRelPath
} from '@/services/knowledgeEditorPathRuntime'

type KnowledgeMarkdownRenderOptions = {
  content: string
  relPath: string
  loadImageDataUrl: (relPath: string) => Promise<string | null>
}

export type KnowledgeMarkdownRenderResult = {
  html: string
  hasMermaid: boolean
}

const allowedTableAlignments = new Set(['left', 'center', 'right', 'justify'])
const allowedMarkdownTags = new Set([
  'a',
  'blockquote',
  'br',
  'code',
  'del',
  'div',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'img',
  'input',
  'li',
  'ol',
  'p',
  'pre',
  'span',
  'strong',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'ul'
])
const removedMarkdownTags = new Set(['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta'])
const markdownTagAttributes: Record<string, Set<string>> = {
  a: new Set(['href', 'rel', 'target', 'title']),
  code: new Set(['class']),
  div: new Set(['class']),
  img: new Set(['alt', 'src', 'title']),
  input: new Set(['checked', 'disabled', 'type']),
  span: new Set(['class']),
  td: new Set(['style']),
  th: new Set(['style'])
}
const markdownClassPattern = /^(hljs|hljs-[\w-]+|language-[\w-]+|mermaid|contains-task-list|task-list-item)$/i

export const isLocalKnowledgeMarkdownResource = (src: string) => Boolean(src) && !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(src)

export const resolveKnowledgeMarkdownResource = (src: string, relPath: string) => {
  const cleanSrc = src.split(/[?#]/, 1)[0] || ''
  if (cleanSrc.startsWith('/')) return normalizeKnowledgeEditorRelPath(cleanSrc.replace(/^\/+/, ''))
  return normalizeKnowledgeEditorRelPath(createKnowledgeEditorRelPath(getKnowledgeEditorParentRelDir(relPath), cleanSrc))
}

const isSafeMarkdownUrl = (value: string, kind: 'href' | 'src') => {
  const url = value.trim()
  if (!url) return false
  if (kind === 'href') return /^(https?:|mailto:|#)/i.test(url)
  return /^(https?:|blob:|data:image\/)/i.test(url)
}

const sanitizeStyle = (value: string) => {
  const declarations = value
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
  const safe = declarations.filter((entry) => {
    const [property, rawValue] = entry.split(':').map((part) => part.trim().toLowerCase())
    return property === 'text-align' && Boolean(rawValue) && allowedTableAlignments.has(rawValue)
  })
  return safe.join('; ')
}

const sanitizeClassValue = (value: string) =>
  value
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter((entry) => markdownClassPattern.test(entry))
    .join(' ')

const sanitizeMarkdownElement = (element: Element) => {
  const tag = element.tagName.toLowerCase()
  if (removedMarkdownTags.has(tag)) {
    element.remove()
    return
  }
  if (!allowedMarkdownTags.has(tag)) {
    element.replaceWith(...Array.from(element.childNodes))
    return
  }

  const allowedAttrs = markdownTagAttributes[tag] || new Set<string>()
  for (const attr of Array.from(element.attributes)) {
    const name = attr.name.toLowerCase()
    const value = attr.value
    if (name.startsWith('on') || !allowedAttrs.has(name)) {
      element.removeAttribute(attr.name)
      continue
    }
    if (name === 'href') {
      if (isSafeMarkdownUrl(value, 'href')) {
        element.setAttribute('target', '_blank')
        element.setAttribute('rel', 'noreferrer')
      } else {
        element.removeAttribute(attr.name)
      }
    } else if (name === 'src') {
      if (!isSafeMarkdownUrl(value, 'src')) element.removeAttribute(attr.name)
    } else if (name === 'style') {
      const cleanStyle = sanitizeStyle(value)
      if (cleanStyle) element.setAttribute('style', cleanStyle)
      else element.removeAttribute(attr.name)
    } else if (name === 'class') {
      const cleanClass = sanitizeClassValue(value)
      if (cleanClass) element.setAttribute('class', cleanClass)
      else element.removeAttribute(attr.name)
    } else if (tag === 'input') {
      if (name === 'type' && value !== 'checkbox') element.removeAttribute(attr.name)
      if (name === 'checked') element.setAttribute('checked', '')
      if (name === 'disabled') element.setAttribute('disabled', '')
    }
  }

  if (tag === 'a') {
    const href = element.getAttribute('href')
    if (href && isSafeMarkdownUrl(href, 'href')) {
      element.setAttribute('target', '_blank')
      element.setAttribute('rel', 'noreferrer')
    }
  }
  if (tag === 'input') {
    element.setAttribute('disabled', '')
  }
}

export const sanitizeKnowledgeMarkdownHtml = (html: string) => {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  for (const element of Array.from(doc.body.querySelectorAll('*'))) {
    sanitizeMarkdownElement(element)
  }
  return doc.body.innerHTML
}

const replaceLocalMarkdownImages = async (doc: Document, options: KnowledgeMarkdownRenderOptions) => {
  const tasks = Array.from(doc.querySelectorAll('img')).map(async (img) => {
    const src = img.getAttribute('src') || ''
    if (!isLocalKnowledgeMarkdownResource(src)) return
    const imageRelPath = resolveKnowledgeMarkdownResource(src, options.relPath)
    if (!imageRelPath) return
    const dataUrl = await options.loadImageDataUrl(imageRelPath)
    if (dataUrl) img.setAttribute('src', dataUrl)
  })
  await Promise.all(tasks)
}

const normalizeTableAlignments = (doc: Document) => {
  for (const cell of Array.from(doc.querySelectorAll('th[align], td[align]'))) {
    const align = (cell.getAttribute('align') || '').toLowerCase()
    cell.removeAttribute('align')
    if (allowedTableAlignments.has(align)) cell.setAttribute('style', `text-align: ${align}`)
  }
}

const highlightCodeBlocks = (doc: Document) => {
  let hasMermaid = false
  for (const code of Array.from(doc.querySelectorAll<HTMLElement>('pre code'))) {
    const languageClass = Array.from(code.classList).find((className) => className.startsWith('language-'))
    const language = languageClass?.replace(/^language-/, '').toLowerCase()
    const source = code.textContent || ''

    if (language === 'mermaid') {
      const container = doc.createElement('div')
      container.className = 'mermaid'
      container.textContent = source
      code.parentElement?.replaceWith(container)
      hasMermaid = true
      continue
    }

    const highlighted = language && hljs.getLanguage(language) ? hljs.highlight(source, { language }) : hljs.highlightAuto(source)
    code.innerHTML = highlighted.value
    code.classList.add('hljs')
    if (language) code.classList.add(`language-${language}`)
  }
  return hasMermaid
}

export const renderKnowledgeMarkdownPreview = async (options: KnowledgeMarkdownRenderOptions): Promise<KnowledgeMarkdownRenderResult> => {
  const rawHtml = await marked.parse(options.content || '', {
    async: false,
    gfm: true,
    breaks: false
  })
  const parser = new DOMParser()
  const doc = parser.parseFromString(String(rawHtml), 'text/html')
  await replaceLocalMarkdownImages(doc, options)
  normalizeTableAlignments(doc)
  const hasMermaid = highlightCodeBlocks(doc)
  return {
    html: sanitizeKnowledgeMarkdownHtml(doc.body.innerHTML),
    hasMermaid
  }
}
