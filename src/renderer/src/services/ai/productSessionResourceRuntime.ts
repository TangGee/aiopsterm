import {
  classicHostContextWithCatalog,
  classicHostContextFromTerminalPanel,
  classicStableHostTargetId,
  type ClassicTerminalPanelLike
} from '@/services/ai/classicSessionContextRuntime'
import type { AiContextCatalog, AiContextOption } from '@shared/contracts/aiChat'

export type ProductSessionResourceOption = {
  id: string
  kind: 'terminal' | 'host'
  label: string
  detail: string
  context: AiContextOption
  panelId?: string
}

const text = (value: unknown) => String(value || '').trim()

export const productSessionResourceOptions = (
  panels: ClassicTerminalPanelLike[],
  catalog: Pick<AiContextCatalog, 'categories'>,
  activePanelId = ''
) => {
  const configuredHosts = catalog.categories.find((category) => category.id === 'hosts')?.options || []
  const terminalOptions: ProductSessionResourceOption[] = panels
    .flatMap((panel) => {
      const panelContext = classicHostContextFromTerminalPanel(panel)
      if (!panelContext) return []
      const context = classicHostContextWithCatalog(panelContext, catalog)
      return [{
        id: `terminal:${panel.id}`,
        kind: 'terminal' as const,
        label: context.assetName || context.label || text(panel.title),
        detail: context.detail || context.label,
        context,
        panelId: panel.id
      }]
    })
    .sort((first, second) =>
      Number(second.panelId === activePanelId) - Number(first.panelId === activePanelId) ||
      first.label.localeCompare(second.label)
    )

  const openedTargetIds = new Set(terminalOptions.map((option) => classicStableHostTargetId(option.context)))
  const hostOptions: ProductSessionResourceOption[] = configuredHosts
    .filter((context) => context.kind === 'hosts' && !openedTargetIds.has(classicStableHostTargetId(context)))
    .map((context) => ({
      id: `host:${classicStableHostTargetId(context)}`,
      kind: 'host' as const,
      label: context.assetName || context.label,
      detail: context.detail || context.host || context.label,
      context: { ...context }
    }))
    .filter((option, index, options) => options.findIndex((candidate) => candidate.id === option.id) === index)
    .sort((first, second) => first.label.localeCompare(second.label))

  return [...terminalOptions, ...hostOptions]
}
