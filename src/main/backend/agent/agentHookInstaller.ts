import { access, mkdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { delimiter, dirname, isAbsolute, join } from 'path'
import type {
  AgentHookInstallerOperationInput,
  AgentHookInstallerOperationResult,
  AgentHookInstallerSnapshot,
  AgentHookInstallerStatus,
  AgentHookInstallerSource
} from '@shared/contracts/agentHooks'
import {
  AgentHookInstallerError,
  agentHookCommandFor as renderAgentHookCommandFor,
  cleanText,
  configHasOwnedHooks,
  configHasOwnedOpenCodePlugin,
  codexHookHash,
  deepseekPatchBegin,
  deepseekPatchEnd,
  fileHookMarker,
  hookDefinitions,
  installCodexHookTrust,
  installCodexHooksFeature,
  installDeepseekHarnessPatch,
  installKimiCodeHooks,
  installRovoDevYaml,
  isOwnedFileHook,
  isOwnedHookCommand,
  isPlainObject,
  kimiTomlBegin,
  kimiTomlEnd,
  mergeAgentHookJson,
  mergeOpenCodePluginRegistration,
  normalizeSource,
  ownedMarker,
  parseConfigJson,
  pluginFileContentFor,
  prettyJson,
  removeOwnedHooksFromGroups,
  rovoYamlBegin,
  rovoYamlEnd,
  rovoDevYamlHooksBlock,
  type AgentHookDefinition,
  uninstallCodexHooksFeature,
  uninstallDeepseekHarnessPatch,
  uninstallKimiCodeHooks,
  uninstallRovoDevYaml,
  windowsHookCommandPrefix
} from './agentHookConfigRuntime'
import { executableCandidateNames, type PlatformRuntime } from '../app/platformRuntime'

export {
  codexHookHash,
  installCodexHooksFeature,
  installDeepseekHarnessPatch,
  installKimiCodeHooks,
  mergeAgentHookJson,
  uninstallCodexHooksFeature,
  uninstallDeepseekHarnessPatch,
  uninstallKimiCodeHooks
} from './agentHookConfigRuntime'

type AgentHookInstallerRuntimeConfig = {
  getEnv?: () => NodeJS.ProcessEnv
  getHomeDir?: () => string
  getPlatform?: () => PlatformRuntime
  getAgentHookScriptPath?: () => string
  getJsRuntimeExecutable?: () => string
  readFile?: typeof readFile
  writeFile?: typeof writeFile
  rm?: typeof rm
  mkdir?: typeof mkdir
  access?: typeof access
  stat?: typeof stat
  runCommand?: (command: string, args: string[], env: NodeJS.ProcessEnv) => Promise<void>
}

const runtimeConfig: AgentHookInstallerRuntimeConfig = {}

export const configureAgentHookInstallerRuntime = (config: AgentHookInstallerRuntimeConfig = {}) => {
  runtimeConfig.getEnv = config.getEnv
  runtimeConfig.getHomeDir = config.getHomeDir
  runtimeConfig.getPlatform = config.getPlatform
  runtimeConfig.getAgentHookScriptPath = config.getAgentHookScriptPath
  runtimeConfig.getJsRuntimeExecutable = config.getJsRuntimeExecutable
  runtimeConfig.readFile = config.readFile
  runtimeConfig.writeFile = config.writeFile
  runtimeConfig.rm = config.rm
  runtimeConfig.mkdir = config.mkdir
  runtimeConfig.access = config.access
  runtimeConfig.stat = config.stat
  runtimeConfig.runCommand = config.runCommand
}

const getEnv = () => runtimeConfig.getEnv?.() || process.env
const getHomeDir = () => runtimeConfig.getHomeDir?.() || getEnv().HOME || process.env.HOME || process.cwd()
const getPlatform = () => runtimeConfig.getPlatform?.() || process.platform
const getReadFile = () => runtimeConfig.readFile || readFile
const getWriteFile = () => runtimeConfig.writeFile || writeFile
const getRm = () => runtimeConfig.rm || rm
const getMkdir = () => runtimeConfig.mkdir || mkdir
const getAccess = () => runtimeConfig.access || access
const getStat = () => runtimeConfig.stat || stat
const runCommand = (command: string, args: string[], env: NodeJS.ProcessEnv) =>
  runtimeConfig.runCommand?.(command, args, env) || promisify(execFile)(command, args, { env }).then(() => undefined)
const getJsRuntimeExecutable = () => cleanText(runtimeConfig.getJsRuntimeExecutable?.()) || cleanText(getEnv().APPIMAGE) || process.execPath

const definitionFor = (source: AgentHookInstallerSource) => hookDefinitions.find((definition) => definition.source === source)

const configDirFor = (definition: AgentHookDefinition, env: NodeJS.ProcessEnv = getEnv()) => {
  const override = definition.configDirEnv ? cleanText(env[definition.configDirEnv]) : ''
  if (override) {
    const resolved = isAbsolute(override) ? override : join(getHomeDir(), override)
    return definition.configDirEnvSubpath ? join(resolved, definition.configDirEnvSubpath) : resolved
  }
  return join(getHomeDir(), definition.configDirName)
}

const configPathFor = (definition: AgentHookDefinition, env: NodeJS.ProcessEnv = getEnv()) => join(configDirFor(definition, env), definition.configFileName)

const codexConfigTomlPathFor = (definition: AgentHookDefinition, env: NodeJS.ProcessEnv = getEnv()) => join(configDirFor(definition, env), 'config.toml')

const deepseekHomeFor = (env: NodeJS.ProcessEnv = getEnv()) => {
  const override = cleanText(env.DSH_HOME)
  return override ? (isAbsolute(override) ? override : join(getHomeDir(), override)) : join(getHomeDir(), '.dsh')
}

const deepseekProfilePatchPaths = (env: NodeJS.ProcessEnv = getEnv()) =>
  ['web', 'headless'].map((profile) => join(deepseekHomeFor(env), 'profiles', profile, 'cordis.patch.yml'))

const pathExists = async (path: string) => {
  try {
    await getAccess()(path)
    return true
  } catch {
    return false
  }
}

const findBinary = async (binaryName: string, env: NodeJS.ProcessEnv = getEnv()) => {
  const pathValue = cleanText(env.PATH)
  if (!pathValue) return ''
  const names = executableCandidateNames(binaryName, env, getPlatform())
  for (const entry of pathValue.split(delimiter)) {
    const dir = cleanText(entry)
    if (!dir) continue
    for (const name of names) {
      const candidate = join(dir, name)
      try {
        await getAccess()(candidate)
        const metadata = await getStat()(candidate)
        if (metadata.isFile()) return candidate
      } catch {
        // Continue searching PATH.
      }
    }
  }
  return ''
}

const hookScriptPath = () => cleanText(runtimeConfig.getAgentHookScriptPath?.())

export const agentHookCommandFor = (source: AgentHookInstallerSource, hookEvent: string, scriptPath = hookScriptPath()) =>
  renderAgentHookCommandFor(source, hookEvent, scriptPath, getPlatform(), getJsRuntimeExecutable())

const openCodeConfigPathFor = (definition: AgentHookDefinition, env: NodeJS.ProcessEnv = getEnv()) => join(configDirFor(definition, env), 'opencode.json')

const installFileHookDefinition = async (definition: AgentHookDefinition, scriptPath: string) => {
  const configPath = configPathFor(definition)
  const content = pluginFileContentFor(definition)
  const existingRaw = (await pathExists(configPath)) ? String(await getReadFile()(configPath, 'utf-8')) : ''
  if (existingRaw && !isOwnedFileHook(existingRaw)) {
    throw new AgentHookInstallerError('AGENT_HOOK_CONFIG_CONFLICT', `${configPath} already exists and is not an aiopsterm-managed hook file.`)
  }
  await getMkdir()(dirname(configPath), { recursive: true })
  await getWriteFile()(configPath, content, 'utf-8')
  if (definition.source === 'opencode') {
    const configJsonPath = openCodeConfigPathFor(definition)
    const configRaw = (await pathExists(configJsonPath)) ? String(await getReadFile()(configJsonPath, 'utf-8')) : ''
    const existing = parseConfigJson(configRaw, configJsonPath)
    await getWriteFile()(configJsonPath, prettyJson(mergeOpenCodePluginRegistration(existing, true)), 'utf-8')
  }
}

const uninstallFileHookDefinition = async (definition: AgentHookDefinition) => {
  const configPath = configPathFor(definition)
  if (await pathExists(configPath)) {
    const existingRaw = String(await getReadFile()(configPath, 'utf-8'))
    if (isOwnedFileHook(existingRaw)) await getRm()(configPath, { force: true })
  }
  if (definition.source === 'opencode') {
    const configJsonPath = openCodeConfigPathFor(definition)
    if (await pathExists(configJsonPath)) {
      const configRaw = String(await getReadFile()(configJsonPath, 'utf-8'))
      const existing = parseConfigJson(configRaw, configJsonPath)
      await getWriteFile()(configJsonPath, prettyJson(mergeOpenCodePluginRegistration(existing, false)), 'utf-8')
    }
  }
}

const statusForDefinition = async (definition: AgentHookDefinition): Promise<AgentHookInstallerStatus> => {
  const env = getEnv()
  const configPath = configPathFor(definition, env)
  const configDir = dirname(configPath)
  const binaryPath = await findBinary(definition.binaryName, env)
  const status: AgentHookInstallerStatus = {
    source: definition.source,
    label: definition.label,
    binaryName: definition.binaryName,
    launchCommand: definition.launchCommand || definition.binaryName,
    binaryPath,
    configPath,
    configExists: await pathExists(configPath),
    installed: false,
    scriptPath: hookScriptPath(),
    warnings: []
  }

  if (!binaryPath) status.warnings.push(`${definition.binaryName} not found on PATH`)
  if (!status.scriptPath) status.warnings.push('aiopsterm agent hook helper path is unavailable')

  try {
    const configRaw = status.configExists ? String(await getReadFile()(configPath, 'utf-8')) : ''
    if (definition.kimiToml) {
      status.installed = configRaw.includes(kimiTomlBegin) && configRaw.includes(kimiTomlEnd)
    } else if (definition.deepseekHarness) {
      const config = parseConfigJson(configRaw, configPath)
      const patchPaths = deepseekProfilePatchPaths(env)
      status.extraConfigPath = patchPaths[0]
      const patches = await Promise.all(patchPaths.map(async (path) => (await pathExists(path)) ? String(await getReadFile()(path, 'utf-8')) : ''))
      status.installed = configHasOwnedHooks(config) && patches.every((raw) => raw.includes(deepseekPatchBegin) && raw.includes(deepseekPatchEnd))
      if (!await findBinary('pnpm', env)) status.warnings.push('pnpm not found on PATH; DeepSeek Harness plugin installation requires pnpm')
    } else if (definition.fileTemplate) {
      status.installed = isOwnedFileHook(configRaw)
      if (definition.source === 'opencode') {
        const configJsonPath = openCodeConfigPathFor(definition, env)
        status.extraConfigPath = configJsonPath
        if (await pathExists(configJsonPath)) {
          const config = parseConfigJson(String(await getReadFile()(configJsonPath, 'utf-8')), configJsonPath)
          status.installed = status.installed && configHasOwnedOpenCodePlugin(config)
        } else {
          status.installed = false
        }
      }
    } else if (definition.yamlTemplate) {
      status.installed = configRaw.includes(rovoYamlBegin) && configRaw.includes(rovoYamlEnd)
    } else {
      const config = parseConfigJson(configRaw, configPath)
      status.installed = configHasOwnedHooks(config)
    }
    if (status.installed && !configRaw.includes('ELECTRON_RUN_AS_NODE') && !configRaw.includes(windowsHookCommandPrefix)) {
      status.warnings.push('aiopsterm hook is installed with a legacy JavaScript runtime command; reinstall this hook to use the packaged aiopsterm runtime')
    }
    if (status.installed && !definition.fileTemplate && getPlatform() === 'win32' && !configRaw.includes(windowsHookCommandPrefix)) {
      status.warnings.push('aiopsterm hook uses a shell-specific Windows command; reinstall this hook for CMD and PowerShell compatibility')
    }
  } catch (error) {
    status.error = error instanceof Error ? error.message : String(error)
  }

  if (definition.configToml) {
    status.extraConfigPath = codexConfigTomlPathFor(definition, env)
    try {
      const extraConfigExists = await pathExists(status.extraConfigPath)
      if (!extraConfigExists && status.installed) status.warnings.push('Codex config.toml was not found; hooks.json is installed but feature enablement is unknown')
    } catch {
      // Ignore status-only probing failures.
    }
  }

  try {
    const configDirExists = await pathExists(configDir)
    if (!configDirExists) status.warnings.push(`${configDir} does not exist yet`)
  } catch {
    // Ignore status-only probing failures.
  }

  return status
}

export const listAgentHookInstallers = async (): Promise<AgentHookInstallerSnapshot> => {
  const installers = await Promise.all(hookDefinitions.map((definition) => statusForDefinition(definition)))
  return { installers }
}

const installDefinition = async (definition: AgentHookDefinition): Promise<AgentHookInstallerOperationResult> => {
  const scriptPath = hookScriptPath()
  if (!scriptPath) throw new AgentHookInstallerError('AGENT_HOOK_SCRIPT_MISSING', 'Agent hook helper path is unavailable.')
  const configPath = configPathFor(definition)
  await getMkdir()(dirname(configPath), { recursive: true })
  if (definition.kimiToml) {
    const existingRaw = (await pathExists(configPath)) ? String(await getReadFile()(configPath, 'utf-8')) : ''
    await getWriteFile()(configPath, installKimiCodeHooks(existingRaw, definition, scriptPath, getPlatform(), getJsRuntimeExecutable()), 'utf-8')
    const snapshot = await listAgentHookInstallers()
    return { ok: true, data: { operation: 'install', source: definition.source, status: snapshot.installers.find((item) => item.source === definition.source)!, snapshot } }
  }
  if (definition.deepseekHarness) {
    const existingRaw = (await pathExists(configPath)) ? String(await getReadFile()(configPath, 'utf-8')) : ''
    const existing = parseConfigJson(existingRaw, configPath)
    const merged = mergeAgentHookJson(existing, definition, scriptPath, true, getPlatform(), getJsRuntimeExecutable())
    await getWriteFile()(configPath, prettyJson(merged.config), 'utf-8')
    const env = { ...getEnv(), npm_config_registry: getEnv().npm_config_registry || 'https://registry.npmmirror.com/' }
    const dshBinary = await findBinary(definition.binaryName, env)
    if (!dshBinary) throw new AgentHookInstallerError('AGENT_HOOK_BINARY_MISSING', 'DeepSeek Harness dsh executable was not found on PATH.')
    for (const profile of ['web', 'headless']) {
      await runCommand(dshBinary, ['plugin', '--profile', profile, 'add', '@deepseek-ai/dsh-hooks-codex@next'], env)
    }
    for (const patchPath of deepseekProfilePatchPaths(env)) {
      await getMkdir()(dirname(patchPath), { recursive: true })
      const patchRaw = (await pathExists(patchPath)) ? String(await getReadFile()(patchPath, 'utf-8')) : '[]\n'
      await getWriteFile()(patchPath, installDeepseekHarnessPatch(patchRaw, configPath), 'utf-8')
    }
    const snapshot = await listAgentHookInstallers()
    return { ok: true, data: { operation: 'install', source: definition.source, status: snapshot.installers.find((item) => item.source === definition.source)!, snapshot } }
  }
  if (definition.fileTemplate) {
    await installFileHookDefinition(definition, scriptPath)
    const snapshot = await listAgentHookInstallers()
    return { ok: true, data: { operation: 'install', source: definition.source, status: snapshot.installers.find((item) => item.source === definition.source)!, snapshot } }
  }
  if (definition.yamlTemplate) {
    const existingRaw = (await pathExists(configPath)) ? String(await getReadFile()(configPath, 'utf-8')) : ''
    await getWriteFile()(configPath, installRovoDevYaml(existingRaw, definition, scriptPath, getPlatform(), getJsRuntimeExecutable()), 'utf-8')
    const snapshot = await listAgentHookInstallers()
    return { ok: true, data: { operation: 'install', source: definition.source, status: snapshot.installers.find((item) => item.source === definition.source)!, snapshot } }
  }
  const existingRaw = (await pathExists(configPath)) ? String(await getReadFile()(configPath, 'utf-8')) : ''
  const existing = parseConfigJson(existingRaw, configPath)
  const merged = mergeAgentHookJson(existing, definition, scriptPath, true, getPlatform(), getJsRuntimeExecutable())
  await getWriteFile()(configPath, prettyJson(merged.config), 'utf-8')

  if (definition.configToml) {
    const configTomlPath = codexConfigTomlPathFor(definition)
    const tomlRaw = (await pathExists(configTomlPath)) ? String(await getReadFile()(configTomlPath, 'utf-8')) : ''
    const withFeature = installCodexHooksFeature(tomlRaw)
    const hooks = isPlainObject(merged.config.hooks) ? merged.config.hooks : {}
    await getWriteFile()(configTomlPath, installCodexHookTrust(withFeature, configPath, hooks), 'utf-8')
  }

  const snapshot = await listAgentHookInstallers()
  return { ok: true, data: { operation: 'install', source: definition.source, status: snapshot.installers.find((item) => item.source === definition.source)!, snapshot } }
}

const uninstallDefinition = async (definition: AgentHookDefinition): Promise<AgentHookInstallerOperationResult> => {
  const configPath = configPathFor(definition)
  if (definition.kimiToml) {
    if (await pathExists(configPath)) {
      await getWriteFile()(configPath, uninstallKimiCodeHooks(String(await getReadFile()(configPath, 'utf-8'))), 'utf-8')
    }
    const snapshot = await listAgentHookInstallers()
    return { ok: true, data: { operation: 'uninstall', source: definition.source, status: snapshot.installers.find((item) => item.source === definition.source)!, snapshot } }
  }
  if (definition.deepseekHarness) {
    if (await pathExists(configPath)) {
      const existing = parseConfigJson(String(await getReadFile()(configPath, 'utf-8')), configPath)
      const merged = mergeAgentHookJson(existing, definition, hookScriptPath() || 'aiopsterm-agent-hook', false, getPlatform(), getJsRuntimeExecutable())
      await getWriteFile()(configPath, prettyJson(merged.config), 'utf-8')
    }
    for (const patchPath of deepseekProfilePatchPaths()) {
      if (await pathExists(patchPath)) {
        await getWriteFile()(patchPath, uninstallDeepseekHarnessPatch(String(await getReadFile()(patchPath, 'utf-8'))), 'utf-8')
      }
    }
    const snapshot = await listAgentHookInstallers()
    return { ok: true, data: { operation: 'uninstall', source: definition.source, status: snapshot.installers.find((item) => item.source === definition.source)!, snapshot } }
  }
  if (definition.fileTemplate) {
    await uninstallFileHookDefinition(definition)
    const snapshot = await listAgentHookInstallers()
    return { ok: true, data: { operation: 'uninstall', source: definition.source, status: snapshot.installers.find((item) => item.source === definition.source)!, snapshot } }
  }
  if (definition.yamlTemplate) {
    if (await pathExists(configPath)) {
      const existingRaw = String(await getReadFile()(configPath, 'utf-8'))
      await getWriteFile()(configPath, uninstallRovoDevYaml(existingRaw), 'utf-8')
    }
    const snapshot = await listAgentHookInstallers()
    return { ok: true, data: { operation: 'uninstall', source: definition.source, status: snapshot.installers.find((item) => item.source === definition.source)!, snapshot } }
  }
  if (await pathExists(configPath)) {
    const existingRaw = String(await getReadFile()(configPath, 'utf-8'))
    const existing = parseConfigJson(existingRaw, configPath)
    const merged = mergeAgentHookJson(existing, definition, hookScriptPath() || 'aiopsterm-agent-hook', false, getPlatform(), getJsRuntimeExecutable())
    await getWriteFile()(configPath, prettyJson(merged.config), 'utf-8')
  }

  if (definition.configToml) {
    const configTomlPath = codexConfigTomlPathFor(definition)
    if (await pathExists(configTomlPath)) {
      const tomlRaw = String(await getReadFile()(configTomlPath, 'utf-8'))
      await getWriteFile()(configTomlPath, uninstallCodexHooksFeature(tomlRaw), 'utf-8')
    }
  }

  const snapshot = await listAgentHookInstallers()
  return { ok: true, data: { operation: 'uninstall', source: definition.source, status: snapshot.installers.find((item) => item.source === definition.source)!, snapshot } }
}

const operationErrorResult = (error: unknown): AgentHookInstallerOperationResult => ({
  ok: false,
  errorCode: error instanceof AgentHookInstallerError ? error.errorCode : 'AGENT_HOOK_OPERATION_FAILED',
  errorMessage: error instanceof Error ? error.message : String(error || 'Agent hook operation failed.')
})

export const installAgentHook = async (input: AgentHookInstallerOperationInput): Promise<AgentHookInstallerOperationResult> => {
  try {
    const source = normalizeSource(input?.source)
    if (!source) throw new AgentHookInstallerError('AGENT_HOOK_SOURCE_INVALID', 'Agent hook source is not supported.')
    const definition = definitionFor(source)
    if (!definition) throw new AgentHookInstallerError('AGENT_HOOK_SOURCE_UNSUPPORTED', `Agent hook source ${source} is not supported.`)
    return await installDefinition(definition)
  } catch (error) {
    return operationErrorResult(error)
  }
}

export const uninstallAgentHook = async (input: AgentHookInstallerOperationInput): Promise<AgentHookInstallerOperationResult> => {
  try {
    const source = normalizeSource(input?.source)
    if (!source) throw new AgentHookInstallerError('AGENT_HOOK_SOURCE_INVALID', 'Agent hook source is not supported.')
    const definition = definitionFor(source)
    if (!definition) throw new AgentHookInstallerError('AGENT_HOOK_SOURCE_UNSUPPORTED', `Agent hook source ${source} is not supported.`)
    return await uninstallDefinition(definition)
  } catch (error) {
    return operationErrorResult(error)
  }
}

export const __testing = {
  ownedMarker,
  fileHookMarker,
  hookDefinitions,
  configPathFor,
  configDirFor,
  openCodeConfigPathFor,
  mergeOpenCodePluginRegistration,
  pluginFileContentFor,
  rovoDevYamlHooksBlock,
  isOwnedHookCommand,
  removeOwnedHooksFromGroups,
  installCodexHookTrust
}
