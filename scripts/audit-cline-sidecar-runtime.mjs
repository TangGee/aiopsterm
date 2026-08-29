import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { accessSync, constants, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { nativeBinarySha256 } from './native-binary-integrity.mjs'

const NODE_VERSION = '22.20.0'
const NODE_RUNTIME_PACKAGES = {
  'linux:x64': 'node-linux-x64',
  'linux:arm64': 'node-linux-arm64',
  'darwin:x64': 'node-darwin-x64',
  'darwin:arm64': 'node-bin-darwin-arm64',
  'win32:x64': 'node-win-x64',
  'win32:arm64': 'node-win-arm64'
}
const NODE_RUNTIME_INTEGRITIES = {
  'node-linux-x64': 'sha512-CWyKqAkT1fUBr1IDD/JhDAYpUrBraNmSM9ndREbhAp14QmgBqq8CmgWHITSK1YXzJj+hWTEC1+F6gOgVFLIaSg==',
  'node-linux-arm64': 'sha512-eVexvODYds5ya11f+1D0r33WVf6BGvoSvofyVYQFMFMytblCCwlgJStpOb4IdomSnfVQWLAt0tNgYE5iXxSRuA==',
  'node-darwin-x64': 'sha512-N/X9n9cQYrQb43cVeEWw3uUwTBAVYO1/RKcfzQmwUSmDJxnYvcBu9eHwwLhfpuhHFZ/1ed1HMAOtQYgpSfSalg==',
  'node-bin-darwin-arm64': 'sha512-3tuBY31BRdJlTmVSqCYBj/05j0LK8Ca/MW+VKzkdhO9KBQESNeVAemtpwMt1qVP/chGHvtlvHkguM1xNopPkcg==',
  'node-win-x64': 'sha512-XhYJs77nWcwBDQy6JaCaguvT31j2aUw3M/mGsI0CgGvsGFpYKC9cGdzLkCnAJyj1AD6pNlDYmL29xIjYe+iAbg==',
  'node-win-arm64': 'sha512-6HvEyE3kqKw7HwIo5GEAnyhbF170pJ0LztRSk/D8LSgctnsU+hYrq6/+jeYObeFVehyBsAobZ6KYExjdA8whrA=='
}
const runtimePackage = NODE_RUNTIME_PACKAGES[`${process.platform}:${process.arch}`]
if (!runtimePackage) throw new Error(`Unsupported Cline sidecar Node runtime target: ${process.platform}/${process.arch}`)
const root = resolve('.')
const outputDir = join(root, 'build', 'cline-sidecar')
const nodeName = process.platform === 'win32' ? 'node.exe' : 'node'
const runtimePath = join(outputDir, nodeName)
const bundlePath = join(outputDir, 'cline-agent-sidecar.cjs')
const manifestPath = join(outputDir, 'manifest.json')
const metafilePath = join(outputDir, 'metafile.json')
const sbomPath = join(outputDir, 'sbom.cdx.json')
const noticesPath = join(outputDir, 'THIRD-PARTY-NOTICES.txt')
const required = [
  runtimePath,
  bundlePath,
  manifestPath,
  metafilePath,
  sbomPath,
  noticesPath,
  join(outputDir, 'NODE-LICENSE'),
  join(outputDir, 'CLINE-LICENSE'),
  join(outputDir, 'CLINE-ATTRIBUTION.txt')
]
const missing = required.filter((path) => !existsSync(path) || !statSync(path).isFile() || statSync(path).size <= 0)
if (missing.length) throw new Error(`Cline sidecar artifacts are missing: ${missing.join(', ')}`)
if (process.platform !== 'win32') accessSync(runtimePath, constants.X_OK)

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
if (
  manifest.protocolVersion !== 1 ||
  manifest.sdkVersion !== '0.0.59' ||
  manifest.nodeVersion !== NODE_VERSION ||
  manifest.runtimePackage !== runtimePackage ||
  manifest.runtimePackageIntegrity !== NODE_RUNTIME_INTEGRITIES[runtimePackage] ||
  manifest.bunBundlerVersion !== '1.3.13' ||
  manifest.runtime !== nodeName ||
  manifest.bundle !== 'cline-agent-sidecar.cjs' ||
  manifest.distributionReady !== true ||
  manifest.sbom !== 'sbom.cdx.json' ||
  manifest.thirdPartyNotices !== 'THIRD-PARTY-NOTICES.txt' ||
  !Array.isArray(manifest.excludedProviders) ||
  !manifest.excludedProviders.includes('claude-code') ||
  !manifest.excludedProviders.includes('sapaicore')
) {
  throw new Error(`Unexpected Cline sidecar manifest: ${JSON.stringify(manifest)}`)
}
if (manifest.bundleSha256 !== sha256(bundlePath) || manifest.runtimeSha256 !== nativeBinarySha256(runtimePath)) {
  throw new Error('Cline sidecar artifact hashes do not match the manifest.')
}

const nodeVersion = spawnSync(runtimePath, ['--version'], { encoding: 'utf8', shell: false })
if (nodeVersion.status !== 0 || nodeVersion.stdout.trim() !== `v${NODE_VERSION}`) {
  throw new Error(`Unexpected packaged Node runtime: ${nodeVersion.stdout || nodeVersion.stderr}`)
}
if (process.platform === 'linux') {
  const dynamicLinks = spawnSync('ldd', [runtimePath], { encoding: 'utf8', shell: false })
  const output = `${dynamicLinks.stdout || ''}\n${dynamicLinks.stderr || ''}`
  if (dynamicLinks.status !== 0 || /\bnot found\b/i.test(output)) {
    throw new Error(`Packaged Node runtime has unresolved Linux dynamic dependencies:\n${output}`)
  }
  if (/lib(?:ssl|crypto)\.so\.1\.1\b/i.test(output)) {
    throw new Error(`Packaged Node runtime links unsupported OpenSSL 1.1 libraries:\n${output}`)
  }
}

const restrictedPackagePatterns = [
  /^@anthropic-ai\/claude-agent-sdk(?:-|$)/,
  /^@jerome-benoit\/sap-ai-provider$/,
  /^@sap-ai-sdk\//,
  /^@sap\//,
  /^ai-sdk-provider-claude-code$/
]
const restrictedBundleMarkers = [
  '@anthropic-ai/claude-agent-sdk',
  '@jerome-benoit/sap-ai-provider',
  '@sap/xssec',
  'CLAUDE_AGENT_SDK_VERSION',
  'Native CLI binary for linux-x64 not found',
  'SAP DEVELOPER LICENSE AGREEMENT',
  'nodejs-xssec'
]
const metafile = JSON.parse(readFileSync(metafilePath, 'utf8'))
const packageCoordinates = new Set()
for (const inputPath of Object.keys(metafile.inputs || {})) {
  const normalized = inputPath.replaceAll('\\', '/')
  const marker = '/node_modules/'
  const markerIndex = normalized.lastIndexOf(marker)
  const packageStart = markerIndex >= 0
    ? markerIndex + marker.length
    : normalized.startsWith('node_modules/')
      ? 'node_modules/'.length
      : -1
  if (packageStart < 0) continue
  const parts = normalized.slice(packageStart).split('/')
  const nameParts = parts[0]?.startsWith('@') ? parts.slice(0, 2) : parts.slice(0, 1)
  const packageRoot = `${normalized.slice(0, packageStart)}${nameParts.join('/')}`
  const metadata = JSON.parse(readFileSync(join(root, packageRoot, 'package.json'), 'utf8'))
  const name = String(metadata.name || '')
  const version = String(metadata.version || '').replace(/^v(?=\d)/, '')
  if (restrictedPackagePatterns.some((pattern) => pattern.test(name))) {
    throw new Error(`Restricted provider dependency entered the Cline sidecar bundle: ${name}@${version}`)
  }
  packageCoordinates.add(`${name}@${version}`)
}

const bundleText = readFileSync(bundlePath, 'utf8')
for (const marker of restrictedBundleMarkers) {
  if (bundleText.includes(marker)) throw new Error(`Restricted provider implementation marker entered the bundle: ${marker}`)
}

const sbom = JSON.parse(readFileSync(sbomPath, 'utf8'))
if (sbom.bomFormat !== 'CycloneDX' || sbom.specVersion !== '1.5' || !Array.isArray(sbom.components)) {
  throw new Error('Cline sidecar SBOM is malformed.')
}
const sbomCoordinates = new Set(
  sbom.components
    .filter((component) => component.name !== 'Node.js')
    .map((component) => `${component.name}@${component.version}`)
)
const missingSbomComponents = [...packageCoordinates].filter((coordinate) => !sbomCoordinates.has(coordinate))
const unexpectedSbomComponents = [...sbomCoordinates].filter((coordinate) => !packageCoordinates.has(coordinate))
if (missingSbomComponents.length || unexpectedSbomComponents.length) {
  throw new Error(`Cline sidecar SBOM mismatch: missing=${missingSbomComponents.join(',')} unexpected=${unexpectedSbomComponents.join(',')}`)
}
const nodeComponent = sbom.components.find((component) => component.name === 'Node.js')
if (nodeComponent?.version !== NODE_VERSION || nodeComponent?.hashes?.[0]?.content !== manifest.runtimeSha256) {
  throw new Error('Cline sidecar SBOM does not describe the packaged Node runtime.')
}
if (!nodeComponent?.properties?.some((property) =>
  property.name === 'aiopsterm:runtime:npmPackage' && property.value === runtimePackage
)) {
  throw new Error('Cline sidecar SBOM does not identify the locked platform Node package.')
}
if (manifest.componentCount !== sbom.components.length) {
  throw new Error(`Cline sidecar component count mismatch: ${manifest.componentCount} != ${sbom.components.length}`)
}

const notices = readFileSync(noticesPath, 'utf8')
for (const coordinate of packageCoordinates) {
  if (!notices.includes(`- ${coordinate} |`)) throw new Error(`Third-party notices omit ${coordinate}.`)
}
if (!notices.includes('License evidence SHA-256:')) throw new Error('Third-party notices contain no license evidence.')
if (!readFileSync(join(outputDir, 'NODE-LICENSE'), 'utf8').startsWith('Node.js is licensed for use as follows:')) {
  throw new Error('NODE-LICENSE is not the Node.js runtime license and third-party notice file.')
}

const providerConfigs = [
  {
    name: 'openai-compatible',
    provider: {
      providerId: 'openai-compatible',
      modelId: 'audit-model',
      apiKey: 'audit-only',
      baseUrl: 'http://127.0.0.1:9/v1',
      knownModels: { 'audit-model': { id: 'audit-model', name: 'audit-model', capabilities: ['streaming', 'tools'], status: 'active' } },
      providerConfig: {
        providerId: 'openai-compatible',
        clientType: 'openai-compatible',
        modelId: 'audit-model',
        apiKey: 'audit-only',
        baseUrl: 'http://127.0.0.1:9/v1',
        knownModels: { 'audit-model': { id: 'audit-model', name: 'audit-model', capabilities: ['streaming', 'tools'], status: 'active' } },
        capabilities: ['streaming', 'tools']
      }
    }
  },
  {
    name: 'openai-native',
    provider: {
      providerId: 'openai-native',
      modelId: 'gpt-4.1',
      apiKey: 'audit-only',
      baseUrl: 'http://127.0.0.1:9/v1',
      knownModels: { 'gpt-4.1': { id: 'gpt-4.1', name: 'gpt-4.1', capabilities: ['streaming', 'tools'], status: 'active' } },
      providerConfig: {
        providerId: 'openai-native',
        clientType: 'openai',
        modelId: 'gpt-4.1',
        apiKey: 'audit-only',
        baseUrl: 'http://127.0.0.1:9/v1',
        knownModels: { 'gpt-4.1': { id: 'gpt-4.1', name: 'gpt-4.1', capabilities: ['streaming', 'tools'], status: 'active' } },
        capabilities: ['streaming', 'tools']
      }
    }
  },
  { name: 'anthropic', provider: { providerId: 'anthropic', modelId: 'claude-sonnet-4-20250514', apiKey: 'audit-only' } },
  { name: 'deepseek', provider: { providerId: 'deepseek', modelId: 'deepseek-chat', apiKey: 'audit-only' } },
  { name: 'ollama', provider: { providerId: 'ollama', modelId: 'llama3.2', baseUrl: 'http://127.0.0.1:9' } },
  { name: 'lmstudio', provider: { providerId: 'lmstudio', modelId: 'audit-model', baseUrl: 'http://127.0.0.1:9' } },
  { name: 'litellm', provider: { providerId: 'litellm', modelId: 'audit-model', apiKey: 'audit-only', baseUrl: 'http://127.0.0.1:9' } },
  {
    name: 'bedrock',
    provider: {
      providerId: 'bedrock',
      modelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      providerConfig: {
        providerId: 'bedrock',
        modelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
        aws: { authentication: 'iam', accessKey: 'audit-only', secretKey: 'audit-only', region: 'us-east-1' }
      }
    }
  }
]

const sseResponse = (chunks) => ({
  status: 200,
  statusText: 'OK',
  headers: { 'content-type': 'text/event-stream; charset=utf-8' },
  bodyBase64: Buffer.from(`${chunks.map((chunk) => `data: ${typeof chunk === 'string' ? chunk : JSON.stringify(chunk)}`).join('\n\n')}\n\n`).toString('base64')
})

const toolCallSse = () => sseResponse([
  {
    id: 'chatcmpl-audit-tool',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'audit-model',
    choices: [{
      index: 0,
      delta: {
        role: 'assistant',
        tool_calls: [
          {
            index: 0,
            id: 'call-audit-uptime',
            type: 'function',
            function: { name: 'run_host_command', arguments: '{"command":"printf loop-audit-uptime"}' }
          },
          {
            index: 1,
            id: 'call-audit-blocked',
            type: 'function',
            function: { name: 'run_host_command', arguments: '{"command":"printf loop-audit-blocked"}' }
          },
          {
            index: 2,
            id: 'call-audit-memory',
            type: 'function',
            function: { name: 'run_host_command', arguments: '{"command":"printf loop-audit-memory"}' }
          }
        ]
      },
      finish_reason: null
    }]
  },
  {
    id: 'chatcmpl-audit-tool',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'audit-model',
    choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
    usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 }
  },
  '[DONE]'
])

