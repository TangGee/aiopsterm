import { marked } from 'marked'
import { highlightAutoValue, hljs } from '@/services/common/highlightRuntime'

const removedMarkdownTags = new Set(['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'svg', 'math', 'form', 'input'])
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
  'li',
  'ol',
  'p',
  'pre',
  's',
  'span',
  'strong',
  'sub',
  'sup',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'ul'
])
const markdownTagAttributes: Record<string, Set<string>> = {
  a: new Set(['href', 'rel', 'target', 'title']),
  code: new Set(['class']),
  div: new Set(['class']),
  span: new Set(['class', 'style']),
  td: new Set(['style']),
  th: new Set(['style'])
}
const allowedTableAlignments = new Set(['left', 'right', 'center', 'justify'])
const markdownClassPattern = /^(hljs|hljs-[a-z0-9_-]+|language-[a-z0-9_-]+)$/i

const isInternalMarkdownHref = (value: string) => {
  const href = value.trim()
  return Boolean(href) && !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(href) && /\.(md|markdown)(?:[?#].*)?$/i.test(href)
}

const isSafeMarkdownHref = (value: string) => /^(https?:|mailto:|#)/i.test(value.trim()) || isInternalMarkdownHref(value)

const sanitizeStyle = (value: string) =>
  value
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry) => {
      const [property, rawValue] = entry.split(':').map((part) => part.trim().toLowerCase())
      return property === 'text-align' && allowedTableAlignments.has(rawValue)
    })
    .join('; ')

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
      if (!isSafeMarkdownHref(value)) element.removeAttribute(attr.name)
    } else if (name === 'style') {
      const cleanStyle = sanitizeStyle(value)
      if (cleanStyle) element.setAttribute('style', cleanStyle)
      else element.removeAttribute(attr.name)
    } else if (name === 'class') {
      const cleanClass = sanitizeClassValue(value)
      if (cleanClass) element.setAttribute('class', cleanClass)
      else element.removeAttribute(attr.name)
    }
  }

  if (tag === 'a') {
    const href = element.getAttribute('href')
    if (href && isSafeMarkdownHref(href)) {
      if (isInternalMarkdownHref(href)) {
        element.setAttribute('data-settings-doc-link', href)
        element.removeAttribute('target')
        element.removeAttribute('rel')
      } else {
        element.setAttribute('target', '_blank')
        element.setAttribute('rel', 'noreferrer')
      }
    }
  }
}

export const sanitizeMarkdownHtml = (html: string) => {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  for (const element of Array.from(doc.body.querySelectorAll('*'))) {
    sanitizeMarkdownElement(element)
  }
  return doc.body.innerHTML
}

const highlightCodeBlocks = (doc: Document) => {
  for (const code of Array.from(doc.querySelectorAll<HTMLElement>('pre code'))) {
    const languageClass = Array.from(code.classList).find((className) => className.startsWith('language-'))
    const language = languageClass?.replace(/^language-/, '').toLowerCase()
    const source = code.textContent || ''
    try {
      const highlightedValue =
        language && hljs.getLanguage(language) ? hljs.highlight(source, { language, ignoreIllegals: true }).value : highlightAutoValue(source)
      if (highlightedValue !== null) code.innerHTML = highlightedValue
      code.classList.add('hljs')
      if (language) code.classList.add(`language-${language}`)
    } catch {
      code.textContent = source
    }
  }
}

export const renderMarkdownDocumentHtml = (content: string) => {
  const rawHtml = marked.parse(content || '', {
    async: false,
    gfm: true,
    breaks: false
  }) as string
  const parser = new DOMParser()
  const doc = parser.parseFromString(String(rawHtml), 'text/html')
  highlightCodeBlocks(doc)
  return sanitizeMarkdownHtml(doc.body.innerHTML)
}
