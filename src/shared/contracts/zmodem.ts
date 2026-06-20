import type { AiopsMutationResult } from './common'

export type ZmodemUploadFile = {
  name: string
  size: number
  lastModified: number
  data: number[]
}

export type ZmodemUploadPickResult = AiopsMutationResult<{
  files: ZmodemUploadFile[]
  canceled?: boolean
}>

export type ZmodemSavePathPickResult = AiopsMutationResult<{
  filePath?: string
  canceled?: boolean
}>

export type ZmodemStreamOpenResult = AiopsMutationResult<{
  streamId: string
  filePath: string
}>

export type ZmodemStreamWriteResult = AiopsMutationResult<{
  streamId: string
  bytes: number
  totalBytes: number
}>

export type ZmodemStreamCloseResult = AiopsMutationResult<{
  streamId: string
  filePath: string
  bytes: number
}>
