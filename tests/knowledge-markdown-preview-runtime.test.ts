import { describe, expect, it, vi } from 'vitest'
import {
  renderKnowledgeMarkdownPreview,
  resolveKnowledgeMarkdownDocumentLink,
  resolveKnowledgeMarkdownResource,
  sanitizeKnowledgeMarkdownHtml
} from '@/services/knowledge/knowledgeMarkdownPreviewRuntime'

describe('knowledgeMarkdownPreviewRuntime', () => {
  it('sanitizes unsafe markdown html while preserving safe markdown presentation attributes', () => {
    const html = sanitizeKnowledgeMarkdownHtml(
      '<p onclick="bad()">hello</p><script>alert(1)</script><a href="javascript:bad()" title="x">bad</a><a href="https://example.test">ok</a><table><tbody><tr><td style="color:red;text-align:center">cell</td></tr></tbody></table>'
    )
    const doc = new DOMParser().parseFromString(html, 'text/html')

    expect(doc.querySelector('script')).toBeNull()
    expect(doc.querySelector('p')?.hasAttribute('onclick')).toBe(false)
    expect(doc.querySelectorAll('a')[0].hasAttribute('href')).toBe(false)
    expect(doc.querySelectorAll('a')[1].getAttribute('target')).toBe('_blank')
    expect(doc.querySelectorAll('a')[1].getAttribute('rel')).toBe('noreferrer')
    expect((doc.querySelector('td') as HTMLElement | null)?.style.textAlign).toBe('center')
  })

  it('resolves local markdown images relative to the current knowledge document', async () => {
    const loadImageDataUrl = vi.fn(async (relPath: string) =>
      relPath === 'docs/images/chart.png' ? 'data:image/png;base64,abc123' : null
    )
    const result = await renderKnowledgeMarkdownPreview({
      relPath: 'docs/runbook.md',
      content: '![chart](images/chart.png)\n\n```javascript\nconst answer = 42\n```\n\n```mermaid\nflowchart TD\nA-->B\n```',
      loadImageDataUrl
    })
    const doc = new DOMParser().parseFromString(result.html, 'text/html')

    expect(resolveKnowledgeMarkdownResource('../root.png', 'docs/guides/runbook.md')).toBe('docs/root.png')
    expect(loadImageDataUrl).toHaveBeenCalledWith('docs/images/chart.png')
    expect(doc.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,abc123')
    expect(doc.querySelector('code')?.classList.contains('hljs')).toBe(true)
    expect(doc.querySelector('code')?.classList.contains('language-javascript')).toBe(true)
    expect(doc.querySelector('.mermaid')?.textContent).toContain('flowchart TD')
    expect(result.hasMermaid).toBe(true)
  })

  it('preserves safe internal document links and resolves them without escaping the knowledge root', async () => {
    const result = await renderKnowledgeMarkdownPreview({
      relPath: '使用指南/index.md',
      content: '[中文](zh-CN/01-getting-started.md)\n\n[section](zh-CN/02-terminal-workspace.md#ssh-认证)\n\n[bad](javascript:alert(1))\n\n# SSH 认证',
      loadImageDataUrl: vi.fn(async () => null)
    })
    const doc = new DOMParser().parseFromString(result.html, 'text/html')
    const links = Array.from(doc.querySelectorAll('a'))

    expect(links[0].getAttribute('data-knowledge-doc-link')).toBe('zh-CN/01-getting-started.md')
    expect(links[0].hasAttribute('target')).toBe(false)
    expect(links[1].getAttribute('data-knowledge-doc-link')).toBe('zh-CN/02-terminal-workspace.md#ssh-%E8%AE%A4%E8%AF%81')
    expect(links[2].hasAttribute('href')).toBe(false)
    expect(doc.querySelector('h1')?.id).toBe('ssh-认证')
    expect(resolveKnowledgeMarkdownDocumentLink('../en-US/01-getting-started.md', '使用指南/zh-CN/index.md')).toEqual({
      relPath: '使用指南/en-US/01-getting-started.md',
      anchor: ''
    })
    expect(resolveKnowledgeMarkdownDocumentLink('../../../outside.md', '使用指南/zh-CN/index.md')).toBeNull()
    expect(resolveKnowledgeMarkdownDocumentLink('/absolute.md', '使用指南/index.md')).toBeNull()
  })
})
