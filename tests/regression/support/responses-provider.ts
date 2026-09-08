import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'

// Wire-compatible Responses service for the real bundled Codex, not a CLI double.
export async function startResponsesProvider() {
  const requests: any[] = []
  const sockets = new Set<import('node:http').ServerResponse>()
  let answer = 'REGRESSION_CODEX_ANSWER'
  let mode: 'answer' | 'hold' | 'error' | 'tool' = 'answer'
  let toolName = ''
  let toolArguments = '{}'
  let disconnected = 0
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', (data) => { raw += data; if (raw.length > 8 * 1024 * 1024) req.destroy() })
    req.on('end', () => {
      if (req.method !== 'POST' || !req.url?.endsWith('/responses')) { res.writeHead(404).end(); return }
      let body: any
      try { body = JSON.parse(raw) } catch { res.writeHead(400).end(); return }
      requests.push(body)
      if (mode === 'error') { res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'REGRESSION_RESPONSE_ERROR' } })); return }
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.flushHeaders()
      const id = `resp_${randomUUID()}`
      const event = (type: string, fields: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`)
      event('response.created', { response: { id } })
      if (mode === 'tool') {
        mode = 'answer'
        event('response.output_item.done', { item: { type: 'function_call', id: `fc_${randomUUID()}`, call_id: `call_${randomUUID()}`, name: toolName, arguments: toolArguments } })
      } else {
        const item = { type: 'message', id: `msg_${randomUUID()}`, role: 'assistant', content: [{ type: 'output_text', text: answer }] }
        event('response.output_item.added', { item: { ...item, content: [] } })
        for (const delta of answer.match(/.{1,7}/g) || []) event('response.output_text.delta', { item_id: item.id, output_index: 0, content_index: 0, delta })
        event('response.output_item.done', { item })
        if (mode === 'hold') {
          sockets.add(res)
          res.on('close', () => { sockets.delete(res); disconnected++ })
          return
        }
      }
      event('response.completed', { response: { id, usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } } })
      res.end()
    })
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  return {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, requests,
    get disconnected() { return disconnected },
    respond(text: string, next: typeof mode = 'answer') { answer = text; mode = next },
    tool(name: string, args: object) { toolName = name; toolArguments = JSON.stringify(args); mode = 'tool' },
    finishHeld() {
      for (const res of sockets) {
        const item = { type: 'message', id: 'late-message', role: 'assistant', content: [{ type: 'output_text', text: 'REGRESSION_LATE_CANCELLED_OUTPUT' }] }
        res.write(`event: response.output_item.done\ndata: ${JSON.stringify({ type: 'response.output_item.done', item })}\n\n`)
        res.end(`event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: { id: 'held-completed', usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } } })}\n\n`)
      }
    },
    async close() {
      for (const res of sockets) res.destroy()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}
