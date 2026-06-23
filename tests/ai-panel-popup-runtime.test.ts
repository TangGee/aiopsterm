import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import {
  allVisibleAiPanelHostsSelected,
  backAiPanelDocsDir,
  clearAiPanelHostContexts,
  cloneAiPanelCommandOptions,
  cloneAiPanelContextCategories,
  createAiPanelPopupViewRuntime,
  enterAiPanelDocsDir,
  filteredAiPanelCommands,
  filteredAiPanelContextOptions,
  filteredAiPanelOpenedHosts,
  mainContextKeyboardSelection,
  modelMatchesAiPanelQuery,
  nextAiPanelPopupKeyboardIndex,
  planAiPanelCommandApply,
  planAiPanelContextApply,
  resetAiPanelDocsNavigation,
  selectedAiPanelCommand,
  selectedAiPanelCommandRef,
  selectedAiPanelContextCategory,
  selectedAiPanelVisibleHostContexts,
  sortedAiPanelDocsContextOptions,
  visibleAiPanelContextCategories,
  visibleAiPanelHostContextOptions
} from '@/services/ai/aiPanelPopupRuntime'
import type { AiCommandCatalogOption, AiContextCategoryInfo, AiContextOption } from '@shared/contracts/aiChat'

const host = (input: Partial<AiContextOption> & Pick<AiContextOption, 'id' | 'label'>): AiContextOption => ({
  kind: 'hosts',
  ...input
})

const doc = (input: Partial<AiContextOption> & Pick<AiContextOption, 'id' | 'label'>): AiContextOption => ({
  kind: 'docs',
  contextType: 'doc',
  ...input
})

const command = (input: Partial<AiCommandCatalogOption> & Pick<AiCommandCatalogOption, 'id' | 'name' | 'command'>): AiCommandCatalogOption => ({
  label: input.name,
  path: `${input.id}.md`,
  ...input
})

