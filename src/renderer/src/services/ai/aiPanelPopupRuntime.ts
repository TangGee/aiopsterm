import { computed } from 'vue'
import {
  cloneAiContextOption,
  isLocalhostAiContext,
  selectedVisibleHostAiContexts,
  toggleHostAiContextInList
} from '@/services/ai/aiPanelInputRuntime'
import type { AiCommandCatalogOption, AiContextCategoryInfo, AiContextKind, AiContextOption } from '@shared/contracts/aiChat'
export { modelMatchesAiPanelQuery } from '@/services/ai/aiPanelModelRuntime'

export type AiPanelPopupTarget = 'main' | 'edit'

export type AiPanelContextCategoryView<TIcon = unknown> = AiContextCategoryInfo & {
  icon?: TIcon
}

export type AiPanelDocsNavigationState = {
  currentRelDir: string
  dirStack: string[]
  query: string
  keyboardIndex: number
}

export type AiPanelContextApplyPlan =
  | { kind: 'enter-docs-dir'; context: AiContextOption }
  | { kind: 'edit-host'; nextHosts: AiContextOption[] }
  | { kind: 'edit-insert'; context: AiContextOption }
  | { kind: 'main-host'; nextContexts: AiContextOption[] }
  | { kind: 'main-insert'; nextContexts: AiContextOption[] }

export type AiPanelCommandApplyPlan =
  | { kind: 'edit-command'; command: AiCommandCatalogOption }
  | {
      kind: 'main-command'
      id: string
      commandRef: {
        command: string
        label: string
        path: string
      }
      nextDraft: string
    }

export const cloneAiPanelContextCategories = <TIcon>(
  categories: AiContextCategoryInfo[],
  iconForKind: (kind: AiContextKind) => TIcon
): Array<AiPanelContextCategoryView<TIcon>> =>
  categories.map((category) => ({
    ...category,
    icon: iconForKind(category.id),
    options: category.options.map(cloneAiContextOption)
  }))

export const selectedAiPanelContextCategory = <TIcon>(
  categories: Array<AiPanelContextCategoryView<TIcon>>,
  level: 'main' | AiContextKind
) => categories.find((category) => category.id === level)

export const sortedAiPanelDocsContextOptions = (options: AiContextOption[], currentRelDir: string) =>
  options
    .filter((option) => option.parentRelPath === currentRelDir)
    .map(cloneAiContextOption)
    .sort((first, second) => {
      if (first.contextType !== second.contextType) return first.contextType === 'dir' ? -1 : 1
      return first.label.localeCompare(second.label, 'zh-CN', { numeric: true, sensitivity: 'base' })
    })

const textMatchesKeyword = (value: string, keyword: string) => !keyword || value.toLowerCase().includes(keyword)

export const filteredAiPanelOpenedHosts = (openedHosts: AiContextOption[], query: string, chatMode: 'agent' | 'cmd', limit = 4) => {
  if (chatMode !== 'agent') return []
  const keyword = query.trim().toLowerCase()
  return openedHosts.filter((host) => textMatchesKeyword(`${host.label} ${host.detail || ''}`, keyword)).slice(0, limit).map(cloneAiContextOption)
}

export const visibleAiPanelContextCategories = <TIcon>(categories: Array<AiPanelContextCategoryView<TIcon>>, chatMode: 'agent' | 'cmd') =>
  categories.filter((category) => category.id !== 'hosts' || chatMode === 'agent')

export const filteredAiPanelContextOptions = (input: {
  level: 'main' | AiContextKind
  selectedCategoryOptions?: AiContextOption[]
  docsOptions: AiContextOption[]
  skillOptions: AiContextOption[]
  query: string
}) => {
  const options =
    input.level === 'docs'
      ? input.docsOptions
      : input.level === 'skills'
        ? input.skillOptions
        : input.selectedCategoryOptions || []
  const keyword = input.query.trim().toLowerCase()
  const filtered = keyword ? options.filter((option) => textMatchesKeyword(`${option.label} ${option.detail || ''}`, keyword)) : options
  return filtered.map(cloneAiContextOption)
}

export const visibleAiPanelHostContextOptions = (options: AiContextOption[]) => options.filter((option) => option.kind === 'hosts')

export const allVisibleAiPanelHostsSelected = (visibleHosts: AiContextOption[], currentHosts: AiContextOption[]) => {
  const hasRemoteHost = visibleHosts.some((host) => !isLocalhostAiContext(host))
  const selectableHosts = hasRemoteHost ? visibleHosts.filter((host) => !isLocalhostAiContext(host)) : visibleHosts
  return selectableHosts.length > 0 && selectableHosts.every((host) => currentHosts.some((context) => context.id === host.id))
}

