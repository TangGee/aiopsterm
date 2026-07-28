import type { AiopsMutationResult } from './common'

export type AgentHookInstallerSource =
  | 'codex'
  | 'claude-code'
  | 'cursor'
  | 'gemini'
  | 'copilot'
  | 'grok'
  | 'opencode'
  | 'codebuddy'
  | 'factory'
  | 'qoder'
  | 'amp'
  | 'pi'
  | 'omp'
  | 'kiro'
  | 'rovodev'

export type AgentHookInstallerStatus = {
  source: AgentHookInstallerSource
  label: string
  binaryName: string
  launchCommand: string
  binaryPath: string
  configPath: string
  configExists: boolean
  installed: boolean
  scriptPath: string
  extraConfigPath?: string
  warnings: string[]
  error?: string
}

export type AgentHookInstallerSnapshot = {
  installers: AgentHookInstallerStatus[]
}

export type AgentHookInstallerOperationInput = {
  source: AgentHookInstallerSource
}

export type AgentHookInstallerOperation = 'install' | 'uninstall'

export type AgentHookInstallerOperationResult = AiopsMutationResult<{
  operation: AgentHookInstallerOperation
  source: AgentHookInstallerSource
  status: AgentHookInstallerStatus
  snapshot: AgentHookInstallerSnapshot
}>

export type AgentHookInstallerListResult = AiopsMutationResult<AgentHookInstallerSnapshot>
