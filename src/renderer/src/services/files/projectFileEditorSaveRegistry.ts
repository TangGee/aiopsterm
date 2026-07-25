export type ProjectFileEditorFlush = () => Promise<boolean>

const projectFileEditorFlushers = new Map<string, ProjectFileEditorFlush>()

export const registerProjectFileEditorFlush = (panelId: string, flush: ProjectFileEditorFlush) => {
  projectFileEditorFlushers.set(panelId, flush)
  return () => {
    if (projectFileEditorFlushers.get(panelId) === flush) projectFileEditorFlushers.delete(panelId)
  }
}

export const flushProjectFileEditor = async (panelId: string) => {
  const flush = projectFileEditorFlushers.get(panelId)
  return flush ? flush() : false
}

export const resetProjectFileEditorSaveRegistryForTests = () => {
  projectFileEditorFlushers.clear()
}
