import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  chipPartFromAiPanelChipElement,
  createAiPanelChipElement,
  createAiPanelCommandChipElement,
  createAiPanelContextChipElement,
  createAiPanelIconElement,
  createAiPanelImageElement,
  extractAiPanelContentPartsFromEditable,
  insertAiPanelChipIntoEditableCursor,
  insertAiPanelImageIntoEditableCursor,
  insertAiPanelPlainTextIntoEditableCursor,
  renderAiPanelMainEditableFromState,
  renderAiPanelPartsIntoEditable,
  syncAiPanelMainInputPartsFromEditable,
  type AiPanelEditableRenderOptions
} from '@/services/aiPanelEditableRuntime'
import type {
  AiChipContentPart,
  AiCommandChipContentPart,
  AiContentPart,
  AiContextKind,
  AiContextOption,
  AiDocChipContentPart,
  AiImageContentPart,
  AiSkillChipContentPart
} from '@shared/contracts/aiChat'

const renderOptions: AiPanelEditableRenderOptions = {
  iconMarkupByContextKind: {
    hosts: '<svg data-icon="host"></svg>',
    docs: '<svg data-icon="doc"></svg>',
    images: '<svg data-icon="image"></svg>',
    skills: '<svg data-icon="skill"></svg>',
    chats: '<svg data-icon="chat"></svg>'
  },
  commandIconMarkup: '<svg data-icon="command"></svg>'
}

const docPart: AiDocChipContentPart = {
  type: 'chip',
  chipType: 'doc',
  ref: {
    absPath: '/ops/runbook.md',
    relPath: 'docs/runbook.md',
    name: 'Runbook.md',
    type: 'file'
  }
}

const commandPart: AiCommandChipContentPart = {
  type: 'chip',
  chipType: 'command',
  ref: {
    command: '/rollback',
    label: 'Rollback',
    path: 'commands/rollback.md'
  }
}

const imagePart: AiImageContentPart = {
  type: 'image',
  mediaType: 'image/png',
  data: 'AAAA',
  name: 'diagram.png'
}

const createEditable = (text = '') => {
  const editable = document.createElement('div')
  editable.contentEditable = 'true'
  if (text) editable.appendChild(document.createTextNode(text))
  document.body.appendChild(editable)
  return editable
}

const setCaret = (editable: HTMLElement, node: Node, offset: number) => {
  const range = document.createRange()
  range.setStart(node, offset)
  range.collapse(true)
  const selection = window.getSelection()
  if (!selection) throw new Error('Selection API is unavailable')
  selection.removeAllRanges()
  selection.addRange(range)
  editable.focus()
}

afterEach(() => {
  document.body.replaceChildren()
  window.getSelection()?.removeAllRanges()
  vi.restoreAllMocks()
})