export const selectedAiPanelVisibleHostContexts = (currentHosts: AiContextOption[], visibleHosts: AiContextOption[], maxHostContexts: number) =>
  selectedVisibleHostAiContexts(currentHosts, visibleHosts, maxHostContexts)

export const clearAiPanelHostContexts = (contexts: AiContextOption[]) => contexts.filter((context) => context.kind !== 'hosts')

export const cloneAiPanelCommandOptions = (commands: AiCommandCatalogOption[]) => commands.map((command) => ({ ...command }))

export const filteredAiPanelCommands = (commands: AiCommandCatalogOption[], query: string) => {
  const keyword = query.trim().toLowerCase()
  return keyword ? commands.filter((preset) => preset.name.toLowerCase().includes(keyword)) : commands
}

export const selectedAiPanelCommand = (commands: AiCommandCatalogOption[], selectedId?: string | null) =>
  commands.find((preset) => preset.id === selectedId) || null

export const selectedAiPanelCommandRef = (
  selectedCommand: AiCommandCatalogOption | null | undefined,
  selectedCommandId?: string | null,
  selectedCommandRef?: { command: string; label?: string; path?: string } | null
) => {
  if (selectedCommandRef) return selectedCommandRef
  if (selectedCommand) {
    return {
      command: selectedCommand.command,
      label: selectedCommand.label,
      path: selectedCommand.path
    }
  }
  if (selectedCommandId) {
    return {
      command: selectedCommandId,
      label: selectedCommandId
    }
  }
  return null
}

export const resetAiPanelDocsNavigation = (): AiPanelDocsNavigationState => ({
  currentRelDir: '',
  dirStack: [],
  query: '',
  keyboardIndex: -1
})

export const enterAiPanelDocsDir = (state: Pick<AiPanelDocsNavigationState, 'currentRelDir' | 'dirStack'>, context: AiContextOption) => {
  if (context.kind !== 'docs' || context.contextType !== 'dir' || !context.relPath) return null
  return {
    currentRelDir: context.relPath,
    dirStack: [...state.dirStack, state.currentRelDir],
    query: '',
    keyboardIndex: -1
  }
}

export const backAiPanelDocsDir = (state: Pick<AiPanelDocsNavigationState, 'dirStack'>): AiPanelDocsNavigationState | null => {
  if (state.dirStack.length === 0) return null
  return {
    currentRelDir: state.dirStack.at(-1) || '',
    dirStack: state.dirStack.slice(0, -1),
    query: '',
    keyboardIndex: -1
  }
}

export const nextAiPanelPopupKeyboardIndex = (current: number, listLength: number, direction: 'down' | 'up', options: { mainLevel?: boolean } = {}) => {
  if (options.mainLevel) {
    if (direction === 'down') return Math.min(current + 1, Math.max(0, listLength - 1))
    return Math.max(current - 1, 0)
  }
  if (listLength <= 0) return current
  if (direction === 'down') return current === -1 ? 0 : Math.min(current + 1, listLength - 1)
  return current === -1 ? listLength - 1 : Math.max(current - 1, 0)
}

export const mainContextKeyboardSelection = <TIcon>(
  keyboardIndex: number,
  openedHosts: AiContextOption[],
  categories: Array<AiPanelContextCategoryView<TIcon>>
): { kind: 'host'; context: AiContextOption } | { kind: 'category'; category: AiPanelContextCategoryView<TIcon> } | { kind: 'none' } => {
  if (keyboardIndex >= 0 && keyboardIndex < openedHosts.length) return { kind: 'host', context: openedHosts[keyboardIndex] }
  if (keyboardIndex >= openedHosts.length) {
    const category = categories[keyboardIndex - openedHosts.length]
    if (category) return { kind: 'category', category }
  }
  return { kind: 'none' }
}

export const planAiPanelContextApply = (input: {
  target: AiPanelPopupTarget
  context: AiContextOption
  mainContexts: AiContextOption[]
  editHostContexts: AiContextOption[]
  maxHostContexts: number
}): AiPanelContextApplyPlan => {
  if (input.context.kind === 'docs' && input.context.contextType === 'dir') return { kind: 'enter-docs-dir', context: input.context }
  if (input.target === 'edit') {
    if (input.context.kind === 'hosts') {
      return {
        kind: 'edit-host',
        nextHosts: toggleHostAiContextInList(input.editHostContexts, input.context, input.maxHostContexts)
      }
    }
    return { kind: 'edit-insert', context: input.context }
  }
  if (input.context.kind === 'hosts') {
    return {
      kind: 'main-host',
      nextContexts: toggleHostAiContextInList(input.mainContexts, input.context, input.maxHostContexts)
    }
  }
  if (input.mainContexts.some((context) => context.id === input.context.id)) return { kind: 'main-insert', nextContexts: input.mainContexts.map(cloneAiContextOption) }
  return { kind: 'main-insert', nextContexts: [...input.mainContexts.map(cloneAiContextOption), cloneAiContextOption(input.context)] }
}

