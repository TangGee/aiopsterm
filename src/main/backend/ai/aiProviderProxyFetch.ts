import http from 'http'
import https from 'https'
import type { Socket } from 'net'
import tls from 'tls'
import { URL } from 'url'
import type { AiPreferencesUserConfig, SshProxyConfig } from '@shared/contracts/appRuntime'
import { createSshProxySocket } from '../ssh/sshProxy'

const normalizeText = (value: unknown) => String(value || '').trim()

const toSshProxyConfig = (preferences?: AiPreferencesUserConfig): SshProxyConfig | null => {
  if (!preferences?.needProxy) return null
  const host = normalizeText(preferences.proxy.host)
  const port = Number(preferences.proxy.port)
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return null
  return {
    name: 'ai-preferences-proxy',
    type: preferences.proxy.type,
    host,
    port,
    enableProxyIdentity: Boolean(preferences.proxy.enableProxyIdentity),
    username: normalizeText(preferences.proxy.username),
    password: typeof preferences.proxy.password === 'string' ? preferences.proxy.password : ''
  }
}

const headersFromInit = (headers: RequestInit['headers']): Record<string, string> => {
  if (!headers) return {}
  if (headers instanceof Headers) {
    const output: Record<string, string> = {}
    headers.forEach((value, key) => {
      output[key] = value
    })
    return output
  }
  if (Array.isArray(headers)) return Object.fromEntries(headers.map(([key, value]) => [String(key), String(value)]))
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, String(value)]))
}

const bodyFromInit = (body: RequestInit['body']): string | Buffer | undefined => {
  if (body === undefined || body === null) return undefined
  if (typeof body === 'string' || Buffer.isBuffer(body)) return body
  if (body instanceof URLSearchParams) return body.toString()
  return String(body)
}

const responseHeaderEntries = (headers: http.IncomingHttpHeaders): [string, string][] => {
  const entries: [string, string][] = []
  Object.entries(headers).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((item) => entries.push([key, String(item)]))
    } else if (value !== undefined) {
      entries.push([key, String(value)])
    }
  })
  return entries
}

class SingleSocketHttpAgent extends http.Agent {
  constructor(private readonly socket: Socket) {
    super({ keepAlive: false })
  }

  override createConnection(): Socket {
    return this.socket
  }
}

class SingleSocketHttpsAgent extends https.Agent {
  constructor(
    private readonly socket: Socket,
    private readonly servername: string
  ) {
    super({ keepAlive: false })
  }

  override createConnection(): Socket {
    return tls.connect({ socket: this.socket, servername: this.servername })
  }
}

const createFetchResponse = (status: number, statusText: string, headers: http.IncomingHttpHeaders, body: string): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: new Headers(responseHeaderEntries(headers)),
    text: async () => body,
    json: async () => JSON.parse(body)
  }) as Response

export const createAiProviderProxyFetch = (preferences?: AiPreferencesUserConfig): typeof fetch | null => {
  const proxyConfig = toSshProxyConfig(preferences)
  if (!proxyConfig) return null

  return (async (urlInput: Parameters<typeof fetch>[0], init: RequestInit = {}) => {
    const url = new URL(typeof urlInput === 'string' ? urlInput : urlInput instanceof URL ? urlInput.toString() : urlInput.url)
    const isHttps = url.protocol === 'https:'
    if (!isHttps && url.protocol !== 'http:') throw new Error(`Unsupported AI provider protocol: ${url.protocol}`)
    const targetPort = Number(url.port) || (isHttps ? 443 : 80)
    const socket = await createSshProxySocket(proxyConfig, url.hostname, targetPort, { timeoutMs: 30_000 })
    const agent = isHttps ? new SingleSocketHttpsAgent(socket, url.hostname) : new SingleSocketHttpAgent(socket)
    const client = isHttps ? https : http
    const method = normalizeText(init.method) || 'GET'
    const headers = headersFromInit(init.headers)
    const body = bodyFromInit(init.body)
    if (body !== undefined && !Object.keys(headers).some((key) => key.toLowerCase() === 'content-length')) {
      headers['Content-Length'] = String(Buffer.byteLength(body))
    }

    return await new Promise<Response>((resolve, reject) => {
      let settled = false
      let request: http.ClientRequest | null = null
      const settle = (callback: () => void) => {
        if (settled) return
        settled = true
        init.signal?.removeEventListener('abort', abort)
        callback()
      }
      const abort = () => {
        request?.destroy(Object.assign(new Error('Provider request was cancelled'), { name: 'AbortError' }))
      }
      request = client.request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: targetPort,
          path: `${url.pathname}${url.search}`,
          method,
          headers,
          agent,
          ...(init.signal ? { signal: init.signal } : {})
        },
        (response) => {
          let responseBody = ''
          response.setEncoding('utf8')
          response.on('data', (chunk) => {
            responseBody += chunk
          })
          response.on('end', () => settle(() => resolve(createFetchResponse(response.statusCode || 0, response.statusMessage || '', response.headers, responseBody))))
        }
      )
      request.on('error', (error) => settle(() => reject(error)))
      init.signal?.addEventListener('abort', abort, { once: true })
      if (body !== undefined) request.write(body)
      request.end()
    })
  }) as typeof fetch
}
