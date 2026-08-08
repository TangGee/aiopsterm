#!/usr/bin/env node

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const [codexInput, electronInput, mcpServerInput] = process.argv.slice(2)
if (!codexInput || !electronInput || !mcpServerInput) {
  throw new Error('Usage: smoke-codex-flat-mcp.mjs <codex> <electron> <mcp-server>')
}

const codex = resolve(codexInput)
const electron = resolve(electronInput)
const mcpServer = resolve(mcpServerInput)
const tempHome = await mkdtemp(join(tmpdir(), 'aiopsterm-codex-flat-mcp-'))

let capturedRequest
let captureResolve
let captureReject
const captured = new Promise((resolvePromise, rejectPromise) => {
  captureResolve = resolvePromise
  captureReject = rejectPromise
})

const server = createServer((request, response) => {
  const chunks = []
  request.on('data', (chunk) => chunks.push(chunk))
  request.on('end', () => {
    try {
      capturedRequest = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      captureResolve(capturedRequest)
      response.writeHead(500, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'intentional smoke-test response' } }))
    } catch (error) {
      captureReject(error)
      response.writeHead(400)
      response.end()
    }
  })
})

await new Promise((resolvePromise, rejectPromise) => {
  server.once('error', rejectPromise)
  server.listen(0, '127.0.0.1', resolvePromise)
})

const address = server.address()
if (!address || typeof address === 'string') throw new Error('Unable to resolve smoke server address')

const tomlString = (value) => JSON.stringify(value)
await writeFile(
  join(tempHome, 'config.toml'),
  [
    'model = "aiopsterm-smoke"',
    'model_provider = "capture"',
    'approval_policy = "never"',
    'sandbox_mode = "read-only"',
    '',
    '[model_providers.capture]',
    'name = "Local request capture"',
    `base_url = "http://127.0.0.1:${address.port}/v1"`,
    'env_key = "AIOPSTERM_CODEX_SMOKE_KEY"',
    'wire_api = "responses"',
    '',
    '[mcp_servers.aiopsterm_remote]',
    `command = ${tomlString(electron)}`,
    `args = [${tomlString(mcpServer)}]`,
    'required = true',
    'startup_timeout_sec = 10',
    'enabled_tools = ["target_context", "run_command"]',
    '',
    '[mcp_servers.aiopsterm_remote.env]',
    'ELECTRON_RUN_AS_NODE = "1"',
    'AIOPSTERM_CODEX_BRIDGE_SOCKET = ""',
    ''
  ].join('\n'),
  'utf8'
)

const child = spawn(codex, ['exec', '--ephemeral', '--skip-git-repo-check', '--json', 'Read the selected target context.'], {
  cwd: tempHome,
  env: {
    ...process.env,
    AIOPSTERM_CODEX_FLAT_MCP_TOOLS: '1',
    AIOPSTERM_CODEX_SMOKE_KEY: 'smoke-key',
    CODEX_HOME: tempHome
  },
  stdio: ['ignore', 'pipe', 'pipe']
})

let stderr = ''
child.stderr.on('data', (chunk) => {
  stderr += chunk.toString('utf8')
})

const timeout = setTimeout(() => {
  captureReject(new Error(`Timed out waiting for a Responses request. Codex stderr: ${stderr.trim()}`))
}, 20_000)

try {
  const body = await captured
  const tools = Array.isArray(body.tools) ? body.tools : []
  const functionTools = tools.filter((tool) => tool?.type === 'function')
  const names = functionTools.map((tool) => tool.name).filter((name) => typeof name === 'string')
  const expected = ['mcp__aiopsterm_remote__target_context', 'mcp__aiopsterm_remote__run_command']
  const missing = expected.filter((name) => !names.includes(name))
  const leakedNamespaceTools = tools.filter(
    (tool) => tool?.type === 'namespace' && /aiopsterm_remote|target_context|run_command/.test(JSON.stringify(tool))
  )

  if (missing.length || leakedNamespaceTools.length) {
    throw new Error(
      `Codex did not flatten MCP tools correctly. missing=${JSON.stringify(missing)} leakedNamespaceTools=${leakedNamespaceTools.length} names=${JSON.stringify(names)}`
    )
  }

  console.log('codex-flat-mcp-smoke-ok')
  console.log(`tools: ${expected.join(', ')}`)
} finally {
  clearTimeout(timeout)
  child.kill('SIGTERM')
  server.close()
  await rm(tempHome, { recursive: true, force: true })
}
