import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { builtinAgentSessionParserDefinitions } from '../src/shared/agentSessionParserConfigRuntime'
import codexConfig from '../src/shared/agentSessionParserConfigs/codex.json'
import type { AgentSessionParserProfile } from '../src/shared/contracts/agentSessionParsers'

const loadRuntime = async () => {
  const modulePath = '../src/main/backend/agent/agentSessionParserRegistry'
  return import(modulePath)
}

describe('agentSessionParserRegistry', () => {
  it('loads built-in Agents from the same JSON configuration format used by imports', () => {
    expect(builtinAgentSessionParserDefinitions).toHaveLength(19)
    expect(new Set(builtinAgentSessionParserDefinitions.map((definition) => definition.source)).size).toBe(19)
    expect(builtinAgentSessionParserDefinitions.find((definition) => definition.source === 'codex')).toEqual(codexConfig)
  })

  it('imports a custom Agent parser and restores the registry after removal', async () => {
    const runtime = await loadRuntime()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-parser-registry-'))
    try {
      await runtime.configureAgentSessionParserRegistry(root)
      const initial = runtime.listAgentSessionParsers()
      expect(initial.ok).toBe(true)
      expect(initial.data?.parsers.find((parser: AgentSessionParserProfile) => parser.source === 'codex')).toEqual(expect.objectContaining({ origin: 'builtin' }))

      const rulePath = join(root, 'aider-rule.json')
      await writeFile(rulePath, JSON.stringify({
        schemaVersion: 1,
        id: 'aider',
        source: 'aider',
        displayName: 'Aider',
        storage: {
          kind: 'jsonl',
          paths: ['${HOME}/.aider/sessions/**/*.jsonl'],
          sessionIdPointer: '/session/id',
          titlePointer: '/session/title'
        },
        rules: [
          {
            id: 'messages',
            match: { '/type': ['user', 'assistant'] },
            kind: 'message',
            rolePointer: '/role',
            contentPointers: ['/content']
          }
        ],
        fallback: 'raw-json'
      }), 'utf-8')

      const imported = await runtime.importAgentSessionParser({ filePath: rulePath })
      expect(imported.ok).toBe(true)
      expect(imported.data?.parser).toEqual(expect.objectContaining({ source: 'custom:aider', origin: 'user', ruleCount: 1 }))
      expect(runtime.listCustomAgentSessionParserDefinitions()).toEqual([
        expect.objectContaining({ source: 'custom:aider', displayName: 'Aider' })
      ])

      const removed = await runtime.removeAgentSessionParser({ source: 'custom:aider' })
      expect(removed.ok).toBe(true)
      expect(removed.data?.snapshot.parsers.some((parser: AgentSessionParserProfile) => parser.source === 'custom:aider')).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects executable and unsupported custom storage definitions', () => {
    const runtimePromise = loadRuntime()
    return runtimePromise.then((runtime) => {
      expect(() => runtime.validateAgentSessionParserDefinition({
        schemaVersion: 1,
        id: 'unsafe',
        source: 'unsafe',
        displayName: 'Unsafe',
        storage: { kind: 'opencode-sqlite' },
        rules: [],
        script: 'process.exit()'
      })).toThrow('must not contain script')
    })
  })

  it('overrides and restores a built-in Agent parser for its settings entry', async () => {
    const runtime = await loadRuntime()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-parser-override-'))
    try {
      await runtime.configureAgentSessionParserRegistry(root)
      const rulePath = join(root, 'codex-rule.json')
      await writeFile(rulePath, JSON.stringify({
        schemaVersion: 1,
        id: 'codex-customized',
        source: 'codex',
        displayName: 'Codex Customized',
        storage: { kind: 'jsonl', paths: ['${HOME}/.codex/sessions/**/*.jsonl'] },
        rules: [{ id: 'message', match: { '/type': 'event_msg' }, kind: 'message', contentPointers: ['/payload/message'] }],
        fallback: 'raw-json'
      }), 'utf-8')

      const imported = await runtime.importAgentSessionParser({ filePath: rulePath, expectedSource: 'codex' })
      expect(imported.data?.parser).toEqual(expect.objectContaining({ source: 'codex', origin: 'user', ruleCount: 1 }))

      const removed = await runtime.removeAgentSessionParser({ source: 'codex' })
      expect(removed.data?.snapshot.parsers.find((parser: AgentSessionParserProfile) => parser.source === 'codex')).toEqual(
        expect.objectContaining({ origin: 'builtin', displayName: 'Codex' })
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