describe('aiPanelPopupRuntime', () => {
  it('projects context and command popup view state through one runtime boundary', () => {
    const level = ref<'main' | 'hosts' | 'docs' | 'images' | 'skills' | 'chats'>('docs')
    const query = ref('')
    const commandQuery = ref('')
    const chatMode = ref<'agent' | 'cmd'>('agent')
    const contextTarget = ref<'main' | 'edit'>('main')
    const selectedCommandId = ref<string | null>('rollback')
    const categories: AiContextCategoryInfo[] = [
      { id: 'hosts', label: 'Hosts', options: [host({ id: 'prod', label: '10.0.0.8', detail: 'prod' })] },
      {
        id: 'docs',
        label: 'Docs',
        options: [
          doc({ id: 'file-root', label: 'Runbook.md', relPath: 'Runbook.md', parentRelPath: '' }),
          doc({ id: 'dir', label: 'commands', contextType: 'dir', relPath: 'commands', parentRelPath: '' })
        ]
      }
    ]
    const commands = [command({ id: 'rollback', name: 'rollback-plan', command: '/rollback' }), command({ id: 'summary', name: 'Summary to Doc', command: '/summary' })]
    const runtime = createAiPanelPopupViewRuntime({
      categories: () => categories,
      commandOptions: () => commands,
      openedHosts: () => [host({ id: 'prod', label: '10.0.0.8', detail: 'prod' })],
      selectedContexts: () => [host({ id: 'prod', label: '10.0.0.8', detail: 'prod' })],
      editHostContexts: () => [],
      skillOptions: () => [doc({ id: 'skill-doc', label: 'Skill.md' })],
      selectedCommandId: () => selectedCommandId.value,
      selectedCommandRef: () => null,
      contextTarget: () => contextTarget.value,
      contextLevel: () => level.value,
      contextQuery: () => query.value,
      commandQuery: () => commandQuery.value,
      docsCurrentRelDir: () => '',
      chatMode: () => chatMode.value,
      iconForKind: (kind) => `icon:${kind}`
    })

    expect(runtime.aiContextCategories.value[0]).toMatchObject({ id: 'hosts', icon: 'icon:hosts' })
    expect(runtime.selectedContextCategory.value?.id).toBe('docs')
    expect(runtime.docsContextOptions.value.map((option) => option.label)).toEqual(['commands', 'Runbook.md'])
    expect(runtime.visibleContextCategories.value.map((category) => category.id)).toEqual(['hosts', 'docs'])
    expect(runtime.filteredContextOptions.value.map((option) => option.label)).toEqual(['commands', 'Runbook.md'])
    expect(runtime.displayedOpenedHosts.value.map((option) => option.id)).toEqual(['prod'])
    expect(runtime.visibleHostContextOptions.value).toEqual([])
    expect(runtime.hostContextsForPopup.value.map((context) => context.id)).toEqual(['prod'])
    expect(runtime.allVisibleHostContextsSelected.value).toBe(false)
    expect(runtime.filteredCommands.value.map((preset) => preset.id)).toEqual(['rollback', 'summary'])
    expect(runtime.selectedCommand.value?.id).toBe('rollback')
    expect(runtime.selectedCommandRef.value).toEqual({ command: '/rollback', label: 'rollback-plan', path: 'rollback.md' })

    level.value = 'hosts'
    query.value = 'prod'
    commandQuery.value = 'sum'
    chatMode.value = 'cmd'
    contextTarget.value = 'edit'
    selectedCommandId.value = 'missing-command'

    expect(runtime.visibleContextCategories.value.map((category) => category.id)).toEqual(['docs'])
    expect(runtime.filteredContextOptions.value.map((option) => option.id)).toEqual(['prod'])
    expect(runtime.visibleHostContextOptions.value.map((option) => option.id)).toEqual(['prod'])
    expect(runtime.hostContextsForPopup.value).toEqual([])
    expect(runtime.filteredCommands.value.map((preset) => preset.id)).toEqual(['summary'])
    expect(runtime.selectedCommand.value).toBeNull()
    expect(runtime.selectedCommandRef.value).toEqual({ command: 'missing-command', label: 'missing-command' })
  })

  it('filters context categories, opened hosts, docs options, commands, and models', () => {
    const categories: AiContextCategoryInfo[] = [
      { id: 'hosts', label: 'Hosts', options: [host({ id: 'prod', label: '10.0.0.8', detail: 'prod' })] },
      {
        id: 'docs',
        label: 'Docs',
        options: [
          doc({ id: 'file-root', label: 'Runbook.md', relPath: 'Runbook.md', parentRelPath: '' }),
          doc({ id: 'dir', label: 'commands', contextType: 'dir', relPath: 'commands', parentRelPath: '' }),
          doc({ id: 'nested', label: 'Summary.md', relPath: 'commands/Summary.md', parentRelPath: 'commands' })
        ]
      }
    ]
    const views = cloneAiPanelContextCategories(categories, (kind) => `icon:${kind}`)
    expect(views[0]).toMatchObject({ id: 'hosts', icon: 'icon:hosts' })
    expect(selectedAiPanelContextCategory(views, 'docs')?.label).toBe('Docs')
    expect(visibleAiPanelContextCategories(views, 'cmd').map((category) => category.id)).toEqual(['docs'])
    expect(visibleAiPanelContextCategories(views, 'agent').map((category) => category.id)).toEqual(['hosts', 'docs'])

    expect(sortedAiPanelDocsContextOptions(views[1].options, '').map((option) => option.label)).toEqual(['commands', 'Runbook.md'])
    expect(sortedAiPanelDocsContextOptions(views[1].options, 'commands').map((option) => option.label)).toEqual(['Summary.md'])
    expect(
      filteredAiPanelContextOptions({
        level: 'docs',
        selectedCategoryOptions: views[1].options,
        docsOptions: sortedAiPanelDocsContextOptions(views[1].options, ''),
        skillOptions: [],
        query: 'runbook'
      }).map((option) => option.label)
    ).toEqual(['Runbook.md'])
    expect(filteredAiPanelOpenedHosts([host({ id: 'local', label: '127.0.0.1' }), host({ id: 'prod', label: '10.0.0.8', detail: 'prod' })], 'prod', 'agent')).toEqual([
      host({ id: 'prod', label: '10.0.0.8', detail: 'prod' })
    ])
    expect(filteredAiPanelOpenedHosts([host({ id: 'prod', label: '10.0.0.8' })], '', 'cmd')).toEqual([])

    const commands = [command({ id: 'rollback', name: 'rollback-plan', command: '/rollback' }), command({ id: 'summary', name: 'Summary to Doc', command: '/summary' })]
    expect(cloneAiPanelCommandOptions(commands)).toEqual(commands)
    expect(filteredAiPanelCommands(commands, 'sum')).toEqual([commands[1]])
    expect(selectedAiPanelCommand(commands, 'rollback')).toEqual(commands[0])
    expect(selectedAiPanelCommandRef(commands[0], 'rollback', null)).toEqual({ command: '/rollback', label: 'rollback-plan', path: 'rollback.md' })
    expect(selectedAiPanelCommandRef(null, 'legacy-command', null)).toEqual({ command: 'legacy-command', label: 'legacy-command' })
    expect(modelMatchesAiPanelQuery({ id: 'gpt-4.1', label: 'GPT', detail: 'fast', tier: 'pro' }, 'fast', (model) => (typeof model === 'string' ? model : model.label || ''))).toBe(true)
  })

  it('plans host batch state, docs navigation, and keyboard movement', () => {
    const local = host({ id: 'opened-local', label: '127.0.0.1' })
    const prod = host({ id: 'prod', label: '10.0.0.8' })
    const stage = host({ id: 'stage', label: '10.0.0.9' })
    expect(visibleAiPanelHostContextOptions([prod, doc({ id: 'doc', label: 'doc.md' })])).toEqual([prod])
    expect(allVisibleAiPanelHostsSelected([local, prod], [prod])).toBe(true)
    expect(selectedAiPanelVisibleHostContexts([local], [local, prod, stage], 2)).toEqual([prod, stage])
    expect(clearAiPanelHostContexts([prod, doc({ id: 'doc', label: 'doc.md' })])).toEqual([doc({ id: 'doc', label: 'doc.md' })])

    expect(resetAiPanelDocsNavigation()).toEqual({ currentRelDir: '', dirStack: [], query: '', keyboardIndex: -1 })
    expect(enterAiPanelDocsDir({ currentRelDir: '', dirStack: [] }, doc({ id: 'dir', label: 'commands', contextType: 'dir', relPath: 'commands' }))).toEqual({
      currentRelDir: 'commands',
      dirStack: [''],
      query: '',
      keyboardIndex: -1
    })
    expect(backAiPanelDocsDir({ dirStack: ['', 'commands'] })).toEqual({ currentRelDir: 'commands', dirStack: [''], query: '', keyboardIndex: -1 })
    expect(backAiPanelDocsDir({ dirStack: [] })).toBeNull()

    expect(nextAiPanelPopupKeyboardIndex(-1, 3, 'down')).toBe(0)
    expect(nextAiPanelPopupKeyboardIndex(2, 3, 'down')).toBe(2)
    expect(nextAiPanelPopupKeyboardIndex(-1, 3, 'up')).toBe(2)
    expect(nextAiPanelPopupKeyboardIndex(0, 0, 'down')).toBe(0)
    expect(nextAiPanelPopupKeyboardIndex(-1, 3, 'up', { mainLevel: true })).toBe(0)
    expect(mainContextKeyboardSelection(0, [prod], [{ id: 'docs', label: 'Docs', options: [] }]).kind).toBe('host')
    expect(mainContextKeyboardSelection(1, [prod], [{ id: 'docs', label: 'Docs', options: [] }])).toEqual({
      kind: 'category',
      category: { id: 'docs', label: 'Docs', options: [] }
    })
  })

  it('plans context and command application without owning DOM side effects', () => {
    const prod = host({ id: 'prod', label: '10.0.0.8' })
    const runbook = doc({ id: 'runbook', label: 'Runbook.md' })
    const dir = doc({ id: 'dir', label: 'commands', contextType: 'dir', relPath: 'commands' })
    expect(planAiPanelContextApply({ target: 'main', context: dir, mainContexts: [], editHostContexts: [], maxHostContexts: 2 })).toEqual({
      kind: 'enter-docs-dir',
      context: dir
    })
    expect(planAiPanelContextApply({ target: 'edit', context: prod, mainContexts: [], editHostContexts: [], maxHostContexts: 2 })).toEqual({
      kind: 'edit-host',
      nextHosts: [prod]
    })
    expect(planAiPanelContextApply({ target: 'edit', context: runbook, mainContexts: [], editHostContexts: [], maxHostContexts: 2 })).toEqual({
      kind: 'edit-insert',
      context: runbook
    })
    expect(planAiPanelContextApply({ target: 'main', context: prod, mainContexts: [], editHostContexts: [], maxHostContexts: 2 })).toEqual({
      kind: 'main-host',
      nextContexts: [prod]
    })
    expect(planAiPanelContextApply({ target: 'main', context: runbook, mainContexts: [runbook], editHostContexts: [], maxHostContexts: 2 })).toEqual({
      kind: 'main-insert',
      nextContexts: [runbook]
    })

    const rollback = command({ id: 'rollback', name: 'rollback-plan', command: '/rollback' })
    expect(planAiPanelCommandApply({ target: 'edit', hasEditTarget: true, command: rollback, draft: '/', editingMessageId: 'message-1' })).toEqual({
      kind: 'edit-command',
      command: rollback
    })
    expect(planAiPanelCommandApply({ target: 'main', hasEditTarget: false, command: rollback, draft: 'deploy /', editingMessageId: null })).toEqual({
      kind: 'main-command',
      id: 'rollback',
      commandRef: { command: '/rollback', label: 'rollback-plan', path: 'rollback.md' },
      nextDraft: 'deploy '
    })
  })
})
