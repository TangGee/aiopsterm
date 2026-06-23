import {
  clearAiPanelHostContexts,
  planAiPanelCommandApply,
  planAiPanelContextApply,
  selectedAiPanelVisibleHostContexts,
  type AiPanelPopupTarget
} from '@/services/ai/aiPanelPopupRuntime'
import type { AiChipContentPart } from '@/stores/workspace'
import type { AiCommandCatalogOption, AiContextKind, AiContextOption } from '@shared/contracts/aiChat'

export type AiPanelContextCommandRuntimeOptions = {
  maxHostContexts: number
  contextTarget: () => AiPanelPopupTarget
  commandTarget: () => AiPanelPopupTarget
  editingMessageId: () => string | null
  draft: () => string
  mainContexts: () => AiContextOption[]
  editHostContexts: () => AiContextOption[]
  visibleHostContexts: () => AiContextOption[]
  editCommandTarget: () => HTMLElement | null
  setMainContexts: (contexts: AiContextOption[]) => void
  setEditHostContexts: (contexts: AiContextOption[]) => void
  enterDocsDir: (context: AiContextOption) => void
  closeContextPopup: (options?: { restoreFocus?: boolean }) => void
  closeCommandPopup: (options?: { restoreFocus?: boolean }) => void
  removeMainTriggerToken: (token: '@' | '/') => void
  removeEditTriggerToken: (token: '@' | '/') => void
  insertContextAtEditCursor: (context: AiContextOption) => void | boolean
  insertCommandAtEditCursor: (target: HTMLElement | null, part: AiChipContentPart) => void | boolean
  restoreEditSelection: () => void
  selectCommandPreset: (id: string, commandRef: { command: string; label: string; path: string }) => void
  setDraft: (value: string) => void
  renderEditableFromState: () => void
  moveMainCaretToEnd: () => void
  requestFrame: (callback: () => void) => number
}

const commandChipPart = (command: AiCommandCatalogOption): AiChipContentPart => ({
  type: 'chip',
  chipType: 'command',
  ref: {
    command: command.command,
    label: command.label,
    path: command.path
  }
})

export const createAiPanelContextCommandRuntime = (options: AiPanelContextCommandRuntimeOptions) => {
  const renderMainAndMoveCaret = () => {
    options.renderEditableFromState()
    options.requestFrame(options.moveMainCaretToEnd)
  }

  const selectAllVisibleHostContexts = () => {
    const currentHosts = options.contextTarget() === 'edit' ? options.editHostContexts() : options.mainContexts().filter((context) => context.kind === 'hosts')
    const nextHosts = selectedAiPanelVisibleHostContexts(currentHosts, options.visibleHostContexts(), options.maxHostContexts)
    if (options.contextTarget() === 'edit') {
      options.setEditHostContexts(nextHosts)
      return
    }
    options.setMainContexts([...options.mainContexts().filter((context) => context.kind !== 'hosts'), ...nextHosts])
    renderMainAndMoveCaret()
  }

  const clearHostContexts = () => {
    if (options.contextTarget() === 'edit') {
      options.setEditHostContexts([])
      return
    }
    options.setMainContexts(clearAiPanelHostContexts(options.mainContexts()))
    renderMainAndMoveCaret()
  }

  const isEditHostContextSelected = (context: AiContextOption) =>
    context.kind === 'hosts' && options.editHostContexts().some((item) => item.id === context.id)

  const isContextSelectedForPopup = (context: AiContextOption) =>
    options.contextTarget() === 'edit'
      ? isEditHostContextSelected(context)
      : options.mainContexts().some((item) => item.id === context.id)

  const applyHostContextToEdit = (context: AiContextOption) => {
    options.removeEditTriggerToken('@')
    const plan = planAiPanelContextApply({
      target: 'edit',
      context,
      mainContexts: options.mainContexts(),
      editHostContexts: options.editHostContexts(),
      maxHostContexts: options.maxHostContexts
    })
    if (plan.kind === 'edit-host') options.setEditHostContexts(plan.nextHosts)
    options.closeContextPopup({ restoreFocus: true })
  }

  const applyContext = (context: AiContextOption) => {
    const plan = planAiPanelContextApply({
      target: options.contextTarget(),
      context,
      mainContexts: options.mainContexts(),
      editHostContexts: options.editHostContexts(),
      maxHostContexts: options.maxHostContexts
    })
    if (plan.kind === 'enter-docs-dir') {
      options.enterDocsDir(context)
      return
    }

    if (plan.kind === 'edit-host') {
      options.removeEditTriggerToken('@')
      options.setEditHostContexts(plan.nextHosts)
      options.closeContextPopup({ restoreFocus: true })
      return
    }
    if (plan.kind === 'edit-insert') {
      options.insertContextAtEditCursor(plan.context)
      options.closeContextPopup({ restoreFocus: true })
      return
    }

    options.removeMainTriggerToken('@')
    options.setMainContexts(plan.nextContexts)
    if (plan.kind === 'main-insert') options.closeContextPopup({ restoreFocus: true })
    renderMainAndMoveCaret()
  }

  const applyCommand = (command: AiCommandCatalogOption) => {
    const editCommandTarget = options.editCommandTarget()
    const plan = planAiPanelCommandApply({
      target: options.commandTarget(),
      editingMessageId: options.editingMessageId(),
      hasEditTarget: Boolean(editCommandTarget),
      command,
      draft: options.draft()
    })
    if (plan.kind === 'edit-command') {
      options.restoreEditSelection()
      options.insertCommandAtEditCursor(editCommandTarget, commandChipPart(plan.command))
      options.closeCommandPopup({ restoreFocus: true })
      return
    }

    options.selectCommandPreset(plan.id, plan.commandRef)
    options.closeCommandPopup()
    options.setDraft(plan.nextDraft)
    options.requestFrame(options.moveMainCaretToEnd)
  }

  const openContextPopup = (openContextPopupForTarget: (target: 'main' | 'edit', level?: 'main' | AiContextKind) => void, level: 'main' | AiContextKind = 'main') => {
    openContextPopupForTarget('main', level)
  }

  return {
    applyCommand,
    applyContext,
    applyHostContextToEdit,
    clearHostContexts,
    isContextSelectedForPopup,
    isEditHostContextSelected,
    openContextPopup,
    selectAllVisibleHostContexts
  }
}
