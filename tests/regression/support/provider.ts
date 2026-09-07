import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

export type ProviderScenario = 'answer' | 'tool' | 'error' | 'cancel'

// Synthetic content only. No credentials or user transcripts are replayed.
export async function startRegressionProvider() {
  const requests: Array<Record<string, any>> = []
  let scenario: ProviderScenario = 'answer'
  let disconnected = 0
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const server = createServer((request, response) => {
    let raw = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 4 * 1024 * 1024) request.destroy()
    })
    request.on('end', () => {
      if (request.method !== 'POST' || !request.url?.endsWith('/chat/completions')) {
        response.writeHead(404).end()
        return
      }
      let body: Record<string, any>
      try { body = JSON.parse(raw) } catch {
        response.writeHead(400).end('Invalid JSON')
        return
      }
      if (!body || typeof body !== 'object' || !Array.isArray(body.messages)) {
        response.writeHead(400).end('Expected messages array')
        return
      }
      requests.push(body)
      if (scenario === 'error') {
        response.writeHead(503, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'Regression provider unavailable' } }))
        return
      }
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      response.flushHeaders()
      let finished = false
      response.on('close', () => { if (!finished) disconnected++ })
      const toolCompleted = body.messages?.some((message: any) =>
        message.role === 'tool' || JSON.stringify(message.content ?? '').includes('command_output'))
      const content = scenario === 'tool' && !toolCompleted
        ? '<execute_command><ip>127.0.0.1</ip><command>echo REGRESSION_TOOL_OK</command><requires_approval>true</requires_approval><interactive>false</interactive></execute_command>'
        : 'REGRESSION_STREAM_START\n\nREGRESSION_ANSWER_COMPLETE'
      const parts = content.match(/.{1,13}|\n/g) || []
      const write = (delta: Record<string, unknown>, finish: string | null = null) => {
        response.write(`data: ${JSON.stringify({ id: 'regression', object: 'chat.completion.chunk', model: body.model,
          choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`)
      }
      write({ role: 'assistant' })
      const nativeTool = body.tools?.find((tool: any) => tool.function?.name === 'run_host_command')
      if (scenario === 'tool' && !toolCompleted && nativeTool) {
        const prompt = body.messages.map((message: any) => typeof message.content === 'string' ? message.content : JSON.stringify(message.content)).join('\n')
        const targetId = prompt.match(/"targetId"\s*:\s*"([^"]+)"/)?.[1]
        if (!targetId) { response.end(); return }
        write({ tool_calls: [{ index: 0, id: 'regression-call-1', type: 'function', function: { name: nativeTool.function.name, arguments: '' } }] })
        const args = JSON.stringify({ targetId, command: 'echo REGRESSION_TOOL_OK', requiresApproval: true })
        for (const fragment of args.match(/.{1,11}/g) || []) {
          write({ tool_calls: [{ index: 0, function: { arguments: fragment } }] })
        }
        write({}, 'tool_calls')
        finished = true
        response.end('data: [DONE]\n\n')
        return
      }
      const next = () => {
        if (response.destroyed) return
        const part = parts.shift()
        if (part !== undefined) write({ content: part })
        if (!parts.length && scenario !== 'cancel') {
          write({}, 'stop')
          finished = true
          response.end('data: [DONE]\n\n')
          return
        }
        const timer = setTimeout(() => { timers.delete(timer); next() }, scenario === 'cancel' ? 100 : 15)
        timers.add(timer)
      }
      next()
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests,
    get disconnected() { return disconnected },
    setScenario(value: ProviderScenario) { scenario = value },
    async close() {
      for (const timer of timers) clearTimeout(timer)
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  }
}
