import { describe, it, expect } from 'vitest'
import { startRegressionProvider } from './support/provider'

describe('deterministic loopback AI service', () => {
  it('streams valid SSE, supports tool responses and reports errors without paid APIs', async () => {
    const server = await startRegressionProvider()
    const request = () => fetch(`${server.baseUrl}/chat/completions`, {
      method: 'POST', body: JSON.stringify({ model: 'regression', messages: [{ role: 'user', content: 'synthetic' }], stream: true })
    })
    try {
      const response = await request()
      expect(response.headers.get('content-type')).toContain('text/event-stream')
      const raw = await response.text()
      const chunks = raw.split('\n\n').filter((line) => line.startsWith('data: {')).map((line) => JSON.parse(line.slice(6)))
      expect(chunks.map((chunk) => chunk.choices[0].delta.content || '').join('')).toContain('REGRESSION_ANSWER_COMPLETE')
      expect(raw).toContain('data: [DONE]')
      server.setScenario('tool')
      const tool = await (await request()).text()
      const toolText = tool.split('\n\n').filter((line) => line.startsWith('data: {'))
        .map((line) => JSON.parse(line.slice(6)).choices[0].delta.content || '').join('')
      expect(toolText).toContain('REGRESSION_TOOL_OK')
      server.setScenario('error')
      expect((await request()).status).toBe(503)
      expect((await fetch(`${server.baseUrl}/unrecognized`)).status).toBe(404)
      expect((await fetch(`${server.baseUrl}/chat/completions`, { method: 'POST', body: 'invalid' })).status).toBe(400)
      expect((await fetch(`${server.baseUrl}/chat/completions`, { method: 'POST', body: 'null' })).status).toBe(400)
    } finally { await server.close() }
  })

  it('releases streaming connections on cancellation', async () => {
    const server = await startRegressionProvider()
    const controller = new AbortController()
    try {
      server.setScenario('cancel')
      const response = await fetch(`${server.baseUrl}/chat/completions`, {
        method: 'POST', body: JSON.stringify({ messages: [] }), signal: controller.signal
      })
      await response.body!.getReader().read()
      controller.abort()
      await expect.poll(() => server.disconnected).toBe(1)
    } finally { await server.close() }
  })
})
