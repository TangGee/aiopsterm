import { describe, expect, it } from 'vitest'
import {
  aiChipPartFromContext,
  aiImagePartFromContext,
  editablePlainTextFromElement,
  fallbackAiContentPartsForMessage,
  hasSendableAiContent,
  hasStructuredAiContentParts,
  mergeAdjacentTextContentParts,
  plainTextFromAiContentParts,
  selectedVisibleHostAiContexts,
  sendableAiContentParts,
  splitAiContentInputParts,
  toggleHostAiContextInList
} from '@/services/aiPanelInputRuntime'
import type { AiContentPart, AiContextOption } from '@shared/contracts/aiChat'

const host = (input: Partial<AiContextOption> & Pick<AiContextOption, 'id' | 'label'>): AiContextOption => ({
  kind: 'hosts',
  ...input
})

describe('aiPanelInputRuntime', () => {
  it('turns structured content parts into plain text for display and prompt fallbacks', () => {
    const parts: AiContentPart[] = [
      { type: 'text', text: 'check ' },
      { type: 'chip', chipType: 'doc', ref: { absPath: '/runbook.md', relPath: 'runbook.md', name: 'Runbook.md' } },
      { type: 'chip', chipType: 'chat', ref: { taskId: 'task-1', title: 'Incident chat' } },
      { type: 'chip', chipType: 'command', ref: { command: '/rollback', label: '/rollback' } },
      { type: 'chip', chipType: 'skill', ref: { skillName: 'ops-skill' } },
      { type: 'image', mediaType: 'image/png', data: 'abc', name: 'diagram.png' }
    ]
    expect(plainTextFromAiContentParts(parts)).toBe('check @Runbook.md@Incident chat/rollback@skill:ops-skill[image: diagram.png]')
    expect(plainTextFromAiContentParts(parts, { compactImage: true })).toBe('check @Runbook.md@Incident chat/rollback@skill:ops-skill[image]')
    expect(plainTextFromAiContentParts(parts, { mode: 'exchange' })).toBe('check @/runbook.md@task-1_Incident chat/rollback@skill:ops-skill[image]')
  })

  it('normalizes content parts for sendability and message editing fallbacks', () => {
    const parts: AiContentPart[] = [
      { type: 'text', text: '  ' },
      { type: 'text', text: 'hello' },
      { type: 'text', text: ' world' },
      { type: 'image', mediaType: 'image/png', data: 'abc' }
    ]
    expect(sendableAiContentParts(parts)).toEqual(parts.slice(1))
    expect(hasStructuredAiContentParts(parts)).toBe(true)
    expect(hasSendableAiContent(parts)).toBe(true)
    expect(mergeAdjacentTextContentParts(parts.slice(1))).toEqual([{ type: 'text', text: 'hello world' }, parts[3]])
    expect(fallbackAiContentPartsForMessage({ text: 'fallback' })).toEqual([{ type: 'text', text: 'fallback' }])
    expect(fallbackAiContentPartsForMessage({ text: 'fallback', contentParts: [parts[3]] })).toEqual([parts[3]])
    expect(splitAiContentInputParts(parts)).toEqual({ images: [parts[3]], docs: [] })
  })

  it('projects context options into chips, image parts, and host selections', () => {
    expect(aiChipPartFromContext({ id: 'doc-1', kind: 'docs', label: 'Guide.md', relPath: 'docs/Guide.md' })).toEqual({
      type: 'chip',
      chipType: 'doc',
      ref: { absPath: 'docs/Guide.md', relPath: 'docs/Guide.md', name: 'Guide.md', type: 'file' }
    })
    expect(aiChipPartFromContext({ id: 'chat:task-1', kind: 'chats', label: 'Task chat' })).toEqual({
      type: 'chip',
      chipType: 'chat',
      ref: { taskId: 'task-1', title: 'Task chat' }
    })
    expect(aiChipPartFromContext({ id: 'skill-1', kind: 'skills', label: 'Ops Skill', detail: 'triage' })).toEqual({
      type: 'chip',
      chipType: 'skill',
      ref: { skillName: 'Ops Skill', description: 'triage' }
    })
    expect(aiImagePartFromContext({ id: 'img-1', kind: 'images', label: 'chart', mediaType: 'image/webp', data: 'abc' })).toEqual({
      type: 'image',
      mediaType: 'image/webp',
      data: 'abc',
      name: 'chart'
    })

    const local = host({ id: 'opened-local', label: '127.0.0.1' })
    const prod = host({ id: 'prod', label: '10.0.0.8' })
    const stage = host({ id: 'stage', label: '10.0.0.9' })
    expect(toggleHostAiContextInList([local], prod, 2)).toEqual([prod])
    expect(toggleHostAiContextInList([prod], prod, 2)).toEqual([])
    expect(toggleHostAiContextInList([prod, stage], host({ id: 'extra', label: '10.0.0.10' }), 2)).toEqual([prod, stage])
    expect(selectedVisibleHostAiContexts([local], [local, prod, stage], 2)).toEqual([prod, stage])
  })

  it('extracts editable plain text while ignoring chips and images', () => {
    const editable = document.createElement('div')
    editable.appendChild(document.createTextNode('hello'))
    editable.appendChild(document.createElement('br'))
    const chip = document.createElement('span')
    chip.className = 'mention-chip'
    chip.textContent = '@ignored'
    editable.appendChild(chip)
    const image = document.createElement('span')
    image.dataset.imageType = 'image/png'
    image.textContent = 'image ignored'
    editable.appendChild(image)
    editable.appendChild(document.createTextNode('\u00a0world'))
    expect(editablePlainTextFromElement(editable)).toBe('hello\n world')
  })
})