const finalTextSse = () => sseResponse([
  {
    id: 'chatcmpl-audit-final',
    object: 'chat.completion.chunk',
    created: 2,
    model: 'audit-model',
    choices: [{ index: 0, delta: { role: 'assistant', content: 'loop-audit-complete' }, finish_reason: null }]
  },
  {
    id: 'chatcmpl-audit-final',
    object: 'chat.completion.chunk',
    created: 2,
    model: 'audit-model',
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    usage: { prompt_tokens: 18, completion_tokens: 3, total_tokens: 21 }
  },
  '[DONE]'
])

const smokeSidecar = async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aiopsterm-cline-audit-'))
  let child = null
  let smokeTimeout = null
  try {
    child = spawn(runtimePath, [bundlePath], {
      cwd: root,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        CLINE_DATA_DIR: dataDir,
        CLINE_SESSION_DATA_DIR: join(dataDir, 'sessions'),
        AIOPSTERM_CLINE_WORKSPACE_ROOT: dataDir,
        NO_COLOR: '1'
      }
    })
    let stdout = ''
    let stderr = ''
    let requestSequence = 0
    let providerFetchCount = 0
    let callbackFailure = null
    const callbackOrder = []
    const lifecycleOrder = []
    let readyResolve
    let readyReject
    const ready = new Promise((resolveReady, rejectReady) => {
      readyResolve = resolveReady
      readyReject = rejectReady
    })
    let exitResolve
    const exited = new Promise((resolveExit) => { exitResolve = resolveExit })
    const pending = new Map()
    const handleCallback = (frame) => {
      const payload = frame.payload || {}
      const callbackLabel =
        frame.callback === 'approval.request' || frame.callback === 'tool.execute'
          ? `${frame.callback}:${payload.toolCallId}`
          : frame.callback
      callbackOrder.push(callbackLabel)
      if (frame.callback === 'approval.request' || frame.callback === 'tool.execute') {
        lifecycleOrder.push(callbackLabel)
      }
      if (frame.callback === 'provider.fetch') {
        if (payload.sessionId !== 'audit-agent-loop' || payload.taskId !== 'audit-loop-task' || payload.turnId !== 'audit-loop-turn') {
          throw new Error(`Provider fetch ownership mismatch: ${JSON.stringify(payload)}`)
        }
        if (payload.method !== 'POST' || !String(payload.url || '').endsWith('/chat/completions')) {
          throw new Error(`Provider fetch request mismatch: ${JSON.stringify(payload)}`)
        }
        const requestBody = JSON.parse(Buffer.from(payload.bodyBase64 || '', 'base64').toString('utf8'))
        if (providerFetchCount === 0) {
          if (!requestBody.tools?.some((tool) => tool.function?.name === 'run_host_command')) {
            throw new Error('First provider request omitted run_host_command.')
          }
          providerFetchCount += 1
          return toolCallSse()
        }
        if (providerFetchCount === 1) {
          const serializedMessages = JSON.stringify(requestBody.messages || [])
          if (
            !serializedMessages.includes('call-audit-uptime') ||
            !serializedMessages.includes('audit-uptime-output') ||
            !serializedMessages.includes('call-audit-blocked') ||
            !serializedMessages.includes('sidecar audit rejection') ||
            !serializedMessages.includes('call-audit-memory') ||
            !serializedMessages.includes('audit-memory-output')
          ) {
            throw new Error(`Second provider request omitted the tool result: ${serializedMessages}`)
          }
          providerFetchCount += 1
          return finalTextSse()
        }
        throw new Error('The deterministic Agent loop made too many provider requests.')
      }
      if (frame.callback === 'approval.request') {
        if (
          payload.toolName !== 'run_host_command' ||
          !['call-audit-uptime', 'call-audit-blocked', 'call-audit-memory'].includes(payload.toolCallId)
        ) {
          throw new Error(`Approval ownership mismatch: ${JSON.stringify(payload)}`)
        }
        if (payload.toolCallId === 'call-audit-blocked') {
          return { approved: false, reason: 'sidecar audit rejection' }
        }
        return { approved: true, reason: 'sidecar audit approval' }
      }
      if (frame.callback === 'tool.execute') {
        const expected = {
          'call-audit-uptime': {
            command: 'printf loop-audit-uptime',
            output: 'audit-uptime-output\n'
          },
          'call-audit-memory': {
            command: 'printf loop-audit-memory',
            output: 'audit-memory-output\n'
          }
        }[payload.toolCallId]
        if (payload.toolName !== 'run_host_command' || !expected || payload.input?.command !== expected.command) {
          throw new Error(`Tool execution mismatch: ${JSON.stringify(payload)}`)
        }
        return { stdout: expected.output, stderr: '', exitCode: 0, timedOut: false, truncated: false }
      }
      throw new Error(`Unexpected sidecar callback: ${frame.callback}`)
    }
    const respondToCallback = (frame) => {
      void Promise.resolve()
        .then(() => handleCallback(frame))
        .then((result) => {
          child.stdin.write(`${JSON.stringify({ version: 1, kind: 'callback-result', id: frame.id, ok: true, result })}\n`)
        })
        .catch((error) => {
          callbackFailure = error
          child.stdin.write(`${JSON.stringify({
            version: 1,
            kind: 'callback-result',
            id: frame.id,
            ok: false,
            error: { code: 'AUDIT_CALLBACK_FAILED', message: error instanceof Error ? error.message : String(error) }
          })}\n`)
        })
    }
    smokeTimeout = setTimeout(() => {
      readyReject(new Error('Cline sidecar Node runtime smoke timed out.'))
      for (const request of pending.values()) request.reject(new Error('Cline sidecar Node runtime smoke timed out.'))
      pending.clear()
      child.kill()
    }, 30_000)
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk.toString()}`.slice(-8192) })
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
      for (;;) {
        const newline = stdout.indexOf('\n')
        if (newline < 0) break
        const line = stdout.slice(0, newline).trim()
        stdout = stdout.slice(newline + 1)
        if (!line) continue
        let frame
        try {
          frame = JSON.parse(line)
        } catch {
          readyReject(new Error(`Cline sidecar emitted invalid JSON: ${line}`))
          child.kill()
          continue
        }
        if (frame.kind === 'event' && frame.event === 'agent.task' && frame.payload?.type === 'tool-result') {
          lifecycleOrder.push(`tool-result:${frame.payload.toolCallId}`)
        }
        if (frame.kind === 'event' && frame.event === 'runtime.ready') {
          if (frame.version !== 1 || frame.payload?.sdkVersion !== '0.0.59') {
            readyReject(new Error(`Cline sidecar ready frame mismatch: ${line}`))
            child.kill()
          } else {
            readyResolve(frame.payload)
          }
        } else if (frame.kind === 'response') {
          const request = pending.get(frame.id)
          if (!request) continue
          pending.delete(frame.id)
          if (frame.ok) request.resolve(frame.result)
          else request.reject(new Error(frame.error?.message || 'Cline sidecar request failed.'))
        } else if (frame.kind === 'callback') {
          respondToCallback(frame)
        }
      }
    })
    child.once('error', (error) => {
      readyReject(error)
      for (const request of pending.values()) request.reject(error)
      pending.clear()
    })
    child.once('exit', (code) => exitResolve(code))
    const request = (method, payload) => new Promise((resolveRequest, rejectRequest) => {
      const id = `audit-${++requestSequence}`
      pending.set(id, { resolve: resolveRequest, reject: rejectRequest })
      child.stdin.write(`${JSON.stringify({ version: 1, kind: 'request', id, method, payload })}\n`)
    })

    await ready
    const ping = await request('runtime.ping')
    if (ping?.protocolVersion !== 1 || ping?.sdkVersion !== '0.0.59') throw new Error('Cline sidecar ping failed.')
    for (const config of providerConfigs) {
      const sessionId = `audit-${config.name}`
      const start = await request('session.start', {
        sessionId,
        profile: 'classic-chat',
        systemPrompt: 'Provider initialization audit only.',
        provider: config.provider,
        tools: [],
        maxIterations: 1
      })
      if (start?.sessionId !== sessionId) throw new Error(`Cline provider failed to initialize: ${config.name}`)
      const stop = await request('session.stop', { sessionId })
      if (stop?.stopped !== true) throw new Error(`Cline provider session failed to stop: ${config.name}`)
    }
    const loopProvider = {
      providerId: 'openai-compatible',
      modelId: 'audit-model',
      apiKey: 'audit-only',
      baseUrl: 'https://audit.invalid/v1',
      useHostProxy: true,
      knownModels: {
        'audit-model': { id: 'audit-model', name: 'audit-model', capabilities: ['streaming', 'tools'], status: 'active' }
      },
      providerConfig: {
        providerId: 'openai-compatible',
        clientType: 'openai-compatible',
        modelId: 'audit-model',
        apiKey: 'audit-only',
        baseUrl: 'https://audit.invalid/v1',
        knownModels: {
          'audit-model': { id: 'audit-model', name: 'audit-model', capabilities: ['streaming', 'tools'], status: 'active' }
        },
        capabilities: ['streaming', 'tools']
      }
    }
    await request('session.start', {
      sessionId: 'audit-agent-loop',
      profile: 'classic-agent',
      systemPrompt: 'Process every run_host_command call in model order, including rejected calls, then report the observed results.',
      provider: loopProvider,
      tools: [{
        name: 'run_host_command',
        description: 'Run one deterministic audit command at a time.',
        inputSchema: {
          type: 'object',
          properties: { command: { type: 'string' } },
          required: ['command'],
          additionalProperties: false
        },
        autoApprove: false,
        timeoutMs: 5000
      }],
      maxIterations: 3
    })
    const loopResult = await request('session.send', {
      sessionId: 'audit-agent-loop',
      taskId: 'audit-loop-task',
      turnId: 'audit-loop-turn',
      prompt: 'Process all deterministic audit commands.'
    })
    if (callbackFailure) throw callbackFailure
    if (loopResult?.text !== 'loop-audit-complete' || loopResult?.finishReason !== 'completed' || loopResult?.iterations !== 2) {
      throw new Error(`Deterministic Agent loop returned an unexpected result: ${JSON.stringify(loopResult)}`)
    }
    if (
      loopResult.toolCalls?.length !== 3 ||
      loopResult.toolCalls[0]?.id !== 'call-audit-uptime' ||
      loopResult.toolCalls[0]?.name !== 'run_host_command' ||
      loopResult.toolCalls[0]?.output?.stdout !== 'audit-uptime-output\n' ||
      loopResult.toolCalls[1]?.id !== 'call-audit-blocked' ||
      loopResult.toolCalls[1]?.name !== 'run_host_command' ||
      !JSON.stringify(loopResult.toolCalls[1]?.output).includes('sidecar audit rejection') ||
      loopResult.toolCalls[2]?.id !== 'call-audit-memory' ||
      loopResult.toolCalls[2]?.name !== 'run_host_command' ||
      loopResult.toolCalls[2]?.output?.stdout !== 'audit-memory-output\n'
    ) {
      throw new Error(`Deterministic Agent loop omitted the tool result: ${JSON.stringify(loopResult)}`)
    }
    const expectedCallbackOrder = [
      'provider.fetch',
      'approval.request:call-audit-uptime',
      'tool.execute:call-audit-uptime',
      'approval.request:call-audit-blocked',
      'approval.request:call-audit-memory',
      'tool.execute:call-audit-memory',
      'provider.fetch'
    ]
    if (providerFetchCount !== 2 || JSON.stringify(callbackOrder) !== JSON.stringify(expectedCallbackOrder)) {
      throw new Error(`Deterministic Agent loop callback order mismatch: ${JSON.stringify(callbackOrder)}`)
    }
    const expectedLifecycleOrder = [
      'approval.request:call-audit-uptime',
      'tool.execute:call-audit-uptime',
      'tool-result:call-audit-uptime',
      'approval.request:call-audit-blocked',
      'tool-result:call-audit-blocked',
      'approval.request:call-audit-memory',
      'tool.execute:call-audit-memory',
      'tool-result:call-audit-memory'
    ]
    if (JSON.stringify(lifecycleOrder) !== JSON.stringify(expectedLifecycleOrder)) {
      throw new Error(`Deterministic Agent loop lifecycle order mismatch: ${JSON.stringify(lifecycleOrder)}`)
    }
    await request('session.stop', { sessionId: 'audit-agent-loop' })
    const shutdown = await request('runtime.shutdown')
    if (shutdown?.stopped !== true) throw new Error('Cline sidecar shutdown failed.')
    const exitCode = await exited
    if (exitCode !== 0) throw new Error(`Cline sidecar exited with code ${exitCode}.${stderr ? `\n${stderr}` : ''}`)
  } finally {
    if (smokeTimeout) clearTimeout(smokeTimeout)
    if (child && child.exitCode === null) child.kill()
    rmSync(dataDir, { recursive: true, force: true })
  }
}

await smokeSidecar()

console.log(JSON.stringify({
  ok: true,
  audit: 'cline-sidecar-runtime',
  nodeVersion: NODE_VERSION,
  bundledComponents: packageCoordinates.size,
  providers: providerConfigs.map((config) => config.name),
  agentLoop: 'provider.fetch -> approval(A) -> tool(A) -> rejected-result(B) -> approval(C) -> tool(C) -> provider.fetch -> final'
}))
