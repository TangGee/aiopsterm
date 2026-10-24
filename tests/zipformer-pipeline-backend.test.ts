import { beforeEach, expect, it, vi } from 'vitest'
import { createZipformerPipeline, type SherpaModule } from '../src/main/backend/ai/zipformerPipeline'
import type { VoiceInputPreferences } from '../src/shared/contracts/voice'

let text = ''
let endpoint = false
let loads = 0
let punctLoads = 0
const punctuate = vi.fn((value: string) => `${value}。`)
const finishInput = vi.fn()
const reset = vi.fn(() => { text = ''; endpoint = false })
const fake: SherpaModule = {
  version: () => '1.12.40',
  OnlineRecognizer: class {
    constructor() { loads++ }
    createStream() { return { acceptWaveform: vi.fn(), inputFinished: finishInput } }
    isReady() { return false }
    decode() {}
    getResult() { return { text } }
    isEndpoint() { return endpoint }
    reset = reset
  },
  OfflinePunctuation: class {
    constructor() { punctLoads++ }
    addPunct = punctuate
  }
}
const config = {} as VoiceInputPreferences
beforeEach(() => { text = ''; endpoint = false; loads = 0; punctLoads = 0; vi.clearAllMocks() })

it('keeps partial text unpunctuated and reuses both models across recordings', () => {
  const pipeline = createZipformerPipeline(fake, config)
  pipeline.start('first')
  text = '今天'; expect(pipeline.push('first', new Float32Array(1600), 0)).toEqual({ text: '今天', final: false })
  text = '今天天气很好'; endpoint = true
  expect(pipeline.push('first', new Float32Array(1600), 1).text).toBe('今天天气很好')
  text = '我们出去走走'
  for (let i = 2; i < 40; i++) pipeline.push('first', new Float32Array(1600), i)
  expect(reset).toHaveBeenCalledTimes(1)
  expect(punctuate).not.toHaveBeenCalled()
  expect(pipeline.finish('first')).toEqual({ text: '今天天气很好我们出去走走。', final: true })
  expect(finishInput).toHaveBeenCalledOnce()
  pipeline.start('second'); text = '你好'; pipeline.finish('second')
  expect(loads).toBe(1); expect(punctLoads).toBe(1); expect(punctuate).toHaveBeenCalledTimes(2)
})
it('preserves recognized words if punctuation attempts to correct a homophone or fails', () => {
  const pipeline = createZipformerPipeline(fake, config)
  pipeline.start('a'); text = '他的在家'
  punctuate.mockReturnValueOnce('他待在家。')
  expect(pipeline.finish('a')).toMatchObject({ text: '他的在家', final: true, warning: expect.any(String) })
  pipeline.start('b'); text = '测试'
  punctuate.mockImplementationOnce(() => { throw new Error('inference failed') })
  expect(pipeline.finish('b')).toMatchObject({ text: '测试', warning: expect.any(String) })
})
it('rejects out of order audio, invalid samples and cancelled sessions', () => {
  const pipeline = createZipformerPipeline(fake, config)
  pipeline.start('a')
  expect(() => pipeline.push('a', new Float32Array(1600), 1)).toThrow('out of order')
  pipeline.cancel('a')
  expect(() => pipeline.finish('a')).toThrow('no longer active')
  pipeline.start('b')
  expect(() => pipeline.push('b', new Float32Array([NaN]), 0)).toThrow('Invalid')
  expect(punctuate).not.toHaveBeenCalled()
})
it('does not apply punctuation to empty audio results and refuses an incompatible engine', () => {
  const pipeline = createZipformerPipeline(fake, config)
  pipeline.start('a'); expect(pipeline.finish('a').text).toBe(''); expect(punctuate).not.toHaveBeenCalled()
  expect(() => createZipformerPipeline({ ...fake, version: '1.12.14' }, config)).toThrow('1.12.40')
})
