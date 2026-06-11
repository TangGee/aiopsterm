import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_KNOWLEDGE_TOTAL_BYTES,
  DEFAULT_KNOWLEDGE_INTERFACE_IMAGE_BASE64,
  DEFAULT_KNOWLEDGE_INTERFACE_IMAGE_MIME,
  DEFAULT_KNOWLEDGE_SEED_SIZES,
  DEFAULT_KNOWLEDGE_USED_BYTES,
  defaultKnowledgeBaseConfig,
  getDefaultKnowledgeSeedFile
} from '@shared/knowledgeBaseSeed'

const originalKnowledgeSeedEnv = process.env.AIOPSTERM_KNOWLEDGE_ENABLE_SEED
const originalNodeEnv = process.env.NODE_ENV

describe('knowledge base seed assets', () => {
  afterEach(() => {
    if (originalKnowledgeSeedEnv === undefined) {
      delete process.env.AIOPSTERM_KNOWLEDGE_ENABLE_SEED
    } else {
      process.env.AIOPSTERM_KNOWLEDGE_ENABLE_SEED = originalKnowledgeSeedEnv
    }
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV
    } else {
      process.env.NODE_ENV = originalNodeEnv
    }
  })

  it('does not infer knowledge base seed config from NODE_ENV=test', () => {
    process.env.NODE_ENV = 'test'
    delete process.env.AIOPSTERM_KNOWLEDGE_ENABLE_SEED

    expect(defaultKnowledgeBaseConfig()).toEqual({
      tree: [],
      usedBytes: 0,
      totalBytes: DEFAULT_KNOWLEDGE_TOTAL_BYTES
    })
  })

  it('loads knowledge base seed config only when explicitly enabled', () => {
    process.env.AIOPSTERM_KNOWLEDGE_ENABLE_SEED = '1'

    const config = defaultKnowledgeBaseConfig()
    expect(config.tree.map((node) => node.relPath)).toEqual(['commands', 'images', 'Markdown语法指南.md'])
    expect(config.usedBytes).toBe(DEFAULT_KNOWLEDGE_USED_BYTES)
    expect(config.totalBytes).toBe(DEFAULT_KNOWLEDGE_TOTAL_BYTES)
  })

  it('stores the default interface image as real PNG bytes instead of placeholder text', () => {
    const seedFile = getDefaultKnowledgeSeedFile('images/interface.png')

    expect(seedFile).toEqual(
      expect.objectContaining({
        kind: 'base64',
        base64: DEFAULT_KNOWLEDGE_INTERFACE_IMAGE_BASE64,
        mimeType: DEFAULT_KNOWLEDGE_INTERFACE_IMAGE_MIME
      })
    )

    const bytes = Buffer.from(DEFAULT_KNOWLEDGE_INTERFACE_IMAGE_BASE64, 'base64')
    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect(bytes.includes(Buffer.from('aiopsterm knowledge image placeholder'))).toBe(false)
    expect(seedFile?.size).toBe(bytes.length)
    expect(DEFAULT_KNOWLEDGE_SEED_SIZES['images/interface.png']).toBe(bytes.length)
  })

  it('keeps default capacity aligned with the actual seeded file sizes', () => {
    const total = Object.values(DEFAULT_KNOWLEDGE_SEED_SIZES).reduce((sum, size) => sum + size, 0)

    expect(DEFAULT_KNOWLEDGE_USED_BYTES).toBe(total)
    expect(getDefaultKnowledgeSeedFile('commands/diagnose.md')).toEqual(
      expect.objectContaining({
        kind: 'text',
        size: DEFAULT_KNOWLEDGE_SEED_SIZES['commands/diagnose.md']
      })
    )
  })
})
