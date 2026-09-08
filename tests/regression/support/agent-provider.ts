import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

export async function startAgentProvider() {
  const requests: any[] = []
  const server = createServer((request, response) => {
    let raw = ''
    request.on('data', (chunk) => { raw += chunk; if (raw.length > 8 * 1024 * 1024) request.destroy() })
    request.on('end', () => {
      let body: any
      try { body = JSON.parse(raw || '{}') } catch { response.writeHead(400).end(); return }
      if (request.url?.includes('count_tokens')) { response.setHeader('content-type', 'application/json'); response.end('{"input_tokens":100}'); return }
      if (!Array.isArray(body.messages)) { response.writeHead(404).end(); return }
      requests.push(body)
      const text = 'REGRESSION_REAL_AGENT_ANSWER'
      if (request.url?.includes('/messages')) {
        const message = { id: `msg_${requests.length}`, type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 100, output_tokens: 10 } }
        if (!body.stream) { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(message)); return }
        response.setHeader('content-type', 'text/event-stream')
        const emit = (type: string, data: any) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
        emit('message_start', { message: { ...message, content: [], stop_reason: null } })
        emit('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
        emit('content_block_delta', { index: 0, delta: { type: 'text_delta', text } })
        emit('content_block_stop', { index: 0 })
        emit('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } })
        emit('message_stop', {})
      } else {
        response.setHeader('content-type', 'text/event-stream')
        for (const [delta, finish] of [[{ role: 'assistant', content: text }, null], [{}, 'stop']]) response.write(`data: ${JSON.stringify({ id: 'regression', object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta, finish_reason: finish }], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } })}\n\n`)
        response.write('data: [DONE]\n\n')
      }
      response.end()
    })
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  return { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests,
    async close() { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())) } }
}
