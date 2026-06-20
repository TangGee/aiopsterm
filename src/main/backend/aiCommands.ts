import type { AiCommandCatalog, AiCommandCatalogOption, AiCommandCatalogResult } from '@shared/preload'
import type { KnowledgeBaseEntry } from '@shared/contracts/knowledgeBase'

type AiCommandBackendRuntime = {
  listKnowledgeDir?: (relDir: string) => KnowledgeBaseEntry[] | Promise<KnowledgeBaseEntry[]>
}

const aiCommandRuntime: AiCommandBackendRuntime = {}

export const configureAiCommandBackendRuntime = (runtime: AiCommandBackendRuntime) => {
  Object.assign(aiCommandRuntime, runtime)
}

const cloneCommandOption = (command: AiCommandCatalogOption): AiCommandCatalogOption => ({ ...command })

const removeFileExtension = (filename: string) => {
  const lastDot = filename.lastIndexOf('.')
  return lastDot === -1 ? filename : filename.slice(0, lastDot)
}

const fileNameFromEntry = (entry: KnowledgeBaseEntry) => entry.name?.trim() || entry.relPath.split('/').filter(Boolean).at(-1) || entry.relPath

const sortCommandOptions = (commands: AiCommandCatalogOption[]) =>
  [...commands].sort((first, second) => first.name.localeCompare(second.name, 'zh-CN', { numeric: true, sensitivity: 'base' }))

const buildCommandOptions = async (): Promise<AiCommandCatalogOption[]> => {
  if (!aiCommandRuntime.listKnowledgeDir) return []
  try {
    const entries = await aiCommandRuntime.listKnowledgeDir('commands')
    return sortCommandOptions(
      entries
        .filter((entry) => entry.type === 'file' && entry.relPath?.trim())
        .map((entry): AiCommandCatalogOption => {
          const name = removeFileExtension(fileNameFromEntry(entry))
          return {
            id: entry.relPath,
            label: `/${name}`,
            name,
            path: entry.relPath,
            command: `/${name}`
          }
        })
    )
  } catch {
    return []
  }
}

export const listAiCommandCatalog = async (): Promise<AiCommandCatalogResult> => {
  try {
    const catalog: AiCommandCatalog = {
      commands: (await buildCommandOptions()).map(cloneCommandOption)
    }
    return { ok: true, data: catalog }
  } catch (error) {
    return {
      ok: false,
      errorCode: 'AI_COMMAND_CATALOG_ERROR',
      errorMessage: error instanceof Error ? error.message : String(error)
    }
  }
}
