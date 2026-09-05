'use strict'

const { parentPort } = process

const result = (ok, code) => {
  try {
    parentPort.postMessage({ ok, code })
  } catch {
    process.exit(0)
  }
}

const validRequest = (message) => {
  if (!message || typeof message !== 'object') return false
  if (message.action !== 'active' && message.action !== 'revoke') return false
  if (typeof message.endpoint !== 'string' || message.endpoint.length > 512) return false
  if (!message.body || typeof message.body !== 'object' || Array.isArray(message.body)) return false
  return Number.isInteger(message.timeoutMs) && message.timeoutMs >= 250 && message.timeoutMs <= 15000
}

parentPort.on('message', async (message) => {
  if (!validRequest(message)) {
    result(false, 'request-invalid')
    return
  }
  let target
  try {
    target = new URL(message.endpoint)
  } catch {
    result(false, 'endpoint-invalid')
    return
  }
  if (target.protocol !== 'https:' && !(target.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(target.hostname))) {
    result(false, 'endpoint-rejected')
    return
  }
  const body = JSON.stringify(message.body)
  if (Buffer.byteLength(body, 'utf-8') > 2048) {
    result(false, 'payload-too-large')
    return
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), message.timeoutMs)
  try {
    const response = await fetch(target, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      redirect: 'error',
      signal: controller.signal
    })
    result(response.ok, response.ok ? 'ok' : `http-${response.status}`)
  } catch (error) {
    result(false, error && error.name === 'AbortError' ? 'request-timeout' : 'request-failed')
  } finally {
    clearTimeout(timeout)
  }
})