describe('aiPanelEditableRuntime', () => {
  it('creates chip and image DOM with the data boundary needed for later extraction', () => {
    expect(createAiPanelIconElement('docs', renderOptions).innerHTML).toContain('data-icon="doc"')
    expect(createAiPanelIconElement('command', renderOptions).innerHTML).toContain('data-icon="command"')

    const chatPart: AiChipContentPart = { type: 'chip', chipType: 'chat', ref: { taskId: 'chat-1', title: 'Incident chat' } }
    const skillPart: AiSkillChipContentPart = { type: 'chip', chipType: 'skill', ref: { skillName: 'ops-skill', description: 'triage' } }

    const docChip = createAiPanelChipElement(docPart, renderOptions, { removablePart: true })
    expect(docChip.className).toContain('mention-chip-doc')
    expect(docChip.dataset).toMatchObject({
      chipType: 'doc',
      absPath: '/ops/runbook.md',
      relPath: 'docs/runbook.md',
      name: 'Runbook.md',
      docType: 'file'
    })
    expect(docChip.querySelector('.mention-label')?.textContent).toBe('Runbook.md')
    expect(docChip.querySelector<HTMLElement>('[data-remove-chip="true"]')?.title).toBe('移除上下文')
    expect(chipPartFromAiPanelChipElement(docChip)).toEqual(docPart)

    const chatChip = createAiPanelChipElement(chatPart, renderOptions)
    expect(chatChip.dataset.chatId).toBe('chat-1')
    expect(chatChip.querySelector('.mention-icon')?.innerHTML).toContain('data-icon="chat"')
    expect(chipPartFromAiPanelChipElement(chatChip)).toEqual(chatPart)

    const commandChip = createAiPanelChipElement(commandPart, renderOptions, { removableCommand: true })
    expect(commandChip.dataset).toMatchObject({
      chipType: 'command',
      command: '/rollback',
      label: 'Rollback',
      path: 'commands/rollback.md',
      commandChip: 'true'
    })
    expect(commandChip.querySelector('.mention-icon')).toBeNull()
    expect(commandChip.querySelector<HTMLElement>('[data-remove-command="true"]')?.title).toBe('移除命令')
    expect(chipPartFromAiPanelChipElement(commandChip)).toEqual(commandPart)

    const skillChip = createAiPanelChipElement(skillPart, renderOptions)
    expect(skillChip.dataset).toMatchObject({ chipType: 'skill', skillName: 'ops-skill', description: 'triage' })
    expect(chipPartFromAiPanelChipElement(skillChip)).toEqual(skillPart)

    const imageElement = createAiPanelImageElement(imagePart)
    expect(imageElement.dataset).toMatchObject({
      imageType: 'true',
      mediaType: 'image/png',
      imageData: 'AAAA',
      name: 'diagram.png'
    })
    expect(imageElement.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AAAA')
    expect(imageElement.querySelector('img')?.alt).toBe('diagram.png')
    expect(imageElement.querySelector<HTMLElement>('[data-remove-image="true"]')?.title).toBe('移除图片')
  })

  it('creates removable context and command chips without leaking component state into the DOM runtime', () => {
    const docContext: AiContextOption = {
      id: 'doc-context',
      kind: 'docs',
      label: 'Runbook.md',
      relPath: 'docs/runbook.md',
      contextType: 'file'
    }
    const imageContext: AiContextOption = {
      id: 'image-context',
      kind: 'images',
      label: 'Diagram',
      mediaType: 'image/webp',
      data: 'BBBB'
    }

    const docContextChip = createAiPanelContextChipElement(docContext, renderOptions)
    expect(docContextChip.dataset.contextId).toBe('doc-context')
    expect(docContextChip.dataset.chipType).toBe('doc')
    expect(docContextChip.querySelector<HTMLElement>('[data-remove-context="true"]')?.dataset.contextId).toBe('doc-context')

    const imageContextChip = createAiPanelContextChipElement(imageContext, renderOptions)
    expect(imageContextChip.dataset).toMatchObject({ contextId: 'image-context', contextKind: 'images' })
    expect(imageContextChip.querySelector('.mention-icon')?.innerHTML).toContain('data-icon="image"')
    expect(imageContextChip.querySelector('img')?.getAttribute('src')).toBe('data:image/webp;base64,BBBB')
    expect(imageContextChip.querySelector<HTMLElement>('[data-remove-context="true"]')?.title).toBe('移除上下文')

    const selectedCommandChip = createAiPanelCommandChipElement({ command: '/diagnose', label: 'Diagnose', path: 'commands/diagnose.md' }, renderOptions)
    expect(selectedCommandChip?.dataset).toMatchObject({
      commandChip: 'true',
      command: '/diagnose',
      label: 'Diagnose',
      path: 'commands/diagnose.md'
    })
    expect(createAiPanelCommandChipElement(null, renderOptions)).toBeNull()
  })

  it('inserts chips, images, and plain text at the editable cursor', () => {
    const chipEditable = createEditable('/')
    setCaret(chipEditable, chipEditable.firstChild as Text, 1)
    const onChipInserted = vi.fn()
    expect(insertAiPanelChipIntoEditableCursor(chipEditable, docPart, renderOptions, onChipInserted)).toBe(true)
    expect(onChipInserted).toHaveBeenCalledTimes(1)
    expect(chipEditable.textContent).not.toContain('/')
    expect(chipEditable.querySelector<HTMLElement>('.mention-chip-doc')?.dataset.absPath).toBe('/ops/runbook.md')

    const imageEditable = createEditable('show ')
    setCaret(imageEditable, imageEditable.firstChild as Text, 5)
    const onImageInserted = vi.fn()
    expect(insertAiPanelImageIntoEditableCursor(imageEditable, imagePart, onImageInserted)).toBe(true)
    expect(onImageInserted).toHaveBeenCalledTimes(1)
    expect(imageEditable.querySelector<HTMLElement>('.image-preview-wrapper')?.dataset.imageData).toBe('AAAA')

    const textEditable = createEditable('deploy')
    setCaret(textEditable, textEditable.firstChild as Text, 6)
    const onTextInserted = vi.fn()
    insertAiPanelPlainTextIntoEditableCursor(textEditable, ' now', onTextInserted)
    expect(onTextInserted).toHaveBeenCalledTimes(1)
    expect(textEditable.textContent).toBe('deploy now')
  })

  it('renders, extracts, and syncs editable content parts across text, docs, images, and commands', () => {
    const editable = createEditable()
    const parts: AiContentPart[] = [{ type: 'text', text: 'deploy' }, docPart, imagePart, commandPart]
    renderAiPanelPartsIntoEditable(editable, parts, renderOptions)

    const extracted = extractAiPanelContentPartsFromEditable(editable)
    expect(extracted).toEqual([{ type: 'text', text: 'deploy ' }, docPart, imagePart, commandPart])

    const docContext: AiContextOption = {
      id: 'doc-context',
      kind: 'docs',
      label: 'Guide.md',
      relPath: 'docs/guide.md',
      contextType: 'file'
    }
    const imageContext: AiContextOption = {
      id: 'image-context',
      kind: 'images',
      label: 'Diagram',
      mediaType: 'image/png',
      data: 'CCCC'
    }
    const contextById = (id: string) => (id === docContext.id ? docContext : id === imageContext.id ? imageContext : null)
    const contextEditable = createEditable()
    contextEditable.appendChild(createAiPanelContextChipElement(docContext, renderOptions))
    contextEditable.appendChild(createAiPanelContextChipElement(imageContext, renderOptions))
    expect(extractAiPanelContentPartsFromEditable(contextEditable, { contextById })).toEqual([
      {
        type: 'chip',
        chipType: 'doc',
        ref: { absPath: 'docs/guide.md', relPath: 'docs/guide.md', name: 'Guide.md', type: 'file' }
      },
      { type: 'image', mediaType: 'image/png', data: 'CCCC', name: 'Diagram' }
    ])

    const mainEditable = createEditable()
    renderAiPanelMainEditableFromState(
      mainEditable,
      {
        draft: 'rollback',
        images: [imagePart],
        files: [docPart],
        command: commandPart.ref
      },
      renderOptions
    )
    expect(syncAiPanelMainInputPartsFromEditable(mainEditable)).toEqual({
      commandPresent: true,
      files: [docPart],
      images: [imagePart]
    })
  })
})
