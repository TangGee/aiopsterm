import { describe, expect, it } from 'vitest'
import {
  addCompletedKnowledgeImportJob,
  cloneKnowledgeNodes,
  filterKnowledgeTree,
  findKnowledgeNode,
  getKnowledgeFileExtension,
  getKnowledgeParent,
  isKnowledgeImagePath,
  knowledgeCapacityPercent,
  knowledgeContentSearchVisible,
  knowledgeEntryToNode,
  knowledgeRelPathParentMatches,
  knowledgeTransferProgressPercent,
  mediaTypeFromKnowledgePath,
  missingKnowledgeRelPaths,
  pruneKnowledgeUiState,
  removeKnowledgeImportJob,
  resolveKnowledgePasteTarget,
  selectKnowledgeNodeKeys,
  uniqueKnowledgeFileName,
  upsertKnowledgeImportJob,
  type KnowledgeImportJob
} from '@/services/knowledgeRuntime'
import type { KnowledgeNode } from '@shared/contracts/knowledgeBase'

const tree: KnowledgeNode[] = [
  {
    id: 'kb-commands',
    key: 'commands',
    relPath: 'commands',
    title: 'commands',
    type: 'dir',
    children: [
      {
        id: 'kb-commands-diagnose-md',
        key: 'commands/diagnose.md',
        relPath: 'commands/diagnose.md',
        title: 'diagnose.md',
        type: 'file',
        size: 100
      },
      {
        id: 'kb-commands-summary-md',
        key: 'commands/Summary.md',
        relPath: 'commands/Summary.md',
        title: 'Summary.md',
        type: 'file',
        size: 200
      }
    ]
  },
  {
    id: 'kb-images',
    key: 'images',
    relPath: 'images',
    title: 'images',
    type: 'dir',
    children: [
      {
        id: 'kb-images-interface-png',
        key: 'images/interface.png',
        relPath: 'images/interface.png',
        title: 'interface.png',
        type: 'file',
        size: 300
      }
    ]
  }
]

describe('knowledgeRuntime', () => {
  it('clones, converts, finds, and filters knowledge tree nodes without aliasing inputs', () => {
    const cloned = cloneKnowledgeNodes(tree)
    cloned[0].children![0].title = 'changed.md'
    expect(tree[0].children![0].title).toBe('diagnose.md')

    expect(knowledgeEntryToNode({ name: 'runbook.md', relPath: 'docs/runbook.md', type: 'file', size: 42 })).toEqual({
      id: 'kb-docs-runbook-md',
      key: 'docs/runbook.md',
      relPath: 'docs/runbook.md',
      title: 'runbook.md',
      type: 'file',
      size: 42
    })
    expect(knowledgeEntryToNode({ name: 'docs', relPath: 'docs', type: 'dir' })).toEqual({
      id: 'kb-docs',
      key: 'docs',
      relPath: 'docs',
      title: 'docs',
      type: 'dir',
      children: []
    })

    expect(findKnowledgeNode(tree, 'commands/diagnose.md')?.title).toBe('diagnose.md')
    expect(findKnowledgeNode(tree, 'missing.md')).toBeNull()
    expect(filterKnowledgeTree(tree, 'INTERFACE')).toEqual([
      {
        ...tree[1],
        children: [tree[1].children![0]]
      }
    ])
    expect(filterKnowledgeTree(tree, '').map((node) => node.relPath)).toEqual(['commands', 'images'])
  })

  it('resolves selection, parent paths, paste targets, missing paths, and pruned UI keys', () => {
    expect(selectKnowledgeNodeKeys(['a'], 'b')).toEqual(['b'])
    expect(selectKnowledgeNodeKeys(['a'], 'b', true)).toEqual(['a', 'b'])
    expect(selectKnowledgeNodeKeys(['a', 'b'], 'b', true)).toEqual(['a'])

    expect(getKnowledgeParent('commands/diagnose.md')).toBe('commands')
    expect(getKnowledgeParent('root.md')).toBe('')
    expect(knowledgeRelPathParentMatches('commands/diagnose.md', '/commands/')).toBe(true)
    expect(knowledgeRelPathParentMatches('commands/diagnose.md', 'images')).toBe(false)

    expect(resolveKnowledgePasteTarget('commands/diagnose.md', tree[0].children![0])).toBe('commands')
    expect(resolveKnowledgePasteTarget('commands', tree[0])).toBe('commands')

    expect(missingKnowledgeRelPaths(tree, ['commands', 'missing.md', 'missing.md'])).toEqual(['missing.md'])
    expect(pruneKnowledgeUiState(['commands/diagnose.md', 'images/interface.png'], ['commands', 'images'], ['commands'])).toEqual({
      selectedKeys: ['images/interface.png'],
      expandedKeys: ['images']
    })
  })

  it('calculates search visibility, capacity, media metadata, progress, and import jobs', () => {
    expect(knowledgeContentSearchVisible('a')).toBe(false)
    expect(knowledgeContentSearchVisible(' ab ')).toBe(true)
    expect(knowledgeCapacityPercent(25, 100)).toBe(25)
    expect(knowledgeCapacityPercent(150, 100)).toBe(100)

    expect(getKnowledgeFileExtension('images/interface.PNG')).toBe('.png')
    expect(isKnowledgeImagePath('images/interface.webp')).toBe(true)
    expect(isKnowledgeImagePath('commands/diagnose.md')).toBe(false)
    expect(mediaTypeFromKnowledgePath('images/interface.svg')).toBe('image/svg+xml')
    expect(mediaTypeFromKnowledgePath('commands/diagnose.md')).toBe('application/octet-stream')

    expect(knowledgeTransferProgressPercent(25, 50)).toBe(50)
    expect(knowledgeTransferProgressPercent(5, 0)).toBe(100)

    const first = upsertKnowledgeImportJob([], { jobId: 'job-1', destRelPath: 'commands/a.md', transferred: 25, total: 100 })
    expect(first).toEqual({
      percent: 25,
      jobs: [{ id: 'job-1', destRelPath: 'commands/a.md', percent: 25 }]
    })
    const updated = upsertKnowledgeImportJob(first.jobs, { jobId: 'job-1', destRelPath: 'commands/a.md', transferred: 100, total: 100 })
    expect(updated.jobs).toEqual([{ id: 'job-1', destRelPath: 'commands/a.md', percent: 100 }])

    const jobs: KnowledgeImportJob[] = addCompletedKnowledgeImportJob(updated.jobs, 'job-2', 'images/new.png')
    expect(jobs).toEqual([
      { id: 'job-1', destRelPath: 'commands/a.md', percent: 100 },
      { id: 'job-2', destRelPath: 'images/new.png', percent: 100 }
    ])
    expect(removeKnowledgeImportJob(jobs, 'job-1')).toEqual([{ id: 'job-2', destRelPath: 'images/new.png', percent: 100 }])
  })

  it('creates unique knowledge file names inside a target folder', () => {
    expect(uniqueKnowledgeFileName(tree, 'commands', 'diagnose.md')).toBe('diagnose-1.md')
    expect(uniqueKnowledgeFileName(tree, 'commands', 'new.md')).toBe('new.md')
    expect(uniqueKnowledgeFileName(tree, '', 'commands')).toBe('commands-1')
  })
})
