import type { AiopsMutationResult } from './common'

export type AliasCommandConfig = {
  id: string
  alias: string
  command: string
  createdAt?: number
}

export type AliasCommandSaveInput = {
  id?: string
  previousAlias?: string
  alias: string
  command: string
  createdAt?: number
}

export type AliasCommandDeleteInput = {
  id?: string
  alias?: string
}

export type AliasCommandListResult = AiopsMutationResult<AliasCommandConfig[]>

export type AliasCommandMutationResult = AiopsMutationResult<{
  command: AliasCommandConfig
  commands: AliasCommandConfig[]
}>

export type AliasCommandDeleteResult = AiopsMutationResult<{
  deleted: AliasCommandConfig
  commands: AliasCommandConfig[]
}>