export const planAiPanelCommandApply = (input: {
  target: AiPanelPopupTarget
  editingMessageId?: string | null
  hasEditTarget: boolean
  command: AiCommandCatalogOption
  draft: string
}): AiPanelCommandApplyPlan => {
  if (input.target === 'edit' || (input.editingMessageId && input.hasEditTarget)) return { kind: 'edit-command', command: { ...input.command } }
  return {
    kind: 'main-command',
    id: input.command.id,
    commandRef: {
      command: input.command.command,
      label: input.command.label,
      path: input.command.path
    },
    nextDraft: input.draft.replace(/\/$/, '')
  }
}

export type AiPanelPopupViewRuntimeOptions<TIcon = unknown> = {
  categories: () => AiContextCategoryInfo[]
  commandOptions: () => AiCommandCatalogOption[]
  openedHosts: () => AiContextOption[]
  selectedContexts: () => AiContextOption[]
  editHostContexts: () => AiContextOption[]
  skillOptions: () => AiContextOption[]
  selectedCommandId: () => string | null | undefined
  selectedCommandRef: () => { command: string; label?: string; path?: string } | null | undefined
  contextTarget: () => AiPanelPopupTarget
  contextLevel: () => 'main' | AiContextKind
  contextQuery: () => string
  commandQuery: () => string
  docsCurrentRelDir: () => string
  chatMode: () => 'agent' | 'cmd'
  iconForKind: (kind: AiContextKind) => TIcon
}

export const createAiPanelPopupViewRuntime = <TIcon = unknown>(options: AiPanelPopupViewRuntimeOptions<TIcon>) => {
  const aiContextCategories = computed<Array<AiPanelContextCategoryView<TIcon>>>(() =>
    cloneAiPanelContextCategories(options.categories(), options.iconForKind)
  )
  const selectedContextCategory = computed(() => selectedAiPanelContextCategory(aiContextCategories.value, options.contextLevel()))
  const docsContextOptions = computed<AiContextOption[]>(() =>
    sortedAiPanelDocsContextOptions(selectedContextCategory.value?.options || [], options.docsCurrentRelDir())
  )
  const commandOptions = computed(() => cloneAiPanelCommandOptions(options.commandOptions()))
  const displayedOpenedHosts = computed(() => filteredAiPanelOpenedHosts(options.openedHosts(), options.contextQuery(), options.chatMode()))
  const visibleContextCategories = computed(() => visibleAiPanelContextCategories(aiContextCategories.value, options.chatMode()))
  const filteredContextOptions = computed(() =>
    filteredAiPanelContextOptions({
      level: options.contextLevel(),
      selectedCategoryOptions: selectedContextCategory.value?.options,
      docsOptions: docsContextOptions.value,
      skillOptions: options.skillOptions(),
      query: options.contextQuery()
    })
  )
  const visibleHostContextOptions = computed(() => visibleAiPanelHostContextOptions(filteredContextOptions.value))
  const hostContextsForPopup = computed(() =>
    options.contextTarget() === 'edit' ? options.editHostContexts() : options.selectedContexts().filter((context) => context.kind === 'hosts')
  )
  const allVisibleHostContextsSelected = computed(() =>
    allVisibleAiPanelHostsSelected(visibleHostContextOptions.value, hostContextsForPopup.value)
  )
  const filteredCommands = computed(() => filteredAiPanelCommands(commandOptions.value, options.commandQuery()))
  const selectedCommand = computed(() => selectedAiPanelCommand(commandOptions.value, options.selectedCommandId()))
  const selectedCommandRef = computed(() => selectedAiPanelCommandRef(selectedCommand.value, options.selectedCommandId(), options.selectedCommandRef()))

  return {
    aiContextCategories,
    allVisibleHostContextsSelected,
    commandOptions,
    displayedOpenedHosts,
    docsContextOptions,
    filteredCommands,
    filteredContextOptions,
    hostContextsForPopup,
    selectedCommand,
    selectedCommandRef,
    selectedContextCategory,
    visibleContextCategories,
    visibleHostContextOptions
  }
}
