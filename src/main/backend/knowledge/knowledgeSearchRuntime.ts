import type { KnowledgeSearchRuntimeApplyInput, KnowledgeSearchRuntimeApplyResult, KnowledgeSearchRuntimeSnapshot } from '@shared/contracts/appRuntime'

let runtimeSnapshot: KnowledgeSearchRuntimeSnapshot = {
  enabled: true,
  appliedAt: new Date(0).toISOString(),
  source: 'settings',
  message: 'Knowledge search runtime has not been changed in this process.'
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))

const cloneSnapshot = (): KnowledgeSearchRuntimeSnapshot => ({ ...runtimeSnapshot })

const errorResult = (errorCode: string, errorMessage: string): KnowledgeSearchRuntimeApplyResult => ({
  ok: false,
  errorCode,
  errorMessage
})

export const resetKnowledgeSearchRuntimeForTests = () => {
  runtimeSnapshot = {
    enabled: true,
    appliedAt: new Date(0).toISOString(),
    source: 'settings',
    message: 'Knowledge search runtime has not been changed in this process.'
  }
}

export const getKnowledgeSearchRuntimeSnapshot = () => cloneSnapshot()

export const applyKnowledgeSearchRuntimeSetting = (input: KnowledgeSearchRuntimeApplyInput): KnowledgeSearchRuntimeApplyResult => {
  if (!isRecord(input) || typeof input.previousEnabled !== 'boolean' || typeof input.nextEnabled !== 'boolean') {
    return errorResult('KB_SEARCH_RUNTIME_INPUT_INVALID', 'Knowledge search runtime input is invalid.')
  }

  runtimeSnapshot = {
    enabled: input.nextEnabled,
    appliedAt: new Date().toISOString(),
    source: 'settings',
    message: input.nextEnabled ? '知识库搜索运行时已启用' : '知识库搜索运行时已禁用'
  }

  return {
    ok: true,
    data: cloneSnapshot()
  }
}
