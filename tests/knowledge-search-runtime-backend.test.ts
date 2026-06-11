import { beforeEach, describe, expect, it } from 'vitest'

type KnowledgeSearchRuntimeBackend = {
  resetKnowledgeSearchRuntimeForTests: () => void
  getKnowledgeSearchRuntimeSnapshot: () => any
  applyKnowledgeSearchRuntimeSetting: (input: any) => any
}

let backend: KnowledgeSearchRuntimeBackend

beforeEach(async () => {
  const modulePath = '../src/main/backend/knowledgeSearchRuntime'
  backend = (await import(modulePath)) as KnowledgeSearchRuntimeBackend
  backend.resetKnowledgeSearchRuntimeForTests()
})

describe('knowledge search runtime backend boundary', () => {
  it('applies enabled and disabled settings in the main-process runtime snapshot', () => {
    const disabled = backend.applyKnowledgeSearchRuntimeSetting({
      previousEnabled: true,
      nextEnabled: false
    })

    expect(disabled.ok).toBe(true)
    expect(disabled.data).toMatchObject({
      enabled: false,
      source: 'settings',
      message: '知识库搜索运行时已禁用'
    })
    expect(backend.getKnowledgeSearchRuntimeSnapshot()).toMatchObject({
      enabled: false,
      source: 'settings'
    })

    const enabled = backend.applyKnowledgeSearchRuntimeSetting({
      previousEnabled: false,
      nextEnabled: true
    })
    expect(enabled.ok).toBe(true)
    expect(enabled.data).toMatchObject({
      enabled: true,
      source: 'settings',
      message: '知识库搜索运行时已启用'
    })
  })

  it('rejects malformed runtime input', () => {
    expect(backend.applyKnowledgeSearchRuntimeSetting({ nextEnabled: false })).toEqual({
      ok: false,
      errorCode: 'KB_SEARCH_RUNTIME_INPUT_INVALID',
      errorMessage: 'Knowledge search runtime input is invalid.'
    })
  })
})
